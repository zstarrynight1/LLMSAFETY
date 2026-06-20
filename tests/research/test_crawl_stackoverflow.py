import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "research" / "data-collection"))

from crawl_stackoverflow import (  # noqa: E402
    StackExchangeRateLimitExceeded,
    crawl_tag,
    extract_code_snippets_from_html,
    fetch_questions_page,
    save_raw_snippets,
)

SAMPLE_BODY = """
<p>Vi du:</p>
<pre><code>import os
os.system(user_input)
</code></pre>
<p>con day la doan khac:</p>
<pre><code>x = 1</code></pre>
"""


class FakeResponse:
    def __init__(self, payload, status_code=200):
        self._payload = payload
        self.status_code = status_code

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")

    def json(self):
        return self._payload


class FakeSession:
    def __init__(self, pages):
        self.pages = pages
        self.calls = []

    def get(self, url, params=None, timeout=None):
        self.calls.append({"url": url, "params": params})
        page = params["page"]
        payload = self.pages[page - 1]
        return FakeResponse(payload)


def test_extract_code_snippets_from_html_finds_pre_code_blocks_and_decodes_entities():
    body = "<pre><code>import os\nos.system(&quot;rm -rf /&quot;)</code></pre>"
    snippets = extract_code_snippets_from_html(body, question_id=1, language="python")
    assert len(snippets) == 1
    assert snippets[0]["code_text"] == 'import os\nos.system("rm -rf /")'
    assert snippets[0]["question_id"] == 1
    assert snippets[0]["language"] == "python"


def test_extract_code_snippets_from_html_skips_snippets_shorter_than_min_length():
    body = "<pre><code>x=1</code></pre>"  # qua ngan
    snippets = extract_code_snippets_from_html(body, question_id=1, language="python")
    assert snippets == []


def test_extract_code_snippets_from_html_returns_multiple_blocks():
    snippets = extract_code_snippets_from_html(SAMPLE_BODY, question_id=42, language="python")
    assert len(snippets) == 1  # block thu 2 ("x = 1") qua ngan, bi loc
    assert "os.system" in snippets[0]["code_text"]


def test_fetch_questions_page_raises_when_quota_remaining_is_zero():
    session = FakeSession(pages=[{"items": [], "has_more": False, "quota_remaining": 0}])
    with pytest.raises(StackExchangeRateLimitExceeded):
        fetch_questions_page("python", page=1, session=session)


def test_fetch_questions_page_does_not_call_real_network_passes_correct_params():
    session = FakeSession(pages=[{"items": [], "has_more": False, "quota_remaining": 100}])
    fetch_questions_page("javascript", page=1, api_key="fake-key", session=session)
    assert len(session.calls) == 1
    params = session.calls[0]["params"]
    assert params["tagged"] == "javascript"
    assert params["site"] == "stackoverflow"
    assert params["key"] == "fake-key"


def test_crawl_tag_stops_once_limit_reached_without_extra_requests():
    pages = [
        {
            "items": [
                {"question_id": 1, "body": SAMPLE_BODY},
                {"question_id": 2, "body": SAMPLE_BODY},
            ],
            "has_more": True,
            "quota_remaining": 100,
        },
    ]
    session = FakeSession(pages=pages)
    sleeps = []
    snippets = crawl_tag(
        "python", limit=1, session=session,
        sleep_fn=sleeps.append, clock_fn=lambda: 0.0,
    )
    assert len(snippets) == 1
    assert len(session.calls) == 1  # khong goi them trang 2 vi da du limit


def test_crawl_tag_respects_backoff_field_by_sleeping_that_many_seconds():
    pages = [
        {"items": [{"question_id": 1, "body": SAMPLE_BODY}], "has_more": True, "backoff": 5, "quota_remaining": 100},
        {"items": [{"question_id": 2, "body": SAMPLE_BODY}], "has_more": False, "quota_remaining": 100},
    ]
    session = FakeSession(pages=pages)
    sleeps = []
    crawl_tag("python", limit=10, session=session, sleep_fn=sleeps.append, clock_fn=lambda: 0.0)
    assert 5 in sleeps  # da cho dung theo backoff truoc khi goi trang tiep theo


def test_crawl_tag_stops_when_has_more_is_false():
    pages = [{"items": [{"question_id": 1, "body": SAMPLE_BODY}], "has_more": False, "quota_remaining": 100}]
    session = FakeSession(pages=pages)
    snippets = crawl_tag("python", limit=100, session=session, sleep_fn=lambda s: None, clock_fn=lambda: 0.0)
    assert len(session.calls) == 1
    assert len(snippets) == 1


def test_save_raw_snippets_writes_one_json_object_per_line(tmp_path):
    snippets = [
        {"question_id": 1, "language": "python", "code_text": "import os"},
        {"question_id": 2, "language": "python", "code_text": "import sys"},
    ]
    output_path = tmp_path / "python.jsonl"
    save_raw_snippets(snippets, output_path)

    lines = output_path.read_text(encoding="utf-8").strip().split("\n")
    assert len(lines) == 2
    assert json.loads(lines[0])["question_id"] == 1
