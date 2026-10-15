import { defineConfig, type Plugin } from 'vite';
import preact from '@preact/preset-vite';

function serviceWorker(): Plugin {
  return {
    name: 'bukulapak-sw',
    apply: 'build',
    generateBundle(_opts, bundle) {
      const assets = Object.keys(bundle).filter((f) => !f.endsWith('.map') && !f.startsWith('icons/') && f !== 'sw.js');
      const version = Date.now().toString(36);
      const precache = ['/', ...assets.map((f) => `/${f}`), '/manifest.webmanifest', '/icons/icon.svg', '/icons/icon-192.png'];
      const lazy = new Set(assets.filter((f) => /report|xlsx/.test(f)).map((f) => `/${f}`));
      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: `const CACHE = 'bukulapak-${version}';
const PRECACHE = ${JSON.stringify(precache.filter((p) => !lazy.has(p)))};
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).catch(() => caches.match('/')));
    return;
  }
  e.respondWith(
    caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
      return res;
    })),
  );
});
`,
      });
    },
  };
}

export default defineConfig({
  plugins: [preact(), serviceWorker()],
  server: { proxy: { '/api': { target: 'http://127.0.0.1:8787', ws: true } } },
  build: { target: 'es2020', sourcemap: false },
});
