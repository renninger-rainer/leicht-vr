/* LEICHT Service Worker: entschlüsselt die Seiten und Bilder aus enc/ nach der Anmeldung.
   Ohne gültige Sitzung werden Seitenaufrufe zur Anmeldung umgeleitet. */
const BASE = new URL('./', self.registration.scope).pathname;
const OFFEN = new Set(['', 'index.html', 'sw.js', '404.html', 'schluessel.json', 'README.md', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png']);
const TYP = { html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', json: 'application/json', webp: 'image/webp',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', svg: 'image/svg+xml', md: 'text/markdown; charset=utf-8', txt: 'text/plain; charset=utf-8', glb: 'model/gltf-binary', exr: 'image/x-exr' };
let sitz = null;
const idb = () => new Promise((res, rej) => { const r = indexedDB.open('leicht', 1); r.onupgradeneeded = () => r.result.createObjectStore('k'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
async function sitzung() {
  if (sitz && sitz.bis > Date.now()) return sitz;
  sitz = null;
  try { const db = await idb(); const s = await new Promise(res => { const t = db.transaction('k').objectStore('k').get('sitzung'); t.onsuccess = () => res(t.result || null); t.onerror = () => res(null); });
    if (s && s.bis > Date.now() && s.K) sitz = s; } catch (e) { }
  return sitz;
}
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('message', e => { if (e.data === 'abmelden' || e.data === 'neu') sitz = null; });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (u.origin !== location.origin || e.request.method !== 'GET' || !u.pathname.startsWith(BASE)) return;
  const rel = decodeURIComponent(u.pathname.slice(BASE.length));
  if (OFFEN.has(rel) || rel.startsWith('enc/')) return;
  e.respondWith(liefern(e.request, u, rel));
});
async function liefern(req, u, rel) {
  const s = await sitzung();
  if (!s) {
    if (req.mode === 'navigate') return Response.redirect(BASE + '?weiter=' + encodeURIComponent(u.pathname + u.search), 302);
    return new Response('Nicht angemeldet', { status: 403 });
  }
  let p = rel;
  if (p === '' || p.endsWith('/')) p += 'index.html';
  else if (!/\.[a-z0-9]+$/i.test(p)) return Response.redirect(u.pathname + '/' + u.search, 301);
  let r = await fetch(BASE + 'enc/' + p.split('/').map(encodeURIComponent).join('/'));
  if (!r.ok) return new Response('Nicht gefunden', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  let buf = await r.arrayBuffer(), klar;
  try { klar = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: buf.slice(0, 12) }, s.K, buf.slice(12)); }
  catch (err) { // evtl. veraltete Datei im Zwischenspeicher: einmal frisch laden
    r = await fetch(BASE + 'enc/' + p.split('/').map(encodeURIComponent).join('/'), { cache: 'reload' }); buf = await r.arrayBuffer();
    try { klar = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: buf.slice(0, 12) }, s.K, buf.slice(12)); }
    catch (e2) { if (req.mode === 'navigate') return Response.redirect(BASE + '?neu=1&weiter=' + encodeURIComponent(u.pathname + u.search), 302); return new Response('Schlüssel passt nicht', { status: 403 }); }
  }
  const ext = (p.match(/\.([a-z0-9]+)$/i) || [, ''])[1].toLowerCase();
  return new Response(klar, { headers: { 'Content-Type': TYP[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache' } });
}
