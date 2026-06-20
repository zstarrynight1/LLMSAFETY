"""Baseline 3 (RESEARCH_PLAN.md muc 4.1): code tho vao LLM, KHONG context, KHONG pipeline nhieu
buoc - day la baseline "naive" de chung minh gia tri cua pipeline de xuat (run_pipeline.py).

PHAI co --dry-run de test logic truoc khi goi API that (coding-rules.md 4.4). Khi chay that voi
>100 snippet, PHAI hoi xac nhan chi phi uoc tinh truoc (xem llm_provider.confirm_batch_run).
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
    ValidationError,
    confirm_batch_run,
)

SAVE_PROGRESS_EVERY_N = 10


def load_snippets(input_path):
    snippets = []
    with open(input_path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                snippets.append(json.loads(line))
    return snippets


def run_naive_on_snippet(snippet, provider, clock_fn=time.monotonic):
    start = clock_fn()
    error = None
    try:
        result, usage = provider.analyze(snippet["code_text"], context=None, include_context=False)
    except ValidationError as exc:
        result = None
        usage = {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0, "cost_usd": 0.0}
        error = str(exc)
    latency_ms = (clock_fn() - start) * 1000
    return {
        "question_id": snippet.get("question_id"),
        "language": snippet.get("language"),
        "predicted": result,
        "error": error,
        "usage": usage,
        "latency_ms": latency_ms,
    }


def run_naive_baseline(snippets, provider, output_path, save_every=SAVE_PROGRESS_EVERY_N, print_fn=print):
    """Ghi ket qua ra file NGAY SAU MOI snippet - khong giu het trong RAM, khong mat du lieu
    neu crash giua chung (coding-rules.md muc 8 - may dev 8GB RAM)."""
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    results = []
    with output_path.open("w", encoding="utf-8") as f:
        for i, snippet in enumerate(snippets, start=1):
            result = run_naive_on_snippet(snippet, provider)
            f.write(json.dumps(result, ensure_ascii=False) + "\n")
            f.flush()
            results.append(result)
            if i % save_every == 0:
                print_fn(f"Da xu ly {i}/{len(snippets)} snippet...")
    return results


def main():
    parser = argparse.ArgumentParser(description="Baseline 3: LLM zero-shot, khong context, khong pipeline.")
    parser.add_argument("--input", required=True, help="File .jsonl snippet (tu crawl_stackoverflow.py)")
    parser.add_argument("--output", required=True)
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--dry-run", action="store_true", help="Khong goi API that, dung DryRunProvider.")
    args = parser.parse_args()

    snippets = load_snippets(args.input)

    if args.dry_run:
        provider = DryRunProvider()
        print(f"[--dry-run] Se xu ly {len(snippets)} snippet voi DryRunProvider (khong goi API that).")
    else:
        if not confirm_batch_run(snippets, args.model, calls_per_snippet=1):
            print("Da huy - khong chay batch that.")
            return
        api_key = os.environ.get("ANTHROPIC_API_KEY")
        provider = AnthropicProvider(api_key=api_key, model=args.model)

    results = run_naive_baseline(snippets, provider, args.output)
    print(f"Da xu ly {len(results)} snippet, luu vao {args.output}")


if __name__ == "__main__":
    main()
