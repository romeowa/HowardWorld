import SwiftUI
import MapKit

private struct EditTarget: Identifiable {
    let id = UUID()
    var item: Item?        // nil = 새 항목
    var presetDay: Int?    // 새 항목이 들어갈 날(nil = 후보)
}

private enum TripTab: String, CaseIterable { case plan = "일정", settle = "정산" }

struct TripView: View {
    let tripId: String
    @EnvironmentObject var store: Store
    @Environment(\.scenePhase) private var scenePhase

    @State private var trip: Trip?
    @State private var items: [Item] = []
    @State private var expenses: [Expense] = []
    @State private var loading = true
    @State private var errorMsg: String?
    @State private var editTarget: EditTarget?
    @State private var syncing = false        // 백그라운드 동기화 진행 표시
    @State private var tab: TripTab = .plan

    private let pollInterval: UInt64 = 4_000_000_000   // 4초

    private var pinned: [Item] { items.filter { $0.day != nil && $0.lat != nil } }
    private var candidates: [Item] { items.filter { $0.isCandidate } }

    var body: some View {
        VStack(spacing: 0) {
            if !loading && errorMsg == nil {
                Picker("", selection: $tab) {
                    ForEach(TripTab.allCases, id: \.self) { Text($0.rawValue).tag($0) }
                }
                .pickerStyle(.segmented)
                .padding(.horizontal).padding(.top, 6).padding(.bottom, 8)
            }
            Group {
                if loading {
                    ProgressView("불러오는 중…").frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if let errorMsg {
                    ContentUnavailableView("여행을 열 수 없어요", systemImage: "exclamationmark.triangle", description: Text(errorMsg))
                } else if let trip {
                    switch tab {
                    case .plan: content(trip)
                    case .settle: SettleView(trip: trip, tripId: tripId, items: items, expenses: expenses,
                                              reload: { await syncSilently() })
                    }
                }
            }
        }
        .navigationTitle(trip?.title ?? "여행")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if syncing {
                ToolbarItem(placement: .topBarTrailing) {
                    ProgressView().controlSize(.small)
                }
            }
        }
        .task {
            await load()
            await startPolling()
        }
        .onChange(of: scenePhase) { _, phase in
            // 앱이 다시 활성화되면 즉시 한 번 동기화
            if phase == .active && !loading { Task { await syncSilently() } }
        }
        .sheet(item: $editTarget) { target in
            if let trip {
                ItemEditor(
                    trip: trip,
                    existing: target.item,
                    presetDay: target.presetDay,
                    onSave: { await addOrUpdate($0) },
                    onDelete: target.item.map { it in { await delete(it) } }
                )
            }
        }
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
                Section(dayTitle(trip, day)) {
                    ForEach(dayItems) { it in
                        row(it, trip: trip, candidate: false)
                    }
                    Button {
                        editTarget = EditTarget(item: nil, presetDay: day)
                    } label: {
                        Label("장소 추가", systemImage: "plus")
                    }
                    .foregroundStyle(.tint)
                }
            }

            Section {
                ForEach(candidates) { it in
                    row(it, trip: trip, candidate: true)
                }
                Button {
                    editTarget = EditTarget(item: nil, presetDay: nil)
                } label: {
                    Label("후보 담기", systemImage: "plus")
                }
                .foregroundStyle(.tint)
            } header: {
                Text("📍 후보 (날짜 미정)")
            }

            Section {
                Text("총 \(items.filter { $0.day != nil }.count)곳" + (candidates.isEmpty ? "" : " · 후보 \(candidates.count)곳"))
                    .font(.caption).foregroundStyle(.secondary)
                Label("자동 동기화 켜짐 · 아래로 당겨 새로고침", systemImage: "arrow.triangle.2.circlepath")
                    .font(.caption2).foregroundStyle(.secondary)
            }
        }
        .listStyle(.insetGrouped)
        .refreshable { await syncSilently() }
    }

    @ViewBuilder
    private func row(_ it: Item, trip: Trip, candidate: Bool) -> some View {
        Button { editTarget = EditTarget(item: it, presetDay: nil) } label: {
            HStack {
                ItemRow(item: it)
                Spacer(minLength: 0)
                if candidate {
                    Menu {
                        ForEach(0..<trip.dayCount, id: \.self) { d in
                            Button(dayTitle(trip, d)) { Task { await assign(it, day: d) } }
                        }
                    } label: {
                        Text("날짜에 넣기").font(.caption.weight(.semibold))
                    }
                }
            }
        }
        .buttonStyle(.plain)
        .swipeActions(edge: .trailing, allowsFullSwipe: true) {
            Button(role: .destructive) { Task { await delete(it) } } label: {
                Label("삭제", systemImage: "trash")
            }
        }
        .swipeActions(edge: .leading) {
            if candidate {
                // 후보 → 첫째 날로 빠르게
                Button { Task { await assign(it, day: 0) } } label: {
                    Label("Day 1", systemImage: "calendar.badge.plus")
                }.tint(.teal)
            } else {
                Button { Task { await assign(it, day: nil) } } label: {
                    Label("후보로", systemImage: "tray.and.arrow.down")
                }.tint(.orange)
            }
        }
    }

    // ---- 데이터 ----
    private func load() async {
        loading = true; errorMsg = nil
        do {
            async let t = FirestoreREST.getTrip(tripId)
            async let i = FirestoreREST.getItems(tripId)
            async let x = FirestoreREST.getExpenses(tripId)
            let (tr, it, ex) = try await (t, i, x)
            trip = tr; items = it; expenses = ex
            store.remember(tr)
        } catch {
            errorMsg = friendly(error)
        }
        loading = false
    }

    private func reload() async {
        if let it = try? await FirestoreREST.getItems(tripId), items != it { items = it }
    }

    // 화면이 열려 있는 동안 주기적으로 조용히 동기화. 뷰가 사라지면 .task가 취소된다.
    private func startPolling() async {
        while !Task.isCancelled {
            try? await Task.sleep(nanoseconds: pollInterval)
            if Task.isCancelled { break }
            if editTarget != nil { continue }   // 편집 시트가 떠 있으면 건너뜀
            await syncSilently()
        }
    }

    // 여행 메타 + 항목을 다시 읽어 변경분만 반영(깜빡임 방지). 일시 오류는 조용히 무시.
    private func syncSilently() async {
        if editTarget != nil { return }
        syncing = true
        defer { syncing = false }
        do {
            async let tReq = FirestoreREST.getTrip(tripId)
            async let iReq = FirestoreREST.getItems(tripId)
            async let xReq = FirestoreREST.getExpenses(tripId)
            let (tr, it, ex) = try await (tReq, iReq, xReq)
            if trip != tr { trip = tr; store.remember(tr) }
            if items != it { items = it }
            if expenses != ex { expenses = ex }
        } catch {
            // 네트워크 일시 오류 등은 다음 주기에 재시도
        }
    }

    private func addOrUpdate(_ it: Item) async {
        do {
            if it.id.isEmpty { try await FirestoreREST.addItem(tripId: tripId, it) }
            else { try await FirestoreREST.updateItem(tripId: tripId, it) }
            await reload()
        } catch { errorMsg = friendly(error) }
    }

    private func assign(_ it: Item, day: Int?) async {
        try? await FirestoreREST.setDay(tripId: tripId, itemId: it.id, day: day)
        await reload()
    }

    private func delete(_ it: Item) async {
        try? await FirestoreREST.deleteItem(tripId: tripId, itemId: it.id)
        await reload()
    }

    private func friendly(_ e: Error) -> String {
        if case FirestoreREST.FSError.http(let code) = e {
            if code == 404 { return "링크가 올바르지 않거나 삭제된 여행이에요." }
            return "서버 오류 (HTTP \(code))"
        }
        return "네트워크 오류예요. 잠시 후 다시 시도해 주세요."
    }
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

// 핀을 담은 지도 (번호 마커)
struct TripMap: View {
    let items: [Item]

    // 날짜별 경로선(정렬된 방문 순서). 날이 바뀌면 선을 끊는다.
    private var dayRoutes: [[CLLocationCoordinate2D]] {
        let groups = Dictionary(grouping: items) { $0.day ?? -1 }
        return groups.keys.sorted().compactMap { day in
            let coords = groups[day]!.compactMap { it -> CLLocationCoordinate2D? in
                guard let la = it.lat, let lo = it.lng else { return nil }
                return CLLocationCoordinate2D(latitude: la, longitude: lo)
            }
            return coords.count > 1 ? coords : nil
        }
    }

    var body: some View {
        Map(initialPosition: .region(region)) {
            // 이동 순서대로 잇는 경로선(웹과 동일: teal) — 날짜별로 끊어서
            ForEach(Array(dayRoutes.enumerated()), id: \.offset) { _, coords in
                MapPolyline(coordinates: coords)
                    .stroke(.teal.opacity(0.85), style: StrokeStyle(lineWidth: 3.5, lineCap: .round, lineJoin: .round))
            }
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
