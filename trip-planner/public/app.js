import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore, doc, collection, addDoc, setDoc, updateDoc, deleteDoc,
  getDoc, onSnapshot, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAx1DsvOcDSiDvPYG32Nw6wiFRQz8X5PB8",
  authDomain: "howardworld.firebaseapp.com",
  projectId: "howardworld",
  storageBucket: "howardworld.firebasestorage.app",
  messagingSenderId: "940701312592",
  appId: "1:940701312592:web:8882de89e067b9a727d355",
};
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

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
  return h(`<footer class="promo">
    <div class="promo-title">만든 사람의 다른 앱</div>
    <div class="promo-cards">
      ${apps.map((a) => `<a class="promo-card" href="${a.href}" target="_blank" rel="noopener">
        <img class="pc-icon" src="${a.icon}" alt="${a.name}" width="34" height="34" loading="lazy" />
        <span class="pc-text"><span class="pc-name">${a.name}</span><span class="pc-desc">${a.desc}</span></span>
        <span class="pc-go">→</span>
      </a>`).join("")}
    </div>
  </footer>`);
}

// ---------- 라우팅 ----------
let unsubTrip = null, unsubItems = null;
function cleanup() {
  if (unsubTrip) unsubTrip(); if (unsubItems) unsubItems();
  unsubTrip = unsubItems = null;
}
function go(path) { history.pushState({}, "", path); route(); }
window.addEventListener("popstate", route);

function route() {
  cleanup();
  const m = location.pathname.match(/^\/t\/([A-Za-z0-9_-]+)/);
  if (m) renderTrip(m[1]);
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

async function renderHome() {
  APP.innerHTML = `<div class="loading">불러오는 중…</div>`;
  let recent = [];
  try { recent = JSON.parse(localStorage.getItem("recentTrips") || "[]"); } catch {}

  // 최근 여행의 최신 정보를 Firestore에서 (제목·시작일·일수) — 순서 유지
  const arr = new Array(recent.length).fill(null);
  await Promise.all(recent.map(async (r, i) => {
    try {
      const snap = await getDoc(doc(db, "trips", r.id));
      if (!snap.exists()) return; // 삭제됨 → 목록에서 제거
      const d = snap.data();
      arr[i] = { id: r.id, title: d.title || "제목 없는 여행", startDate: d.startDate || null, dayCount: d.dayCount || 1, ts: r.ts || 0 };
    } catch {
      // 네트워크 실패 시 로컬 캐시로 대체
      arr[i] = { id: r.id, title: r.title || "제목 없는 여행", startDate: r.startDate ?? null, dayCount: r.dayCount ?? 1, ts: r.ts || 0 };
    }
  }));
  const trips = arr.filter(Boolean);
  trips.forEach((t) => { t.color = TRIP_COLORS[hashId(t.id) % TRIP_COLORS.length]; });
  // 삭제된 항목 반영해 localStorage 갱신
  try { localStorage.setItem("recentTrips", JSON.stringify(trips.map(({ color, ...t }) => t))); } catch {}

  if (!homeMonth) {
    const now = new Date();
    homeMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  }

  APP.innerHTML = "";
  const shell = h(`<div class="home-shell"></div>`);

  // 헤더
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
        <span class="cal-toggle">
          <button class="${homeView === "month" ? "on" : ""}" id="vMonth">월</button>
          <button class="${homeView === "list" ? "on" : ""}" id="vList">목록</button>
        </span>
        <button class="btn sm" id="newTrip">+ 새 여행</button>
      </div>
    </div>`);
  shell.appendChild(header);
  header.querySelector("#newTrip").addEventListener("click", createTrip);
  header.querySelector("#prevM").addEventListener("click", () => { homeMonth = new Date(y, m - 1, 1); renderHome(); });
  header.querySelector("#nextM").addEventListener("click", () => { homeMonth = new Date(y, m + 1, 1); renderHome(); });
  header.querySelector("#todayBtn").addEventListener("click", () => { const n = new Date(); homeMonth = new Date(n.getFullYear(), n.getMonth(), 1); renderHome(); });
  header.querySelector("#vMonth").addEventListener("click", () => { homeView = "month"; renderHome(); });
  header.querySelector("#vList").addEventListener("click", () => { homeView = "list"; renderHome(); });

  if (homeView === "month") shell.appendChild(buildCalendar(homeMonth, trips));
  else shell.appendChild(buildTripList(trips));

  APP.appendChild(shell);
  APP.appendChild(promoFooter());
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

  // 이번 달 여행 목록
  const monthLast = new Date(y, m + 1, 0);
  const inMonth = trips
    .filter((t) => t.startDate)
    .map((t) => { const s = parseDate(t.startDate); return { ...t, s, e: addDays(s, (t.dayCount || 1) - 1) }; })
    .filter((t) => t.e >= first && t.s <= monthLast)
    .sort((a, b) => a.s - b.s);
  const undated = trips.filter((t) => !t.startDate);

  const foot = h(`<div class="cal-foot"></div>`);
  if (inMonth.length) {
    foot.appendChild(h(`<div class="cal-foot-title">이번 달 여행 ${inMonth.length}</div>`));
    inMonth.forEach((t) => foot.appendChild(tripRow(t, `${fmtMD(t.s)} — ${fmtMD(t.e)} · ${t.dayCount}일`)));
  } else {
    foot.appendChild(h(`<div class="cal-foot-empty">이번 달엔 잡힌 여행이 없어요.</div>`));
  }
  if (undated.length) {
    foot.appendChild(h(`<div class="cal-foot-title">날짜 미정 ${undated.length}</div>`));
    undated.forEach((t) => foot.appendChild(tripRow(t, "시작일 미정")));
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
    <span class="tr-go">›</span>
  </a>`);
  row.addEventListener("click", (e) => { e.preventDefault(); go(`/t/${t.id}`); });
  return row;
}

async function createTrip() {
  const btn = document.getElementById("newTrip");
  if (btn) { btn.disabled = true; btn.textContent = "만드는 중…"; }
  try {
    const ref = await addDoc(collection(db, "trips"), {
      title: "새 여행", startDate: null, dayCount: 3, createdAt: serverTimestamp(),
    });
    rememberTrip(ref.id, { title: "새 여행", startDate: null, dayCount: 3 });
    go(`/t/${ref.id}`);
  } catch (e) {
    toast("생성 실패: " + e.message);
    if (btn) { btn.disabled = false; btn.textContent = "+ 새 여행 만들기"; }
  }
}

// ---------- 여행 화면 ----------
let trip = null;       // {title, startDate, dayCount}
let items = [];        // [{id, ...}]
let curDay = 0;
let tripId = null;
let dayMap = null;
let markerById = {};   // 항목 id → 지도 마커 (리스트 클릭 시 지도 이동용)

function renderTrip(id) {
  tripId = id;
  trip = null; items = []; curDay = 0; dayMap = null;
  APP.innerHTML = `<div class="loading">여행을 불러오는 중…</div>`;

  unsubTrip = onSnapshot(doc(db, "trips", id), (snap) => {
    if (!snap.exists()) { APP.innerHTML = `<div class="wrap home"><h1>🔍</h1><p class="sub">여행을 찾을 수 없어요. 링크가 정확한지 확인해 주세요.</p><button class="btn ghost" onclick="location.href='/'">홈으로</button></div>`; cleanup(); return; }
    trip = snap.data();
    rememberTrip(id, { title: trip.title, startDate: trip.startDate ?? null, dayCount: trip.dayCount ?? 1 });
    paint();
  }, (err) => { APP.innerHTML = `<div class="loading">불러오기 실패: ${esc(err.message)}</div>`; });

  unsubItems = onSnapshot(collection(db, "trips", id, "items"), (snap) => {
    items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    if (trip) paint();
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
  if (curDay >= trip.dayCount) curDay = trip.dayCount - 1;

  // 이 날 항목 / 지도 핀 (레이아웃 결정에 필요)
  const dayItems = sortedItems(items.filter((it) => it.day === curDay));
  const pinned = dayItems.filter((it) => it.lat != null);
  const hasMap = pinned.length > 0;

  APP.innerHTML = "";
  // 상단 바 (지도 있으면 넓은 폭으로)
  const bar = h(`
    <div class="topbar"><div class="topbar-inner ${hasMap ? "wide" : ""}">
      <a class="home-link" href="/" title="홈">🧳</a>
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

  // 여행 전체를 감싸는 셸 (지도 있으면 넓게)
  const shell = h(`<div class="trip-shell ${hasMap ? "wide" : ""}"></div>`);

  // 시작일
  const meta = h(`<div class="trip-meta">
    <label>시작일 <input type="date" id="startDate" value="${trip.startDate || ""}"/></label>
    <span class="count">${trip.dayCount}일 · ${items.length}곳</span>
  </div>`);
  meta.querySelector("#startDate").addEventListener("change", (e) =>
    updateDoc(doc(db, "trips", tripId), { startDate: e.target.value || null }));
  shell.appendChild(meta);

  // Day 탭
  const days = h(`<div class="days"></div>`);
  for (let i = 0; i < trip.dayCount; i++) {
    const { top, sub } = dayLabel(trip.startDate, i);
    const cnt = items.filter((it) => it.day === i).length;
    const tab = h(`<button class="day-tab ${i === curDay ? "active" : ""}">${top}${cnt ? ` · ${cnt}` : ""}<span class="dd">${sub}</span></button>`);
    tab.addEventListener("click", () => { curDay = i; paint(); });
    days.appendChild(tab);
  }
  const addDay = h(`<button class="day-tab add" title="날짜 추가">+ 날</button>`);
  addDay.addEventListener("click", () => updateDoc(doc(db, "trips", tripId), { dayCount: trip.dayCount + 1 }));
  days.appendChild(addDay);
  shell.appendChild(days);

  // 본문: 넓으면 타임라인 | 지도 2단, 좁으면 세로 1단(지도 아래)
  const body = h(`<div class="trip-body ${hasMap ? "has-map" : ""}"></div>`);
  const main = h(`<div class="trip-main"></div>`);

  // 항목 목록 (타임라인)
  const list = h(`<div class="timeline"></div>`);
  if (!dayItems.length) list.appendChild(h(`<div class="empty-day">아직 이 날 일정이 없어요.<br/>아래 버튼으로 장소·식사·액티비티를 추가해 보세요.</div>`));
  dayItems.forEach((it) => list.appendChild(itemCard(it)));
  // 타임라인 끝 자리표시 (여기서도 추가 가능)
  const tlAdd = h(`<button class="tl-add">＋ 이 다음에 장소 추가</button>`);
  tlAdd.addEventListener("click", () => openEditor(null));
  list.appendChild(tlAdd);
  main.appendChild(list);

  // 추가 버튼 (주요 액션)
  const addRow = h(`<div class="add-row"><button class="btn block" id="addItem">+ 장소 추가</button></div>`);
  addRow.querySelector("#addItem").addEventListener("click", () => openEditor(null));
  main.appendChild(addRow);

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

  APP.appendChild(shell);
  APP.appendChild(promoFooter());
  if (pinned.length) renderDayMap(pinned);
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
          <span class="tl-acts">
            <button class="edit" title="수정">✏️</button>
            <button class="del" title="삭제">🗑️</button>
          </span>
        </div>
        ${it.address ? `<div class="tl-addr">${mapLink ? `<a href="${mapLink}" target="_blank" rel="noopener">📍 ${esc(it.address)}</a>` : esc(it.address)}</div>` : ""}
        ${it.memo ? `<div class="tl-memo">${esc(it.memo)}</div>` : ""}
      </div>
    </div>`);
  row.querySelector(".edit").addEventListener("click", (e) => { e.stopPropagation(); openEditor(it); });
  row.querySelector(".del").addEventListener("click", (e) => {
    e.stopPropagation();
    if (confirm(`"${it.name || TYPES[it.type]?.label}" 삭제할까요?`)) deleteDoc(doc(db, "trips", tripId, "items", it.id));
  });
  // 내용 클릭 → 지도에서 해당 위치로 이동
  row.querySelector(".tl-content").addEventListener("click", (e) => {
    if (e.target.closest(".tl-acts") || e.target.closest("a")) return;
    focusOnMap(it);
  });
  return row;
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

function openEditor(existing) {
  editState = existing
    ? { ...existing }
    : { day: curDay, type: "place", name: "", address: "", lat: null, lng: null, time: "", memo: "" };

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
      <div class="field"><label>시간</label><input id="time" type="time" value="${esc(editState.time)}" /></div>
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
    editState.time = modal.querySelector("#time").value;
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
        // 모달을 닫지 않고 폼만 비워 이어서 입력 (날짜·종류는 유지)
        toast(`추가됨 — 이어서 입력하세요`);
        nameEl.value = ""; addrEl.value = "";
        modal.querySelector("#time").value = ""; modal.querySelector("#memo").value = "";
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

// 시작
route();
