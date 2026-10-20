// English Refinery service worker: offline app shell + cached PDF engine.
const VERSION = 'er-0.6.1';
const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/5.4.624/';
const CDN_FILES = [PDFJS + 'pdf.min.mjs', PDFJS + 'pdf.worker.min.mjs'];
const SHELL = ['./', './index.html'];

const ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="96" fill="#101b2e"/>' +
  '<rect x="112" y="150" width="288" height="36" rx="18" fill="#9ec5b2"/><rect x="112" y="238" width="220" height="36" rx="18" fill="#c9a862"/>' +
  '<rect x="112" y="326" width="150" height="36" rx="18" fill="#d98c80"/></svg>';

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(VERSION);
    await Promise.all(SHELL.map(async (u) => {
      try { const r = await fetch(u, { cache: 'reload' }); if (r.ok) await c.put(u, r); } catch (err) { /* offline install: shell cached on next visit */ }
    }));
    // pdf.js URLs carry the version, so a copy from an earlier cache is the same file; reuse it
    // (an update installed on a flaky connection keeps the PDF engine when the old cache goes)
    await Promise.all(CDN_FILES.map(async (u) => {
      try {
        const old = await caches.match(u);
        if (old) { await c.put(u, old); return; }
        const r = await fetch(u, { mode: 'cors', credentials: 'omit' }); if (r.ok) await c.put(u, r);
      } catch (err) { /* cached on first use */ }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    // caches belong to the whole site, not this folder: other apps on the same github.io address
    // (Mashita) keep theirs, so only this app's old caches go
    for (const k of await caches.keys()) if (k.startsWith('er-') && k !== VERSION) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    const base = new URL(self.registration.scope).pathname;
    const rel = url.pathname.startsWith(base) ? url.pathname.slice(base.length) : url.pathname;
    if (rel === 'manifest.webmanifest') { e.respondWith(manifest()); return; }
    if (rel === 'icon.svg') { e.respondWith(new Response(ICON_SVG, { headers: { 'Content-Type': 'image/svg+xml' } })); return; }
    if (rel === 'icon-192.png' || rel === 'icon-512.png') { e.respondWith(iconPng(rel === 'icon-192.png' ? 192 : 512)); return; }
    if (req.mode === 'navigate' || rel === '' || rel === 'index.html') { e.respondWith(networkFirst(req)); return; }
    e.respondWith(cacheFirst(req));
    return;
  }
  if (url.hostname === 'cdnjs.cloudflare.com') e.respondWith(cacheFirst(req));
  // OCR engine and model (versioned URLs): cached on first use so later OCR works offline
  else if (url.hostname === 'cdn.jsdelivr.net' && /^\/npm\/(tesseract\.js|tesseract\.js-core|@tesseract\.js-data\/eng)@\d/.test(url.pathname)) e.respondWith(cacheFirst(req, true));
});

// shell: network first (2.5 s), cache when offline or slow
async function networkFirst(req) {
  const c = await caches.open(VERSION);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 2500);
  try {
    const r = await fetch(req.url, { signal: ctl.signal, credentials: 'same-origin', cache: 'no-cache' });
    clearTimeout(timer);
    if (r.ok) await c.put('./index.html', r.clone());
    return r;
  } catch (err) {
    clearTimeout(timer);
    return (await c.match('./index.html')) || (await c.match('./')) || new Response('Offline and not cached yet.', { status: 503, headers: { 'Content-Type': 'text/plain' } });
  }
}

async function cacheFirst(req, opaqueOk) {
  const c = await caches.open(VERSION);
  const hit = await c.match(req, { ignoreVary: true, ignoreSearch: false });
  if (hit) return hit;
  try {
    const r = await fetch(req);
    if ((r.ok && (r.type === 'basic' || r.type === 'cors')) || (opaqueOk && r.type === 'opaque')) await c.put(req, r.clone());
    return r;
  } catch (err) {
    return new Response('', { status: 504 });
  }
}

function manifest() {
  const scope = self.registration.scope;
  const m = {
    name: 'English Refinery', short_name: 'Refinery', id: scope, start_url: scope, scope,
    display: 'standalone', orientation: 'any', background_color: '#0c1524', theme_color: '#101b2e',
    icons: [
      { src: scope + 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: scope + 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: scope + 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
    ],
  };
  return new Response(JSON.stringify(m), { headers: { 'Content-Type': 'application/manifest+json' } });
}

async function iconPng(size) {
  try {
    const cv = new OffscreenCanvas(size, size);
    const g = cv.getContext('2d');
    const s = size / 512;
    g.fillStyle = '#101b2e'; g.fillRect(0, 0, size, size);
    const bar = (y, w, col) => { g.fillStyle = col; g.beginPath(); g.roundRect(112 * s, y * s, w * s, 36 * s, 18 * s); g.fill(); };
    bar(150, 288, '#9ec5b2'); bar(238, 220, '#c9a862'); bar(326, 150, '#d98c80');
    const blob = await cv.convertToBlob({ type: 'image/png' });
    return new Response(blob, { headers: { 'Content-Type': 'image/png' } });
  } catch (err) {
    return new Response(ICON_SVG, { headers: { 'Content-Type': 'image/svg+xml' } });
  }
}
