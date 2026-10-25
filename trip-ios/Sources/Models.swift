import Foundation

// 웹앱과 동일한 Firestore 스키마(howardworld 프로젝트)를 그대로 사용한다.
struct Trip: Identifiable, Equatable {
    let id: String
    var title: String
    var startDate: String?   // "YYYY-MM-DD"
    var dayCount: Int
    var members: [String]
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
