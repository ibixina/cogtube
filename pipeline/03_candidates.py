#!/usr/bin/env python3
"""Score every mentioned video, apply the repetition bar, and fetch candidate titles.

Input:  data-raw/hn_mentions.jsonl, data-raw/other_mentions.jsonl
Output: data-raw/qualified.json     all videos clearing the bar, with their counts
        data-raw/titles.json        oEmbed title and channel, or the failure status
"""
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data-raw"

# The bar: different threads, different people, different years.
MIN_THREADS = 3
MIN_AUTHORS = 3
MIN_YEARS = 3
# Route for videos that are repeatedly shared in other communities too.
MIN_COMBINED_PLACES = 4
MIN_COMBINED_YEARS = 3
MIN_REDDIT_SCORE = 10
MIN_LOBSTERS_SCORE = 3
OTHER_SOURCES = ["curated", "lobsters", "reddit", "kottke"]


def year(epoch):
    return datetime.fromtimestamp(epoch, timezone.utc).year


def aggregate():
    videos = defaultdict(lambda: {
        "threads": set(), "authors": set(), "years": set(), "items": 0, "points": 0,
        "link_posts": 0, "other": [], "other_years": set(),
    })
    with (RAW / "hn_mentions.jsonl").open() as handle:
        for line in handle:
            rec = json.loads(line)
            for vid in rec["videos"]:
                v = videos[vid]
                v["items"] += 1
                if rec.get("story_id"):
                    v["threads"].add(rec["story_id"])
                if rec.get("author"):
                    v["authors"].add(rec["author"])
                if rec.get("t"):
                    v["years"].add(year(rec["t"]))
                if rec.get("is_link_post"):
                    v["link_posts"] += 1
                    v["points"] += rec.get("points") or 0

    seen = set()
    for name in OTHER_SOURCES:
        if not (RAW / "other" / f"{name}.done").exists() and "--allow-partial" not in sys.argv:
            sys.exit(f"{name} crawl is not complete; refusing to score partial data")
        path = RAW / "other" / f"{name}.jsonl"
        if not path.exists():
            continue
        with path.open() as handle:
            for line in handle:
                rec = json.loads(line)
                key = (rec["video"], rec["link"])
                if key in seen:
                    continue
                seen.add(key)
                # A low-scoring Reddit post isn't a recommendation.
                if rec["source"].startswith("r/") and (rec.get("score") or 0) < MIN_REDDIT_SCORE:
                    continue
                if rec["source"] == "lobsters" and (rec.get("score") or 0) < MIN_LOBSTERS_SCORE:
                    continue
                v = videos[rec["video"]]
                v["other"].append(rec)
                if rec.get("t"):
                    v["other_years"].add(year(rec["t"]))
    return videos


def qualifies(v):
    hn = (len(v["threads"]) >= MIN_THREADS and len(v["authors"]) >= MIN_AUTHORS
          and len(v["years"]) >= MIN_YEARS)
    if hn:
        return "hn"
    places = len(v["threads"]) + len(v["other"])
    years = len(v["years"] | v["other_years"])
    # The HN floor stops a single active subreddit from carrying a video alone.
    if places >= MIN_COMBINED_PLACES and years >= MIN_COMBINED_YEARS and len(v["threads"]) >= 2:
        return "combined"
    return None


def oembed(vid):
    url = ("https://www.youtube.com/oembed?format=json&url="
           + urllib.parse.quote(f"https://www.youtube.com/watch?v={vid}", safe=""))
    for attempt in range(4):
        try:
            with urllib.request.urlopen(url, timeout=30) as resp:
                data = json.load(resp)
            return vid, {"title": data.get("title"), "channel": data.get("author_name"), "status": 200}
        except urllib.error.HTTPError as err:
            if err.code in (400, 401, 403, 404):
                return vid, {"status": err.code}
            time.sleep(2 ** attempt)
        except (urllib.error.URLError, TimeoutError, ConnectionError, json.JSONDecodeError):
            time.sleep(2 ** attempt)
    return vid, {"status": "failed"}


def main():
    videos = aggregate()
    print(f"distinct videos: {len(videos)}", flush=True)
    qualified = {}
    for vid, v in videos.items():
        route = qualifies(v)
        if route:
            qualified[vid] = {
                "route": route, "threads": len(v["threads"]), "authors": len(v["authors"]),
                "years": sorted(v["years"]), "items": v["items"], "points": v["points"],
                "link_posts": v["link_posts"], "other": len(v["other"]),
                "other_sources": sorted({o["source"] for o in v["other"]}),
                "other_years": sorted(v["other_years"]),
            }
    counts = defaultdict(int)
    for q in qualified.values():
        counts[q["route"]] += 1
    print(f"qualified: {len(qualified)} {dict(counts)}", flush=True)
    (RAW / "qualified.json").write_text(json.dumps(qualified))
    (RAW / "other_by_video.json").write_text(json.dumps(
        {vid: v["other"] for vid, v in videos.items() if vid in qualified and v["other"]}))

    # Per-source totals for the site's methodology page.
    hn_items = 0
    hn_videos = set()
    with (RAW / "hn_mentions.jsonl").open() as handle:
        for line in handle:
            rec = json.loads(line)
            hn_items += 1
            hn_videos.update(rec["videos"])
    tally = defaultdict(lambda: [0, set()])
    for vid, v in videos.items():
        for rec in v["other"]:
            group = "Reddit topic subreddits" if rec["source"].startswith("r/") else rec["source"]
            tally[group][0] += 1
            tally[group][1].add(vid)
    labels = {
        "lobsters": "Lobsters", "kottke": "Kottke.org",
        "hellerve/programming-talks": "programming-talks (GitHub)",
        "JanVanRyswyck/awesome-talks": "awesome-talks (GitHub)",
    }
    rows = [{"label": "Hacker News", "mentions": hn_items, "videos": len(hn_videos)}]
    rows += [{"label": labels.get(name, name), "mentions": n, "videos": len(vids)}
             for name, (n, vids) in sorted(tally.items(), key=lambda kv: -kv[1][0])]
    (RAW / "source_stats.json").write_text(json.dumps(rows))
    (RAW / "funnel.json").write_text(json.dumps({
        "distinct_videos": len(videos), "qualified": len(qualified), "routes": dict(counts),
    }))

    title_path = RAW / "titles.json"
    titles = json.loads(title_path.read_text()) if title_path.exists() else {}
    todo = [vid for vid in qualified if titles.get(vid, {}).get("status") not in (200, 400, 401, 403, 404)]
    print(f"fetching {len(todo)} titles", flush=True)
    with ThreadPoolExecutor(max_workers=6) as pool:
        for index, (vid, info) in enumerate(pool.map(oembed, todo), 1):
            titles[vid] = info
            if index % 250 == 0:
                print(f"titles {index}/{len(todo)}", flush=True)
                title_path.write_text(json.dumps(titles))
    title_path.write_text(json.dumps(titles))
    statuses = defaultdict(int)
    for info in titles.values():
        statuses[str(info.get("status"))] += 1
    print(f"oembed statuses: {dict(statuses)}", flush=True)
    print("DONE", flush=True)


if __name__ == "__main__":
    main()
