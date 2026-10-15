import SwiftUI

struct GateBResearchWeinsteinWorkspace: View {
    let symbolInput: String
    let dailyEnvelope: MarketDailyTechnicalEnvelope?
    let frozenBinding: FrozenWeinsteinEvidenceBinding?
    @Binding var envelope: WeinsteinTechnicalAnalysisEnvelope?
    @State private var requestId = UUID()
    @State private var isRunning = false
    @State private var message = "周线主分析可独立读取；日线仅辅助观察时机。"

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                VStack(alignment: .leading, spacing: 3) {
                    Text("Weinstein 主分析").font(.title3.weight(.semibold))
                    Text("周线决定结构阶段；日线只细化观察时机。")
                        .font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                Button {
                    Task { await run() }
                } label: {
                    Label(isRunning ? "分析中" : "运行", systemImage: "chart.xyaxis.line")
                }
                .buttonStyle(.borderedProminent)
                .disabled(isRunning || SecuritySymbol.parseHongKongAlias(symbolInput) == nil)
                .id("researchRunWeinsteinAnalysisButton")
                .accessibilityIdentifier("researchRunWeinsteinAnalysisButton")
            }
            Text(message).font(.caption).foregroundStyle(.secondary)
                .accessibilityIdentifier("researchWeinsteinAnalysisMessage")
            ResearchWeinsteinTechnicalAnalysisView(
                envelope: envelope,
                dailyEnvelope: dailyEnvelope,
                frozenBinding: frozenBinding
            )
        }
        .onChange(of: sourceIdentity) { _, _ in clear("标的已变化；旧周线结果已清除。") }
        .accessibilityElement(children: .contain)
        .id("gateBResearchWeinsteinSection")
        .accessibilityIdentifier("gateBResearchWeinsteinSection")
    }

    private var sourceIdentity: String {
        SecuritySymbol.parseHongKongAlias(symbolInput)?.canonical ?? "INVALID"
    }

    @MainActor private func clear(_ reason: String) {
        requestId = UUID()
        isRunning = false
        envelope = nil
        message = reason
    }

    @MainActor private func run() async {
        let analysisAsOf = currentHongKongRequestDate()
        guard let symbol = SecuritySymbol.parseHongKongAlias(symbolInput) else {
            clear("请选择合法港股；旧周线结果已清除。")
            return
        }
        let context = AppEnvironment.researchAuthorizationContext()
        let currentRequest = UUID()
        requestId = currentRequest
        isRunning = true
        envelope = nil
        message = "正在读取个股、恒指和精确所属行业的完成周线。"
        defer { if requestId == currentRequest { isRunning = false } }
        do {
            let result = try await WeinsteinTechnicalAnalysisClient(
                baseURL: context.baseURL,
                authToken: context.readToken,
                authHeaderName: context.readHeaderName
            ).fetch(market: symbol.market, code: symbol.code, analysisAsOf: analysisAsOf)
            guard requestId == currentRequest,
                  context == AppEnvironment.researchAuthorizationContext(),
                  SecuritySymbol.parseHongKongAlias(symbolInput)?.canonical == symbol.canonical else { return }
            envelope = result
            message = result.status == "available"
                ? "主分析已完成；结果只读，未创建报告、决定、资产或交易。"
                : "周线证据不足；结果保留 DATA_INSUFFICIENT / UNKNOWN。"
        } catch {
            guard requestId == currentRequest,
                  context == AppEnvironment.researchAuthorizationContext(),
                  SecuritySymbol.parseHongKongAlias(symbolInput)?.canonical == symbol.canonical else { return }
            clear("Weinstein 结果不可用或身份校验失败；旧结果已清除。")
        }
    }
}

extension GateBResearchScreen {
    @ViewBuilder
    func ownerWeinsteinFrozenZonesSection() -> some View {
        let draft = frozenResearchEvidenceWorkspace.ownerZonesDraft
        VStack(alignment: .leading, spacing: 8) {
            Toggle("本次冻结纳入 Owner 人工区域版本", isOn: Binding(
                get: { frozenResearchEvidenceWorkspace.ownerZonesDraft.enabled },
                set: { enabled in
                    if enabled, let analysis = researchWeinsteinEnvelope {
                        frozenResearchEvidenceWorkspace.ownerZonesDraft.prefill(from: analysis)
                        if let latest = frozenResearchEvidenceWorkspace.envelope?.data?.latestPack?
                            .frozenResearchContext?.ownerWeinsteinZones,
                           latest.basedOn == frozenResearchEvidenceWorkspace.ownerZonesDraft.basedOn {
                            frozenResearchEvidenceWorkspace.ownerZonesDraft.version = String(latest.version + 1)
                        }
                    } else {
                        frozenResearchEvidenceWorkspace.ownerZonesDraft.enabled = false
                    }
                    ownerWeinsteinZoneDraftDidChange()
                }
            ))
            .disabled(researchWeinsteinEnvelope?.status != "available"
                || frozenResearchEvidenceWorkspace.isBusy)
            .accessibilityIdentifier("includeOwnerWeinsteinZonesInFreeze")
            Text("人工版本与确定性周线结果分开保存。先核对计算区域，再明确修改范围、版本和理由；已保存的研究修正材料不会自动成为本次冻结版本。")
                .font(.caption).foregroundStyle(.secondary)
            if let analysis = researchWeinsteinEnvelope, analysis.status == "available" {
                Text("机器原始区域 · 支撑：\(analysis.supportZones.map { "\($0.lower)–\($0.upper)" }.joined(separator: "、")) · 阻力：\(analysis.resistanceZones.map { "\($0.lower)–\($0.upper)" }.joined(separator: "、"))")
                    .font(.caption).foregroundStyle(.secondary)
            }
            if draft.enabled {
                if draft.basedOn != researchWeinsteinEnvelope.flatMap(FrozenWeinsteinEvidenceBinding.init(envelope:)) {
                    Text("周线计算版本已变化。请重新从当前结果预填，再填写人工理由。")
                        .font(.caption).foregroundStyle(.orange)
                }
                HStack {
                    TextField("人工版本号", text: Binding(
                        get: { frozenResearchEvidenceWorkspace.ownerZonesDraft.version },
                        set: { frozenResearchEvidenceWorkspace.ownerZonesDraft.version = $0; ownerWeinsteinZoneDraftDidChange() }
                    )).keyboardType(.numberPad)
                    Button("从当前计算区域重新预填") {
                        if let analysis = researchWeinsteinEnvelope {
                            frozenResearchEvidenceWorkspace.ownerZonesDraft.prefill(from: analysis)
                            ownerWeinsteinZoneDraftDidChange()
                        }
                    }.buttonStyle(.bordered)
                }
                ownerFrozenZoneRows(kind: "support")
                ownerFrozenZoneRows(kind: "resistance")
                TextField("人工调整理由（必填，最多 1000 字）", text: Binding(
                    get: { frozenResearchEvidenceWorkspace.ownerZonesDraft.reason },
                    set: { frozenResearchEvidenceWorkspace.ownerZonesDraft.reason = $0; ownerWeinsteinZoneDraftDidChange() }
                ), axis: .vertical)
                .lineLimit(2...5)
                if currentFrozenResearchBindingIdentity?.ownerWeinsteinZones == nil {
                    Text("请输入正数区域、有效版本号和理由；支撑与阻力合计至少一个区域，最多各五个。")
                        .font(.caption).foregroundStyle(.orange)
                }
            }
        }
        .padding(10)
        .background(Color(.tertiarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 8))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("ownerWeinsteinFrozenZonesSection")
    }

    @ViewBuilder
    private func ownerFrozenZoneRows(kind: String) -> some View {
        let support = kind == "support"
        let rows = support
            ? frozenResearchEvidenceWorkspace.ownerZonesDraft.supportRows
            : frozenResearchEvidenceWorkspace.ownerZonesDraft.resistanceRows
        VStack(alignment: .leading, spacing: 5) {
            Text(support ? "人工支撑区域" : "人工阻力区域")
                .font(.callout.weight(.semibold))
            ForEach(rows.indices, id: \.self) { index in
                HStack {
                    Text("\(index + 1)").font(.caption).foregroundStyle(.secondary)
                    TextField("下限", text: ownerFrozenZoneField(kind: kind, index: index, upper: false))
                        .keyboardType(.decimalPad)
                    Text("–")
                    TextField("上限", text: ownerFrozenZoneField(kind: kind, index: index, upper: true))
                        .keyboardType(.decimalPad)
                    Button {
                        if support {
                            frozenResearchEvidenceWorkspace.ownerZonesDraft.supportRows.remove(at: index)
                        } else {
                            frozenResearchEvidenceWorkspace.ownerZonesDraft.resistanceRows.remove(at: index)
                        }
                        ownerWeinsteinZoneDraftDidChange()
                    } label: { Image(systemName: "minus.circle") }
                        .accessibilityLabel("删除第 \(index + 1) 个\(support ? "支撑" : "阻力")区域")
                }
            }
            if rows.count < 5 {
                Button(support ? "增加支撑区域" : "增加阻力区域") {
                    if support {
                        frozenResearchEvidenceWorkspace.ownerZonesDraft.supportRows.append(.init())
                    } else {
                        frozenResearchEvidenceWorkspace.ownerZonesDraft.resistanceRows.append(.init())
                    }
                    ownerWeinsteinZoneDraftDidChange()
                }.buttonStyle(.bordered)
            }
        }
    }

    private func ownerFrozenZoneField(kind: String, index: Int, upper: Bool) -> Binding<String> {
        Binding(
            get: {
                let rows = kind == "support"
                    ? frozenResearchEvidenceWorkspace.ownerZonesDraft.supportRows
                    : frozenResearchEvidenceWorkspace.ownerZonesDraft.resistanceRows
                guard rows.indices.contains(index) else { return "" }
                return upper ? rows[index].upper : rows[index].lower
            },
            set: { value in
                if kind == "support" {
                    guard frozenResearchEvidenceWorkspace.ownerZonesDraft.supportRows.indices.contains(index) else { return }
                    if upper { frozenResearchEvidenceWorkspace.ownerZonesDraft.supportRows[index].upper = value }
                    else { frozenResearchEvidenceWorkspace.ownerZonesDraft.supportRows[index].lower = value }
                } else {
                    guard frozenResearchEvidenceWorkspace.ownerZonesDraft.resistanceRows.indices.contains(index) else { return }
                    if upper { frozenResearchEvidenceWorkspace.ownerZonesDraft.resistanceRows[index].upper = value }
                    else { frozenResearchEvidenceWorkspace.ownerZonesDraft.resistanceRows[index].lower = value }
                }
                ownerWeinsteinZoneDraftDidChange()
            }
        )
    }

    @ViewBuilder
    func researchWeinsteinZoneCorrectionSection() -> some View {
        let corrections = frozenResearchEvidenceWorkspace.envelope?.data?.materials.filter {
            $0.sourceType == "owner_weinstein_zone_correction"
        } ?? []
        VStack(alignment: .leading, spacing: 10) {
            Text("人工区域修正").font(.headline)
            Text("计算结果始终保留。这里可新增、调整或否决一个价格区域；修正会单独保存理由和版本，并使旧证据包与报告历史化。")
                .font(.caption).foregroundStyle(.secondary)
            if let analysis = researchWeinsteinEnvelope, analysis.status == "available" {
                DisclosureGroup("从计算区域预填") {
                    VStack(alignment: .leading, spacing: 6) {
                        ForEach(Array(analysis.supportZones.prefix(3).enumerated()), id: \.offset) { index, zone in
                            Button("支撑 \(index + 1) · \(zone.lower, specifier: "%.2f")–\(zone.upper, specifier: "%.2f")") {
                                researchWeinsteinZoneCorrectionDraft.bind(zone, kind: "support")
                                researchWeinsteinZoneCorrectionReservation.clear()
                            }
                        }
                        ForEach(Array(analysis.resistanceZones.prefix(3).enumerated()), id: \.offset) { index, zone in
                            Button("阻力 \(index + 1) · \(zone.lower, specifier: "%.2f")–\(zone.upper, specifier: "%.2f")") {
                                researchWeinsteinZoneCorrectionDraft.bind(zone, kind: "resistance")
                                researchWeinsteinZoneCorrectionReservation.clear()
                            }
                        }
                        if let zone = analysis.invalidationZone {
                            Button("失效区 · \(zone.lower, specifier: "%.2f")–\(zone.upper, specifier: "%.2f")") {
                                researchWeinsteinZoneCorrectionDraft.bind(zone, kind: "invalidation")
                                researchWeinsteinZoneCorrectionReservation.clear()
                            }
                        }
                    }.padding(.top, 6)
                }
                Picker("修正动作", selection: $researchWeinsteinZoneCorrectionDraft.action) {
                    Text("新增").tag("add"); Text("调整").tag("adjust"); Text("否决").tag("reject")
                }.pickerStyle(.segmented)
                Picker("区域类型", selection: $researchWeinsteinZoneCorrectionDraft.zoneKind) {
                    Text("支撑").tag("support"); Text("阻力").tag("resistance"); Text("失效").tag("invalidation")
                }.pickerStyle(.segmented)
                HStack {
                    TextField("下限", text: $researchWeinsteinZoneCorrectionDraft.lower).keyboardType(.decimalPad)
                    TextField("上限", text: $researchWeinsteinZoneCorrectionDraft.upper).keyboardType(.decimalPad)
                }
                TextField("人工修正理由（必填）", text: $researchWeinsteinZoneCorrectionDraft.reason, axis: .vertical)
                Button {
                    Task { await saveResearchWeinsteinZoneCorrection() }
                } label: {
                    Label(isSavingResearchWeinsteinZoneCorrection ? "正在保存并核对" : "保存人工修正", systemImage: "square.and.pencil")
                }
                .buttonStyle(.borderedProminent)
                .disabled(!canSaveResearchWeinsteinZoneCorrection)
                .accessibilityIdentifier("saveResearchWeinsteinZoneCorrection")
            } else {
                Text("当前没有可绑定的完整 Weinstein 结果；不会保存脱离计算版本的人工区域。")
                    .font(.caption).foregroundStyle(.orange)
            }
            if !corrections.isEmpty {
                DisclosureGroup("已保存修正 · \(corrections.count)") {
                    ForEach(corrections) { correction in
                        VStack(alignment: .leading, spacing: 3) {
                            Text(correction.title).font(.callout.weight(.semibold))
                            Text(correction.summary).font(.caption)
                            Text("材料 #\(correction.id) · r\(correction.revision) · \(correction.sourceVersion)")
                                .font(.caption2).foregroundStyle(.secondary)
                        }.padding(.vertical, 3)
                    }
                }
            }
            Text(researchWeinsteinZoneCorrectionMessage).font(.caption).foregroundStyle(.secondary)
                .accessibilityIdentifier("researchWeinsteinZoneCorrectionMessage")
            Text("这只是 Owner 的研究修正，不会改写确定性计算结果、确认报告、形成决定、修改资产或发起交易。")
                .font(.caption.weight(.semibold)).foregroundStyle(.orange)
        }
        .padding(12)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 8))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("researchWeinsteinZoneCorrectionSection")
    }

    var canSaveResearchWeinsteinZoneCorrection: Bool {
        guard !isSavingResearchWeinsteinZoneCorrection,
              let membership = selectedMembership,
              let analysis = researchWeinsteinEnvelope else { return false }
        return researchWeinsteinZoneCorrectionDraft.request(
            membership: membership,
            analysis: analysis,
            idempotencyKey: "validation"
        ) != nil
    }

    @MainActor
    func saveResearchWeinsteinZoneCorrection() async {
        guard canSaveResearchWeinsteinZoneCorrection,
              let membership = selectedMembership,
              let analysis = researchWeinsteinEnvelope else { return }
        let semantic = [membership.id, String(membership.version), analysis.resultHash ?? "", researchWeinsteinZoneCorrectionDraft.fingerprint]
            .joined(separator: "|")
        let key = researchWeinsteinZoneCorrectionReservation.reserve(for: semantic, prefix: "ios-weinstein-zone")
        let requestStore = WeinsteinZoneCorrectionRequestStore()
        let request: CreateResearchMaterialRequest
        if let reserved = requestStore.load(semantic: semantic) {
            request = reserved
        } else {
            guard let created = researchWeinsteinZoneCorrectionDraft.request(
                membership: membership, analysis: analysis, idempotencyKey: key
            ), requestStore.save(semantic: semantic, request: created) else {
                researchWeinsteinZoneCorrectionMessage = "无法保存本次修正的重试身份；尚未发送。"
                return
            }
            request = created
        }
        let authorization = (revision: viewModel.authorizationRevision, context: AppEnvironment.researchAuthorizationContext())
        isSavingResearchWeinsteinZoneCorrection = true
        defer { isSavingResearchWeinsteinZoneCorrection = false }
        do {
            let readBack = try await viewModel.client.createOwnerCorrectionMaterialAndReadBack(
                membership: membership,
                requestBody: request
            )
            guard selectedMembership == membership,
                  researchWeinsteinEnvelope == analysis,
                  dailyClientAuthorizationIsCurrent(authorization.revision),
                  AppEnvironment.researchAuthorizationContext() == authorization.context,
                  readBack.material.sourceType == "owner_weinstein_zone_correction",
                  readBack.material.sourceVersion == request.sourceVersion else { return }
            frozenResearchEvidenceWorkspace.envelope = readBack.workspace
            frozenResearchEvidenceWorkspace.ownerConfirmed = false
            frozenResearchEvidenceWorkspace.confirmedBindingIdentity = nil
            frozenResearchEvidenceWorkspace.reservation.clear()
            frozenResearchEvidenceWorkspace.message = "人工区域修正已保存；旧证据包与报告继续保留为历史，请重新冻结。"
            invalidateTwoLayerReport("人工区域修正已保存；旧报告状态已清除，请重新冻结证据。")
            todayRefreshRevision &+= 1
            researchWeinsteinZoneCorrectionDraft = WeinsteinZoneCorrectionDraft()
            researchWeinsteinZoneCorrectionReservation.clear()
            requestStore.clear()
            researchWeinsteinZoneCorrectionMessage = "人工区域修正 #\(readBack.material.id) 已保存并 fresh read；确定性计算结果未被覆盖。"
        } catch {
            researchWeinsteinZoneCorrectionMessage = "人工区域修正未取得可验证回读；未显示成功，可使用同一内容重试。"
        }
    }

    @MainActor
    func resetResearchWeinsteinZoneCorrection(_ message: String) {
        researchWeinsteinZoneCorrectionDraft = WeinsteinZoneCorrectionDraft()
        researchWeinsteinZoneCorrectionReservation.clear()
        WeinsteinZoneCorrectionRequestStore().clear()
        isSavingResearchWeinsteinZoneCorrection = false
        researchWeinsteinZoneCorrectionMessage = message
    }
}
