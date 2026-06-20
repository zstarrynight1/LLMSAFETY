"""Baseline 1 (RESEARCH_PLAN.md muc 4.1): chay THUAN Bandit/Semgrep tren dataset da crawl,
KHONG dung LLM. Day la baseline "cu" de so sanh voi pipeline LLM de xuat.

Tai su dung run_bandit()/run_semgrep() tu label_snippets.py (research/data-collection/) thay vi
viet lai logic goi subprocess - tranh trung lap code (coding-rules.md: SRP + khong lap lai).
"""

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "data-collection"))
from label_snippets import run_bandit, run_semgrep  # noqa: E402


def predict_static(snippet, bandit_runner=None, semgrep_runner=None):
    """vulnerable=True neu Bandit HOAC Semgrep phat hien van de (OR-combine 2 static analyzer)."""
    language = snippet.get("language")
    bandit_kwargs = {"runner": bandit_runner} if bandit_runner else {}
    semgrep_kwargs = {"runner": semgrep_runner} if semgrep_runner else {}

    bandit_result = run_bandit(snippet["code_text"], language, **bandit_kwargs)
    semgrep_result = run_semgrep(snippet["code_text"], language, **semgrep_kwargs)

    vulnerable = bool(
        (bandit_result and bandit_result["vulnerable"]) or (semgrep_result and semgrep_result["vulnerable"]),
    )

    return {
        "question_id": snippet.get("question_id"),
        "language": language,
        "predicted_vulnerable": vulnerable,
        "bandit_result": bandit_result,
        "semgrep_result": semgrep_result,
    }


def run_baseline(snippets, bandit_runner=None, semgrep_runner=None):
    return [predict_static(s, bandit_runner=bandit_runner, semgrep_runner=semgrep_runner) for s in snippets]


def load_snippets(input_path):
    snippets = []
    with open(input_path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                snippets.append(json.loads(line))
    return snippets


def save_predictions(predictions, output_path):
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8") as f:
        for prediction in predictions:
            f.write(json.dumps(prediction, ensure_ascii=False) + "\n")


def main():
    parser = argparse.ArgumentParser(description="Baseline 1: Bandit/Semgrep thuan (khong dung LLM).")
    parser.add_argument("--input", required=True, help="File .jsonl snippet (tu crawl_stackoverflow.py)")
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    snippets = load_snippets(args.input)
    predictions = run_baseline(snippets)
    save_predictions(predictions, args.output)
    print(f"Da chay baseline static tren {len(predictions)} snippet, luu vao {args.output}")


if __name__ == "__main__":
    main()
