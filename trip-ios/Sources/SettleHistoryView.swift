import SwiftUI

// 정산 변경 이력(settleLog) — 추가/수정/삭제 요약을 시간 역순으로.
struct SettleHistoryView: View {
    let tripId: String
    @Environment(\.dismiss) private var dismiss
    @State private var rows: [SettleLogEntry] = []
    @State private var loading = true

    var body: some View {
        NavigationStack {
            Group {
                if loading {
                    ProgressView()
                } else if rows.isEmpty {
                    ContentUnavailableView("아직 변경 이력이 없어요",
                        systemImage: "clock.arrow.circlepath",
                        description: Text("지출·입금을 추가·수정·삭제하면 여기에 쌓입니다."))
                } else {
                    List(rows) { r in
                        HStack(alignment: .top, spacing: 10) {
                            Text(actionLabel(r.action))
                                .font(.caption2.weight(.bold))
                                .padding(.horizontal, 7).padding(.vertical, 3)
                                .background(actionColor(r.action).opacity(0.15))
                                .foregroundStyle(actionColor(r.action))
                                .clipShape(Capsule())
                            VStack(alignment: .leading, spacing: 3) {
                                Text(r.summary).font(.subheadline)
                                if r.action == "edit", let p = r.prevSummary {
                                    Text("이전: \(p)").font(.caption).foregroundStyle(.secondary).strikethrough()
                                }
                                Text("\(r.by.isEmpty ? "익명" : r.by) · \(fmtTime(r.ts))")
                                    .font(.caption2).foregroundStyle(.secondary)
                            }
                        }.padding(.vertical, 2)
                    }
                }
            }
            .navigationTitle("정산 변경 이력")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("닫기") { dismiss() } } }
            .task { await load() }
        }
    }

    private func load() async {
        rows = (try? await FirestoreREST.getSettleLog(tripId)) ?? []
        loading = false
    }
    private func actionLabel(_ a: String) -> String { ["add": "추가", "edit": "수정", "delete": "삭제"][a] ?? "변경" }
    private func actionColor(_ a: String) -> Color { ["add": Color.teal, "edit": Color.orange, "delete": Color.red][a] ?? .gray }
    private func fmtTime(_ d: Date?) -> String {
        guard let d else { return "방금" }
        let f = DateFormatter(); f.locale = Locale(identifier: "ko_KR")
        f.dateFormat = Calendar.current.isDate(d, equalTo: Date(), toGranularity: .year) ? "M. d. HH:mm" : "yyyy. M. d. HH:mm"
        return f.string(from: d)
    }
}
