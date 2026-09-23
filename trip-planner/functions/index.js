// /t/{id} 요청에 여행 제목·요약을 넣은 OG 태그 HTML을 반환한다.
// (링크 미리보기 크롤러는 JS를 실행하지 않으므로 서버에서 메타를 렌더링)
// 일반 사용자에게도 이 HTML이 그대로 SPA를 부팅하므로 앱은 정상 동작한다.
const { onRequest } = require("firebase-functions/v2/https");

const PROJECT = "howardworld";
const BASE = "https://howard-trips.web.app";

const esc = (s) => (s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

exports.share = onRequest(
  { region: "asia-northeast3", memory: "256MiB", invoker: "public" },
  async (req, res) => {
    let title = "여행 일정";
    let desc = "링크 하나로 함께 짜는 여행";

    const m = req.path.match(/\/t\/([A-Za-z0-9_-]+)/);
    const id = m && m[1];
    if (id) {
      try {
        const r = await fetch(
          `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/trips/${id}`
        );
        if (r.ok) {
          const f = (await r.json()).fields || {};
          const t = f.title && f.title.stringValue;
          if (t) title = t;
          const start = f.startDate && f.startDate.stringValue;
          const dayCount = parseInt((f.dayCount && f.dayCount.integerValue) || "0", 10);
          const parts = [];
          if (start && dayCount) {
            const s = new Date(start + "T00:00:00");
            const e = new Date(s);
            e.setDate(e.getDate() + dayCount - 1);
            const md = (d) => `${d.getMonth() + 1}.${d.getDate()}`;
            parts.push(`${md(s)} — ${md(e)}`);
          }
          if (dayCount) parts.push(`${dayCount}일`);
          desc = parts.length ? `${parts.join(" · ")} 여행 일정` : "함께 짜는 여행 일정";
        }
      } catch (e) {
        console.error("trip fetch 실패", e);
      }
    }

    const url = `${BASE}${req.path}`;
    const ogMeta = `<meta property="og:type" content="website"/>
<meta property="og:site_name" content="여행 일정"/>
<meta property="og:title" content="${esc(title)}"/>
<meta property="og:description" content="${esc(desc)}"/>
<meta property="og:url" content="${esc(url)}"/>
<meta property="og:image" content="${BASE}/og.png"/>
<meta property="og:image:width" content="1200"/>
<meta property="og:image:height" content="630"/>
<meta name="twitter:card" content="summary_large_image"/>
<meta name="twitter:title" content="${esc(title)}"/>
<meta name="twitter:description" content="${esc(desc)}"/>
<meta name="twitter:image" content="${BASE}/og.png"/>`;

    // 배포된 최신 index.html을 가져와 OG 태그만 주입 → 앱 셸(버전 붙은 app.js 등)이 항상 최신
    let html;
    try {
      const shellRes = await fetch(`${BASE}/index.html`, { cache: "no-store" });
      html = await shellRes.text();
      html = html.replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(title)} · 여행 일정</title>`);
      html = html.replace(/<meta name="description"[^>]*>/, `<meta name="description" content="${esc(desc)}"/>`);
      html = html.replace("</head>", ogMeta + "\n</head>");
    } catch (e) {
      console.error("shell fetch 실패", e);
      html = `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover"/><title>${esc(title)} · 여행 일정</title><meta name="description" content="${esc(desc)}"/>${ogMeta}<link rel="stylesheet" href="/styles.css"/></head><body><div id="app"><div class="loading">불러오는 중…</div></div><script src="/config.js"></script><script type="module" src="/app.js"></script></body></html>`;
    }

    // 미리보기 캐시는 짧게(제목 변경 반영 지연 최소화), 브라우저는 매번 새로
    res.set("Cache-Control", "no-cache, s-maxage=120");
    res.status(200).send(html);
  }
);
