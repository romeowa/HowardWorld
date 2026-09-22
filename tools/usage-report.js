// 사용 로그(events) 요약 리포트 — 관리자용
// 실행: node tools/usage-report.js [일수]   (기본 14일)
//   예) node tools/usage-report.js 30
// gcloud 로그인 계정의 액세스 토큰으로 Firestore REST를 호출한다(별도 서비스 계정 불필요).
//   전제: `gcloud auth login` 된 상태 + 프로젝트 howardworld 접근 권한.
const { execSync } = require("child_process");

const PROJECT = "howardworld";
const days = parseInt(process.argv[2] || "14", 10);
const since = new Date(Date.now() - days * 86400000);

function fsVal(v) {
  if (!v) return undefined;
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return parseInt(v.integerValue, 10);
  if ("doubleValue" in v) return v.doubleValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("timestampValue" in v) return new Date(v.timestampValue);
  return undefined;
}

(async () => {
  let token;
  try { token = execSync("gcloud auth print-access-token", { encoding: "utf8" }).trim(); }
  catch { console.error("gcloud 토큰을 못 얻었습니다. `gcloud auth login` 확인."); process.exit(1); }

  const body = {
    structuredQuery: {
      from: [{ collectionId: "events" }],
      where: { fieldFilter: { field: { fieldPath: "ts" }, op: "GREATER_THAN_OR_EQUAL", value: { timestampValue: since.toISOString() } } },
      orderBy: [{ field: { fieldPath: "ts" }, direction: "DESCENDING" }],
      limit: 5000,
    },
  };
  const res = await fetch(`https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents:runQuery`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "X-Goog-User-Project": PROJECT },
    body: JSON.stringify(body),
  });
  if (!res.ok) { console.error(`조회 실패 (HTTP ${res.status}):`, (await res.text()).slice(0, 200)); process.exit(1); }
  const rows = await res.json();
  const docs = rows.filter((r) => r.document).map((r) => {
    const f = r.document.fields || {}; const o = {};
    for (const k in f) o[k] = fsVal(f[k]);
    return o;
  });

  const byType = {}, byDay = {}, byApp = {};
  docs.forEach((e) => {
    byType[e.type] = (byType[e.type] || 0) + 1;
    byApp[e.app || "?"] = (byApp[e.app || "?"] || 0) + 1;
    if (e.ts instanceof Date) { const k = e.ts.toISOString().slice(0, 10); byDay[k] = (byDay[k] || 0) + 1; }
  });
  const line = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => `  ${String(k).padEnd(16)} ${v}`).join("\n");
  console.log(`\n📊 최근 ${days}일 사용 로그 — 총 ${docs.length}건 (${since.toISOString().slice(0, 10)} 이후)\n`);
  console.log("■ 앱별\n" + (line(byApp) || "  (없음)"));
  console.log("\n■ 유형별\n" + (line(byType) || "  (없음)"));
  console.log("\n■ 날짜별");
  Object.keys(byDay).sort().forEach((k) => console.log(`  ${k}  ${byDay[k]}`));
  console.log("");
})().catch((e) => { console.error(e); process.exit(1); });
