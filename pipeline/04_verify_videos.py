#!/usr/bin/env python3
"""Check each curated video against YouTube itself.

Reads pipeline/curated.txt and asks yt-dlp for real metadata. A video is kept only
if it is watchable by link, not age-gated, not live, and embeddable, and its real title contains
the fragment written down when it was picked.

Output: data-raw/video_meta.json, and a report on stdout. Results are cached, and a
failed lookup is retried on the next run.
"""
import json
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data-raw"
CACHE = RAW / "video_meta.json"


def option(name, default):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default


SOURCE = ROOT / option("--file", "pipeline/curated.txt")
# YouTube rate-limits bulk lookups, so a slower run can use one worker and a pause between requests.
WORKERS = int(option("--workers", "4"))
DELAY = float(option("--delay", "0"))


def load_curated():
    entries = []
    for number, line in enumerate(SOURCE.read_text().splitlines(), 1):
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        parts = [p.strip() for p in line.split("|")]
        if len(parts) != 3 or len(parts[0]) != 11:
            sys.exit(f"{SOURCE.name} line {number} is malformed: {line}")
        entries.append({"id": parts[0], "topics": parts[1].split(","), "expect": parts[2]})
    return entries


def fetch(video_id):
    time.sleep(DELAY)
    # The -- stops yt-dlp reading an ID that starts with a dash as an option.
    cmd = ["yt-dlp", "--skip-download", "-J", "--no-warnings", "--",
           f"https://www.youtube.com/watch?v={video_id}"]
    try:
        run = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
    except subprocess.TimeoutExpired:
        return video_id, {"error": "timeout"}
    if run.returncode != 0:
        return video_id, {"error": run.stderr.strip()[:400]}
    data = json.loads(run.stdout)
    return video_id, {
        "title": data.get("title"),
        "channel": data.get("channel") or data.get("uploader"),
        "duration": data.get("duration"),
        "uploaded": data.get("upload_date"),
        "embeddable": data.get("playable_in_embed"),
        "availability": data.get("availability"),
        "age_limit": data.get("age_limit"),
        "live_status": data.get("live_status"),
        "chapters": [
            {"t": int(c["start_time"]), "title": c["title"]}
            for c in (data.get("chapters") or [])
        ],
        "description": data.get("description") or "",
    }


def problems(entry, meta):
    issues = []
    if meta.get("error"):
        return [f"unavailable: {meta['error'][:150]}"]
    if entry["expect"].lower() not in (meta.get("title") or "").lower():
        issues.append(f"title mismatch, expected {entry['expect']!r}, got {meta.get('title')!r}")
    # Unlisted videos still play from a direct link, which is how HN shared them.
    if meta.get("availability") not in ("public", "unlisted", None):
        issues.append(f"availability={meta.get('availability')}")
    if meta.get("embeddable") is False:
        issues.append("embedding disabled")
    if meta.get("age_limit"):
        issues.append(f"age limit {meta.get('age_limit')}")
    if meta.get("live_status") not in ("not_live", "was_live", None):
        issues.append(f"live status {meta.get('live_status')}")
    if not meta.get("duration"):
        issues.append("no duration")
    return issues


def main():
    entries = load_curated()
    ids = [e["id"] for e in entries]
    duplicates = {i for i in ids if ids.count(i) > 1}
    if duplicates:
        sys.exit(f"duplicate ids in the list: {sorted(duplicates)}")

    qualified = json.loads((RAW / "qualified.json").read_text())
    missing = [i for i in ids if i not in qualified]
    if missing:
        print(f"NOT QUALIFIED ({len(missing)}): {missing}")

    cache = json.loads(CACHE.read_text()) if CACHE.exists() else {}
    todo = [i for i in ids if i not in cache or cache[i].get("error")]
    print(f"{len(ids)} curated, fetching {len(todo)}", flush=True)
    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        for count, (vid, meta) in enumerate(pool.map(fetch, todo), 1):
            cache[vid] = meta
            if count % 25 == 0:
                print(f"  {count}/{len(todo)}", flush=True)
                CACHE.write_text(json.dumps(cache))
    CACHE.write_text(json.dumps(cache))

    bad = 0
    for entry in entries:
        issues = problems(entry, cache[entry["id"]])
        if entry["id"] in missing:
            issues.append("did not clear the repetition bar")
        if issues:
            bad += 1
            print(f"PROBLEM {entry['id']} [{entry['expect']}]: {'; '.join(issues)}")
    print(f"{len(entries) - bad} ok, {bad} with problems")


if __name__ == "__main__":
    main()
