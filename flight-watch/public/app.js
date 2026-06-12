import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore, collection, addDoc, deleteDoc, updateDoc, doc, onSnapshot,
  query, orderBy, setDoc, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getMessaging, getToken, onMessage } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging.js";

const firebaseConfig = {
  apiKey: "AIzaSyAx1DsvOcDSiDvPYG32Nw6wiFRQz8X5PB8",
  authDomain: "howardworld.firebaseapp.com",
  projectId: "howardworld",
  storageBucket: "howardworld.firebasestorage.app",
  messagingSenderId: "940701312592",
  appId: "1:940701312592:web:8882de89e067b9a727d355",
};

// Firebase 콘솔 → 프로젝트 설정 → 클라우드 메시징 → 웹 푸시 인증서에서 생성한 키
const VAPID_KEY = "BDmTPoFy8N01JB5AlH3d0tb1f51olmTDIigRU4_jlC-j_QNg8KkndH0YQoaY2_U8Ammk9dFtoUnkt5KDvQvArJQ";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const $ = (id) => document.getElementById(id);
const notifStatus = $("notif-status");
const logEl = $("log");

function fmtPrice(n, currency = "KRW") {
  if (n == null) return "-";
  return new Intl.NumberFormat("ko-KR", { style: "currency", currency }).format(n);
}

// ---------- 알림 등록 ----------
async function enableNotifications() {
  if (VAPID_KEY.startsWith("PASTE")) {
    notifStatus.textContent = "⚠️ app.js에 VAPID 키를 먼저 넣어주세요 (콘솔 → 클라우드 메시징 → 웹 푸시 인증서)";
    return;
  }
  try {
    const perm = await Notification.requestPermission();
    if (perm !== "granted") {
      notifStatus.textContent = "❌ 알림 권한이 거부되었습니다";
      return;
    }
    const sw = await navigator.serviceWorker.register("/firebase-messaging-sw.js");
    const messaging = getMessaging(app);
    const token = await getToken(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: sw });
    await setDoc(doc(db, "fcmTokens", token), {
      createdAt: serverTimestamp(),
      ua: navigator.userAgent.slice(0, 120),
    });
    localStorage.setItem("fcmToken", token);
    notifStatus.textContent = "✅ 이 기기에서 알림을 받습니다";
    onMessage(messaging, (payload) => {
      const n = payload.notification;
      if (n) new Notification(n.title, { body: n.body });
    });
  } catch (err) {
    notifStatus.textContent = `❌ 알림 등록 실패: ${err.message}`;
    console.error(err);
  }
}
$("btn-enable-notif").addEventListener("click", enableNotifications);
if (localStorage.getItem("fcmToken")) notifStatus.textContent = "✅ 이 기기는 알림 등록됨 (다시 누르면 갱신)";

// iOS Safari: 홈 화면 추가 전엔 웹 푸시 불가 안내
if (/iPhone|iPad/.test(navigator.userAgent) && !window.navigator.standalone) {
  notifStatus.textContent = "📲 iPhone에서는 공유 → '홈 화면에 추가' 후 그 앱에서 알림을 켜주세요";
}

// ---------- 수동 체크 (Mac 데몬에 신호) ----------
$("btn-check-now").addEventListener("click", async () => {
  await setDoc(doc(db, "control", "checkNow"), { requestedAt: serverTimestamp() });
  logEl.textContent = "체크 요청 보냄 — Mac 데몬이 받으면 아래에 결과가 갱신됩니다";
});

// 데몬의 마지막 실행 결과 표시
onSnapshot(doc(db, "control", "status"), (snap) => {
  if (!snap.exists()) return;
  const s = snap.data();
  const ranAt = s.lastRunAt
    ? new Date(s.lastRunAt.seconds * 1000).toLocaleString("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : "?";
  logEl.textContent =
    `마지막 검사: ${ranAt} (${s.trigger})\n` +
    ((s.results ?? [])
      .map((r) =>
        r.status === "ok"
          ? `${r.label}: 검색 ${r.offers}건, 조건충족 ${r.matches}건` +
            (r.bestMatchPrice ? `, 최저 ${fmtPrice(r.bestMatchPrice)}` : "") +
            (r.notified ? " 🔔알림전송" : "")
          : `${r.label ?? r.id}: ${r.status} ${r.error ?? ""}`
      )
      .join("\n") || "활성 감시가 없습니다");
});

// ---------- 감시 추가 ----------
$("btn-add").addEventListener("click", async () => {
  const v = (id) => $(id).value.trim();
  const origin = v("f-origin").toUpperCase();
  const destination = v("f-destination").toUpperCase();
  const departureDate = v("f-departureDate");
  if (origin.length !== 3 || destination.length !== 3 || !departureDate) {
    alert("출발지/도착지(IATA 3글자)와 출발일은 필수입니다");
    return;
  }
  const watch = {
    origin,
    destination,
    departureDate,
    returnDate: v("f-returnDate") || null,
    adults: parseInt(v("f-adults") || "1", 10),
    currency: v("f-currency"),
    maxPrice: v("f-maxPrice") ? parseFloat(v("f-maxPrice")) : null,
    maxStops: v("f-maxStops") === "" ? null : parseInt(v("f-maxStops"), 10),
    departAfter: v("f-departAfter") || null,
    departBefore: v("f-departBefore") || null,
    returnAfter: v("f-returnAfter") || null,
    returnBefore: v("f-returnBefore") || null,
    active: true,
    createdAt: serverTimestamp(),
    lastNotifiedPrice: null,
  };
  await addDoc(collection(db, "watches"), watch);
  ["f-origin", "f-destination", "f-maxPrice"].forEach((id) => ($(id).value = ""));
});

// ---------- 감시 목록 ----------
const listEl = $("watch-list");
onSnapshot(query(collection(db, "watches"), orderBy("createdAt", "desc")), (snap) => {
  listEl.innerHTML = "";
  if (snap.empty) {
    listEl.innerHTML = '<div class="card watch-meta">아직 감시가 없습니다</div>';
    return;
  }
  snap.forEach((d) => {
    const w = d.data();
    const card = document.createElement("div");
    card.className = "card";

    const conds = [];
    if (w.maxPrice != null) conds.push(`${fmtPrice(w.maxPrice, w.currency)} 이하`);
    if (w.maxStops != null) conds.push(w.maxStops === 0 ? "직항만" : `경유 ${w.maxStops}회까지`);
    if (w.departAfter || w.departBefore) conds.push(`출발 ${w.departAfter ?? ""}~${w.departBefore ?? ""}`);
    if (w.returnAfter || w.returnBefore) conds.push(`귀국 ${w.returnAfter ?? ""}~${w.returnBefore ?? ""}`);

    const bm = w.lastBestMatch;
    const priceLine = bm
      ? `<div class="price match">✅ 조건 충족: ${fmtPrice(bm.price, bm.currency)} (${bm.outboundStops === 0 ? "직항" : `경유 ${bm.outboundStops}회`} · ${(bm.carriers ?? []).join(",")})</div>`
      : w.lastBestPrice != null
        ? `<div class="price nomatch">조건 충족 없음 · 전체 최저 ${fmtPrice(w.lastBestPrice, w.currency)}</div>`
        : "";

    const checked = w.lastCheckedAt
      ? new Date(w.lastCheckedAt.seconds * 1000).toLocaleString("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
      : "아직 안 함";

    card.innerHTML = `
      <div class="watch-title">${w.origin} → ${w.destination}
        <span class="badge ${w.active ? "on" : "off"}">${w.active ? "감시 중" : "중지됨"}</span>
      </div>
      <div class="watch-meta">
        ${w.departureDate}${w.returnDate ? ` ~ ${w.returnDate}` : " (편도)"} · 성인 ${w.adults}<br/>
        ${conds.join(" · ") || "조건 없음 (모든 결과 알림)"}<br/>
        마지막 체크: ${checked}
      </div>
      ${priceLine}
    `;

    const toggle = document.createElement("button");
    toggle.className = "secondary";
    toggle.textContent = w.active ? "일시중지" : "다시 시작";
    toggle.addEventListener("click", () => updateDoc(doc(db, "watches", d.id), { active: !w.active }));
    card.appendChild(toggle);

    const del = document.createElement("button");
    del.className = "danger";
    del.textContent = "삭제";
    del.addEventListener("click", () => {
      if (confirm(`${w.origin}→${w.destination} 감시를 삭제할까요?`)) deleteDoc(doc(db, "watches", d.id));
    });
    card.appendChild(del);

    listEl.appendChild(card);
  });
});
