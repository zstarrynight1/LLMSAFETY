"""Pipeline de xuat (RESEARCH_PLAN.md muc 2.3 - phan "novelty" phuong phap luan chinh):
  Buoc 1: heuristic pre-filter (KHONG dung LLM - loai snippet qua ngan/khong lien quan an toan)
  Buoc 2: LLM-as-detector (context-aware: ngon ngu, platform - CWE taxonomy nam trong prompt)
  Buoc 3: LLM-as-judge verify lai ket qua buoc 2 (MAC DINH BAT - quyet dinh cua user, dung
          --no-judge de tat lam ablation rieng so sanh)
  Buoc 4: output JSON theo schema co dinh (hien thi UI la viec cua extension/, khong phai script nay)

KHONG duoc rut gon thanh "bo code vao prompt hoi LLM" - do la run_llm_naive.py (baseline 3),
khong phai pipeline nay.

PHAI co --dry-run, luu ket qua trung gian ngay sau moi snippet, va hoi xac nhan chi phi truoc
khi chay that >100 call (coding-rules.md 4.4, muc 8).
"""

import argparse
import json
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from llm_provider import (  # noqa: E402
    DEFAULT_MODEL,
    AnthropicProvider,
    DryRunProvider,
    confirm_batch_run,
)

MIN_CODE_LENGTH_FOR_ANALYSIS = 20
SAVE_PROGRESS_EVERY_N = 10
EMPTY_USAGE = {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0, "cost_usd": 0.0}


def heuristic_prefilter(code_text):
    """Buoc 1: loai snippet qua ngan / khong co gia tri phan tich an toan, KHONG goi LLM
    (tranh lang phi goi API cho snippet ro rang khong dang phan tich)."""
    return bool(code_text) and len(code_text.strip()) >= MIN_CODE_LENGTH_FOR_ANALYSIS


def _sum_usage(a, b):
    return {
        "prompt_tokens": a["prompt_tokens"] + b["prompt_tokens"],
        "completion_tokens": a["completion_tokens"] + b["completion_tokens"],
        "total_tokens": a["total_tokens"] + b["total_tokens"],
        "cost_usd": a["cost_usd"] + b["cost_usd"],
    }


def run_pipeline_on_snippet(snippet, detector_provider, judge_provider=None, clock_fn=time.monotonic):
    start = clock_fn()
    code_text = snippet.get("code_text", "")

    if not heuristic_prefilter(code_text):
        return {
            "question_id": snippet.get("question_id"),
            "language": snippet.get("language"),
            "filtered_by_heuristic": True,
            "detector_result": None,
            "judge_result": None,
            "predicted": None,
            "usage": dict(EMPTY_USAGE),
            "latency_ms": (clock_fn() - start) * 1000,
        }

    context = {"language": snippet.get("language")}
    detector_result, detector_usage = detector_provider.analyze(code_text, context, include_context=True)

    judge_result = None
    judge_usage = dict(EMPTY_USAGE)
    final_result = detector_result

    if judge_provider is not None:
        judge_input = (
            "Ket qua phan tich so bo can ban kiem tra lai (co the sai, hay danh gia doc lap):\n"
            f"{json.dumps(detector_result, ensure_ascii=False)}\n\n"
            "Code goc can doi chieu:\n"
            f"{code_text}"
        )
        judge_result, judge_usage = judge_provider.analyze(judge_input, context, include_context=True)
        final_result = judge_result

    return {
        "question_id": snippet.get("question_id"),
        "language": snippet.get("language"),
        "filtered_by_heuristic": False,
        "detector_result": detector_result,
        "judge_result": judge_result,
        "predicted": final_result,
        "usage": _sum_usage(detector_usage, judge_usage),
        "latency_ms": (clock_fn() - start) * 1000,
    }


def load_snippets(input_path):
    snippets = []
    with open(input_path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                snippets.append(json.loads(line))
    return snippets


def run_pipeline(snippets, detector_provider, judge_provider, output_path, save_every=SAVE_PROGRESS_EVERY_N, print_fn=print):
    """Ghi ket qua ra file NGAY SAU MOI snippet - khong giu het trong RAM (coding-rules.md muc 8)."""
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    results = []
    with output_path.open("w", encoding="utf-8") as f:
        for i, snippet in enumerate(snippets, start=1):
            result = run_pipeline_on_snippet(snippet, detector_provider, judge_provider)
            f.write(json.dumps(result, ensure_ascii=False) + "\n")
            f.flush()
            results.append(result)
            if i % save_every == 0:
                print_fn(f"Da xu ly {i}/{len(snippets)} snippet...")
    return results


def main():
    parser = argparse.ArgumentParser(description="Pipeline de xuat: heuristic + LLM-detector + LLM-judge.")
    parser.add_argument("--input", required=True, help="File .jsonl snippet (tu crawl_stackoverflow.py)")
    parser.add_argument("--output", required=True)
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument(
        "--no-judge", action="store_true",
        help="Tat buoc 3 (LLM-as-judge) - mac dinh BAT theo quyet dinh cua user.",
    )
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    snippets = load_snippets(args.input)
    use_judge = not args.no_judge
    calls_per_snippet = 2 if use_judge else 1

    if args.dry_run:
        detector_provider = DryRunProvider()
        judge_provider = DryRunProvider() if use_judge else None
        print(
            f"[--dry-run] Se xu ly {len(snippets)} snippet "
            f"(judge={'bat' if use_judge else 'tat'}), khong goi API that.",
        )
    else:
        if not confirm_batch_run(snippets, args.model, calls_per_snippet=calls_per_snippet):
            print("Da huy - khong chay batch that.")
            return
        api_key = os.environ.get("ANTHROPIC_API_KEY")
        detector_provider = AnthropicProvider(api_key=api_key, model=args.model)
        judge_provider = AnthropicProvider(api_key=api_key, model=args.model) if use_judge else None

    results = run_pipeline(snippets, detector_provider, judge_provider, args.output)
    n_filtered = sum(1 for r in results if r["filtered_by_heuristic"])
    print(f"Da xu ly {len(results)} snippet ({n_filtered} bi loc o buoc heuristic), luu vao {args.output}")


if __name__ == "__main__":
    main()
