import SwiftUI
import MapKit

struct TripView: View {
    let tripId: String
    @EnvironmentObject var store: Store

    @State private var trip: Trip?
    @State private var items: [Item] = []
    @State private var loading = true
    @State private var errorMsg: String?

    private var pinned: [Item] { items.filter { $0.day != nil && $0.lat != nil } }
    private var candidates: [Item] { items.filter { $0.isCandidate } }

    var body: some View {
        Group {
            if loading {
                ProgressView("불러오는 중…")
            } else if let errorMsg {
                ContentUnavailableView("여행을 열 수 없어요", systemImage: "exclamationmark.triangle", description: Text(errorMsg))
            } else if let trip {
                content(trip)
            }
        }
        .navigationTitle(trip?.title ?? "여행")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    @ViewBuilder
    private func content(_ trip: Trip) -> some View {
        List {
            if !pinned.isEmpty {
                Section {
                    TripMap(items: pinned)
                        .frame(height: 230)
                        .listRowInsets(EdgeInsets())
                }
            }

            ForEach(0..<trip.dayCount, id: \.self) { day in
                let dayItems = items.filter { $0.day == day }
                Section(dayLabel(trip, day)) {
                    if dayItems.isEmpty {
                        Text("아직 없음").foregroundStyle(.secondary).font(.subheadline)
                    } else {
                        ForEach(dayItems) { ItemRow(item: $0) }
                    }
                }
            }

            if !candidates.isEmpty {
                Section("📍 후보 (날짜 미정)") {
                    ForEach(candidates) { ItemRow(item: $0) }
                }
            }

            Section {
                Text("총 \(items.filter { $0.day != nil }.count)곳" + (candidates.isEmpty ? "" : " · 후보 \(candidates.count)곳"))
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
        .listStyle(.insetGrouped)
    }

    private func load() async {
        loading = true; errorMsg = nil
        do {
            async let t = FirestoreREST.getTrip(tripId)
            async let i = FirestoreREST.getItems(tripId)
            let (tr, it) = try await (t, i)
            trip = tr; items = it
            store.remember(tr)
        } catch {
            errorMsg = friendly(error)
        }
        loading = false
    }

    private func friendly(_ e: Error) -> String {
        if case FirestoreREST.FSError.http(let code) = e {
            if code == 404 { return "링크가 올바르지 않거나 삭제된 여행이에요." }
            return "서버 오류 (HTTP \(code))"
        }
        return "네트워크 오류예요. 잠시 후 다시 시도해 주세요."
    }

    private func dayLabel(_ trip: Trip, _ day: Int) -> String {
        guard let start = trip.startDate, let base = ymdToDate(start) else { return "Day \(day + 1)" }
        let d = Calendar.current.date(byAdding: .day, value: day, to: base) ?? base
        let fmt = DateFormatter()
        fmt.locale = Locale(identifier: "ko_KR")
        fmt.dateFormat = "M/d (E)"
        return "Day \(day + 1) · \(fmt.string(from: d))"
    }
}

private func ymdToDate(_ s: String) -> Date? {
    let f = DateFormatter()
    f.locale = Locale(identifier: "en_US_POSIX")
    f.dateFormat = "yyyy-MM-dd"
    return f.date(from: s)
}

struct ItemRow: View {
    let item: Item
    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Text(ItemType.of(item.type).emoji)
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 8) {
                    if !item.time.isEmpty {
                        Text(item.time).font(.caption.monospaced()).foregroundStyle(.secondary)
                    }
                    Text(item.name.isEmpty ? ItemType.of(item.type).label : item.name)
                        .font(.body.weight(.medium))
                }
                if !item.address.isEmpty {
                    Text(item.address).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                }
                if !item.memo.isEmpty {
                    Text(item.memo).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                }
            }
        }
        .padding(.vertical, 2)
    }
}

// 핀을 담은 지도 (일정 순서대로 경로선 + 번호 마커)
struct TripMap: View {
    let items: [Item]

    var body: some View {
        Map(initialPosition: .region(region)) {
            ForEach(Array(items.enumerated()), id: \.element.id) { idx, it in
                if let lat = it.lat, let lng = it.lng {
                    Marker("\(idx + 1). \(it.name)", coordinate: .init(latitude: lat, longitude: lng))
                        .tint(.teal)
                }
            }
        }
        .mapControlVisibility(.hidden)
    }

    private var region: MKCoordinateRegion {
        let coords = items.compactMap { it -> CLLocationCoordinate2D? in
            guard let la = it.lat, let lo = it.lng else { return nil }
            return .init(latitude: la, longitude: lo)
        }
        guard !coords.isEmpty else {
            return MKCoordinateRegion(center: .init(latitude: 37.5665, longitude: 126.9780),
                                      span: .init(latitudeDelta: 0.5, longitudeDelta: 0.5))
        }
        let lats = coords.map(\.latitude), lngs = coords.map(\.longitude)
        let minLa = lats.min()!, maxLa = lats.max()!, minLo = lngs.min()!, maxLo = lngs.max()!
        let center = CLLocationCoordinate2D(latitude: (minLa + maxLa) / 2, longitude: (minLo + maxLo) / 2)
        let span = MKCoordinateSpan(latitudeDelta: max((maxLa - minLa) * 1.4, 0.01),
                                    longitudeDelta: max((maxLo - minLo) * 1.4, 0.01))
        return MKCoordinateRegion(center: center, span: span)
    }
}
