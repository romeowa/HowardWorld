import SwiftUI

// 새 여행 만들기 시트. 제목·시작일(선택)·기간을 입력받아 Firestore에 생성한다.
struct NewTripSheet: View {
    let onCreated: (Trip) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var hasDate = false
    @State private var startDate = Date()
    @State private var days = 3
    @State private var creating = false
    @State private var errorText: String?

    var body: some View {
        NavigationStack {
            Form {
                Section("여행 제목") {
                    TextField("예: 오사카 가족여행", text: $title)
                }

                Section("일정") {
                    Toggle("시작일 정하기", isOn: $hasDate.animation())
                    if hasDate {
                        DatePicker("시작일", selection: $startDate, displayedComponents: .date)
                            .environment(\.locale, Locale(identifier: "ko_KR"))
                    }
                    Stepper("기간: \(days)일", value: $days, in: 1...30)
                }

                if let errorText {
                    Section {
                        Text(errorText).foregroundStyle(.red).font(.caption)
                    }
                }
            }
            .navigationTitle("새 여행")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("취소") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("만들기") { Task { await create() } }.disabled(creating)
                }
            }
            .disabled(creating)
        }
    }

    private func create() async {
        creating = true
        errorText = nil
        let sd: String? = hasDate ? Self.ymd(startDate) : nil
        do {
            let trip = try await FirestoreREST.createTrip(
                title: title.trimmingCharacters(in: .whitespaces), startDate: sd, dayCount: days)
            onCreated(trip)
            dismiss()
        } catch {
            errorText = "여행을 만들지 못했어요. 네트워크를 확인해 주세요."
            creating = false
        }
    }

    static func ymd(_ d: Date) -> String {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        return f.string(from: d)
    }
}
