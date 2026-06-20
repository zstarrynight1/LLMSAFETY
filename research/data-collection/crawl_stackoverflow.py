"""Crawl code snippet tu cau hoi StackOverflow qua Stack Exchange API (site=stackoverflow).

Pham vi ngon ngu: Python + JavaScript (quyet dinh tu user, xem RESEARCH_PLAN.md muc 0.3).

Rate limit: Stack Exchange API tra ve 2 field dong trong moi response - "backoff" (so giay
PHAI cho truoc request tiep theo, neu co) va "quota_remaining" (so request con lai trong
ngay). Day la co che throttle chinh thuc va dong (xac nhan qua StackAPI - thu vien Python
wrapper chinh thuc cho API nay: "Automatically obeys the backoff parameter", va qua bai viet
cua ky su Stack Exchange Kevin Montrose ve thiet ke throttle cua API V2.0). Script nay:
  - Gioi han toc do co dinh toi da 1 request/giay (MIN_SECONDS_BETWEEN_REQUESTS) - thap hon
    nhieu so voi nguong "simultaneous requests" gay tam cam IP (Montrose: 30 request/giay).
  - Luon doc va cho dung theo "backoff" neu API tra ve.
  - Dung crawl ngay khi "quota_remaining" <= 0, KHONG co gang tu doan han ngach ngay chinh
    xac (con so nay phu thuoc co dang ky app key hay khong - khong tu doan theo
    coding-rules.md muc 10, neu can biet chinh xac phai tra lai docs chinh thuc
    api.stackexchange.com/docs/throttle hoac hoi nguoi review).
"""

import argparse
import json
import os
import re
import time
from pathlib import Path

import requests

STACKEXCHANGE_API_BASE = "https://api.stackexchange.com/2.3"
SITE = "stackoverflow"
MIN_SECONDS_BETWEEN_REQUESTS = 1.0
PAGE_SIZE = 100
DEFAULT_LANGUAGES = ["python", "javascript"]

RAW_DATA_DIR = Path(__file__).resolve().parent / "raw-data"

CODE_BLOCK_PATTERN = re.compile(r"<pre><code>(.*?)</code></pre>", re.DOTALL)
HTML_ENTITY_MAP = (
    ("&lt;", "<"),
    ("&gt;", ">"),
    ("&quot;", '"'),
    ("&#39;", "'"),
    ("&amp;", "&"),
)
MIN_CODE_LENGTH = 20


class StackExchangeRateLimitExceeded(Exception):
    """Da het quota_remaining trong ngay - dung crawl ngay, khong retry."""


def decode_html_entities(html_fragment):
    text = html_fragment
    for entity, char in HTML_ENTITY_MAP:
        text = text.replace(entity, char)
    return text


def extract_code_snippets_from_html(html_body, question_id, language):
    """Trich code snippet tho tu HTML cau hoi qua selector <pre><code> (khong dung LLM)."""
    snippets = []
    for match in CODE_BLOCK_PATTERN.finditer(html_body or ""):
        code_text = decode_html_entities(match.group(1)).strip()
        if len(code_text) < MIN_CODE_LENGTH:
            continue
        snippets.append({
            "question_id": question_id,
            "language": language,
            "code_text": code_text,
        })
    return snippets


def fetch_questions_page(tag, page, api_key=None, session=None, page_size=PAGE_SIZE):
    """Goi 1 trang /questions cho 1 tag ngon ngu, sap xep theo vote giam dan."""
    params = {
        "site": SITE,
        "tagged": tag,
        "page": page,
        "pagesize": page_size,
        "order": "desc",
        "sort": "votes",
        "filter": "withbody",
    }
    if api_key:
        params["key"] = api_key

    http = session or requests
    response = http.get(f"{STACKEXCHANGE_API_BASE}/questions", params=params, timeout=30)
    response.raise_for_status()
    data = response.json()

    quota_remaining = data.get("quota_remaining")
    if quota_remaining is not None and quota_remaining <= 0:
        raise StackExchangeRateLimitExceeded(
            f"quota_remaining = {quota_remaining}: da het han ngach Stack Exchange API hom nay.",
        )
    return data


def crawl_tag(tag, limit, api_key=None, session=None, sleep_fn=time.sleep, clock_fn=time.monotonic):
    """Crawl toi da `limit` snippet cho 1 tag ngon ngu. Tra ve list snippet (chua ghi file)."""
    collected = []
    page = 1
    last_request_at = clock_fn() - MIN_SECONDS_BETWEEN_REQUESTS

    while len(collected) < limit:
        elapsed = clock_fn() - last_request_at
        wait_remaining = MIN_SECONDS_BETWEEN_REQUESTS - elapsed
        if wait_remaining > 0:
            sleep_fn(wait_remaining)
        last_request_at = clock_fn()

        data = fetch_questions_page(tag, page, api_key=api_key, session=session)

        for item in data.get("items", []):
            snippets = extract_code_snippets_from_html(item.get("body", ""), item.get("question_id"), tag)
            collected.extend(snippets)
            if len(collected) >= limit:
                break

        backoff = data.get("backoff")
        if backoff:
            sleep_fn(backoff)

        if not data.get("has_more"):
            break
        page += 1

    return collected[:limit]


def save_raw_snippets(snippets, output_path):
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8") as f:
        for snippet in snippets:
            f.write(json.dumps(snippet, ensure_ascii=False) + "\n")


def main():
    parser = argparse.ArgumentParser(description="Crawl code snippet tu StackOverflow qua Stack Exchange API.")
    parser.add_argument(
        "--languages", nargs="+", default=DEFAULT_LANGUAGES,
        help="Tag ngon ngu can crawl (mac dinh: python javascript, theo pham vi dataset da chot).",
    )
    parser.add_argument(
        "--limit", type=int, default=50,
        help="So snippet toi da MOI ngon ngu (mac dinh 50 - dung de test truoc khi crawl full dataset).",
    )
    parser.add_argument("--output-dir", default=str(RAW_DATA_DIR))
    args = parser.parse_args()

    api_key = os.environ.get("STACKEXCHANGE_API_KEY")  # tuy chon, tang han ngach neu co

    for tag in args.languages:
        print(f"Crawling tag={tag}, limit={args.limit}...")
        try:
            snippets = crawl_tag(tag, args.limit, api_key=api_key)
        except StackExchangeRateLimitExceeded as exc:
            print(f"DUNG CRAWL: {exc}")
            break
        output_path = Path(args.output_dir) / f"{tag}.jsonl"
        save_raw_snippets(snippets, output_path)
        print(f"Da luu {len(snippets)} snippet vao {output_path}")


if __name__ == "__main__":
    main()
