import SwiftUI

struct HomeView: View {
    @EnvironmentObject var store: Store
    @State private var linkInput = ""
    @State private var path: [String] = []   // trip ids
    @State private var showNew = false
    @FocusState private var linkFocused: Bool

    var body: some View {
        NavigationStack(path: $path) {
            List {
                Section {
                    HStack {
                        TextField("여행 링크 또는 ID 붙여넣기", text: $linkInput)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .keyboardType(.URL)
                            .focused($linkFocused)
                            .submitLabel(.go)
                            .onSubmit(openLink)
                        Button("열기", action: openLink)
                            .buttonStyle(.borderedProminent)
                            .disabled(Store.tripID(from: linkInput) == nil)
                    }
                } header: {
                    Text("여행 열기")
                } footer: {
                    Text("howard-trips.web.app/t/… 링크를 붙여넣으면 그 여행을 엽니다.")
                }

                if store.recents.isEmpty {
                    Section("최근 여행") {
                        Text("아직 연 여행이 없어요.")
                            .foregroundStyle(.secondary)
                    }
                } else {
                    Section("최근 여행") {
                        ForEach(store.recents) { r in
                            NavigationLink(value: r.id) {
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(r.title).font(.body.weight(.semibold))
                                    Text(subtitle(r)).font(.caption).foregroundStyle(.secondary)
                                }
                            }
                        }
                        .onDelete { idx in
                            idx.map { store.recents[$0].id }.forEach(store.forget)
                        }
                    }
                }
            }
            .navigationTitle("하워드 트립")
            .navigationDestination(for: String.self) { id in
                TripView(tripId: id)
            }
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { showNew = true } label: {
                        Label("새 여행", systemImage: "plus")
                    }
                }
            }
            .sheet(isPresented: $showNew) {
                NewTripSheet { trip in
                    store.remember(trip)
                    path.append(trip.id)
                }
            }
        }
    }

    private func openLink() {
        guard let id = Store.tripID(from: linkInput) else { return }
        linkInput = ""
        linkFocused = false
        path.append(id)
    }

    private func subtitle(_ r: RecentTrip) -> String {
        var parts: [String] = []
        if let s = r.startDate { parts.append(s) }
        if let d = r.dayCount { parts.append("\(d)일") }
        return parts.joined(separator: " · ")
    }
}
