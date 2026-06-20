import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "research" / "evaluation"))

from llm_provider import APIRateLimitError, APITimeoutError, DryRunProvider, SchemaValidationError  # noqa: E402
from run_llm_naive import (  # noqa: E402
    load_snippets,
    run_naive_baseline,
    run_naive_on_snippet,
)

SAMPLE_SNIPPETS = [
    {"question_id": i, "language": "python", "code_text": f"os.system(x{i})"}
    for i in range(1, 8)  # 7 mau, dung trong gioi han 5-10 theo coding-rules.md muc 6
]


def test_run_naive_on_snippet_returns_predicted_result_and_latency_with_dry_run_provider():
    provider = DryRunProvider()
    result = run_naive_on_snippet(SAMPLE_SNIPPETS[0], provider, clock_fn=lambda: 0.0)
    assert result["predicted"]["vulnerable"] is False
    assert result["error"] is None
    assert result["usage"]["cost_usd"] == 0.0
    assert result["latency_ms"] == 0.0


def test_run_naive_on_snippet_does_not_pass_context_to_provider(monkeypatch):
    captured = {}

    class SpyProvider:
        def analyze(self, code_text, context=None, include_context=True):
            captured["context"] = context
            captured["include_context"] = include_context
            return {"vulnerable": False, "cweId": None, "explanation": "", "confidence": 0.1, "fixSuggestion": None}, {
                "prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0, "cost_usd": 0.0,
            }

    run_naive_on_snippet(SAMPLE_SNIPPETS[0], SpyProvider())
    assert captured["context"] is None
    assert captured["include_context"] is False  # baseline naive: KHONG context (RESEARCH_PLAN.md 4.1)


def test_run_naive_on_snippet_catches_timeout_error_without_raising():
    class TimeoutProvider:
        def analyze(self, *args, **kwargs):  # noqa: ARG002
            raise APITimeoutError("vuot qua timeout")

    result = run_naive_on_snippet(SAMPLE_SNIPPETS[0], TimeoutProvider(), clock_fn=lambda: 0.0)
    assert result["predicted"] is None
    assert result["error"] is not None


def test_run_naive_on_snippet_catches_rate_limit_error_without_raising():
    class RateLimitedProvider:
        def analyze(self, *args, **kwargs):  # noqa: ARG002
            raise APIRateLimitError("vuot rate limit")

    result = run_naive_on_snippet(SAMPLE_SNIPPETS[0], RateLimitedProvider(), clock_fn=lambda: 0.0)
    assert result["predicted"] is None
    assert result["error"] is not None


def test_run_naive_on_snippet_catches_schema_validation_error_without_raising():
    class BadSchemaProvider:
        def analyze(self, *args, **kwargs):  # noqa: ARG002
            raise SchemaValidationError("output sai schema")

    result = run_naive_on_snippet(SAMPLE_SNIPPETS[0], BadSchemaProvider(), clock_fn=lambda: 0.0)
    assert result["predicted"] is None
    assert result["error"] is not None


def test_run_naive_on_snippet_catches_generic_runtime_error_without_raising():
    # RuntimeError la loi 5xx/connection tu AnthropicProvider sau khi SDK da retry het.
    class ServerErrorProvider:
        def analyze(self, *args, **kwargs):  # noqa: ARG002
            raise RuntimeError("Anthropic API loi server (HTTP 500)")

    result = run_naive_on_snippet(SAMPLE_SNIPPETS[0], ServerErrorProvider(), clock_fn=lambda: 0.0)
    assert result["predicted"] is None
    assert result["error"] is not None


def test_run_naive_baseline_writes_one_result_per_snippet_immediately_to_file(tmp_path):
    provider = DryRunProvider()
    output_path = tmp_path / "naive_results.jsonl"

    results = run_naive_baseline(SAMPLE_SNIPPETS, provider, output_path, save_every=3, print_fn=lambda _: None)

    assert len(results) == len(SAMPLE_SNIPPETS)
    lines = output_path.read_text(encoding="utf-8").strip().split("\n")
    assert len(lines) == len(SAMPLE_SNIPPETS)
    assert json.loads(lines[0])["question_id"] == 1


def test_load_snippets_reads_jsonl(tmp_path):
    input_path = tmp_path / "snippets.jsonl"
    with input_path.open("w", encoding="utf-8") as f:
        for s in SAMPLE_SNIPPETS:
            f.write(json.dumps(s) + "\n")
    loaded = load_snippets(input_path)
    assert len(loaded) == len(SAMPLE_SNIPPETS)
