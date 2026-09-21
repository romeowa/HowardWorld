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

// 구글 API 키 (howard-trips.web.app 리퍼러 + Places/Maps JS API로 제한된 웹 키)
const PLACES_KEY = "AIzaSyB8EXfTFJfBf6eLDUiX8vJcaxN7Tc-meVI";

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

function rememberTrip(id, title) {
  let list = [];
  try { list = JSON.parse(localStorage.getItem("recentTrips") || "[]"); } catch {}
  list = list.filter((t) => t.id !== id);
  list.unshift({ id, title: title || "제목 없는 여행", ts: Date.now() });
  try { localStorage.setItem("recentTrips", JSON.stringify(list.slice(0, 12))); } catch {}
}

// ---------- 광고 푸터 (만든 사람의 다른 앱) ----------
function promoFooter() {
  const ua = navigator.userAgent;
  const isIOS = /iPhone|iPad|iPod/.test(ua);
  const apps = [
    {
      name: "피그맵", icon: "/promo-pigmap.jpg", plat: "iOS · Android",
      href: isIOS
        ? "https://apps.apple.com/app/id6471933646"
        : "https://play.google.com/store/apps/details?id=home.sweet.pigmap",
    },
    {
      name: "니니구", icon: "/promo-ninigu.jpg", plat: "iOS · Web",
      href: isIOS ? "https://apps.apple.com/app/id6754002478" : "https://ninigu.net",
    },
  ];
  return h(`<footer class="promo">
    <div class="promo-title">만든 사람의 다른 앱</div>
    <div class="promo-cards">
      ${apps.map((a) => `<a class="promo-card" href="${a.href}" target="_blank" rel="noopener">
        <img class="pc-icon" src="${a.icon}" alt="${a.name}" width="38" height="38" loading="lazy" />
        <span class="pc-text"><span class="pc-name">${a.name}</span><span class="pc-plat">${a.plat}</span></span>
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
  APP.appendChild(promoFooter());
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
let dayMap = null;
let markerById = {};   // 항목 id → 지도 마커 (리스트 클릭 시 지도 이동용)

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

  // 지도 (핀이 있으면 항상 표시)
  const pinned = dayItems.filter((it) => it.lat != null);
  if (pinned.length) wrap.appendChild(h(`<div id="dayMap"></div>`));

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
  APP.appendChild(promoFooter());
  if (pinned.length) renderDayMap(pinned);
}

function itemCard(it) {
  const t = TYPES[it.type] || TYPES.note;
  // 주소 클릭 → 구글맵에서 해당 좌표 열기 (정확한 위치, 모바일에선 앱/웹뷰)
  const mapLink = it.lat != null ? `https://www.google.com/maps/search/?api=1&query=${it.lat},${it.lng}` : null;
  const card = h(`
    <div class="item ${it.lat != null ? "clickable" : ""}" data-id="${it.id}">
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
  card.querySelector(".edit").addEventListener("click", (e) => { e.stopPropagation(); openEditor(it); });
  card.querySelector(".del").addEventListener("click", (e) => {
    e.stopPropagation();
    if (confirm(`"${it.name || TYPES[it.type]?.label}" 삭제할까요?`)) deleteDoc(doc(db, "trips", tripId, "items", it.id));
  });
  // 카드(장소/주소 등) 클릭 → 지도에서 해당 위치로 이동
  card.addEventListener("click", (e) => {
    if (e.target.closest(".acts") || e.target.closest("a")) return;
    focusOnMap(it);
  });
  return card;
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
      content: `<b>${i + 1}. ${esc(it.name || "")}</b>${it.time ? "<br>" + esc(it.time) : ""}`,
    });
    mk.addListener("click", () => { info.open({ map, anchor: mk }); focusItem(it); });
    markerById[it.id] = { mk, info };
    bounds.extend(pos); path.push(pos);
  });
  // 순서대로 잇는 경로선
  if (path.length > 1) {
    new google.maps.Polyline({ path, map, strokeColor: "#0ea5e9", strokeOpacity: 0.85, strokeWeight: 3.5 });
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
  const card = document.querySelector(`.item[data-id="${it.id}"]`);
  if (card) {
    card.scrollIntoView({ behavior: "smooth", block: "center" });
    card.classList.remove("flash"); void card.offsetWidth; card.classList.add("flash");
  }
}

// 리스트 항목 클릭 → 지도에서 해당 위치로 이동 + 팝업 + 지도로 스크롤
function focusOnMap(it) {
  if (!dayMap || it.lat == null) return;
  panTo(it);
  const m = markerById[it.id];
  if (m) m.info.open({ map: dayMap, anchor: m.mk });
  document.getElementById("dayMap")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  const card = document.querySelector(`.item[data-id="${it.id}"]`);
  if (card) { card.classList.remove("flash"); void card.offsetWidth; card.classList.add("flash"); }
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
