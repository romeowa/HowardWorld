import Foundation

// Firestore REST 클라이언트. 공개 규칙(trips get/write 공개)이라 키/로그인 없이 접근한다.
// 웹의 share 클라우드 함수도 키 없이 REST로 읽는 것과 동일한 방식.
enum FirestoreREST {
    static let base = "https://firestore.googleapis.com/v1/projects/howardworld/databases/(default)/documents"

    enum FSError: Error { case badURL, http(Int), decode }

    // ---- 값 추출 헬퍼 (Firestore REST value 포맷) ----
    static func str(_ v: Any?) -> String? { (v as? [String: Any])?["stringValue"] as? String }
    static func int(_ v: Any?) -> Int? {
        guard let m = v as? [String: Any] else { return nil }
        if let s = m["integerValue"] as? String { return Int(s) }
        if let n = m["integerValue"] as? Int { return n }
        if let d = m["doubleValue"] as? Double { return Int(d) }
        return nil
    }
    static func dbl(_ v: Any?) -> Double? {
        guard let m = v as? [String: Any] else { return nil }
        if let d = m["doubleValue"] as? Double { return d }
        if let n = m["doubleValue"] as? Int { return Double(n) }
        if let s = m["integerValue"] as? String { return Double(s) }
        return nil
    }
    static func strArray(_ v: Any?) -> [String] {
        guard let m = v as? [String: Any],
              let arr = (m["arrayValue"] as? [String: Any])?["values"] as? [[String: Any]] else { return [] }
        return arr.compactMap { $0["stringValue"] as? String }
    }
    static func isNull(_ v: Any?) -> Bool {
        guard let m = v as? [String: Any] else { return false }
        return m["nullValue"] != nil
    }

    private static func fetchJSON(_ path: String) async throws -> [String: Any] {
        guard let url = URL(string: base + path) else { throw FSError.badURL }
        let (data, resp) = try await URLSession.shared.data(from: url)
        let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
        guard code == 200 else { throw FSError.http(code) }
        guard let obj = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw FSError.decode }
        return obj
    }

    // 문서 이름에서 마지막 ID만
    private static func idFromName(_ name: String?) -> String {
        guard let name else { return "" }
        return String(name.split(separator: "/").last ?? "")
    }

    static func getTrip(_ id: String) async throws -> Trip {
        let obj = try await fetchJSON("/trips/\(id)")
        let f = obj["fields"] as? [String: Any] ?? [:]
        return Trip(
            id: id,
            title: str(f["title"]) ?? "여행",
            startDate: str(f["startDate"]),
            dayCount: int(f["dayCount"]) ?? 1,
            members: strArray(f["members"])
        )
    }

    static func getItems(_ tripId: String) async throws -> [Item] {
        // pageSize 넉넉히
        let obj = try await fetchJSON("/trips/\(tripId)/items?pageSize=300")
        let docs = obj["documents"] as? [[String: Any]] ?? []
        var items: [Item] = docs.map { doc in
            let f = doc["fields"] as? [String: Any] ?? [:]
            let dayVal: Int? = isNull(f["day"]) ? nil : int(f["day"])
            return Item(
                id: idFromName(doc["name"] as? String),
                day: dayVal,
                type: str(f["type"]) ?? "place",
                name: str(f["name"]) ?? "",
                address: str(f["address"]) ?? "",
                lat: dbl(f["lat"]),
                lng: dbl(f["lng"]),
                time: str(f["time"]) ?? "",
                memo: str(f["memo"]) ?? "",
                order: dbl(f["order"])
            )
        }
        // 일자 → 시간 → order 순 정렬
        items.sort { a, b in
            let da = a.day ?? Int.max, db = b.day ?? Int.max
            if da != db { return da < db }
            let ta = a.time.isEmpty ? "99:99" : a.time
            let tb = b.time.isEmpty ? "99:99" : b.time
            if ta != tb { return ta < tb }
            return (a.order ?? 0) < (b.order ?? 0)
        }
        return items
    }

    // ---- 쓰기 ----
    static func vStr(_ s: String) -> [String: Any] { ["stringValue": s] }
    static func vInt(_ n: Int) -> [String: Any] { ["integerValue": String(n)] }
    static func vDbl(_ d: Double) -> [String: Any] { ["doubleValue": d] }
    static func vNull() -> [String: Any] { ["nullValue": NSNull()] }

    private static func itemFields(_ it: Item) -> [String: Any] {
        [
            "day": it.day.map(vInt) ?? vNull(),
            "type": vStr(it.type),
            "name": vStr(it.name),
            "address": vStr(it.address),
            "lat": it.lat.map(vDbl) ?? vNull(),
            "lng": it.lng.map(vDbl) ?? vNull(),
            "time": vStr(it.time),
            "memo": vStr(it.memo),
        ]
    }

    @discardableResult
    private static func send(_ method: String, _ path: String, body: [String: Any]? = nil) async throws -> [String: Any] {
        guard let url = URL(string: base + path) else { throw FSError.badURL }
        var req = URLRequest(url: url)
        req.httpMethod = method
        if let body {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        let (data, resp) = try await URLSession.shared.data(for: req)
        let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(code) else { throw FSError.http(code) }
        if data.isEmpty { return [:] }
        return (try? JSONSerialization.jsonObject(with: data) as? [String: Any]) ?? [:]
    }

    // 새 항목 생성 → 생성된 id 반환
    @discardableResult
    static func addItem(tripId: String, _ it: Item) async throws -> String {
        var f = itemFields(it)
        f["order"] = vInt(Int(Date().timeIntervalSince1970 * 1000))
        let res = try await send("POST", "/trips/\(tripId)/items", body: ["fields": f])
        let name = res["name"] as? String ?? ""
        return String(name.split(separator: "/").last ?? "")
    }

    // 항목 전체 수정(편집 가능한 필드만 마스크로)
    static func updateItem(tripId: String, _ it: Item) async throws {
        let masks = ["day", "type", "name", "address", "lat", "lng", "time", "memo"]
        let q = masks.map { "updateMask.fieldPaths=\($0)" }.joined(separator: "&")
        try await send("PATCH", "/trips/\(tripId)/items/\(it.id)?\(q)", body: ["fields": itemFields(it)])
    }

    // 날짜만 변경(편입/후보로 내리기)
    static func setDay(tripId: String, itemId: String, day: Int?) async throws {
        let f = ["day": day.map(vInt) ?? vNull()]
        try await send("PATCH", "/trips/\(tripId)/items/\(itemId)?updateMask.fieldPaths=day", body: ["fields": f])
    }

    static func deleteItem(tripId: String, itemId: String) async throws {
        try await send("DELETE", "/trips/\(tripId)/items/\(itemId)")
    }

    // 새 여행 생성 (웹과 동일 스키마: title/startDate/dayCount/createdAt)
    static func createTrip(title: String, startDate: String?, dayCount: Int) async throws -> Trip {
        let name = title.trimmingCharacters(in: .whitespaces).isEmpty ? "새 여행" : title
        let days = max(1, dayCount)
        let iso = ISO8601DateFormatter().string(from: Date())
        let f: [String: Any] = [
            "title": vStr(name),
            "dayCount": vInt(days),
            "startDate": startDate.map(vStr) ?? vNull(),
            "createdAt": ["timestampValue": iso],
        ]
        let res = try await send("POST", "/trips", body: ["fields": f])
        let docName = res["name"] as? String ?? ""
        let id = String(docName.split(separator: "/").last ?? "")
        return Trip(id: id, title: name, startDate: startDate, dayCount: days, members: [])
    }
}
