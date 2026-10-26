import Foundation

// 웹앱과 동일한 Firestore 스키마(howardworld 프로젝트)를 그대로 사용한다.
struct Trip: Identifiable, Equatable {
    let id: String
    var title: String
    var startDate: String?   // "YYYY-MM-DD"
    var dayCount: Int
    var members: [String]
    var memberColors: [String: String] = [:]   // 이름 → hex 색
    var rates: [String: Double] = [:]           // 통화 → 원/1단위 (고정 환율)
    var expenseCategories: [String]? = nil      // 커스텀 카테고리(없으면 기본)
}

struct Item: Identifiable, Equatable {
    let id: String
    var day: Int?            // nil = 후보(날짜 미정)
    var type: String         // place / food / activity / memo
    var name: String
    var address: String
    var lat: Double?
    var lng: Double?
    var time: String         // "HH:mm" or ""
    var memo: String
    var order: Double?

    var isCandidate: Bool { day == nil }
}

// 정산 내역(expenses 서브컬렉션). 웹과 동일 스키마.
struct Expense: Identifiable, Equatable {
    let id: String
    var kind: String                   // "expense" | "income"
    var amount: Double                 // 입력 통화 원금
    var currency: String               // KRW | JPY | USD
    var desc: String
    var category: String
    var day: Int?                      // 여행 외면 nil
    var offTrip: Bool
    var date: String                   // "YYYY-MM-DD" or ""
    var place: String
    var payer: String                  // 결제자(공금/수입이면 "")
    var fromPool: Bool                 // 공금 결제
    var sharedBy: [String]             // 나눠 낼 사람
    var contribs: [String: Double]     // 수입: 참여자별 기여(원금)
    var order: Double?

    var isIncome: Bool { kind == "income" }
}

// 정산 변경 이력(settleLog) 한 줄
struct SettleLogEntry: Identifiable {
    let id: String
    var action: String        // add | edit | delete
    var kind: String          // expense | income
    var summary: String
    var prevSummary: String?
    var by: String
    var ts: Date?
}

enum ItemType: String, CaseIterable {
    case place, food, activity, memo
    var emoji: String {
        switch self {
        case .place: return "📍"
        case .food: return "🍜"
        case .activity: return "🎟️"
        case .memo: return "📝"
        }
    }
    var label: String {
        switch self {
        case .place: return "장소"
        case .food: return "식사"
        case .activity: return "액티비티"
        case .memo: return "메모"
        }
    }
    static func of(_ raw: String) -> ItemType { ItemType(rawValue: raw) ?? .place }
}

// "YYYY-MM-DD" → Date
func ymdToDate(_ s: String) -> Date? {
    let f = DateFormatter()
    f.locale = Locale(identifier: "en_US_POSIX")
    f.dateFormat = "yyyy-MM-dd"
    return f.date(from: s)
}

// "Day N · M/d (요일)" 라벨
func dayTitle(_ trip: Trip, _ day: Int) -> String {
    guard let start = trip.startDate, let base = ymdToDate(start) else { return "Day \(day + 1)" }
    let d = Calendar.current.date(byAdding: .day, value: day, to: base) ?? base
    let fmt = DateFormatter()
    fmt.locale = Locale(identifier: "ko_KR")
    fmt.dateFormat = "M/d (E)"
    return "Day \(day + 1) · \(fmt.string(from: d))"
}

// 최근 연 여행 (UserDefaults 저장)
struct RecentTrip: Codable, Identifiable, Equatable {
    let id: String
    var title: String
    var startDate: String?
    var dayCount: Int?
}
