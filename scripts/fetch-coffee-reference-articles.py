#!/usr/bin/env python3
"""Fetch original article URLs from the Coffee Intelligence Engine corpus.

The full article text is used only in memory for extraction and exact-content
deduplication. The public corpus receives source metadata and a short excerpt,
not a copied full article.
"""

import concurrent.futures
import hashlib
import json
import os
import re
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from io import BytesIO
from pathlib import Path
from urllib.parse import urlparse

from lxml import html as lxml_html
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parent.parent
CORPUS = ROOT / "data" / "coffee-reference-articles.json"
USER_AGENT = "Mozilla/5.0 (compatible; KabarKopiResearch/1.0; +https://kabarkopi.qcoid.com/)"
FETCH_LIMIT = max(1, int(os.environ.get("COFFEE_REFERENCE_FETCH_LIMIT", "25")))
MAX_BYTES = 8 * 1024 * 1024
TIMEOUT = 18
host_locks = {}
host_locks_guard = threading.Lock()


def now_utc():
    return datetime.now(timezone.utc)


def iso(value):
    return value.isoformat(timespec="seconds").replace("+00:00", "Z")


def clean(value):
    return re.sub(r"\s+", " ", value or "").strip()


def meta_values(document, selectors):
    values = []
    for selector in selectors:
        values.extend(document.xpath(selector))
    return [clean(str(value)) for value in values if clean(str(value))]


def extract_html(payload):
    document = lxml_html.fromstring(payload)
    for node in document.xpath("//script|//style|//nav|//header|//footer|//aside|//form|//noscript|//svg|//button"):
        node.drop_tree()

    title = meta_values(document, [
        '//meta[@name="citation_title"]/@content',
        '//meta[@property="og:title"]/@content',
        "//title/text()",
        "//h1[1]//text()",
    ])
    description = meta_values(document, [
        '//meta[@name="description"]/@content',
        '//meta[@property="og:description"]/@content',
        '//meta[@name="citation_abstract"]/@content',
    ])
    authors = meta_values(document, [
        '//meta[@name="author"]/@content',
        '//meta[@name="citation_author"]/@content',
        '//meta[@property="article:author"]/@content',
    ])
    dates = meta_values(document, [
        '//meta[@property="article:published_time"]/@content',
        '//meta[@name="date"]/@content',
        '//meta[@name="citation_publication_date"]/@content',
        "//time/@datetime",
        "//time//text()",
    ])
    article_nodes = document.xpath("//article|//main|//*[@role='main']")
    content_node = article_nodes[0] if article_nodes else document
    content = clean(content_node.text_content())
    return {
        "title": title[0] if title else "",
        "description": description[0] if description else "",
        "authors": list(dict.fromkeys(authors)),
        "published_date": dates[0] if dates else "",
        "text": content,
        "method": "html_article_or_main" if article_nodes else "html_body",
    }


def extract_pdf(payload):
    reader = PdfReader(BytesIO(payload), strict=False)
    text = clean(" ".join(page.extract_text() or "" for page in reader.pages))
    metadata = reader.metadata or {}
    author = clean(str(metadata.get("/Author", "")))
    title = clean(str(metadata.get("/Title", "")))
    return {
        "title": title,
        "description": "",
        "authors": [author] if author else [],
        "published_date": "",
        "text": text,
        "method": "pdf_text",
    }


def fetch_one(article):
    original_url = str(article.get("url") or "").strip()
    timestamp = now_utc()
    if not original_url:
        return article, {"extraction_status": "no_public_url", "extracted_at": iso(timestamp)}

    host = urlparse(original_url).netloc.lower()
    with host_locks_guard:
        host_lock = host_locks.setdefault(host, threading.Lock())

    with host_lock:
        time.sleep(0.35)
        request = urllib.request.Request(original_url, headers={
            "User-Agent": USER_AGENT,
            "Accept": "text/html,application/pdf,application/xhtml+xml,*/*;q=0.6",
        })
        try:
            with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
                resolved_url = response.geturl()
                content_type = response.headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
                payload = response.read(MAX_BYTES + 1)
                http_status = response.status
        except urllib.error.HTTPError as error:
            return article, {
                "extraction_status": "http_error", "extracted_at": iso(timestamp),
                "fetch_error": f"HTTP {error.code}", "retry_after": iso(timestamp + timedelta(days=7)),
            }
        except Exception as error:
            return article, {
                "extraction_status": "fetch_error", "extracted_at": iso(timestamp),
                "fetch_error": str(error)[:240], "retry_after": iso(timestamp + timedelta(days=7)),
            }

    common = {
        "extracted_at": iso(timestamp), "extracted_from_url": original_url, "resolved_url": resolved_url,
        "source_content_type": content_type, "http_status": http_status,
    }
    if len(payload) > MAX_BYTES:
        return article, {**common, "extraction_status": "too_large", "retry_after": iso(timestamp + timedelta(days=30))}

    try:
        if "pdf" in content_type or payload.startswith(b"%PDF") or payload.startswith(b"\n%PDF"):
            extracted = extract_pdf(payload)
        elif "html" in content_type or b"<html" in payload[:4096].lower() or b"<!doctype" in payload[:4096].lower():
            extracted = extract_html(payload)
        else:
            return article, {**common, "extraction_status": "unsupported_content_type", "retry_after": iso(timestamp + timedelta(days=30))}
    except Exception as error:
        return article, {
            **common, "extraction_status": "extraction_error", "fetch_error": str(error)[:240],
            "retry_after": iso(timestamp + timedelta(days=7)),
        }

    text = extracted["text"]
    if len(text) < 100:
        status = "thin_content_or_shell"
    else:
        status = "extracted"
    content_hash = hashlib.sha256(re.sub(r"[^\w]+", " ", text.lower()).encode("utf-8")).hexdigest() if len(text) >= 300 else ""
    fields = {
        **common,
        "extraction_status": status,
        "extraction_method": extracted["method"],
        "source_title": extracted["title"][:400],
        "source_description": extracted["description"][:1200],
        "source_authors": extracted["authors"][:8],
        "source_published_date": extracted["published_date"][:100],
        "content_char_count": len(text),
        "content_sha256": content_hash or None,
        "content_excerpt": text[:420],
        "fetch_error": None,
        "retry_after": None if status == "extracted" else iso(timestamp + timedelta(days=7)),
    }
    date_match = re.search(
        r"(?<!\d)(20\d{2}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?)",
        extracted["published_date"],
    )
    if not article.get("published_date") and date_match:
        fields["published_date"] = date_match.group(1)
    return article, fields


def should_fetch(article, now):
    status = article.get("extraction_status")
    fetched = article.get("extracted_at") or ""
    retry_after = article.get("retry_after") or ""
    if article.get("url") and article.get("extracted_from_url") and article.get("url") != article.get("extracted_from_url"):
        return True
    if status == "extracted" and article.get("url") == article.get("extracted_from_url"):
        return False
    if not article.get("url"):
        return status != "no_public_url"
    if not status:
        return True
    try:
        return bool(retry_after and datetime.fromisoformat(retry_after.replace("Z", "+00:00")) <= now)
    except ValueError:
        return not fetched


def main():
    corpus = json.loads(CORPUS.read_text(encoding="utf-8"))
    articles = corpus.get("articles", [])
    now = now_utc()
    queued = [article for article in articles if should_fetch(article, now)][:FETCH_LIMIT]
    if not queued:
        print("Coffee reference articles: no new URLs to fetch.")
        return

    print(f"Fetching original article URLs: {len(queued)} this run (limit {FETCH_LIMIT}).", flush=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
        updates = list(pool.map(fetch_one, queued))
    by_id = {str(article.get("id")): article for article in articles}
    by_url = {article.get("url"): article for article in articles if article.get("url")}
    for original, fields in updates:
        target = by_id.get(str(original.get("id"))) or by_url.get(original.get("url"))
        if target is not None:
            target.update(fields)

    hashes = {}
    for article in articles:
        value = article.get("content_sha256")
        if value:
            hashes.setdefault(value, []).append(article.get("id"))
    for article in articles:
        duplicates = hashes.get(article.get("content_sha256"), []) if article.get("content_sha256") else []
        article["exact_content_duplicate_ids"] = [item for item in duplicates if item != article.get("id")]

    corpus["content_fetch"] = {
        "last_batch_at": iso(now),
        "batch_size": len(queued),
        "batch_limit": FETCH_LIMIT,
        "purpose": "Fetch each original publisher URL for article metadata, a short searchable excerpt, and exact-content deduplication. Full article text is not republished.",
    }
    CORPUS.write_text(json.dumps(corpus, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    statuses = {}
    for article in articles:
        key = article.get("extraction_status", "pending")
        statuses[key] = statuses.get(key, 0) + 1
    dup_groups = sum(1 for values in hashes.values() if len(values) > 1)
    print(json.dumps({"batch_fetched": len(queued), "status_totals": statuses, "exact_content_duplicate_groups": dup_groups}, ensure_ascii=False))


if __name__ == "__main__":
    main()
