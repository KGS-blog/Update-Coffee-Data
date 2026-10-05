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
DATE_ENRICHMENT_VERSION = 6
MAX_BYTES = 8 * 1024 * 1024
TIMEOUT = 18
MONTHS = {
    "january": 1, "jan": 1, "february": 2, "feb": 2, "march": 3, "mar": 3,
    "april": 4, "apr": 4, "may": 5, "june": 6, "jun": 6, "july": 7, "jul": 7,
    "august": 8, "aug": 8, "september": 9, "sep": 9, "sept": 9, "october": 10,
    "oct": 10, "november": 11, "nov": 11, "december": 12, "dec": 12,
    "januari": 1, "februari": 2, "maret": 3, "april": 4, "mei": 5, "juni": 6,
    "juli": 7, "agustus": 8, "september": 9, "oktober": 10, "november": 11,
    "desember": 12,
}
MONTH_PATTERN = "|".join(sorted((re.escape(name) for name in MONTHS), key=len, reverse=True))
DATE_TOKEN_PATTERN = (
    rf"(?:20\d{{2}}[-/.]\d{{1,2}}[-/.]\d{{1,2}}|20\d{{2}}[-/.]\d{{1,2}}|"
    rf"\d{{1,2}}[-/.]\d{{1,2}}[-/.]20\d{{2}}|\d{{1,2}}[-/.]20\d{{2}}|"
    rf"\d{{1,2}}\s+(?:{MONTH_PATTERN})\.?\s*,?\s+20\d{{2}}|"
    rf"(?:{MONTH_PATTERN})\.?\s+\d{{1,2}},?\s+20\d{{2}}|"
    rf"(?:{MONTH_PATTERN})\.?\s+20\d{{2}}|20\d{{2}})"
)
host_locks = {}
host_locks_guard = threading.Lock()


def now_utc():
    return datetime.now(timezone.utc)


def iso(value):
    return value.isoformat(timespec="seconds").replace("+00:00", "Z")


def clean(value):
    return re.sub(r"\s+", " ", value or "").strip()


def parse_date_token(value):
    value = clean(value).strip(" .,;:()[]")
    match = re.search(r"\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})(?=$|[T\s])", value)
    if match:
        try:
            date = datetime(int(match.group(1)), int(match.group(2)), int(match.group(3)))
            return date.strftime("%Y-%m-%d"), "day"
        except ValueError:
            return None
    match = re.search(r"\b(20\d{2})[-/.](\d{1,2})\b", value)
    if match:
        year, month = int(match.group(1)), int(match.group(2))
        if 1 <= month <= 12:
            return f"{year:04d}-{month:02d}", "month"
        return None
    # Indonesian publications commonly use day/month/year or day-month-year.
    # This is used only after an explicit publication label was found.
    match = re.search(r"\b(\d{1,2})[-/.](\d{1,2})[-/.](20\d{2})\b", value)
    if match:
        day, month, year = int(match.group(1)), int(match.group(2)), int(match.group(3))
        try:
            return datetime(year, month, day).strftime("%Y-%m-%d"), "day"
        except ValueError:
            return None
    match = re.search(r"\b(\d{1,2})[-/.](20\d{2})\b", value)
    if match:
        month, year = int(match.group(1)), int(match.group(2))
        if 1 <= month <= 12:
            return f"{year:04d}-{month:02d}", "month"
        return None
    match = re.search(rf"\b(\d{{1,2}})\s+({MONTH_PATTERN})\.?\s*,?\s+(20\d{{2}})\b", value, re.I)
    if match:
        day, month, year = int(match.group(1)), MONTHS[match.group(2).lower().rstrip(".")], int(match.group(3))
        try:
            return datetime(year, month, day).strftime("%Y-%m-%d"), "day"
        except ValueError:
            return None
    match = re.search(rf"\b({MONTH_PATTERN})\.?\s+(\d{{1,2}}),?\s+(20\d{{2}})\b", value, re.I)
    if match:
        month, day, year = MONTHS[match.group(1).lower().rstrip(".")], int(match.group(2)), int(match.group(3))
        try:
            return datetime(year, month, day).strftime("%Y-%m-%d"), "day"
        except ValueError:
            return None
    match = re.search(rf"\b({MONTH_PATTERN})\.?\s+(20\d{{2}})\b", value, re.I)
    if match:
        month, year = MONTHS[match.group(1).lower().rstrip(".")], int(match.group(2))
        return f"{year:04d}-{month:02d}", "month"
    match = re.search(r"\b(20\d{2})\b", value)
    if match:
        return f"{int(match.group(1)):04d}", "year"
    return None


def publication_date_from_text(text):
    # Only trust an explicit publication label here. Dates in citations,
    # reported event schedules, or study periods are not publication dates.
    labels = re.compile(
        rf"\b(?:published(?:\s+(?:on|date))?|publication\s+date|date\s+published|"
        rf"distribution\s+date|release\s+date|date\s+of\s+issue|"
        rf"pub(?:lication)?\.?\s*date|diterbitkan|tanggal\s+terbit|tanggal\s+publikasi|"
        rf"tanggal\s+rilis|terbit\s+pada|published\s+online)\s*[:\-]?\s*({DATE_TOKEN_PATTERN})",
        re.I,
    )
    for match in labels.finditer(text[:12000]):
        parsed = parse_date_token(match.group(1))
        if parsed:
            return parsed[0], parsed[1], clean(text[max(0, match.start() - 45):match.end() + 25])[:180]

    # Journal first-page issue lines commonly say “Vol. 6, No. 3, Mei 2026”.
    # Keep this lower-precision fallback tied to issue/volume wording.
    issue = re.search(
        rf"\b(?:vol(?:ume)?\.?|issue|nomor|no\.?)\s*[^\n.]{{0,100}}?({MONTH_PATTERN})\.?\s+(20\d{{2}})\b",
        text[:5000], re.I,
    )
    if issue:
        month, year = MONTHS[issue.group(1).lower().rstrip(".")], int(issue.group(2))
        return f"{year:04d}-{month:02d}", "month", clean(text[max(0, issue.start() - 30):issue.end() + 30])[:180]
    issue_year = re.search(
        r"\b(?:vol(?:ume)?\.?|issue|nomor|no\.?)\s*[^\n.]{0,100}?(20\d{2})\b",
        text[:5000], re.I,
    )
    if not issue_year:
        # Some journals print volume/issue as “11(1)” without the word Volume.
        issue_year = re.search(r"\b\d{1,3}\s*\(\d{1,2}\)\s*[^\n.]{0,100}?(20\d{2})\b", text[:5000])
    if issue_year:
        year = int(issue_year.group(1))
        return f"{year:04d}", "year", clean(text[max(0, issue_year.start() - 30):issue_year.end() + 30])[:180]
    return None


def coffee_context(text):
    # Keep short source excerpts near coffee mentions so the independent
    # relevance screen can see the article's actual context without publishing
    # the full source text.
    pattern = re.compile(r"\b(?:kopi|coffee|coffea|arabica|robusta|espresso|green\s+bean)\b", re.I)
    snippets = []
    seen = set()
    for match in pattern.finditer(text[:12000]):
        snippet = clean(text[max(0, match.start() - 140):min(len(text), match.end() + 180)])
        key = snippet.lower()
        if snippet and key not in seen:
            snippets.append(snippet[:360])
            seen.add(key)
        if len(snippets) >= 3:
            break
    return " … ".join(snippets)


def meta_values(document, selectors):
    values = []
    for selector in selectors:
        values.extend(document.xpath(selector))
    return [clean(str(value)) for value in values if clean(str(value))]


def extract_html(payload):
    document = lxml_html.fromstring(payload)
    structured_dates = []
    for raw_json in document.xpath('//script[@type="application/ld+json"]/text()'):
        try:
            value = json.loads(raw_json)
            queue = value if isinstance(value, list) else [value]
            while queue:
                item = queue.pop(0)
                if isinstance(item, dict):
                    for key in ("datePublished", "dateCreated"):
                        if item.get(key):
                            structured_dates.append(clean(str(item[key])))
                    queue.extend(v for v in item.values() if isinstance(v, (dict, list)))
                elif isinstance(item, list):
                    queue.extend(item)
        except Exception:
            pass
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
        '//meta[@name="date" or @name="pubdate" or @name="parsely-pub-date" or @name="dc.date" or @name="citation_date"]/@content',
        '//meta[@name="citation_publication_date"]/@content',
        '//*[@itemprop="datePublished"]/@content',
        '//*[@itemprop="datePublished"]/@datetime',
        "//time/@datetime",
        "//time//text()",
    ])
    dates = structured_dates + dates
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
        return article, {"extraction_status": "no_public_url", "extracted_at": iso(timestamp), "date_enrichment_version": DATE_ENRICHMENT_VERSION}

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
                "date_enrichment_version": DATE_ENRICHMENT_VERSION,
            }
        except Exception as error:
            return article, {
                "extraction_status": "fetch_error", "extracted_at": iso(timestamp),
                "fetch_error": str(error)[:240], "retry_after": iso(timestamp + timedelta(days=7)),
                "date_enrichment_version": DATE_ENRICHMENT_VERSION,
            }

    common = {
        "extracted_at": iso(timestamp), "extracted_from_url": original_url, "resolved_url": resolved_url,
        "source_content_type": content_type, "http_status": http_status,
    }
    if len(payload) > MAX_BYTES:
        return article, {**common, "extraction_status": "too_large", "retry_after": iso(timestamp + timedelta(days=30)), "date_enrichment_version": DATE_ENRICHMENT_VERSION}

    try:
        if "pdf" in content_type or payload.startswith(b"%PDF") or payload.startswith(b"\n%PDF"):
            extracted = extract_pdf(payload)
        elif "html" in content_type or b"<html" in payload[:4096].lower() or b"<!doctype" in payload[:4096].lower():
            extracted = extract_html(payload)
        else:
            return article, {**common, "extraction_status": "unsupported_content_type", "retry_after": iso(timestamp + timedelta(days=30)), "date_enrichment_version": DATE_ENRICHMENT_VERSION}
    except Exception as error:
        return article, {
            **common, "extraction_status": "extraction_error", "fetch_error": str(error)[:240],
            "retry_after": iso(timestamp + timedelta(days=7)), "date_enrichment_version": DATE_ENRICHMENT_VERSION,
        }

    text = extracted["text"]
    if len(text) < 100:
        status = "thin_content_or_shell"
    else:
        status = "extracted"
    content_hash = hashlib.sha256(re.sub(r"[^\w]+", " ", text.lower()).encode("utf-8")).hexdigest() if len(text) >= 300 else ""
    structured_date = parse_date_token(extracted["published_date"]) if extracted["published_date"] else None
    body_date = publication_date_from_text(text)
    precision_rank = {"year": 1, "month": 2, "day": 3}
    if body_date and (not structured_date or precision_rank[body_date[1]] > precision_rank[structured_date[1]]):
        date_info, date_precision, date_evidence = body_date[0:2], body_date[1], body_date[2]
    else:
        date_info = structured_date or body_date
        date_precision = structured_date[1] if structured_date else (body_date[1] if body_date else None)
        date_evidence = extracted["published_date"][:180] if structured_date else (body_date[2] if body_date else None)
    fields = {
        **common,
        "extraction_status": status,
        "extraction_method": extracted["method"],
        "source_title": extracted["title"][:400],
        "source_description": extracted["description"][:1200],
        "source_authors": extracted["authors"][:8],
        "source_published_date": date_info[0] if date_info else extracted["published_date"][:100],
        "publication_date_precision": date_precision,
        "publication_date_evidence": date_evidence,
        "date_enrichment_version": DATE_ENRICHMENT_VERSION,
        "coffee_relevance_context": coffee_context(text),
        "content_char_count": len(text),
        "content_sha256": content_hash or None,
        "content_excerpt": text[:420],
        "fetch_error": None,
        "retry_after": None if status == "extracted" else iso(timestamp + timedelta(days=7)),
    }
    if not article.get("published_date") and date_info:
        fields["published_date"] = date_info[0]
    return article, fields


def should_fetch(article, now):
    status = article.get("extraction_status")
    fetched = article.get("extracted_at") or ""
    retry_after = article.get("retry_after") or ""
    if article.get("url") and article.get("extracted_from_url") and article.get("url") != article.get("extracted_from_url"):
        return True
    if not article.get("url"):
        return status != "no_public_url"
    # Revisit previously extracted pages when the date parser improves, so the
    # existing undated archive can be backfilled instead of staying stale.
    if int(article.get("date_enrichment_version") or 0) < DATE_ENRICHMENT_VERSION:
        return True
    if status == "extracted" and article.get("url") == article.get("extracted_from_url"):
        return False
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
        "date_enrichment_version": DATE_ENRICHMENT_VERSION,
        "purpose": "Fetch each original publisher URL for article metadata, a short searchable excerpt, and exact-content deduplication. Full article text is not republished.",
    }
    if isinstance(corpus.get("deduplication"), dict):
        corpus["deduplication"]["records_without_publication_date"] = sum(
            1 for article in articles if not (article.get("source_published_date") or article.get("published_date"))
        )
        corpus["deduplication"]["publication_date_precision_counts"] = {
            precision: sum(1 for article in articles if article.get("publication_date_precision") == precision)
            for precision in ("day", "month", "year")
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
