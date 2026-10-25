import SwiftUI

// 항목 추가/수정 시트. 날짜(후보 포함)·시간·종류·이름·주소·메모 편집.
// 장소 좌표 검색은 다음 단계(MKLocalSearch). 지금은 기존 좌표를 보존한다.
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
    @State private var saving = false

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
        let parsed = ItemEditor.parseTime(it?.time ?? "")
        _hasTime = State(initialValue: parsed != nil)
        _timeDate = State(initialValue: parsed ?? defaultTime())
    }

    private var isNew: Bool { existing == nil }
    private var titleText: String {
        isNew ? (presetDay == nil ? "후보 담기" : "항목 추가") : "수정"
    }
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
                ToolbarItem(placement: .cancellationAction) {
                    Button("취소") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("저장") { Task { await save() } }
                        .disabled(!canSave || saving)
                }
            }
            .disabled(saving)
        }
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
