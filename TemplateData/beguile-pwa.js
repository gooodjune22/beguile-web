// 서비스 워커 등록, 새 버전 안내, 버전 표시 (index.html이 먼저 window.BEGUILE_VERSION을 정한다).
//   ?nosw=1  서비스 워커를 끄고 이 사이트의 Beguile 캐시를 지운다 (개발용, 문제 해결용). 게임 기록(IndexedDB)은 지우지 않는다.
// 이 파일의 어떤 실패도 게임을 막지 않는다 (콘솔 로그만).
(function () {
  "use strict";
  var VERSION = window.BEGUILE_VERSION;
  var isDev = VERSION === "dev";
  var query = new URLSearchParams(location.search);
  var scope = new URL("./", location.href).href.split(/[?#]/)[0];
  var prefix = "beguile|" + scope + "|";
  var info = window.beguilePwa = { version: VERSION, state: isDev ? "dev" : "off", offlineReady: false, update: null };
  function log(m) { console.log("[beguile-pwa] " + m); }

  // ---- 화면 표시 (게임 캔버스 위의 작은 HTML, 글꼴은 기기 글꼴)
  var label = document.getElementById("version");
  if (label) label.textContent = "version " + VERSION;
  function hideLabelLater() { setTimeout(function () { if (label) label.style.display = "none"; }, 6000); }

  // 페이지 안내 글 (게임의 문자열 표와 별개: 게임 밖의 HTML이다). 언어는 게임이 정한 window.beguileLang, 아직 없으면 ?lang, 브라우저 언어 순
  var TEXT = {
    ko: { later: "나중에", offline: "오프라인 준비 완료", update: "새 버전이 있습니다", reload: "새로고침" },
    en: { later: "Later", offline: "Ready to play offline", update: "A new version is available", reload: "Reload" }
  };
  function T(key) {
    var l = window.beguileLang || query.get("lang") || ((navigator.language || "").indexOf("ko") === 0 ? "ko" : "en");
    return (TEXT[l] || TEXT.en)[key];
  }

  var toast = document.getElementById("toast"), toastTimer = 0;
  function addButton(text, cls, onClick) {
    var b = document.createElement("button");
    b.textContent = text;
    b.className = cls;
    b.addEventListener("click", onClick);
    toast.appendChild(b);
  }
  function hideToast() { toast.style.display = "none"; }
  function showToast(text, button, onClick, ms) {
    if (!toast) return;
    clearTimeout(toastTimer);
    toast.textContent = "";
    var span = document.createElement("span");
    span.textContent = text;
    toast.appendChild(span);
    if (button) { addButton(button, "", onClick); addButton(T("later"), "plain", hideToast); }
    toast.style.display = "flex";
    if (ms) toastTimer = setTimeout(hideToast, ms);
  }

  function clearOurCaches() {
    if (!window.caches) return Promise.resolve();
    return caches.keys().then(function (ks) {
      return Promise.all(ks.filter(function (k) { return k.indexOf(prefix) === 0; }).map(function (k) { return caches.delete(k); }));
    });
  }
  function unregisterOurs() {
    return navigator.serviceWorker.getRegistrations().then(function (rs) {
      return Promise.all(rs.filter(function (r) { return r.scope === scope; }).map(function (r) { return r.unregister(); }));
    });
  }
  // 새로고침 전에 진행 중인 판을 저장하고 IndexedDB에 반영될 시간을 잠깐 준다
  function saveThen(fn) {
    try { if (window.unityInstance) window.unityInstance.SendMessage("Beguile", "OnWebPageHidden"); } catch (e) { }
    setTimeout(fn, 600);
  }

  window.beguileAfterLoad = hideLabelLater;   // 게임이 뜬 뒤 index.html이 부른다 (아래에서 등록까지 하도록 바꿈)

  if (!("serviceWorker" in navigator)) { log("서비스 워커를 쓸 수 없음 (https 또는 localhost에서만)"); return; }

  if (query.get("nosw") === "1") {
    info.state = "nosw";
    Promise.all([unregisterOurs(), clearOurCaches()]).then(function () {
      log("nosw: 서비스 워커와 캐시를 지움");
      // 이 페이지 자체가 옛 서비스 워커에서 왔으면 한 번만 다시 연다
      if (navigator.serviceWorker.controller && !sessionStorage.getItem("beguile-nosw")) {
        sessionStorage.setItem("beguile-nosw", "1");
        location.reload();
      } else sessionStorage.removeItem("beguile-nosw");
    }).catch(function (e) { log("nosw 실패: " + e.message); });
    return;
  }
  if (isDev) return;

  var reloading = false, wantReload = false, reg = null;
  navigator.serviceWorker.addEventListener("controllerchange", function () {
    if (wantReload && !reloading) { reloading = true; location.reload(); } // 사용자가 새로고침을 눌렀을 때만
  });
  function readFlag() { try { return localStorage.getItem("beguile-ready") === VERSION; } catch (e) { return true; } }
  function writeFlag() { try { localStorage.setItem("beguile-ready", VERSION); } catch (e) { } }
  navigator.serviceWorker.addEventListener("message", function (e) {
    var m = e.data || {};
    if (m.type !== "cache-state" || m.version !== VERSION) return;
    if (m.ok) {
      info.offlineReady = true;
      info.state = "offline-ready";
      if (!readFlag()) { writeFlag(); if (!info.update) showToast(T("offline") + " (" + VERSION + ")", null, null, 5000); }
    } else {
      info.state = "online-only";
      log("오프라인 저장 실패: 온라인으로만 동작합니다");
    }
  });

  function announce(version) {
    if (!version || info.update) return;
    info.update = version;
    log("새 버전 감지: " + version + " (지금 " + VERSION + ")");
    showToast(T("update"), T("reload"), function () {
      hideToast();
      saveThen(function () {
        if (reg && reg.waiting) { wantReload = true; reg.waiting.postMessage({ type: "skip-waiting" }); return; }
        // 새 서비스 워커가 없으면(설치 실패 등) 지우고 네트워크에서 새로 연다
        var go = function () { location.reload(); };
        Promise.all([unregisterOurs(), clearOurCaches()]).then(go, go);
      });
    });
  }

  // 서버의 version.json(캐시하지 않음)과 비교한다. 오프라인이면 아무것도 하지 않는다.
  function serverVersion() {
    return fetch("version.json?t=" + Date.now(), { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { return j && j.version && j.version !== VERSION ? j.version : null; })
      .catch(function () { return null; });
  }
  function check() {
    if (!reg || info.update || navigator.onLine === false) return;
    serverVersion().then(function (v) {
      if (!v) return;
      if (reg.waiting) { announce(v); return; }
      reg.update().then(function () {
        var sw = reg.installing;
        if (!sw) { if (reg.waiting) announce(v); return; }   // sw.js가 아직 옛것이면(CDN 전파 중) 다음 확인 때
        sw.addEventListener("statechange", function () { if (sw.state !== "installing") announce(v); });
      }).catch(function (e) { log("갱신 확인 실패: " + e.message); });
    });
  }

  // 게임이 다 뜬 뒤 등록한다 (첫 로딩과 46MB 저장이 겹치지 않게)
  window.beguileAfterLoad = function () {
    hideLabelLater();
    navigator.serviceWorker.register("sw.js", { scope: "./", updateViaCache: "none" }).then(function (r) {
      reg = r;
      info.state = "registered";
      navigator.serviceWorker.ready.then(function (rr) { if (rr.active) rr.active.postMessage({ type: "ensure" }); });
      check();
      document.addEventListener("visibilitychange", function () { if (!document.hidden) check(); });
      setInterval(check, 30 * 60 * 1000);
    }).catch(function (e) { log("등록 실패 (게임은 온라인으로 동작): " + e.message); });
  };
})();
