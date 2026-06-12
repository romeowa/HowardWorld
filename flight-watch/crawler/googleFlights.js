// 구글플라이트 크롤러 (Playwright)
// hl=en + curr=KRW 로 고정해서 영어 aria-label을 파싱한다.
// 각 항공편 행의 aria-label에 가격/경유/시간/항공사가 전부 들어있음:
//   "From 350000 South Korean won. Nonstop flight with Jeju Air. Leaves
//    Incheon International Airport at 8:30 AM on ... and arrives at ... at 9:55 AM ..."

const path = require("path");
const fs = require("fs");
const { execSync } = require("child_process");
const { chromium } = require("playwright");

// 쿠키/스토리지가 유지되는 프로필 — 매번 새 브라우저보다 차단 확률이 낮다
const PROFILE_DIR = path.join(__dirname, ".chrome-profile");

/** 비정상 종료로 프로필 잠금을 쥔 좀비 크로뮴 정리 */
function killOrphanedBrowsers() {
  try {
    execSync(`pkill -f "${PROFILE_DIR}"`, { stdio: "ignore" });
  } catch {} // 매치 없으면 pkill이 1을 반환 — 정상
}

/** 차단 의심 시 프로필 초기화 (쿠키가 플래그됐을 수 있음) */
function resetProfile() {
  try {
    killOrphanedBrowsers();
    fs.rmSync(PROFILE_DIR, { recursive: true, force: true });
    console.warn("브라우저 프로필 초기화함");
  } catch (e) {
    console.warn("프로필 초기화 실패:", e.message);
  }
}

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

/** 현재 보이는 행들의 라벨만 수집 (DOM 상태 변경 없음) */
async function collectLabels(page) {
  return page.$$eval("li", (lis) =>
    lis
      .map((li) => {
        // 행 전체를 설명하는 긴 라벨만
        const cands = Array.from(li.querySelectorAll("[aria-label]"))
          .map((e) => e.getAttribute("aria-label"))
          .filter((l) => l && l.length > 80 && /won|₩/.test(l));
        return cands[0] ?? null;
      })
      .filter(Boolean)
  );
}

/** 현재 페이지에 보이는 항공편 행들을 파싱 */
async function parseVisibleFlights(page) {
  // 1차: 더보기 클릭 전에 일단 확보 — 클릭이 Oops 페이지를 유발해도 빈손이 안 되게
  let labels = await collectLabels(page);

  // "View more flights" 버튼이 있으면 눌러서 전체 노출 시도
  const moreBtn = page.locator('button[aria-label*="more flights"]').first();
  if (await moreBtn.isVisible().catch(() => false)) {
    await moreBtn.click().catch(() => {});
    await page.waitForTimeout(2500);
    const expanded = await collectLabels(page).catch(() => []);
    if (expanded.length >= labels.length) {
      labels = expanded; // 확장 성공
    } else {
      console.warn(`더보기 클릭 후 목록이 깨짐 — 클릭 전 ${labels.length}건으로 진행`);
    }
  }

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
        if (i === attempts - 1) {
          // 재시도 소진 — 0건이 아니라 에러다 (구글 일시 차단 가능성)
          throw new Error("구글플라이트 오류 페이지가 계속됨 (일시 차단 추정) — 다음 주기에 재시도");
        }
        console.warn(`구글플라이트 일시 오류 페이지 — Reload 재시도 (${i + 1}/${attempts})`);
        await reload.click().catch(() => {});
        await page.waitForTimeout(5000 + Math.random() * 5000);
        continue;
      }
      const body = (await page.textContent("body").catch(() => "")) ?? "";
      if (/no flights|no results|couldn'?t find/i.test(body)) return "empty";
      if (i === attempts - 1) throw err;
      await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
    }
  }
  throw new Error("결과를 확인하지 못함");
}

/**
 * 한 watch에 대해 구글플라이트 검색.
 * 왕복에서 귀국편 조건(시간대/경유)이 있으면 가는편 상위 후보를 클릭해 귀국편까지 파싱.
 * @returns offers: [{ price, currency, outbound: {...}, inbound: {...}|null }]
 */
async function searchFlights(watch, { headless = true, screenshotOnError = true } = {}) {
  const { origin, destination, departureDate, returnDate, adults = 1 } = watch;
  const paxPart = adults > 1 ? ` for ${adults} adults` : "";
  const q = returnDate
    ? `Flights from ${origin} to ${destination} on ${departureDate} through ${returnDate}${paxPart}`
    : `One way flights from ${origin} to ${destination} on ${departureDate}${paxPart}`;
  const url = `https://www.google.com/travel/flights?q=${encodeURIComponent(q)}&hl=en&curr=KRW`;

  // channel: "chromium" → 크롤링 전용 headless shell 대신 일반 크로뮴의
  // 새 headless 모드 사용 (탐지 가능성 낮음)
  killOrphanedBrowsers();
  const browser = await chromium.launchPersistentContext(PROFILE_DIR, {
    channel: "chromium",
    headless,
    locale: "en-US",
    timezoneId: "Asia/Seoul",
    viewport: { width: 1280, height: 900 },
    // UA의 "HeadlessChrome" 흔적 제거 (버전은 실제 엔진과 맞춤)
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
    // navigator.webdriver=false — 자동화 표식 제거
    args: ["--disable-blink-features=AutomationControlled"],
  });
  try {
    const page = await browser.newPage();
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
        const pages = browser.pages();
        if (pages[0]) await pages[0].screenshot({ path: "/tmp/flight-watch-error.png", fullPage: false });
        console.error("에러 스크린샷: /tmp/flight-watch-error.png");
      } catch {}
    }
    throw err;
  } finally {
    await browser.close();
  }
}

module.exports = { searchFlights, parseLabel, to24h, resetProfile };
