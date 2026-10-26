import Foundation

// 정산 모델·계산. 웹(app.js)의 computeSettlement/통화 로직을 그대로 옮긴다.

let POOL = "__pool__"   // 결제자 = 공금(공동 지갑) 표식
let DEFAULT_CATS = ["숙박", "식사", "교통", "간식", "관광", "기타"]

// 참여자 색 팔레트(웹과 동일)
let MEMBER_COLORS = ["#0f766e", "#b45309", "#6d5bd0", "#be123c", "#0369a1", "#4d7c0f", "#9d174d", "#0e7490"]
// 카테고리 색
let CAT_COLORS: [String: String] = ["숙박": "#6d5bd0", "식사": "#b45309", "교통": "#0369a1", "간식": "#be123c", "관광": "#4d7c0f", "기타": "#6f6a5f"]
let CAT_PALETTE = ["#0f766e", "#b45309", "#6d5bd0", "#be123c", "#0369a1", "#4d7c0f", "#9d174d", "#0e7490"]

struct CurrencyInfo { let sym: String; let unit: String; let label: String; let dec: Int; let def: Double }
enum Currency {
    static let order = ["KRW", "JPY", "USD"]
    static let all: [String: CurrencyInfo] = [
        "KRW": .init(sym: "₩", unit: "원", label: "원 KRW", dec: 0, def: 1),
        "JPY": .init(sym: "¥", unit: "엔", label: "엔 JPY", dec: 0, def: 9),
        "USD": .init(sym: "$", unit: "달러", label: "달러 USD", dec: 2, def: 1350),
    ]
    static func info(_ c: String) -> CurrencyInfo { all[c] ?? all["KRW"]! }
}

// 안정적 문자열 해시(웹 hashId와 동일 계열) — 색 폴백용
func hashId(_ s: String) -> Int {
    var h = 0
    for u in s.unicodeScalars { h = (h &* 31 &+ Int(u.value)) & 0x7fffffff }
    return h
}

func memberColor(_ trip: Trip?, _ name: String) -> String {
    if let c = trip?.memberColors[name], !c.isEmpty { return c }
    return MEMBER_COLORS[hashId(name) % MEMBER_COLORS.count]
}
func catColor(_ c: String) -> String {
    CAT_COLORS[c] ?? CAT_PALETTE[hashId(c.isEmpty ? "기타" : c) % CAT_PALETTE.count]
}
func initOf(_ name: String) -> String {
    String((name.trimmingCharacters(in: .whitespaces).first.map(String.init) ?? "?")).uppercased()
}

// 원/1단위 환율: trip.rates 우선, 없으면 통화 기본값
func fxRate(_ trip: Trip?, _ cur: String?) -> Double {
    guard let cur, cur != "KRW" else { return 1 }
    if let r = trip?.rates[cur], r > 0 { return r }
    return Currency.info(cur).def
}
func hasRate(_ trip: Trip?, _ cur: String?) -> Bool {
    guard let cur, cur != "KRW" else { return true }
    if let r = trip?.rates[cur], r > 0 { return true }
    return false
}
// 지출을 원화로 환산
func toKRW(_ trip: Trip?, _ e: Expense) -> Double { (Double(e.amount)) * fxRate(trip, e.currency.isEmpty ? "KRW" : e.currency) }
// 수입 기여 내역(신형 contribs 우선, 구형 payer/amount 폴백)
func incomeContribs(_ e: Expense) -> [String: Double] {
    if !e.contribs.isEmpty { return e.contribs }
    if !e.payer.isEmpty { return [e.payer: e.amount] }
    return [:]
}

// 실제로 쓰인 외화 목록(KRW 제외)
func usedForeign(_ expenses: [Expense]) -> [String] {
    Currency.order.filter { cur in
        cur != "KRW" && expenses.contains { (($0.currency.isEmpty ? "KRW" : $0.currency)) == cur }
    }
}

// 금액 → "1,234" (원화 반올림)
func won(_ n: Double) -> String {
    let v = (n).rounded()
    let f = NumberFormatter(); f.numberStyle = .decimal; f.maximumFractionDigits = 0; f.locale = Locale(identifier: "ko_KR")
    return f.string(from: NSNumber(value: v)) ?? "0"
}
// 외화 원금 표기: ¥5,000 / $12.50
func fmtCur(_ amt: Double, _ cur: String) -> String {
    let c = Currency.info(cur)
    let f = NumberFormatter(); f.numberStyle = .decimal; f.maximumFractionDigits = c.dec; f.locale = Locale(identifier: "ko_KR")
    return c.sym + (f.string(from: NSNumber(value: amt)) ?? "0")
}
func fmtRate(_ trip: Trip?, _ cur: String) -> String {
    let f = NumberFormatter(); f.numberStyle = .decimal; f.maximumFractionDigits = 4; f.locale = Locale(identifier: "ko_KR")
    return f.string(from: NSNumber(value: fxRate(trip, cur))) ?? "0"
}

// 카테고리 목록(커스텀 없으면 기본)
func tripCats(_ trip: Trip?) -> [String] {
    if let c = trip?.expenseCategories, !c.isEmpty { return c }
    return DEFAULT_CATS
}
// Day 인덱스 → "YYYY-MM-DD"
func dateForDay(_ trip: Trip?, _ i: Int) -> String {
    guard let s = trip?.startDate, let base = ymdToDate(s) else { return "" }
    let d = Calendar.current.date(byAdding: .day, value: i, to: base) ?? base
    let f = DateFormatter(); f.locale = Locale(identifier: "en_US_POSIX"); f.dateFormat = "yyyy-MM-dd"
    return f.string(from: d)
}
// 지출이 속한 Day 인덱스(여행 외면 nil)
func expDayIndex(_ trip: Trip?, _ e: Expense) -> Int? {
    if e.offTrip { return nil }
    if let d = e.day { return d }
    if !e.date.isEmpty, let s = trip?.startDate, let base = ymdToDate(s), let ed = ymdToDate(e.date) {
        let diff = Calendar.current.dateComponents([.day], from: base, to: ed).day ?? -1
        if diff >= 0 && diff < (trip?.dayCount ?? 1) { return diff }
    }
    return nil
}

// ---- 기록자(이 기기)·기기 ID : UserDefaults ----
func settleWho(_ tripId: String) -> String { UserDefaults.standard.string(forKey: "settleWho_\(tripId)") ?? "" }
func setSettleWho(_ tripId: String, _ name: String) {
    if name.isEmpty { UserDefaults.standard.removeObject(forKey: "settleWho_\(tripId)") }
    else { UserDefaults.standard.set(name, forKey: "settleWho_\(tripId)") }
}
func deviceId() -> String {
    let k = "deviceId"
    if let v = UserDefaults.standard.string(forKey: k) { return v }
    let v = "ios-" + UUID().uuidString.prefix(8)
    UserDefaults.standard.set(String(v), forKey: k)
    return String(v)
}

struct SettleTransfer: Identifiable {
    let id = UUID()
    let from: String   // 이름 또는 POOL
    let to: String
    let amount: Double
}
struct SettleResult {
    var names: [String] = []
    var share: [String: Double] = [:]      // 쓴 돈
    var paid: [String: Double] = [:]       // 낸 돈
    var net: [String: Double] = [:]        // 차액(반올림)
    var transfers: [SettleTransfer] = []
    var poolUsed = false
    var poolIn: Double = 0
    var poolSpent: Double = 0
    var poolBalance: Double = 0
}

// 웹 computeSettlement 그대로
func computeSettlement(_ trip: Trip?, _ expenses: [Expense]) -> SettleResult {
    let members0 = trip?.members ?? []
    var set = [String]()
    var seen = Set<String>()
    func addName(_ n: String) { if !n.isEmpty && !seen.contains(n) { seen.insert(n); set.append(n) } }
    members0.forEach(addName)
    for e in expenses {
        if e.isIncome { incomeContribs(e).keys.forEach(addName) }
        else if !e.fromPool && !e.payer.isEmpty { addName(e.payer) }
        e.sharedBy.forEach(addName)
    }
    let names = set

    var shareP = [String: Double](), poolShare = [String: Double]()
    var paidPersonal = [String: Double](), contrib = [String: Double]()
    for n in names { shareP[n] = 0; poolShare[n] = 0; paidPersonal[n] = 0; contrib[n] = 0 }
    var poolIn: Double = 0, poolSpent: Double = 0

    for e in expenses {
        let rate = fxRate(trip, e.currency.isEmpty ? "KRW" : e.currency)
        if e.isIncome {
            for (m, a) in incomeContribs(e) { let k = a * rate; contrib[m, default: 0] += k; poolIn += k }
            continue
        }
        let amt = toKRW(trip, e)
        let sb = e.sharedBy
        if e.fromPool {
            poolSpent += amt
            if !sb.isEmpty { let per = amt / Double(sb.count); for n in sb { poolShare[n, default: 0] += per } }
        } else {
            if !sb.isEmpty { let per = amt / Double(sb.count); for n in sb { shareP[n, default: 0] += per } }
            if !e.payer.isEmpty { paidPersonal[e.payer, default: 0] += amt }
        }
    }
    let surplus = poolIn - poolSpent

    var share = [String: Double](), paid = [String: Double](), net = [String: Double]()
    for n in names {
        share[n] = (shareP[n] ?? 0) + (poolShare[n] ?? 0)
        paid[n] = (paidPersonal[n] ?? 0) + (contrib[n] ?? 0)
        net[n] = ((paid[n] ?? 0) - (share[n] ?? 0)).rounded()
    }
    let poolUsed = (poolIn > 0 || poolSpent > 0)

    var transfers = [SettleTransfer]()
    if poolUsed {
        // 모두 공금과만 정산
        for n in names.filter({ (net[$0] ?? 0) > 0 }).sorted(by: { (net[$0] ?? 0) > (net[$1] ?? 0) }) {
            transfers.append(SettleTransfer(from: POOL, to: n, amount: net[n] ?? 0))
        }
        for n in names.filter({ (net[$0] ?? 0) < 0 }).sorted(by: { (net[$0] ?? 0) < (net[$1] ?? 0) }) {
            transfers.append(SettleTransfer(from: n, to: POOL, amount: -(net[n] ?? 0)))
        }
    } else {
        // 개인-개인 그리디 송금
        var cred = names.filter { (net[$0] ?? 0) > 0 }.map { (n: $0, v: net[$0] ?? 0) }.sorted { $0.v > $1.v }
        var debt = names.filter { (net[$0] ?? 0) < 0 }.map { (n: $0, v: -(net[$0] ?? 0)) }.sorted { $0.v > $1.v }
        var i = 0, j = 0
        while i < debt.count && j < cred.count {
            let pay = min(debt[i].v, cred[j].v)
            if pay > 0 { transfers.append(SettleTransfer(from: debt[i].n, to: cred[j].n, amount: pay)) }
            debt[i].v -= pay; cred[j].v -= pay
            if debt[i].v == 0 { i += 1 }
            if cred[j].v == 0 { j += 1 }
        }
    }

    var r = SettleResult()
    r.names = names; r.share = share; r.paid = paid; r.net = net; r.transfers = transfers
    r.poolUsed = poolUsed; r.poolIn = poolIn; r.poolSpent = poolSpent; r.poolBalance = surplus
    return r
}

// 변경 이력 요약(웹 settleSummary 그대로)
func settleSummary(_ e: Expense) -> String {
    let cur = e.currency.isEmpty ? "KRW" : e.currency
    let amtStr = cur == "KRW" ? "₩\(won(e.amount))" : fmtCur(e.amount, cur)
    if e.isIncome {
        let who = incomeContribs(e).keys.joined(separator: ", ")
        return "입금 \(amtStr)" + (who.isEmpty ? "" : " · \(who)") + (e.desc.isEmpty ? "" : " · \(e.desc)")
    }
    let payer = e.fromPool ? "공금" : e.payer
    return "\(e.category.isEmpty ? "기타" : e.category) \(amtStr)" + (payer.isEmpty ? "" : " · \(payer) 결제") + (e.desc.isEmpty ? "" : " · \(e.desc)")
}

// hex(#rrggbb) → SwiftUI Color 는 뷰에서 Color(hex:) 확장으로 처리
