// watch 조건(가격/경유/시간대)과 크롤링된 offer 대조

function inWindow(time, after, before) {
  if (!time) return true; // 시간 파싱 실패 시 통과 (보수적으로 알림 쪽)
  if (after && time < after) return false;
  if (before && time > before) return false;
  return true;
}

function matches(watch, offer) {
  if (watch.maxPrice != null && offer.price > watch.maxPrice) return false;

  if (watch.maxStops != null) {
    if (offer.outbound.stops != null && offer.outbound.stops > watch.maxStops) return false;
    if (offer.inbound && offer.inbound.stops != null && offer.inbound.stops > watch.maxStops) return false;
  }

  if (!inWindow(offer.outbound.departTime, watch.departAfter, watch.departBefore)) return false;
  if (offer.inbound && !inWindow(offer.inbound.departTime, watch.returnAfter, watch.returnBefore)) {
    return false;
  }
  return true;
}

/** @returns { bestMatch, bestOverall, matchCount } */
function evaluate(watch, offers) {
  let bestMatch = null;
  let bestOverall = null;
  let matchCount = 0;
  for (const offer of offers) {
    if (!bestOverall || offer.price < bestOverall.price) bestOverall = offer;
    if (matches(watch, offer)) {
      matchCount++;
      if (!bestMatch || offer.price < bestMatch.price) bestMatch = offer;
    }
  }
  return { bestMatch, bestOverall, matchCount };
}

module.exports = { evaluate, matches };
