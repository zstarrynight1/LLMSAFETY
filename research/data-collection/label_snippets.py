"""Gan nhan vulnerable/not cho snippet da crawl, bang Bandit (Python) + Semgrep (da ngon ngu).

Nhan tu MOI nguon duoc luu RIENG BIET (label_bandit, label_semgrep, label_human) - KHONG ghi
de len nhau, de sau nay tinh duoc Cohen's Kappa giua cac nguon (RESEARCH_PLAN.md muc 3.1).

KHONG dung LLM (GPT/Claude) de gan ground-truth label trong file nay - tranh circular
validation (RESEARCH_PLAN.md muc 3.3): LLM-as-detector la doi tuong DUOC danh gia trong
nghien cuu, khong duoc vua la nguon nhan vua la doi tuong danh gia.
"""

import argparse
import json
import random
import subprocess
import tempfile
from pathlib import Path

SUPPORTED_LANGUAGES = {"python": ".py", "javascript": ".js"}
SUBPROCESS_TIMEOUT_SECONDS = 60


def _write_temp_file(code_text, suffix):
    with tempfile.NamedTemporaryFile(mode="w", suffix=suffix, delete=False, encoding="utf-8") as tmp:
        tmp.write(code_text)
        return Path(tmp.name)


def run_bandit(code_text, language, runner=subprocess.run):
    """Chay Bandit tren 1 snippet. Tra ve None neu khong phai Python (Bandit chi ho tro Python)."""
    if language != "python":
        return None

    tmp_path = _write_temp_file(code_text, SUPPORTED_LANGUAGES["python"])
    try:
        result = runner(
            ["bandit", "-f", "json", "-q", str(tmp_path)],
            capture_output=True, text=True, timeout=SUBPROCESS_TIMEOUT_SECONDS, check=False,
        )
        if not result.stdout.strip():
            return {"vulnerable": False, "issues": []}
        report = json.loads(result.stdout)
        issues = report.get("results", [])
        return {
            "vulnerable": len(issues) > 0,
            "issues": [
                {
                    "test_id": issue.get("test_id"),
                    "issue_severity": issue.get("issue_severity"),
                    "issue_text": issue.get("issue_text"),
                }
                for issue in issues
            ],
        }
    finally:
        tmp_path.unlink(missing_ok=True)


def run_semgrep(code_text, language, runner=subprocess.run):
    """Chay Semgrep tren 1 snippet (Python hoac JavaScript). Tra ve None neu ngon ngu khong ho tro."""
    suffix = SUPPORTED_LANGUAGES.get(language)
    if not suffix:
        return None

    tmp_path = _write_temp_file(code_text, suffix)
    try:
        result = runner(
            ["semgrep", "--config", "auto", "--json", "--quiet", str(tmp_path)],
            capture_output=True, text=True, timeout=SUBPROCESS_TIMEOUT_SECONDS, check=False,
        )
        if not result.stdout.strip():
            return {"vulnerable": False, "issues": []}
        report = json.loads(result.stdout)
        issues = report.get("results", [])
        return {
            "vulnerable": len(issues) > 0,
            "issues": [
                {
                    "check_id": issue.get("check_id"),
                    "message": (issue.get("extra") or {}).get("message"),
                }
                for issue in issues
            ],
        }
    finally:
        tmp_path.unlink(missing_ok=True)


def label_snippet(snippet, bandit_runner=subprocess.run, semgrep_runner=subprocess.run):
    language = snippet.get("language")
    return {
        "question_id": snippet.get("question_id"),
        "language": language,
        "label_bandit": run_bandit(snippet["code_text"], language, runner=bandit_runner),
        "label_semgrep": run_semgrep(snippet["code_text"], language, runner=semgrep_runner),
        "label_human": None,  # dien thu cong sau qua review, KHONG tu dong gan
    }


def load_snippets(input_path):
    snippets = []
    with open(input_path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                snippets.append(json.loads(line))
    return snippets


def save_labels(labels, output_path):
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8") as f:
        for label in labels:
            f.write(json.dumps(label, ensure_ascii=False) + "\n")


def sample_for_human_review(labels, sample_size, seed=42):
    """Chon mau ngau nhien (50-150 theo RESEARCH_PLAN.md muc 3.2) de human-verify thu cong."""
    rng = random.Random(seed)
    return rng.sample(labels, min(sample_size, len(labels)))


def main():
    parser = argparse.ArgumentParser(description="Gan nhan Bandit/Semgrep cho snippet da crawl.")
    parser.add_argument("--input", required=True, help="File .jsonl snippet da crawl (tu crawl_stackoverflow.py)")
    parser.add_argument("--output", required=True, help="File .jsonl ket qua gan nhan")
    parser.add_argument(
        "--human-sample-size", type=int, default=0,
        help="Neu > 0, xuat them file *.human-sample.jsonl de human-verify thu cong",
    )
    args = parser.parse_args()

    snippets = load_snippets(args.input)
    labels = [label_snippet(s) for s in snippets]
    save_labels(labels, args.output)
    print(f"Da gan nhan {len(labels)} snippet, luu vao {args.output}")

    if args.human_sample_size > 0:
        sample = sample_for_human_review(labels, args.human_sample_size)
        sample_path = Path(args.output).with_suffix(".human-sample.jsonl")
        save_labels(sample, sample_path)
        print(f"Da xuat mau {len(sample)} snippet de human-verify vao {sample_path}")


if __name__ == "__main__":
    main()
