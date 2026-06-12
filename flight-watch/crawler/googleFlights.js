// 구글플라이트 크롤러 (Playwright)
// hl=en + curr=KRW 로 고정해서 영어 aria-label을 파싱한다.
// 각 항공편 행의 aria-label에 가격/경유/시간/항공사가 전부 들어있음:
//   "From 350000 South Korean won. Nonstop flight with Jeju Air. Leaves
//    Incheon International Airport at 8:30 AM on ... and arrives at ... at 9:55 AM ..."

const { chromium } = require("playwright");

/** "8:30 AM" → "08:30" (24h) */
function to24h(t) {
  const m = t.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = m[2];
  const ampm = m[3].toUpperCase();
  if (ampm === "PM" && h !== 12) h += 12;
  if (ampm === "AM" && h === 12) h = 0;
  return `${String(h).padStart(2, "0")}:${min}`;
}

/** 항공편 행 aria-label 하나를 파싱 */
function parseLabel(label) {
  const priceM = label.match(/From ([\d,]+) South Korean won/i) || label.match(/₩([\d,]+)/);
  if (!priceM) return null;
  const price = parseInt(priceM[1].replace(/,/g, ""), 10);

  let stops = null;
  if (/Nonstop/i.test(label)) stops = 0;
  else {
    const stopM = label.match(/(\d+) stops?/i);
    if (stopM) stops = parseInt(stopM[1], 10);
  }

  const departM = label.match(/Leaves [^.]*? at (\d{1,2}:\d{2}\s*[AP]M)/i);
  const arriveM = label.match(/arrives at [^.]*? at (\d{1,2}:\d{2}\s*[AP]M)/i);
  const carrierM = label.match(/flights? with ([^.]+?)\./i);
  const durM = label.match(/Total duration (?:(\d+) hr)?\s*(?:(\d+) min)?/i);

  return {
    price,
    currency: "KRW",
    stops,
    departTime: departM ? to24h(departM[1]) : null,
    arriveTime: arriveM ? to24h(arriveM[1]) : null,
    carriers: carrierM ? carrierM[1].split(/,| and /).map((s) => s.trim()).filter(Boolean) : [],
    duration: durM ? `${durM[1] ?? 0}h${durM[2] ?? 0}m` : null,
    raw: label,
  };
}

/** 현재 페이지에 보이는 항공편 행들을 파싱 */
async function parseVisibleFlights(page) {
  // "View more flights" 버튼이 있으면 눌러서 전체 노출
  const moreBtn = page.locator('button[aria-label*="more flights"]').first();
  if (await moreBtn.isVisible().catch(() => false)) {
    await moreBtn.click().catch(() => {});
    await page.waitForTimeout(1500);
  }
  const labels = await page.$$eval("li", (lis) =>
    lis
      .map((li) => {
        const el = li.querySelector("[aria-label]");
        // 행 전체를 설명하는 긴 라벨만
        const cands = Array.from(li.querySelectorAll("[aria-label]"))
          .map((e) => e.getAttribute("aria-label"))
          .filter((l) => l && l.length > 80 && /won|₩/.test(l));
        return cands[0] ?? null;
      })
      .filter(Boolean)
  );
  const seen = new Set();
  const flights = [];
  for (const label of labels) {
    if (seen.has(label)) continue;
    seen.add(label);
    const f = parseLabel(label);
    if (f) flights.push(f);
  }
  return flights;
}

async function dismissConsent(page) {
  for (const text of ["Accept all", "모두 수락", "I agree"]) {
    const btn = page.locator(`button:has-text("${text}")`).first();
    if (await btn.isVisible().catch(() => false)) {
      await btn.click().catch(() => {});
      await page.waitForTimeout(1000);
      return;
    }
  }
}

/**
 * 결과 목록이 뜰 때까지 대기. 구글이 가끔 "Oops, something went wrong"
 * 일시 오류 페이지를 띄우므로 Reload 버튼을 눌러 재시도한다.
 * @returns "results" | "empty"
 */
async function waitForResults(page, attempts = 3) {
  for (let i = 0; i < attempts; i++) {
    try {
      await page.waitForSelector('li [aria-label*="won"], li [aria-label*="₩"]', { timeout: 30_000 });
      return "results";
    } catch (err) {
      const reload = page.locator('button:has-text("Reload")').first();
      if (await reload.isVisible().catch(() => false)) {
        console.warn(`구글플라이트 일시 오류 페이지 — Reload 재시도 (${i + 1}/${attempts})`);
        await reload.click().catch(() => {});
        await page.waitForTimeout(3000);
        continue;
      }
      const body = (await page.textContent("body").catch(() => "")) ?? "";
      if (/no flights|no results|couldn'?t find/i.test(body)) return "empty";
      if (i === attempts - 1) throw err;
      await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
    }
  }
  return "empty";
}

/**
 * 한 watch에 대해 구글플라이트 검색.
 * 왕복에서 귀국편 조건(시간대/경유)이 있으면 가는편 상위 후보를 클릭해 귀국편까지 파싱.
 * @returns offers: [{ price, currency, outbound: {...}, inbound: {...}|null }]
 */
async function searchFlights(watch, { headless = true, screenshotOnError = true } = {}) {
  const { origin, destination, departureDate, returnDate } = watch;
  const q = returnDate
    ? `Flights from ${origin} to ${destination} on ${departureDate} through ${returnDate}`
    : `One way flights from ${origin} to ${destination} on ${departureDate}`;
  const url = `https://www.google.com/travel/flights?q=${encodeURIComponent(q)}&hl=en&curr=KRW`;

  const browser = await chromium.launch({ headless });
  try {
    const ctx = await browser.newContext({
      locale: "en-US",
      timezoneId: "Asia/Seoul",
      viewport: { width: 1280, height: 900 },
    });
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await dismissConsent(page);
    if ((await waitForResults(page)) === "empty") {
      console.warn(`결과 없음: ${watch.origin}→${watch.destination} ${watch.departureDate}`);
      return [];
    }
    await page.waitForTimeout(2000);

    const outbounds = await parseVisibleFlights(page);

    const needInbound =
      !!returnDate && (watch.returnAfter || watch.returnBefore || watch.maxStops != null);

    if (!needInbound) {
      return outbounds.map((f) => ({
        price: f.price,
        currency: f.currency,
        outbound: f,
        inbound: null,
      }));
    }

    // 가는편 후보(가격순 상위 5개)를 클릭해서 귀국편 목록 파싱
    const candidates = [...outbounds].sort((a, b) => a.price - b.price).slice(0, 5);
    const offers = [];
    for (const ob of candidates) {
      try {
        const row = page
          .locator(`li:has([aria-label="${ob.raw.replace(/"/g, '\\"')}"])`)
          .first();
        if (!(await row.isVisible().catch(() => false))) continue;
        await row.click();
        if ((await waitForResults(page, 2)) === "empty") continue;
        await page.waitForTimeout(2000);
        const inbounds = await parseVisibleFlights(page);
        for (const ib of inbounds) {
          offers.push({ price: ib.price, currency: "KRW", outbound: ob, inbound: ib });
        }
        await page.goBack({ waitUntil: "domcontentloaded" });
        if ((await waitForResults(page, 2)) === "empty") break;
        await page.waitForTimeout(1500);
      } catch (err) {
        console.warn(`귀국편 파싱 실패 (가는편 ${ob.departTime}): ${err.message}`);
      }
    }
    return offers;
  } catch (err) {
    if (screenshotOnError) {
      try {
        const pages = browser.contexts()[0]?.pages() ?? [];
        if (pages[0]) await pages[0].screenshot({ path: "/tmp/flight-watch-error.png", fullPage: false });
        console.error("에러 스크린샷: /tmp/flight-watch-error.png");
      } catch {}
    }
    throw err;
  } finally {
    await browser.close();
  }
}

module.exports = { searchFlights, parseLabel, to24h };
