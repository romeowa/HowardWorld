import Foundation

@MainActor
final class Store: ObservableObject {
    @Published var recents: [RecentTrip] = []

    private let key = "recentTrips"

    init() { load() }

    func load() {
        guard let data = UserDefaults.standard.data(forKey: key),
              let list = try? JSONDecoder().decode([RecentTrip].self, from: data) else { return }
        recents = list
    }

    private func save() {
        if let data = try? JSONEncoder().encode(recents) {
            UserDefaults.standard.set(data, forKey: key)
        }
    }

    func remember(_ trip: Trip) {
        let r = RecentTrip(id: trip.id, title: trip.title, startDate: trip.startDate, dayCount: trip.dayCount)
        recents.removeAll { $0.id == r.id }
        recents.insert(r, at: 0)
        if recents.count > 30 { recents = Array(recents.prefix(30)) }
        save()
    }

    func forget(_ id: String) {
        recents.removeAll { $0.id == id }
        save()
    }

    // 링크 또는 ID 문자열에서 trip id 추출
    static func tripID(from input: String) -> String? {
        let s = input.trimmingCharacters(in: .whitespacesAndNewlines)
        if s.isEmpty { return nil }
        if let range = s.range(of: "/t/") {
            let rest = s[range.upperBound...]
            let id = rest.split(whereSeparator: { $0 == "/" || $0 == "?" || $0 == "#" }).first.map(String.init)
            return id
        }
        // 공백/슬래시 없는 순수 ID로 간주
        if !s.contains("/") && !s.contains(" ") { return s }
        return nil
    }
}
