import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  initializeFirestore, getFirestore, persistentLocalCache, persistentMultipleTabManager,
  doc, collection, addDoc, setDoc, updateDoc, deleteDoc,
  getDoc, getDocs, onSnapshot, serverTimestamp,
  query, where, orderBy, limit,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signOut,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyAx1DsvOcDSiDvPYG32Nw6wiFRQz8X5PB8",
  authDomain: "howardworld.firebaseapp.com",
  projectId: "howardworld",
  storageBucket: "howardworld.firebasestorage.app",
  messagingSenderId: "940701312592",
  appId: "1:940701312592:web:8882de89e067b9a727d355",
};
const app = initializeApp(firebaseConfig);
// 오프라인 캐시(IndexedDB) — 한 번 불러온 여행/일정을 데이터 없이도 열람
let db;
try {
  db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
} catch {
  db = getFirestore(app); // 미지원 환경 → 메모리 캐시 기본
}

// Auth를 시작 시점에 등록 → Firestore가 처음부터 인증 토큰을 첨부(관리자 조회에 필요)
const auth = getAuth(app);
const ADMIN_EMAIL = "romeowa@gmail.com";

// 서비스워커 등록 (앱 셸 오프라인)
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
}

// 오프라인 표시 배너
function updateOnlineBanner() {
  let el = document.querySelector(".offline-bar");
  if (!navigator.onLine) {
    if (!el) { el = h(`<div class="offline-bar">오프라인 · 저장된 일정만 보여요</div>`); document.body.appendChild(el); }
  } else if (el) el.remove();
}
window.addEventListener("online", updateOnlineBanner);
window.addEventListener("offline", updateOnlineBanner);

// 구글 API 키 — config.js(깃 미포함)에서 주입. 리퍼러+API 제한된 브라우저 키.
const PLACES_KEY = (window.TRIP_CONFIG && window.TRIP_CONFIG.googleKey) || "";

// 구글맵 동적 로더 (google.maps.importLibrary 부트스트랩)
(g => { let h, a, k, p = "The Google Maps JavaScript API", c = "google", l = "importLibrary", q = "__ib__", m = document, b = window; b = b[c] || (b[c] = {}); const d = b.maps || (b.maps = {}), r = new Set(), e = new URLSearchParams(), u = () => h || (h = new Promise(async (f, n) => { a = m.createElement("script"); e.set("libraries", [...r] + ""); for (k in g) e.set(k.replace(/[A-Z]/g, t => "_" + t[0].toLowerCase()), g[k]); e.set("callback", c + ".maps." + q); a.src = `https://maps.${c}apis.com/maps/api/js?` + e; d[q] = f; a.onerror = () => h = n(Error(p + " could not load.")); a.nonce = m.querySelector("script[nonce]")?.nonce || ""; m.head.append(a); })); d[l] ? console.warn(p + " only loads once. Ignoring:", g) : d[l] = (f, ...n) => r.add(f) && u().then(() => d[l](f, ...n)); })({ key: PLACES_KEY, v: "weekly", language: "ko" });

const APP = document.getElementById("app");
const TYPES = {
  place: { emoji: "📍", label: "장소" },
  food: { emoji: "🍜", label: "식사" },
  activity: { emoji: "🎡", label: "액티비티" },
  note: { emoji: "📝", label: "메모" },
};

// ---------- 유틸 ----------
const h = (html) => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; };
const esc = (s) => (s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

function toast(msg) {
  let el = document.querySelector(".toast");
  if (!el) { el = h(`<div class="toast"></div>`); document.body.appendChild(el); }
  el.textContent = msg;
  requestAnimationFrame(() => el.classList.add("show"));
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove("show"), 1800);
}

const WEEK = ["일", "월", "화", "수", "목", "금", "토"];
function dayLabel(startDate, idx) {
  if (!startDate) return { top: `Day ${idx + 1}`, sub: "" };
  const d = new Date(startDate + "T00:00:00");
  d.setDate(d.getDate() + idx);
  return { top: `Day ${idx + 1}`, sub: `${d.getMonth() + 1}/${d.getDate()} (${WEEK[d.getDay()]})` };
}

// 최근 연 여행 기억 — 달력 배치에 쓸 시작일/일수도 함께 저장
// info: 문자열(제목) 또는 {title, startDate, dayCount}
function rememberTrip(id, info) {
  const t = typeof info === "string" ? { title: info } : (info || {});
  let list = [];
  try { list = JSON.parse(localStorage.getItem("recentTrips") || "[]"); } catch {}
  const prev = list.find((x) => x.id === id) || {};
  list = list.filter((x) => x.id !== id);
  list.unshift({
    id,
    title: t.title || prev.title || "제목 없는 여행",
    startDate: t.startDate !== undefined ? t.startDate : (prev.startDate ?? null),
    dayCount: t.dayCount !== undefined ? t.dayCount : (prev.dayCount ?? 1),
    ts: Date.now(),
  });
  try { localStorage.setItem("recentTrips", JSON.stringify(list.slice(0, 24))); } catch {}
}

// ---------- 광고 푸터 (만든 사람의 다른 앱) ----------
function promoFooter() {
  const ua = navigator.userAgent;
  const isIOS = /iPhone|iPad|iPod/.test(ua);
  const apps = [
    {
      name: "피그맵", icon: "/promo-pigmap.jpg", desc: "한국의 모든 핫플레이스 지도",
      href: isIOS
        ? "https://apps.apple.com/app/id6471933646"
        : "https://play.google.com/store/apps/details?id=home.sweet.pigmap",
    },
    {
      name: "니니구", icon: "/promo-ninigu.jpg", desc: "친구가 이어주는 새로운 만남",
      href: isIOS ? "https://apps.apple.com/app/id6754002478" : "https://ninigu.net",
    },
  ];
  const el = h(`<footer class="promo">
    <div class="promo-title">만든 사람의 다른 앱</div>
    <div class="promo-cards">
      ${apps.map((a) => `<a class="promo-card" href="${a.href}" target="_blank" rel="noopener" data-promo="${esc(a.name)}">
        <img class="pc-icon" src="${a.icon}" alt="${a.name}" width="34" height="34" loading="lazy" />
        <span class="pc-text"><span class="pc-name">${a.name}</span><span class="pc-desc">${a.desc}</span></span>
        <span class="pc-go">→</span>
      </a>`).join("")}
    </div>
  </footer>`);
  el.querySelectorAll(".promo-card").forEach((c) =>
    c.addEventListener("click", () => logEvent("promo_click", { promo: c.dataset.promo }))
  );
  return el;
}

// ---------- 사용 로그 (events 컬렉션) ----------
// 앱 활동을 가볍게 기록. 개인 식별 정보 없이 유형·트립ID·기기ID만. 조회는 관리자만(규칙).
function deviceId() {
  let d;
  try { d = localStorage.getItem("deviceId"); } catch {}
  if (!d) { d = Math.random().toString(36).slice(2, 10); try { localStorage.setItem("deviceId", d); } catch {} }
  return d;
}
// 디바이스 환경(OS · 브라우저 · 폼팩터) — 개인 식별 아닌 대략치
function platformInfo() {
  const ua = navigator.userAgent || "";
  let os = "기타";
  if (/iPhone|iPad|iPod/.test(ua)) os = "iOS";
  else if (/Android/.test(ua)) os = "Android";
  else if (/Macintosh|Mac OS X/.test(ua)) os = "macOS";
  else if (/Windows/.test(ua)) os = "Windows";
  else if (/Linux/.test(ua)) os = "Linux";
  let br = "기타";
  if (/Edg\//.test(ua)) br = "Edge";
  else if (/SamsungBrowser/.test(ua)) br = "Samsung";
  else if (/CriOS/.test(ua)) br = "Chrome";
  else if (/FxiOS|Firefox\//.test(ua)) br = "Firefox";
  else if (/OPR\/|Opera/.test(ua)) br = "Opera";
  else if (/Chrome\//.test(ua)) br = "Chrome";
  else if (/Safari\//.test(ua)) br = "Safari";
  const form = /Mobi|iPhone|iPod|Android.*Mobile/.test(ua) ? "모바일" : (/iPad|Tablet/.test(ua) ? "태블릿" : "데스크톱");
  return { os, br, form };
}
// IP 기반 대략 위치(국가·도시) — 권한 팝업 없음, 세션당 1회 조회 후 캐시
let _geo = null, _geoDone = false, _geoPromise = null;
function fetchGeo() {
  if (_geoDone) return Promise.resolve(_geo);
  if (_geoPromise) return _geoPromise;
  _geoPromise = fetch("https://ipwho.is/?fields=success,country_code,city,region")
    .then((r) => r.json())
    .then((j) => { if (j && j.success !== false) _geo = { country: j.country_code || null, city: j.city || null }; })
    .catch(() => {})
    .finally(() => { _geoDone = true; });
  return _geoPromise;
}
async function logEvent(type, extra = {}) {
  const p = platformInfo();
  try { await fetchGeo(); } catch {}
  const g = _geo || {};
  try {
    addDoc(collection(db, "events"), {
      type, app: "trip-planner", ts: serverTimestamp(), dev: deviceId(),
      os: p.os, br: p.br, form: p.form, country: g.country || null, city: g.city || null, ...extra,
    });
  } catch {}
}

// ---------- 라우팅 ----------
let unsubTrip = null, unsubItems = null;
function cleanup() {
  if (unsubTrip) unsubTrip(); if (unsubItems) unsubItems();
  if (unsubExpenses) unsubExpenses();
  unsubTrip = unsubItems = unsubExpenses = null;
  document.querySelector(".modal-bg")?.remove();
}
function go(path) { history.pushState({}, "", path); route(); }
window.addEventListener("popstate", route);

function route() {
  cleanup();
  const m = location.pathname.match(/^\/t\/([A-Za-z0-9_-]+)/);
  if (location.pathname === "/admin") renderAdmin();
  else if (m) renderTrip(m[1]);
  else renderHome();
}

// ---------- 홈 (월별 달력) ----------
const TRIP_COLORS = ["#0f766e", "#b45309", "#6d5bd0", "#be123c", "#4d7c0f", "#0369a1"];
const hashId = (s) => { let n = 0; for (let i = 0; i < s.length; i++) n = (n * 31 + s.charCodeAt(i)) >>> 0; return n; };
const parseDate = (s) => new Date(s + "T00:00:00");
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const dayDiff = (a, b) => Math.round((b - a) / 86400000);
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const fmtMD = (d) => `${d.getMonth() + 1}.${d.getDate()}`;

let homeMonth = null;          // 현재 보는 달 (해당 월 1일 Date)
let homeView = "month";        // "month" | "list"
let homeTrips = [];            // 홈에 표시 중인 여행 (메모리 캐시)

// 홈: localStorage 캐시로 즉시 렌더 → 백그라운드로 Firestore 최신화
function renderHome() {
  let recent = [];
  try { recent = JSON.parse(localStorage.getItem("recentTrips") || "[]"); } catch {}
  homeTrips = recent
    .map((r) => ({ id: r.id, title: r.title || "제목 없는 여행", startDate: r.startDate ?? null, dayCount: r.dayCount ?? 1, ts: r.ts || 0 }))
    .filter((t) => !pendingDeletes.has(t.id));
  paintHome();
  refreshHomeTrips(recent);
}

// 순수 렌더 (네트워크 대기 없음) — 달 이동도 이걸로 즉시 다시 그림
function paintHome() {
  homeTrips.forEach((t) => { t.color = TRIP_COLORS[hashId(t.id) % TRIP_COLORS.length]; });
  if (!homeMonth) { const now = new Date(); homeMonth = new Date(now.getFullYear(), now.getMonth(), 1); }

  APP.innerHTML = "";
  const shell = h(`<div class="home-shell"></div>`);
  const y = homeMonth.getFullYear(), m = homeMonth.getMonth();
  const header = h(`
    <div class="cal-head">
      <div class="cal-title">
        <span class="cal-my">${y}년 ${m + 1}월</span>
        <span class="cal-nav">
          <button class="cal-arrow" id="prevM" title="이전 달">‹</button>
          <button class="cal-arrow" id="nextM" title="다음 달">›</button>
          <button class="cal-today" id="todayBtn">오늘</button>
        </span>
      </div>
      <div class="cal-actions">
        <button class="btn ghost sm" id="importAll">가져오기</button>
        <button class="btn ghost sm" id="exportAll">내보내기</button>
        <button class="btn sm" id="newTrip">+ 새 여행</button>
      </div>
    </div>`);
  shell.appendChild(header);
  header.querySelector("#newTrip").addEventListener("click", createTrip);
  header.querySelector("#importAll").addEventListener("click", importTripsFromHome);
  header.querySelector("#exportAll").addEventListener("click", (e) => exportAllTrips(e.currentTarget));
  header.querySelector("#prevM").addEventListener("click", () => { homeMonth = new Date(y, m - 1, 1); paintHome(); });
  header.querySelector("#nextM").addEventListener("click", () => { homeMonth = new Date(y, m + 1, 1); paintHome(); });
  header.querySelector("#todayBtn").addEventListener("click", () => { const n = new Date(); homeMonth = new Date(n.getFullYear(), n.getMonth(), 1); paintHome(); });

  shell.appendChild(buildCalendar(homeMonth, homeTrips));
  APP.appendChild(shell);
  APP.appendChild(promoFooter());
}

// 백그라운드: 각 여행 최신 정보 조회 → 캐시 갱신, 달라졌을 때만 다시 그림
async function refreshHomeTrips(recent) {
  if (!recent.length) return;
  const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);
  const arr = new Array(recent.length).fill(null);
  await Promise.all(recent.map(async (r, i) => {
    try {
      const snap = await withTimeout(getDoc(doc(db, "trips", r.id)), 5000);
      if (!snap.exists()) return; // 삭제됨 → 목록에서 제외
      const d = snap.data();
      arr[i] = { id: r.id, title: d.title || "제목 없는 여행", startDate: d.startDate || null, dayCount: d.dayCount || 1, ts: r.ts || 0 };
    } catch {
      arr[i] = { id: r.id, title: r.title || "제목 없는 여행", startDate: r.startDate ?? null, dayCount: r.dayCount ?? 1, ts: r.ts || 0 };
    }
  }));
  const fresh = arr.filter(Boolean).filter((t) => !pendingDeletes.has(t.id));
  try { localStorage.setItem("recentTrips", JSON.stringify(fresh.map((t) => ({ id: t.id, title: t.title, startDate: t.startDate, dayCount: t.dayCount, ts: t.ts })))); } catch {}
  if (location.pathname !== "/") return;
  const sig = (list) => JSON.stringify(list.map((t) => [t.id, t.title, t.startDate, t.dayCount]));
  if (sig(fresh) !== sig(homeTrips)) { homeTrips = fresh; paintHome(); }
}

// 달력 그리드 + 여행 막대
function buildCalendar(month, trips) {
  const y = month.getFullYear(), m = month.getMonth();
  const first = new Date(y, m, 1);
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const gridStart = addDays(first, -first.getDay());          // 그리드 첫 칸(일요일)
  const weekCount = Math.ceil((first.getDay() + daysInMonth) / 7);
  const gridEnd = addDays(gridStart, weekCount * 7 - 1);
  const today = new Date();

  // 이 그리드에 걸치는 여행 → 레인 배정(겹치면 아래 줄로)
  const placed = trips
    .filter((t) => t.startDate)
    .map((t) => { const s = parseDate(t.startDate); return { ...t, s, e: addDays(s, (t.dayCount || 1) - 1) }; })
    .filter((t) => t.e >= gridStart && t.s <= gridEnd)
    .sort((a, b) => a.s - b.s || b.e - a.e);
  const laneEnds = [];
  placed.forEach((t) => {
    let lane = laneEnds.findIndex((end) => end < t.s);
    if (lane === -1) { lane = laneEnds.length; laneEnds.push(t.e); } else laneEnds[lane] = t.e;
    t.lane = lane;
  });
  const laneCount = Math.max(1, laneEnds.length);

  const cal = h(`<div class="cal"></div>`);
  cal.appendChild(h(`<div class="cal-week-head">${["일","월","화","수","목","금","토"].map((d) => `<div>${d}</div>`).join("")}</div>`));

  for (let w = 0; w < weekCount; w++) {
    const weekStart = addDays(gridStart, w * 7);
    const weekEnd = addDays(weekStart, 6);
    const week = h(`<div class="cal-week" style="--lanes:${laneCount}"></div>`);
    // 날짜 칸
    for (let i = 0; i < 7; i++) {
      const d = addDays(weekStart, i);
      const inMonth = d.getMonth() === m;
      const isToday = sameDay(d, today);
      const cell = h(`<div class="cal-cell ${inMonth ? "" : "out"}">
        <span class="cal-day ${isToday ? "today" : ""}">${d.getDate()}</span>
      </div>`);
      cell.addEventListener("click", () => { homeMonth = new Date(y, m, 1); });
      week.appendChild(cell);
    }
    // 이 주에 걸치는 여행 막대
    placed.filter((t) => t.e >= weekStart && t.s <= weekEnd).forEach((t) => {
      const segS = t.s < weekStart ? weekStart : t.s;
      const segE = t.e > weekEnd ? weekEnd : t.e;
      const col = segS.getDay();
      const span = dayDiff(segS, segE) + 1;
      const contL = t.s < weekStart, contR = t.e > weekEnd;
      const bar = h(`<button class="cal-bar" title="${esc(t.title)}"></button>`);
      bar.style.left = `calc(${(col / 7) * 100}% + 3px)`;
      bar.style.width = `calc(${(span / 7) * 100}% - 6px)`;
      bar.style.top = `calc(26px + ${t.lane} * 21px)`;
      bar.style.background = t.color;
      if (contL) { bar.style.borderTopLeftRadius = "0"; bar.style.borderBottomLeftRadius = "0"; }
      if (contR) { bar.style.borderTopRightRadius = "0"; bar.style.borderBottomRightRadius = "0"; }
      bar.textContent = (!contL || col === 0) ? t.title : "";
      bar.addEventListener("click", (e) => { e.stopPropagation(); go(`/t/${t.id}`); });
      week.appendChild(bar);
    });
    cal.appendChild(week);
  }

  // 전체 여행 목록 (날짜 있는 것 먼저, 시작일 오름차순 → 날짜 미정)
  const foot = h(`<div class="cal-foot"></div>`);
  if (trips.length) {
    const monthLast = new Date(y, m + 1, 0);
    const inThisMonth = (t) => {
      if (!t.startDate) return false;
      const s = parseDate(t.startDate), e = addDays(s, (t.dayCount || 1) - 1);
      return e >= first && s <= monthLast;
    };
    const sorted = [...trips].sort((a, b) => {
      if (a.startDate && b.startDate) return parseDate(a.startDate) - parseDate(b.startDate);
      if (a.startDate) return -1;
      if (b.startDate) return 1;
      return 0;
    });
    foot.appendChild(h(`<div class="cal-foot-title">전체 여행 ${trips.length}</div>`));
    sorted.forEach((t) => {
      const sub = t.startDate
        ? `${fmtMD(parseDate(t.startDate))} — ${fmtMD(addDays(parseDate(t.startDate), (t.dayCount || 1) - 1))} · ${t.dayCount}일`
        : "시작일 미정";
      const row = tripRow(t, sub);
      if (inThisMonth(t)) row.classList.add("this-month"); // 이번 달 여행 강조
      foot.appendChild(row);
    });
  } else {
    foot.appendChild(h(`<div class="cal-foot-empty">아직 잡힌 여행이 없어요. “+ 새 여행”으로 시작해 보세요.</div>`));
  }
  cal.appendChild(foot);
  return cal;
}

// 목록 뷰 (전체 최근 여행)
function buildTripList(trips) {
  const box = h(`<div class="cal-foot list-view"></div>`);
  if (!trips.length) { box.appendChild(h(`<div class="cal-foot-empty">아직 연 여행이 없어요. “+ 새 여행”으로 시작해 보세요.</div>`)); return box; }
  trips.forEach((t) => {
    const sub = t.startDate ? `${fmtMD(parseDate(t.startDate))} 시작 · ${t.dayCount}일` : "시작일 미정";
    box.appendChild(tripRow(t, sub));
  });
  return box;
}

function tripRow(t, sub) {
  const row = h(`<a class="trip-row" href="/t/${t.id}">
    <span class="tr-bar" style="background:${t.color}"></span>
    <span class="tr-body"><span class="tr-name">${esc(t.title)}</span><span class="tr-sub">${esc(sub)}</span></span>
    <button class="tr-del" title="목록에서 제거">✕</button>
    <span class="tr-go">›</span>
  </a>`);
  row.addEventListener("click", (e) => { e.preventDefault(); go(`/t/${t.id}`); });
  // 홈에서는 '삭제'가 아니라 '이 기기 목록에서 제거'만 (실제 삭제는 여행 안에서)
  row.querySelector(".tr-del").addEventListener("click", (e) => {
    e.preventDefault(); e.stopPropagation();
    forgetTrip(t.id);
  });
  return row;
}

// 홈 목록에서만 제거 (여행 데이터는 그대로 — 링크로 다시 열 수 있음)
function forgetTrip(id) {
  try {
    const list = JSON.parse(localStorage.getItem("recentTrips") || "[]").filter((x) => x.id !== id);
    localStorage.setItem("recentTrips", JSON.stringify(list));
  } catch {}
  toast("목록에서 제거했어요");
  renderHome();
}

// 실행취소(undo) 기반 소프트 삭제
const pendingDeletes = new Set();   // 삭제 대기 중(UI에서 숨김) 여행 id
let undoState = null;               // { id, timer }

function commitPendingDelete() {
  if (!undoState) return;
  const { id, timer } = undoState; clearTimeout(timer); undoState = null;
  if (pendingDeletes.delete(id)) { logEvent("trip_delete", { trip: id }); deleteTripFull(id).catch((e) => console.error("삭제 실패", e)); }
  const t = document.querySelector(".toast"); if (t) t.classList.remove("show");
}

// 여행 삭제 요청 — 즉시 숨기고 5초간 실행취소 토스트. 시간 지나면 실제 삭제.
function softDeleteTrip(id, title) {
  if (pendingDeletes.has(id)) return;
  commitPendingDelete();              // 직전 대기건은 바로 확정
  pendingDeletes.add(id);
  if (location.pathname === "/") renderHome();   // 홈이면 목록에서 숨김
  else { cleanup(); go("/"); }                   // 여행 화면이면 홈으로

  let el = document.querySelector(".toast");
  if (!el) { el = h(`<div class="toast"></div>`); document.body.appendChild(el); }
  clearTimeout(el._t);
  el.innerHTML = `<span>‘${esc(title || "여행")}’ 삭제됨</span><button class="toast-undo">실행취소</button>`;
  void el.offsetWidth;               // 강제 리플로우 후 표시 (async 리렌더와 무관하게 확실히)
  el.classList.add("show");
  const timer = setTimeout(commitPendingDelete, 6000);
  undoState = { id, timer };
  el.querySelector(".toast-undo").addEventListener("click", () => {
    clearTimeout(timer); undoState = null; el.classList.remove("show");
    if (pendingDeletes.delete(id) && location.pathname === "/") renderHome();
  });
}

// 여행 + 하위 항목 전부 삭제 + 최근 목록에서 제거 (공용)
async function deleteTripFull(id) {
  const snap = await getDocs(collection(db, "trips", id, "items"));
  await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
  await deleteDoc(doc(db, "trips", id));
  try {
    const list = JSON.parse(localStorage.getItem("recentTrips") || "[]").filter((x) => x.id !== id);
    localStorage.setItem("recentTrips", JSON.stringify(list));
  } catch {}
}

async function createTrip() {
  const btn = document.getElementById("newTrip");
  if (btn) { btn.disabled = true; btn.textContent = "만드는 중…"; }
  try {
    const ref = await addDoc(collection(db, "trips"), {
      title: "새 여행", startDate: null, dayCount: 3, createdAt: serverTimestamp(),
    });
    rememberTrip(ref.id, { title: "새 여행", startDate: null, dayCount: 3 });
    logEvent("trip_create", { trip: ref.id });
    go(`/t/${ref.id}`);
  } catch (e) {
    toast("생성 실패: " + e.message);
    if (btn) { btn.disabled = false; btn.textContent = "+ 새 여행 만들기"; }
  }
}

// ---------- 내보내기 / 가져오기 ----------
const EXPORT_VERSION = 1;
const sanitizeName = (s) => (s || "여행").replace(/[\\/:*?"<>|]+/g, "_").trim().slice(0, 60) || "여행";
function downloadJSON(filename, obj) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function pickJSONFile(cb) {
  const inp = document.createElement("input");
  inp.type = "file"; inp.accept = "application/json,.json";
  inp.addEventListener("change", () => {
    const f = inp.files && inp.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => cb(String(r.result || ""), f.name);
    r.onerror = () => toast("파일을 읽지 못했어요");
    r.readAsText(f);
  });
  inp.click();
}
// 저장용 trip 번들 (createdAt 등 서버 필드는 제외)
const cleanTrip = (t) => ({
  title: t.title || "새 여행", startDate: t.startDate ?? null, dayCount: t.dayCount || 1,
  members: t.members || [], memberColors: t.memberColors || {},
  expenseCategories: t.expenseCategories || null,
});
const stripId = (d) => { const { id, createdAt, ...rest } = d; return rest; };
async function fetchTripBundle(id) {
  const tsnap = await getDoc(doc(db, "trips", id));
  if (!tsnap.exists()) throw new Error("여행을 찾을 수 없어요");
  const [is, es] = await Promise.all([
    getDocs(collection(db, "trips", id, "items")),
    getDocs(collection(db, "trips", id, "expenses")),
  ]);
  return {
    trip: cleanTrip(tsnap.data()),
    items: is.docs.map((d) => stripId({ ...d.data() })),
    expenses: es.docs.map((d) => stripId({ ...d.data() })),
  };
}
function exportCurrentTrip() {
  if (!trip) return;
  const bundle = { app: "trip-planner", kind: "trip", version: EXPORT_VERSION, exportedAt: new Date().toISOString(),
    trip: cleanTrip(trip), items: items.map(stripId), expenses: expenses.map(stripId) };
  downloadJSON(`${sanitizeName(trip.title)}.json`, bundle);
  toast("이 여행을 내보냈어요");
}
async function exportAllTrips(btn) {
  let recent = [];
  try { recent = JSON.parse(localStorage.getItem("recentTrips") || "[]"); } catch {}
  if (!recent.length) { toast("내보낼 여행이 없어요"); return; }
  if (btn) { btn.disabled = true; btn.textContent = "내보내는 중…"; }
  try {
    const bundles = [];
    for (const r of recent) { try { bundles.push(await fetchTripBundle(r.id)); } catch {} }
    if (!bundles.length) { toast("내보낼 여행이 없어요"); return; }
    downloadJSON(`trips-backup-${ymd(new Date())}.json`, { app: "trip-planner", kind: "trips", version: EXPORT_VERSION, exportedAt: new Date().toISOString(), trips: bundles });
    toast(`${bundles.length}개 여행을 내보냈어요`);
  } finally { if (btn) { btn.disabled = false; btn.textContent = "내보내기"; } }
}
function parseBundles(text) {
  let data; try { data = JSON.parse(text); } catch { return null; }
  if (data && data.kind === "trips" && Array.isArray(data.trips)) return data.trips.filter((x) => x && x.trip);
  if (data && (data.kind === "trip" || data.trip)) return [{ trip: data.trip, items: data.items, expenses: data.expenses }];
  return null;
}
async function createTripFromBundle(b) {
  const t = cleanTrip(b.trip || {});
  const base = { title: t.title, startDate: t.startDate, dayCount: t.dayCount, members: t.members, memberColors: t.memberColors, createdAt: serverTimestamp() };
  if (t.expenseCategories) base.expenseCategories = t.expenseCategories;
  const ref = await addDoc(collection(db, "trips"), base);
  await Promise.all([
    ...((b.items || []).map((it) => addDoc(collection(db, "trips", ref.id, "items"), { ...stripId(it), createdAt: serverTimestamp() }))),
    ...((b.expenses || []).map((ex) => addDoc(collection(db, "trips", ref.id, "expenses"), { ...stripId(ex), createdAt: serverTimestamp() }))),
  ]);
  return ref.id;
}
// 파일에서 새 여행으로 추가 (홈·여행 화면 공용)
function importTripsFromHome() {
  pickJSONFile(async (text) => {
    const bundles = parseBundles(text);
    if (!bundles || !bundles.length) { toast("올바른 여행 파일이 아니에요"); return; }
    toast("가져오는 중…");
    let ok = 0, lastId = null;
    for (const b of bundles) { try { lastId = await createTripFromBundle(b); const ct = cleanTrip(b.trip || {}); rememberTrip(lastId, { title: ct.title, startDate: ct.startDate, dayCount: ct.dayCount }); ok++; } catch {} }
    if (!ok) { toast("가져오기 실패"); return; }
    if (ok === 1 && lastId) { toast("여행을 가져왔어요"); go(`/t/${lastId}`); }
    else { toast(`${ok}개 여행을 가져왔어요`); if (location.pathname === "/") renderHome(); else go("/"); }
  });
}

// ---------- 여행 화면 ----------
let trip = null;       // {title, startDate, dayCount}
let items = [];        // [{id, ...}]
let curDay = 0;
let viewDay = null;    // null = 전체 보기, 숫자 = 그 날짜만 보기
let tripId = null;
let dayMap = null;
let markerById = {};   // 항목 id → 지도 마커 (리스트 클릭 시 지도 이동용)
let skipRememberOnce = false;  // admin에서 열람 시 홈 최근목록에 기록 안 함

// ---------- 정산 상태 ----------
const DEFAULT_CATS = ["숙박", "식사", "교통", "간식", "관광", "기타"];
let expenses = [];             // [{id, date, category, desc, amount, payer, sharedBy:[names], place, day}]
let unsubExpenses = null;      // 정산 내역 실시간 구독 (여행 화면 동안 유지)
let tripTab = "plan";          // "plan"(일정) | "settle"(정산)
let inlineAdd = null;          // 데스크톱 상단 인라인 추가 폼 상태 {day, date, category, payer}
const won = (n) => (Math.round(Number(n) || 0)).toLocaleString("ko-KR");

// 참여자 색상 팔레트 (이름 → 아바타 색)
const MEMBER_COLORS = ["#0f766e", "#b45309", "#6d5bd0", "#be123c", "#0369a1", "#4d7c0f", "#9d174d", "#0e7490"];
// 카테고리 색상 (기본 구분 + 커스텀은 해시로 배정)
const CAT_COLORS = { "숙박": "#6d5bd0", "식사": "#b45309", "교통": "#0369a1", "간식": "#be123c", "관광": "#4d7c0f", "기타": "#6f6a5f" };
const CAT_PALETTE = ["#0f766e", "#b45309", "#6d5bd0", "#be123c", "#0369a1", "#4d7c0f", "#9d174d", "#0e7490"];
// 참여자별 색: 추가 시 trip.memberColors에 저장한 랜덤 색을 우선, 없으면 이름 해시로 폴백
const memberColor = (name) => (trip && trip.memberColors && trip.memberColors[name]) || MEMBER_COLORS[hashId(String(name || "")) % MEMBER_COLORS.length];
const catColor = (c) => CAT_COLORS[c] || CAT_PALETTE[hashId(String(c || "기타")) % CAT_PALETTE.length];
const initOf = (name) => (String(name || "?").trim()[0] || "?").toUpperCase();

function renderTrip(id) {
  tripId = id;
  trip = null; items = []; expenses = []; curDay = 0; viewDay = null; dayMap = null; tripTab = "plan"; inlineAdd = null;
  const remember = !skipRememberOnce; skipRememberOnce = false;
  APP.innerHTML = `<div class="loading">여행을 불러오는 중…</div>`;
  if (remember) logEvent("trip_open", { trip: id });

  unsubTrip = onSnapshot(doc(db, "trips", id), (snap) => {
    if (!snap.exists()) { APP.innerHTML = `<div class="wrap home"><h1>🔍</h1><p class="sub">여행을 찾을 수 없어요. 링크가 정확한지 확인해 주세요.</p><button class="btn ghost" onclick="location.href='/'">홈으로</button></div>`; cleanup(); return; }
    trip = snap.data();
    if (remember) rememberTrip(id, { title: trip.title, startDate: trip.startDate ?? null, dayCount: trip.dayCount ?? 1 });
    paint();
  }, (err) => { APP.innerHTML = `<div class="loading">불러오기 실패: ${esc(err.message)}</div>`; });

  unsubItems = onSnapshot(collection(db, "trips", id, "items"), (snap) => {
    items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    if (trip) paint();
  });

  unsubExpenses = onSnapshot(collection(db, "trips", id, "expenses"), (snap) => {
    expenses = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    if (trip && tripTab === "settle") paint();
  });
}

// 항상 시간순 정렬 (시간 없는 항목은 뒤로, 그 안에서는 추가된 순서)
function sortedItems(dayItems) {
  return dayItems.slice().sort((a, b) => {
    const ta = a.time || "99:99", tb = b.time || "99:99";
    if (ta !== tb) return ta < tb ? -1 : 1;
    return (a.order || 0) - (b.order || 0);
  });
}

function paint() {
  if (!trip) return;
  openInlineId = null;
  if (viewDay != null && viewDay >= trip.dayCount) viewDay = null;
  curDay = viewDay != null ? viewDay : 0;

  // 표시할 날짜: 전체(null)면 모든 날, 특정 날이면 그 날만
  const dayList = viewDay != null ? [viewDay] : [...Array(trip.dayCount).keys()];
  // 지도 핀: 표시 중인 날들의 항목만 (일자→시간 순)
  const ordered = items.slice().sort((a, b) =>
    (a.day - b.day) || ((a.time || "99:99") < (b.time || "99:99") ? -1 : (a.time === b.time ? (a.order || 0) - (b.order || 0) : 1)));
  const pinned = ordered.filter((it) => dayList.includes(it.day) && it.lat != null);
  const hasMap = pinned.length > 0;

  APP.innerHTML = "";
  // 상단 바 (지도 있으면 넓은 폭으로)
  const bar = h(`
    <div class="topbar"><div class="topbar-inner ${hasMap ? "wide" : ""}">
      <a class="home-link" href="/" title="홈으로 가기">← 홈</a>
      <input class="trip-title" value="${esc(trip.title)}" placeholder="여행 제목" />
      <button class="btn ghost sm" id="share">🔗 링크</button>
    </div></div>`);
  APP.appendChild(bar);
  const titleInput = bar.querySelector(".trip-title");
  titleInput.addEventListener("change", () => updateDoc(doc(db, "trips", tripId), { title: titleInput.value.trim() || "새 여행" }));
  bar.querySelector(".home-link").addEventListener("click", (e) => { e.preventDefault(); go("/"); });
  bar.querySelector("#share").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(location.href); toast("링크를 복사했어요"); }
    catch { prompt("이 링크를 공유하세요:", location.href); }
  });

  // 여행 전체를 감싸는 셸 (지도 있으면 넓게, 정산 탭도 넓게)
  const shell = h(`<div class="trip-shell ${hasMap || tripTab === "settle" ? "wide" : ""}"></div>`);

  // 일정 / 정산 탭
  const tabs = h(`<div class="trip-tabs">
    <button class="tt ${tripTab === "plan" ? "on" : ""}" data-tab="plan">일정</button>
    <button class="tt ${tripTab === "settle" ? "on" : ""}" data-tab="settle">정산</button>
  </div>`);
  tabs.querySelectorAll(".tt").forEach((b) => b.addEventListener("click", () => {
    if (tripTab === b.dataset.tab) return;
    tripTab = b.dataset.tab;
    if (tripTab === "settle") logEvent("settle_open", { trip: tripId });
    paint();
  }));
  shell.appendChild(tabs);

  // 정산 탭
  if (tripTab === "settle") {
    renderSettleView(shell);
    APP.appendChild(shell);
    APP.appendChild(promoFooter());
    return;
  }

  // 시작일 · 종료일 (종료일은 시작일+일수에서 파생; 종료일을 바꾸면 일수가 재계산됨)
  const endVal = trip.startDate ? ymd(addDays(parseDate(trip.startDate), trip.dayCount - 1)) : "";
  const meta = h(`<div class="trip-meta">
    <label>시작 <input type="date" id="startDate" value="${trip.startDate || ""}"/></label>
    <label>종료 <input type="date" id="endDate" value="${endVal}" min="${trip.startDate || ""}" ${trip.startDate ? "" : "disabled title='시작일을 먼저 선택하세요'"}/></label>
    <span class="count">${trip.dayCount}일 · ${items.length}곳</span>
  </div>`);
  meta.querySelector("#startDate").addEventListener("change", (e) =>
    updateDoc(doc(db, "trips", tripId), { startDate: e.target.value || null }));
  meta.querySelector("#endDate").addEventListener("change", (e) => {
    if (!trip.startDate || !e.target.value) return;
    const days = dayDiff(parseDate(trip.startDate), parseDate(e.target.value)) + 1;
    if (days < 1) { toast("종료일이 시작일보다 빨라요"); paint(); return; }
    updateDoc(doc(db, "trips", tripId), { dayCount: days });
  });
  shell.appendChild(meta);

  // Day 탭 — "전체"(전 일정) + 날짜별(그 날만 필터)
  const days = h(`<div class="days"></div>`);
  const allTab = h(`<button class="day-tab ${viewDay == null ? "active" : ""}">전체<span class="dd">${trip.dayCount}일</span></button>`);
  allTab.addEventListener("click", () => { viewDay = null; paint(); });
  days.appendChild(allTab);
  for (let i = 0; i < trip.dayCount; i++) {
    const { top, sub } = dayLabel(trip.startDate, i);
    const tab = h(`<button class="day-tab ${viewDay === i ? "active" : ""}">${top}<span class="dd">${sub}</span></button>`);
    tab.addEventListener("click", () => { viewDay = i; paint(); });
    days.appendChild(tab);
  }
  const addDay = h(`<button class="day-tab add" title="날짜 추가">+ 날</button>`);
  addDay.addEventListener("click", () => updateDoc(doc(db, "trips", tripId), { dayCount: trip.dayCount + 1 }));
  days.appendChild(addDay);
  shell.appendChild(days);

  // 본문: 넓으면 타임라인 | 지도 2단, 좁으면 세로 1단(지도 아래)
  const body = h(`<div class="trip-body ${hasMap ? "has-map" : ""}"></div>`);
  const main = h(`<div class="trip-main"></div>`);

  // 타임라인 (전체면 날짜 섹션 전부, 특정 날이면 그 날만)
  const list = h(`<div class="timeline"></div>`);
  dayList.forEach((i) => {
    const { top, sub } = dayLabel(trip.startDate, i);
    const dayItems = sortedItems(items.filter((it) => it.day === i));
    const sec = h(`<div class="day-sec" id="daysec-${i}"></div>`);
    sec.appendChild(h(`<div class="day-sec-head"><span class="ds-top">${top}</span><span class="ds-sub">${esc(sub)}</span></div>`));
    dayItems.forEach((it) => sec.appendChild(itemCard(it)));
    const add = h(`<button class="tl-add">＋ 이 날에 장소 추가</button>`);
    add.addEventListener("click", () => openEditor(null, i));
    sec.appendChild(add);
    list.appendChild(sec);
  });
  main.appendChild(list);
  body.appendChild(main);

  // 지도 (핀이 있으면): 넓으면 오른쪽 스티키, 좁으면 타임라인 아래
  if (hasMap) {
    const aside = h(`<div class="trip-aside"><div id="dayMap"></div></div>`);
    body.appendChild(aside);
  }
  shell.appendChild(body);

  // 마지막 날 삭제 (비어있을 때만) — 본문 아래 전체 폭
  if (trip.dayCount > 1) {
    const lastEmpty = items.filter((it) => it.day === trip.dayCount - 1).length === 0;
    if (lastEmpty) {
      const del = h(`<div style="text-align:center;margin-top:14px"><button class="btn danger sm" id="delDay">− 마지막 날(Day ${trip.dayCount}) 삭제</button></div>`);
      del.querySelector("#delDay").addEventListener("click", () => {
        updateDoc(doc(db, "trips", tripId), { dayCount: trip.dayCount - 1 });
        if (curDay >= trip.dayCount - 1) curDay = trip.dayCount - 2;
      });
      shell.appendChild(del);
    }
  }

  // 내보내기 / 가져오기(새 여행으로 복제)
  const io = h(`<div class="trip-io"><button class="btn ghost sm" id="expTrip">⬇ 이 여행 내보내기</button><button class="btn ghost sm" id="impTrip">⬆ 가져오기(새 여행)</button></div>`);
  io.querySelector("#expTrip").addEventListener("click", exportCurrentTrip);
  io.querySelector("#impTrip").addEventListener("click", importTripsFromHome);
  shell.appendChild(io);

  // 여행 전체 삭제
  const delTrip = h(`<div style="text-align:center;margin-top:16px"><button class="btn danger sm" id="delTrip">🗑 이 여행 삭제</button></div>`);
  delTrip.querySelector("#delTrip").addEventListener("click", () => softDeleteTrip(tripId, trip.title));
  shell.appendChild(delTrip);

  APP.appendChild(shell);
  APP.appendChild(promoFooter());
  if (pinned.length) renderDayMap(pinned);
}

// ---------- 날씨 (Open-Meteo · API 키 불필요) ----------
const WMO_EMOJI = (code) => {
  if (code === 0) return "☀️";
  if (code === 1 || code === 2) return "⛅";
  if (code === 3) return "☁️";
  if (code === 45 || code === 48) return "🌫️";
  if (code >= 51 && code <= 57) return "🌦️";
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return "🌧️";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "🌨️";
  if (code >= 95) return "⛈️";
  return "🌡️";
};
const weatherCache = new Map(); // key -> Promise<{code,tmax,tmin}|null>
function getWeather(date, lat, lng) {
  const key = `${date}|${lat.toFixed(2)}|${lng.toFixed(2)}`;
  if (weatherCache.has(key)) return weatherCache.get(key);
  const p = (async () => {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto&start_date=${date}&end_date=${date}`;
    const res = await fetch(url);
    const j = await res.json();
    const d = j.daily;
    if (d && d.time && d.time.length && d.temperature_2m_max[0] != null) {
      return { code: d.weather_code[0], tmax: Math.round(d.temperature_2m_max[0]), tmin: Math.round(d.temperature_2m_min[0]) };
    }
    return null; // 예보 범위 밖(대략 -92일~+16일) 등
  })().catch(() => { weatherCache.delete(key); return null; });
  weatherCache.set(key, p);
  return p;
}

function itemCard(it) {
  const t = TYPES[it.type] || TYPES.note;
  // 주소 클릭 → 구글맵에서 해당 좌표 열기 (정확한 위치, 모바일에선 앱/웹뷰)
  const mapLink = it.lat != null ? `https://www.google.com/maps/search/?api=1&query=${it.lat},${it.lng}` : null;
  const row = h(`
    <div class="tl-row ${it.lat != null ? "clickable" : ""}" data-id="${it.id}">
      <div class="tl-time ${it.time ? "" : "empty"}">${it.time ? esc(it.time) : ""}</div>
      <div class="tl-rail"><span class="tl-dot"></span></div>
      <div class="tl-content">
        <div class="tl-head">
          <span class="tl-emoji">${t.emoji}</span>
          <span class="tl-name">${esc(it.name) || t.label}</span>
          <span class="tl-weather"></span>
          <span class="tl-acts">
            <button class="edit" title="수정">✏️</button>
            <button class="del" title="삭제">🗑️</button>
          </span>
        </div>
        ${it.address ? `<div class="tl-addr">${mapLink ? `<a href="${mapLink}" target="_blank" rel="noopener">${esc(it.address)}<span class="tl-ext"> ↗</span></a>` : esc(it.address)}</div>` : ""}
        ${it.memo ? `<div class="tl-memo">${esc(it.memo)}</div>` : ""}
        ${it.lat != null ? `<div class="tl-inlinemap"></div>` : ""}
      </div>
    </div>`);
  // 날짜(시작일+day)와 위치(핀)가 있으면 그 날/장소의 날씨 표시
  const wEl = row.querySelector(".tl-weather");
  if (wEl && trip && trip.startDate && it.lat != null && Number.isInteger(it.day)) {
    const wdate = ymd(addDays(parseDate(trip.startDate), it.day));
    getWeather(wdate, it.lat, it.lng).then((w) => {
      if (w) { wEl.textContent = `${WMO_EMOJI(w.code)} ${w.tmax}°/${w.tmin}°`; wEl.title = `${wdate} 예보 · 최고 ${w.tmax}° / 최저 ${w.tmin}°`; }
    });
  }
  row.querySelector(".edit").addEventListener("click", (e) => { e.stopPropagation(); openEditor(it); });
  row.querySelector(".del").addEventListener("click", (e) => {
    e.stopPropagation();
    if (confirm(`"${it.name || TYPES[it.type]?.label}" 삭제할까요?`)) { deleteDoc(doc(db, "trips", tripId, "items", it.id)); logEvent("item_delete", { trip: tripId }); }
  });
  // 내용 클릭 → 그 자리에서 아래로 펼치며 미니 지도(핀) 표시
  if (it.lat != null) {
    row.querySelector(".tl-content").addEventListener("click", (e) => {
      if (e.target.closest(".tl-acts") || e.target.closest("a") || e.target.closest(".tl-inlinemap")) return;
      toggleInlineMap(it, row);
    });
  }
  return row;
}

// 항목 인라인 미니 지도 (한 번에 하나만 펼침)
let openInlineId = null;
function collapseInline() {
  if (!openInlineId) return;
  const prev = document.querySelector(`.tl-row[data-id="${openInlineId}"] .tl-inlinemap`);
  if (prev) { prev.classList.remove("open"); prev.innerHTML = ""; }
  openInlineId = null;
}
async function toggleInlineMap(it, row) {
  const el = row.querySelector(".tl-inlinemap");
  if (!el) return;
  if (openInlineId === it.id) { collapseInline(); return; } // 다시 누르면 접기
  collapseInline();
  openInlineId = it.id;
  el.classList.add("open");
  el.innerHTML = `<div class="mini-loading">지도 불러오는 중…</div>`;
  try {
    await google.maps.importLibrary("maps");
    if (openInlineId !== it.id) return; // 그새 다른 걸 열었으면 취소
    el.innerHTML = "";
    const pos = { lat: it.lat, lng: it.lng };
    const map = new google.maps.Map(el, {
      center: pos, zoom: 15, disableDefaultUI: true, zoomControl: true, gestureHandling: "cooperative",
    });
    new google.maps.Marker({ position: pos, map });
  } catch {
    el.innerHTML = `<div class="mini-loading">지도를 불러오지 못했어요</div>`;
  }
}

// ---------- 이 날 지도 (구글맵) ----------
let dayFitAll = null; // "전체 보기" 콜백
async function renderDayMap(pinned) {
  const el = document.getElementById("dayMap");
  if (!el) return;
  await google.maps.importLibrary("maps");
  const map = new google.maps.Map(el, {
    mapTypeControl: false, streetViewControl: false, fullscreenControl: false, gestureHandling: "greedy",
  });
  dayMap = map;
  markerById = {};
  const bounds = new google.maps.LatLngBounds();
  const path = [];
  pinned.forEach((it, i) => {
    const pos = { lat: it.lat, lng: it.lng };
    const mk = new google.maps.Marker({
      position: pos, map,
      label: { text: String(i + 1), color: "#fff", fontWeight: "700", fontSize: "12px" },
    });
    const info = new google.maps.InfoWindow({
      content: `<div style="color:#1f2937;font-size:13px;line-height:1.45"><b>${i + 1}. ${esc(it.name || "")}</b>${it.time ? "<br>" + esc(it.time) : ""}</div>`,
    });
    mk.addListener("click", () => { info.open({ map, anchor: mk }); focusItem(it); });
    markerById[it.id] = { mk, info };
    bounds.extend(pos); path.push(pos);
  });
  // 순서대로 잇는 경로선
  if (path.length > 1) {
    new google.maps.Polyline({ path, map, strokeColor: "#0f766e", strokeOpacity: 0.85, strokeWeight: 3.5 });
  }
  dayFitAll = () => {
    if (path.length > 1) map.fitBounds(bounds, 40);
    else { map.setCenter(path[0]); map.setZoom(15); }
  };
  // "전체 보기" 버튼
  const btn = document.createElement("button");
  btn.className = "fit-all-btn"; btn.type = "button"; btn.textContent = "⤢ 전체"; btn.title = "전체 보기";
  btn.addEventListener("click", dayFitAll);
  map.controls[google.maps.ControlPosition.TOP_RIGHT].push(btn);
  dayFitAll();
}

function panTo(it) {
  if (!dayMap || it.lat == null) return;
  dayMap.panTo({ lat: it.lat, lng: it.lng });
  if (dayMap.getZoom() < 16) dayMap.setZoom(16);
}

// 핀 클릭 → 지도 확대 + 해당 항목으로 스크롤·하이라이트
function focusItem(it) {
  panTo(it);
  const row = document.querySelector(`.tl-row[data-id="${it.id}"]`);
  const c = row && row.querySelector(".tl-content");
  if (row && c) {
    row.scrollIntoView({ behavior: "smooth", block: "center" });
    c.classList.remove("flash"); void c.offsetWidth; c.classList.add("flash");
  }
}

// 리스트 항목 클릭 → 지도에서 해당 위치로 이동 + 팝업 + 지도로 스크롤
function focusOnMap(it) {
  if (!dayMap || it.lat == null) return;
  panTo(it);
  const m = markerById[it.id];
  if (m) m.info.open({ map: dayMap, anchor: m.mk });
  document.getElementById("dayMap")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  const row = document.querySelector(`.tl-row[data-id="${it.id}"]`);
  const c = row && row.querySelector(".tl-content");
  if (c) { c.classList.remove("flash"); void c.offsetWidth; c.classList.add("flash"); }
}

// ---------- 항목 편집 모달 ----------
let pickMap = null, pickMarker = null, editState = null;

function openEditor(existing, presetDay) {
  editState = existing
    ? { ...existing }
    : { day: presetDay != null ? presetDay : curDay, type: "place", name: "", address: "", lat: null, lng: null, time: "", memo: "" };

  // 24시간제 시/분 선택 옵션
  const [eh = "", em = ""] = (editState.time || "").split(":");
  const hourOpts = ['<option value="">시간 미지정</option>']
    .concat([...Array(24).keys()].map((i) => { const v = String(i).padStart(2, "0"); return `<option value="${v}" ${v === eh ? "selected" : ""}>${v}시</option>`; }))
    .join("");
  const minSet = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];
  if (em && !minSet.includes(Number(em))) minSet.push(Number(em));
  minSet.sort((a, b) => a - b);
  const minOpts = minSet.map((i) => { const v = String(i).padStart(2, "0"); return `<option value="${v}" ${v === em ? "selected" : ""}>${v}분</option>`; }).join("");

  const bg = h(`<div class="modal-bg"></div>`);
  const modal = h(`
    <div class="modal">
      <h3>${existing ? "항목 수정" : "항목 추가"}</h3>
      <div class="field">
        <label>종류</label>
        <div class="type-pick" id="typePick"></div>
      </div>
      <div class="field" id="searchField">
        <label>장소 검색 (지도)</label>
        <div class="search-box">
          <input id="q" placeholder="예: 후쿠오카 타워, 스타벅스 하카타…" autocomplete="off" />
          <div id="results"></div>
        </div>
        <div id="pickMap"></div>
        <div class="picked" id="picked"></div>
      </div>
      <div class="field"><label>이름</label><input id="name" value="${esc(editState.name)}" placeholder="장소/메뉴/활동 이름" /></div>
      <div class="field"><label>주소 · 위치</label><input id="address" value="${esc(editState.address)}" placeholder="주소 또는 위치 설명" /></div>
      <div class="field"><label>시간</label>
        <div class="time-pick"><select id="timeH">${hourOpts}</select><select id="timeM">${minOpts}</select></div>
      </div>
      <div class="field"><label>메모</label><textarea id="memo" placeholder="예약 정보, 팁, 준비물…">${esc(editState.memo)}</textarea></div>
      <div class="modal-actions">
        <button class="btn ghost" id="cancel">${existing ? "취소" : "닫기"}</button>
        <button class="btn" id="save">${existing ? "저장" : "저장 후 계속"}</button>
      </div>
    </div>`);
  bg.appendChild(modal);
  document.body.appendChild(bg);
  bg.addEventListener("click", (e) => { if (e.target === bg) close(); });

  // 종류 선택
  const typePick = modal.querySelector("#typePick");
  Object.entries(TYPES).forEach(([key, t]) => {
    const b = h(`<button class="${editState.type === key ? "on" : ""}"><span class="em">${t.emoji}</span>${t.label}</button>`);
    b.addEventListener("click", () => {
      editState.type = key;
      typePick.querySelectorAll("button").forEach((x) => x.classList.remove("on"));
      b.classList.add("on");
      modal.querySelector("#searchField").style.display = key === "note" ? "none" : "block";
    });
    typePick.appendChild(b);
  });
  if (editState.type === "note") modal.querySelector("#searchField").style.display = "none";

  const nameEl = modal.querySelector("#name");
  const addrEl = modal.querySelector("#address");
  const pickedEl = modal.querySelector("#picked");
  const updatePicked = () => { pickedEl.textContent = editState.lat != null ? `📍 위치 지정됨 (${editState.lat.toFixed(4)}, ${editState.lng.toFixed(4)})` : ""; };
  updatePicked();

  // 핀 위치 → 주소 자동 채우기 (Nominatim 역지오코딩)
  async function reverseGeocode(lat, lng) {
    const prev = addrEl.value;
    addrEl.value = "주소 불러오는 중…";
    try {
      const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&accept-language=ko&zoom=18&addressdetails=1`;
      const res = await fetch(url);
      const r = await res.json();
      // 응답 도착 사이에 다른 위치를 다시 찍었으면 무시
      if (editState.lat !== lat || editState.lng !== lng) return;
      if (r && r.display_name) {
        addrEl.value = r.display_name; editState.address = r.display_name;
        if (!nameEl.value.trim()) {
          const primary = r.name || r.display_name.split(",")[0];
          nameEl.value = primary; editState.name = primary;
        }
      } else {
        addrEl.value = prev;
      }
    } catch {
      addrEl.value = prev;
    }
  }

  // 지도 (구글맵)
  (async () => {
    await google.maps.importLibrary("maps");
    pickMap = new google.maps.Map(modal.querySelector("#pickMap"), {
      center: editState.lat != null ? { lat: editState.lat, lng: editState.lng } : { lat: 35.1796, lng: 129.0756 },
      zoom: editState.lat != null ? 15 : 4,
      mapTypeControl: false, streetViewControl: false, fullscreenControl: false, gestureHandling: "greedy",
    });
    if (editState.lat != null) setMarker(editState.lat, editState.lng);
    pickMap.addListener("click", (e) => {
      const lat = e.latLng.lat(), lng = e.latLng.lng();
      setMarker(lat, lng);
      editState.lat = lat; editState.lng = lng;
      updatePicked(); reverseGeocode(lat, lng);
    });
  })();

  function setMarker(lat, lng) {
    if (pickMarker) pickMarker.setPosition({ lat, lng });
    else {
      pickMarker = new google.maps.Marker({ position: { lat, lng }, map: pickMap, draggable: true });
      pickMarker.addListener("dragend", () => {
        const p = pickMarker.getPosition(); const la = p.lat(), ln = p.lng();
        editState.lat = la; editState.lng = ln; updatePicked(); reverseGeocode(la, ln);
      });
    }
    pickMap.panTo({ lat, lng });
    if (pickMap.getZoom() < 15) pickMap.setZoom(15);
  }

  // 검색 (Nominatim, 디바운스)
  const resultsEl = modal.querySelector("#results");
  const doSearch = debounce(async (q) => {
    if (q.length < 2) { resultsEl.innerHTML = ""; return; }
    resultsEl.innerHTML = `<div class="searching">검색 중…</div>`;
    try {
      const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": PLACES_KEY,
          "X-Goog-FieldMask": "places.displayName,places.formattedAddress,places.location",
        },
        body: JSON.stringify({ textQuery: q, languageCode: "ko" }),
      });
      const data = await res.json();
      const arr = data.places || [];
      resultsEl.innerHTML = "";
      if (!arr.length) { resultsEl.innerHTML = `<div class="searching">결과가 없어요. 지도를 눌러 직접 위치를 찍어도 됩니다.</div>`; return; }
      const box = h(`<div class="search-results"></div>`);
      arr.forEach((r) => {
        const primary = r.displayName?.text || (r.formattedAddress || "").split(",")[0];
        const addr = r.formattedAddress || "";
        const lat = r.location?.latitude, lng = r.location?.longitude;
        const b = h(`<button><div class="sr-name">${esc(primary)}</div><div class="sr-addr">${esc(addr)}</div></button>`);
        b.addEventListener("click", () => {
          if (lat != null) { editState.lat = lat; editState.lng = lng; setMarker(lat, lng); }
          if (!nameEl.value.trim()) { nameEl.value = primary; editState.name = primary; }
          addrEl.value = addr; editState.address = addr;
          updatePicked();
          resultsEl.innerHTML = ""; modal.querySelector("#q").value = "";
        });
        box.appendChild(b);
      });
      resultsEl.appendChild(box);
    } catch { resultsEl.innerHTML = `<div class="searching">검색 실패 (잠시 후 다시)</div>`; }
  }, 400);
  modal.querySelector("#q").addEventListener("input", (e) => doSearch(e.target.value.trim()));

  modal.querySelector("#cancel").addEventListener("click", close);
  modal.querySelector("#save").addEventListener("click", save);

  function close() { pickMap = null; pickMarker = null; bg.remove(); }

  async function save() {
    editState.name = nameEl.value.trim();
    editState.address = addrEl.value.trim();
    const th = modal.querySelector("#timeH").value;
    editState.time = th ? `${th}:${modal.querySelector("#timeM").value || "00"}` : "";
    editState.memo = modal.querySelector("#memo").value.trim();
    if (!editState.name && !editState.address && !editState.memo) { toast("이름이나 메모를 입력해 주세요"); return; }
    const data = {
      day: editState.day, type: editState.type, name: editState.name, address: editState.address,
      lat: editState.lat, lng: editState.lng, time: editState.time, memo: editState.memo,
    };
    try {
      if (existing) {
        await updateDoc(doc(db, "trips", tripId, "items", existing.id), data);
        close();
      } else {
        await addDoc(collection(db, "trips", tripId, "items"), { ...data, order: Date.now(), createdAt: serverTimestamp() });
        logEvent("item_add", { trip: tripId });
        // 모달을 닫지 않고 폼만 비워 이어서 입력 (날짜·종류는 유지)
        toast(`추가됨 — 이어서 입력하세요`);
        nameEl.value = ""; addrEl.value = "";
        modal.querySelector("#timeH").value = ""; modal.querySelector("#timeM").value = "00"; modal.querySelector("#memo").value = "";
        editState.name = editState.address = editState.time = editState.memo = "";
        editState.lat = editState.lng = null;
        if (pickMarker) { pickMarker.setMap(null); pickMarker = null; }
        updatePicked();
        resultsEl.innerHTML = "";
        const q = modal.querySelector("#q"); q.value = ""; q.focus();
      }
    } catch (e) { toast("저장 실패: " + e.message); }
  }
}

// ---------- 정산 ----------
const tripMembers = () => (Array.isArray(trip?.members) ? trip.members : []);
const tripCats = () => { const c = trip?.expenseCategories; return Array.isArray(c) && c.length ? c : DEFAULT_CATS; };
const saveMembers = (list) => updateDoc(doc(db, "trips", tripId), { members: list });
const saveCats = (list) => updateDoc(doc(db, "trips", tripId), { expenseCategories: list });
// 새 참여자 추가 — 기존 참여자들과 겹치지 않는 색을 랜덤 배정해 저장
async function addMember(name) {
  const members = tripMembers();
  const colors = { ...(trip.memberColors || {}) };
  if (!colors[name]) {
    const used = new Set(members.map((m) => memberColor(m)));
    const free = MEMBER_COLORS.filter((c) => !used.has(c));
    const pool = free.length ? free : MEMBER_COLORS;
    colors[name] = pool[Math.floor(Math.random() * pool.length)];
  }
  await updateDoc(doc(db, "trips", tripId), { members: [...members, name], memberColors: colors });
}

// 정산 탭 뷰 (엑셀 정산표를 여행 안으로 — 3a 디자인)
const dateForDay = (i) => (trip?.startDate ? ymd(addDays(parseDate(trip.startDate), i)) : "");
function expDay(e) {
  if (e.offTrip) return "off";
  if (Number.isInteger(e.day)) return e.day;
  if (e.date && trip?.startDate) { const d = dayDiff(parseDate(trip.startDate), parseDate(e.date)); if (d >= 0 && d < (trip.dayCount || 1)) return d; }
  return "off";
}
function dayGroupLabel(k) {
  if (k === "off") return "여행 외";
  const { top, sub } = dayLabel(trip.startDate, k);
  return sub ? `${top} · ${sub}` : top;
}
const stopsForDay = (day) => (Number.isInteger(day) ? items.filter((it) => it.day === day && (it.name || it.address)).map((it) => it.name || it.address) : []);

function renderSettleView(shell) {
  const members = tripMembers();
  const view = h(`<div class="settle-view"></div>`);

  // 참여자 (아바타 칩)
  const memSec = h(`<div class="stl-members">
    <div class="stl-mhead"><span>참여자</span><span class="mcount">${members.length}명</span></div>
    <div class="stl-mchips"></div>
    <form class="stl-madd"><input placeholder="참여자 추가" maxlength="20" autocomplete="off" /><button class="btn sm" type="submit">추가</button></form>
  </div>`);
  const chips = memSec.querySelector(".stl-mchips");
  if (!members.length) chips.appendChild(h(`<span class="stl-mempty">함께 정산할 사람을 추가하세요</span>`));
  members.forEach((m) => {
    const chip = h(`<span class="stl-mchip"><span class="av" style="background:${memberColor(m)}">${esc(initOf(m))}</span><span class="nm">${esc(m)}</span><button title="삭제">✕</button></span>`);
    chip.querySelector("button").addEventListener("click", async () => {
      const used = expenses.some((e) => e.payer === m || (e.sharedBy || []).includes(m));
      if (used && !confirm(`'${m}'님은 정산 내역에 포함돼 있어요. 빼도 기존 내역엔 남습니다. 계속할까요?`)) return;
      await saveMembers(members.filter((x) => x !== m));
    });
    chips.appendChild(chip);
  });
  memSec.querySelector(".stl-madd").addEventListener("submit", async (e) => {
    e.preventDefault();
    const inp = memSec.querySelector(".stl-madd input");
    const v = inp.value.trim();
    if (!v) return;
    if (members.includes(v)) { toast("이미 있는 참여자예요"); return; }
    inp.value = "";
    await addMember(v);
  });
  view.appendChild(memSec);

  // 모바일 '지출 추가' — 참여자 바로 아래. 예전에는 요약·정산을 지나 목록까지 내려가야
  // 보였다. 데스크톱은 목록 위 빠른 추가 폼을 쓰므로 이 버튼을 감춘다(.stl-add).
  const addBtn = h(`<button class="btn block stl-add">＋ 지출 추가</button>`);
  addBtn.addEventListener("click", () => { if (!tripMembers().length) { toast("먼저 참여자를 추가해 주세요"); return; } openExpenseForm(null); });
  view.appendChild(addBtn);

  const { names, share, paid, transfers, total } = computeSettlement();
  const avg = members.length ? total / members.length : (names.length ? total / names.length : 0);

  const byCat = {};
  expenses.forEach((e) => { const c = e.category || "기타"; byCat[c] = (byCat[c] || 0) + (Number(e.amount) || 0); });
  const catArr = Object.entries(byCat).sort((a, b) => b[1] - a[1]);

  const body = h(`<div class="stl-body"></div>`);
  const main = h(`<div class="stl-main"></div>`);
  const side = h(`<div class="stl-side"></div>`);

  // --- 요약 ---
  const sum = h(`<div class="stl-card stl-summary">
    <div class="stl-sumtop">
      <div class="stl-total"><div class="lbl">총 지출</div><div class="val">${won(total)}<span>원</span></div></div>
      <div class="stl-avg"><div class="lbl">1인 평균</div><div class="val">${won(avg)}원</div></div>
    </div>
    <div class="stl-bar"></div>
    <div class="stl-legend"></div>
  </div>`);
  const bar = sum.querySelector(".stl-bar");
  const legend = sum.querySelector(".stl-legend");
  if (total > 0) {
    catArr.forEach(([c, a]) => {
      bar.appendChild(h(`<div style="width:${(a / total) * 100}%;background:${catColor(c)}"></div>`));
      legend.appendChild(h(`<div class="lg"><span class="dot" style="background:${catColor(c)}"></span>${esc(c)} <span class="amt">${won(a)}</span></div>`));
    });
  } else {
    bar.appendChild(h(`<div style="width:100%;background:var(--line)"></div>`));
    legend.appendChild(h(`<div class="lg" style="color:var(--muted)">아직 지출이 없어요</div>`));
  }
  side.appendChild(sum);

  // --- 송금 제안 ---
  const trf = h(`<div class="stl-card stl-transfer"><div class="stl-ctitle">이렇게 보내면 끝</div></div>`);
  if (transfers.length) {
    transfers.forEach((t) => trf.appendChild(h(`<div class="trf-row">
      <span class="av sm" style="background:${memberColor(t.from)}">${esc(initOf(t.from))}</span><span class="nm">${esc(t.from)}</span>
      <span class="arr">→</span>
      <span class="av sm" style="background:${memberColor(t.to)}">${esc(initOf(t.to))}</span><span class="nm">${esc(t.to)}</span>
      <span class="sp"></span><span class="amt">${won(t.amount)}원</span>
    </div>`)));
  } else {
    trf.appendChild(h(`<div class="trf-done">${expenses.length ? "모두 정산됐어요." : "지출을 추가하면 정산 결과가 여기 표시돼요."}</div>`));
  }
  side.appendChild(trf);

  // --- 정산표 (모바일에도 표시) ---
  if (names.length) {
    const tally = h(`<div class="stl-card stl-tally">
      <div class="stl-ctitle">정산표</div>
      <div class="tl-head"><span>이름</span><span>쓴 돈</span><span>낸 돈</span><span>차액</span></div>
    </div>`);
    names.forEach((n) => {
      const net = (paid[n] || 0) - (share[n] || 0);
      const col = net > 0 ? "var(--accent-dark)" : net < 0 ? "var(--danger)" : "var(--muted)";
      const label = net > 0 ? `+${won(net)}` : net < 0 ? `${won(net)}` : "0";
      tally.appendChild(h(`<div class="tl-row"><span class="tl-nm"><span class="av sm" style="background:${memberColor(n)}">${esc(initOf(n))}</span>${esc(n)}</span><span>${won(share[n] || 0)}</span><span>${won(paid[n] || 0)}</span><span class="tl-net" style="color:${col}">${label}</span></div>`));
    });
    side.appendChild(tally);
  }

  // --- 내역 ---
  if (members.length) main.appendChild(buildInlineAdd(members, tripCats())); // 데스크톱 빠른 추가
  main.appendChild(h(`<div class="stl-listlabel">지출 내역</div>`));
  const groups = new Map();
  expenses.forEach((e) => { const k = expDay(e); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(e); });
  const keys = [...groups.keys()].sort((a, b) => (a === "off" ? 1 : b === "off" ? -1 : a - b));
  if (!expenses.length) main.appendChild(h(`<div class="stl-empty">아직 지출 내역이 없어요.<br/>‘＋ 지출 추가’로 시작하세요.</div>`));
  keys.forEach((k) => {
    const arr = groups.get(k).slice().sort((a, b) => (a.order || 0) - (b.order || 0));
    const dtotal = arr.reduce((s, e) => s + (Number(e.amount) || 0), 0);
    const sec = h(`<div class="stl-day"><div class="stl-dhead"><span>${esc(dayGroupLabel(k))}</span><span class="dt">${won(dtotal)}원</span></div></div>`);
    arr.forEach((e) => sec.appendChild(expenseRow(e, members)));
    main.appendChild(sec);
  });

  body.appendChild(main);
  body.appendChild(side);
  view.appendChild(body);
  shell.appendChild(view);
}

function expenseRow(e, members) {
  const n = (e.sharedBy || []).length || 1;
  const per = (Number(e.amount) || 0) / n;
  const dateStr = e.offTrip && e.date ? e.date : "";
  const sub = [e.payer ? `${e.payer} 결제` : "", e.place || "", dateStr].filter(Boolean).join(" · ") || `${n}명 나눔`;
  const row = h(`<div class="exp-item">
    <div class="exp-head">
      <span class="exp-cat" style="color:${catColor(e.category)};background:${catColor(e.category)}1a">${esc(e.category || "기타")}</span>
      <div class="exp-info"><div class="exp-desc">${esc(e.desc || "(내역 없음)")}</div><div class="exp-sub">${esc(sub)}</div></div>
      <div class="exp-nums"><div class="exp-amt">${won(e.amount)}</div><div class="exp-per">1인 ${won(per)}</div></div>
    </div>
    <div class="exp-avs"></div>
  </div>`);
  row.querySelector(".exp-head").addEventListener("click", () => openExpenseForm(e));
  const avs = row.querySelector(".exp-avs");
  members.forEach((m) => {
    const on = (e.sharedBy || []).includes(m);
    const b = h(`<button class="exp-av ${on ? "on" : ""}" title="${esc(m)}" style="${on ? `background:${memberColor(m)};border-color:${memberColor(m)};color:#fff` : ""}">${esc(initOf(m))}</button>`);
    b.addEventListener("click", (ev) => {
      ev.stopPropagation();
      let sb = [...(e.sharedBy || [])];
      if (sb.includes(m)) sb = sb.filter((x) => x !== m); else sb.push(m);
      if (!sb.length) { toast("최소 한 명은 포함해야 해요"); return; }
      updateDoc(doc(db, "trips", tripId, "expenses", e.id), { sharedBy: sb }).catch((err) => toast("저장 실패: " + err.message));
    });
    avs.appendChild(b);
  });
  return row;
}

function computeSettlement() {
  const set = new Set(tripMembers());
  expenses.forEach((e) => { if (e.payer) set.add(e.payer); (e.sharedBy || []).forEach((n) => set.add(n)); });
  const names = [...set];
  const share = {}, paid = {};
  let total = 0;
  names.forEach((n) => { share[n] = 0; paid[n] = 0; });
  expenses.forEach((e) => {
    const amt = Number(e.amount) || 0; total += amt;
    const sb = e.sharedBy || [];
    if (sb.length) { const per = amt / sb.length; sb.forEach((n) => { share[n] = (share[n] || 0) + per; }); }
    if (e.payer) paid[e.payer] = (paid[e.payer] || 0) + amt;
  });
  const bal = names.map((n) => ({ n, v: Math.round((paid[n] || 0) - (share[n] || 0)) }));
  const cred = bal.filter((b) => b.v > 0).sort((a, b) => b.v - a.v);
  const debt = bal.filter((b) => b.v < 0).map((b) => ({ n: b.n, v: -b.v })).sort((a, b) => b.v - a.v);
  const transfers = [];
  let i = 0, j = 0;
  while (i < debt.length && j < cred.length) {
    const pay = Math.min(debt[i].v, cred[j].v);
    if (pay > 0) transfers.push({ from: debt[i].n, to: cred[j].n, amount: pay });
    debt[i].v -= pay; cred[j].v -= pay;
    if (debt[i].v === 0) i++;
    if (cred[j].v === 0) j++;
  }
  return { names, share, paid, transfers, total };
}

// 데스크톱 상단 빠른 추가 폼 (3a desktop v2) — 언제·어디서·구분·결제자·나눠 낼 사람까지 한 줄에
function buildInlineAdd(members, cats) {
  if (!inlineAdd) inlineAdd = { day: 0, date: dateForDay(0), place: "", category: cats[0], payer: members[0], sharedBy: [...members], known: [...members] };
  if (!cats.includes(inlineAdd.category)) inlineAdd.category = cats[0];
  if (!members.includes(inlineAdd.payer)) inlineAdd.payer = members[0];
  // 새로 추가된 참여자는 자동으로 '나눠 낼 사람'에 포함
  members.forEach((m) => { if (!(inlineAdd.known || []).includes(m) && !inlineAdd.sharedBy.includes(m)) inlineAdd.sharedBy.push(m); });
  inlineAdd.known = [...members];
  inlineAdd.sharedBy = inlineAdd.sharedBy.filter((m) => members.includes(m));
  if (!inlineAdd.sharedBy.length) inlineAdd.sharedBy = [...members];
  if (inlineAdd.day !== "off" && inlineAdd.day >= (trip.dayCount || 1)) { inlineAdd.day = 0; inlineAdd.date = dateForDay(0); }

  const box = h(`<div class="stl-quickadd">
    <div class="qa-label">빠른 추가</div>
    <div class="qa-card">
      <div class="qa-r1"></div>
      <div class="qa-r2">
        <input class="qa-desc" placeholder="무엇에 썼나요?" />
        <div class="qa-amtbox"><input class="qa-amt" inputmode="numeric" placeholder="0" /><span>원</span></div>
        <button class="btn qa-submit">추가</button>
      </div>
      <div class="qa-r3">
        <span class="qa-r3lbl">나눠 낼 사람</span>
        <button type="button" class="qa-all">전체</button>
        <div class="qa-who"></div>
        <span class="qa-sp"></span>
        <span class="qa-per"></span>
      </div>
    </div>
  </div>`);
  const r1 = box.querySelector(".qa-r1");
  const whoW = box.querySelector(".qa-who");
  const descEl = box.querySelector(".qa-desc");
  const amtEl = box.querySelector(".qa-amt");
  const perEl = box.querySelector(".qa-per");

  const updatePer = () => {
    const amt = Number(amtEl.value) || 0; const n = inlineAdd.sharedBy.length;
    perEl.textContent = `${n}명 · 1인 ${n ? won(amt / n) : 0}원`;
  };
  const renderR1 = () => {
    r1.innerHTML = "";
    // 날짜 select
    const daySel = h(`<select class="qa-sel"></select>`);
    for (let i = 0; i < (trip.dayCount || 1); i++) { const { top, sub } = dayLabel(trip.startDate, i); const o = document.createElement("option"); o.value = String(i); o.textContent = `${top}${sub ? " · " + sub : ""}`; if (inlineAdd.day === i) o.selected = true; daySel.appendChild(o); }
    const offo = document.createElement("option"); offo.value = "off"; offo.textContent = "여행 외"; if (inlineAdd.day === "off") offo.selected = true; daySel.appendChild(offo);
    daySel.addEventListener("change", () => {
      inlineAdd.day = daySel.value === "off" ? "off" : Number(daySel.value);
      if (inlineAdd.day === "off") { inlineAdd.place = ""; inlineAdd.date = inlineAdd.date || ""; }
      else { inlineAdd.date = dateForDay(inlineAdd.day); if (!stopsForDay(inlineAdd.day).includes(inlineAdd.place)) inlineAdd.place = ""; }
      renderR1();
    });
    r1.appendChild(daySel);
    // 여행 외 결제일
    if (inlineAdd.day === "off") {
      const pd = h(`<input type="date" class="qa-date" value="${inlineAdd.date || ""}" title="결제일" />`);
      pd.addEventListener("change", () => { inlineAdd.date = pd.value || ""; });
      r1.appendChild(pd);
    } else {
      // 장소 select
      const stops = stopsForDay(inlineAdd.day);
      const stopSel = h(`<select class="qa-sel"></select>`);
      const none = document.createElement("option"); none.value = ""; none.textContent = stops.length ? "장소 없음" : "장소 없음(일정에 장소 추가)"; stopSel.appendChild(none);
      stops.forEach((s) => { const o = document.createElement("option"); o.value = s; o.textContent = s; if (inlineAdd.place === s) o.selected = true; stopSel.appendChild(o); });
      stopSel.addEventListener("change", () => { inlineAdd.place = stopSel.value; });
      r1.appendChild(stopSel);
    }
    r1.appendChild(h(`<span class="qa-sep"></span>`));
    // 구분 pill (색)
    const cc = catColor(inlineAdd.category);
    const catPill = h(`<span class="qa-catpill" style="background:${cc}1a"><span class="qa-catdot" style="background:${cc}"></span></span>`);
    const catSel = h(`<select class="qa-catsel" style="color:${cc}"></select>`);
    cats.forEach((c) => { const o = document.createElement("option"); o.value = c; o.textContent = c; if (inlineAdd.category === c) o.selected = true; catSel.appendChild(o); });
    catSel.addEventListener("change", () => { inlineAdd.category = catSel.value; renderR1(); });
    catPill.appendChild(catSel); r1.appendChild(catPill);
    // 결제자 pill (아바타)
    const payPill = h(`<span class="qa-paypill"><span class="qa-av" style="background:${memberColor(inlineAdd.payer)}">${esc(initOf(inlineAdd.payer))}</span></span>`);
    const paySel = h(`<select class="qa-paysel"></select>`);
    members.forEach((m) => { const o = document.createElement("option"); o.value = m; o.textContent = m; if (inlineAdd.payer === m) o.selected = true; paySel.appendChild(o); });
    paySel.addEventListener("change", () => { inlineAdd.payer = paySel.value; renderR1(); });
    payPill.appendChild(paySel); r1.appendChild(payPill);
  };
  const renderWho = () => {
    whoW.innerHTML = "";
    members.forEach((m) => {
      const on = inlineAdd.sharedBy.includes(m);
      const b = h(`<button type="button" class="qa-whopill ${on ? "on" : ""}" style="${on ? `border-color:${memberColor(m)}` : ""}"><span class="qa-av" style="background:${on ? memberColor(m) : "var(--surface-2)"};color:${on ? "#fff" : "var(--muted)"}">${esc(initOf(m))}</span><span class="nm">${esc(m)}</span></button>`);
      b.addEventListener("click", () => {
        if (inlineAdd.sharedBy.includes(m)) inlineAdd.sharedBy = inlineAdd.sharedBy.filter((x) => x !== m);
        else inlineAdd.sharedBy.push(m);
        renderWho(); updatePer();
      });
      whoW.appendChild(b);
    });
  };
  renderR1(); renderWho(); updatePer();
  amtEl.addEventListener("input", updatePer);
  box.querySelector(".qa-all").addEventListener("click", () => {
    inlineAdd.sharedBy = inlineAdd.sharedBy.length === members.length ? [] : [...members];
    renderWho(); updatePer();
  });

  const submit = async () => {
    const amt = Number(amtEl.value) || 0;
    if (!amt) { toast("금액을 입력해 주세요"); amtEl.focus(); return; }
    if (!inlineAdd.sharedBy.length) { toast("나눠 낼 사람을 선택해 주세요"); return; }
    const off = inlineAdd.day === "off";
    const data = {
      amount: amt, desc: descEl.value.trim(), category: inlineAdd.category || "기타",
      offTrip: off, day: off ? null : inlineAdd.day,
      date: off ? (inlineAdd.date || "") : (dateForDay(inlineAdd.day) || ""),
      place: off ? "" : (inlineAdd.place || ""), payer: inlineAdd.payer || "", sharedBy: [...inlineAdd.sharedBy],
    };
    try {
      await addDoc(collection(db, "trips", tripId, "expenses"), { ...data, order: Date.now(), createdAt: serverTimestamp() });
      logEvent("expense_add", { trip: tripId });
      toast("추가됨");
    } catch (e) { toast("저장 실패: " + e.message); }
  };
  box.querySelector(".qa-submit").addEventListener("click", submit);
  descEl.addEventListener("keydown", (e) => { if (e.key === "Enter") amtEl.focus(); });
  amtEl.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
  return box;
}

// 지출 추가/수정 (3b v2) — 날짜·장소를 먼저, 금액을 크게, 나눠 낼 사람으로 1인 비용
let expForm = null;
function openExpenseForm(existing) {
  const members = tripMembers();
  const cats = tripCats();
  const editMembers = existing ? [...new Set([...members, ...(existing.sharedBy || []), existing.payer].filter(Boolean))] : members;
  const exDay = existing ? (existing.offTrip ? "off" : (Number.isInteger(existing.day) ? existing.day : 0)) : 0;
  expForm = existing
    ? { amount: existing.amount ?? "", desc: existing.desc || "", category: existing.category || cats[0], day: exDay, date: existing.date || dateForDay(exDay), place: existing.place || "", payer: existing.payer || members[0] || "", sharedBy: [...(existing.sharedBy || [])] }
    : { amount: "", desc: "", category: cats[0], day: 0, date: dateForDay(0), place: "", payer: members[0] || "", sharedBy: [...members] };

  const bg = h(`<div class="modal-bg"></div>`);
  const modal = h(`
    <div class="modal exp-form">
      <div class="ef-head"><h3>${existing ? "지출 수정" : "지출 추가"}</h3><button class="ef-x" title="닫기">✕</button></div>
      <div class="ef-field"><div class="ef-lbl">언제, 어디서?</div><div class="ef-daycards" id="efDays"></div><div id="efPaidOn"></div><div class="ef-stops" id="efStops"></div></div>
      <div class="ef-amount"><input id="efAmt" inputmode="numeric" placeholder="0" value="${existing ? existing.amount ?? "" : ""}" /><span>원</span></div>
      <div class="ef-per" id="efPer"></div>
      <div class="ef-field"><div class="ef-lbl">구분</div><div class="ef-cats" id="efCats"></div>
        <input class="ef-desc" id="efDesc" placeholder="무엇에 썼나요? (예: 저녁 한정식)" value="${esc(expForm.desc)}" /></div>
      <div class="ef-field"><div class="ef-lbl">결제한 사람</div><div class="ef-payers" id="efPayers"></div></div>
      <div class="ef-field"><div class="ef-lbl2"><span>나눠 낼 사람</span><button class="ef-all" id="efAll" type="button">전체</button></div><div class="ef-who" id="efWho"></div></div>
      <div class="ef-actions">
        ${existing ? `<button class="btn danger" id="efDel">삭제</button>` : ""}
        <button class="btn" id="efSave"></button>
      </div>
    </div>`);
  bg.appendChild(modal);
  document.body.appendChild(bg);
  bg.addEventListener("click", (ev) => { if (ev.target === bg) bg.remove(); });
  modal.querySelector(".ef-x").addEventListener("click", () => bg.remove());

  const amtEl = modal.querySelector("#efAmt");
  const descEl = modal.querySelector("#efDesc");
  const perEl = modal.querySelector("#efPer");
  const saveBtn = modal.querySelector("#efSave");
  const daysW = modal.querySelector("#efDays");
  const paidW = modal.querySelector("#efPaidOn");
  const stopsW = modal.querySelector("#efStops");

  const updateCalc = () => {
    const amt = Number(amtEl.value) || 0; const n = expForm.sharedBy.length;
    perEl.textContent = `${n}명 · 1인 ${n ? won(amt / n) : 0}원`;
    saveBtn.textContent = amt > 0 ? `${won(amt)}원 ${existing ? "저장" : "추가"}` : (existing ? "저장" : "지출 추가");
  };
  amtEl.addEventListener("input", updateCalc);
  descEl.addEventListener("input", () => { expForm.desc = descEl.value; });

  const renderStops = () => {
    stopsW.innerHTML = "";
    if (expForm.day === "off") return;
    const stops = stopsForDay(expForm.day);
    if (!stops.length) { stopsW.appendChild(h(`<div class="ef-nostop">이 날은 아직 일정에 장소가 없어요.</div>`)); return; }
    stops.forEach((s) => {
      const on = expForm.place === s;
      const b = h(`<button type="button" class="ef-stop ${on ? "on" : ""}">${esc(s)}</button>`);
      b.addEventListener("click", () => { expForm.place = on ? "" : s; renderStops(); });
      stopsW.appendChild(b);
    });
  };
  const renderPaidOn = () => {
    paidW.innerHTML = "";
    if (expForm.day !== "off") return;
    const box = h(`<div class="ef-paidon"><span>결제일</span><input type="date" value="${expForm.date && !expForm.date.includes("Day") ? expForm.date : ""}" /></div>`);
    box.querySelector("input").addEventListener("change", (e) => { expForm.date = e.target.value || ""; });
    paidW.appendChild(box);
  };
  const renderDays = () => {
    daysW.innerHTML = "";
    for (let i = 0; i < (trip.dayCount || 1); i++) {
      const { top, sub } = dayLabel(trip.startDate, i);
      const on = expForm.day === i;
      const c = h(`<button type="button" class="ef-daycard ${on ? "on" : ""}"><span class="dc-top">${top}</span><span class="dc-bot">${esc(sub || "")}</span></button>`);
      c.addEventListener("click", () => { expForm.day = i; expForm.date = dateForDay(i); if (!stopsForDay(i).includes(expForm.place)) expForm.place = ""; renderDays(); renderPaidOn(); renderStops(); });
      daysW.appendChild(c);
    }
    const off = expForm.day === "off";
    const co = h(`<button type="button" class="ef-daycard ${off ? "on" : ""}"><span class="dc-top">여행 외</span><span class="dc-bot">직접 입력</span></button>`);
    co.addEventListener("click", () => { expForm.day = "off"; expForm.place = ""; expForm.date = ""; renderDays(); renderPaidOn(); renderStops(); });
    daysW.appendChild(co);
  };
  renderDays(); renderPaidOn(); renderStops();

  const catsWrap = modal.querySelector("#efCats");
  const renderCats = () => {
    catsWrap.innerHTML = "";
    cats.forEach((c) => {
      const on = expForm.category === c;
      const b = h(`<button type="button" class="ef-chip ${on ? "on" : ""}" style="${on ? `background:${catColor(c)};border-color:${catColor(c)};color:#fff` : ""}">${esc(c)}</button>`);
      b.addEventListener("click", () => { expForm.category = c; renderCats(); });
      catsWrap.appendChild(b);
    });
    const addb = h(`<button type="button" class="ef-chip ghost">+ 새 구분</button>`);
    addb.addEventListener("click", async () => {
      const name = (prompt("새 구분 이름") || "").trim();
      if (!name || cats.includes(name)) return;
      cats.push(name); expForm.category = name; renderCats();
      await saveCats([...cats]);
    });
    catsWrap.appendChild(addb);
  };
  renderCats();

  const payWrap = modal.querySelector("#efPayers");
  const renderPayers = () => {
    payWrap.innerHTML = "";
    editMembers.forEach((m) => {
      const on = expForm.payer === m;
      const card = h(`<button type="button" class="ef-payer ${on ? "on" : ""}"><span class="av" style="background:${memberColor(m)}">${esc(initOf(m))}</span><span class="nm">${esc(m)}</span></button>`);
      card.addEventListener("click", () => { expForm.payer = m; renderPayers(); });
      payWrap.appendChild(card);
    });
  };
  renderPayers();

  const whoWrap = modal.querySelector("#efWho");
  const renderWho = () => {
    whoWrap.innerHTML = "";
    editMembers.forEach((m) => {
      const on = expForm.sharedBy.includes(m);
      const b = h(`<button type="button" class="ef-whoav ${on ? "on" : ""}" style="${on ? `background:${memberColor(m)};border-color:${memberColor(m)};color:#fff` : ""}"><span>${esc(initOf(m))}</span><span class="nm">${esc(m)}</span></button>`);
      b.addEventListener("click", () => {
        if (expForm.sharedBy.includes(m)) expForm.sharedBy = expForm.sharedBy.filter((x) => x !== m);
        else expForm.sharedBy.push(m);
        renderWho(); updateCalc();
      });
      whoWrap.appendChild(b);
    });
  };
  renderWho();
  modal.querySelector("#efAll").addEventListener("click", () => {
    expForm.sharedBy = expForm.sharedBy.length === editMembers.length ? [] : [...editMembers];
    renderWho(); updateCalc();
  });
  updateCalc();

  if (existing) modal.querySelector("#efDel").addEventListener("click", async () => {
    if (!confirm("이 지출을 삭제할까요?")) return;
    try { await deleteDoc(doc(db, "trips", tripId, "expenses", existing.id)); bg.remove(); }
    catch (e) { toast("삭제 실패: " + e.message); }
  });
  saveBtn.addEventListener("click", async () => {
    const amt = Number(amtEl.value) || 0;
    if (!amt) { toast("금액을 입력해 주세요"); amtEl.focus(); return; }
    if (!expForm.sharedBy.length) { toast("나눠 낼 사람을 한 명 이상 선택해 주세요"); return; }
    const off = expForm.day === "off";
    const data = {
      amount: amt, desc: descEl.value.trim(), category: expForm.category || "기타",
      offTrip: off, day: off ? null : expForm.day,
      date: off ? (expForm.date || "") : (dateForDay(expForm.day) || ""),
      place: off ? "" : (expForm.place || ""), payer: expForm.payer || "", sharedBy: expForm.sharedBy,
    };
    try {
      if (existing) await updateDoc(doc(db, "trips", tripId, "expenses", existing.id), data);
      else { await addDoc(collection(db, "trips", tripId, "expenses"), { ...data, order: Date.now(), createdAt: serverTimestamp() }); logEvent("expense_add", { trip: tripId }); }
      bg.remove();
    } catch (e) { toast("저장 실패: " + e.message); }
  });
  amtEl.focus();
}


// ---------- 관리자 (활동 로그) ----------
// romeowa@gmail.com 구글 로그인일 때만 events 조회 가능(Firestore 규칙이 서버에서 강제).

function renderAdmin() {
  APP.innerHTML = `<div class="loading">관리자 확인 중…</div>`;
  onAuthStateChanged(auth, (user) => paintAdmin(user));
}

function paintAdmin(user) {
  APP.innerHTML = "";
  const wrap = h(`<div class="admin-wrap"></div>`);
  wrap.appendChild(h(`<div class="admin-head"><h1>📊 활동 로그</h1><a class="admin-home" href="/">← 홈</a></div>`));
  wrap.querySelector(".admin-home").addEventListener("click", (e) => { e.preventDefault(); go("/"); });

  if (!user) {
    const box = h(`<div class="admin-card"><p class="sub">관리자 구글 계정으로 로그인하세요.</p><button class="btn" id="signin">Google로 로그인</button></div>`);
    box.querySelector("#signin").addEventListener("click", async () => {
      try { await signInWithPopup(auth, new GoogleAuthProvider()); }
      catch (e) { toast("로그인 실패: " + (e.code || e.message)); }
    });
    wrap.appendChild(box);
    APP.appendChild(wrap);
    return;
  }

  if (user.email !== ADMIN_EMAIL) {
    const box = h(`<div class="admin-card"><p class="sub">이 계정(<b>${esc(user.email)}</b>)은 접근 권한이 없습니다.</p><button class="btn ghost" id="signout">로그아웃</button></div>`);
    box.querySelector("#signout").addEventListener("click", () => signOut(auth));
    wrap.appendChild(box);
    APP.appendChild(wrap);
    return;
  }

  // 관리자 확인됨 → events 로드
  const bar = h(`<div class="admin-bar"><span>${esc(user.email)}</span><span class="admin-actions"><select id="rangeSel"><option value="7">최근 7일</option><option value="14" selected>최근 14일</option><option value="30">최근 30일</option><option value="90">최근 90일</option></select><button class="btn ghost sm" id="signout">로그아웃</button></span></div>`);
  bar.querySelector("#signout").addEventListener("click", () => signOut(auth));
  wrap.appendChild(bar);
  const tripsBox = h(`<div id="adminTrips"><div class="loading">불러오는 중…</div></div>`);
  const content = h(`<div id="adminContent"><div class="loading">불러오는 중…</div></div>`);
  wrap.appendChild(tripsBox);
  wrap.appendChild(content);
  APP.appendChild(wrap);

  loadTrips(tripsBox);
  const load = (days) => loadEvents(content, parseInt(days, 10));
  bar.querySelector("#rangeSel").addEventListener("change", (e) => load(e.target.value));
  load(14);
}

// 만들어진 여행 목록 (관리자 전용 — 규칙이 list를 관리자에게만 허용)
async function loadTrips(container) {
  let docs = [];
  try {
    const idToken = await auth.currentUser.getIdToken();
    const body = { structuredQuery: { from: [{ collectionId: "trips" }], orderBy: [{ field: { fieldPath: "createdAt" }, direction: "DESCENDING" }], limit: 500 } };
    const res = await fetch("https://firestore.googleapis.com/v1/projects/howardworld/databases/(default)/documents:runQuery", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` }, body: JSON.stringify(body),
    });
    if (!res.ok) { container.innerHTML = `<div class="stat-box"><h3>여행</h3><div class="stat-row muted">조회 실패 (HTTP ${res.status})</div></div>`; return; }
    docs = (await res.json()).filter((r) => r.document).map((r) => {
      const f = r.document.fields || {}; const o = { id: r.document.name.split("/").pop() };
      for (const k in f) o[k] = fsVal(f[k]);
      return o;
    });
  } catch (e) {
    container.innerHTML = `<div class="stat-box"><h3>여행</h3><div class="stat-row muted">조회 실패: ${esc(e.message || e)}</div></div>`;
    return;
  }
  // 각 여행의 항목 개수 (items는 공개 읽기라 SDK로 조회 가능)
  await Promise.all(docs.map(async (t) => {
    try { const s = await getDocs(collection(db, "trips", t.id, "items")); t.itemCount = s.size; }
    catch { t.itemCount = null; }
  }));
  renderTrips(container, docs);
}

let tripFilter = "all"; // all | nonempty | empty
function renderTrips(container, docs) {
  const emptyN = docs.filter((t) => t.itemCount === 0).length;
  const shown = docs.filter((t) =>
    tripFilter === "nonempty" ? t.itemCount !== 0 :
    tripFilter === "empty" ? t.itemCount === 0 : true
  );
  const rowsHtml = shown.map((t) => {
    const start = t.startDate ? String(t.startDate) : null;
    const range = start ? `${start}${t.dayCount > 1 ? ` · ${t.dayCount}일` : ""}` : "날짜 미정";
    const cnt = t.itemCount === 0 ? `<span class="tr-empty">비어있음</span>` : (t.itemCount != null ? `${t.itemCount}곳` : "");
    return `<a class="trip-row ${t.itemCount === 0 ? "is-empty" : ""}" href="/t/${t.id}"><span class="tr-bar" style="background:${TRIP_COLORS[hashId(t.id) % TRIP_COLORS.length]}"></span><span class="tr-body"><span class="tr-name">${esc(t.title || "제목 없음")}</span><span class="tr-sub">${esc(range)} · ${cnt}</span></span><span class="tr-go">›</span></a>`;
  }).join("");
  const seg = (val, label) => `<button class="${tripFilter === val ? "on" : ""}" data-f="${val}">${label}</button>`;
  container.innerHTML =
    `<div class="admin-total">여행 <b>${docs.length}</b>개${emptyN ? ` · 빈 여행 ${emptyN}개` : ""} <button class="btn ghost sm" id="clearRecents">이 기기 홈 목록 비우기</button></div>` +
    `<div class="trip-filterbar"><div class="trip-filter">${seg("all", "전체")}${seg("nonempty", "일정 있음")}${seg("empty", "빈 여행")}</div><span class="trip-shown">${shown.length}개 표시</span></div>` +
    `<div class="stat-box trip-list-box">${rowsHtml || '<div class="stat-row muted">해당하는 여행이 없어요</div>'}</div>`;
  // admin에서 여는 여행은 홈 최근목록에 기록하지 않음(관리 목적 열람)
  container.querySelectorAll(".trip-row").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); skipRememberOnce = true; go(a.getAttribute("href")); }));
  container.querySelectorAll(".trip-filter button").forEach((b) => b.addEventListener("click", () => { tripFilter = b.dataset.f; renderTrips(container, docs); }));
  container.querySelector("#clearRecents").addEventListener("click", () => {
    try { localStorage.removeItem("recentTrips"); } catch {}
    toast("이 기기의 홈 최근 목록을 비웠어요");
  });
}

// Firestore REST 필드 → JS 값 (admin에서 필요한 타입만)
function fsVal(v) {
  if (!v) return undefined;
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return parseInt(v.integerValue, 10);
  if ("doubleValue" in v) return v.doubleValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("timestampValue" in v) return new Date(v.timestampValue);
  return undefined;
}

async function loadEvents(container, days) {
  container.innerHTML = `<div class="loading">불러오는 중…</div>`;
  const since = new Date(Date.now() - days * 86400000);
  let docs = [];
  // SDK가 인증 토큰을 요청에 붙이지 못하는 경우가 있어, ID 토큰을 직접 실어 REST로 조회
  try {
    const idToken = await auth.currentUser.getIdToken();
    const body = {
      structuredQuery: {
        from: [{ collectionId: "events" }],
        where: { fieldFilter: { field: { fieldPath: "ts" }, op: "GREATER_THAN_OR_EQUAL", value: { timestampValue: since.toISOString() } } },
        orderBy: [{ field: { fieldPath: "ts" }, direction: "DESCENDING" }],
        limit: 1000,
      },
    };
    const res = await fetch("https://firestore.googleapis.com/v1/projects/howardworld/databases/(default)/documents:runQuery", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const t = await res.text();
      container.innerHTML = `<div class="admin-card"><p class="sub">조회 실패 (HTTP ${res.status})</p><div class="admin-diag">${esc(t.slice(0, 160))}</div></div>`;
      return;
    }
    const rows = await res.json();
    docs = rows.filter((r) => r.document).map((r) => {
      const f = r.document.fields || {};
      const o = {};
      for (const k in f) o[k] = fsVal(f[k]);
      return { ...o, ts: o.ts ? { toDate: () => o.ts } : null };
    });
  } catch (e) {
    container.innerHTML = `<div class="admin-card"><p class="sub">조회 실패: ${esc(e.message || e)}</p></div>`;
    return;
  }
  const byType = {}, byDay = {}, byPlat = {}, byLoc = {};
  docs.forEach((e) => {
    const t = e.ts && e.ts.toDate ? e.ts.toDate() : null;
    byType[e.type || "?"] = (byType[e.type || "?"] || 0) + 1;
    if (e.os || e.br) { const k = `${e.os || "?"} · ${e.br || "?"}`; byPlat[k] = (byPlat[k] || 0) + 1; }
    if (e.country || e.city) { const k = `${e.country || "?"} · ${e.city || "?"}`; byLoc[k] = (byLoc[k] || 0) + 1; }
    if (t) { const k = ymd(t); byDay[k] = (byDay[k] || 0) + 1; }
  });
  const maxDay = Math.max(1, ...Object.values(byDay));
  const rows = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<div class="stat-row"><span>${esc(k)}</span><b>${v}</b></div>`).join("") || `<div class="stat-row muted">없음</div>`;
  const dayBars = Object.keys(byDay).sort().map((k) => `<div class="day-bar"><span class="db-date">${k.slice(5)}</span><span class="db-track"><span class="db-fill" style="width:${(byDay[k] / maxDay) * 100}%"></span></span><b>${byDay[k]}</b></div>`).join("") || `<div class="stat-row muted">없음</div>`;
  // 한 이벤트의 내부 줄(유형·부가정보·시각) — 기기 헤더에 환경/위치가 있으니 여기선 생략
  const evInner = (e) => {
    const t = e.ts && e.ts.toDate ? e.ts.toDate() : null;
    const when = t ? t.toLocaleString("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "?";
    let extra = "";
    if (e.type === "check_run") extra = ` <span class="muted">감시 ${e.watches ?? "?"}·알림 ${e.notified ?? 0}·에러 ${e.errors ?? 0}</span>`;
    else if (e.type === "promo_click") extra = ` <span class="ev-promo">${esc(e.promo || "?")}</span>`;
    else if (e.trip) extra = ` <span class="muted">${esc(String(e.trip)).slice(0, 8)}</span>`;
    return `<div class="ev-row"><span class="ev-type">${esc(e.type || "?")}</span>${extra}<span class="ev-when">${when}</span></div>`;
  };

  // 기기(deviceId)별로 묶기
  const groups = {};
  docs.forEach((e) => { (groups[e.dev || "?"] ||= []).push(e); });
  const groupArr = Object.entries(groups).map(([dev, evs]) => {
    evs.sort((a, b) => ((b.ts && b.ts.toDate && b.ts.toDate()) || 0) - ((a.ts && a.ts.toDate && a.ts.toDate()) || 0));
    const top = evs[0] || {};
    const lastMs = top.ts && top.ts.toDate ? top.ts.toDate().getTime() : 0;
    return { dev, evs, top, lastMs };
  }).sort((a, b) => b.lastMs - a.lastMs);

  const groupsHtml = groupArr.map((g) => {
    const e = g.top;
    const env = esc([e.form, e.os, e.br].filter(Boolean).join(" · ")) || "환경 미상";
    const loc = (e.country || e.city) ? `<span class="dg-loc">📍${esc([e.country, e.city].filter(Boolean).join(" "))}</span>` : "";
    const last = g.lastMs ? new Date(g.lastMs).toLocaleString("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "?";
    const shown = g.evs.slice(0, 30).map(evInner).join("");
    const more = g.evs.length > 30 ? `<div class="stat-row muted">…외 ${g.evs.length - 30}건</div>` : "";
    return `<div class="dev-group">
      <div class="dev-head">
        <span class="dg-env">📱 ${env}</span>${loc}
        <span class="dg-id">#${esc(g.dev)}</span>
        <span class="dg-meta">${g.evs.length}건 · 최근 ${last}</span>
      </div>
      <div class="dev-events">${shown}${more}</div>
    </div>`;
  }).join("");

  container.innerHTML = `
    <div class="admin-total">최근 ${days}일 · 총 <b>${docs.length}</b>건 · 기기 ${groupArr.length}대</div>
    <div class="stat-grid">
      <div class="stat-box"><h3>유형별</h3>${rows(byType)}</div>
      <div class="stat-box"><h3>디바이스 (OS · 브라우저)</h3>${rows(byPlat)}</div>
      <div class="stat-box"><h3>지역 (국가 · 도시)</h3>${rows(byLoc)}</div>
      <div class="stat-box"><h3>날짜별</h3>${dayBars}</div>
    </div>
    <div class="stat-box"><h3>기기별 활동</h3>${groupsHtml || '<div class="stat-row muted">없음</div>'}</div>
  `;
}

// 시작
updateOnlineBanner();
fetchGeo(); // 위치 미리 조회(비차단)
route();
