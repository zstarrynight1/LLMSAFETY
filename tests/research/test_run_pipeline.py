import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "research" / "evaluation"))

from llm_provider import APITimeoutError, DryRunProvider, SchemaValidationError  # noqa: E402
from run_pipeline import (  # noqa: E402
    heuristic_prefilter,
    load_snippets,
    run_pipeline,
    run_pipeline_on_snippet,
)

SAMPLE_SNIPPETS = [
    {"question_id": 1, "language": "python", "code_text": "os.system(user_input)"},
    {"question_id": 2, "language": "python", "code_text": "x=1"},  # qua ngan, se bi loc o buoc 1
    {"question_id": 3, "language": "javascript", "code_text": "eval(userInput)"},
    {"question_id": 4, "language": "python", "code_text": "password = 'hardcoded123456'"},
    {"question_id": 5, "language": "javascript", "code_text": "const safeValue = sanitize(x);"},
]


def test_heuristic_prefilter_rejects_short_or_empty_snippets():
    assert heuristic_prefilter("") is False
    assert heuristic_prefilter("x=1") is False
    assert heuristic_prefilter("   ") is False


def test_heuristic_prefilter_accepts_snippets_above_min_length():
    assert heuristic_prefilter("os.system(user_input_value)") is True


def test_run_pipeline_on_snippet_skips_llm_calls_when_filtered_by_heuristic():
    calls = []

    class CountingProvider:
        def analyze(self, *args, **kwargs):  # noqa: ARG002
            calls.append(1)
            return {"vulnerable": False, "cweId": None, "explanation": "", "confidence": 0.1, "fixSuggestion": None}, {
                "prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0, "cost_usd": 0.0,
            }

    result = run_pipeline_on_snippet(SAMPLE_SNIPPETS[1], CountingProvider(), CountingProvider(), clock_fn=lambda: 0.0)
    assert result["filtered_by_heuristic"] is True
    assert result["predicted"] is None
    assert calls == []  # khong goi LLM cho snippet bi loc o buoc heuristic


def test_run_pipeline_on_snippet_calls_detector_then_judge_when_judge_enabled():
    call_order = []

    class TrackedProvider:
        def __init__(self, name, result):
            self.name = name
            self.result = result

        def analyze(self, code_text, context=None, include_context=True):  # noqa: ARG002
            call_order.append(self.name)
            return self.result, {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15, "cost_usd": 0.001}

    detector_result = {"vulnerable": True, "cweId": "CWE-89", "explanation": "detector", "confidence": 0.7, "fixSuggestion": None}
    judge_result = {"vulnerable": True, "cweId": "CWE-89", "explanation": "judge verified", "confidence": 0.95, "fixSuggestion": "use prepared statement"}

    result = run_pipeline_on_snippet(
        SAMPLE_SNIPPETS[0],
        TrackedProvider("detector", detector_result),
        TrackedProvider("judge", judge_result),
        clock_fn=lambda: 0.0,
    )

    assert call_order == ["detector", "judge"]  # detector chay TRUOC judge
    assert result["detector_result"] == detector_result
    assert result["judge_result"] == judge_result
    assert result["predicted"] == judge_result  # ket qua cuoi cung la cua judge, khong phai detector
    assert result["usage"]["total_tokens"] == 30  # 15 detector + 15 judge
    assert result["usage"]["cost_usd"] == 0.002


def test_run_pipeline_on_snippet_uses_detector_result_directly_when_judge_disabled():
    detector_result = {"vulnerable": False, "cweId": None, "explanation": "ok", "confidence": 0.3, "fixSuggestion": None}

    class FixedProvider:
        def analyze(self, *args, **kwargs):  # noqa: ARG002
            return detector_result, {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15, "cost_usd": 0.001}

    result = run_pipeline_on_snippet(SAMPLE_SNIPPETS[0], FixedProvider(), judge_provider=None, clock_fn=lambda: 0.0)
    assert result["judge_result"] is None
    assert result["predicted"] == detector_result
    assert result["usage"]["cost_usd"] == 0.001  # chi 1 lan goi (detector), khong co judge


def test_run_pipeline_on_snippet_detector_error_returns_error_row_instead_of_raising():
    class FailingProvider:
        def analyze(self, *args, **kwargs):  # noqa: ARG002
            raise APITimeoutError("vuot qua timeout 30s")

    result = run_pipeline_on_snippet(SAMPLE_SNIPPETS[0], FailingProvider(), judge_provider=None, clock_fn=lambda: 0.0)

    assert result["predicted"] is None
    assert result["error"] is not None
    assert "buoc 2" in result["error"]


def test_run_pipeline_on_snippet_judge_error_falls_back_to_detector_result():
    detector_result = {"vulnerable": True, "cweId": "CWE-89", "explanation": "detector", "confidence": 0.7, "fixSuggestion": None}

    class DetectorProvider:
        def analyze(self, *args, **kwargs):  # noqa: ARG002
            return detector_result, {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15, "cost_usd": 0.001}

    class FailingJudgeProvider:
        def analyze(self, *args, **kwargs):  # noqa: ARG002
            raise SchemaValidationError("output LLM sai schema")

    result = run_pipeline_on_snippet(SAMPLE_SNIPPETS[0], DetectorProvider(), FailingJudgeProvider(), clock_fn=lambda: 0.0)

    assert result["detector_result"] == detector_result
    assert result["judge_result"] is None
    assert result["predicted"] == detector_result  # fallback ve ket qua detector, khong mat du lieu
    assert result["error"] is not None
    assert "buoc 3" in result["error"]


def test_run_pipeline_continues_processing_remaining_snippets_after_one_detector_error(tmp_path):
    # Truoc fix: 1 loi tam thoi (vd APITimeoutError) o snippet giua batch se lam crash toan bo
    # run_pipeline(), mat het cac snippet con lai chua xu ly.
    class FlakyOnSecondCallProvider:
        def __init__(self):
            self.calls = 0

        def analyze(self, *args, **kwargs):  # noqa: ARG002
            self.calls += 1
            if self.calls == 1:
                raise APITimeoutError("loi tam thoi")
            return {"vulnerable": False, "cweId": None, "explanation": "ok", "confidence": 0.2, "fixSuggestion": None}, {
                "prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2, "cost_usd": 0.0001,
            }

    snippets = [SAMPLE_SNIPPETS[0], SAMPLE_SNIPPETS[3]]  # 2 snippet hop le (qua heuristic)
    output_path = tmp_path / "results.jsonl"

    results = run_pipeline(
        snippets, FlakyOnSecondCallProvider(), judge_provider=None, output_path=output_path,
        save_every=10, print_fn=lambda _: None,
    )

    assert len(results) == 2  # ca 2 snippet deu duoc xu ly (1 loi, 1 thanh cong), khong crash
    assert results[0]["error"] is not None
    assert results[1]["error"] is None
    assert results[1]["predicted"]["vulnerable"] is False


def test_run_pipeline_writes_intermediate_results_immediately_not_holding_everything_in_ram(tmp_path):
    detector = DryRunProvider()
    judge = DryRunProvider()
    output_path = tmp_path / "pipeline_results.jsonl"

    results = run_pipeline(SAMPLE_SNIPPETS, detector, judge, output_path, save_every=2, print_fn=lambda _: None)

    assert len(results) == len(SAMPLE_SNIPPETS)
    lines = output_path.read_text(encoding="utf-8").strip().split("\n")
    assert len(lines) == len(SAMPLE_SNIPPETS)
    first_row = json.loads(lines[1])  # snippet 2 (x=1) bi loc o buoc heuristic
    assert first_row["filtered_by_heuristic"] is True


def test_load_snippets_reads_jsonl(tmp_path):
    input_path = tmp_path / "snippets.jsonl"
    with input_path.open("w", encoding="utf-8") as f:
        for s in SAMPLE_SNIPPETS:
            f.write(json.dumps(s) + "\n")
    loaded = load_snippets(input_path)
    assert len(loaded) == len(SAMPLE_SNIPPETS)
