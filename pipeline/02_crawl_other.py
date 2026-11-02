#!/usr/bin/env python3
"""Collect YouTube mentions from the other sources.

Lobsters, topic subreddits (through the Arctic Shift archive), Kottke's video tag,
and curated GitHub talk lists. Every record keeps a link back to where it came from.

Each source writes data-raw/other/<name>.jsonl and, only after finishing, a
<name>.done marker. Any request that keeps failing raises, so a partial crawl can't
pass as complete. The scoring step refuses to run without every marker.
"""
import html
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data-raw"
RAW.mkdir(exist_ok=True)
OTHER = RAW / "other"
OTHER.mkdir(exist_ok=True)
UA = "Mozilla/5.0 (X11; Linux x86_64) cogtube-research/0.1"

VIDEO_RE = re.compile(
    r"(?:youtube\.com/(?:watch\?(?:[^\s\"'<>)]*?&)?v=|embed/|v/|live/)"
    r"|youtube-nocookie\.com/embed/|youtu\.be/)"
    r"([A-Za-z0-9_-]{11})(?![A-Za-z0-9_-])",
    re.I,
)
# Expert or lecture-focused communities. Large subreddits such as r/MachineLearning are
# left out, because listing one in full takes hours through the archive.
SUBREDDITS = [
    "lectures", "cogsci", "neuroscience", "compmathneuro",
    "reinforcementlearning", "statistics",
]
LISTS = {
    "hellerve/programming-talks": "https://raw.githubusercontent.com/hellerve/programming-talks/master/README.md",
    "JanVanRyswyck/awesome-talks": "https://raw.githubusercontent.com/JanVanRyswyck/awesome-talks/master/README.md",
}
REPOS = {
    "hellerve/programming-talks": "https://github.com/hellerve/programming-talks",
    "JanVanRyswyck/awesome-talks": "https://github.com/JanVanRyswyck/awesome-talks",
}


class CrawlError(RuntimeError):
    pass


def get(url, allow_404=False):
    delay = 5
    last = None
    for _ in range(9):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=90) as resp:
                return resp.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as err:
            if err.code == 404 and allow_404:
                return None
            last = err
        except (urllib.error.URLError, TimeoutError, ConnectionError) as err:
            last = err
        print(f"retry in {delay}s {url}: {last}", file=sys.stderr, flush=True)
        time.sleep(delay)
        delay = min(delay * 2, 300)
    raise CrawlError(f"gave up on {url}: {last}")


def ids_in(text):
    return list(dict.fromkeys(m.group(1) for m in VIDEO_RE.finditer(html.unescape(text or ""))))


def epoch(iso):
    return int(datetime.fromisoformat(iso).timestamp())


def lobsters(write):
    for domain in ("youtube.com", "youtu.be"):
        page = 1
        while True:
            body = get(f"https://lobste.rs/domains/{domain}/page/{page}.json", allow_404=True)
            stories = json.loads(body) if body else []
            if not stories:
                break
            for story in stories:
                for vid in ids_in(story.get("url")):
                    write({
                        "source": "lobsters", "video": vid, "title": story["title"],
                        "link": story["comments_url"], "score": story["score"],
                        "comments": story["comment_count"], "t": epoch(story["created_at"]),
                    })
            if page % 25 == 0:
                print(f"lobsters {domain} page {page}", flush=True)
            page += 1
            time.sleep(3)
        print(f"lobsters {domain}: {page - 1} pages", flush=True)


def reddit(write):
    for sub in SUBREDDITS:
        marker = OTHER / f"reddit.{sub}.done"
        if marker.exists():
            continue
        after = None
        posts = kept = 0
        while True:
            params = {
                "subreddit": sub, "limit": "auto", "sort": "asc",
                "fields": "id,title,url,score,created_utc,num_comments",
            }
            if after:
                params["after"] = after
            body = get("https://arctic-shift.photon-reddit.com/api/posts/search?"
                       + urllib.parse.urlencode(params))
            payload = json.loads(body)
            if payload.get("error"):
                raise CrawlError(f"{sub}: {payload['error']}")
            data = payload.get("data") or []
            if not data:
                break
            for post in data:
                for vid in ids_in(post.get("url")):
                    write({
                        "source": f"r/{sub}", "video": vid, "title": post["title"],
                        "link": f"https://www.reddit.com/r/{sub}/comments/{post['id']}/",
                        "score": post["score"], "comments": post["num_comments"],
                        "t": int(post["created_utc"]),
                    })
                    kept += 1
            posts += len(data)
            newest = int(data[-1]["created_utc"])
            # "after" is exclusive at one-second precision. Posts sharing the final
            # second can be lost, so the cursor backs up one second and dedupe follows.
            after = newest if newest != after else newest + 1
            if posts % 20000 < len(data):
                print(f"reddit {sub}: {posts} posts", flush=True)
            time.sleep(0.5)
        marker.write_text("done")
        print(f"reddit {sub} complete: {posts} posts, {kept} YouTube links", flush=True)


def curated(write):
    for name, url in LISTS.items():
        body = get(url)
        heading = ""
        found = 0
        for line in body.splitlines():
            if line.startswith("#"):
                heading = line.lstrip("# ").strip()
            for vid in ids_in(line):
                label = re.search(r"\[([^\]]+)\]", line)
                write({
                    "source": name, "video": vid,
                    "title": label.group(1) if label else heading,
                    "link": REPOS[name], "score": None, "comments": None, "t": None,
                })
                found += 1
        print(f"list {name}: {found}", flush=True)


def kottke(write):
    page = 1
    empty = 0
    while empty < 3:
        path = "https://kottke.org/tag/video" + (f"/{page}" if page > 1 else "")
        body = get(path, allow_404=True)
        if body is None:
            break
        posts = re.split(r'<div class="post">', body)[1:]
        found = 0
        for post in posts:
            head = re.search(r'<h2><a href="(/\d\d/\d\d/[^"]+)">(.*?)</a></h2>', post, re.S)
            if not head:
                continue
            slug = re.match(r"/(\d\d)/(\d\d)/", head.group(1))
            when = datetime(2000 + int(slug.group(1)), int(slug.group(2)), 15)
            for vid in ids_in(post):
                write({
                    "source": "kottke", "video": vid,
                    "title": html.unescape(re.sub(r"<[^>]+>", "", head.group(2))).strip(),
                    "link": "https://kottke.org" + head.group(1),
                    "score": None, "comments": None, "t": int(when.timestamp()),
                })
                found += 1
        empty = empty + 1 if not posts else 0
        if page % 20 == 0:
            print(f"kottke page {page}, +{found}", flush=True)
        if 'class="page-nav"' not in body or f"/tag/video/{page + 1}" not in body:
            print(f"kottke ended at page {page}", flush=True)
            break
        page += 1
        time.sleep(1)


SECTIONS = {"curated": curated, "lobsters": lobsters, "reddit": reddit, "kottke": kottke}


def run(name):
    marker = OTHER / f"{name}.done"
    if marker.exists():
        print(f"{name}: already complete", flush=True)
        return True
    marker.unlink(missing_ok=True)
    try:
        # Reddit resumes by subreddit, so a restart must never truncate finished work.
        # Scoring dedupes any rows repeated by an interrupted subreddit.
        with (OTHER / f"{name}.jsonl").open("a" if name == "reddit" else "w") as handle:
            def write(record):
                handle.write(json.dumps(record, ensure_ascii=False) + "\n")
                handle.flush()
            SECTIONS[name](write)
    except Exception as err:  # Reported in the summary, and the marker stays absent.
        print(f"{name} FAILED: {err}", flush=True)
        return False
    marker.write_text(time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))
    print(f"{name} COMPLETE", flush=True)
    return True


def main():
    # Different hosts, so each source can run at its own polite pace in parallel.
    with ThreadPoolExecutor(max_workers=len(SECTIONS)) as pool:
        results = dict(zip(SECTIONS, pool.map(run, SECTIONS)))
    failed = [name for name, ok in results.items() if not ok]
    print(f"OTHER CRAWL {'INCOMPLETE: ' + ', '.join(failed) if failed else 'COMPLETE'}", flush=True)
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
