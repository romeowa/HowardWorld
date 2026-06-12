// flight-watch 상주 데몬
// - 시작 시 + CHECK_INTERVAL_MIN(기본 30분)마다 전체 감시 검사
// - 웹 UI의 "지금 체크" → Firestore control/checkNow 문서 갱신을 감지해 즉시 검사
// 실행: node index.js          (상주)
//       node index.js --once   (1회 검사 후 종료)

const fs = require("fs");
const path = require("path");
const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore, FieldValue, Timestamp } = require("firebase-admin/firestore");

const { searchFlights, resetProfile } = require("./googleFlights");
const { evaluate } = require("./matcher");
const { sendToAll } = require("./notify");

initializeApp({
  credential: cert(path.join(__dirname, "serviceAccount.json")),
  projectId: "howardworld",
});
const db = getFirestore();

const INTERVAL_MIN = parseInt(process.env.CHECK_INTERVAL_MIN ?? "30", 10);
const ONCE = process.argv.includes("--once");

function fmtPrice(price, currency = "KRW") {
  return new Intl.NumberFormat("ko-KR", { style: "currency", currency }).format(price);
}

function offerBrief(o) {
  if (!o) return null;
  return {
    price: o.price,
    currency: o.currency,
    outboundDepartTime: o.outbound.departTime,
    outboundStops: o.outbound.stops,
    carriers: o.outbound.carriers,
    inboundDepartTime: o.inbound?.departTime ?? null,
    inboundStops: o.inbound?.stops ?? null,
  };
}

async function checkWatch(doc, searchCache) {
  const watch = doc.data();
  const label = `${watch.origin}→${watch.destination} ${watch.departureDate}`;

  const today = new Date().toISOString().slice(0, 10);
  if (watch.departureDate < today) {
    await doc.ref.update({ active: false });
    return { id: doc.id, label, status: "expired" };
  }

  // 같은 검색 조건이면 이번 회차의 결과를 재사용 (중복 감시 대응)
  const needInbound = !!watch.returnDate && (watch.returnAfter || watch.returnBefore || watch.maxStops != null);
  const cacheKey = JSON.stringify([
    watch.origin, watch.destination, watch.departureDate, watch.returnDate ?? null,
    watch.adults ?? 1, watch.currency ?? "KRW", !!needInbound,
  ]);
  let offers;
  if (searchCache?.has(cacheKey)) {
    offers = searchCache.get(cacheKey);
    console.log(`  (캐시 재사용: ${label})`);
  } else {
    offers = await searchFlights(watch);
    searchCache?.set(cacheKey, offers);
  }
  const { bestMatch, bestOverall, matchCount } = evaluate(watch, offers);

  await doc.ref.collection("history").add({
    t: FieldValue.serverTimestamp(),
    offerCount: offers.length,
    matchCount,
    bestMatchPrice: bestMatch?.price ?? null,
    bestOverallPrice: bestOverall?.price ?? null,
  });

  const update = {
    lastCheckedAt: FieldValue.serverTimestamp(),
    lastOfferCount: offers.length,
    lastMatchCount: matchCount,
  };
  // 0건(노선 데이터 없음/일시 문제)일 땐 기존 가격 정보를 덮어쓰지 않는다
  if (offers.length > 0) {
    update.lastBestPrice = bestOverall?.price ?? null;
    update.lastBestMatch = offerBrief(bestMatch);
  }

  let notified = false;
  if (bestMatch && (watch.lastNotifiedPrice == null || bestMatch.price < watch.lastNotifiedPrice)) {
    const stopsTxt =
      bestMatch.outbound.stops === 0
        ? "직항"
        : bestMatch.outbound.stops != null
          ? `경유 ${bestMatch.outbound.stops}회`
          : "";
    const title = `✈️ ${watch.origin}→${watch.destination} ${fmtPrice(bestMatch.price)}`;
    const body =
      `${watch.departureDate}${watch.returnDate ? ` ~ ${watch.returnDate}` : ""}` +
      (stopsTxt ? ` · ${stopsTxt}` : "") +
      (bestMatch.outbound.carriers.length ? ` · ${bestMatch.outbound.carriers.join(",")}` : "") +
      (bestMatch.outbound.departTime ? ` · 출발 ${bestMatch.outbound.departTime}` : "") +
      ` (조건 충족 ${matchCount}건)`;
    // Mac 메뉴바 앱이 폴링으로 가져가 네이티브 알림으로 표시
    await db.collection("notifications").add({
      title,
      body,
      watchId: doc.id,
      t: FieldValue.serverTimestamp(),
    });
    // iPhone(PWA) 등 FCM 등록 기기용 웹 푸시
    await sendToAll({ title, body });
    update.lastNotifiedPrice = bestMatch.price;
    update.lastNotifiedAt = FieldValue.serverTimestamp();
    notified = true;
  }

  await doc.ref.update(update);
  return {
    id: doc.id,
    label,
    status: "ok",
    offers: offers.length,
    matches: matchCount,
    bestMatchPrice: bestMatch?.price ?? null,
    bestOverallPrice: bestOverall?.price ?? null,
    notified,
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 로그 자가 로테이션: 5MB 넘으면 .old로 복사 후 비움
// (launchd가 append 모드로 파일을 잡고 있으므로 rename 대신 copy+truncate)
const LOG_PATH = path.join(process.env.HOME ?? "", "Library/Logs/flight-watch.log");
function rotateLogIfNeeded() {
  try {
    const { size } = fs.statSync(LOG_PATH);
    if (size > 5 * 1024 * 1024) {
      fs.copyFileSync(LOG_PATH, LOG_PATH + ".old");
      fs.truncateSync(LOG_PATH, 0);
      console.log("로그 로테이션: 이전 로그는 flight-watch.log.old");
    }
  } catch {}
}

let running = false;
let pendingTrigger = null;
async function checkAll(trigger) {
  if (running) {
    // 검사 중 들어온 수동 요청은 큐에 넣어 끝나고 바로 실행
    if (trigger.startsWith("manual")) pendingTrigger = trigger;
    console.log(`이미 검사 중 — ${trigger} ${pendingTrigger ? "큐에 등록" : "건너뜀"}`);
    return;
  }
  running = true;
  rotateLogIfNeeded();
  const startedAt = new Date();
  console.log(`[${startedAt.toLocaleString("ko-KR")}] 검사 시작 (${trigger})`);
  try {
    await db.doc("control/status").set(
      { running: true, trigger, startedAt: FieldValue.serverTimestamp() },
      { merge: true }
    );
    const snap = await db.collection("watches").where("active", "==", true).get();
    const results = [];
    const searchCache = new Map();
    for (let i = 0; i < snap.docs.length; i++) {
      const doc = snap.docs[i];
      try {
        const r = await checkWatch(doc, searchCache);
        console.log(" ", JSON.stringify(r));
        results.push(r);
      } catch (err) {
        const w = doc.data();
        const label = `${w.origin}→${w.destination} ${w.departureDate}`;
        console.error(`  감시 ${label} (${doc.id}) 실패:`, err.message);
        results.push({ id: doc.id, label, status: "error", error: String(err.message ?? err) });
        // 차단당했으면 계속 두드리지 말고 이번 회차는 여기서 끝 (다음 주기에 재시도)
        if (String(err.message).includes("일시 차단")) {
          console.warn("  차단 추정 — 남은 감시는 다음 주기로 미룸");
          resetProfile(); // 플래그된 쿠키일 수 있으니 다음 회차는 새 프로필로
          break;
        }
      }
      // 구글 차단 회피: 감시 사이 간격
      if (i < snap.docs.length - 1) await sleep(30_000 + Math.random() * 30_000);
    }
    await db.doc("control/status").set({
      running: false,
      lastRunAt: FieldValue.serverTimestamp(),
      trigger,
      results,
    });
  } finally {
    running = false;
    if (pendingTrigger) {
      const t = pendingTrigger;
      pendingTrigger = null;
      console.log(`큐에 있던 ${t} 실행`);
      checkAll(t).catch((e) => console.error(e));
    }
  }
}

// 네트워크 끊김(잠자기 등)으로 인한 비정상 종료 방지
process.on("unhandledRejection", (err) => console.error("unhandledRejection:", err));
process.on("uncaughtException", (err) => console.error("uncaughtException:", err));

async function main() {
  if (ONCE) {
    await checkAll("manual-cli");
    process.exit(0);
  }

  // 웹/앱 "지금 체크" 감지 (시작 이전의 요청은 무시)
  const bootTime = Timestamp.now();
  db.doc("control/checkNow").onSnapshot(
    (snap) => {
      const requestedAt = snap.data()?.requestedAt;
      if (requestedAt && requestedAt.toMillis() > bootTime.toMillis()) {
        checkAll("manual-web").catch((e) => console.error(e));
      }
    },
    (err) => console.error("checkNow 리스너 오류 (자동 재연결 대기):", err.message)
  );

  await checkAll("startup");
  setInterval(() => checkAll("schedule").catch((e) => console.error(e)), INTERVAL_MIN * 60_000);
  console.log(`데몬 가동 중 — ${INTERVAL_MIN}분 간격`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
