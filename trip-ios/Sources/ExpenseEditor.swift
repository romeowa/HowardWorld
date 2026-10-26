import SwiftUI

// 지출/수입(입금) 추가·수정 시트. 웹 openExpenseForm 이식.
struct ExpenseEditor: View {
    let trip: Trip
    let tripId: String
    let items: [Item]
    let existing: Expense?
    let onDone: () async -> Void

    @Environment(\.dismiss) private var dismiss

    @State private var kind: String
    @State private var amountText: String
    @State private var currency: String
    @State private var desc: String
    @State private var category: String
    @State private var dayIdx: Int?          // nil = 여행 외
    @State private var offDate: Date
    @State private var place: String
    @State private var payer: String         // 이름 또는 POOL
    @State private var sharedBy: Set<String>
    @State private var contribs: [String: Double]
    @State private var recorder: String
    @State private var saving = false
    @State private var showDeleteConfirm = false

    init(trip: Trip, tripId: String, items: [Item], existing: Expense?, initialKind: String, onDone: @escaping () async -> Void) {
        self.trip = trip; self.tripId = tripId; self.items = items; self.existing = existing; self.onDone = onDone
        let e = existing
        let k = e.map { $0.isIncome ? "income" : "expense" } ?? initialKind
        _kind = State(initialValue: k)
        _amountText = State(initialValue: e.map { $0.amount > 0 ? String(trimDec($0.amount)) : "" } ?? "")
        _currency = State(initialValue: e?.currency.isEmpty == false ? e!.currency : "KRW")
        _desc = State(initialValue: e?.desc ?? "")
        let cats = tripCats(trip)
        _category = State(initialValue: e?.category.isEmpty == false ? e!.category : cats[0])
        let di: Int? = e.map { $0.offTrip ? nil : ($0.day ?? expDayIndex(trip, $0)) } ?? defaultDayIdx(trip)
        _dayIdx = State(initialValue: di)
        if let ds = e?.date, let d = ymdToDate(ds) { _offDate = State(initialValue: d) } else { _offDate = State(initialValue: Date()) }
        _place = State(initialValue: e?.place ?? "")
        _payer = State(initialValue: e.map { $0.fromPool ? POOL : ($0.payer.isEmpty ? (trip.members.first ?? "") : $0.payer) } ?? (trip.members.first ?? ""))
        _sharedBy = State(initialValue: Set(e?.sharedBy ?? trip.members))
        _contribs = State(initialValue: (e?.isIncome == true) ? incomeContribs(e!) : [:])
        _recorder = State(initialValue: settleWho(tripId))
    }

    private var isIncome: Bool { kind == "income" }
    private var editMembers: [String] {
        var seen = Set<String>(); var out = [String]()
        for n in trip.members + (existing?.sharedBy ?? []) + [existing?.payer ?? ""] where !n.isEmpty && !seen.contains(n) {
            seen.insert(n); out.append(n)
        }
        return out
    }
    private var amountKRW: Double {
        (Double(amountText.replacingOccurrences(of: ",", with: "")) ?? 0) * fxRate(trip, currency)
    }
    private var contribKRW: Double {
        trip.members.reduce(0.0) { $0 + (contribs[$1] ?? 0) } * fxRate(trip, currency)
    }

    var body: some View {
        NavigationStack {
            Form {
                Picker("", selection: $kind) {
                    Text("지출").tag("expense"); Text("수입·입금").tag("income")
                }.pickerStyle(.segmented).listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))

                daySection
                if isIncome { contribSection } else { amountSection }
                descCatSection
                if !isIncome { payerSection; sharedSection }
                recorderSection
                if existing != nil {
                    Section {
                        Button(role: .destructive) { showDeleteConfirm = true } label: {
                            Label(isIncome ? "입금 삭제" : "지출 삭제", systemImage: "trash")
                        }
                    }
                }
            }
            .navigationTitle(titleText)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("취소") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(saveLabel) { Task { await save() } }.disabled(saving || !canSave)
                }
            }
            .disabled(saving)
            .confirmationDialog(isIncome ? "이 입금 내역을 삭제할까요?" : "이 지출을 삭제할까요?",
                                isPresented: $showDeleteConfirm, titleVisibility: .visible) {
                Button("삭제", role: .destructive) { Task { await deleteExp() } }
                Button("취소", role: .cancel) {}
            }
        }
    }

    private var titleText: String {
        existing != nil ? (isIncome ? "수입 수정" : "지출 수정") : (isIncome ? "수입·입금 추가" : "지출 추가")
    }
    private var saveLabel: String {
        if isIncome { return contribKRW > 0 ? "+\(won(contribKRW))원" : (existing != nil ? "저장" : "입금") }
        return amountKRW > 0 ? "\(won(amountKRW))원" : (existing != nil ? "저장" : "추가")
    }
    private var canSave: Bool {
        if isIncome { return trip.members.reduce(0.0) { $0 + (contribs[$1] ?? 0) } > 0 }
        let amt = Double(amountText.replacingOccurrences(of: ",", with: "")) ?? 0
        return amt > 0 && !sharedBy.isEmpty && !payer.isEmpty
    }

    // MARK: - Sections
    private var daySection: some View {
        Section("언제, 어디서?") {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(0..<trip.dayCount, id: \.self) { i in
                        dayCard(top: "Day \(i + 1)", sub: daySub(trip, i), on: dayIdx == i) {
                            dayIdx = i; if !stopsForDay(i).contains(place) { place = "" }
                        }
                    }
                    dayCard(top: "여행 외", sub: "직접 입력", on: dayIdx == nil) { dayIdx = nil; place = "" }
                }.padding(.vertical, 2)
            }
            if dayIdx == nil {
                DatePicker("결제일", selection: $offDate, displayedComponents: .date)
                    .environment(\.locale, Locale(identifier: "ko_KR"))
            } else {
                let stops = stopsForDay(dayIdx!)
                if !stops.isEmpty {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) {
                            ForEach(stops, id: \.self) { s in
                                chip(s, on: place == s) { place = (place == s) ? "" : s }
                            }
                        }.padding(.vertical, 2)
                    }
                }
            }
        }
    }

    private var amountSection: some View {
        Section {
            HStack {
                TextField("0", text: $amountText).keyboardType(.decimalPad)
                Picker("", selection: $currency) {
                    ForEach(Currency.order, id: \.self) { c in Text(Currency.info(c).sym + " " + Currency.info(c).label).tag(c) }
                }.labelsHidden()
            }
            if currency != "KRW" {
                HStack(spacing: 4) {
                    Text("≈ \(won(amountKRW))원").font(.subheadline.weight(.semibold))
                    Text(hasRate(trip, currency)
                         ? "(1\(Currency.info(currency).sym) = \(fmtRate(trip, currency))원)"
                         : "임시 환율 · 정산표에서 고정하세요")
                        .font(.caption).foregroundStyle(hasRate(trip, currency) ? Color.secondary : Color.orange)
                }
            }
            let n = sharedBy.count
            Text("\(n)명 · 1인 \(n > 0 ? won(amountKRW / Double(n)) : "0")원")
                .font(.caption).foregroundStyle(.secondary)
        }
    }

    private var contribSection: some View {
        Section {
            HStack {
                Text("각자 넣은 금액").font(.subheadline.weight(.semibold))
                Spacer()
                Button("전원 같게") {
                    if let first = trip.members.compactMap({ contribs[$0] }).first(where: { $0 > 0 }) {
                        for m in trip.members { contribs[m] = first }
                    }
                }.font(.caption)
                Picker("", selection: $currency) {
                    ForEach(Currency.order, id: \.self) { c in Text(Currency.info(c).sym).tag(c) }
                }.labelsHidden()
            }
            ForEach(trip.members, id: \.self) { m in
                HStack {
                    avatar(m)
                    Text(m)
                    Spacer()
                    TextField("0", text: Binding(
                        get: { contribs[m].map { trimDec($0) } ?? "" },
                        set: { v in let d = Double(v.replacingOccurrences(of: ",", with: "")) ?? 0; if d > 0 { contribs[m] = d } else { contribs[m] = nil } }
                    )).keyboardType(.decimalPad).multilineTextAlignment(.trailing).frame(width: 110)
                    Text(Currency.info(currency).sym).foregroundStyle(.secondary)
                }
            }
            Text(contribKRW > 0
                 ? "합계 ≈ \(won(contribKRW))원 · 공동 1인 \(won(contribKRW / Double(max(trip.members.count, 1))))원씩"
                 : "각자 넣은 금액을 입력하세요 · 공동 비용으로 똑같이 나뉘어요")
                .font(.caption).foregroundStyle(.secondary)
        }
    }

    private var descCatSection: some View {
        Section(isIncome ? "메모 (선택)" : "구분") {
            if !isIncome {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(tripCats(trip), id: \.self) { c in
                            chip(c, on: category == c, color: Color(hex: catColor(c))) { category = c }
                        }
                    }.padding(.vertical, 2)
                }
            }
            TextField(isIncome ? "무엇에 대한 입금인가요?" : "무엇에 썼나요? (예: 저녁 한정식)", text: $desc)
        }
    }

    private var payerSection: some View {
        Section("결제한 사람") {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    payerChip(name: POOL, label: "공금", on: payer == POOL)
                    ForEach(editMembers, id: \.self) { m in payerChip(name: m, label: m, on: payer == m) }
                }.padding(.vertical, 2)
            }
        }
    }

    private var sharedSection: some View {
        Section {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(editMembers, id: \.self) { m in
                        let on = sharedBy.contains(m)
                        Button {
                            if on { sharedBy.remove(m) } else { sharedBy.insert(m) }
                        } label: {
                            HStack(spacing: 6) {
                                Text(initOf(m)).font(.caption.weight(.bold))
                                Text(m).font(.subheadline)
                            }
                            .padding(.horizontal, 10).padding(.vertical, 7)
                            .background(on ? Color(hex: memberColor(trip, m)) : Color(.secondarySystemBackground))
                            .foregroundStyle(on ? .white : .primary)
                            .clipShape(Capsule())
                        }.buttonStyle(.plain)
                    }
                }.padding(.vertical, 2)
            }
        } header: {
            HStack {
                Text("나눠 낼 사람")
                Spacer()
                Button(sharedBy.count == editMembers.count ? "전체 해제" : "전체") {
                    sharedBy = sharedBy.count == editMembers.count ? [] : Set(editMembers)
                }.font(.caption)
            }
        }
    }

    private var recorderSection: some View {
        Section {
            Picker("기록자", selection: $recorder) {
                Text("익명").tag("")
                ForEach(trip.members, id: \.self) { m in Text(m).tag(m) }
            }
            .onChange(of: recorder) { _, v in setSettleWho(tripId, v) }
        } footer: {
            Text("변경 이력에 남는 이름이에요.")
        }
    }

    // MARK: - Small views
    private func dayCard(top: String, sub: String, on: Bool, tap: @escaping () -> Void) -> some View {
        Button(action: tap) {
            VStack(spacing: 2) {
                Text(top).font(.subheadline.weight(.semibold))
                Text(sub).font(.caption2)
            }
            .frame(minWidth: 72).padding(.vertical, 8).padding(.horizontal, 6)
            .background(on ? Color.teal : Color(.secondarySystemBackground))
            .foregroundStyle(on ? .white : .primary)
            .clipShape(RoundedRectangle(cornerRadius: 10))
        }.buttonStyle(.plain)
    }
    private func chip(_ text: String, on: Bool, color: Color = .teal, tap: @escaping () -> Void) -> some View {
        Button(action: tap) {
            Text(text).font(.subheadline)
                .padding(.horizontal, 12).padding(.vertical, 7)
                .background(on ? color : Color(.secondarySystemBackground))
                .foregroundStyle(on ? .white : .primary)
                .clipShape(Capsule())
        }.buttonStyle(.plain)
    }
    private func payerChip(name: String, label: String, on: Bool) -> some View {
        Button { payer = name } label: {
            HStack(spacing: 6) {
                if name == POOL { Text("💰") } else { avatar(name) }
                Text(label).font(.subheadline)
            }
            .padding(.horizontal, 10).padding(.vertical, 7)
            .background(on ? Color.teal : Color(.secondarySystemBackground))
            .foregroundStyle(on ? .white : .primary)
            .clipShape(Capsule())
        }.buttonStyle(.plain)
    }
    private func avatar(_ m: String) -> some View {
        Text(initOf(m)).font(.caption2.weight(.bold)).foregroundStyle(.white)
            .frame(width: 22, height: 22).background(Color(hex: memberColor(trip, m))).clipShape(Circle())
    }

    // MARK: - Save / Delete
    private func buildExpense() -> Expense {
        let off = dayIdx == nil
        let dateStr: String = off ? NewTripSheet.ymd(offDate) : dateForDay(trip, dayIdx ?? 0)
        if isIncome {
            var cs = [String: Double](); var sum = 0.0
            for m in trip.members { let v = contribs[m] ?? 0; if v > 0 { cs[m] = v; sum += v } }
            return Expense(id: existing?.id ?? "", kind: "income", amount: sum, currency: currency, desc: desc.trimmingCharacters(in: .whitespaces),
                           category: "", day: off ? nil : dayIdx, offTrip: off, date: dateStr, place: "",
                           payer: "", fromPool: false, sharedBy: trip.members, contribs: cs, order: existing?.order)
        } else {
            let amt = Double(amountText.replacingOccurrences(of: ",", with: "")) ?? 0
            let fromPool = payer == POOL
            return Expense(id: existing?.id ?? "", kind: "expense", amount: amt, currency: currency, desc: desc.trimmingCharacters(in: .whitespaces),
                           category: category.isEmpty ? "기타" : category, day: off ? nil : dayIdx, offTrip: off, date: dateStr,
                           place: off ? "" : place, payer: fromPool ? "" : payer, fromPool: fromPool,
                           sharedBy: editMembers.filter { sharedBy.contains($0) }, contribs: [:], order: existing?.order)
        }
    }

    private func save() async {
        saving = true
        let data = buildExpense()
        do {
            if let ex = existing {
                try await FirestoreREST.updateExpense(tripId: tripId, data)
                try? await FirestoreREST.addSettleLog(tripId: tripId, action: "edit", kind: data.kind,
                    summary: settleSummary(data), prevSummary: settleSummary(ex), by: recorder, dev: deviceId())
            } else {
                try await FirestoreREST.addExpense(tripId: tripId, data)
                try? await FirestoreREST.addSettleLog(tripId: tripId, action: "add", kind: data.kind,
                    summary: settleSummary(data), prevSummary: nil, by: recorder, dev: deviceId())
            }
            await onDone()
            dismiss()
        } catch { saving = false }
    }

    private func deleteExp() async {
        guard let ex = existing else { return }
        saving = true
        do {
            try await FirestoreREST.deleteExpense(tripId: tripId, expenseId: ex.id)
            try? await FirestoreREST.addSettleLog(tripId: tripId, action: "delete", kind: ex.kind,
                summary: settleSummary(ex), prevSummary: nil, by: recorder, dev: deviceId())
            await onDone()
            dismiss()
        } catch { saving = false }
    }

    private func stopsForDay(_ day: Int) -> [String] {
        items.filter { $0.day == day && !($0.name.isEmpty && $0.address.isEmpty) }
            .map { $0.name.isEmpty ? $0.address : $0.name }
    }
}

// Day N 부제: "M/d (요일)" 또는 ""
func daySub(_ trip: Trip?, _ i: Int) -> String {
    guard let s = trip?.startDate, let base = ymdToDate(s) else { return "" }
    let d = Calendar.current.date(byAdding: .day, value: i, to: base) ?? base
    let f = DateFormatter(); f.locale = Locale(identifier: "ko_KR"); f.dateFormat = "M/d (E)"
    return f.string(from: d)
}
// 오늘이 여행 기간 안이면 그 Day, 아니면 0
func defaultDayIdx(_ trip: Trip?) -> Int {
    guard let s = trip?.startDate, let base = ymdToDate(s) else { return 0 }
    let today = Calendar.current.startOfDay(for: Date())
    let diff = Calendar.current.dateComponents([.day], from: Calendar.current.startOfDay(for: base), to: today).day ?? -1
    return (diff >= 0 && diff < (trip?.dayCount ?? 1)) ? diff : 0
}
// Double → 소수 불필요하면 정수 문자열
func trimDec(_ d: Double) -> String {
    if d == d.rounded() { return String(Int(d)) }
    return String(d)
}
