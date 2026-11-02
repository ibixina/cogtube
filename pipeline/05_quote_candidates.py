#!/usr/bin/env python3
"""Pull sentences from HN comments that may recommend a curated video, for human review.

Only comments that link to exactly one video are used, so the praise can't be about a
different link. Sentences are copied verbatim, and a person picks which ones are real
recommendations by recording them in pipeline/quotes.txt.

Output: data-raw/quote_candidates.txt
"""
import json
import re
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data-raw"

PRAISE = re.compile(
    r"\b(recommend\w*|must[- ]watch|must[- ]see|favou?rite|one of the best|the best (talk|lecture|video|explanation|"
    r"intro\w*|presentation|thing)|(great|excellent|fantastic|brilliant|wonderful|amazing|superb|incredible|"
    r"beautiful|awesome|fascinating|classic|terrific|enlightening|mind[- ]blowing) "
    r"(talk|lecture|video|explanation|intro\w*|presentation|series|course|overview|demo|documentary|keynote|"
    r"discussion|interview|example|visuali[sz]ation|illustration|description|summary|resource|channel)|"
    r"changed (how|the way|my)|re-?watch\w*|watch(ed)? (it|this) (every|multiple|several|many|again)|"
    r"worth (watching|your time|the time|every)|blew my mind|best explanation|really (good|great) (talk|lecture|video))\b",
    re.I,
)
NEGATIVE = re.compile(
    r"\b(not recommend|don'?t recommend|wouldn'?t recommend|worst|terrible|overrated|awful|misleading|"
    r"disagree|debunk\w*|nonsense|garbage|hate|sucks?|not (great|good|worth)|isn'?t (great|good|worth))\b", re.I)
SELF = re.compile(r"\b(my (own |recent |latest )?(talk|video|lecture|channel|presentation|course)|i (made|gave|recorded|created|filmed|presented)|we (made|gave)|our (talk|video))\b", re.I)
URLISH = re.compile(r"https?://|www\.|youtu|\.com|\[\d+\]", re.I)


def sentences(text):
    for block in text.split("\n"):
        for sentence in re.split(r"(?<=[.!?])\s+", block.strip()):
            yield sentence.strip()


def main():
    curated = set()
    for line in (ROOT / "pipeline" / "curated.txt").read_text().splitlines():
        if line.strip() and not line.startswith("#"):
            curated.add(line.split("|")[0].strip())
    meta = json.loads((RAW / "video_meta.json").read_text())
    found = defaultdict(list)
    with (RAW / "hn_mentions.jsonl").open() as handle:
        for line in handle:
            rec = json.loads(line)
            if rec["type"] != "comment" or len(rec["videos"]) != 1 or rec["videos"][0] not in curated:
                continue
            text = rec["text"]
            if SELF.search(text):
                continue
            for sentence in sentences(text):
                if not 25 <= len(sentence) <= 240 or URLISH.search(sentence) or sentence.startswith(">"):
                    continue
                if PRAISE.search(sentence) and not NEGATIVE.search(sentence):
                    found[rec["videos"][0]].append((rec["id"], rec["author"], rec["t"], sentence))

    with (RAW / "quote_candidates.txt").open("w") as out:
        for vid in curated:
            items = found.get(vid, [])
            # Keep authors distinct and spread across time.
            items.sort(key=lambda it: it[2])
            seen = set()
            kept = []
            for item in items:
                if item[1] not in seen:
                    seen.add(item[1])
                    kept.append(item)
            step = max(1, len(kept) // 5)
            out.write(f"## {vid} {meta[vid].get('title', '')[:70]}\n")
            for item in kept[::step][:5]:
                out.write(f"{item[0]} {item[3]}\n")
    print(f"{len(found)} of {len(curated)} videos have candidate quotes")


if __name__ == "__main__":
    main()
