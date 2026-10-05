#!/usr/bin/env python3
"""Fetch short, original-publisher context for the live news corpus.

Full article text is processed in memory by fetch-coffee-reference-articles;
only compact excerpts, relevance-context snippets, and extraction metadata are
stored for the clustering review. No article is republished in full.
"""

import concurrent.futures
from email.utils import parsedate_to_datetime
import importlib.util
import json
import os
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data" / "berita-all.json"
LIMIT = max(1, int(os.environ.get("COFFEE_NEWS_CONTEXT_FETCH_LIMIT", "400")))
SOURCE = Path(__file__).with_name("fetch-coffee-reference-articles.py")
SPEC = importlib.util.spec_from_file_location("coffee_article_fetcher", SOURCE)
FETCHER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(FETCHER)


def main():
    document = json.loads(DATA.read_text(encoding="utf-8"))
    articles = document.get("artikel", [])
    now = FETCHER.now_utc()
    queue = []
    seen = set()
    for index, article in enumerate(articles):
        url = str(article.get("tautan") or article.get("link") or "").strip()
        if not url.startswith(("https://", "http://")):
            continue
        host = urlparse(url).netloc.lower()
        if host == "news.google.com" or host.endswith(".google.com") or article.get("link_type") == "aggregator_redirect":
            continue
        if url in seen:
            continue
        seen.add(url)
        source_record = {"id": index, "url": url, "title": article.get("judul") or article.get("title") or ""}
        fetch_state = {**article, "id": index, "url": url}
        if FETCHER.should_fetch(fetch_state, now):
            queue.append((article, fetch_state))
    def published_rank(item):
        raw_date = str(item[0].get("tanggal") or "").strip()
        try:
            parsed = datetime.fromisoformat(raw_date.replace("Z", "+00:00"))
        except ValueError:
            try:
                parsed = parsedate_to_datetime(raw_date)
            except (TypeError, ValueError, OverflowError):
                return 0
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=FETCHER.timezone.utc)
        return parsed.timestamp()
    queue.sort(key=lambda item: (item[0].get("cluster_assignment") != "unassigned", -published_rank(item), item[0].get("judul", "")))
    queue = queue[:LIMIT]
    if not queue:
        print("Live coffee corpus: publisher context already fetched or awaiting retry window.")
        return

    print(f"Fetching publisher context for {len(queue)} news URLs (limit {LIMIT}).", flush=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
        results = list(pool.map(lambda item: FETCHER.fetch_one(item[1]), queue))
    by_url = {item[1]["url"]: item[0] for item in queue}
    for original, fields in results:
        target = by_url.get(original.get("url"))
        if target is not None:
            target.update(fields)
    document["content_fetch"] = {
        "last_batch_at": FETCHER.iso(now),
        "batch_size": len(queue),
        "batch_limit": LIMIT,
        "purpose": "Short original-publisher context for relevance and cluster review; full article text is not stored or republished.",
    }
    DATA.write_text(json.dumps(document, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    totals = {}
    for article in articles:
        status = article.get("extraction_status") or "pending"
        totals[status] = totals.get(status, 0) + 1
    print(json.dumps({"fetched": len(queue), "context_status": totals}, ensure_ascii=False))


if __name__ == "__main__":
    main()
