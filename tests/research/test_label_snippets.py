import json
import sys
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "research" / "data-collection"))

from label_snippets import (  # noqa: E402
    label_snippet,
    load_snippets,
    run_bandit,
    run_semgrep,
    sample_for_human_review,
    save_labels,
)

SAMPLE_SNIPPETS = [
    {"question_id": 1, "language": "python", "code_text": "import os\nos.system(user_input)"},
    {"question_id": 2, "language": "python", "code_text": "x = 1 + 1"},
    {"question_id": 3, "language": "javascript", "code_text": "eval(userInput)"},
    {"question_id": 4, "language": "javascript", "code_text": "const x = 1;"},
    {"question_id": 5, "language": "python", "code_text": "password = 'hardcoded123'"},
]


def fake_runner(stdout_json):
    """Tra ve 1 ham gia lap subprocess.run, KHONG goi binary bandit/semgrep that."""
    def _runner(cmd, capture_output, text, timeout, check):  # noqa: ARG001
        return SimpleNamespace(stdout=json.dumps(stdout_json) if stdout_json is not None else "", returncode=0)
    return _runner


def test_run_bandit_returns_none_for_non_python_language():
    assert run_bandit("eval(x)", "javascript", runner=fake_runner({})) is None


def test_run_bandit_parses_findings_into_vulnerable_true_with_issues():
    bandit_report = {
        "results": [
            {"test_id": "B605", "issue_severity": "HIGH", "issue_text": "Starting a process with a shell"},
        ],
    }
    result = run_bandit("os.system(x)", "python", runner=fake_runner(bandit_report))
    assert result["vulnerable"] is True
    assert result["issues"][0]["test_id"] == "B605"


def test_run_bandit_returns_vulnerable_false_when_no_findings():
    result = run_bandit("x = 1", "python", runner=fake_runner({"results": []}))
    assert result == {"vulnerable": False, "issues": []}


def test_run_bandit_handles_empty_stdout_as_no_findings():
    result = run_bandit("x = 1", "python", runner=fake_runner(None))
    assert result == {"vulnerable": False, "issues": []}


def test_run_semgrep_returns_none_for_unsupported_language():
    assert run_semgrep("code", "ruby", runner=fake_runner({})) is None


def test_run_semgrep_works_for_both_python_and_javascript():
    semgrep_report = {"results": [{"check_id": "javascript.lang.security.audit.eval", "extra": {"message": "eval() detected"}}]}
    result_js = run_semgrep("eval(x)", "javascript", runner=fake_runner(semgrep_report))
    result_py = run_semgrep("eval(x)", "python", runner=fake_runner(semgrep_report))
    assert result_js["vulnerable"] is True
    assert result_py["vulnerable"] is True
    assert result_js["issues"][0]["check_id"] == "javascript.lang.security.audit.eval"


def test_label_snippet_stores_bandit_and_semgrep_separately_and_never_auto_fills_human_label():
    snippet = SAMPLE_SNIPPETS[0]
    label = label_snippet(
        snippet,
        bandit_runner=fake_runner({"results": [{"test_id": "B605", "issue_severity": "HIGH", "issue_text": "x"}]}),
        semgrep_runner=fake_runner({"results": []}),
    )
    assert label["question_id"] == 1
    assert label["label_bandit"]["vulnerable"] is True
    assert label["label_semgrep"]["vulnerable"] is False
    assert label["label_human"] is None  # khong bao gio tu dong gan nhan human


def test_label_snippet_for_javascript_has_no_bandit_label_but_has_semgrep_label():
    snippet = SAMPLE_SNIPPETS[2]
    label = label_snippet(
        snippet,
        bandit_runner=fake_runner({}),
        semgrep_runner=fake_runner({"results": [{"check_id": "x", "extra": {"message": "m"}}]}),
    )
    assert label["label_bandit"] is None
    assert label["label_semgrep"]["vulnerable"] is True


def test_load_snippets_and_save_labels_roundtrip(tmp_path):
    input_path = tmp_path / "snippets.jsonl"
    with input_path.open("w", encoding="utf-8") as f:
        for s in SAMPLE_SNIPPETS:
            f.write(json.dumps(s) + "\n")

    loaded = load_snippets(input_path)
    assert len(loaded) == len(SAMPLE_SNIPPETS)
    assert loaded[0]["question_id"] == 1

    output_path = tmp_path / "labels.jsonl"
    save_labels(loaded, output_path)
    lines = output_path.read_text(encoding="utf-8").strip().split("\n")
    assert len(lines) == len(SAMPLE_SNIPPETS)


def test_sample_for_human_review_is_deterministic_given_a_seed_and_respects_size_cap():
    sample_a = sample_for_human_review(SAMPLE_SNIPPETS, sample_size=3, seed=42)
    sample_b = sample_for_human_review(SAMPLE_SNIPPETS, sample_size=3, seed=42)
    assert sample_a == sample_b
    assert len(sample_a) == 3

    full_sample = sample_for_human_review(SAMPLE_SNIPPETS, sample_size=999, seed=1)
    assert len(full_sample) == len(SAMPLE_SNIPPETS)  # khong vuot qua so luong thuc te
