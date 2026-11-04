#!/usr/bin/env python3
"""Assemble data.js from the crawls, the curated list, and the approved quotes.

Every HN link shown on the site is re-fetched from HN's official Firebase API, which
is separate from the Algolia search used for crawling. An item is dropped if it was
deleted or doesn't actually contain the video ID. Quotes must also appear verbatim.

Output: data.js, plus a report on stdout. Exits non-zero if an invariant fails.
"""
import html
import json
import math
import re
import sys
import time
import urllib.error
import urllib.request
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data-raw"
ITEM_CACHE = RAW / "firebase_items.json"
MAX_COMMENT_THREADS = 14

TOPICS = [
    ("mind", "Mind & Perception",
     "Close to your saccade-suppression and O/Q search experiments, your reading on blindsight and binocular suppression, and books like Marr's Vision and Gödel, Escher, Bach."),
    ("brain", "Brain & Behavior",
     "For your brain atlas, your biological neuron models, your Dayan & Abbott reading, and the paper on how synapses self-assemble gradient learning."),
    ("stats", "Bayes, Stats & Models",
     "Stan, BayesFlow, simulation-based inference and information theory run through your coursework and projects, along with adaptive experiments, limits on phenotyping, and Bayesian Rationality on your shelf."),
    ("ml", "Neural Networks",
     "You read V-JEPA and transformer papers, ask about flow and diffusion models, and run your own activation-function experiments."),
    ("rl", "Learning Agents",
     "For DreamerV3, the reversal-task agents in your sbi-rnn project, and your own idea for an RL agent that minimizes policy complexity."),
    ("math", "Math, Visually",
     "For your Escher and Droste paper, your intuitionistic proofs and information theory notes, and your Grothendieck reading."),
    ("systems", "Systems & OS",
     "For your Xinu and OS class work, and the Linux digging you do on your own machines."),
    ("ideas", "Big Computing Ideas",
     "The talks programmers keep sending each other. Useful for someone who builds as many tools as you do."),
    ("research", "Doing Research",
     "How to choose problems, write, and speak, which are the working skills of your research."),
    ("games", "Game Dev & Simulation",
     "For the games you build, from the Over the Hill clone to Galactic Racer and your stick-figure shooter."),
    ("chess", "Chess & Tetris",
     "For Tactics Lab, your opening trainer, your chess-personality analysis, and the Meta-T Tetris experiment."),
    ("signals", "Signals, Sound & Music",
     "For your position-encoding work and Blind Positioning Lab, your guitar trainer and your keyboard piano."),
    ("history", "History",
     "For your world-history map, which asks what was happening everywhere at once."),
]

RULES = [
    "Linked on Hacker News in at least 3 different threads, by at least 3 different people, across at least 3 different calendar years.",
    "Or linked in at least 4 places across HN and the other sources, across at least 3 years, with at least 2 of those being HN threads.",
    "Reddit posts count only with a score of 10 or more, and Lobsters posts with a score of 3 or more.",
    "YouTube confirms the video is watchable by link, isn't age-restricted, and has a title matching what was picked.",
    "It actually played through this site's embedded player in a real browser. Four otherwise qualifying videos failed this and were removed.",
    "It was chosen by hand for depth: long or dense enough to be worth studying, from the people who did the work, and not already below your level.",
]
CAVEATS = [
    "A mention isn't always praise. The quotes shown were read one by one, but the counts include every link, so a few may be neutral or critical.",
    "Counts come from links to one specific upload. A talk re-uploaded under several IDs has its mentions split, so its true count is higher.",
    "Hacker News comments that discuss a video without linking to it aren't counted.",
    "Popularity is not accuracy. Recommended videos can still be wrong or dated, and several here argue contested positions.",
    "Numbers are a snapshot from the date above. Videos can still be removed from YouTube later, and the player shows a link if that happens.",
    "Reddit data comes from the Arctic Shift archive and covers r/lectures, r/cogsci, r/neuroscience, r/compmathneuro, r/reinforcementlearning and r/statistics. Larger subreddits such as r/MachineLearning were left out because a full listing takes hours. Kottke links are limited to posts carrying its video tag. MetaFilter was left out because it blocks automated access.",
]
INTEREST_NOTE = (
    "Your interests come from the memories, project list and conversation titles in your Claude export, plus your claude.ai "
    "artifact titles, the project folders on this machine, a few papers in them, and the opening messages of past Claude "
    "Code sessions. The bodies of your conversations weren't read through, and nothing from them is copied here. The topic "
    "notes are still an inference, so treat them as guesses. Some things you read about have no video that clears the bar: "
    "Marr, Dayan & Abbott, Nagel, Henrich, blindsight, face patches and flow matching. Those gaps were left empty rather "
    "than filled with less-recommended videos."
)

SOURCE_LABELS = {
    "lobsters": "Lobsters",
    "kottke": "Kottke.org",
    "hellerve/programming-talks": "programming-talks (GitHub)",
    "JanVanRyswyck/awesome-talks": "awesome-talks (GitHub)",
}


BOOKS_INTRO = (
    "Ten books away from being the most cracked person you know. Each book here is a path of long, dense talks and "
    "courses, in the order to take them, aimed at something you're building or trying to understand."
)


def load_books(by_id):
    """Parse pipeline/books.txt. A book is '@ id | title | goal', a '~ why' line, then 'video | note' lines."""
    books = []
    for number, raw in enumerate((ROOT / "pipeline" / "books.txt").read_text().splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("@"):
            parts = [p.strip() for p in line[1:].split("|")]
            if len(parts) != 3 or not all(parts):
                sys.exit(f"books.txt line {number}: book needs id | title | goal")
            books.append({"id": parts[0], "title": parts[1], "goal": parts[2], "why": "", "videos": [], "more": []})
        elif line.startswith("~"):
            if not books:
                sys.exit(f"books.txt line {number}: why before any book")
            books[-1]["why"] = line[1:].strip()
        elif line.startswith("+"):
            if not books:
                sys.exit(f"books.txt line {number}: link before any book")
            label, _, rest = (p.strip() for p in line[1:].partition("|"))
            url, _, note = (p.strip() for p in rest.partition("|"))
            if not (label and url.startswith("https://www.youtube.com/playlist?list=") and note):
                sys.exit(f"books.txt line {number}: link needs label | playlist url | note")
            books[-1]["more"].append({"label": label, "url": url, "note": note})
        else:
            if not books:
                sys.exit(f"books.txt line {number}: video before any book")
            vid, _, note = (p.strip() for p in line.partition("|"))
            if vid not in by_id:
                sys.exit(f"books.txt line {number}: {vid} is not in the catalogue")
            if not note:
                sys.exit(f"books.txt line {number}: {vid} needs a note")
            books[-1]["videos"].append({"id": vid, "note": note})
    ids = [b["id"] for b in books]
    assert len(ids) == len(set(ids)), "duplicate book ids"
    for b in books:
        assert b["why"], f"book {b['id']} has no why"
        assert len(b["videos"]) >= 3, f"book {b['id']} is too short"
        vids = [bv["id"] for bv in b["videos"]]
        assert len(vids) == len(set(vids)), f"book {b['id']} repeats a video"
    return books


def year(epoch):
    return datetime.fromtimestamp(epoch, timezone.utc).year


def fetch_item(item_id):
    url = f"https://hacker-news.firebaseio.com/v0/item/{item_id}.json"
    for attempt in range(6):
        try:
            with urllib.request.urlopen(url, timeout=30) as resp:
                return item_id, json.load(resp)
        except (urllib.error.URLError, TimeoutError, ConnectionError, json.JSONDecodeError):
            time.sleep(2 ** attempt)
    return item_id, "failed"


def plain(text):
    text = html.unescape(re.sub(r"<[^>]+>", " ", (text or "").replace("<p>", "\n")))
    return re.sub(r"[ \t]+", " ", text).strip()


def item_links_video(item, video):
    if not isinstance(item, dict) or item.get("deleted") or item.get("dead"):
        return False
    return video in html.unescape((item.get("url") or "") + " " + (item.get("text") or ""))


def trim_description(text, limit=600):
    text = text.strip()
    if len(text) <= limit:
        return text
    cut = text.rfind("\n", 0, limit)
    if cut < 120:
        cut = text.rfind(" ", 0, limit)
    return text[:cut].rstrip() + " …"


def main():
    curated = []
    for line in (ROOT / "pipeline" / "curated.txt").read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#"):
            parts = [p.strip() for p in line.split("|")]
            curated.append((parts[0], parts[1].split(",")))
    curated_ids = {vid for vid, _ in curated}
    known = {t[0] for t in TOPICS}
    for vid, topics in curated:
        if not set(topics) <= known:
            sys.exit(f"{vid} has an unknown topic: {topics}")

    cut = {line.split("|")[0].strip() for line in (ROOT / "pipeline" / "cut.txt").read_text().splitlines()
           if line.strip() and not line.startswith("#")}
    meta = json.loads((RAW / "video_meta.json").read_text())
    qualified = json.loads((RAW / "qualified.json").read_text())
    funnel = json.loads((RAW / "funnel.json").read_text())
    other = json.loads((RAW / "other_by_video.json").read_text())
    source_stats = json.loads((RAW / "source_stats.json").read_text())

    mentions = defaultdict(list)
    hn_total = 0
    with (RAW / "hn_mentions.jsonl").open() as handle:
        for line in handle:
            rec = json.loads(line)
            hn_total += 1
            for vid in rec["videos"]:
                if vid in curated_ids:
                    mentions[vid].append(rec)

    # Pick the evidence each video will show.
    evidence = {}
    wanted = set()
    for vid in curated_ids:
        recs = sorted(mentions[vid], key=lambda r: r["t"])
        links = sorted((r for r in recs if r["is_link_post"]),
                       key=lambda r: -(r.get("points") or 0))
        link_threads = {r["story_id"] for r in links}
        by_thread = {}
        for rec in recs:
            if rec["type"] == "comment" and rec["story_id"] not in link_threads:
                by_thread.setdefault(rec["story_id"], rec)
        comments = list(by_thread.values())
        # Sample evenly across the timeline, so the list shows the span of years.
        if len(comments) > MAX_COMMENT_THREADS:
            step = (len(comments) - 1) / (MAX_COMMENT_THREADS - 1)
            comments = [comments[round(i * step)] for i in range(MAX_COMMENT_THREADS)]
        evidence[vid] = links[:6] + comments
        wanted.update(r["id"] for r in evidence[vid])

    quote_lines = {}
    current = None
    for line in (RAW / "quote_candidates.txt").read_text().splitlines():
        if line.startswith("## "):
            current = line.split()[1]
        elif current:
            item_id, _, text = line.partition(" ")
            quote_lines[(current, item_id)] = text
    approved = []
    for line in (ROOT / "pipeline" / "quotes.txt").read_text().splitlines():
        if line.strip() and not line.startswith("#"):
            vid, item_id = line.split()
            if vid not in curated_ids:
                sys.exit(f"quotes.txt: {vid} is not curated")
            if (vid, item_id) not in quote_lines:
                sys.exit(f"quotes.txt: no candidate for {vid} {item_id}")
            approved.append((vid, item_id))
            wanted.add(item_id)

    # Independent verification against the official API, cached between runs.
    cache = json.loads(ITEM_CACHE.read_text()) if ITEM_CACHE.exists() else {}
    todo = [i for i in wanted if i not in cache or cache[i] == "failed"]
    print(f"verifying {len(wanted)} HN items, fetching {len(todo)}", flush=True)
    with ThreadPoolExecutor(max_workers=12) as pool:
        for count, (item_id, item) in enumerate(pool.map(fetch_item, todo), 1):
            cache[item_id] = item
            if count % 1000 == 0:
                print(f"  {count}/{len(todo)}", flush=True)
                ITEM_CACHE.write_text(json.dumps(cache))
    ITEM_CACHE.write_text(json.dumps(cache))
    unreachable = [i for i in wanted if cache.get(i) == "failed"]
    if unreachable:
        sys.exit(f"{len(unreachable)} HN items could not be fetched; rerun the build")

    quotes = defaultdict(list)
    rejected_quotes = []
    for vid, item_id in approved:
        item = cache[item_id]
        text = quote_lines[(vid, item_id)]
        if not item_links_video(item, vid) or text not in plain(item.get("text")):
            rejected_quotes.append((vid, item_id, text[:60]))
            continue
        quotes[vid].append({
            "text": text, "author": item.get("by"), "t": item.get("time"),
            "link": f"https://news.ycombinator.com/item?id={item_id}",
        })

    videos = []
    dropped_items = 0
    excluded = []
    for vid, topics in curated:
        if vid in cut:
            continue
        m = meta[vid]
        if m.get("error") or m.get("embeddable") is False or m.get("age_limit") or not m.get("duration"):
            excluded.append((vid, m.get("error") or "not playable"))
            continue
        if vid not in qualified:
            excluded.append((vid, "did not clear the bar"))
            continue
        recs = mentions[vid]
        threads = {r["story_id"] for r in recs if r.get("story_id")}
        authors = {r["author"] for r in recs if r.get("author")}
        by_year_threads = defaultdict(set)
        for rec in recs:
            by_year_threads[year(rec["t"])].add(rec["story_id"])
        by_year = {y: len(s) for y, s in by_year_threads.items()}
        points = sum(r.get("points") or 0 for r in recs if r["is_link_post"])

        others = other.get(vid, [])
        for rec in others:
            if rec.get("t"):
                y = year(rec["t"])
                by_year[y] = by_year.get(y, 0) + 1

        listed = []
        hn_listed = 0
        for rec in evidence[vid]:
            item = cache.get(rec["id"])
            if not item_links_video(item, vid):
                dropped_items += 1
                continue
            hn_listed += 1
            is_link = rec["is_link_post"]
            note = (f"{rec.get('points') or 0} points, {rec.get('num_comments') or 0} comments"
                    if is_link else f"comment by {rec.get('author')}")
            listed.append({
                "t": rec["t"], "title": rec.get("story_title") or "Hacker News discussion",
                "link": f"https://news.ycombinator.com/item?id={rec['id']}",
                "source": "Hacker News", "note": note,
            })
        for rec in others:
            name = rec["source"]
            note = f"score {rec['score']}" if rec.get("score") is not None else ""
            listed.append({
                "t": rec.get("t"), "title": rec.get("title") or name, "link": rec["link"],
                "source": SOURCE_LABELS.get(name, name), "note": note,
            })
        listed.sort(key=lambda e: (e["t"] is None, e["t"] or 0))

        years = sorted(by_year)
        rank = len(threads) + 3 * len(years) + 2 * len(others) + 2 * math.log2(1 + points)
        description = trim_description(m.get("description") or "")
        videos.append({
            "id": vid, "title": m["title"], "channel": m["channel"], "duration": m["duration"],
            "uploaded": m.get("uploaded") or "", "topics": topics,
            "hn": {"threads": len(threads), "authors": len(authors), "points": points, "items": len(recs)},
            "otherCount": len(others), "byYear": {str(y): by_year[y] for y in years},
            "yearCount": len(years), "firstYear": years[0], "lastYear": years[-1],
            "rank": round(rank, 2), "quotes": quotes.get(vid, []), "threads": listed,
            "hnThreadsListed": hn_listed,
            "chapters": [c for c in m.get("chapters", []) if c["t"] < m["duration"]][:60],
            "description": description, "keywords": description[:400],
        })

    videos.sort(key=lambda v: -v["rank"])
    all_years = [y for v in videos for y in (v["firstYear"], v["lastYear"])]
    now = datetime.now().astimezone()
    books = load_books({v["id"]: v for v in videos})
    payload = {
        "books": books,
        "topics": [{"id": t[0], "label": t[1], "why": t[2]} for t in TOPICS],
        "stats": {
            "generatedDate": now.strftime("%B %-d, %Y"), "firstYear": min(all_years),
            "lastYear": max(max(all_years), now.year), "hnItems": hn_total,
            "distinctVideos": funnel["distinct_videos"], "qualified": funnel["qualified"],
            "cutCount": len(cut), "rules": RULES, "caveats": CAVEATS, "interestNote": INTEREST_NOTE, "booksIntro": BOOKS_INTRO,
            "sources": source_stats,
        },
        "videos": videos,
    }

    # Invariants that must hold before the file is written.
    ids = [v["id"] for v in videos]
    assert len(ids) == len(set(ids)), "duplicate videos"
    assert all(re.fullmatch(r"[A-Za-z0-9_-]{11}", v["id"]) for v in videos), "bad id"
    assert all(v["title"] and v["channel"] and v["duration"] > 0 for v in videos), "missing metadata"
    assert all(v["topics"] for v in videos), "video without topic"
    for topic in TOPICS:
        assert any(topic[0] in v["topics"] for v in videos), f"empty topic {topic[0]}"
    for v in videos:
        for entry in v["threads"] + v["quotes"]:
            assert entry["link"].startswith("https://"), f"bad link for {v['id']}"

    (ROOT / "data.js").write_text(
        "window.COGTUBE=" + json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + ";\n")
    print(f"videos: {len(videos)}, excluded: {excluded}")
    print(f"evidence items dropped after verification: {dropped_items}")
    print(f"quotes kept: {sum(len(q) for q in quotes.values())}, rejected: {rejected_quotes}")
    for topic in TOPICS:
        print(f"  {topic[0]}: {sum(1 for v in videos if topic[0] in v['topics'])}")
    print(f"data.js: {(ROOT / 'data.js').stat().st_size / 1e6:.2f} MB")


if __name__ == "__main__":
    main()
