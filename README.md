# CogTube

A YouTube-style video library limited to videos that Hacker News and other quality communities keep recommending year after year, picked by hand to fit one person's interests.

## Run

```sh
npm start
```

Then open <http://localhost:4173>. It has no dependencies beyond Python 3. Opening `index.html` directly from disk won't work, because YouTube refuses to play embeds on `file://` pages.

Saved videos, history and playback positions stay in your browser's local storage.

## How the catalogue is built

The `#/about` page in the site explains the rules and limits, with live numbers. The pipeline runs in this order, and raw output goes to `data-raw/`, which isn't committed.

| Step | Script | What it does |
| --- | --- | --- |
| 1 | `pipeline/01_crawl_hn.py` | Finds every HN story and comment linking to YouTube, through Algolia |
| 2 | `pipeline/02_crawl_other.py` | Collects Lobsters, topic subreddits, Kottke and curated talk lists |
| 3 | `pipeline/03_candidates.py` | Applies the repetition bar and fetches titles for review |
| 4 | `pipeline/04_verify_videos.py` | Checks `curated.txt` against YouTube with `yt-dlp` |
| 5 | `pipeline/05_quote_candidates.py` | Pulls possible quotes from comments for human review |
| 6 | `pipeline/06_build.py` | Re-checks citations against HN's official API and writes `data.js` |

Run the scripts with `python3 -I pipeline/<script>`. Two files hold the human decisions:

- `pipeline/curated.txt` lists the chosen videos, their topics, and a title fragment that must match YouTube.
- `pipeline/quotes.txt` lists the quotes that were read and approved.

## Tests

```sh
export PLAYWRIGHT_PATH=/path/to/node_modules/playwright/index.mjs
node tests/site.test.mjs   # Site behaviour on desktop, tablet and phone
BROWSER_PATH=/usr/bin/brave-browser node tests/embeds.mjs   # Plays every video through the embed
```

`embeds.mjs` needs `BROWSER_PATH` to point at a browser with H.264. Playwright's bundled Chromium lacks it, so older uploads falsely fail there.
