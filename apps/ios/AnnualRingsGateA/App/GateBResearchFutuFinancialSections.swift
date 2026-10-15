import SwiftUI

struct FutuFinancialWorkspaceState {
    var identity: String?
    var captures: [FutuFinancialCapture] = []
    var current: FutuFinancialCapture?
    var original: VerifiedFutuFinancialOriginal?
    var history: FutuFinancialHistory?
    var historyMessage = "尚未读取年度与累计半年财务历史。"
    var message = "读取当前公司后可浏览最近 20 次富途财报捕获。"
    var busy = false
    var revision = UUID()
    var pageSize = 20
    var maxPagesPerTable = 4
    var periodSelection = "annual"
    var materialPeriodEnd = ""
    var materialPreview: FutuFinancialMaterialPreview?
    var savedMaterial: ResearchMaterialData?
    var materialConfirmed = false
    var materialValidUntil = Date().addingTimeInterval(30 * 24 * 3600)
    var materialQuestion = ""
    var materialMessage = ""
    var materialReservation = ResearchDocumentIdempotencyReservation()
    var reservation = ResearchDocumentIdempotencyReservation()
    var acquisition = FutuFinancialAcquisitionProgress()
    var acquisitionMessage = "明确开始后依次读取年度和累计半年；已存捕获会优先复用。"

    mutating func clear(_ nextIdentity: String) {
        identity = nextIdentity
        revision = UUID()
        captures = []
        current = nil
        original = nil
        history = nil
        clearMaterial()
        materialQuestion = ""
        historyMessage = "正在读取提供商财务历史。"
        busy = false
        reservation.clear()
        acquisition.clear()
        acquisitionMessage = "明确开始后依次读取年度和累计半年；已存捕获会优先复用。"
        message = "正在读取当前公司最近 20 次富途财报捕获。"
    }

    mutating func clearMaterial() {
        materialPeriodEnd = ""
        materialPreview = nil
        savedMaterial = nil
        materialConfirmed = false
        materialMessage = ""
        materialReservation.clear()
    }
}

extension GateBResearchScreen {
    @ViewBuilder
    func futuFinancialSection() -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("富途提供方财报数据")
                .font(OwnerReadingFont.headline)
            Text("与发行人 PDF、官方网页和正式财务事实分别保存。不会自动生成正式事实、覆盖结论或研究判断。最近列表仅含 20 次捕获。")
                .font(OwnerReadingFont.caption).foregroundStyle(.secondary)
            if let membership = selectedMembership {
                Text("当前 \(membership.symbol)")
                    .font(OwnerReadingFont.caption)
                Button(futuFinancialWorkspace.acquisition.isComplete ? "年度与累计半年均有已存捕获"
                       : futuFinancialWorkspace.acquisition.hasPendingRequest ? "续取未完成的财报请求"
                       : "依次取得年度与累计半年") {
                    Task { await captureAnnualAndHalfYear() }
                }
                .buttonStyle(.borderedProminent)
                .disabled(futuFinancialWorkspace.busy || membership.state != .tracked
                    || futuFinancialWorkspace.acquisition.isComplete
                    || futuFinancialWorkspace.reservation.key != nil
                    || futuFinancialWorkspace.materialReservation.key != nil)
                .accessibilityIdentifier("futuFinancialAnnualHalfYearAcquisition")
                Text(futuFinancialWorkspace.acquisitionMessage)
                    .font(OwnerReadingFont.caption).foregroundStyle(.secondary)
                    .accessibilityIdentifier("futuFinancialAcquisitionMessage")
                if let annual = futuFinancialWorkspace.acquisition.annualCaptureId {
                    Text("年度捕获 #\(annual) 已回读；实际五年覆盖见下方。")
                        .font(OwnerReadingFont.caption)
                }
                if let half = futuFinancialWorkspace.acquisition.halfYearCaptureId {
                    Text("累计半年捕获 #\(half) 已回读；实际期间覆盖见下方。")
                        .font(OwnerReadingFont.caption)
                }
                DisclosureGroup("单项重新获取与分页参数") {
                    Picker("财报期间", selection: $futuFinancialWorkspace.periodSelection) {
                        Text("年度").tag("annual")
                        Text("累计半年").tag("half_year")
                    }
                    .disabled(futuFinancialWorkspace.busy || futuFinancialWorkspace.acquisition.hasPendingRequest
                        || futuFinancialWorkspace.reservation.key != nil)
                    Stepper("每页报告数：\(futuFinancialWorkspace.pageSize)", value: $futuFinancialWorkspace.pageSize, in: 1...20)
                        .disabled(futuFinancialWorkspace.busy || futuFinancialWorkspace.acquisition.hasPendingRequest
                            || futuFinancialWorkspace.reservation.key != nil)
                    Stepper("每表最多页数：\(futuFinancialWorkspace.maxPagesPerTable)", value: $futuFinancialWorkspace.maxPagesPerTable, in: 1...4)
                        .disabled(futuFinancialWorkspace.busy || futuFinancialWorkspace.acquisition.hasPendingRequest
                            || futuFinancialWorkspace.reservation.key != nil)
                    Button("只获取所选期间") { Task { await captureFutuFinancialStatements() } }
                        .disabled(futuFinancialWorkspace.busy || membership.state != .tracked
                            || futuFinancialWorkspace.acquisition.hasPendingRequest
                            || futuFinancialWorkspace.materialReservation.key != nil)
                }
                .onChange(of: futuFinancialWorkspace.pageSize) { _, _ in resetFutuAcquisitionForOptions() }
                .onChange(of: futuFinancialWorkspace.maxPagesPerTable) { _, _ in resetFutuAcquisitionForOptions() }
                Button("读取最近捕获") { Task { await loadFutuFinancialCaptures() } }
                    .disabled(futuFinancialWorkspace.busy || futuFinancialWorkspace.materialReservation.key != nil)
            } else {
                Text("请先选择当前研究公司。")
            }
            Text(futuFinancialWorkspace.message).font(OwnerReadingFont.caption)
                .foregroundStyle(.secondary)
                .accessibilityIdentifier("futuFinancialMessage")
            futuFinancialHistorySection()
            if futuFinancialWorkspace.captures.isEmpty && !futuFinancialWorkspace.busy {
                Text("当前没有可浏览的捕获；读取失败时不会沿用旧列表。")
                    .font(OwnerReadingFont.caption)
            }
            ForEach(futuFinancialWorkspace.captures) { capture in
                Button {
                    Task { await openFutuFinancialCapture(capture.id) }
                } label: {
                    VStack(alignment: .leading, spacing: 3) {
                        Text("\(capture.capturedAt) · \(capture.periodSelection == "half_year" ? "累计半年" : capture.periodSelection == "annual" ? "年度" : "旧版默认筛选") · \(capture.pages.count) 页")
                        Text(capture.membershipVersion == selectedMembership?.version ? "富途提供方" : "历史记录 · 富途提供方")
                            .font(OwnerReadingFont.caption).foregroundStyle(.secondary)
                    }
                }
                .disabled(futuFinancialWorkspace.busy || futuFinancialWorkspace.materialReservation.key != nil)
                .accessibilityIdentifier("futuFinancialCapture-\(capture.id)")
            }
            if let capture = futuFinancialWorkspace.current {
                Divider()
                Text(capture.membershipVersion == selectedMembership?.version ? "富途提供方财报" : "富途提供方历史记录")
                    .font(OwnerReadingFont.callout)
                futuFinancialMaterialSection(capture)
                DisclosureGroup("捕获身份与待核对口径") {
                    Text("成员 \(capture.membershipId) · 捕获时 v\(capture.membershipVersion) · 当前 v\(selectedMembership?.version ?? 0) · \(capture.periodSelection ?? "legacy_default") · 每页 \(capture.pageSize) 份报告 · 每表最多 \(capture.maxPagesPerTable) 页")
                    Text("期间起日、金额单位倍率、合并口径、重述、发行人原文、最新应有期和历史覆盖范围：未知。请另行核对发行人原文。")
                }
                ForEach(FutuFinancialTable.allCases, id: \.rawValue) { table in
                    let state = capture.tables[table]
                    VStack(alignment: .leading, spacing: 6) {
                        Text("\(table.title) · \(futuFinancialStatus(state.status))")
                            .font(OwnerReadingFont.headline)
                        Text("\(state.reportCount) 份报告，\(state.pageCount) 页。\(futuFinancialReason(state.reasonCode))")
                            .font(OwnerReadingFont.caption)
                        Text("分页完成仅指本次请求；不代表最新披露或历史覆盖齐全。")
                            .font(OwnerReadingFont.caption).foregroundStyle(.secondary)
                        ForEach(capture.pages.filter { $0.statementType == table }) { page in
                            Button {
                                Task { await openFutuFinancialPage(page.id) }
                            } label: {
                                Text("第 \(page.pageNumber) 页 · \(page.reports.count) 份报告 · \(futuPagePeriodSpan(page)) · 原件\(futuOriginalStatus(page.originalAvailability))")
                            }
                            .disabled(futuFinancialWorkspace.busy || page.originalAvailability != "available")
                            .accessibilityIdentifier("futuFinancialPage-\(page.id)")
                        }
                    }
                }
            }
            if let verified = futuFinancialWorkspace.original {
                Divider()
                Text("\(verified.page.statementType.title) · 已核验第 \(verified.page.pageNumber) 页")
                    .font(OwnerReadingFont.headline)
                ForEach(Array(verified.body.report_list.enumerated()), id: \.offset) { index, report in
                    DisclosureGroup {
                        Text("提供方原数值；金额单位倍率未知，未换算。")
                            .font(OwnerReadingFont.caption).foregroundStyle(.secondary)
                        ForEach(Array(report.item_list.enumerated()), id: \.offset) { _, item in
                            HStack(alignment: .firstTextBaseline) {
                                Text(item.display_name)
                                Spacer(minLength: 8)
                                Text(item.data.map { String($0) } ?? "未提供")
                                    .monospacedDigit()
                            }
                            .font(OwnerReadingFont.callout)
                        }
                    } label: {
                        Text("\(report.period_text) · \(verified.page.reports[index].periodEnd) · \(report.currency_code.isEmpty ? "币种未知" : report.currency_code)")
                            .font(OwnerReadingFont.callout.bold())
                    }
                }
                DisclosureGroup("已核验原始 JSON") {
                    Text(verified.rawText)
                        .font(.system(.caption, design: .monospaced))
                        .textSelection(.enabled)
                }
            }
        }
        .task(id: researchDocumentTaskIdentity) {
            futuFinancialWorkspace.clear(researchDocumentTaskIdentity)
            await loadFutuFinancialCaptures()
        }
        .accessibilityIdentifier("futuFinancialWorkspace")
    }

    @ViewBuilder
    private func futuFinancialMaterialSection(_ capture: FutuFinancialCapture) -> some View {
        let financialType = capture.periodSelection == "annual" ? "ANNUAL" : "Q6"
        let periods = Array(Set(capture.pages.flatMap { $0.reports.filter { $0.financialType == financialType }.map(\.periodEnd) })).sorted().reversed()
        VStack(alignment: .leading, spacing: 8) {
            Text("作为研究材料使用").font(OwnerReadingFont.headline)
            Text("选择一个已保存期间，服务端从原件生成内容。保存为第三方声明、未核实材料；披露时间未知，不计入发行人事实或完整财务覆盖。")
                .font(OwnerReadingFont.caption).foregroundStyle(.secondary)
            Text("单个年度材料可以用于有限研究，但本次选材不等于连续五年加累计半年完整覆盖；未选择也不等于提供商未披露。")
                .font(OwnerReadingFont.caption).foregroundStyle(.secondary)
            if capture.periodSelection == "legacy_default" || capture.membershipVersion != selectedMembership?.version {
                Text("旧版筛选或历史成员捕获不用于这次材料保存，请重新获取明确的年度或累计半年。").font(OwnerReadingFont.caption)
            } else {
                Picker("使用期间", selection: $futuFinancialWorkspace.materialPeriodEnd) {
                    Text("请选择期间").tag("")
                    ForEach(Array(periods), id: \.self) { Text($0 + " " + financialType).tag($0) }
                }.disabled(futuFinancialWorkspace.materialReservation.key != nil)
                    .onChange(of: futuFinancialWorkspace.materialPeriodEnd) { _, _ in
                    futuFinancialWorkspace.materialPreview = nil
                    futuFinancialWorkspace.savedMaterial = nil
                    futuFinancialWorkspace.materialConfirmed = false
                }
                Button("核对所选原值与来源") { Task { await readFutuMaterialPreview(capture, financialType: financialType) } }
                    .disabled(futuFinancialWorkspace.busy || futuFinancialWorkspace.materialPeriodEnd.isEmpty
                        || futuFinancialWorkspace.materialReservation.key != nil)
                if let preview = futuFinancialWorkspace.materialPreview {
                    Text(preview.title).font(OwnerReadingFont.callout)
                    ForEach(preview.values) { value in
                        Text("\(futuFinancialMetricTitle(value.metric))：\(value.rawValue) \(value.currencyCode) · \(value.periodText)")
                            .font(OwnerReadingFont.caption).monospacedDigit()
                    }
                    Text("捕获于 \(preview.source.capturedAt)；披露时间未知。").font(OwnerReadingFont.caption)
                    ForEach(preview.source.gaps, id: \.self) { gap in
                        Text(gap.hasSuffix("仅表示本次捕获范围。") ? "整次捕获局限：\(gap)" : "所选期间局限：\(gap)")
                            .font(OwnerReadingFont.caption).foregroundStyle(.secondary)
                    }
                    DisclosureGroup("完整材料与原件身份") { Text(preview.contentText).font(OwnerReadingFont.caption).textSelection(.enabled) }
                    if preview.materials.isEmpty && futuFinancialWorkspace.savedMaterial == nil {
                        DatePicker("下次核对资料", selection: $futuFinancialWorkspace.materialValidUntil, in: Date()..., displayedComponents: .date)
                            .disabled(futuFinancialWorkspace.materialReservation.key != nil)
                        Toggle("我已核对原值、币种、期间与局限，保存为第三方未核实材料", isOn: $futuFinancialWorkspace.materialConfirmed)
                            .disabled(futuFinancialWorkspace.materialReservation.key != nil)
                        Button("明确保存研究材料") { Task { await saveFutuMaterial() } }
                            .disabled(futuFinancialWorkspace.busy || !futuFinancialWorkspace.materialConfirmed)
                    } else {
                        Text(preview.materials.count > 1 ? "存在多个匹配版本，请在正式材料范围中明确选择。" : "此期间已有保存并回读的研究材料。")
                            .font(OwnerReadingFont.caption)
                    }
#if OWNER_CLIENT
                    TextField("用这项资料研究什么？", text: $futuFinancialWorkspace.materialQuestion, axis: .vertical)
                    Button("用此项材料准备有限研究") { stageFutuMaterialQuestion(preview) }
                        .disabled(futuFinancialWorkspace.busy || preview.materials.count != 1
                            || !(3...1000).contains(futuFinancialWorkspace.materialQuestion.trimmingCharacters(in: .whitespacesAndNewlines).utf16.count))
                    Text("只带入问题和此项材料；在准备页仍须明确冻结、核对发送范围并开始研究。").font(OwnerReadingFont.caption).foregroundStyle(.secondary)
#endif
                }
            }
            if !futuFinancialWorkspace.materialMessage.isEmpty { Text(futuFinancialWorkspace.materialMessage).font(OwnerReadingFont.caption) }
        }.accessibilityIdentifier("futuFinancialMaterial")
    }

    @MainActor private func readFutuMaterialPreview(_ capture: FutuFinancialCapture, financialType: String) async {
        guard let membership = selectedMembership,
              futuFinancialWorkspace.materialReservation.key == nil else { return }
        let identity = researchDocumentTaskIdentity, revision = UUID(), period = futuFinancialWorkspace.materialPeriodEnd
        futuFinancialWorkspace.revision = revision
        futuFinancialWorkspace.materialPreview = nil
        futuFinancialWorkspace.savedMaterial = nil
        futuFinancialWorkspace.materialConfirmed = false
        futuFinancialWorkspace.busy = true
        defer { if futuFinancialWorkspace.revision == revision { futuFinancialWorkspace.busy = false } }
        do {
            let preview = try await client.readFutuFinancialMaterialPreview(membership: membership, captureId: capture.id,
                financialType: financialType, periodEnd: period)
            guard researchDocumentTaskIdentity == identity, futuFinancialWorkspace.revision == revision,
                  futuFinancialWorkspace.materialPeriodEnd == period else { return }
            futuFinancialWorkspace.materialPreview = preview
            futuFinancialWorkspace.materialMessage = "原件已读回；尚未保存或发送。"
#if OWNER_CLIENT
            if let handoff = ownerStore.personalFormalHandoff, handoff.membershipId == membership.id,
               handoff.membershipVersion == membership.version, handoff.symbol == membership.symbol,
               handoff.connectionScope == PersonalFormalResearchHandoff.currentConnectionScope() {
                futuFinancialWorkspace.materialQuestion = handoff.question
            }
#endif
        } catch {
            guard researchDocumentTaskIdentity == identity, futuFinancialWorkspace.revision == revision else { return }
            futuFinancialWorkspace.materialMessage = "所选原件读取失败；旧预览已清除。\(researchDocumentClientMessage(error))"
        }
    }

    @MainActor private func saveFutuMaterial() async {
        guard let membership = selectedMembership, let preview = futuFinancialWorkspace.materialPreview,
              futuFinancialWorkspace.materialConfirmed else { return }
        let identity = researchDocumentTaskIdentity, revision = UUID()
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let validUntil = formatter.string(from: futuFinancialWorkspace.materialValidUntil)
        let key = futuFinancialWorkspace.materialReservation.reserve(for: "\(membership.id):\(membership.version):\(preview.source.sourceFingerprint):\(validUntil)", prefix: "ios-opend-material")
        futuFinancialWorkspace.revision = revision
        futuFinancialWorkspace.busy = true
        defer { if futuFinancialWorkspace.revision == revision { futuFinancialWorkspace.busy = false } }
        do {
            let (material, _) = try await client.saveFutuFinancialMaterialAndReadBack(membership: membership, preview: preview,
                validUntil: validUntil, idempotencyKey: key)
            guard researchDocumentTaskIdentity == identity, futuFinancialWorkspace.revision == revision,
                  futuFinancialWorkspace.materialPeriodEnd == preview.source.periodEnd else { return }
            let reread = try await client.readFutuFinancialMaterialPreview(membership: membership, captureId: preview.source.captureId,
                financialType: preview.source.financialType, periodEnd: preview.source.periodEnd)
            guard researchDocumentTaskIdentity == identity, futuFinancialWorkspace.revision == revision,
                  futuFinancialWorkspace.materialPeriodEnd == preview.source.periodEnd else { return }
            futuFinancialWorkspace.materialPreview = reread
            futuFinancialWorkspace.savedMaterial = material
            futuFinancialWorkspace.materialReservation.clear()
            futuFinancialWorkspace.materialMessage = "材料 #\(material.id) 已保存并回读；现有草稿、任务和正式判断未自动改变。"
        } catch {
            guard researchDocumentTaskIdentity == identity, futuFinancialWorkspace.revision == revision else { return }
            futuFinancialWorkspace.materialMessage = "保存或回读未完成，选择与请求身份已保留。\(researchDocumentClientMessage(error))"
        }
    }

#if OWNER_CLIENT
    @MainActor private func stageFutuMaterialQuestion(_ preview: FutuFinancialMaterialPreview) {
        guard let membership = selectedMembership, preview.validates(membership), preview.materials.count == 1 else { return }
        let question = futuFinancialWorkspace.materialQuestion.trimmingCharacters(in: .whitespacesAndNewlines)
        guard (3...1000).contains(question.utf16.count) else { return }
        ownerStore.stagePersonalFormalHandoff(PersonalFormalResearchHandoff(symbol: membership.symbol, membershipId: membership.id,
            membershipVersion: membership.version, mode: "earnings_quality", eventDate: nil,
            question: question, readSourceScope: "",
            connectionScope: PersonalFormalResearchHandoff.currentConnectionScope(), sources: [],
            providerSources: [PersonalFormalProviderSourceHint(captureId: preview.source.captureId,
                financialType: preview.source.financialType, periodEnd: preview.source.periodEnd,
                sourceFingerprint: preview.source.sourceFingerprint, materials: preview.materials)]))
        ownerStore.finishPersonalFormalDismissal()
    }
#endif

    private func futuFinancialStatus(_ status: String) -> String {
        switch status { case "complete": "本次请求分页完成"; case "partial": "部分取得"; default: "本次不可用" }
    }

    private func futuOriginalStatus(_ status: String) -> String {
        switch status { case "available": "可读取"; case "unavailable": "缺失或损坏"; default: "待核验" }
    }

    private func futuPagePeriodSpan(_ page: FutuFinancialPage) -> String {
        let periods = page.reports.map { $0.periodText.isEmpty ? $0.periodEnd : $0.periodText }
        guard let first = periods.first else { return "无报告" }
        return periods.count > 1 ? "\(first) 至 \(periods.last ?? first)" : first
    }

    private func futuFinancialReason(_ code: String?) -> String {
        guard let code else { return "" }
        let names = ["NO_PAGE": "未取得页面", "NO_REPORTS": "本次页面没有报告", "CAPTURE_DEADLINE": "抓取时间达到上限",
                     "PAGE_LIMIT": "达到本次页数上限", "CURSOR_LOOP": "分页游标重复", "DUPLICATE_PERIOD": "报告期间重复",
                     "PERIOD_CONFLICT": "同一期间内容冲突", "PERIOD_ORDER_INVALID": "报告期间顺序异常",
                     "MIXED_CURRENCY": "同表报告币种不一致", "BRIDGE_UNAVAILABLE": "富途连接不可用",
                     "BRIDGE_HTTP_ERROR": "富途连接返回错误", "PAGE_REQUEST_FAILED": "页面请求失败",
                     "PAGE_TOO_LARGE": "页面超出大小限制", "PAGE_INVALID_JSON": "页面格式无效",
                     "PAGE_IDENTITY_INVALID": "页面身份校验失败"]
        return "\(names[code] ?? "提供方页面不可用")（\(code)）"
    }

    @ViewBuilder
    private func futuFinancialHistorySection() -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("已保存年度与最近观察半年 · OpenD 提供商值").font(OwnerReadingFont.headline)
            Text("人民币原值按亿元显示；其他币种保留原值。展开可见提供商原值。属于个人研究准备资料，最新应有披露期、发行人原文核验和跨期重述可比性均未知。")
                .font(OwnerReadingFont.caption).foregroundStyle(.secondary)
            if let history = futuFinancialWorkspace.history {
                Text("所选最近范围：\(history.status == "available" ? "五年年度和最近两期累计半年五项已读齐" : history.status == "partial" ? "仅部分可读" : "不可用")；已读原值币种 \(history.observedCurrencyCode ?? "未能确认单一币种")。同币种仅说明单位一致，不证明发行人核验或重述可比。")
                    .font(OwnerReadingFont.caption)
                let annualObserved = history.annualPeriodEnds.filter { end in
                    history.values.contains { $0.financialType == "ANNUAL" && $0.periodEnd == end }
                }.count
                let annualComplete = history.annualPeriodEnds.filter { end in
                    futuFinancialPeriodIsComplete(history.values.filter { $0.financialType == "ANNUAL" && $0.periodEnd == end })
                }.count
                let halfYearObserved = history.halfYearPeriodEnds.filter { end in
                    history.values.contains { $0.financialType == "Q6" && $0.periodEnd == end }
                }.count
                let halfYearComplete = history.halfYearPeriodEnds.filter { end in
                    futuFinancialPeriodIsComplete(history.values.filter { $0.financialType == "Q6" && $0.periodEnd == end })
                }.count
                Text("五年年度目标：已核验可用原值 \(annualObserved)/5 期，五项同币种齐备 \(annualComplete)/5；累计半年：已核验可用原值 \(halfYearObserved) 期，五项同币种齐备 \(halfYearComplete) 期。")
                    .font(OwnerReadingFont.caption)
                if history.annualCaptureId == nil { Text("尚无年度捕获；无法确定五年期间起止。")
                    .font(OwnerReadingFont.caption).foregroundStyle(.secondary) }
                if let id = history.annualCaptureId {
                    Button("打开年度捕获 #\(id)，选择实际期间") { Task { await openFutuFinancialCapture(id) } }
                        .disabled(futuFinancialWorkspace.busy || futuFinancialWorkspace.materialReservation.key != nil)
                }
                if history.halfYearCaptureId == nil { Text("尚无累计半年捕获；无法判断已存半年覆盖。")
                    .font(OwnerReadingFont.caption).foregroundStyle(.secondary) }
                if let id = history.halfYearCaptureId {
                    Button("打开累计半年捕获 #\(id)，选择实际期间") { Task { await openFutuFinancialCapture(id) } }
                        .disabled(futuFinancialWorkspace.busy || futuFinancialWorkspace.materialReservation.key != nil)
                }
                Text("以上只统计已保存、可读取的提供商原值；未选入材料不等于未披露。最新应披露期间仍为 UNKNOWN。")
                    .font(OwnerReadingFont.caption).foregroundStyle(.secondary)
                ForEach(history.annualPeriodEnds, id: \.self) { end in
                    futuFinancialPeriod(end, title: "\(end.prefix(4)) 全年", values: history.values.filter { $0.financialType == "ANNUAL" && $0.periodEnd == end })
                }
                ForEach(history.halfYearPeriodEnds, id: \.self) { end in
                    futuFinancialPeriod(end, title: "\(end.prefix(4)) 上半年累计\(end == history.latestHalfYearPeriodEnd ? "" : " · 同期")", values: history.values.filter { $0.financialType == "Q6" && $0.periodEnd == end })
                }
                ForEach(history.comparisonNotices) { notice in
                    VStack(alignment: .leading, spacing: 3) {
                        Text("已知版本差异：" + notice.text).font(OwnerReadingFont.caption).foregroundStyle(.secondary)
                        if let url = URL(string: notice.sourceUrl) { Link("查看对应公开披露", destination: url).font(OwnerReadingFont.caption) }
                    }
                }
                ForEach(history.gaps, id: \.self) { gap in Text("待补：" + gap).font(OwnerReadingFont.caption).foregroundStyle(.secondary) }
                ForEach(history.captureLimitations ?? [], id: \.self) { limitation in
                    Text("整次捕获／更老期间限制：" + limitation)
                        .font(OwnerReadingFont.caption).foregroundStyle(.secondary)
                }
                if history.captureLimitations == nil {
                    Text("旧版读取未单列整次捕获限制；不能据此认为更老历史完整。")
                        .font(OwnerReadingFont.caption).foregroundStyle(.secondary)
                }
            } else { Text(futuFinancialWorkspace.historyMessage).font(OwnerReadingFont.caption).foregroundStyle(.secondary) }
        }.accessibilityIdentifier("futuFinancialHistory")
    }

    private func futuFinancialPeriod(_ end: String, title: String, values: [FutuFinancialHistoryValue]) -> some View {
        DisclosureGroup(title) {
            ForEach(values) { value in
                HStack(alignment: .firstTextBaseline) {
                    Text(futuFinancialMetricTitle(value.metric))
                    Spacer(minLength: 8)
                    Text(futuFinancialAmount(value))
                        .monospacedDigit()
                }.font(OwnerReadingFont.callout)
                DisclosureGroup("来源与期间 · \(futuFinancialMetricTitle(value.metric))") {
                    Text("\(value.periodText) · \(value.periodStart ?? value.periodEnd) 至 \(value.periodEnd) · \(value.statementType.title) 字段 \(value.fieldId)")
                    Text("提供商原值：\(value.rawValue) \(value.currencyCode)")
                    Text("OpenD 捕获于 \(value.source.capturedAt) · 原响应页 \(value.source.pageId)")
                    Text("原响应 SHA-256 \(value.source.rawSha256)")
                }.font(OwnerReadingFont.caption)
            }
            let missing = ["revenue", "profit_attributable_to_owners", "operating_cash_flow", "total_assets", "total_liabilities"]
                .filter { metric in !values.contains(where: { $0.metric == metric }) }
            if !missing.isEmpty {
                Text("缺项：\(missing.map(futuFinancialMetricTitle).joined(separator: "、"))")
                    .font(OwnerReadingFont.caption).foregroundStyle(.secondary)
            }
            if Set(values.map(\.currencyCode)).count > 1 {
                Text("本期原值币种不一致；不作同币种完整覆盖。")
                    .font(OwnerReadingFont.caption).foregroundStyle(.secondary)
            } else if values.count != Set(values.map(\.metric)).count || values.count > 5 {
                Text("本期存在重复或额外值，不能认定五项完整覆盖。")
                    .font(OwnerReadingFont.caption).foregroundStyle(.secondary)
            }
        }
    }

    private func futuFinancialPeriodIsComplete(_ values: [FutuFinancialHistoryValue]) -> Bool {
        values.count == 5 && Set(values.map(\.metric)).count == 5 && Set(values.map(\.currencyCode)).count == 1
    }

    private func futuFinancialMetricTitle(_ metric: String) -> String {
        switch metric {
        case "revenue": "营业总收入"
        case "profit_attributable_to_owners": "归母净利润"
        case "operating_cash_flow": "经营现金流净额"
        case "total_assets": "总资产"
        case "total_liabilities": "总负债"
        default: metric
        }
    }

    private func futuFinancialAmount(_ value: FutuFinancialHistoryValue) -> String {
        guard value.currencyCode == "CNY", let amount = Decimal(string: value.rawValue) else {
            return "\(value.rawValue) \(value.currencyCode)"
        }
        let formatter = NumberFormatter()
        formatter.locale = Locale(identifier: "zh_CN")
        formatter.numberStyle = .decimal
        formatter.minimumFractionDigits = 2
        formatter.maximumFractionDigits = 2
        return "\(formatter.string(from: NSDecimalNumber(decimal: amount / Decimal(100_000_000))) ?? value.rawValue) 亿元"
    }

    @MainActor
    private func loadFutuFinancialHistory() async {
        guard let membership = selectedMembership else { futuFinancialWorkspace.history = nil; return }
        let identity = researchDocumentTaskIdentity
        do {
            let history = try await client.readFutuFinancialHistory(membership: membership)
            guard researchDocumentTaskIdentity == identity else { return }
            futuFinancialWorkspace.history = history
            futuFinancialWorkspace.historyMessage = ""
        } catch {
            guard researchDocumentTaskIdentity == identity else { return }
            futuFinancialWorkspace.history = nil
            futuFinancialWorkspace.historyMessage = "财务历史读取失败；不会沿用旧公司的数值。\(researchDocumentClientMessage(error))"
        }
    }

    @MainActor
    func loadFutuFinancialCaptures() async {
        guard futuFinancialWorkspace.materialReservation.key == nil else { return }
        guard let membership = selectedMembership else {
            futuFinancialWorkspace.clear(researchDocumentTaskIdentity)
            futuFinancialWorkspace.message = "请先选择当前研究公司。"
            return
        }
        let identity = researchDocumentTaskIdentity, revision = UUID()
        futuFinancialWorkspace.revision = revision
        futuFinancialWorkspace.captures = []
        futuFinancialWorkspace.current = nil
        futuFinancialWorkspace.original = nil
        futuFinancialWorkspace.clearMaterial()
        futuFinancialWorkspace.history = nil
        futuFinancialWorkspace.historyMessage = "正在重新读取提供商财务历史。"
        futuFinancialWorkspace.busy = true
        futuFinancialWorkspace.message = "正在读取最近 20 次捕获。"
        defer { if futuFinancialWorkspace.revision == revision { futuFinancialWorkspace.busy = false } }
        do {
            let captures = try await client.listFutuFinancialCaptures(membership: membership)
            guard futuFinancialWorkspace.revision == revision, researchDocumentTaskIdentity == identity else { return }
            futuFinancialWorkspace.captures = captures
            futuFinancialWorkspace.message = captures.isEmpty ? "当前公司尚无富途财报捕获。" : "已读取最近 \(captures.count) 次捕获。"
            await loadFutuFinancialHistory()
        } catch {
            guard futuFinancialWorkspace.revision == revision, researchDocumentTaskIdentity == identity else { return }
            futuFinancialWorkspace.message = "富途列表读取失败；旧内容已清除。\(researchDocumentClientMessage(error))"
            futuFinancialWorkspace.historyMessage = "捕获列表读取失败；旧财务历史已清除。"
        }
    }

    @MainActor
    func openFutuFinancialCapture(_ id: String) async {
        guard let membership = selectedMembership, futuFinancialWorkspace.materialReservation.key == nil else { return }
        let identity = researchDocumentTaskIdentity, revision = UUID()
        futuFinancialWorkspace.revision = revision
        futuFinancialWorkspace.current = nil
        futuFinancialWorkspace.original = nil
        futuFinancialWorkspace.clearMaterial()
        futuFinancialWorkspace.busy = true
        defer { if futuFinancialWorkspace.revision == revision { futuFinancialWorkspace.busy = false } }
        do {
            let capture = try await client.readFutuFinancialCapture(membership: membership, captureId: id)
            guard futuFinancialWorkspace.revision == revision, researchDocumentTaskIdentity == identity else { return }
            futuFinancialWorkspace.current = capture
            futuFinancialWorkspace.message = capture.membershipVersion == membership.version
                ? "已重新读取财报详情。" : "已打开历史记录。"
        } catch {
            guard futuFinancialWorkspace.revision == revision, researchDocumentTaskIdentity == identity else { return }
            futuFinancialWorkspace.message = "捕获详情不可用；旧原件已清除。\(researchDocumentClientMessage(error))"
        }
    }

    @MainActor
    func openFutuFinancialPage(_ id: String) async {
        guard let membership = selectedMembership, let capture = futuFinancialWorkspace.current,
              let page = capture.pages.first(where: { $0.id == id }) else { return }
        let identity = researchDocumentTaskIdentity, revision = UUID()
        futuFinancialWorkspace.revision = revision
        futuFinancialWorkspace.original = nil
        futuFinancialWorkspace.busy = true
        defer { if futuFinancialWorkspace.revision == revision { futuFinancialWorkspace.busy = false } }
        do {
            let original = try await client.readFutuFinancialOriginal(membership: membership, capture: capture, page: page)
            guard futuFinancialWorkspace.revision == revision, researchDocumentTaskIdentity == identity,
                  futuFinancialWorkspace.current?.id == capture.id else { return }
            futuFinancialWorkspace.original = original
            futuFinancialWorkspace.message = "原始页字节和 SHA-256 已核验。"
        } catch {
            guard futuFinancialWorkspace.revision == revision, researchDocumentTaskIdentity == identity else { return }
            futuFinancialWorkspace.original = nil
            futuFinancialWorkspace.message = "原件缺失、损坏或连接不可用；旧原件已清除。\(researchDocumentClientMessage(error))"
        }
    }

    @MainActor
    private func resetFutuAcquisitionForOptions() {
        guard !futuFinancialWorkspace.busy, !futuFinancialWorkspace.acquisition.hasPendingRequest,
              futuFinancialWorkspace.reservation.key == nil else { return }
        futuFinancialWorkspace.acquisition.clear()
        futuFinancialWorkspace.acquisitionMessage = "分页参数已改变；再次开始时先核对已有捕获。"
    }

    @MainActor
    func captureAnnualAndHalfYear() async {
        guard let membership = selectedMembership, membership.state == .tracked,
              !futuFinancialWorkspace.busy, futuFinancialWorkspace.reservation.key == nil,
              futuFinancialWorkspace.materialReservation.key == nil else { return }
        let identity = researchDocumentTaskIdentity
        let pageSize = futuFinancialWorkspace.pageSize, maxPages = futuFinancialWorkspace.maxPagesPerTable
        let fingerprint = "\(identity):\(pageSize):\(maxPages)"
        let revision = UUID()
        futuFinancialWorkspace.acquisition.bind(fingerprint)
        futuFinancialWorkspace.revision = revision
        futuFinancialWorkspace.busy = true
        futuFinancialWorkspace.acquisitionMessage = "正在核对当前公司已存年度与累计半年捕获。"
        var step = "已有捕获读取"
        defer { if futuFinancialWorkspace.revision == revision { futuFinancialWorkspace.busy = false } }
        do {
            if !futuFinancialWorkspace.acquisition.hasPendingRequest {
                let history = try await client.readFutuFinancialHistory(membership: membership)
                guard researchDocumentTaskIdentity == identity, futuFinancialWorkspace.revision == revision else { return }
                futuFinancialWorkspace.history = history
                futuFinancialWorkspace.historyMessage = ""
                futuFinancialWorkspace.acquisition.adoptReadHistory(annualCaptureId: history.annualCaptureId,
                    halfYearCaptureId: history.halfYearCaptureId)
            }
            for selection in ["annual", "half_year"] {
                guard researchDocumentTaskIdentity == identity, futuFinancialWorkspace.revision == revision else { return }
                if futuFinancialWorkspace.acquisition.captureId(for: selection) != nil { continue }
                step = selection == "annual" ? "年度" : "累计半年"
                guard let key = futuFinancialWorkspace.acquisition.reserve(for: selection, fingerprint: fingerprint) else {
                    throw ResearchDocumentClientError.invalidResponse
                }
                futuFinancialWorkspace.acquisitionMessage = "正在取得\(step)三表；其余已回读捕获保留。"
                let saved = try await client.captureFutuFinancialStatements(membership: membership,
                    pageSize: pageSize, maxPagesPerTable: maxPages, idempotencyKey: key, periodSelection: selection)
                guard researchDocumentTaskIdentity == identity, futuFinancialWorkspace.revision == revision else { return }
                guard saved.membershipId == membership.id, saved.membershipVersion == membership.version,
                      saved.symbol == membership.symbol, saved.periodSelection == selection,
                      saved.pageSize == pageSize, saved.maxPagesPerTable == maxPages else {
                    throw ResearchDocumentClientError.invalidResponse
                }
                let readback = try await client.readFutuFinancialCapture(membership: membership, captureId: saved.id)
                guard researchDocumentTaskIdentity == identity, futuFinancialWorkspace.revision == revision else { return }
                guard readback.id == saved.id, readback.membershipId == membership.id,
                      readback.membershipVersion == membership.version, readback.symbol == membership.symbol,
                      readback.periodSelection == selection, readback.pageSize == pageSize,
                      readback.maxPagesPerTable == maxPages else { throw ResearchDocumentClientError.invalidResponse }
                guard futuFinancialWorkspace.acquisition.markReadBack(selection, id: readback.id,
                    fingerprint: fingerprint) else { throw ResearchDocumentClientError.invalidResponse }
                futuFinancialWorkspace.captures.removeAll { $0.id == readback.id }
                futuFinancialWorkspace.captures.insert(readback, at: 0)
                futuFinancialWorkspace.captures = Array(futuFinancialWorkspace.captures.prefix(20))
                futuFinancialWorkspace.current = readback
                futuFinancialWorkspace.original = nil
                futuFinancialWorkspace.clearMaterial()
                futuFinancialWorkspace.acquisitionMessage = "\(step)捕获 #\(readback.id) 已回读；正在核对实际期间覆盖。"
                await loadFutuFinancialHistory()
            }
            guard researchDocumentTaskIdentity == identity, futuFinancialWorkspace.revision == revision else { return }
            futuFinancialWorkspace.acquisitionMessage = "年度与累计半年已有当前公司已存捕获；下方逐期显示原值与缺口。请自行选择期间核对并保存材料。"
        } catch {
            guard researchDocumentTaskIdentity == identity, futuFinancialWorkspace.revision == revision else { return }
            futuFinancialWorkspace.acquisitionMessage = "\(step)未完成；已成功的捕获保留，重试只续未决请求。\(researchDocumentClientMessage(error))"
        }
    }

    @MainActor
    func captureFutuFinancialStatements() async {
        guard let membership = selectedMembership, !futuFinancialWorkspace.busy,
              futuFinancialWorkspace.materialReservation.key == nil else { return }
        let identity = researchDocumentTaskIdentity
        let pageSize = futuFinancialWorkspace.pageSize, maxPages = futuFinancialWorkspace.maxPagesPerTable
        let periodSelection = futuFinancialWorkspace.periodSelection
        let fingerprint = "\(identity):\(pageSize):\(maxPages):\(periodSelection)"
        let key = futuFinancialWorkspace.reservation.reserve(for: fingerprint, prefix: "ios-futu-financial")
        let revision = UUID()
        futuFinancialWorkspace.revision = revision
        futuFinancialWorkspace.current = nil
        futuFinancialWorkspace.original = nil
        futuFinancialWorkspace.busy = true
        futuFinancialWorkspace.message = "正在抓取\(periodSelection == "annual" ? "年度" : "累计半年")三表。"
        defer { if futuFinancialWorkspace.revision == revision { futuFinancialWorkspace.busy = false } }
        do {
            let saved = try await client.captureFutuFinancialStatements(membership: membership,
                pageSize: pageSize, maxPagesPerTable: maxPages, idempotencyKey: key, periodSelection: periodSelection)
            guard futuFinancialWorkspace.revision == revision, researchDocumentTaskIdentity == identity else { return }
            let readback = try await client.readFutuFinancialCapture(membership: membership, captureId: saved.id)
            guard futuFinancialWorkspace.revision == revision, researchDocumentTaskIdentity == identity else { return }
            guard readback.membershipVersion == membership.version, readback.periodSelection == periodSelection else {
                throw ResearchDocumentClientError.invalidResponse
            }
            futuFinancialWorkspace.acquisition.adoptManualReadBack(periodSelection, id: readback.id,
                fingerprint: "\(identity):\(pageSize):\(maxPages)")
            futuFinancialWorkspace.reservation.clear()
            futuFinancialWorkspace.busy = false
            await loadFutuFinancialCaptures()
            if researchDocumentTaskIdentity == identity { await openFutuFinancialCapture(saved.id) }
        } catch {
            guard futuFinancialWorkspace.revision == revision, researchDocumentTaskIdentity == identity else { return }
            futuFinancialWorkspace.message = "抓取或回读失败；重试会沿用本次请求键。\(researchDocumentClientMessage(error))"
        }
    }
}
