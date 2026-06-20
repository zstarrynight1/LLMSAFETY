import json
import sys
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "research" / "evaluation"))

from run_baseline_static import (  # noqa: E402
    load_snippets,
    predict_static,
    run_baseline,
    save_predictions,
)

SAMPLE_SNIPPETS = [
    {"question_id": 1, "language": "python", "code_text": "os.system(x)"},
    {"question_id": 2, "language": "python", "code_text": "x = 1"},
    {"question_id": 3, "language": "javascript", "code_text": "eval(x)"},
    {"question_id": 4, "language": "javascript", "code_text": "const x = 1;"},
    {"question_id": 5, "language": "python", "code_text": "y = 2"},
]


def fake_runner(stdout_json):
    def _runner(cmd, capture_output, text, timeout, check):  # noqa: ARG001
        return SimpleNamespace(stdout=json.dumps(stdout_json) if stdout_json is not None else "", returncode=0)
    return _runner


def test_predict_static_is_vulnerable_when_bandit_flags_an_issue():
    snippet = SAMPLE_SNIPPETS[0]
    bandit_report = {"results": [{"test_id": "B605", "issue_severity": "HIGH", "issue_text": "x"}]}
    prediction = predict_static(snippet, bandit_runner=fake_runner(bandit_report), semgrep_runner=fake_runner({"results": []}))
    assert prediction["predicted_vulnerable"] is True
    assert prediction["bandit_result"]["vulnerable"] is True
    assert prediction["semgrep_result"]["vulnerable"] is False


def test_predict_static_is_vulnerable_when_only_semgrep_flags_an_issue():
    snippet = SAMPLE_SNIPPETS[2]  # javascript - bandit khong ap dung
    semgrep_report = {"results": [{"check_id": "javascript.eval", "extra": {"message": "eval"}}]}
    prediction = predict_static(snippet, bandit_runner=fake_runner({}), semgrep_runner=fake_runner(semgrep_report))
    assert prediction["predicted_vulnerable"] is True
    assert prediction["bandit_result"] is None  # bandit khong chay cho javascript


def test_predict_static_is_not_vulnerable_when_neither_analyzer_flags_anything():
    snippet = SAMPLE_SNIPPETS[1]
    prediction = predict_static(
        snippet, bandit_runner=fake_runner({"results": []}), semgrep_runner=fake_runner({"results": []}),
    )
    assert prediction["predicted_vulnerable"] is False


def test_run_baseline_processes_all_snippets():
    predictions = run_baseline(
        SAMPLE_SNIPPETS, bandit_runner=fake_runner({"results": []}), semgrep_runner=fake_runner({"results": []}),
    )
    assert len(predictions) == len(SAMPLE_SNIPPETS)
    assert all("predicted_vulnerable" in p for p in predictions)


def test_load_and_save_snippets_roundtrip(tmp_path):
    input_path = tmp_path / "snippets.jsonl"
    with input_path.open("w", encoding="utf-8") as f:
        for s in SAMPLE_SNIPPETS:
            f.write(json.dumps(s) + "\n")

    loaded = load_snippets(input_path)
    assert len(loaded) == len(SAMPLE_SNIPPETS)

    output_path = tmp_path / "predictions.jsonl"
    predictions = run_baseline(loaded, bandit_runner=fake_runner({"results": []}), semgrep_runner=fake_runner({"results": []}))
    save_predictions(predictions, output_path)

    lines = output_path.read_text(encoding="utf-8").strip().split("\n")
    assert len(lines) == len(SAMPLE_SNIPPETS)
    assert json.loads(lines[0])["question_id"] == 1
