// 사용 로그(events) 요약 리포트 — 관리자 전용(서비스 계정)
// 실행: node tools/usage-report.js [일수]   (기본 14일)
//   예) node tools/usage-report.js 30
// events 컬렉션은 보안 규칙상 Admin SDK로만 조회 가능(공개 read 차단).
const path = require("path");
const { createRequire } = require("module");
const CRAWLER = path.join(__dirname, "../flight-watch/crawler");
// firebase-admin은 크롤러에 설치돼 있음 → 그 위치 기준으로 해석(패키지 exports 맵 존중)
const crequire = createRequire(path.join(CRAWLER, "package.json"));
const { initializeApp, cert } = crequire("firebase-admin/app");
const { getFirestore } = crequire("firebase-admin/firestore");

initializeApp({ credential: cert(path.join(CRAWLER, "serviceAccount.json")), projectId: "howardworld" });
const db = getFirestore();

const days = parseInt(process.argv[2] || "14", 10);
const since = new Date(Date.now() - days * 86400000);

(async () => {
  const snap = await db.collection("events").where("ts", ">=", since).get();
  const byType = {}, byDay = {}, byApp = {};
  snap.forEach((d) => {
    const e = d.data();
    const t = e.ts && e.ts.toDate ? e.ts.toDate() : null;
    byType[e.type] = (byType[e.type] || 0) + 1;
    byApp[e.app || "?"] = (byApp[e.app || "?"] || 0) + 1;
    if (t) { const k = t.toISOString().slice(0, 10); byDay[k] = (byDay[k] || 0) + 1; }
  });

  const line = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => `  ${k.padEnd(16)} ${v}`).join("\n");
  console.log(`\n📊 최근 ${days}일 사용 로그 — 총 ${snap.size}건 (${since.toISOString().slice(0, 10)} 이후)\n`);
  console.log("■ 앱별\n" + (line(byApp) || "  (없음)"));
  console.log("\n■ 유형별\n" + (line(byType) || "  (없음)"));
  console.log("\n■ 날짜별");
  Object.keys(byDay).sort().forEach((k) => console.log(`  ${k}  ${byDay[k]}`));
  console.log("");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
