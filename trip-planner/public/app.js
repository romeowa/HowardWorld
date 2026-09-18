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

function rememberTrip(id, title) {
  let list = [];
  try { list = JSON.parse(localStorage.getItem("recentTrips") || "[]"); } catch {}
  list = list.filter((t) => t.id !== id);
  list.unshift({ id, title: title || "제목 없는 여행", ts: Date.now() });
  try { localStorage.setItem("recentTrips", JSON.stringify(list.slice(0, 12))); } catch {}
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

// ---------- 홈 ----------
function renderHome() {
  let recent = [];
  try { recent = JSON.parse(localStorage.getItem("recentTrips") || "[]"); } catch {}
  APP.innerHTML = "";
  const view = h(`
    <div class="wrap home">
      <h1>🧳 여행 일정</h1>
      <p class="sub">링크 하나로 함께 짜는 여행 일정.<br/>만들고 링크만 공유하면 누구나 같이 편집해요.</p>
      <button class="btn" id="newTrip">+ 새 여행 만들기</button>
      <div class="recent" id="recent"></div>
    </div>`);
  APP.appendChild(view);
  view.querySelector("#newTrip").addEventListener("click", createTrip);

  const rc = view.querySelector("#recent");
  if (recent.length) {
    rc.appendChild(h(`<h2>최근 연 여행</h2>`));
    recent.forEach((t) => {
      const a = h(`<a href="/t/${t.id}"><span class="rt">${esc(t.title)}</span><span class="rd">열기 →</span></a>`);
      a.addEventListener("click", (e) => { e.preventDefault(); go(`/t/${t.id}`); });
      rc.appendChild(a);
    });
  }
}

async function createTrip() {
  const btn = document.getElementById("newTrip");
  if (btn) { btn.disabled = true; btn.textContent = "만드는 중…"; }
  try {
    const ref = await addDoc(collection(db, "trips"), {
      title: "새 여행", startDate: null, dayCount: 3, createdAt: serverTimestamp(),
    });
    rememberTrip(ref.id, "새 여행");
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
let dayMap = null, dayMarkers = [];

function renderTrip(id) {
  tripId = id;
  trip = null; items = []; curDay = 0; dayMap = null;
  APP.innerHTML = `<div class="loading">여행을 불러오는 중…</div>`;

  unsubTrip = onSnapshot(doc(db, "trips", id), (snap) => {
    if (!snap.exists()) { APP.innerHTML = `<div class="wrap home"><h1>🔍</h1><p class="sub">여행을 찾을 수 없어요. 링크가 정확한지 확인해 주세요.</p><button class="btn ghost" onclick="location.href='/'">홈으로</button></div>`; cleanup(); return; }
    trip = snap.data();
    rememberTrip(id, trip.title);
    paint();
  }, (err) => { APP.innerHTML = `<div class="loading">불러오기 실패: ${esc(err.message)}</div>`; });

  unsubItems = onSnapshot(collection(db, "trips", id, "items"), (snap) => {
    items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    if (trip) paint();
  });
}

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

  APP.innerHTML = "";
  // 상단 바
  const bar = h(`
    <div class="topbar"><div class="topbar-inner">
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

  const wrap = h(`<div class="wrap"></div>`);

  // 시작일
  const meta = h(`<div class="trip-meta">
    <label>시작일 <input type="date" id="startDate" value="${trip.startDate || ""}"/></label>
    <span class="rd" style="font-size:13px;color:var(--muted)">${trip.dayCount}일 일정</span>
  </div>`);
  meta.querySelector("#startDate").addEventListener("change", (e) =>
    updateDoc(doc(db, "trips", tripId), { startDate: e.target.value || null }));
  APP.appendChild(meta);

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
  APP.appendChild(days);

  // 항목 목록
  const dayItems = sortedItems(items.filter((it) => it.day === curDay));
  const list = h(`<div class="items"></div>`);
  if (!dayItems.length) list.appendChild(h(`<div class="empty-day">아직 이 날 일정이 없어요.<br/>아래 버튼으로 장소·식사·액티비티를 추가해 보세요.</div>`));
  dayItems.forEach((it) => list.appendChild(itemCard(it)));
  wrap.appendChild(list);

  // 추가 버튼
  const addRow = h(`<div class="add-row"><button class="btn block" id="addItem">+ 항목 추가</button></div>`);
  addRow.querySelector("#addItem").addEventListener("click", () => openEditor(null));
  wrap.appendChild(addRow);

  // 지도 (핀이 있으면)
  const pinned = dayItems.filter((it) => it.lat != null);
  if (pinned.length) {
    wrap.appendChild(h(`<div class="map-toggle"><button class="btn ghost sm" id="mapToggle">🗺️ 이 날 지도 보기</button></div>`));
    const mapEl = h(`<div id="dayMap" style="display:none"></div>`);
    wrap.appendChild(mapEl);
    wrap.querySelector("#mapToggle").addEventListener("click", () => {
      const showing = mapEl.style.display !== "none";
      mapEl.style.display = showing ? "none" : "block";
      wrap.querySelector("#mapToggle").textContent = showing ? "🗺️ 이 날 지도 보기" : "🗺️ 지도 접기";
      if (!showing) renderDayMap(pinned);
    });
  }

  // 마지막 날 삭제 (비어있을 때만)
  if (trip.dayCount > 1) {
    const lastEmpty = items.filter((it) => it.day === trip.dayCount - 1).length === 0;
    if (lastEmpty) {
      const del = h(`<div style="text-align:center;margin-top:8px"><button class="btn danger sm" id="delDay">− 마지막 날(Day ${trip.dayCount}) 삭제</button></div>`);
      del.querySelector("#delDay").addEventListener("click", () => {
        updateDoc(doc(db, "trips", tripId), { dayCount: trip.dayCount - 1 });
        if (curDay >= trip.dayCount - 1) curDay = trip.dayCount - 2;
      });
      wrap.appendChild(del);
    }
  }

  APP.appendChild(wrap);
}

function itemCard(it) {
  const t = TYPES[it.type] || TYPES.note;
  const mapLink = it.lat != null ? `https://www.openstreetmap.org/?mlat=${it.lat}&mlon=${it.lng}#map=17/${it.lat}/${it.lng}` : null;
  const card = h(`
    <div class="item">
      <div class="ic">${t.emoji}</div>
      <div class="body">
        <div class="row1">
          ${it.time ? `<span class="time">${esc(it.time)}</span>` : ""}
          <span class="name">${esc(it.name) || t.label}</span>
        </div>
        ${it.address ? `<div class="addr">${mapLink ? `<a href="${mapLink}" target="_blank" rel="noopener">📍 ${esc(it.address)}</a>` : esc(it.address)}</div>` : ""}
        ${it.memo ? `<div class="memo">${esc(it.memo)}</div>` : ""}
      </div>
      <div class="acts">
        <button class="edit" title="수정">✏️</button>
        <button class="del" title="삭제">🗑️</button>
      </div>
    </div>`);
  card.querySelector(".edit").addEventListener("click", () => openEditor(it));
  card.querySelector(".del").addEventListener("click", () => {
    if (confirm(`"${it.name || TYPES[it.type]?.label}" 삭제할까요?`)) deleteDoc(doc(db, "trips", tripId, "items", it.id));
  });
  return card;
}

// ---------- 이 날 지도 ----------
function renderDayMap(pinned) {
  const el = document.getElementById("dayMap");
  if (!el) return;
  if (dayMap) { dayMap.remove(); dayMap = null; }
  dayMap = L.map(el);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap", maxZoom: 19,
  }).addTo(dayMap);
  const group = [];
  pinned.forEach((it, i) => {
    const mk = L.marker([it.lat, it.lng]).addTo(dayMap);
    mk.bindPopup(`<b>${esc(it.name || "")}</b>${it.time ? "<br/>" + esc(it.time) : ""}`);
    group.push([it.lat, it.lng]);
  });
  setTimeout(() => { dayMap.invalidateSize(); dayMap.fitBounds(group, { padding: [30, 30], maxZoom: 15 }); }, 60);
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
        <button class="btn ghost" id="cancel">취소</button>
        <button class="btn" id="save">저장</button>
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

  // 지도
  setTimeout(() => {
    pickMap = L.map(modal.querySelector("#pickMap")).setView(
      editState.lat != null ? [editState.lat, editState.lng] : [35.1796, 129.0756], editState.lat != null ? 15 : 4);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "© OpenStreetMap", maxZoom: 19 }).addTo(pickMap);
    pickMap.invalidateSize();
    if (editState.lat != null) setMarker(editState.lat, editState.lng);
    pickMap.on("click", (e) => { setMarker(e.latlng.lat, e.latlng.lng); editState.lat = e.latlng.lat; editState.lng = e.latlng.lng; updatePicked(); });
  }, 80);

  function setMarker(lat, lng) {
    if (pickMarker) pickMarker.setLatLng([lat, lng]);
    else {
      pickMarker = L.marker([lat, lng], { draggable: true }).addTo(pickMap);
      pickMarker.on("dragend", () => { const p = pickMarker.getLatLng(); editState.lat = p.lat; editState.lng = p.lng; updatePicked(); });
    }
    pickMap.setView([lat, lng], Math.max(pickMap.getZoom(), 15));
  }

  // 검색 (Nominatim, 디바운스)
  const resultsEl = modal.querySelector("#results");
  const doSearch = debounce(async (q) => {
    if (q.length < 2) { resultsEl.innerHTML = ""; return; }
    resultsEl.innerHTML = `<div class="searching">검색 중…</div>`;
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&accept-language=ko&addressdetails=1&q=${encodeURIComponent(q)}`;
      const res = await fetch(url);
      const arr = await res.json();
      resultsEl.innerHTML = "";
      if (!arr.length) { resultsEl.innerHTML = `<div class="searching">결과가 없어요. 지도를 눌러 직접 위치를 찍어도 됩니다.</div>`; return; }
      const box = h(`<div class="search-results"></div>`);
      arr.forEach((r) => {
        const primary = r.name || (r.display_name || "").split(",")[0];
        const b = h(`<button><div class="sr-name">${esc(primary)}</div><div class="sr-addr">${esc(r.display_name)}</div></button>`);
        b.addEventListener("click", () => {
          editState.lat = parseFloat(r.lat); editState.lng = parseFloat(r.lon);
          if (!nameEl.value.trim()) { nameEl.value = primary; editState.name = primary; }
          addrEl.value = r.display_name; editState.address = r.display_name;
          setMarker(editState.lat, editState.lng); updatePicked();
          resultsEl.innerHTML = ""; modal.querySelector("#q").value = "";
        });
        box.appendChild(b);
      });
      resultsEl.appendChild(box);
    } catch { resultsEl.innerHTML = `<div class="searching">검색 실패 (잠시 후 다시)</div>`; }
  }, 500);
  modal.querySelector("#q").addEventListener("input", (e) => doSearch(e.target.value.trim()));

  modal.querySelector("#cancel").addEventListener("click", close);
  modal.querySelector("#save").addEventListener("click", save);

  function close() { if (pickMap) { pickMap.remove(); pickMap = null; } pickMarker = null; bg.remove(); }

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
      if (existing) await updateDoc(doc(db, "trips", tripId, "items", existing.id), data);
      else await addDoc(collection(db, "trips", tripId, "items"), { ...data, order: Date.now(), createdAt: serverTimestamp() });
      close();
    } catch (e) { toast("저장 실패: " + e.message); }
  }
}

// 시작
route();
