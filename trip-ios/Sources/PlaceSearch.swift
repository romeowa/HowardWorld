import Foundation
import MapKit

struct PlaceResult: Identifiable, Equatable {
    let id = UUID()
    let name: String
    let address: String
    let lat: Double
    let lng: Double
}

// MapKit 로컬 검색 (네이티브, 키 불필요). 한국 영역으로 바이어스.
enum PlaceSearch {
    static func search(_ q: String, near region: MKCoordinateRegion? = nil) async -> [PlaceResult] {
        let query = q.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else { return [] }
        let req = MKLocalSearch.Request()
        req.naturalLanguageQuery = query
        req.region = region ?? MKCoordinateRegion(
            center: .init(latitude: 36.5, longitude: 127.8),
            span: .init(latitudeDelta: 6, longitudeDelta: 6))
        let search = MKLocalSearch(request: req)
        guard let resp = try? await search.start() else { return [] }
        return resp.mapItems.prefix(8).map { mi in
            let c = mi.placemark.coordinate
            return PlaceResult(name: mi.name ?? query, address: addr(mi), lat: c.latitude, lng: c.longitude)
        }
    }

    private static func addr(_ mi: MKMapItem) -> String {
        let t = mi.placemark.title ?? ""
        if let n = mi.name, t.hasPrefix(n) {
            return String(t.dropFirst(n.count)).trimmingCharacters(in: CharacterSet(charactersIn: " ,"))
        }
        return t
    }
}
