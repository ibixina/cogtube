'use strict';
(() => {
  const DATA = window.COGTUBE;
  const VIDEOS = DATA.videos;
  const BY_ID = new Map(VIDEOS.map((v) => [v.id, v]));
  const TOPICS = DATA.topics;
  const TOPIC = new Map(TOPICS.map((t) => [t.id, t]));
  const BOOKS = DATA.books;
  const BOOK = new Map(BOOKS.map((b) => [b.id, b]));
  // The first book a video belongs to supplies its note on the watch page.
  const NOTE = new Map();
  BOOKS.forEach((b) => b.videos.forEach((bv) => { if (!NOTE.has(bv.id)) NOTE.set(bv.id, bv.note); }));
  const bookHref = (id) => `#/book/${encodeURIComponent(id)}`;
  const watchHref = (id, book) => `#/watch/${encodeURIComponent(id)}${book ? `?book=${encodeURIComponent(book)}` : ''}`;
  const bookRuntime = (b) => b.videos.reduce((sum, bv) => sum + (BY_ID.get(bv.id)?.duration || 0), 0);
  const FIRST_YEAR = DATA.stats.firstYear;
  const LAST_YEAR = DATA.stats.lastYear;
  const STORE_KEY = 'cogtube.v1';

  /* ---------- Icons ---------- */
  const path = {
    menu: 'M3 6h18v2H3zm0 5h18v2H3zm0 5h18v2H3z',
    search: 'M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z',
    home: 'M12 3 3 10.5V21h6.5v-6h5v6H21V10.5z',
    clock: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16zm.5-13H11v6l5.2 3.1.8-1.2-4.5-2.7z',
    history: 'M13 3a9 9 0 0 0-9 9H1l4 4 4-4H6a7 7 0 1 1 2 4.9l-1.4 1.4A9 9 0 1 0 13 3zm-1 5v5l4.3 2.5.7-1.2-3.5-2.1V8z',
    info: 'M11 7h2v2h-2zm0 4h2v6h-2zm1-9a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16z',
    book: 'M18 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2zM6 4h5v8l-2.5-1.5L6 12V4z',
    grid: 'M4 4h7v7H4zm9 0h7v7h-7zM4 13h7v7H4zm9 0h7v7h-7z',
    sun: 'M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10zM11 1h2v3h-2zm0 19h2v3h-2zM1 11h3v2H1zm19 0h3v2h-3zM4.2 2.8l2.1 2.1-1.4 1.4-2.1-2.1zm14.9 14.9 2.1 2.1-1.4 1.4-2.1-2.1zM2.8 19.8l2.1-2.1 1.4 1.4-2.1 2.1zM17.7 4.9l2.1-2.1 1.4 1.4-2.1 2.1z',
    moon: 'M12.3 2a10 10 0 1 0 9.7 12.6A8 8 0 0 1 12.3 2z',
    check: 'M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z',
    share: 'M14 9V5l7 7-7 7v-4.1c-5 0-8.5 1.6-11 5.1 1-5 4-10 11-11z',
    external: 'M19 19H5V5h7V3H5a2 2 0 0 0-2 2v14c0 1.1.9 2 2 2h14a2 2 0 0 0 2-2v-7h-2zM14 3v2h3.6l-9.8 9.8 1.4 1.4L19 6.4V10h2V3z',
    theater: 'M19 6H5a2 2 0 0 0-2 2v8c0 1.1.9 2 2 2h14a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2zm0 10H5V8h14z',
  };
  const icon = (name, size = 20) =>
    `<svg width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true"><path d="${path[name]}"/></svg>`;

  /* ---------- Helpers ---------- */
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
  const safeUrl = (url) => (/^https:\/\//.test(url || '') ? esc(url) : '#/');
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const plural = (n, word) => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;

  function fmtDur(seconds) {
    const s = Math.max(0, Math.round(seconds || 0));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const r = String(s % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
  }
  const fmtLong = (seconds) => {
    const m = Math.round(seconds / 60);
    if (m < 60) return `${m} min`;
    const h = Math.floor(m / 60);
    return m % 60 ? `${h} hr ${m % 60} min` : `${h} hr`;
  };
  const yearOf = (epoch) => (epoch ? new Date(epoch * 1000).getUTCFullYear() : '');
  const span = (v) => (v.firstYear === v.lastYear ? `${v.firstYear}` : `${v.firstYear}–${v.lastYear}`);
  const thumb = (id) => `https://i.ytimg.com/vi/${encodeURIComponent(id)}/hqdefault.jpg`;
  const ytUrl = (id, t) => `https://www.youtube.com/watch?v=${encodeURIComponent(id)}${t ? `&t=${Math.floor(t)}s` : ''}`;

  /* ---------- Persistence ---------- */
  const state = (() => {
    const fresh = { later: [], history: {}, autoplay: false, theater: false, theme: null, nav: true };
    try {
      return { ...fresh, ...JSON.parse(localStorage.getItem(STORE_KEY) || '{}') };
    } catch {
      return fresh;
    }
  })();
  // Drop anything stored for a video that has since left the catalogue.
  state.later = (Array.isArray(state.later) ? state.later : []).filter((id) => BY_ID.has(id));
  if (typeof state.history !== 'object' || !state.history) state.history = {};
  for (const id of Object.keys(state.history)) if (!BY_ID.has(id)) delete state.history[id];

  function persist() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
    } catch { /* Private windows can block storage; the session still works. */ }
  }
  const isSaved = (id) => state.later.includes(id);
  function toggleSaved(id) {
    const saved = isSaved(id);
    state.later = saved ? state.later.filter((x) => x !== id) : [id, ...state.later];
    persist();
    $$(`[data-save="${CSS.escape(id)}"]`).forEach((b) => {
      b.setAttribute('aria-pressed', String(!saved));
      if (b.classList.contains('btn')) b.innerHTML = saveBtnInner(!saved);
      else b.setAttribute('aria-label', saved ? 'Save to Watch later' : 'Remove from Watch later');
    });
    renderSidebar();
    toast(saved ? 'Removed from Watch later' : 'Saved to Watch later');
    if (route().name === 'later') render();
  }
  const saveBtnInner = (saved) => `${icon(saved ? 'check' : 'clock', 18)}${saved ? 'Saved' : 'Watch later'}`;

  function touchHistory(id, patch) {
    const prev = state.history[id] || { t: 0, d: 0, at: 0, done: false };
    state.history[id] = { ...prev, ...patch, at: Date.now() };
    persist();
  }
  const started = (entry) => entry && !entry.done && entry.t > 15 && entry.d > 0;
  const continueList = () => Object.entries(state.history)
    .filter(([, e]) => started(e))
    .sort((a, b) => b[1].at - a[1].at)
    .map(([id]) => BY_ID.get(id));

  let toastTimer;
  function toast(message) {
    const el = $('#toast');
    el.textContent = message;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 2200);
  }

  /* ---------- Fragments ---------- */
  function yearStrip(v) {
    const cells = [];
    for (let y = FIRST_YEAR; y <= LAST_YEAR; y += 1) {
      const n = v.byYear[y] || 0;
      const cls = n >= 3 ? 'on' : n === 2 ? 'on-2' : n === 1 ? 'on-1' : '';
      cells.push(`<i class="${cls}"></i>`);
    }
    const label = `Recommended in ${plural(v.yearCount, 'year')}, ${span(v)}`;
    return `<div class="years" role="img" aria-label="${esc(label)}" title="${esc(label)}">${cells.join('')}</div>`;
  }

  function evidenceLine(v) {
    const parts = [];
    if (v.hn.threads) parts.push(`${v.hn.threads} HN ${v.hn.threads === 1 ? 'thread' : 'threads'}`);
    if (v.otherCount) parts.push(`+${v.otherCount} elsewhere`);
    parts.push(span(v));
    return parts.join(' · ');
  }

  function thumbBlock(v, book = '') {
    const entry = state.history[v.id];
    let overlay = '';
    if (entry?.done) {
      overlay = '<span class="watched-flag">Watched</span>';
    } else if (started(entry)) {
      const pct = Math.min(100, (entry.t / entry.d) * 100).toFixed(1);
      overlay = `<span class="prog-track"></span><span class="prog" style="width:${pct}%"></span>`;
    }
    return `<a class="thumb" href="${esc(watchHref(v.id, book))}" tabindex="-1" aria-hidden="true">
      <img loading="lazy" decoding="async" src="${thumb(v.id)}" alt="" width="480" height="270">
      <span class="dur">${fmtDur(v.duration)}</span>${overlay}</a>`;
  }

  function saveButton(v) {
    const saved = isSaved(v.id);
    return `<button class="save" data-save="${esc(v.id)}" aria-pressed="${saved}"
      aria-label="${saved ? 'Remove from Watch later' : 'Save to Watch later'}: ${esc(v.title)}"
      title="Watch later">${icon('clock', 18)}</button>`;
  }

  function card(v, compact = false, why = '', book = '') {
    return `<article class="card${compact ? ' compact' : ''}">
      ${thumbBlock(v, book)}${saveButton(v)}
      <div class="card-body">
        <a class="card-title" href="${esc(watchHref(v.id, book))}" title="${esc(v.title)}">${esc(v.title)}</a>
        ${why ? `<p class="card-why">${esc(why)}</p>` : ''}
        <div class="card-chan">${esc(v.channel)}</div>
        <div class="card-evid">${esc(evidenceLine(v))}</div>
        ${yearStrip(v)}
      </div>
    </article>`;
  }

  const grid = (videos) => `<div class="grid">${videos.map((v) => card(v)).join('')}</div>`;
  const row = (videos) => `<div class="row">${videos.map((v) => card(v)).join('')}</div>`;

  function emptyState(title, body) {
    return `<div class="empty"><h2>${esc(title)}</h2><p>${body}</p></div>`;
  }

  /* ---------- Sorting and filtering ---------- */
  const SORTS = {
    recommended: { label: 'Most recommended', fn: (a, b) => b.rank - a.rank },
    enduring: { label: 'Most years recommended', fn: (a, b) => b.yearCount - a.yearCount || b.rank - a.rank },
    recent: { label: 'Newest upload', fn: (a, b) => String(b.uploaded).localeCompare(String(a.uploaded)) },
    oldest: { label: 'Oldest upload', fn: (a, b) => String(a.uploaded).localeCompare(String(b.uploaded)) },
    short: { label: 'Shortest first', fn: (a, b) => a.duration - b.duration },
    long: { label: 'Longest first', fn: (a, b) => b.duration - a.duration },
  };
  const LENGTHS = {
    any: { label: 'Any length', fn: () => true },
    short: { label: 'Under 20 min', fn: (v) => v.duration < 1200 },
    mid: { label: '20–60 min', fn: (v) => v.duration >= 1200 && v.duration <= 3600 },
    long: { label: 'Over 1 hour', fn: (v) => v.duration > 3600 },
  };
  const view = { sort: 'recommended', length: 'any', hideWatched: false };

  function applyView(videos) {
    return videos
      .filter(LENGTHS[view.length].fn)
      .filter((v) => !view.hideWatched || !state.history[v.id]?.done)
      .slice()
      .sort(SORTS[view.sort].fn);
  }

  function controls(count) {
    const seg = Object.entries(LENGTHS).map(([key, l]) =>
      `<button class="chip" data-length="${key}" aria-pressed="${view.length === key}">${l.label}</button>`).join('');
    const options = Object.entries(SORTS).map(([key, s]) =>
      `<option value="${key}"${view.sort === key ? ' selected' : ''}>${s.label}</option>`).join('');
    return `<div class="controls">
      <div class="seg" role="group" aria-label="Filter by length">${seg}</div>
      <label class="select-wrap">Sort <select id="sort">${options}</select></label>
      <label class="check"><input type="checkbox" id="hide-watched"${view.hideWatched ? ' checked' : ''}>Hide watched</label>
      <span class="result-count">${plural(count, 'video')}</span>
    </div>`;
  }

  /* ---------- Search ---------- */
  const haystacks = new Map(VIDEOS.map((v) => [v.id, {
    title: v.title.toLowerCase(),
    channel: v.channel.toLowerCase(),
    rest: [v.topics.map((t) => TOPIC.get(t)?.label).join(' '), v.keywords || ''].join(' ').toLowerCase(),
  }]));

  function searchVideos(query) {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return [];
    const scored = [];
    for (const v of VIDEOS) {
      const h = haystacks.get(v.id);
      let score = 0;
      let all = true;
      for (const term of terms) {
        let hit = 0;
        if (h.title.includes(term)) hit = 6;
        else if (h.channel.includes(term)) hit = 4;
        else if (h.rest.includes(term)) hit = 1;
        if (!hit) { all = false; break; }
        score += hit;
      }
      if (all) scored.push([score, v]);
    }
    return scored.sort((a, b) => b[0] - a[0] || b[1].rank - a[1].rank).map(([, v]) => v);
  }

  /* ---------- Routing ---------- */
  function route() {
    const raw = location.hash.replace(/^#\/?/, '');
    const [pathPart, queryPart] = raw.split('?');
    const segments = pathPart.split('/').filter(Boolean).map((s) => {
      try { return decodeURIComponent(s); } catch { return s; }
    });
    const params = new URLSearchParams(queryPart || '');
    switch (segments[0]) {
      case undefined: return { name: 'home' };
      case 'all': return { name: 'all' };
      case 'topic': return { name: 'topic', id: segments[1] };
      case 'watch': return { name: 'watch', id: segments[1], t: Number(params.get('t')) || 0, book: params.get('book') || '' };
      case 'books': return { name: 'books' };
      case 'book': return { name: 'book', id: segments[1] };
      case 'search': return { name: 'search', q: segments.slice(1).join('/') };
      case 'later': return { name: 'later' };
      case 'history': return { name: 'history' };
      case 'about': return { name: 'about' };
      default: return { name: 'missing' };
    }
  }

  /* ---------- Sidebar ---------- */
  function renderSidebar() {
    const r = route();
    const current = (test) => (test ? ' aria-current="page"' : '');
    const counts = new Map(TOPICS.map((t) => [t.id, VIDEOS.filter((v) => v.topics.includes(t.id)).length]));
    const item = (href, label, ic, on, count) => `<a class="nav-item" href="${href}"${current(on)}>
      ${icon(ic)}<span>${esc(label)}</span>${count ? `<span class="count">${count}</span>` : ''}</a>`;
    $('#sidebar').innerHTML = `
      ${item('#/', 'Home', 'home', r.name === 'home')}
      ${item('#/books', 'The ten books', 'book', r.name === 'books' || r.name === 'book', BOOKS.length)}
      ${item('#/all', 'The library', 'grid', r.name === 'all', VIDEOS.length)}
      ${item('#/later', 'Watch later', 'clock', r.name === 'later', state.later.length)}
      ${item('#/history', 'History', 'history', r.name === 'history', Object.keys(state.history).length)}
      <div class="nav-sep"></div>
      <div class="nav-head">Topics</div>
      ${TOPICS.map((t) => `<a class="nav-item" href="#/topic/${esc(t.id)}"${current(r.name === 'topic' && r.id === t.id)}>
        <span class="topic-dot" aria-hidden="true"></span><span>${esc(t.label)}</span>
        <span class="count">${counts.get(t.id)}</span></a>`).join('')}
      <div class="nav-sep"></div>
      ${item('#/about', 'How videos get in', 'info', r.name === 'about')}`;
  }

  /* ---------- Pages ---------- */
  function chipsBar(activeId) {
    const chip = (href, label, on) => `<a class="chip" href="${href}"${on ? ' aria-current="page"' : ''}>${esc(label)}</a>`;
    return `<div class="chips">
      ${chip('#/', 'For you', activeId === 'home')}
      ${chip('#/all', 'All', activeId === 'all')}
      ${TOPICS.map((t) => chip(`#/topic/${t.id}`, t.label, activeId === t.id)).join('')}
    </div>`;
  }

  function fileBanner() {
    if (location.protocol !== 'file:') return '';
    return `<div class="banner">Thumbnails work here, but YouTube refuses to play embeds on pages opened from a file.
      Run <code>npm start</code> in this folder and open <code>http://localhost:4173</code>.</div>`;
  }

  function pageHome() {
    setTitle();
    const resume = continueList();
    // A video can sit in several topics, but appears on one home shelf only:
    // its primary topic first, so each shelf stays distinct.
    const shown = new Set(BOOKS.flatMap((b) => b.videos.map((bv) => bv.id)));
    const byRank = [...VIDEOS].sort((a, b) => b.rank - a.rank);
    const shelves = TOPICS.map((t) => {
      const primary = byRank.filter((v) => v.topics[0] === t.id && !shown.has(v.id));
      const secondary = byRank.filter((v) => v.topics[0] !== t.id && v.topics.includes(t.id) && !shown.has(v.id));
      const items = [...primary, ...secondary].slice(0, 8);
      items.forEach((v) => shown.add(v.id));
      if (!items.length) return '';
      return `<section class="shelf" aria-labelledby="shelf-${esc(t.id)}">
        <div class="shelf-head">
          <div><h2 id="shelf-${esc(t.id)}">${esc(t.label)}</h2><p>${esc(t.why)}</p></div>
          <a class="shelf-more" href="#/topic/${esc(t.id)}">View all</a>
        </div>${row(items)}</section>`;
    }).join('');
    const resumeShelf = resume.length ? `<section class="shelf" aria-labelledby="shelf-resume">
      <div class="shelf-head"><div><h2 id="shelf-resume">Continue watching</h2></div></div>
      ${row(resume.slice(0, 8))}</section>` : '';
    const books = `<section class="shelf" aria-labelledby="shelf-books">
      <div class="shelf-head"><div><h2 id="shelf-books">The ten books</h2>
        <p>Ten books away from being the most cracked person you know. Each is a path of long, dense talks and courses toward something you're building, read in order.</p></div>
        <a class="shelf-more" href="#/books">Open the shelf</a></div>
      <div class="books">${BOOKS.map((b, i) => bookCard(b, i)).join('')}</div></section>`;
    return `${chipsBar('home')}${fileBanner()}${resumeShelf}${books}${shelves}`;
  }

  /* ---------- Books ---------- */
  const doneCount = (b) => b.videos.filter((bv) => state.history[bv.id]?.done).length;
  const nextPart = (b) => b.videos.find((bv) => !state.history[bv.id]?.done) || b.videos[0];

  function bookCard(b, i) {
    const done = doneCount(b);
    const pct = Math.round((done / b.videos.length) * 100);
    return `<a class="book" href="${esc(bookHref(b.id))}" aria-label="Book ${i + 1}: ${esc(b.title)}">
      <span class="book-num">${String(i + 1).padStart(2, '0')}</span>
      <span class="book-title">${esc(b.title)}</span>
      <span class="book-goal">${esc(b.goal)}</span>
      <span class="book-meta">${plural(b.videos.length, 'part')} · ${fmtLong(bookRuntime(b))}</span>
      <span class="book-prog" role="img" aria-label="${done} of ${b.videos.length} watched"><i style="width:${pct}%"></i></span>
    </a>`;
  }

  function pageBooks() {
    setTitle('The ten books');
    const hours = Math.round(BOOKS.reduce((sum, b) => sum + bookRuntime(b), 0) / 3600);
    return `<div class="page-head"><h1>The ten books</h1>
      <p>${esc(DATA.stats.booksIntro)} In total about ${hours} hours.</p></div>
      <div class="books big">${BOOKS.map((b, i) => bookCard(b, i)).join('')}</div>`;
  }

  function pageBook(id) {
    const b = BOOK.get(id);
    if (!b) return pageMissing();
    setTitle(b.title);
    const i = BOOKS.indexOf(b);
    const done = doneCount(b);
    const next = nextPart(b);
    const label = done === 0 ? 'Start reading' : done === b.videos.length ? 'Read again from the start' : 'Continue';
    const rows = b.videos.map((bv, n) => {
      const v = BY_ID.get(bv.id);
      return `<li class="part"><span class="part-n">${n + 1}</span>${card(v, true, bv.note, b.id)}</li>`;
    }).join('');
    return `<div class="page-head"><p class="eyebrow">Book ${i + 1} of ${BOOKS.length}</p><h1>${esc(b.title)}</h1>
      <p>${esc(b.goal)}</p>
      <p class="book-meta" style="margin-top:10px">${plural(b.videos.length, 'part')} · ${fmtLong(bookRuntime(b))} · ${done} watched</p></div>
      <div class="controls"><a class="btn primary" href="${esc(watchHref(done === b.videos.length ? b.videos[0].id : next.id, b.id))}">${label}</a></div>
      <section class="panel book-why"><h2>Why this book</h2><p class="for-you">${esc(b.why)}</p></section>
      <ol class="parts">${rows}</ol>
      ${b.more.length ? `<section class="panel book-more"><h2>Go further</h2>
        <p class="desc">The rest of each course, which didn't pass the recommendation bar one video at a time, so these haven't been checked.</p>
        <ul class="more-list">${b.more.map((m) => `<li><a class="link" href="${esc(m.url)}" target="_blank" rel="noopener noreferrer">${esc(m.label)}</a> <span class="more-note">${esc(m.note)}</span></li>`).join('')}</ul></section>` : ''}
      ${i < BOOKS.length - 1 ? `<p class="next-book"><a class="link" href="${esc(bookHref(BOOKS[i + 1].id))}">Next: ${esc(BOOKS[i + 1].title)} \u2192</a></p>` : ''}`;
  }

  function pageAll() {
    setTitle('The library');
    const videos = applyView(VIDEOS);
    return `${chipsBar('all')}${fileBanner()}
      <div class="page-head"><h1>The library</h1>
      <p>Every video on the site, books included. All of it was recommended by different people, in different threads, across several years, and is long or dense enough to be worth your time.</p></div>
      ${controls(videos.length)}
      ${videos.length ? grid(videos) : emptyState('Nothing matches these filters', 'Try a different length, or show watched videos.')}`;
  }

  function pageTopic(id) {
    const topic = TOPIC.get(id);
    if (!topic) return pageMissing();
    setTitle(topic.label);
    const videos = applyView(VIDEOS.filter((v) => v.topics.includes(id)));
    return `${chipsBar(id)}${fileBanner()}
      <div class="page-head"><h1>${esc(topic.label)}</h1><p>${esc(topic.why)}</p></div>
      ${controls(videos.length)}
      ${videos.length ? grid(videos) : emptyState('Nothing matches these filters', 'Try a different length, or show watched videos.')}`;
  }

  function pageSearch(q) {
    setTitle(`${q} - Search`);
    const results = searchVideos(q);
    const videos = applyView(results);
    return `<div class="page-head"><h1>Results for “${esc(q)}”</h1></div>
      ${results.length ? controls(videos.length) : ''}
      ${videos.length ? grid(videos) : emptyState(
        results.length ? 'Nothing matches these filters' : 'No videos match',
        results.length ? 'Try a different length, or show watched videos.'
          : 'This catalogue is deliberately small, and only holds videos with a long record of recommendations. <a href="#/all">Browse everything</a>.',
      )}`;
  }

  function pageLater() {
    setTitle('Watch later');
    const videos = state.later.map((id) => BY_ID.get(id)).filter(Boolean);
    const total = videos.reduce((sum, v) => sum + v.duration, 0);
    return `<div class="page-head"><h1>Watch later</h1>
      ${videos.length ? `<p>${plural(videos.length, 'video')}, ${fmtLong(total)} in total. Saved in this browser only.</p>` : ''}</div>
      ${videos.length ? grid(videos) : emptyState('Nothing saved yet', 'Hover over a thumbnail and press the clock to save a video.')}`;
  }

  function pageHistory() {
    setTitle('History');
    const entries = Object.entries(state.history).sort((a, b) => b[1].at - a[1].at);
    const videos = entries.map(([id]) => BY_ID.get(id)).filter(Boolean);
    const head = videos.length
      ? '<button class="btn" id="clear-history">Clear history</button>' : '';
    return `<div class="page-head"><h1>History</h1><p>Kept in this browser only. Nothing is sent to a server by CogTube.</p></div>
      ${head ? `<div class="controls">${head}</div>` : ''}
      ${videos.length ? grid(videos) : emptyState('No history yet', 'Videos you open will show up here, with your place saved.')}`;
  }

  function pageAbout() {
    setTitle('How videos get in');
    const s = DATA.stats;
    const rows = s.sources.map((src) => `<tr><td>${esc(src.label)}</td>
      <td class="n">${src.mentions.toLocaleString()}</td><td class="n">${src.videos.toLocaleString()}</td></tr>`).join('');
    return `<div class="page-head"><h1>How videos get in</h1>
      <p>CogTube has no algorithm tuned for watch time. A video appears only if people kept recommending it long after it came out.</p></div>
      <div class="prose">
        <h2>The bar</h2>
        <p>Each video in the catalogue passed all of these checks on <strong>${esc(s.generatedDate)}</strong>:</p>
        <ul>${s.rules.map((rule) => `<li>${esc(rule)}</li>`).join('')}</ul>
        <h2>The funnel</h2>
        <ul>
          <li><strong>${s.hnItems.toLocaleString()}</strong> Hacker News stories and comments link to YouTube.</li>
          <li><strong>${s.distinctVideos.toLocaleString()}</strong> different videos are linked across all sources.</li>
          <li><strong>${s.qualified.toLocaleString()}</strong> of those clear the repetition bar.</li>
          <li><strong>${(VIDEOS.length + s.cutCount).toLocaleString()}</strong> were then picked by hand for your interests, and <strong>${s.cutCount.toLocaleString()}</strong> of those were cut as too short, too introductory or off-thread. <strong>${VIDEOS.length.toLocaleString()}</strong> remain.</li>
        </ul>
        <h2>Sources</h2>
        <table class="tbl"><thead><tr><th>Source</th><th class="n">Mentions</th><th class="n">Videos</th></tr></thead>
        <tbody>${rows}</tbody></table>
        <h2>What the numbers mean</h2>
        <ul>${s.caveats.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>
        <h2>How your interests were read</h2>
        <p>${esc(s.interestNote)}</p>
        <h2>Keyboard</h2>
        <div class="keys">
          <kbd>/</kbd><span>Search</span>
          <kbd>w</kbd><span>Save or unsave the current video</span>
          <kbd>t</kbd><span>Theater mode</span>
          <kbd>n</kbd><span>Next video</span>
        </div>
        <p style="margin-top:10px">Keys go to YouTube's own player while it has focus. Click outside the player to use these.</p>
        <h2>Privacy</h2>
        <p>Your saved videos, history and playback positions stay in this browser's local storage. Thumbnails come from YouTube's image servers. Video plays through YouTube's privacy-enhanced embed, and YouTube sees whatever it normally sees once you press play.</p>
      </div>`;
  }

  function pageMissing() {
    setTitle('Not found');
    return emptyState('That page does not exist', '<a href="#/">Back to home</a>');
  }

  /* ---------- Watch page ---------- */
  function relatedTo(v) {
    const overlap = (other) => other.topics.filter((t) => v.topics.includes(t)).length;
    const pool = VIDEOS.filter((o) => o.id !== v.id && !state.history[o.id]?.done);
    const scored = pool.map((o) => [overlap(o) * 1000 + o.rank, o]);
    return scored.sort((a, b) => b[0] - a[0]).map(([, o]) => o).slice(0, 18);
  }

  function evidencePanel(v) {
    const counts = [];
    let max = 1;
    for (let y = FIRST_YEAR; y <= LAST_YEAR; y += 1) {
      const n = v.byYear[y] || 0;
      counts.push([y, n]);
      max = Math.max(max, n);
    }
    const bars = counts.map(([y, n]) => `<div class="y${n ? '' : ' none'}" title="${y}: ${plural(n, 'recommendation')}">
      <i style="height:${n ? Math.max(10, (n / max) * 100).toFixed(0) : 3}%"></i></div>`).join('');
    const stats = [
      [v.hn.threads, 'HN threads'],
      [v.hn.authors, 'different people'],
      [v.yearCount, v.yearCount === 1 ? 'year' : 'years'],
    ];
    if (v.hn.points >= 10) stats.push([v.hn.points.toLocaleString(), 'HN points']);
    if (v.otherCount) stats.push([v.otherCount, 'posts elsewhere']);

    const quotes = (v.quotes || []).map((q) => `<blockquote class="quote" style="margin:0">
      <p>${esc(q.text)}</p>
      <footer>${esc(q.author)}, ${yearOf(q.t)} · <a href="${safeUrl(q.link)}" target="_blank" rel="noopener noreferrer">read on HN</a></footer>
    </blockquote>`).join('');

    const threadItems = (v.threads || []).map((th) => `<li>
      <span class="when">${yearOf(th.t) || '–'}</span>
      <div><a href="${safeUrl(th.link)}" target="_blank" rel="noopener noreferrer">${esc(th.title || 'Hacker News thread')}</a>
      <small>${esc(th.source)}${th.note ? ` · ${esc(th.note)}` : ''}</small></div></li>`).join('');
    const more = v.hn.threads > (v.hnThreadsListed || 0)
      ? `<li><span class="when"></span><div><a class="link" href="https://hn.algolia.com/?dateRange=all&query=${encodeURIComponent(v.id)}&sort=byDate&type=all" target="_blank" rel="noopener noreferrer">See every HN mention</a></div></li>` : '';

    return `<section class="panel" aria-labelledby="why-here">
      <h2 id="why-here">Why this is here</h2>
      <div class="stats">${stats.map(([n, l]) => `<div class="stat"><b>${n}</b><span>${esc(l)}</span></div>`).join('')}</div>
      <div class="years-big" role="img" aria-label="Recommendations per year from ${FIRST_YEAR} to ${LAST_YEAR}">${bars}</div>
      <div class="years-axis"><span>${FIRST_YEAR}</span><span>${LAST_YEAR}</span></div>
      ${quotes ? `<div class="quotes">${quotes}</div>` : ''}
      <details class="evidence"><summary>Where it was recommended</summary>
        <ul class="evidence-list">${threadItems}${more}</ul>
      </details>
    </section>`;
  }

  function pageWatch(id, startAt, bookParam = '') {
    const v = BY_ID.get(id);
    if (!v) {
      setTitle('Not found');
      return emptyState('This video is not in the catalogue', '<a href="#/">Back to home</a>');
    }
    setTitle(v.title);
    const book = (bookParam && BOOK.get(bookParam)?.videos.some((bv) => bv.id === id) ? BOOK.get(bookParam) : null)
      || BOOKS.find((b) => b.videos.some((bv) => bv.id === id)) || null;
    const part = book ? book.videos.findIndex((bv) => bv.id === id) : -1;
    const prev = book && part > 0 ? book.videos[part - 1] : null;
    const nextInBook = book && part < book.videos.length - 1 ? book.videos[part + 1] : null;
    const strip = book ? `<nav class="book-strip" aria-label="Book progress">
      <a class="book-strip-title" href="${esc(bookHref(book.id))}">Book ${BOOKS.indexOf(book) + 1} \u00b7 ${esc(book.title)}</a>
      <span class="book-strip-pos">Part ${part + 1} of ${book.videos.length}</span>
      ${prev ? `<a class="btn" href="${esc(watchHref(prev.id, book.id))}">\u2190 Previous</a>` : ''}
      ${nextInBook ? `<a class="btn primary" href="${esc(watchHref(nextInBook.id, book.id))}">Next part \u2192</a>` : `<a class="btn" href="${esc(bookHref(book.id))}">Back to the book</a>`}
    </nav>` : '';
    const related = relatedTo(v);
    const primary = TOPIC.get(v.topics[0]);
    const chapters = v.chapters?.length ? `<section class="panel" aria-labelledby="chap">
      <h2 id="chap">Chapters</h2><div class="chapters">${v.chapters.map((c) =>
        `<button class="chapter" data-seek="${c.t}"><span>${fmtDur(c.t)}</span><span>${esc(c.title)}</span></button>`).join('')}</div>
    </section>` : '';
    const description = v.description ? `<section class="panel"><h2>From the video's description</h2>
      <p class="desc">${esc(v.description)}</p></section>` : '';
    const uploaded = v.uploaded ? v.uploaded.slice(0, 4) : '';
    return `<div class="watch${state.theater ? ' theater' : ''}" id="watch">
      <div class="player-wrap">
        ${fileBanner()}
        <div class="player" id="player" data-id="${esc(v.id)}" data-start="${startAt}"></div>
      </div>
      <div class="watch-main">
        <h1 class="watch-title">${esc(v.title)}</h1>
        ${strip}
        <div class="watch-bar">
          <div class="watch-chan"><b>${esc(v.channel)}</b><span>${uploaded ? `Uploaded ${uploaded} · ` : ''}${fmtLong(v.duration)}</span></div>
          <div class="actions">
            <button class="btn" data-save="${esc(v.id)}" aria-pressed="${isSaved(v.id)}">${saveBtnInner(isSaved(v.id))}</button>
            <button class="btn" id="watched" aria-pressed="${!!state.history[v.id]?.done}">${icon('check', 18)}Watched</button>
            <button class="btn" id="theater-btn" aria-pressed="${state.theater}">${icon('theater', 18)}Theater</button>
            <button class="btn" id="share">${icon('share', 18)}Copy link</button>
            <a class="btn" href="${ytUrl(v.id)}" target="_blank" rel="noopener noreferrer">${icon('external', 18)}YouTube</a>
          </div>
        </div>
        <section class="panel">
          <h2>Why you might like it</h2>
          <p class="for-you">${esc(NOTE.get(v.id) || (primary ? primary.why : ''))}</p>
          <div class="tags">${v.topics.map((t) => `<a class="tag" href="#/topic/${esc(t)}">${esc(TOPIC.get(t)?.label)}</a>`).join('')}</div>
        </section>
        ${evidencePanel(v)}
        ${chapters}
        ${description}
      </div>
      <aside class="watch-side" aria-label="Up next">
        <div class="side-head"><h2>Up next</h2>
          <label class="check"><input type="checkbox" id="autoplay"${state.autoplay ? ' checked' : ''}>Autoplay</label></div>
        ${related.map((o) => card(o, true)).join('')}
      </aside>
    </div>`;
  }

  /* ---------- Player ---------- */
  const player = {
    api: null, id: null, poll: null, ended: false,

    mount(el) {
      this.teardown();
      const id = el.dataset.id;
      this.id = id;
      const saved = state.history[id];
      const asked = Number(el.dataset.start) || 0;
      const start = asked || (started(saved) ? Math.floor(saved.t) : 0);
      touchHistory(id, {});
      renderSidebar();

      const params = new URLSearchParams({
        enablejsapi: '1', rel: '0', modestbranding: '1', playsinline: '1',
      });
      if (location.protocol.startsWith('http')) params.set('origin', location.origin);
      if (start) params.set('start', String(start));

      // The iframe is built by hand so playback still works if the API script is blocked.
      const frame = document.createElement('iframe');
      frame.id = 'yt-frame';
      frame.title = BY_ID.get(id).title;
      frame.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?${params}`;
      frame.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
      frame.allowFullscreen = true;
      frame.referrerPolicy = 'strict-origin-when-cross-origin';
      el.append(frame);

      if (start) toast(`Resuming at ${fmtDur(start)}`);
      loadApi().then(() => {
        if (this.id !== id || !document.body.contains(frame)) return;
        this.api = new window.YT.Player(frame, {
          events: {
            onStateChange: (event) => this.onState(event, id),
            onError: (event) => this.onError(event, id),
          },
        });
      }).catch(() => { /* No API: the plain embed still plays, without resume tracking. */ });
    },

    onState(event, id) {
      const YT = window.YT;
      if (event.data === YT.PlayerState.PLAYING) {
        this.startPolling(id);
      } else {
        this.save(id);
        clearInterval(this.poll);
      }
      if (event.data === YT.PlayerState.ENDED) {
        touchHistory(id, { done: true });
        syncWatchedButton(id);
        if (state.autoplay) goNext();
      }
    },

    onError(event, id) {
      const box = $('#player');
      if (!box || $('.player-fallback', box)) return;
      const blocked = [100, 101, 150, 153].includes(event.data);
      const note = document.createElement('div');
      note.className = 'player-fallback';
      note.innerHTML = `<p>${blocked
        ? 'YouTube won’t play this video inside another site.'
        : 'YouTube reported a playback error.'}</p>
        <a href="${ytUrl(id)}" target="_blank" rel="noopener noreferrer">Watch on YouTube</a>`;
      box.append(note);
    },

    startPolling(id) {
      clearInterval(this.poll);
      this.poll = setInterval(() => this.save(id), 5000);
    },

    save(id) {
      const api = this.api;
      if (!api?.getCurrentTime || id !== this.id) return;
      let t;
      let d;
      try {
        t = api.getCurrentTime();
        d = api.getDuration();
      } catch { return; }
      if (!d) return;
      const done = t / d >= 0.92 || !!state.history[id]?.done;
      touchHistory(id, { t, d, done });
      syncWatchedButton(id);
    },

    seek(seconds) {
      if (this.api?.seekTo) {
        this.api.seekTo(seconds, true);
        this.api.playVideo?.();
        return;
      }
      // Without the API, reload the embed at the requested time.
      const frame = $('#yt-frame');
      if (frame) {
        const url = new URL(frame.src);
        url.searchParams.set('start', String(seconds));
        url.searchParams.set('autoplay', '1');
        frame.src = url.href;
      }
    },

    teardown() {
      if (this.id) this.save(this.id);
      clearInterval(this.poll);
      try { this.api?.destroy?.(); } catch { /* Already gone. */ }
      this.api = null;
      this.id = null;
    },
  };

  let apiPromise = null;
  function loadApi() {
    if (apiPromise) return apiPromise;
    apiPromise = new Promise((resolve, reject) => {
      if (window.YT?.Player) { resolve(); return; }
      const timer = setTimeout(() => reject(new Error('YouTube API timed out')), 15000);
      const prior = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        clearTimeout(timer);
        prior?.();
        resolve();
      };
      const script = document.createElement('script');
      script.src = 'https://www.youtube.com/iframe_api';
      script.onerror = () => { clearTimeout(timer); reject(new Error('YouTube API blocked')); };
      document.head.append(script);
    });
    return apiPromise;
  }

  function syncWatchedButton(id) {
    const btn = $('#watched');
    if (btn && player.id === id) btn.setAttribute('aria-pressed', String(!!state.history[id]?.done));
  }

  function goNext() {
    const r = route();
    if (r.name !== 'watch') return;
    const v = BY_ID.get(r.id);
    if (!v) return;
    const book = BOOK.get(r.book) || BOOKS.find((b) => b.videos.some((bv) => bv.id === r.id));
    const at = book ? book.videos.findIndex((bv) => bv.id === r.id) : -1;
    if (book && at >= 0 && at < book.videos.length - 1) {
      location.hash = watchHref(book.videos[at + 1].id, book.id);
      return;
    }
    const next = relatedTo(v)[0];
    if (next) location.hash = watchHref(next.id);
  }

  /* ---------- Render loop ---------- */
  const SITE = 'CogTube';
  function setTitle(prefix) {
    document.title = prefix ? `${prefix} - ${SITE}` : SITE;
  }

  const scrollMemory = new Map();
  let lastHash = location.hash;

  function render(restore = false) {
    const r = route();
    const pages = {
      home: pageHome,
      all: pageAll,
      topic: () => pageTopic(r.id),
      watch: () => pageWatch(r.id, r.t, r.book),
      books: pageBooks,
      book: () => pageBook(r.id),
      search: () => pageSearch(r.q),
      later: pageLater,
      history: pageHistory,
      about: pageAbout,
      missing: pageMissing,
    };
    if (r.name !== 'watch') player.teardown();
    const main = $('#main');
    main.innerHTML = pages[r.name]();
    renderSidebar();
    const mount = $('#player');
    if (mount) player.mount(mount);
    else player.id = null;
    $('#q').value = r.name === 'search' ? r.q : '';
    closeDrawer();
    window.scrollTo(0, restore ? (scrollMemory.get(location.hash) || 0) : 0);
  }

  window.addEventListener('hashchange', () => {
    scrollMemory.set(lastHash, window.scrollY);
    lastHash = location.hash;
    render(true);
  });
  window.addEventListener('pagehide', () => { if (player.id) player.save(player.id); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && player.id) player.save(player.id);
  });

  /* ---------- Navigation drawer ---------- */
  const narrow = () => window.matchMedia('(max-width: 1000px)').matches;
  function syncNav() {
    document.body.classList.toggle('nav-closed', !narrow() && !state.nav);
    $('#menu').setAttribute('aria-expanded', String(narrow() ? document.body.classList.contains('nav-open') : state.nav));
  }
  function closeDrawer() {
    document.body.classList.remove('nav-open');
    $('#scrim').hidden = true;
    syncNav();
  }
  $('#menu').innerHTML = icon('menu', 24);
  $('#menu').addEventListener('click', () => {
    if (narrow()) {
      const open = document.body.classList.toggle('nav-open');
      $('#scrim').hidden = !open;
    } else {
      state.nav = !state.nav;
      persist();
    }
    syncNav();
  });
  $('#scrim').addEventListener('click', closeDrawer);
  window.addEventListener('resize', syncNav);

  /* ---------- Theme ---------- */
  const isDark = () => (state.theme
    ? state.theme === 'dark'
    : window.matchMedia('(prefers-color-scheme: dark)').matches);
  function syncTheme() {
    $('#theme').innerHTML = icon(isDark() ? 'sun' : 'moon', 22);
    $('#theme').setAttribute('aria-label', isDark() ? 'Switch to light theme' : 'Switch to dark theme');
  }
  $('#theme').addEventListener('click', () => {
    state.theme = isDark() ? 'light' : 'dark';
    document.documentElement.dataset.theme = state.theme;
    persist();
    syncTheme();
  });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', syncTheme);

  /* ---------- Search box ---------- */
  const input = $('#q');
  const suggest = $('#suggest');
  let suggestIndex = -1;
  let suggestItems = [];
  $('.search-go').innerHTML = icon('search', 22);

  function hideSuggest() {
    suggest.hidden = true;
    suggestIndex = -1;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
  }
  function showSuggest() {
    const q = input.value.trim();
    suggestItems = q ? searchVideos(q).slice(0, 7) : [];
    suggestIndex = -1;
    if (!suggestItems.length) { hideSuggest(); return; }
    suggest.innerHTML = suggestItems.map((v, i) =>
      `<li id="sg-${i}" role="option" aria-selected="false" data-id="${esc(v.id)}"><span>${esc(v.title)}</span><span>${fmtDur(v.duration)}</span></li>`).join('');
    suggest.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  }
  function moveSuggest(delta) {
    if (suggest.hidden || !suggestItems.length) return;
    suggestIndex = (suggestIndex + delta + suggestItems.length + 1) % (suggestItems.length + 1);
    if (suggestIndex === suggestItems.length) suggestIndex = -1;
    $$('li', suggest).forEach((li, i) => li.setAttribute('aria-selected', String(i === suggestIndex)));
    if (suggestIndex >= 0) input.setAttribute('aria-activedescendant', `sg-${suggestIndex}`);
    else input.removeAttribute('aria-activedescendant');
  }
  input.addEventListener('input', showSuggest);
  input.addEventListener('focus', showSuggest);
  input.addEventListener('blur', () => setTimeout(hideSuggest, 120));
  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); moveSuggest(1); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); moveSuggest(-1); }
    else if (event.key === 'Escape') { hideSuggest(); input.blur(); }
  });
  suggest.addEventListener('mousedown', (event) => {
    const li = event.target.closest('li');
    if (li) { event.preventDefault(); hideSuggest(); input.blur(); location.hash = `#/watch/${li.dataset.id}`; }
  });
  $('#search').addEventListener('submit', (event) => {
    event.preventDefault();
    if (suggestIndex >= 0 && suggestItems[suggestIndex]) {
      const { id } = suggestItems[suggestIndex];
      hideSuggest();
      input.blur();
      location.hash = `#/watch/${id}`;
      return;
    }
    const q = input.value.trim();
    hideSuggest();
    input.blur();
    if (q) location.hash = `#/search/${encodeURIComponent(q)}`;
  });

  /* ---------- Page-level events ---------- */
  document.addEventListener('click', async (event) => {
    const save = event.target.closest('[data-save]');
    if (save) { event.preventDefault(); toggleSaved(save.dataset.save); return; }

    const length = event.target.closest('[data-length]');
    if (length) { view.length = length.dataset.length; rerenderKeepScroll(); return; }

    const seek = event.target.closest('[data-seek]');
    if (seek) { player.seek(Number(seek.dataset.seek)); $('#player')?.scrollIntoView({ block: 'center', behavior: 'smooth' }); return; }

    const target = event.target.closest('button');
    if (!target) return;
    if (target.id === 'theater-btn') {
      toggleTheater();
    } else if (target.id === 'watched') {
      const id = route().id;
      const done = !state.history[id]?.done;
      touchHistory(id, { done, t: done ? state.history[id]?.t || 0 : 0 });
      syncWatchedButton(id);
      toast(done ? 'Marked as watched' : 'Marked as not watched');
    } else if (target.id === 'share') {
      const t = player.api?.getCurrentTime?.();
      const url = `${location.href.split('?')[0]}${t > 5 ? `?t=${Math.floor(t)}` : ''}`;
      try {
        await navigator.clipboard.writeText(url);
        toast(t > 5 ? `Link copied at ${fmtDur(t)}` : 'Link copied');
      } catch {
        toast('Copying was blocked by the browser');
      }
    } else if (target.id === 'clear-history') {
      state.history = {};
      persist();
      render();
      toast('History cleared');
    }
  });

  document.addEventListener('change', (event) => {
    const el = event.target;
    if (el.id === 'sort') { view.sort = el.value; rerenderKeepScroll(); }
    else if (el.id === 'hide-watched') { view.hideWatched = el.checked; rerenderKeepScroll(); }
    else if (el.id === 'autoplay') { state.autoplay = el.checked; persist(); }
  });

  function rerenderKeepScroll() {
    const y = window.scrollY;
    const focusId = document.activeElement?.id;
    const focusLength = document.activeElement?.dataset?.length;
    render();
    window.scrollTo(0, y);
    if (focusId) document.getElementById(focusId)?.focus();
    else if (focusLength) $(`[data-length="${focusLength}"]`)?.focus();
  }

  function toggleTheater() {
    state.theater = !state.theater;
    persist();
    $('#watch')?.classList.toggle('theater', state.theater);
    $('#theater-btn')?.setAttribute('aria-pressed', String(state.theater));
  }

  document.addEventListener('keydown', (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if (event.key === '/') {
      event.preventDefault();
      input.focus();
      input.select();
      return;
    }
    if (route().name !== 'watch' || !BY_ID.has(route().id)) return;
    if (event.key === 't') toggleTheater();
    else if (event.key === 'w') toggleSaved(route().id);
    else if (event.key === 'n') goNext();
  });

  // Hide a failed thumbnail. Error events don't bubble, so this listens in the capture phase.
  document.addEventListener('error', (event) => {
    if (event.target?.tagName === 'IMG') event.target.closest('.thumb')?.classList.add('broken');
  }, true);

  window.addEventListener('storage', (event) => {
    if (event.key !== STORE_KEY || !event.newValue) return;
    try {
      const incoming = JSON.parse(event.newValue);
      state.later = (incoming.later || []).filter((id) => BY_ID.has(id));
      state.history = incoming.history || {};
      renderSidebar();
    } catch { /* Ignore a malformed write from another tab. */ }
  });

  /* ---------- Boot ---------- */
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  syncTheme();
  syncNav();
  render();
})();
