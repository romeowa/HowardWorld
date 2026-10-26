import SwiftUI

struct ExpEditTarget: Identifiable { let id = UUID(); var expense: Expense?; var kind: String }

// 정산 탭. 웹 정산표를 네이티브로 — 참여자/요약/공금/환율/송금/정산표/내역.
struct SettleView: View {
    let trip: Trip
    let tripId: String
    let items: [Item]
    let expenses: [Expense]
    let reload: () async -> Void

    @State private var newMember = ""
    @State private var editTarget: ExpEditTarget?
    @State private var showHistory = false
    @State private var removeTarget: String?
    @State private var noMemberAlert = false
    @State private var rateText: [String: String] = [:]
    @State private var recorder: String = ""

    private var result: SettleResult { computeSettlement(trip, expenses) }
    private var expList: [Expense] { expenses.filter { !$0.isIncome } }
    private var incList: [Expense] { expenses.filter { $0.isIncome } }
    private var expenseTotal: Double { expList.reduce(0) { $0 + toKRW(trip, $1) } }
    private var incomeTotal: Double { incList.reduce(0) { $0 + toKRW(trip, $1) } }

    var body: some View {
        ScrollView {
            VStack(spacing: 14) {
                membersCard
                addButtons
                recorderRow
                if result.names.isEmpty && expenses.isEmpty {
                    emptyHint
                } else {
                    summaryCard
                    if result.poolUsed { poolCard }
                    if !usedForeign(expenses).isEmpty { ratesCard }
                    transfersCard
                    if !result.names.isEmpty { tallyCard }
                    expenseListCard
                    if !incList.isEmpty { incomeListCard }
                }
            }
            .padding(14)
        }
        .background(Color(.systemGroupedBackground))
        .onAppear { recorder = settleWho(tripId) }
        .sheet(item: $editTarget) { t in
            ExpenseEditor(trip: trip, tripId: tripId, items: items, existing: t.expense, initialKind: t.kind, onDone: reload)
        }
        .sheet(isPresented: $showHistory) { SettleHistoryView(tripId: tripId) }
        .confirmationDialog("'\(removeTarget ?? "")'님을 참여자에서 뺄까요?", isPresented: Binding(get: { removeTarget != nil }, set: { if !$0 { removeTarget = nil } }), titleVisibility: .visible) {
            Button("빼기", role: .destructive) { if let m = removeTarget { removeMember(m) }; removeTarget = nil }
            Button("취소", role: .cancel) { removeTarget = nil }
        } message: {
            Text("기존 정산 내역에는 이름이 남아요.")
        }
        .alert("먼저 참여자를 추가해 주세요", isPresented: $noMemberAlert) { Button("확인", role: .cancel) {} }
    }

    // MARK: - 참여자
    private var membersCard: some View {
        card {
            HStack {
                Text("참여자").font(.subheadline.weight(.semibold))
                Spacer()
                Text("\(trip.members.count)명").font(.caption).foregroundStyle(.secondary)
            }
            if trip.members.isEmpty {
                Text("함께 정산할 사람을 추가하세요").font(.caption).foregroundStyle(.secondary)
            } else {
                FlowChips(trip.members) { m in
                    HStack(spacing: 6) {
                        avatar(m)
                        Text(m).font(.subheadline)
                        Button { removeTarget = m } label: { Image(systemName: "xmark.circle.fill").font(.caption) }
                            .buttonStyle(.plain).foregroundStyle(.secondary)
                    }
                    .padding(.horizontal, 10).padding(.vertical, 6)
                    .background(Color(.tertiarySystemBackground)).clipShape(Capsule())
                }
            }
            HStack {
                TextField("참여자 이름 추가", text: $newMember)
                    .textFieldStyle(.roundedBorder)
                    .onSubmit(addMemberAction)
                Button("추가", action: addMemberAction)
                    .buttonStyle(.borderedProminent)
                    .disabled(newMember.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
    }

    private var addButtons: some View {
        HStack(spacing: 10) {
            Button { if trip.members.isEmpty { noMemberAlert = true } else { editTarget = ExpEditTarget(expense: nil, kind: "expense") } } label: {
                Label("지출 추가", systemImage: "plus").frame(maxWidth: .infinity)
            }.buttonStyle(.borderedProminent)
            Button { if trip.members.isEmpty { noMemberAlert = true } else { editTarget = ExpEditTarget(expense: nil, kind: "income") } } label: {
                Label("수입·입금", systemImage: "plus").frame(maxWidth: .infinity)
            }.buttonStyle(.bordered)
        }
    }

    private var recorderRow: some View {
        HStack {
            Picker("기록자", selection: $recorder) {
                Text("익명").tag("")
                ForEach(trip.members, id: \.self) { m in Text(m).tag(m) }
            }
            .onChange(of: recorder) { _, v in setSettleWho(tripId, v) }
            Spacer()
            Button { showHistory = true } label: { Label("변경 이력", systemImage: "clock.arrow.circlepath").font(.caption) }
        }
        .padding(.horizontal, 4)
    }

    private var emptyHint: some View {
        card {
            Text("정산 시작하기").font(.subheadline.weight(.semibold))
            Text("① 참여자를 추가하고 ② ‘지출 추가’로 쓴 돈을 기록하면, 누가 누구에게 얼마를 보내면 되는지 자동으로 계산돼요.")
                .font(.caption).foregroundStyle(.secondary)
        }
    }

    // MARK: - 요약
    private var summaryCard: some View {
        let byCat = Dictionary(grouping: expList, by: { $0.category.isEmpty ? "기타" : $0.category })
            .mapValues { $0.reduce(0) { $0 + toKRW(trip, $1) } }
        let catArr = byCat.sorted { $0.value > $1.value }
        let total = expenseTotal
        let avg = trip.members.isEmpty ? (result.names.isEmpty ? 0 : total / Double(result.names.count)) : total / Double(trip.members.count)
        return card {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("총 지출").font(.caption).foregroundStyle(.secondary)
                    Text("\(won(total))원").font(.title2.weight(.bold))
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 2) {
                    Text("1인 평균").font(.caption).foregroundStyle(.secondary)
                    Text("\(won(avg))원").font(.headline)
                }
            }
            if total > 0 {
                GeometryReader { geo in
                    HStack(spacing: 0) {
                        ForEach(catArr, id: \.key) { k, v in
                            Rectangle().fill(Color(hex: catColor(k))).frame(width: geo.size.width * v / total)
                        }
                    }
                }.frame(height: 10).clipShape(Capsule())
                FlowChips(catArr.map { $0.key }) { c in
                    HStack(spacing: 4) {
                        Circle().fill(Color(hex: catColor(c))).frame(width: 8, height: 8)
                        Text(c).font(.caption)
                        Text(won(byCat[c] ?? 0)).font(.caption).foregroundStyle(.secondary)
                    }
                }
            } else {
                Text("아직 지출이 없어요").font(.caption).foregroundStyle(.secondary)
            }
            if !incList.isEmpty {
                HStack {
                    Text("💰 수입·입금 \(incList.count)건").font(.caption)
                    Spacer()
                    Text("+\(won(incomeTotal))원").font(.caption.weight(.semibold)).foregroundStyle(.teal)
                }
            }
        }
    }

    // MARK: - 공금
    private var poolCard: some View {
        let bal = result.poolBalance
        let note = bal > 0 ? "남은 공금은 아래에서 각자 받아가요" : bal < 0 ? "공금이 부족해요 · 아래에서 각자 채워요" : "공금을 딱 맞게 썼어요"
        return card {
            Text("💰 공금").font(.subheadline.weight(.semibold))
            poolRow("입금", "\(won(result.poolIn))원", .primary)
            poolRow("공금 결제", "−\(won(result.poolSpent))원", .primary)
            Divider()
            poolRow("잔액", "\(bal < 0 ? "−" : "")\(won(abs(bal)))원", bal > 0 ? .teal : bal < 0 ? .red : .secondary)
            Text(note).font(.caption).foregroundStyle(.secondary)
        }
    }
    private func poolRow(_ l: String, _ v: String, _ c: Color) -> some View {
        HStack { Text(l).font(.subheadline); Spacer(); Text(v).font(.subheadline.weight(.semibold)).foregroundStyle(c) }
    }

    // MARK: - 환율
    private var ratesCard: some View {
        card {
            HStack(spacing: 6) {
                Text("환율").font(.subheadline.weight(.semibold))
                Text("원화 기준 · 외화는 이 환율로 환산돼요").font(.caption2).foregroundStyle(.secondary)
            }
            ForEach(usedForeign(expenses), id: \.self) { cur in
                rateRow(cur)
            }
        }
    }

    @ViewBuilder
    private func rateRow(_ cur: String) -> some View {
        let c = Currency.info(cur)
        let isSet = (trip.rates[cur] ?? 0) > 0
        let cnt = expenses.filter { ($0.currency.isEmpty ? "KRW" : $0.currency) == cur }.count
        HStack(spacing: 8) {
            Text("1\(c.sym)").font(.subheadline.weight(.bold))
            Text(c.unit).font(.caption).foregroundStyle(.secondary)
            Text("=")
            TextField(fmtRate(trip, cur), text: Binding(
                get: { rateText[cur] ?? fmtRate(trip, cur) },
                set: { rateText[cur] = $0 }
            ))
            .keyboardType(.decimalPad).multilineTextAlignment(.trailing)
            .frame(width: 80).textFieldStyle(.roundedBorder)
            .onSubmit { saveRate(cur) }
            Text("원").font(.caption)
            Button("고정") { saveRate(cur) }.font(.caption).buttonStyle(.bordered)
            Spacer()
            Text(isSet ? "\(cnt)건 적용" : "기본값").font(.caption2).foregroundStyle(isSet ? Color.secondary : Color.orange)
        }
    }

    // MARK: - 송금 제안
    private var transfersCard: some View {
        card {
            Text("이렇게 보내면 끝").font(.subheadline.weight(.semibold))
            if result.transfers.isEmpty {
                Text(expenses.isEmpty ? "지출을 추가하면 정산 결과가 여기 표시돼요." : "모두 정산됐어요.")
                    .font(.caption).foregroundStyle(.secondary)
            } else {
                ForEach(result.transfers) { t in
                    HStack(spacing: 8) {
                        party(t.from)
                        Image(systemName: "arrow.right").font(.caption).foregroundStyle(.secondary)
                        party(t.to)
                        Spacer()
                        Text("\(won(t.amount))원").font(.subheadline.weight(.semibold))
                    }
                }
            }
        }
    }
    private func party(_ name: String) -> some View {
        HStack(spacing: 5) {
            if name == POOL { Text("💰") } else { avatar(name) }
            Text(name == POOL ? "공금" : name).font(.subheadline)
        }
    }

    // MARK: - 정산표
    private var tallyCard: some View {
        card {
            Text("정산표").font(.subheadline.weight(.semibold))
            HStack {
                Text("이름").frame(maxWidth: .infinity, alignment: .leading)
                Text("쓴 돈").frame(width: 70, alignment: .trailing)
                Text("낸 돈").frame(width: 70, alignment: .trailing)
                Text("차액").frame(width: 70, alignment: .trailing)
            }.font(.caption2).foregroundStyle(.secondary)
            ForEach(result.names, id: \.self) { n in
                let net = result.net[n] ?? 0
                HStack {
                    HStack(spacing: 6) { avatar(n); Text(n).font(.subheadline) }.frame(maxWidth: .infinity, alignment: .leading)
                    Text(won(result.share[n] ?? 0)).font(.caption).frame(width: 70, alignment: .trailing)
                    Text(won(result.paid[n] ?? 0)).font(.caption).frame(width: 70, alignment: .trailing)
                    Text(net > 0 ? "+\(won(net))" : net < 0 ? "\(won(net))" : "0")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(net > 0 ? .teal : net < 0 ? .red : .secondary)
                        .frame(width: 70, alignment: .trailing)
                }
            }
        }
    }

    // MARK: - 지출 내역
    private var expenseListCard: some View {
        let groups = groupedExpenses()
        return card {
            Text("지출 내역").font(.subheadline.weight(.semibold))
            if expList.isEmpty {
                Text("아직 지출이 없어요").font(.caption).foregroundStyle(.secondary)
            } else {
                ForEach(groups, id: \.0) { (key, list) in
                    Text(groupLabel(key)).font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                        .padding(.top, 4)
                    ForEach(list) { e in expenseRow(e) }
                }
            }
        }
    }
    private func expenseRow(_ e: Expense) -> some View {
        Button { editTarget = ExpEditTarget(expense: e, kind: e.kind) } label: {
            HStack(spacing: 10) {
                Circle().fill(Color(hex: catColor(e.category.isEmpty ? "기타" : e.category))).frame(width: 9, height: 9)
                VStack(alignment: .leading, spacing: 2) {
                    Text(e.desc.isEmpty ? (e.category.isEmpty ? "지출" : e.category) : e.desc).font(.subheadline.weight(.medium))
                    Text((e.fromPool ? "공금 결제" : (e.payer.isEmpty ? "" : "\(e.payer) 결제")) + " · \(e.sharedBy.count)명 나눔" + (e.place.isEmpty ? "" : " · \(e.place)"))
                        .font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                }
                Spacer(minLength: 4)
                VStack(alignment: .trailing, spacing: 2) {
                    Text("\(won(toKRW(trip, e)))원").font(.subheadline.weight(.semibold))
                    if (e.currency.isEmpty ? "KRW" : e.currency) != "KRW" {
                        Text(fmtCur(e.amount, e.currency)).font(.caption2).foregroundStyle(.secondary)
                    }
                }
            }.contentShape(Rectangle())
        }.buttonStyle(.plain)
    }

    // MARK: - 수입 내역
    private var incomeListCard: some View {
        card {
            Text("수입 · 입금 내역").font(.subheadline.weight(.semibold))
            Text("넣은 돈은 공동 비용으로 똑같이 나뉘어 정산돼요").font(.caption2).foregroundStyle(.secondary)
            ForEach(incList) { e in
                Button { editTarget = ExpEditTarget(expense: e, kind: e.kind) } label: {
                    HStack(spacing: 10) {
                        Text("💰")
                        VStack(alignment: .leading, spacing: 2) {
                            Text(e.desc.isEmpty ? "입금" : e.desc).font(.subheadline.weight(.medium))
                            Text(incomeContribs(e).keys.sorted().joined(separator: ", ")).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                        }
                        Spacer(minLength: 4)
                        Text("+\(won(toKRW(trip, e)))원").font(.subheadline.weight(.semibold)).foregroundStyle(.teal)
                    }.contentShape(Rectangle())
                }.buttonStyle(.plain)
            }
        }
    }

    // MARK: - helpers
    private func groupedExpenses() -> [(Int?, [Expense])] {
        let grouped = Dictionary(grouping: expList, by: { expDayIndex(trip, $0) })
        return grouped.sorted { a, b in (a.key ?? Int.max) < (b.key ?? Int.max) }.map { ($0.key, $0.value) }
    }
    private func groupLabel(_ k: Int?) -> String {
        guard let k else { return "여행 외" }
        return dayTitle(trip, k)
    }
    private func avatar(_ m: String) -> some View {
        Text(initOf(m)).font(.caption2.weight(.bold)).foregroundStyle(.white)
            .frame(width: 22, height: 22).background(Color(hex: memberColor(trip, m))).clipShape(Circle())
    }
    private func card<C: View>(@ViewBuilder _ content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 10) { content() }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(14)
            .background(Color(.secondarySystemGroupedBackground))
            .clipShape(RoundedRectangle(cornerRadius: 14))
    }

    // MARK: - mutations
    private func addMemberAction() {
        let name = newMember.trimmingCharacters(in: .whitespaces)
        guard !name.isEmpty else { return }
        newMember = ""
        if trip.members.contains(name) { return }
        var colors = trip.memberColors
        if colors[name] == nil {
            let used = Set(trip.members.map { memberColor(trip, $0) })
            let free = MEMBER_COLORS.filter { !used.contains($0) }
            colors[name] = free.first ?? MEMBER_COLORS.randomElement() ?? "#0f766e"
        }
        let members = trip.members + [name]
        Task { try? await FirestoreREST.updateMembers(tripId: tripId, members: members, memberColors: colors); await reload() }
    }
    private func removeMember(_ name: String) {
        let members = trip.members.filter { $0 != name }
        Task { try? await FirestoreREST.updateMembers(tripId: tripId, members: members, memberColors: trip.memberColors); await reload() }
    }
    private func saveRate(_ cur: String) {
        guard let v = Double((rateText[cur] ?? "").replacingOccurrences(of: ",", with: "")), v > 0 else { return }
        Task { try? await FirestoreREST.updateRate(tripId: tripId, currency: cur, rate: v); await reload() }
    }
}

// 간단한 가로 흐름 칩 레이아웃 (iOS 16+ Layout 대신 수동 래핑)
struct FlowChips<Content: View>: View {
    let items: [String]
    let content: (String) -> Content
    init(_ items: [String], @ViewBuilder content: @escaping (String) -> Content) {
        self.items = items; self.content = content
    }
    var body: some View {
        FlowLayout(spacing: 8) {
            ForEach(items, id: \.self) { content($0) }
        }
    }
}

// 아주 단순한 flow layout (좌→우 래핑)
struct FlowLayout: Layout {
    var spacing: CGFloat = 8
    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let maxW = proposal.width ?? .infinity
        var x: CGFloat = 0, y: CGFloat = 0, rowH: CGFloat = 0
        for s in subviews {
            let sz = s.sizeThatFits(.unspecified)
            if x + sz.width > maxW && x > 0 { x = 0; y += rowH + spacing; rowH = 0 }
            x += sz.width + spacing; rowH = max(rowH, sz.height)
        }
        return CGSize(width: maxW == .infinity ? x : maxW, height: y + rowH)
    }
    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let maxW = bounds.width
        var x: CGFloat = bounds.minX, y: CGFloat = bounds.minY, rowH: CGFloat = 0
        for s in subviews {
            let sz = s.sizeThatFits(.unspecified)
            if x - bounds.minX + sz.width > maxW && x > bounds.minX { x = bounds.minX; y += rowH + spacing; rowH = 0 }
            s.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(sz))
            x += sz.width + spacing; rowH = max(rowH, sz.height)
        }
    }
}
