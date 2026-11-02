#!/usr/bin/env python3
"""Enumerate every HN story and comment that links to a YouTube video.

Algolia caps any one query at 1000 retrievable hits, so each query is split into
time windows that are halved until they fit. The crawl is resumable: finished
windows are logged, and a re-run skips them.

Output: data-raw/hn_mentions.jsonl with one record per HN item that has a video ID.
"""
import html
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data-raw"
RAW.mkdir(exist_ok=True)
OUT = RAW / "hn_mentions.jsonl"
DONE = RAW / "hn_windows_done.txt"

API = "https://hn.algolia.com/api/v1/search_by_date"
START = 1160000000  # Oct 2006, before HN launched
END = int(time.time())
QUERIES = [
    ("comment", "youtube.com"),
    ("comment", "youtu.be"),
    ("story", "youtube.com"),
    ("story", "youtu.be"),
]
FIELDS = (
    "objectID,comment_text,story_text,story_id,parent_id,author,created_at_i,"
    "points,num_comments,title,url,story_title,story_url"
)
# Video IDs are exactly 11 characters. The trailing guard stops a longer token
# from being truncated into a false ID.
VIDEO_RE = re.compile(
    r"(?:https?://)?(?:[a-z0-9-]+\.)?"
    r"(?:youtube\.com/(?:watch\?(?:[^\s\"'<>]*?&)?v=|embed/|v/|live/|shorts/)"
    r"|youtube-nocookie\.com/embed/|youtu\.be/)"
    r"([A-Za-z0-9_-]{11})(?![A-Za-z0-9_-])",
    re.I,
)
TAG_RE = re.compile(r"<[^>]+>")


def video_ids(text):
    if not text:
        return []
    seen = []
    for match in VIDEO_RE.finditer(html.unescape(text)):
        if match.group(1) not in seen:
            seen.append(match.group(1))
    return seen


def plain(text):
    text = html.unescape(TAG_RE.sub(" ", (text or "").replace("<p>", "\n")))
    return re.sub(r"[ \t]+", " ", text).strip()


def fetch(params):
    url = API + "?" + urllib.parse.urlencode(params)
    delay = 2
    for attempt in range(8):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "cogtube-research/0.1"})
            with urllib.request.urlopen(req, timeout=60) as resp:
                return json.load(resp)
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, ConnectionError) as err:
            print(f"retry {attempt}: {err}", file=sys.stderr, flush=True)
            time.sleep(delay)
            delay = min(delay * 2, 120)
    raise RuntimeError(f"giving up on {url}")


def params_for(tag, query, lo, hi, per_page):
    return {
        "query": query,
        "tags": tag,
        "hitsPerPage": per_page,
        "typoTolerance": "false",
        "numericFilters": f"created_at_i>={lo},created_at_i<{hi}",
        "attributesToRetrieve": FIELDS,
        "attributesToHighlight": "",
    }


def main():
    done = set(DONE.read_text().split()) if DONE.exists() else set()
    seen = set()
    if OUT.exists():
        with OUT.open() as handle:
            for line in handle:
                seen.add(json.loads(line)["id"])
    print(f"resuming: {len(done)} windows done, {len(seen)} items", flush=True)

    with OUT.open("a") as out, DONE.open("a") as log:
        for tag, query in QUERIES:
            stack = [(START, END)]
            fetched = 0
            while stack:
                lo, hi = stack.pop()
                key = f"{tag}|{query}|{lo}|{hi}"
                if key in done:
                    continue
                # A cheap count avoids downloading a window that must be split.
                count = fetch(params_for(tag, query, lo, hi, 0))["nbHits"]
                time.sleep(0.35)
                if count >= 1000 and hi - lo > 1:
                    mid = (lo + hi) // 2
                    stack += [(mid, hi), (lo, mid)]
                    continue
                result = fetch(params_for(tag, query, lo, hi, 1000)) if count else {"hits": []}
                hits = result["hits"]
                # The count can be an estimate, so a full page must also split.
                if len(hits) >= 1000 and hi - lo > 1:
                    mid = (lo + hi) // 2
                    stack += [(mid, hi), (lo, mid)]
                    continue
                for hit in hits:
                    item_id = hit["objectID"]
                    if item_id in seen:
                        continue
                    seen.add(item_id)
                    is_story = tag == "story"
                    body = hit.get("story_text") if is_story else hit.get("comment_text")
                    ids = video_ids(hit.get("url") if is_story else None) + video_ids(body)
                    ids = list(dict.fromkeys(ids))
                    if not ids:
                        continue
                    out.write(json.dumps({
                        "id": item_id,
                        "type": tag,
                        "videos": ids,
                        "is_link_post": bool(is_story and video_ids(hit.get("url"))),
                        "story_id": int(item_id) if is_story else hit.get("story_id"),
                        "author": hit.get("author"),
                        "t": hit.get("created_at_i"),
                        "points": hit.get("points"),
                        "num_comments": hit.get("num_comments"),
                        "story_title": hit.get("title") if is_story else hit.get("story_title"),
                        "story_url": hit.get("url") if is_story else hit.get("story_url"),
                        "text": plain(body)[:1800],
                    }, ensure_ascii=False) + "\n")
                fetched += len(hits)
                log.write(key + "\n")
                log.flush()
                out.flush()
                done.add(key)
                print(f"{tag}/{query} {time.strftime('%Y-%m', time.gmtime(lo))} "
                      f"+{len(hits)} total={fetched} items={len(seen)}", flush=True)
                time.sleep(0.35)
    print("CRAWL COMPLETE", flush=True)


if __name__ == "__main__":
    main()
