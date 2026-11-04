// End-to-end checks in a real browser. Run: PLAYWRIGHT_PATH=... node tests/site.test.mjs [shot-dir]
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const { chromium } = await import(process.env.PLAYWRIGHT_PATH || 'playwright');
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = process.argv[2] || join(ROOT, 'tests', 'shots');
mkdirSync(SHOTS, { recursive: true });
const PORT = 4199;
const BASE = `http://127.0.0.1:${PORT}/`;

const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
await new Promise((resolve) => setTimeout(resolve, 900));

let passed = 0;
const failures = [];
function check(name, ok, detail = '') {
  if (ok) { passed += 1; } else { failures.push(`${name}${detail ? `: ${detail}` : ''}`); console.log(`FAIL ${name} ${detail}`); }
}

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });

async function open(viewport = { width: 1440, height: 900 }, scheme = 'dark') {
  const context = await browser.newContext({ viewport, colorScheme: scheme, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await context.newPage();
  page.problems = [];
  page.on('pageerror', (e) => page.problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    // YouTube's own frames log noise, so only messages from this site count.
    if (m.type() === 'error' && (m.location().url || '').startsWith(BASE)) page.problems.push(`console: ${m.text()}`);
  });
  page.on('requestfailed', (r) => {
    if (r.url().startsWith(BASE)) page.problems.push(`request failed: ${r.url()}`);
  });
  page.on('response', (r) => {
    if (r.url().startsWith(BASE) && r.status() >= 400) page.problems.push(`${r.status()}: ${r.url()}`);
  });
  await page.goto(BASE);
  await page.waitForSelector('.shelf');
  return page;
}
const go = async (page, hash) => {
  await page.evaluate((h) => { location.hash = h; }, hash);
  await page.waitForTimeout(160);
};

const page = await open();
// A stripped Referer is what makes YouTube fail with error 153, so check the real header.
const embedReferers = [];
page.on('request', (r) => {
  if (r.url().includes('youtube-nocookie.com/embed/')) embedReferers.push(r.headers().referer);
});
const data = await page.evaluate(() => window.COGTUBE);
const videos = data.videos;

/* ---------- Data ---------- */
check('catalogue is non-trivial', videos.length > 120, String(videos.length));
check('every video has a working watch record', videos.every((v) => /^[\w-]{11}$/.test(v.id) && v.title && v.channel && v.duration > 0));
check('every topic id is defined', videos.every((v) => v.topics.every((t) => data.topics.some((x) => x.id === t))));
check('every video has evidence', videos.every((v) => v.threads.length > 0));
check('every video spans 3+ years', videos.every((v) => v.yearCount >= 3), videos.filter((v) => v.yearCount < 3).map((v) => v.id).join());
check('year span agrees with its counts', videos.every((v) => {
  const ys = Object.keys(v.byYear).map(Number);
  return ys.length === v.yearCount && Math.min(...ys) === v.firstYear && Math.max(...ys) === v.lastYear;
}));
check('no future years', videos.every((v) => v.lastYear <= new Date().getFullYear()));
check('all links are https', videos.every((v) => [...v.threads, ...v.quotes].every((e) => e.link.startsWith('https://'))));
check('quotes are attributed', videos.every((v) => v.quotes.every((q) => q.text && q.author && q.t)));

/* ---------- Home ---------- */
check('title on home', (await page.title()) === 'CogTube');
// The home page gives books first claim on a video, then each topic shelf its leftovers.
const claimed = new Set(data.books.flatMap((b) => b.videos.map((bv) => bv.id)));
const byRank = [...videos].sort((a, b) => b.rank - a.rank);
let expectedShelves = 1;
for (const t of data.topics) {
  const primary = byRank.filter((v) => v.topics[0] === t.id && !claimed.has(v.id));
  const secondary = byRank.filter((v) => v.topics[0] !== t.id && v.topics.includes(t.id) && !claimed.has(v.id));
  const items = [...primary, ...secondary].slice(0, 8);
  items.forEach((v) => claimed.add(v.id));
  if (items.length) expectedShelves += 1;
}
check('books shelf plus a shelf per topic that has videos left', (await page.locator('.shelf').count()) === expectedShelves, `${await page.locator('.shelf').count()} vs ${expectedShelves}`);
check('there are ten books', data.books.length === 10, String(data.books.length));
check('every book has a goal, a why and 3+ parts in the catalogue', data.books.every((b) => b.goal && b.why && b.videos.length >= 3
  && b.videos.every((bv) => bv.note && videos.some((v) => v.id === bv.id))));
check('no video appears twice in one book', data.books.every((b) => new Set(b.videos.map((v) => v.id)).size === b.videos.length));
check('home shows every book', (await page.locator('.shelf .book').count()) === data.books.length);
await page.screenshot({ path: join(SHOTS, 'home-dark.png') });
const firstCardTitle = await page.locator('.shelf .card-title').first().innerText();
check('first shelf shows real title', videos.some((v) => v.title.replace(/\s+/g, ' ').trim() === firstCardTitle.replace(/\s+/g, ' ').trim()), firstCardTitle);

const homeIds = await page.locator('.shelf .card-title').evaluateAll((els) => els.map((e) => e.getAttribute('href')));
check('no video repeats across home shelves', new Set(homeIds).size === homeIds.length, `${homeIds.length - new Set(homeIds).size} repeats`);

/* ---------- Books ---------- */
for (const [i, b] of data.books.entries()) {
  await go(page, `#/book/${b.id}`);
  check(`book ${b.id} lists its parts in order`, JSON.stringify(await page.locator('.parts .card-title').evaluateAll((els) => els.map((e) => e.getAttribute('href').split('?')[0].split('/').pop())))
    === JSON.stringify(b.videos.map((v) => v.id)));
  check(`book ${b.id} heading`, (await page.locator('h1').innerText()) === b.title);
  check(`book ${b.id} parts keep the book context`, (await page.locator('.parts .card-title').first().getAttribute('href')).includes(`?book=${b.id}`));
  check(`book ${b.id} shows a note per part`, (await page.locator('.parts .card-why').count()) === b.videos.length);
}
await go(page, '#/books');
check('books page lists all ten', (await page.locator('.books.big .book').count()) === data.books.length);
{
  const b = data.books[0];
  await go(page, `#/watch/${b.videos[1].id}?book=${b.id}`);
  await page.waitForSelector('#yt-frame');
  const strip = await page.locator('.book-strip').innerText();
  check('watch strip names the part', strip.includes(`Part 2 of ${b.videos.length}`), strip);
  await page.locator('.book-strip a.primary').click();
  await page.waitForTimeout(250);
  check('next part goes to the following video', (await page.evaluate(() => location.hash)).includes(b.videos[2].id));
  await go(page, `#/watch/${b.videos.at(-1).id}?book=${b.id}`);
  check('last part has no next button', (await page.locator('.book-strip a.primary').count()) === 0);
  await go(page, `#/watch/${b.videos[0].id}?book=${b.id}`);
  check('first part has no previous button', (await page.locator('.book-strip a:has-text("Previous")').count()) === 0);
  await go(page, '#/book/nonsense');
  check('unknown book is handled', (await page.locator('#main').innerText()).includes('does not exist'));
}

/* ---------- Every route renders cleanly ---------- */
for (const t of data.topics) {
  await go(page, `#/topic/${t.id}`);
  const expected = videos.filter((v) => v.topics.includes(t.id)).length;
  const shown = await page.locator('.grid .card').count();
  check(`topic ${t.id} shows all videos`, shown === expected, `${shown} vs ${expected}`);
  check(`topic ${t.id} heading`, (await page.locator('h1').innerText()) === t.label);
}
for (const hash of ['#/all', '#/books', '#/later', '#/history', '#/about', '#/nonsense', '#/topic/nope', '#/watch/doesnotexist']) {
  await go(page, hash);
  check(`route ${hash} has content`, (await page.locator('#main').innerText()).trim().length > 5);
}
await go(page, '#/watch/doesnotexist');
check('unknown video is handled', (await page.locator('#main').innerText()).includes('not in the catalogue'));
check('unknown video mounts no player', (await page.locator('iframe').count()) === 0);

/* ---------- All page: filters and sorting ---------- */
await go(page, '#/all');
check('all page lists everything', (await page.locator('.grid .card').count()) === videos.length);
await page.click('[data-length="short"]');
await page.waitForTimeout(100);
const shortCount = videos.filter((v) => v.duration < 1200).length;
check('short filter count', (await page.locator('.grid .card').count()) === shortCount);
await page.click('[data-length="long"]');
await page.waitForTimeout(100);
check('long filter count', (await page.locator('.grid .card').count()) === videos.filter((v) => v.duration > 3600).length);
await page.click('[data-length="any"]');
await page.selectOption('#sort', 'short');
await page.waitForTimeout(100);
const shortest = [...videos].sort((a, b) => a.duration - b.duration)[0];
check('sort by shortest', (await page.locator('.grid .card-title').first().innerText()).trim() === shortest.title.replace(/\s+/g, ' ').trim());
await page.selectOption('#sort', 'recommended');
await page.waitForTimeout(100);

/* ---------- Search ---------- */
await page.keyboard.press('/');
check('slash focuses search', await page.evaluate(() => document.activeElement.id === 'q'));
await page.keyboard.type('sapolsky');
await page.waitForTimeout(100);
check('suggestions appear', (await page.locator('#suggest li').count()) > 0);
await page.screenshot({ path: join(SHOTS, 'search-suggest.png') });
await page.keyboard.press('Enter');
await page.waitForTimeout(160);
check('search route', (await page.evaluate(() => location.hash)).startsWith('#/search/sapolsky'));
const sapolsky = await page.locator('.grid .card-title').allInnerTexts();
check('search finds Sapolsky', sapolsky.length >= 3 && sapolsky.some((t) => /sapolsky/i.test(t)), String(sapolsky.length));
await go(page, `#/search/${encodeURIComponent('zzzqqqnotathing')}`);
check('empty search message', (await page.locator('.empty').innerText()).includes('No videos match'));

// Hostile input must render as text and never execute.
await page.evaluate(() => { window.__pwned = false; });
await go(page, `#/search/${encodeURIComponent('<img src=x onerror="window.__pwned=true">')}`);
await page.waitForTimeout(250);
check('search escapes HTML', !(await page.evaluate(() => window.__pwned)));
check('no injected image', (await page.locator('#main img[src="x"]').count()) === 0);

/* ---------- Watch page ---------- */
const target = videos.find((v) => v.quotes.length && v.chapters.length) || videos[0];
await go(page, `#/watch/${target.id}`);
await page.waitForSelector('#yt-frame');
const frame = await page.evaluate(() => {
  const f = document.querySelector('#yt-frame');
  return { src: f.src, referrer: f.getAttribute('referrerpolicy'), full: f.allowFullscreen };
});
check('embed uses the right video', frame.src.includes(`/embed/${target.id}?`), frame.src);
check('embed uses privacy mode', frame.src.startsWith('https://www.youtube-nocookie.com/'));
check('embed keeps the referrer', frame.referrer === 'strict-origin-when-cross-origin');
check('embed sends origin', frame.src.includes('origin='));
check('embed request carries a Referer header', embedReferers.at(-1) === BASE, String(embedReferers.at(-1)));
check('page title names video', (await page.title()).startsWith(target.title.slice(0, 20)));
check('watch title correct', (await page.locator('.watch-title').innerText()).trim() === target.title.replace(/\s+/g, ' ').trim());
check('quote displayed', (await page.locator('.quote').count()) === target.quotes.length);
check('chapters displayed', (await page.locator('.chapter').count()) === target.chapters.length);
check('up next excludes current', (await page.locator(`.watch-side a[href="#/watch/${target.id}"]`).count()) === 0);
check('up next populated', (await page.locator('.watch-side .card').count()) > 5);
await page.locator('details.evidence summary').click();
const evidenceLinks = await page.locator('.evidence-list a').count();
check('evidence listed', evidenceLinks >= Math.min(target.threads.length, 1));
await page.waitForTimeout(1500);
await page.screenshot({ path: join(SHOTS, 'watch-dark.png'), fullPage: false });

// Every external link opens safely.
const unsafe = await page.evaluate(() => [...document.querySelectorAll('a[target="_blank"]')]
  .filter((a) => !a.rel.includes('noopener')).length);
check('external links use noopener', unsafe === 0);

/* ---------- Library ---------- */
await page.keyboard.press('Escape');
await page.locator('.actions [data-save]').click();
check('save toggles pressed', (await page.locator('.actions [data-save]').getAttribute('aria-pressed')) === 'true');
await page.waitForTimeout(100);
check('sidebar count updates', (await page.locator('.nav-item[href="#/later"] .count').innerText()) === '1');
await page.reload();
await page.waitForSelector('#yt-frame');
await go(page, '#/later');
check('saved survives reload', (await page.locator('.grid .card').count()) === 1);
check('saved video is right one', (await page.locator(`.grid a[href="#/watch/${target.id}"]`).count()) > 0);
await page.locator('.grid .card').first().hover();
await page.locator('.grid .save').first().click();
await page.waitForTimeout(120);
check('unsave empties list', (await page.locator('.empty').count()) === 1);
await go(page, '#/history');
check('history records the video', (await page.locator(`.grid a[href="#/watch/${target.id}"]`).count()) > 0);
await page.click('#clear-history');
await page.waitForTimeout(120);
check('history clears', (await page.locator('.empty').count()) === 1);

// A corrupt store must not break the app.
await go(page, '#/');
await page.evaluate(() => localStorage.setItem('cogtube.v1', '{not json'));
await page.reload();
await page.waitForSelector('.shelf');
check('survives corrupt storage', (await page.locator('.shelf').count()) > 0);
await page.evaluate(() => localStorage.setItem('cogtube.v1', JSON.stringify({ later: 'oops', history: null, theater: 1 })));
await page.reload();
await page.waitForSelector('.shelf');
check('survives malformed storage', (await page.locator('.shelf').count()) > 0);
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForSelector('.shelf');

/* ---------- Theater, keys, theme ---------- */
await go(page, `#/watch/${target.id}`);
await page.waitForSelector('#yt-frame');
await page.locator('.watch-title').click();
await page.keyboard.press('t');
check('theater key', await page.locator('#watch.theater').count() === 1);
await page.waitForTimeout(150);
await page.screenshot({ path: join(SHOTS, 'watch-theater.png') });
await page.keyboard.press('t');
await page.keyboard.press('w');
check('save key', (await page.locator('.actions [data-save]').getAttribute('aria-pressed')) === 'true');
await page.keyboard.press('w');
await page.keyboard.press('n');
await page.waitForTimeout(200);
check('next key moves on', !(await page.evaluate(() => location.hash)).includes(target.id));
await page.click('#share').catch(() => {});
await page.waitForTimeout(120);
const copied = await page.evaluate(() => navigator.clipboard.readText()).catch(() => '');
check('copy link gives a watch URL', copied.includes('#/watch/'), copied);

await page.click('#theme');
check('theme toggles', (await page.evaluate(() => document.documentElement.dataset.theme)) === 'light');
const lightBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
check('light background applied', lightBg === 'rgb(255, 255, 255)', lightBg);
await go(page, '#/');
await page.waitForTimeout(500);
await page.screenshot({ path: join(SHOTS, 'home-light.png') });
await page.click('#theme');

await go(page, '#/about');
const about = await page.locator('#main').innerText();
check('about shows funnel', about.includes(data.stats.hnItems.toLocaleString()) && about.includes(String(videos.length)));
await page.waitForTimeout(100);
await page.screenshot({ path: join(SHOTS, 'about.png') });

check('desktop has no page errors', page.problems.length === 0, page.problems.slice(0, 4).join(' | '));

/* ---------- Thumbnails on screen actually load ---------- */
await go(page, '#/');
await page.waitForTimeout(1500);
const thumbs = await page.evaluate(() => [...document.querySelectorAll('.thumb img')].slice(0, 8)
  .map((img) => ({ done: img.complete, w: img.naturalWidth })));
check('thumbnails render', thumbs.every((t) => t.done && t.w >= 320), JSON.stringify(thumbs));

/* ---------- Scroll restoration ---------- */
await page.evaluate(() => window.scrollTo(0, 900));
await page.waitForTimeout(80);
const before = await page.evaluate(() => window.scrollY);
// A DOM click, because Playwright's own click would scroll the card into view first.
await page.evaluate(() => {
  const inView = [...document.querySelectorAll('.shelf .card-title')]
    .find((el) => { const r = el.getBoundingClientRect(); return r.top > 100 && r.bottom < innerHeight; });
  inView.click();
});
await page.waitForTimeout(250);
check('watch opens at top', (await page.evaluate(() => window.scrollY)) === 0);
await page.goBack();
await page.waitForTimeout(350);
const after = await page.evaluate(() => window.scrollY);
check('back restores scroll', Math.abs(after - before) < 5, `${before} vs ${after}`);

/* ---------- Phone and tablet ---------- */
for (const [label, viewport] of [['phone', { width: 390, height: 844 }], ['small-phone', { width: 320, height: 640 }], ['tablet', { width: 820, height: 1100 }]]) {
  const mobile = await open(viewport, 'light');
  for (const hash of ['#/', '#/books', `#/book/${data.books[0].id}`, '#/all', '#/topic/mind', `#/watch/${target.id}`, '#/about', '#/later', '#/history']) {
    await go(mobile, hash);
    await mobile.waitForTimeout(150);
    const overflow = await mobile.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(`${label} ${hash} has no sideways scroll`, overflow <= 0, `${overflow}px`);
  }
  await go(mobile, `#/watch/${target.id}`);
  await mobile.waitForTimeout(1200);
  await mobile.screenshot({ path: join(SHOTS, `${label}-watch.png`) });
  await go(mobile, '#/');
  await mobile.waitForTimeout(700);
  await mobile.screenshot({ path: join(SHOTS, `${label}-home.png`) });
  const hiddenBefore = await mobile.locator('#sidebar').isVisible();
  check(`${label} sidebar starts closed`, !hiddenBefore);
  await mobile.click('#menu');
  await mobile.waitForTimeout(260);
  check(`${label} drawer opens`, await mobile.locator('#sidebar').isVisible());
  await mobile.locator('.nav-item[href="#/about"]').click();
  await mobile.waitForTimeout(280);
  check(`${label} drawer closes on navigate`, !(await mobile.locator('#sidebar').isVisible()));
  check(`${label} scrim hidden`, await mobile.locator('#scrim').isHidden());
  check(`${label} no errors`, mobile.problems.length === 0, mobile.problems.slice(0, 3).join(' | '));
  await mobile.context().close();
}

await browser.close();
server.kill();
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) { console.log(failures.join('\n')); process.exit(1); }
