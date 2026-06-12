// 크롤러 단독 테스트: node testCrawl.js ICN FUK 2026-07-10 [2026-07-14] [--headed] [--inbound]
// --inbound: 귀국편 조건이 있는 것처럼 2단계(가는편 클릭→귀국편 파싱) 크롤링을 강제
const { searchFlights } = require("./googleFlights");

const [origin, destination, departureDate, maybeReturn] = process.argv.slice(2);
const returnDate = maybeReturn && !maybeReturn.startsWith("--") ? maybeReturn : null;
const headless = !process.argv.includes("--headed");
const forceInbound = process.argv.includes("--inbound");

if (!origin || !destination || !departureDate) {
  console.log("사용법: node testCrawl.js ICN FUK 2026-07-10 [2026-07-14] [--headed]");
  process.exit(1);
}

searchFlights(
  { origin, destination, departureDate, returnDate, ...(forceInbound ? { returnAfter: "00:00" } : {}) },
  { headless }
)
  .then((offers) => {
    console.log(`\n총 ${offers.length}건 파싱:\n`);
    for (const o of offers.slice(0, 20)) {
      const ob = o.outbound;
      console.log(
        `  ${o.price.toLocaleString()}원 | 가는편 ${ob.departTime}→${ob.arriveTime}` +
          ` ${ob.stops === 0 ? "직항" : `경유${ob.stops}`} ${ob.carriers.join(",")}` +
          (o.inbound ? ` | 오는편 ${o.inbound.departTime}→${o.inbound.arriveTime} ${o.inbound.stops === 0 ? "직항" : `경유${o.inbound.stops}`}` : "")
      );
    }
    if (offers.length > 20) console.log(`  ... 외 ${offers.length - 20}건`);
  })
  .catch((err) => {
    console.error("크롤링 실패:", err.message);
    process.exit(1);
  });
