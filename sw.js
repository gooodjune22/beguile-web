// Beguile 서비스 워커 (오프라인). 아래 두 자리 표시는 tools/deploy_web.ps1이 채운다.
// 채워지지 않은 빌드(Builds/WebGL을 그대로 연 개발용)에서는 페이지가 이 파일을 등록하지 않는다.
//
// - 설치: 파일 목록을 내려받아 SHA-256을 확인한 뒤 버전별 캐시에 넣는다 (배포 도중 옛/새 파일이 섞여 저장되는 것을 막음).
//   하나라도 실패하면(저장 공간 부족, 네트워크) 그 캐시를 지우고 로그만 남긴다 -> 게임은 네트워크로 정상 동작.
//   다음에 페이지를 열면 다시 시도한다 (메시지 "ensure").
// - 요청: 완성된 캐시 우선, 없으면 네트워크. 미완성 캐시는 쓰지 않는다.
// - 새 버전: 페이지가 "skip-waiting"을 보낼 때까지 기다린다 (두는 중에 바뀌지 않게). 활성화되면 이전 캐시를 지운다.
// - 캐시는 github.io 출처 전체가 공유하므로 이름에 scope를 넣고, 우리 이름으로 시작하는 것만 지운다.
"use strict";
const VERSION = "20261125-143327-1c210bb";
const FILES = [
  { path: "Build/WebGL.data", sha256: "fd9212ce5224caba2b57c026cb8158e39985c0420ed3de752c904367fbf3f171" },
  { path: "Build/WebGL.framework.js", sha256: "049d415ca90e2d3304c1c4249b5ac74c2d87550d6158a06050934ecb25409f29" },
  { path: "Build/WebGL.loader.js", sha256: "34bfe4a50d25661cc15592d18523de60b96a118f7b17d2b19652f70d0b2c6ea4" },
  { path: "Build/WebGL.wasm", sha256: "8255dfd59ed54a1dcf0277fbaa062e10534cd0e33686a2e3c5b0c9d7fdacd949" },
  { path: "index.html", sha256: "aabec8e120a8f26f0b9ba98c92865ce17f24e6d809b2506c835e02ec7bdf6144" },
  { path: "manifest.json", sha256: "fa4db8af97a7e1f830e9212c86525e9d4c1288924cdb33a8bf9f9c84670d6e79" },
  { path: "TemplateData/beguile-pwa.js", sha256: "be955d096f69c93312f6b5dbdacbf5c34f87f246e7de49598c8f9727e17187c5" },
  { path: "TemplateData/icons/apple-touch-icon-180.png", sha256: "ab0241861acc61d289757aa5040aad3bcdbb44b9b0142c2077d7f6e5b1138d0b" },
  { path: "TemplateData/icons/icon-192.png", sha256: "299d4baa4eda99b1aabb2c723f8d32636c3ea41d6ae7b1a72466e2a64843b24c" },
  { path: "TemplateData/icons/icon-512.png", sha256: "3089fd5a3f3ad704d010c374613343388c64ce9ea1596ef68ce49c2c01b98cd1" },
  { path: "TemplateData/icons/icon-maskable-512.png", sha256: "2b23c142ade9c35a2a0bb255b010bc4f6811947273ae1594c5fdc3f326ab42a4" }
]; // [{ path, sha256 }]
const PREFIX = "beguile|" + self.registration.scope + "|";
const CACHE = PREFIX + VERSION;
const DONE = new URL("__complete__", self.registration.scope).href; // 모든 파일이 들어갔다는 표시
let filling = null;

function log(msg) { console.log("[beguile-sw " + VERSION + "] " + msg); }
function urlOf(path) { return new URL(path, self.registration.scope).href; }

async function sha256(buf) {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", buf));
  return Array.from(h, (b) => b.toString(16).padStart(2, "0")).join("");
}

function contentType(path, res) {
  if (path.endsWith(".wasm")) return "application/wasm"; // 서버 MIME과 무관하게 스트리밍 컴파일이 되도록
  return res.headers.get("Content-Type") || "application/octet-stream";
}

async function download(f) {
  // Build/*는 페이지가 방금 받은 것(HTTP 캐시, 버전이 붙은 주소)을 다시 쓰고, 해시가 다르면 서버에서 새로 받는다.
  const modes = f.path.startsWith("Build/") ? ["default", "reload"] : ["reload"];
  for (const mode of modes) {
    const res = await fetch(urlOf(f.path) + "?v=" + VERSION, { cache: mode });
    if (!res.ok) throw new Error(f.path + " HTTP " + res.status);
    const buf = await res.arrayBuffer();
    if ((await sha256(buf)) === f.sha256)
      return new Response(buf, { headers: { "Content-Type": contentType(f.path, res), "Content-Length": String(buf.byteLength) } });
  }
  throw new Error(f.path + " 해시 불일치 (배포가 아직 퍼지는 중일 수 있음)");
}

async function isComplete() {
  if (!(await caches.has(CACHE))) return false;
  return !!(await (await caches.open(CACHE)).match(DONE));
}

async function fill() {
  try {
    if (await isComplete()) return true;
    const cache = await caches.open(CACHE);
    for (const f of FILES) { // 메모리를 아끼려고 하나씩
      if (await cache.match(urlOf(f.path))) continue;
      await cache.put(urlOf(f.path), await download(f));
    }
    await cache.put(DONE, new Response(VERSION));
    log("캐시 완료 (" + FILES.length + "개)");
    return true;
  } catch (e) {
    log("캐시 실패, 온라인으로만 동작: " + (e && e.message || e));
    try { await caches.delete(CACHE); } catch (e2) { }
    return false;
  }
}

function ensure() {
  if (!filling) filling = fill().finally(() => { filling = null; });
  return filling;
}

self.addEventListener("install", (e) => { e.waitUntil(ensure()); });

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    try {
      for (const k of await caches.keys())
        if (k.startsWith(PREFIX) && k !== CACHE) { await caches.delete(k); log("이전 캐시 삭제: " + k); }
    } catch (err) { log("이전 캐시 삭제 실패: " + err.message); }
    await self.clients.claim();
  })());
});

self.addEventListener("message", (e) => {
  const m = e.data || {};
  if (m.type === "skip-waiting") self.skipWaiting();
  else if (m.type === "ensure")
    e.waitUntil(ensure().then((ok) => { if (e.source) e.source.postMessage({ type: "cache-state", version: VERSION, ok: ok }); }));
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const bare = url.href.split(/[?#]/)[0];
  if (!bare.startsWith(self.registration.scope)) return;
  if (bare.endsWith("/version.json")) return; // 새 버전 확인은 항상 네트워크
  e.respondWith((async () => {
    try {
      if (await isComplete()) {
        const cache = await caches.open(CACHE);
        // 어떤 쿼리(?level= 등)로 열어도 같은 index.html
        const isPage = req.mode === "navigate" && (bare === self.registration.scope || bare.endsWith("/index.html"));
        const hit = await cache.match(isPage ? urlOf("index.html") : bare);
        if (hit) return hit;
      }
    } catch (err) { log("캐시 읽기 실패: " + err.message); }
    return fetch(req);
  })());
});
