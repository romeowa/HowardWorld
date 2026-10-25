import SwiftUI
import MapKit

// 항목 추가/수정 시트. 장소 검색(MKLocalSearch)으로 좌표를 찍고, 날짜/시간/메모 편집.
struct ItemEditor: View {
    let trip: Trip
    let existing: Item?
    let presetDay: Int?            // 새 항목: 들어갈 날(nil = 후보)
    let onSave: (Item) async -> Void
    let onDelete: (() async -> Void)?

    @Environment(\.dismiss) private var dismiss
    @State private var type: ItemType
    @State private var name: String
    @State private var address: String
    @State private var daySel: Int           // -1 = 후보
    @State private var hasTime: Bool
    @State private var timeDate: Date
    @State private var memo: String
    @State private var lat: Double?
    @State private var lng: Double?
    @State private var saving = false

    // 검색
    @State private var query = ""
    @State private var results: [PlaceResult] = []
    @State private var searching = false
    @State private var searchTask: Task<Void, Never>?

    init(trip: Trip, existing: Item?, presetDay: Int?,
         onSave: @escaping (Item) async -> Void, onDelete: (() async -> Void)? = nil) {
        self.trip = trip
        self.existing = existing
        self.presetDay = presetDay
        self.onSave = onSave
        self.onDelete = onDelete
        let it = existing
        _type = State(initialValue: ItemType.of(it?.type ?? "place"))
        _name = State(initialValue: it?.name ?? "")
        _address = State(initialValue: it?.address ?? "")
        let d = it?.day ?? presetDay
        _daySel = State(initialValue: d ?? -1)
        _memo = State(initialValue: it?.memo ?? "")
        _lat = State(initialValue: it?.lat)
        _lng = State(initialValue: it?.lng)
        let parsed = ItemEditor.parseTime(it?.time ?? "")
        _hasTime = State(initialValue: parsed != nil)
        _timeDate = State(initialValue: parsed ?? defaultTime())
    }

    private var isNew: Bool { existing == nil }
    private var titleText: String { isNew ? (presetDay == nil ? "후보 담기" : "항목 추가") : "수정" }
    private var canSave: Bool {
        !(name.trimmingCharacters(in: .whitespaces).isEmpty
          && address.trimmingCharacters(in: .whitespaces).isEmpty
          && memo.trimmingCharacters(in: .whitespaces).isEmpty)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("종류", selection: $type) {
                        ForEach(ItemType.allCases, id: \.self) { t in
                            Text("\(t.emoji) \(t.label)").tag(t)
                        }
                    }
                    .pickerStyle(.menu)
                }

                Section("장소 검색 (지도)") {
                    HStack {
                        Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                        TextField("예: 남산타워, 스타벅스 강남…", text: $query)
                            .autocorrectionDisabled()
                            .onChange(of: query) { _, q in scheduleSearch(q) }
                        if searching { ProgressView() }
                    }
                    ForEach(results) { r in
                        Button { pick(r) } label: {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(r.name).foregroundStyle(.primary)
                                if !r.address.isEmpty {
                                    Text(r.address).font(.caption).foregroundStyle(.secondary)
                                }
                            }
                        }
                    }
                    if let la = lat, let lo = lng {
                        PickedMap(lat: la, lng: lo)
                            .frame(height: 140)
                            .listRowInsets(EdgeInsets())
                        HStack {
                            Label("위치 지정됨", systemImage: "mappin.circle.fill").foregroundStyle(.teal)
                            Spacer()
                            Button("위치 지우기") { lat = nil; lng = nil }
                                .font(.caption)
                        }
                    }
                }

                Section {
                    TextField("장소/메뉴/활동 이름", text: $name)
                    TextField("주소 또는 위치 설명", text: $address)
                }

                Section {
                    Picker("날짜", selection: $daySel) {
                        Text("후보 (날짜 미정)").tag(-1)
                        ForEach(0..<trip.dayCount, id: \.self) { i in
                            Text(dayTitle(trip, i)).tag(i)
                        }
                    }
                    if daySel >= 0 {
                        Toggle("시간 지정", isOn: $hasTime)
                        if hasTime {
                            DatePicker("시간", selection: $timeDate, displayedComponents: .hourAndMinute)
                        }
                    }
                }

                Section("메모") {
                    TextField("예약 정보, 팁, 준비물…", text: $memo, axis: .vertical)
                        .lineLimit(2...5)
                }

                if !isNew, let onDelete {
                    Section {
                        Button(role: .destructive) {
                            Task { saving = true; await onDelete(); dismiss() }
                        } label: {
                            Label("삭제", systemImage: "trash")
                        }
                    }
                }
            }
            .navigationTitle(titleText)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("취소") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("저장") { Task { await save() } }.disabled(!canSave || saving)
                }
            }
            .disabled(saving)
        }
    }

    private func scheduleSearch(_ q: String) {
        searchTask?.cancel()
        let query = q
        if query.trimmingCharacters(in: .whitespaces).isEmpty { results = []; searching = false; return }
        searchTask = Task {
            try? await Task.sleep(nanoseconds: 300_000_000)
            if Task.isCancelled { return }
            searching = true
            let res = await PlaceSearch.search(query)
            if Task.isCancelled { return }
            results = res
            searching = false
        }
    }

    private func pick(_ r: PlaceResult) {
        name = r.name
        address = r.address
        lat = r.lat; lng = r.lng
        results = []
        query = ""
        if type == .memo { type = .place }
    }

    private func save() async {
        saving = true
        var it = existing ?? Item(id: "", day: nil, type: "place", name: "",
                                  address: "", lat: nil, lng: nil, time: "", memo: "", order: nil)
        it.type = type.rawValue
        it.name = name.trimmingCharacters(in: .whitespaces)
        it.address = address.trimmingCharacters(in: .whitespaces)
        it.day = daySel < 0 ? nil : daySel
        it.time = (daySel >= 0 && hasTime) ? ItemEditor.timeString(timeDate) : ""
        it.memo = memo.trimmingCharacters(in: .whitespaces)
        it.lat = lat
        it.lng = lng
        await onSave(it)
        dismiss()
    }

    static func timeString(_ d: Date) -> String {
        let c = Calendar.current.dateComponents([.hour, .minute], from: d)
        return String(format: "%02d:%02d", c.hour ?? 0, c.minute ?? 0)
    }
    static func parseTime(_ s: String) -> Date? {
        let p = s.split(separator: ":")
        guard p.count == 2, let h = Int(p[0]), let m = Int(p[1]) else { return nil }
        return Calendar.current.date(bySettingHour: h, minute: m, second: 0, of: Date())
    }
}

private func defaultTime() -> Date {
    Calendar.current.date(bySettingHour: 9, minute: 0, second: 0, of: Date()) ?? Date()
}

// 선택된 좌표 미니 지도(핀 1개, 상호작용 없음)
struct PickedMap: View {
    let lat: Double
    let lng: Double
    var body: some View {
        Map(initialPosition: .region(.init(
            center: .init(latitude: lat, longitude: lng),
            span: .init(latitudeDelta: 0.01, longitudeDelta: 0.01)))) {
            Marker("", coordinate: .init(latitude: lat, longitude: lng)).tint(.red)
        }
        .mapControlVisibility(.hidden)
        .allowsHitTesting(false)
    }
}
