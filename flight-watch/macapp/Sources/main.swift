// FlightWatch 메뉴바 앱
// - launchd 데몬(com.howard.flight-watch) 상태 표시/시작/중지/재시작
// - Firestore REST(공개 규칙)로 감시 목록/검사 결과 표시 + 감시 추가/수정/삭제
// - "지금 체크" → control/checkNow 문서 갱신 → 데몬이 즉시 검사

import SwiftUI
import AppKit

// MARK: - 셸 (launchd 제어)

enum Shell {
    static let plistPath = NSHomeDirectory() + "/Library/LaunchAgents/com.howard.flight-watch.plist"
    static let logPath = NSHomeDirectory() + "/Library/Logs/flight-watch.log"
    static var uid: String { String(getuid()) }

    @discardableResult
    static func run(_ path: String, _ args: [String]) -> Int32 {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: path)
        p.arguments = args
        p.standardOutput = FileHandle.nullDevice
        p.standardError = FileHandle.nullDevice
        do {
            try p.run()
            p.waitUntilExit()
            return p.terminationStatus
        } catch {
            return -1
        }
    }

    static func daemonRunning() -> Bool {
        run("/usr/bin/pgrep", ["-f", "flight-watch/crawler/index.js"]) == 0
    }
    static func startDaemon() {
        run("/bin/launchctl", ["bootstrap", "gui/\(uid)", plistPath])
    }
    static func stopDaemon() {
        run("/bin/launchctl", ["bootout", "gui/\(uid)/com.howard.flight-watch"])
    }
    static func restartDaemon() {
        if daemonRunning() {
            run("/bin/launchctl", ["kickstart", "-k", "gui/\(uid)/com.howard.flight-watch"])
        } else {
            startDaemon()
        }
    }
}

// MARK: - Firestore REST

enum Firestore {
    static let base = "https://firestore.googleapis.com/v1/projects/howardworld/databases/(default)/documents"

    static func request(_ method: String, _ path: String, body: [String: Any]? = nil) async -> [String: Any]? {
        guard let url = URL(string: "\(base)/\(path)") else { return nil }
        var req = URLRequest(url: url)
        req.httpMethod = method
        if let body {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try? JSONSerialization.data(withJSONObject: body)
        }
        guard let (data, resp) = try? await URLSession.shared.data(for: req),
              let code = (resp as? HTTPURLResponse)?.statusCode, (200..<300).contains(code) else { return nil }
        return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    }

    static func get(_ path: String) async -> [String: Any]? { await request("GET", path) }

    static func requestCheckNow() async -> Bool {
        let iso = ISO8601DateFormatter().string(from: Date())
        let body: [String: Any] = ["fields": ["requestedAt": ["timestampValue": iso]]]
        return await request("PATCH", "control/checkNow?updateMask.fieldPaths=requestedAt", body: body) != nil
    }

    // ---- 값 인코딩 ----
    static func vStr(_ s: String?) -> [String: Any] { s.map { ["stringValue": $0] } ?? ["nullValue": NSNull()] }
    static func vInt(_ n: Int?) -> [String: Any] { n.map { ["integerValue": String($0)] } ?? ["nullValue": NSNull()] }
    static func vDouble(_ n: Double?) -> [String: Any] { n.map { ["doubleValue": $0] } ?? ["nullValue": NSNull()] }
    static func vBool(_ b: Bool) -> [String: Any] { ["booleanValue": b] }
    static func vNow() -> [String: Any] { ["timestampValue": ISO8601DateFormatter().string(from: Date())] }

    // ---- 값 디코딩 ----
    static func fields(_ doc: [String: Any]?) -> [String: Any] {
        (doc?["fields"] as? [String: Any]) ?? [:]
    }
    static func str(_ f: [String: Any], _ key: String) -> String? {
        (f[key] as? [String: Any])?["stringValue"] as? String
    }
    static func num(_ f: [String: Any], _ key: String) -> Double? {
        guard let v = f[key] as? [String: Any] else { return nil }
        if let d = v["doubleValue"] as? Double { return d }
        if let i = v["integerValue"] as? String { return Double(i) }
        return nil
    }
    static func bool(_ f: [String: Any], _ key: String) -> Bool? {
        (f[key] as? [String: Any])?["booleanValue"] as? Bool
    }
    static func ts(_ f: [String: Any], _ key: String) -> Date? {
        guard let s = (f[key] as? [String: Any])?["timestampValue"] as? String else { return nil }
        let fmt = ISO8601DateFormatter()
        fmt.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = fmt.date(from: s) { return d }
        fmt.formatOptions = [.withInternetDateTime]
        return fmt.date(from: s)
    }
    static func map(_ f: [String: Any], _ key: String) -> [String: Any] {
        ((f[key] as? [String: Any])?["mapValue"] as? [String: Any]).flatMap { $0["fields"] as? [String: Any] } ?? [:]
    }
    static func array(_ f: [String: Any], _ key: String) -> [[String: Any]] {
        let values = ((f[key] as? [String: Any])?["arrayValue"] as? [String: Any])?["values"] as? [[String: Any]] ?? []
        return values.compactMap { ($0["mapValue"] as? [String: Any])?["fields"] as? [String: Any] }
    }
}

// MARK: - 모델

func fmtPrice(_ n: Double) -> String {
    let f = NumberFormatter()
    f.numberStyle = .decimal
    f.maximumFractionDigits = 0
    return (f.string(from: NSNumber(value: n)) ?? "\(Int(n))") + "원"
}

struct WatchDetail: Identifiable {
    let id: String
    let origin: String
    let destination: String
    let departureDate: String
    let returnDate: String?
    let adults: Int
    let currency: String
    let maxPrice: Double?
    let maxStops: Int?
    let departAfter: String?
    let departBefore: String?
    let returnAfter: String?
    let returnBefore: String?
    let active: Bool
    let createdAt: Date?
    let lastCheckedAt: Date?
    let lastBestPrice: Double?
    let bestMatchPrice: Double?
    let bestMatchStops: Int?

    var title: String { "\(origin) → \(destination)" }
    var dateLine: String { "\(departureDate)\(returnDate.map { " ~ \($0)" } ?? " 편도")" }
    var condLine: String {
        var parts: [String] = []
        if let p = maxPrice { parts.append("\(fmtPrice(p)) 이하") }
        if let s = maxStops { parts.append(s == 0 ? "직항만" : "경유 \(s)회까지") }
        if departAfter != nil || departBefore != nil { parts.append("출발 \(departAfter ?? "")~\(departBefore ?? "")") }
        if returnAfter != nil || returnBefore != nil { parts.append("귀국 \(returnAfter ?? "")~\(returnBefore ?? "")") }
        return parts.isEmpty ? "조건 없음 (모든 결과 알림)" : parts.joined(separator: " · ")
    }
    var priceLine: String {
        if let p = bestMatchPrice {
            let stopsTxt = bestMatchStops == 0 ? "직항" : bestMatchStops.map { "경유\($0)" } ?? ""
            return "✅ \(fmtPrice(p)) \(stopsTxt)"
        }
        if let p = lastBestPrice { return "충족 없음 · 최저 \(fmtPrice(p))" }
        return "아직 검사 전"
    }
    var matched: Bool { bestMatchPrice != nil }
}

@MainActor
final class Model: ObservableObject {
    @Published var daemonRunning = false
    @Published var lastRunLine = "아직 검사 기록 없음"
    @Published var resultLines: [String] = []
    @Published var watches: [WatchDetail] = []
    @Published var checkRequested = false

    private var timer: Timer?

    func startPolling() {
        refresh()
        timer = Timer.scheduledTimer(withTimeInterval: 15, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.refresh() }
        }
    }

    func refresh() {
        daemonRunning = Shell.daemonRunning()
        Task {
            await loadStatus()
            await loadWatches()
        }
    }


    private static let triggerNames = [
        "startup": "데몬 시작", "schedule": "정기", "manual-web": "수동", "manual-cli": "CLI 수동",
    ]

    func loadStatus() async {
        guard let doc = await Firestore.get("control/status") else { return }
        let f = Firestore.fields(doc)
        if let at = Firestore.ts(f, "lastRunAt") {
            let df = DateFormatter()
            df.locale = Locale(identifier: "ko_KR")
            df.dateFormat = "M월 d일 HH:mm"
            let trigger = Firestore.str(f, "trigger") ?? "?"
            lastRunLine = "마지막 검사 \(df.string(from: at)) · \(Model.triggerNames[trigger] ?? trigger)"
        }
        resultLines = Firestore.array(f, "results").map { r in
            let label = Firestore.str(r, "label") ?? Firestore.str(r, "id") ?? "?"
            let status = Firestore.str(r, "status") ?? "?"
            switch status {
            case "ok":
                let offers = Int(Firestore.num(r, "offers") ?? 0)
                let matches = Int(Firestore.num(r, "matches") ?? 0)
                var line = "\(label) — 검색 \(offers) · 충족 \(matches)"
                if let p = Firestore.num(r, "bestMatchPrice") { line += " · \(fmtPrice(p))" }
                if Firestore.bool(r, "notified") == true { line += " 🔔" }
                return line
            case "expired":
                return "\(label) — 출발일 지나 비활성화됨"
            default:
                return "\(label) — ⚠️ \(Firestore.str(r, "error") ?? status)"
            }
        }
    }

    func loadWatches() async {
        guard let res = await Firestore.get("watches?pageSize=100") else { return }
        let docs = (res["documents"] as? [[String: Any]]) ?? []
        watches = docs.map { doc in
            let f = Firestore.fields(doc)
            let bm = Firestore.map(f, "lastBestMatch")
            return WatchDetail(
                id: (doc["name"] as? String)?.components(separatedBy: "/").last ?? UUID().uuidString,
                origin: Firestore.str(f, "origin") ?? "?",
                destination: Firestore.str(f, "destination") ?? "?",
                departureDate: Firestore.str(f, "departureDate") ?? "?",
                returnDate: Firestore.str(f, "returnDate"),
                adults: Int(Firestore.num(f, "adults") ?? 1),
                currency: Firestore.str(f, "currency") ?? "KRW",
                maxPrice: Firestore.num(f, "maxPrice"),
                maxStops: Firestore.num(f, "maxStops").map { Int($0) },
                departAfter: Firestore.str(f, "departAfter"),
                departBefore: Firestore.str(f, "departBefore"),
                returnAfter: Firestore.str(f, "returnAfter"),
                returnBefore: Firestore.str(f, "returnBefore"),
                active: Firestore.bool(f, "active") ?? false,
                createdAt: Firestore.ts(f, "createdAt"),
                lastCheckedAt: Firestore.ts(f, "lastCheckedAt"),
                lastBestPrice: Firestore.num(f, "lastBestPrice"),
                bestMatchPrice: Firestore.num(bm, "price"),
                bestMatchStops: Firestore.num(bm, "outboundStops").map { Int($0) }
            )
        }
        .sorted {
            if $0.active != $1.active { return $0.active }
            return ($0.createdAt ?? .distantPast) > ($1.createdAt ?? .distantPast)
        }
    }

    func checkNow() {
        Task {
            checkRequested = await Firestore.requestCheckNow()
            try? await Task.sleep(nanoseconds: 8_000_000_000)
            refresh()
            checkRequested = false
        }
    }

    // ---- 감시 쓰기 ----

    func addWatch(
        origin: String, destination: String, departureDate: String, returnDate: String?,
        adults: Int, currency: String, maxPrice: Double?, maxStops: Int?,
        departAfter: String?, departBefore: String?, returnAfter: String?, returnBefore: String?
    ) async -> Bool {
        let fields: [String: Any] = [
            "origin": Firestore.vStr(origin),
            "destination": Firestore.vStr(destination),
            "departureDate": Firestore.vStr(departureDate),
            "returnDate": Firestore.vStr(returnDate),
            "adults": Firestore.vInt(adults),
            "currency": Firestore.vStr(currency),
            "maxPrice": Firestore.vDouble(maxPrice),
            "maxStops": Firestore.vInt(maxStops),
            "departAfter": Firestore.vStr(departAfter),
            "departBefore": Firestore.vStr(departBefore),
            "returnAfter": Firestore.vStr(returnAfter),
            "returnBefore": Firestore.vStr(returnBefore),
            "active": Firestore.vBool(true),
            "createdAt": Firestore.vNow(),
            "lastNotifiedPrice": ["nullValue": NSNull()],
        ]
        let ok = await Firestore.request("POST", "watches", body: ["fields": fields]) != nil
        if ok { await loadWatches() }
        return ok
    }

    func setActive(_ watch: WatchDetail, _ active: Bool) {
        Task {
            let body: [String: Any] = ["fields": ["active": Firestore.vBool(active)]]
            _ = await Firestore.request("PATCH", "watches/\(watch.id)?updateMask.fieldPaths=active", body: body)
            await loadWatches()
        }
    }

    func deleteWatch(_ watch: WatchDetail) {
        Task {
            _ = await Firestore.request("DELETE", "watches/\(watch.id)")
            await loadWatches()
        }
    }
}

// MARK: - 메뉴바 팝오버

struct ContentView: View {
    @EnvironmentObject var model: Model
    @Environment(\.openWindow) private var openWindow

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Circle()
                    .fill(model.daemonRunning ? Color.green : Color.red)
                    .frame(width: 9, height: 9)
                Text(model.daemonRunning ? "데몬 실행 중" : "데몬 중지됨")
                    .font(.system(size: 13, weight: .semibold))
                Spacer()
                Button {
                    model.daemonRunning ? Shell.stopDaemon() : Shell.startDaemon()
                    DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { model.refresh() }
                } label: {
                    Image(systemName: model.daemonRunning ? "stop.fill" : "play.fill")
                }
                .help(model.daemonRunning ? "데몬 중지" : "데몬 시작")
                Button {
                    Shell.restartDaemon()
                    DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { model.refresh() }
                } label: {
                    Image(systemName: "arrow.clockwise")
                }
                .help("데몬 재시작")
            }

            Divider()

            Text(model.lastRunLine)
                .font(.system(size: 11))
                .foregroundColor(.secondary)
            ForEach(model.resultLines, id: \.self) { line in
                Text(line).font(.system(size: 12))
            }

            Divider()

            if model.watches.isEmpty {
                Text("등록된 감시 없음")
                    .font(.system(size: 12))
                    .foregroundColor(.secondary)
            } else {
                ForEach(model.watches) { w in
                    VStack(alignment: .leading, spacing: 2) {
                        HStack {
                            Text(w.title).font(.system(size: 13, weight: .medium))
                            Text(w.dateLine).font(.system(size: 11)).foregroundColor(.secondary)
                            if !w.active {
                                Text("중지됨").font(.system(size: 10)).foregroundColor(.orange)
                            }
                        }
                        Text(w.priceLine)
                            .font(.system(size: 12))
                            .foregroundColor(w.matched ? .green : .secondary)
                    }
                    .opacity(w.active ? 1 : 0.5)
                }
            }

            Divider()

            HStack(spacing: 12) {
                Button {
                    model.checkNow()
                } label: {
                    Label(model.checkRequested ? "요청됨..." : "지금 체크", systemImage: "bolt.fill")
                }
                .disabled(model.checkRequested || !model.daemonRunning)

                Button {
                    openWindow(id: "manage")
                    NSApp.activate(ignoringOtherApps: true)
                } label: {
                    Label("감시 관리", systemImage: "list.bullet.rectangle")
                }

                Button {
                    NSWorkspace.shared.open(URL(fileURLWithPath: Shell.logPath))
                } label: {
                    Label("로그", systemImage: "doc.text")
                }

                Spacer()

                Button {
                    NSApp.terminate(nil)
                } label: {
                    Image(systemName: "power")
                }
                .help("메뉴바 앱 종료 (데몬은 계속 돈다)")
            }
            .controlSize(.small)
        }
        .padding(14)
        .frame(width: 340)
    }
}

// MARK: - 감시 관리 창

struct ManageView: View {
    @EnvironmentObject var model: Model

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    AddWatchForm()
                    Divider()
                    Text("감시 목록").font(.headline)
                    if model.watches.isEmpty {
                        Text("등록된 감시가 없습니다").foregroundColor(.secondary)
                    }
                    ForEach(model.watches) { w in
                        WatchCard(watch: w)
                    }
                }
                .padding(20)
            }
        }
        .frame(minWidth: 520, minHeight: 620)
        .onAppear { model.refresh() }
    }
}

struct WatchCard: View {
    @EnvironmentObject var model: Model
    let watch: WatchDetail
    @State private var confirmDelete = false

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(watch.title).font(.system(size: 15, weight: .bold))
                Text(watch.dateLine).foregroundColor(.secondary)
                Text("성인 \(watch.adults)").font(.system(size: 11)).foregroundColor(.secondary)
                Spacer()
                if !watch.active {
                    Text("중지됨")
                        .font(.system(size: 11))
                        .padding(.horizontal, 8).padding(.vertical, 2)
                        .background(Capsule().fill(Color.orange.opacity(0.2)))
                }
            }
            Text(watch.condLine).font(.system(size: 12)).foregroundColor(.secondary)
            HStack {
                Text(watch.priceLine)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundColor(watch.matched ? .green : .secondary)
                if let at = watch.lastCheckedAt {
                    let df: DateFormatter = {
                        let d = DateFormatter()
                        d.locale = Locale(identifier: "ko_KR")
                        d.dateFormat = "M월 d일 HH:mm"
                        return d
                    }()
                    Text("· 체크 \(df.string(from: at))").font(.system(size: 11)).foregroundColor(.secondary)
                }
                Spacer()
                Button(watch.active ? "일시중지" : "다시 시작") {
                    model.setActive(watch, !watch.active)
                }
                .controlSize(.small)
                Button("삭제", role: .destructive) { confirmDelete = true }
                    .controlSize(.small)
                    .confirmationDialog("\(watch.title) 감시를 삭제할까요?", isPresented: $confirmDelete) {
                        Button("삭제", role: .destructive) { model.deleteWatch(watch) }
                    }
            }
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 8).fill(Color.primary.opacity(0.05)))
        .opacity(watch.active ? 1 : 0.6)
    }
}

struct AddWatchForm: View {
    @EnvironmentObject var model: Model

    @State private var origin = ""
    @State private var destination = ""
    @State private var departureDate = Date()
    @State private var roundTrip = true
    @State private var returnDate = Calendar.current.date(byAdding: .day, value: 3, to: Date()) ?? Date()
    @State private var adults = 1
    @State private var currency = "KRW"
    @State private var maxPriceText = ""
    @State private var maxStops = 0 // 0=직항만, 1, 2, -1=상관없음
    @State private var limitDepartTime = false
    @State private var departAfter = Calendar.current.date(from: DateComponents(hour: 6, minute: 0)) ?? Date()
    @State private var departBefore = Calendar.current.date(from: DateComponents(hour: 22, minute: 0)) ?? Date()
    @State private var limitReturnTime = false
    @State private var returnAfter = Calendar.current.date(from: DateComponents(hour: 6, minute: 0)) ?? Date()
    @State private var returnBefore = Calendar.current.date(from: DateComponents(hour: 22, minute: 0)) ?? Date()
    @State private var saving = false
    @State private var message: String?

    private static let dayFmt: DateFormatter = {
        let d = DateFormatter()
        d.dateFormat = "yyyy-MM-dd"
        return d
    }()
    private static let timeFmt: DateFormatter = {
        let d = DateFormatter()
        d.dateFormat = "HH:mm"
        return d
    }()

    var body: some View {
        GroupBox(label: Text("새 감시 추가").font(.headline)) {
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    TextField("출발지 (예: ICN)", text: $origin)
                        .frame(width: 130)
                    Image(systemName: "arrow.right")
                    TextField("도착지 (예: FUK)", text: $destination)
                        .frame(width: 130)
                    Spacer()
                    Stepper("성인 \(adults)", value: $adults, in: 1...9)
                }
                HStack {
                    DatePicker("출발일", selection: $departureDate, displayedComponents: .date)
                    Toggle("왕복", isOn: $roundTrip)
                    if roundTrip {
                        DatePicker("귀국일", selection: $returnDate, displayedComponents: .date)
                    }
                    Spacer()
                }
                HStack {
                    TextField("최대 가격 (원, 비우면 무제한)", text: $maxPriceText)
                        .frame(width: 200)
                    Picker("경유", selection: $maxStops) {
                        Text("직항만").tag(0)
                        Text("1회까지").tag(1)
                        Text("2회까지").tag(2)
                        Text("상관없음").tag(-1)
                    }
                    .frame(width: 160)
                    Spacer()
                }
                HStack {
                    Toggle("출발편 시간대", isOn: $limitDepartTime)
                    if limitDepartTime {
                        DatePicker("", selection: $departAfter, displayedComponents: .hourAndMinute).labelsHidden()
                        Text("~")
                        DatePicker("", selection: $departBefore, displayedComponents: .hourAndMinute).labelsHidden()
                    }
                    Spacer()
                }
                if roundTrip {
                    HStack {
                        Toggle("귀국편 시간대", isOn: $limitReturnTime)
                        if limitReturnTime {
                            DatePicker("", selection: $returnAfter, displayedComponents: .hourAndMinute).labelsHidden()
                            Text("~")
                            DatePicker("", selection: $returnBefore, displayedComponents: .hourAndMinute).labelsHidden()
                        }
                        Spacer()
                    }
                }
                HStack {
                    Button(saving ? "추가 중..." : "감시 추가") { submit() }
                        .disabled(saving)
                        .keyboardShortcut(.defaultAction)
                    if let m = message {
                        Text(m).font(.system(size: 12)).foregroundColor(m.hasPrefix("✅") ? .green : .red)
                    }
                    Spacer()
                }
            }
            .padding(8)
        }
    }

    private func submit() {
        let o = origin.trimmingCharacters(in: .whitespaces).uppercased()
        let d = destination.trimmingCharacters(in: .whitespaces).uppercased()
        guard o.count == 3, d.count == 3 else {
            message = "출발지/도착지는 IATA 3글자 코드로 입력하세요"
            return
        }
        let maxPrice = Double(maxPriceText.replacingOccurrences(of: ",", with: ""))
        saving = true
        message = nil
        Task {
            let ok = await model.addWatch(
                origin: o,
                destination: d,
                departureDate: Self.dayFmt.string(from: departureDate),
                returnDate: roundTrip ? Self.dayFmt.string(from: returnDate) : nil,
                adults: adults,
                currency: currency,
                maxPrice: maxPrice,
                maxStops: maxStops >= 0 ? maxStops : nil,
                departAfter: limitDepartTime ? Self.timeFmt.string(from: departAfter) : nil,
                departBefore: limitDepartTime ? Self.timeFmt.string(from: departBefore) : nil,
                returnAfter: roundTrip && limitReturnTime ? Self.timeFmt.string(from: returnAfter) : nil,
                returnBefore: roundTrip && limitReturnTime ? Self.timeFmt.string(from: returnBefore) : nil
            )
            saving = false
            if ok {
                message = "✅ 추가됨 — \(o) → \(d)"
                origin = ""
                destination = ""
                maxPriceText = ""
            } else {
                message = "추가 실패 — 네트워크/권한 확인"
            }
        }
    }
}

// MARK: - 앱

@main
struct FlightWatchApp: App {
    @StateObject private var model = Model()

    var body: some Scene {
        MenuBarExtra {
            ContentView()
                .environmentObject(model)
                .onAppear { model.refresh() }
        } label: {
            Image(systemName: "airplane.circle.fill")
        }
        .menuBarExtraStyle(.window)

        Window("항공권 감시 관리", id: "manage") {
            ManageView().environmentObject(model)
        }
        .defaultSize(width: 560, height: 680)
    }

    init() {
        // 메뉴바 전용 앱 (Dock 아이콘 없음) — LSUIElement와 이중 안전장치
        DispatchQueue.main.async {
            NSApp.setActivationPolicy(.accessory)
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [model = _model] in
            Task { @MainActor in model.wrappedValue.startPolling() }
        }
    }
}
