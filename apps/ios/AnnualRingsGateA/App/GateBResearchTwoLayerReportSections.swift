import SwiftUI
extension GateBResearchScreen {
    var selectedValuationSourceIncluded: Bool {
        guard let pack = currentTwoLayerReportPack,
              let intent = twoLayerReportWorkspace.draft?.taskIntent else { return true }
        let requiredIds = pack.frozenResearchContext?.selectedValuationMethods?.flatMap { method -> [String] in
            switch method {
            case .provider(let scenario): [scenario.providerBasis.sourceMaterialId]
            case .fcff(let scenario): scenario.historicalOriginals.facts.map(\.materialId)
            }
        } ?? []
        return requiredIds.allSatisfy(intent.selectedMaterialIds.contains)
    }
    var formalMaterialReviewSatisfied: Bool {
#if OWNER_CLIENT
        if !personalFormalMaterialReviewRequired { return true }
        guard let current = currentFormalMaterialReviewBinding,
              twoLayerReportWorkspace.draft?.taskIntent?.selectedMaterialIds.isEmpty == false else { return false }
        return personalFormalMaterialReviewed && personalFormalReviewedMaterialBinding == current
#else
        true
#endif
    }
#if OWNER_CLIENT
    var currentFormalMaterialReviewBinding: String? {
        guard let membership = selectedMembership,
              let pack = twoLayerReportWorkspace.envelope?.data?.latestPack,
              let draft = twoLayerReportWorkspace.draft,
              let intent = draft.taskIntent,
              pack.currentness.status == "current",
              pack.membershipId == membership.id,
              pack.membershipVersion == membership.version,
              pack.symbol == membership.symbol,
              draft.baseRequest.evidencePackBinding.id == pack.id,
              draft.baseRequest.evidencePackBinding.version == pack.version,
              draft.baseRequest.evidencePackBinding.fingerprint == pack.packFingerprint,
              currentTwoLayerReportBindingIdentity == twoLayerReportWorkspace.bindingIdentity else { return nil }
        let selected = intent.selectedMaterialIds
        let sourceCoordinates = personalFormalSources.map { hint in
            ([hint.sourceType, hint.url, hint.pageNumber.map(String.init) ?? "", hint.pageTextSha256]
                + (hint.snapshotCitation?.identityParts ?? ["no_snapshot_citation"]))
                .joined(separator: "\u{0}")
        }.sorted().joined(separator: "\u{1}")
        return [membership.id, String(membership.version), membership.symbol,
                pack.id, String(pack.version), pack.packFingerprint,
                Array(Set(selected)).sorted().joined(separator: ","),
                intent.includeProviderOwnerContext == true ? "owner-context-selected" : "owner-context-excluded",
                intent.selectedResearchContext.map { "\($0.contextId):\($0.contentHash):\($0.selectedFactIds.joined(separator: ",")):\($0.peerIds.joined(separator: ",")):\(($0.peerFactIds ?? []).joined(separator: ","))" } ?? "no-selected-context-items",
                sourceCoordinates,
                personalFormalProviderSources.map { "\($0.captureId):\($0.financialType):\($0.periodEnd):\($0.sourceFingerprint)" }.sorted().joined(separator: ",")].joined(separator: "|")
    }
#endif
    func twoLayerReportSection() -> AnyView {
#if OWNER_CLIENT
        return AnyView(clientReportLibrary())
#else
        let reports = selectedMembershipResearchReports
        let currentReport = currentDeepResearchReport
        return AnyView(VStack(alignment: .leading, spacing: 12) {
            Text("研究报告")
                .font(OwnerReadingFont.headline)
            Text("先看结论，再按需展开证据、风险和历史版本。报告只辅助研究，不会自动交易。")
                .font(OwnerReadingFont.caption)
                .foregroundStyle(.secondary)
            deepResearchJourneyStatus(currentReport: currentReport)
            latestResearchChanges(for: currentReport)
#if OWNER_CLIENT
            DisclosureGroup("AI 使用设置") { cloudAiPolicyControls() }
                .font(OwnerReadingFont.subheadline)
#else
            cloudAiPolicyControls()
#endif

            if twoLayerReportWorkspace.draft != nil,
               twoLayerReportWorkspace.pendingSynthesisTask == nil,
               !twoLayerReportWorkspace.isStaleRead {
                twoLayerEditableDraftSection()
            }

            if !reports.isEmpty {
                crossStockReportComparison(reports)
                ForEach(reports.filter(\.isCurrentExact)) { report in
                    twoLayerReportCard(report, previousReport: reports.previousReport(before: report))
                }
                let historicalReports = reports.filter { !$0.isCurrentExact }
                if !historicalReports.isEmpty {
                    DisclosureGroup("历史报告（\(historicalReports.count)）", isExpanded: $isHistoricalReportsExpanded) {
                        VStack(alignment: .leading, spacing: 10) {
                            ForEach(historicalReports) { report in
                                twoLayerReportCard(report, previousReport: reports.previousReport(before: report))
                            }
                        }
                        .padding(.top, 8)
                    }
                }
                reportVersionComparison(reports)
            } else {
                Text("暂无可显示的研究报告。")
                    .font(OwnerReadingFont.callout)
                    .foregroundStyle(.secondary)
            }

            if let deletions = twoLayerReportWorkspace.envelope?.data?.reportDeletions,
               !deletions.isEmpty {
                DisclosureGroup("已删除报告凭证（\(deletions.count)）") {
                    VStack(alignment: .leading, spacing: 6) {
                        ForEach(deletions) { deletion in
                            Text("report #\(deletion.reportId) v\(deletion.reportVersion) · 删除于 \(deletion.deletedAt) · SHA-256 \(deletion.reportFingerprint)")
                                .font(OwnerReadingFont.caption.monospaced())
                                .textSelection(.enabled)
                                .accessibilityIdentifier("twoLayerReportDeletion-\(deletion.reportId)")
                        }
                        Text("正文已从当前界面和 AI 上下文移除；旧网盘历史版本仍可能含已删除内容。")
                            .font(OwnerReadingFont.caption)
                            .foregroundStyle(.secondary)
                    }
                    .padding(.top, 6)
                }
                .accessibilityIdentifier("twoLayerReportDeletionHistory")
            }

            DisclosureGroup("报告管理") {
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        Button {
                            createTwoLayerDraft()
                        } label: {
                            Label("准备深度研究", systemImage: "sparkles")
                        }
                        .buttonStyle(.bordered)
                        .disabled(
                            twoLayerReportWorkspace.isBusy
                                || twoLayerReportWorkspace.hasActiveSynthesisTask
                                || twoLayerReportWorkspace.isStaleRead
                                || currentTwoLayerReportPack?.currentness.status != "current"
                        )
                        .id("createTwoLayerReportDraftButton")
                        Button {
                            Task { await loadTwoLayerReports() }
                        } label: {
                            Label("刷新", systemImage: "arrow.clockwise")
                        }
                        .buttonStyle(.bordered)
                        .disabled(
                            twoLayerReportWorkspace.isBusy
                                || twoLayerReportWorkspace.hasActiveSynthesisTask
                        )
                    }
                    Text(twoLayerReportWorkspace.message)
                        .font(OwnerReadingFont.caption)
                        .foregroundStyle(.secondary)
                        .accessibilityIdentifier("twoLayerReportMessage")
                }
                .padding(.top, 8)
            }
        }
        .padding(12)
        .background(
            Color(.secondarySystemGroupedBackground),
            in: RoundedRectangle(cornerRadius: 8)
        )
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("twoLayerReportWorkspace")
        .disabled(isRefreshingResearchTechnicalEvidence)
        .task(id: deepResearchForegroundRefreshIdentity) {
            await refreshDeepResearchTaskWhileVisible()
        }
        )
#endif
    }

    func twoLayerEditableDraftSection() -> AnyView {
        AnyView(VStack(alignment: .leading, spacing: 10) {
            Text("确认本次深度研究")
                .font(OwnerReadingFont.caption.weight(.bold))
                .foregroundStyle(.orange)
            Text("只有点击开始才会创建任务。问题、期限、材料范围、语言与冻结版本会一起锁定；改变它们会创建新任务。")
                .font(OwnerReadingFont.caption)
                .foregroundStyle(.secondary)

            if let draft = twoLayerReportWorkspace.draft,
               let intent = draft.taskIntent,
               let pack = currentTwoLayerReportPack {
                TextField(
                    "本次研究要回答的问题",
                    text: deepResearchIntentBinding(\.researchQuestion)
                )
                .textFieldStyle(.roundedBorder)
                .accessibilityIdentifier("deepResearchQuestionInput")
                Picker("研究期限", selection: deepResearchIntentBinding(\.investmentHorizon)) {
                    Text("长期").tag("long_term")
                    Text("中期").tag("medium_term")
                    Text("事件驱动").tag("event_driven")
                }
                .pickerStyle(.segmented)
                .accessibilityIdentifier("deepResearchHorizonPicker")
                Picker("输出语言", selection: deepResearchIntentBinding(\.outputLanguage)) {
                    Text("简体中文").tag("zh-Hans")
                    Text("English").tag("en")
                }
                .pickerStyle(.segmented)
                .accessibilityIdentifier("deepResearchLanguagePicker")
                Picker("输出预算", selection: deepResearchIntentBinding(\.maxOutputTokens, fallback: 8000)) {
                    Text("精简 · 1000").tag(1000)
                    Text("标准 · 2000").tag(2000)
                    Text("完整 · 4000").tag(4000)
                    Text("完整报告 · 8000").tag(8000)
                }
                .pickerStyle(.segmented)
                .accessibilityIdentifier("deepResearchOutputBudgetPicker")
                Text("完整结构化报告建议使用 8000 输出预算；较低预算可能耗尽于模型推理或导致输出截断，失败后可调整预算重新准备。")
                    .font(OwnerReadingFont.caption2).foregroundStyle(.secondary)
                Picker("时间上限", selection: deepResearchIntentBinding(\.maxDurationSeconds, fallback: 60)) {
                    Text("15 秒").tag(15)
                    Text("30 秒").tag(30)
                    Text("60 秒").tag(60)
                }
                .pickerStyle(.segmented)
                .accessibilityIdentifier("deepResearchDurationBudgetPicker")

#if OWNER_CLIENT
                if personalFormalMaterialReviewRequired {
                    Text(personalFormalSourceMessage ?? "请核对下方正式材料范围。")
                        .font(OwnerReadingFont.caption).foregroundStyle(.secondary)
                    ForEach(Array(personalFormalSources.enumerated()), id: \.offset) { _, hint in
                        let count = personalFormalMatchingMaterials(hint, pack: pack).count
                        VStack(alignment: .leading, spacing: 3) {
                            Text("原始来源 · \(hint.pageNumber.map { "第\($0)页" } ?? "网页正文") · \(count == 1 ? "已唯一匹配" : count == 0 ? "未匹配" : "匹配多项")")
                                .font(OwnerReadingFont.caption.weight(.semibold))
                            Text(hint.url).font(OwnerReadingFont.caption2)
                                .lineLimit(2).textSelection(.enabled)
                        }
                    }
                    ForEach(Array(personalFormalProviderSources.enumerated()), id: \.offset) { _, hint in
                        Text("OpenD 捕获 #\(hint.captureId) · \(hint.periodEnd) \(hint.financialType) · 第三方未核实材料")
                            .font(OwnerReadingFont.caption)
                    }
                    Toggle("我已核对本次正式材料范围", isOn: Binding(
                        get: {
                            guard let current = currentFormalMaterialReviewBinding else { return false }
                            return personalFormalMaterialReviewed && personalFormalReviewedMaterialBinding == current
                        },
                        set: { confirmed in
                            personalFormalMaterialReviewed = confirmed
                            personalFormalReviewedMaterialBinding = confirmed ? currentFormalMaterialReviewBinding : nil
                        }
                    ))
                        .accessibilityIdentifier("formalResearchMaterialReviewed")
                }
#endif
                let selectedMaterialCount = intent.selectedMaterialIds.count
                if !selectedValuationSourceIncluded {
                    Text("本次未选齐 PE 或 FCFF 情景引用的原件材料。请勾选对应材料，或重新准备匹配所选材料的估值与研究包；当前不会创建任务。")
                        .font(OwnerReadingFont.caption).foregroundStyle(.orange)
                }
                DisclosureGroup("选择本次发送的材料（\(selectedMaterialCount)/\(pack.items.count)）", isExpanded: $personalFormalMaterialListExpanded) {
                    VStack(alignment: .leading, spacing: 8) {
                        ForEach(pack.items) { material in
                            VStack(alignment: .leading, spacing: 5) {
                                Toggle(isOn: deepResearchMaterialBinding(material.id, pack: pack)) {
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(material.title).font(OwnerReadingFont.caption.weight(.semibold))
                                        if material.sourceType == "owner_ocr_correction_note" {
                                            Text("人工 OCR 校对备注 · 未核验 · 不是原 PDF 文字或发行人事实")
                                                .font(OwnerReadingFont.caption2).foregroundStyle(.orange)
                                            Text(material.contentText).font(OwnerReadingFont.caption2)
                                                .lineLimit(3)
                                        }
                                        if material.sourceType == "owner_prior_judgment_note" {
                                            Text("历史人工判断摘录 · 未核实 · 仅供背景，不代表当前事实或生效决定")
                                                .font(OwnerReadingFont.caption2).foregroundStyle(.orange)
                                        }
                                        Text(material.summary).font(OwnerReadingFont.caption2).foregroundStyle(.secondary)
                                    }
                                }
                                .disabled(pack.materialSelectionMode == "explicit")
                                DisclosureGroup("核对保存正文与来源") {
                                    VStack(alignment: .leading, spacing: 6) {
                                        if researchDocumentSha256(Data(material.contentText.utf8)) != material.contentFingerprint {
                                            Text("保存正文与指纹不一致；请重新读取材料后再确认输入。")
                                                .foregroundStyle(.orange)
                                        }
                                        Text(material.contentText)
                                            .font(OwnerReadingFont.caption)
                                            .textSelection(.enabled)
                                        Text("来源：\(material.sourceType) · \(material.sourceUrl ?? "无外部链接") · 版本：\(material.sourceVersion)")
                                        Text("资料日期：\(material.publishedAt ?? "未提供") · 捕获：\(material.capturedAt) · 有效至：\(material.validUntil)")
                                        if let source = material.futuFinancialSource {
                                            Text("财报期间截至：\(source.periodEnd) · \(source.financialType)")
                                        } else {
                                            Text("结构化财务期间：来源记录未单列；请按保存正文与原件核对。")
                                        }
                                        if let citation = material.citation {
                                            Text("原件第 \(citation.pageNumber) 页 · 文件 #\(citation.documentId)")
                                        }
                                        Text("核验：\(material.verificationStatus) · 声明：\(material.claimType) · 新鲜度：\(material.freshness) · 修订：\(material.revisionState)")
                                    }
                                    .font(OwnerReadingFont.caption2)
                                    .foregroundStyle(.secondary)
                                    .textSelection(.enabled)
                                    .padding(.top, 4)
                                }
                                .font(OwnerReadingFont.caption2)
                            }
                        }
                    }
                    .padding(.top, 6)
                }
                Text("展开的是已保存正文，供人工核对。材料按勾选的摘要及结构化字段发送；已选 OpenD 原值另按下方清单带入，前报告与监控规则按本页单独选择。不会发送整份 PDF。")
                    .font(OwnerReadingFont.caption).foregroundStyle(.secondary)
                if pack.materialSelectionMode == "explicit" {
                    Text("本次材料已在冻结前确认。如需调整，请重新准备有限研究。")
                        .font(OwnerReadingFont.caption).foregroundStyle(.secondary)
                }
                if pack.researchMode == "limited" {
                    DisclosureGroup("逐项选择本次带入的档案事实、同行理由和同行事实") {
                        Button("读取当前档案") {
                            if let membership = selectedMembership { Task { await loadResearchContext(for: membership) } }
                        }
                        if let membership = selectedMembership,
                           researchContextWorkspace.binding == ResearchContextMembershipBinding(membership),
                           let envelope = researchContextWorkspace.envelope,
                           envelope.status == .available,
                           let context = envelope.data,
                           let contentHash = envelope.contentHash,
                           context.membershipId == pack.membershipId,
                           context.membershipVersion == pack.membershipVersion,
                           context.selectedSymbol == pack.symbol,
                           context.currentness.status == "current",
                           context.cutoffAt <= pack.frozenAt {
                            Text("当前档案 #\(context.id) · SHA-256 \(contentHash)；以下项目默认均不发送。")
                                .font(OwnerReadingFont.caption2).textSelection(.enabled)
                            ForEach(context.selectedFacts) { fact in
                                Toggle(isOn: selectedResearchContextItemBinding(
                                    fact.id, isPeer: false, context: context, contentHash: contentHash)) {
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text("档案事实 · \(fact.metric)：\(fact.value ?? "UNKNOWN") \(fact.unit) · 币种 \(fact.currency ?? "未提供") · 测量期间 \(fact.periodStart ?? "时点") 至 \(fact.periodEnd ?? "旧档案未明确") · 资料记录日期 \(fact.asOf)")
                                        Text("\(fact.symbol) · 资料捕获 \(fact.provenance.capturedAt) · 截止 \(fact.cutoffAt) · \(fact.citation.sourceLabel) · 来源版 \(fact.citation.sourceVersion)")
                                            .font(OwnerReadingFont.caption2).foregroundStyle(.secondary)
                                    }
                                }
                            }
                            ForEach(context.peers) { peer in
                                let sourceIssue = envelope.peerSourceIssues?.first { $0.peerId == peer.id }
                                Toggle(isOn: selectedResearchContextItemBinding(
                                    peer.id, isPeer: true, context: context, contentHash: contentHash)) {
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text("同行\(peer.status == "included" ? "纳入" : "排除")理由 · \(peer.name)（\(peer.symbol)）")
                                        Text(peer.reason).textSelection(.enabled)
                                        Text("Owner 研究观点，未经独立核实 · 资料捕获 \(peer.provenance.capturedAt) · \(peer.citation.sourceLabel) · 来源版 \(peer.citation.sourceVersion)")
                                            .font(OwnerReadingFont.caption2).foregroundStyle(.secondary)
                                    }
                                }
                                .disabled(sourceIssue != nil)
                                if let sourceIssue {
                                    Text(sourceIssue.explanation)
                                        .font(OwnerReadingFont.caption2).foregroundStyle(.orange)
                                    Button("移除本次发送中的失效同行引用") {
                                        selectedResearchContextItemBinding(peer.id, isPeer: true,
                                            context: context, contentHash: contentHash).wrappedValue = false
                                    }
                                }
                            }
                            ForEach(context.peerFacts) { fact in
                                let sourceMember = fact.citation.sourceMembership
                                let sourceIssue = envelope.peerFactSourceIssues?.first { $0.factId == fact.id }
                                let memberAvailable = (sourceMember == nil || sourceMember?.symbol == fact.symbol)
                                    && context.peers.contains { peer in
                                        peer.symbol == fact.symbol && peer.status == "included"
                                            && envelope.peerSourceIssues?.contains(where: { $0.peerId == peer.id }) != true
                                    }
                                    && sourceIssue == nil
                                Toggle(isOn: selectedResearchContextItemBinding(
                                    fact.id, isPeer: false, isPeerFact: true,
                                    context: context, contentHash: contentHash)) {
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text("同行事实 · \(fact.symbol) · \(fact.metric)：\(fact.value ?? "UNKNOWN") \(fact.unit) \(fact.currency ?? "") · 测量期间 \(fact.periodStart ?? "时点") 至 \(fact.periodEnd ?? "未明确")")
                                        Text("来源 \(fact.citation.sourceLabel) · 捕获 \(fact.provenance.capturedAt) · 截止 \(fact.cutoffAt) · \(fact.provenance.classification)")
                                            .font(OwnerReadingFont.caption2).foregroundStyle(.secondary)
                                    }
                                }.disabled(!memberAvailable)
                                if !memberAvailable {
                                    Text(sourceIssue?.explanation
                                        ?? "这家公司不在当前纳入名单或来源身份已变化；本次不能选择这条事实。")
                                        .font(OwnerReadingFont.caption2).foregroundStyle(.orange)
                                }
                            }
                        } else {
                            Text("先读取与当前 membership 一致的有效档案；未读取或已变化时不发送档案条目。")
                                .font(OwnerReadingFont.caption).foregroundStyle(.secondary)
                        }
                    }
                    if let selected = intent.selectedResearchContext {
                        Text("本次额外发送档案事实 \(selected.selectedFactIds.count) 条、同行理由 \(selected.peerIds.count) 条、同行事实 \(selected.peerFactIds?.count ?? 0) 条；只发送勾选项目及确切来源。")
                            .font(OwnerReadingFont.caption).textSelection(.enabled)
                    }
                    let selectedProvider = pack.items.filter { material in
                        intent.selectedMaterialIds.contains(material.id) && material.futuFinancialSource != nil
                    }
                    Text("有限研究仅使用你明确勾选的材料。下面显示已选 OpenD 材料的原值文本及来源指纹；后端准备输入时会重新读取同一原件。")
                        .font(OwnerReadingFont.caption).foregroundStyle(.secondary)
                    ForEach(selectedProvider) { material in
                        DisclosureGroup("已选 OpenD 原值 · \(material.futuFinancialSource?.periodEnd ?? "")") {
                            if researchDocumentSha256(Data(material.contentText.utf8)) == material.contentFingerprint {
                                Text(material.contentText).font(OwnerReadingFont.caption).textSelection(.enabled)
                                Text("材料指纹 \(material.contentFingerprint) · 来源指纹 \(material.futuFinancialSource?.sourceFingerprint ?? "UNKNOWN")")
                                    .font(OwnerReadingFont.caption2).textSelection(.enabled)
                            } else {
                                Text("已选材料文本与指纹不一致；请重新读取后再准备研究。")
                                    .font(OwnerReadingFont.caption).foregroundStyle(.orange)
                            }
                        }
                    }
                    Toggle("同时带入已有 KPI、Owner 假设、反证与问题", isOn: Binding(
                        get: { twoLayerReportWorkspace.draft?.taskIntent?.includeProviderOwnerContext == true },
                        set: { enabled in
                            guard var updated = twoLayerReportWorkspace.draft?.taskIntent else { return }
                            updated.includeProviderOwnerContext = enabled ? true : nil
                            updated.confirmProviderAuthorization(false)
                            twoLayerReportWorkspace.draft?.taskIntent = updated
#if OWNER_CLIENT
                            personalFormalMaterialReviewed = false
                            personalFormalReviewedMaterialBinding = nil
#endif
                        }
                    ))
                    .disabled(selectedProvider.isEmpty
                        || frozenResearchEvidenceWorkspace.envelope?.data?.providerOperatingReference?.ownerContext == nil)
                    Text("可选上下文必须属于当前公司且在证据截止前；若读取不到，准备研究时会明确报错，不会代入旧版本。")
                        .font(OwnerReadingFont.caption2).foregroundStyle(.secondary)
                }
                if pack.researchMode == "limited" {
                    let available = (researchValuationScenarioWorkspace.envelope?.providerScenarioSets ?? []).filter { scenario in
                        scenario.recomputable && scenario.scenarioState == "current" && scenario.createdAt <= pack.frozenAt
                            && scenario.membershipId == pack.membershipId && scenario.membershipVersionAtWrite == pack.membershipVersion
                            && pack.items.contains(where: { item in item.id == scenario.providerBasis.sourceMaterialId })
                    }
                    DisclosureGroup("选择提供商估值情景（最多 2 个）") {
                        if available.isEmpty {
                            Text("当前冻结材料中没有可用的已保存情景。先保存情景，再重新冻结有限研究证据。")
                                .font(OwnerReadingFont.caption).foregroundStyle(.secondary)
                        }
                        ForEach(available) { scenario in
                            Toggle("情景 #\(scenario.id) · EPS \(scenario.providerBasis.eps.rawValue) \(scenario.providerBasis.eps.currencyCode)/股 · 五年 PE 参考 \(String(format: "%.3f", scenario.providerBasis.valuation.historicalAverage))",
                                isOn: deepResearchProviderScenarioBinding(scenario, pack: pack))
                        }
                        Text("只有明确选中的 Owner 情景进入本次有限研究模型输入；它不补齐发行人财务事实或完整研究门槛。")
                            .font(OwnerReadingFont.caption).foregroundStyle(.secondary)
                    }
                    let fcffAvailable = (researchValuationScenarioWorkspace.envelope?.providerFcffScenarioSets ?? [])
                        .filter { scenario in
                            scenario.recomputable && scenario.scenarioState == "current"
                                && scenario.createdAt <= pack.frozenAt
                                && scenario.membershipId == pack.membershipId
                                && scenario.membershipVersionAtWrite == pack.membershipVersion
                                && pack.items.contains(where: {
                                    $0.id == scenario.providerReference.materialId
                                        && $0.revision == scenario.providerReference.materialRevision
                                        && $0.contentFingerprint == scenario.providerReference.materialFingerprint
                                })
                                && (scenario.providerReference.shareReference.map { share in
                                    [share.issuedMaterialId, share.treasuryMaterialId].allSatisfy { id in
                                        pack.items.contains(where: { $0.id == id })
                                    }
                                } ?? true)
                        }
                    DisclosureGroup("选择 OpenD 参考 FCFF 情景（最多 1 个）") {
                        if fcffAvailable.isEmpty {
                            Text("尚无可引用的已保存 FCFF 情景；已选 OpenD 余额原页仍可作为带缺口参考进入受限研究。")
                                .font(OwnerReadingFont.caption).foregroundStyle(.secondary)
                        }
                        ForEach(fcffAvailable) { scenario in
                            Toggle("FCFF #\(scenario.id) · 余额 \(scenario.providerReference.balanceReferenceDate) · 股数 \(scenario.providerReference.shareReferenceDate ?? "个人假设") · \(scenario.calculation.currency)",
                                isOn: deepResearchProviderFcffBinding(scenario, pack: pack))
                                .disabled(twoLayerReportWorkspace.draft?.taskIntent.map { intent in
                                    !intent.selectedMaterialIds.contains(scenario.providerReference.materialId)
                                        || (scenario.providerReference.shareReference.map { share in
                                            !intent.selectedMaterialIds.contains(share.issuedMaterialId)
                                                || !intent.selectedMaterialIds.contains(share.treasuryMaterialId)
                                        } ?? false)
                                } ?? true)
                        }
                        Text("先在材料范围勾选余额原页，以及情景实际引用的股数原文，再选择情景。")
                            .font(OwnerReadingFont.caption).foregroundStyle(.secondary)
                    }
                }
                DisclosureGroup("结构化证据范围") {
                    VStack(alignment: .leading, spacing: 8) {
                        deepResearchSectionToggle("fundamentals", label: "基本面事实")
                        deepResearchSectionToggle("research_context", label: "行业、同业与宏观上下文")
                        deepResearchSectionToggle("events", label: "公告与事件")
                        deepResearchSectionToggle("operating_monitor", label: "经营监控")
                    }
                    .padding(.top, 6)
                }
                InfoBlock(title: "标的与 membership", value: "\(pack.symbol) · membership #\(pack.membershipId) v\(pack.membershipVersion)")
                InfoBlock(title: "冻结证据", value: "pack #\(pack.id) v\(pack.version) · sha256:\(pack.packFingerprint) · cutoff=\(intent.cutoffAt)")
                if let report = latestEligiblePriorReport,
                   let reference = DeepResearchTaskIntent.eligiblePriorReport(report, for: pack,
                       decision: twoLayerReportWorkspace.envelope?.data?.userDecision) {
                    Toggle("带入最新合格前报告的历史摘要", isOn: deepResearchPriorReportBinding(reference))
                        .font(OwnerReadingFont.caption.weight(.semibold))
                        .accessibilityIdentifier("deepResearchPriorReportToggle")
                    Text("前版结论：\(report.payload.investmentThesis)")
                        .font(OwnerReadingFont.caption).textSelection(.enabled)
                    Text("保存于 \(report.createdAt) · 证据截止 \(report.payload.cutoffAt) · 状态 \(report.status)")
                        .font(OwnerReadingFont.caption2).foregroundStyle(.secondary)
                    Text("历史报告 #\(report.id) v\(report.version) · pack #\(report.evidencePackId) · SHA-256 \(report.reportFingerprint)")
                        .font(OwnerReadingFont.caption2).foregroundStyle(.secondary).textSelection(.enabled)
                    Text("前版仅作历史判断上下文；本次事实仍以当前冻结证据为准。关闭后，本次研究不带入前版报告。")
                        .font(OwnerReadingFont.caption2).foregroundStyle(.secondary)
                } else {
                    Text("最新报告没有可带入的合格历史摘要；本次可不带前版继续准备。")
                        .font(OwnerReadingFont.caption).foregroundStyle(.secondary)
                }
                if !selectedPriorReportIsEligible {
                    Text("先前选择的报告已不符合当前身份或可用条件；请清除前版选择并重新确认发送范围。")
                        .font(OwnerReadingFont.caption).foregroundStyle(.orange)
                    Button("不带前版继续") { clearDeepResearchPriorReport() }
                        .buttonStyle(.bordered)
                }
                InfoBlock(
                    title: "前报告",
                    value: intent.priorReport.map { "#\($0.id) v\($0.version) · sha256:\($0.reportFingerprint)" } ?? "无"
                )
                InfoBlock(title: "本次发送的监控规则", value: (intent.monitorRules ?? []).isEmpty ? "无" : intent.monitorRules!.map { "\($0.enabled ? "启用" : "停用") · \($0.variableName) · \($0.category) · \($0.source) · \($0.cadence) · 阈值：\($0.threshold) · 理由：\($0.reason)" }.joined(separator: "\n"))
                InfoBlock(title: "模型输入", value: pack.researchMode == "limited"
                    ? "只发送明确勾选的材料摘要；已选 OpenD 材料另带原值、期间、币种、单位和原件指纹。KPI／Owner 假设等上下文须单独打开开关；档案事实与同行理由须逐项勾选，同行理由为未核实研究观点。整份 PDF、凭证与账户资产事实不发送。"
                    : "只发送所选结构化事实、材料摘要与上列 Owner 已确认监控规则；整份 PDF 正文不发送；凭证、账户和资产事实不发送。")
                InfoBlock(
                    title: "服务、政策与预算",
                    value: deepResearchServicePolicy(intent)
                )
                Toggle("我确认按上述清单把所选内容发送给 DeepSeek", isOn: deepResearchProviderAuthorizationBinding())
                    .font(OwnerReadingFont.caption.weight(.semibold))
                    .disabled(cloudAiPolicy?.isEnabled != true)
                    .accessibilityIdentifier("deepResearchProviderAuthorizationToggle")
                if let context = pack.frozenResearchContext {
                  DisclosureGroup("本次综合使用的证据版本") {
                    VStack(alignment: .leading, spacing: 8) {
                        InfoBlock(
                            title: "只读估值绑定",
                            value: context.selectedValuationMethods.map { methods in methods.map { method in
                                switch method {
                                case .provider(let provider): return "OpenD PE · #\(provider.id) r\(provider.revision) · EPS/PE原件 \(provider.providerBasis.eps.rawSha256)/\(provider.providerBasis.valuation.rawSha256) · 币种 \(provider.assumptions.values.metricCurrency)"
                                case .fcff(let fcff): return "FCFF · #\(fcff.id) r\(fcff.revision) · 截止 \(fcff.calculation.valuationCutoff) · 币种 \(fcff.calculation.currency)"
                                }
                            }.joined(separator: "\n") } ?? context.valuationScenario.map { "scenario=\($0.id) r\($0.revision) · currency=\($0.assumptions.values.metricCurrency ?? "UNKNOWN") · numericAssumptions=8 · calculation=\($0.calculation.method.calculationVersion)" } ?? "UNKNOWN",
                            valueIdentifier: "twoLayerDraftValuationBinding"
                        )
                        InfoBlock(
                            title: "只读技术绑定",
                            value: "snapshot=\(context.technical.dailyBars.snapshot?.snapshotSha ?? "UNKNOWN") · result=\(context.technical.technical.resultHash ?? "UNKNOWN") · cutoff=\(context.technical.dailyBars.source.dataCutoffAt ?? "UNKNOWN") · adjustment=\(context.technical.dailyBars.request.adjustment) · formula=\(context.technical.technical.computationVersion)",
                            valueIdentifier: "twoLayerDraftTechnicalBinding"
                        )
                    }
                    .padding(.top, 6)
                  }
                }
            }
            HStack {
                Button("取消") {
                    twoLayerReportWorkspace.draft = nil
                    twoLayerReportWorkspace.saveReservation.clear()
                    twoLayerReportWorkspace.message = "本次尚未创建任务。"
#if OWNER_CLIENT
                    personalFormalMaterialReviewRequired = false
                    personalFormalMaterialReviewed = false
                    personalFormalReviewedMaterialBinding = nil
                    personalFormalSourceMessage = nil
                    personalFormalSources = []
                    personalFormalProviderSources = []
#endif
                }
                .buttonStyle(.bordered)
                .accessibilityIdentifier("cancelDeepResearchConfirmationButton")
                Spacer()
                Button {
                    Task { await saveTwoLayerDraft() }
                } label: {
                    Label(
                        twoLayerReportWorkspace.requests.isSaving
                            ? "正在开始并核对" : "明确开始深度研究",
                        systemImage: "sparkles"
                    )
                }
                .buttonStyle(.borderedProminent)
                .disabled(
                    twoLayerReportWorkspace.isBusy
                        || twoLayerReportWorkspace.draft?.taskIntent?.validates(
                            binding: twoLayerReportWorkspace.draft!.baseRequest.evidencePackBinding
                        ) != true
                        || twoLayerReportWorkspace.draft?.taskIntent?.hasExactProviderAuthorization != true
                        || (currentTwoLayerReportPack?.researchMode == "limited"
                            && twoLayerReportWorkspace.draft?.taskIntent?.selectedMaterialIds.isEmpty != false)
                        || cloudAiPolicy?.isEnabled != true
                        || !selectedPriorReportIsEligible
                        || !formalMaterialReviewSatisfied
                        || !selectedValuationSourceIncluded
                )
                .accessibilityIdentifier("saveTwoLayerReportButton")
            }
        }
        .padding(10)
        .id("twoLayerResearchConfirmation")
        .background(Color.orange.opacity(0.08), in: RoundedRectangle(cornerRadius: 8))
        )
    }

    private func deepResearchIntentBinding(
        _ keyPath: WritableKeyPath<DeepResearchTaskIntent, String>
    ) -> Binding<String> {
        Binding(
            get: { twoLayerReportWorkspace.draft?.taskIntent?[keyPath: keyPath] ?? "" },
            set: { value in twoLayerReportWorkspace.draft?.taskIntent?[keyPath: keyPath] = value }
        )
    }

    private func deepResearchIntentBinding(
        _ keyPath: WritableKeyPath<DeepResearchTaskIntent, Int?>,
        fallback: Int
    ) -> Binding<Int> {
        Binding(
            get: { twoLayerReportWorkspace.draft?.taskIntent?[keyPath: keyPath] ?? fallback },
            set: { value in twoLayerReportWorkspace.draft?.taskIntent?[keyPath: keyPath] = value }
        )
    }

    private func deepResearchServicePolicy(_ intent: DeepResearchTaskIntent) -> String {
        let tokens = intent.maxOutputTokens ?? 8000
        let seconds = intent.maxDurationSeconds ?? 60
        let outputCost = Double(tokens) * 1.2 / 1_000_000
        let formattedCost = String(format: "%.5f", outputCost)
        return "DeepSeek V4.1 Flash / deepseek-flash · 输出上限 \(tokens) tokens（按峰时价保守估算最多约 US$\(formattedCost)，输入另计）· 最长 \(seconds) 秒 · 数据在中国处理 · 保留期限不固定 · 输入可能用于模型改进，当前账号 opt-out 未核验，因此不承诺 no-training · 无备用供应商或静默切换"
    }

    @ViewBuilder
    func cloudAiPolicyControls() -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(cloudAiPolicyMessage)
                .font(OwnerReadingFont.caption)
                .foregroundStyle(cloudAiPolicy?.isEnabled == true ? .green : .orange)
                .accessibilityIdentifier("cloudAiPolicyStatus")
            Toggle("我选择初版不使用备用 AI 提供方；DeepSeek 不可用时保持失败，不静默切换", isOn: $cloudAiNoBackupConfirmed)
                .disabled(isLoadingCloudAiPolicy || cloudAiPolicy?.isEnabled == true
                    || cloudAiPolicy?.status != "available"
                    || cloudAiPolicy?.state?.deletionRequest.status == "requested_unconfirmed")
                .accessibilityIdentifier("confirmNoBackupAiProvider")
            HStack {
                Button("确认并启用") { Task { await decideCloudAiPolicy(.enable) } }
                    .disabled(isLoadingCloudAiPolicy || cloudAiPolicy?.isEnabled == true
                        || cloudAiPolicy?.status != "available"
                        || !cloudAiNoBackupConfirmed
                        || cloudAiPolicy?.state?.deletionRequest.status == "requested_unconfirmed")
                    .accessibilityIdentifier("enableCloudAiButton")
                Button("停用") { Task { await decideCloudAiPolicy(.disable) } }
                    .disabled(isLoadingCloudAiPolicy || cloudAiPolicy?.isEnabled != true)
                    .accessibilityIdentifier("disableCloudAiButton")
                Button("请求删除") { Task { await decideCloudAiPolicy(.requestDeletion) } }
                    .disabled(isLoadingCloudAiPolicy || cloudAiPolicy?.state?.deletionRequest.status == "requested_unconfirmed")
                    .accessibilityIdentifier("requestCloudAiDeletionButton")
            }
            .buttonStyle(.bordered)
            HStack {
                Link("隐私政策", destination: URL(string: "https://cdn.deepseek.com/policies/en-US/deepseek-privacy-policy.html?locale=en_US")!)
                Link("价格说明", destination: URL(string: "https://api-docs.deepseek.com/quick_start/pricing/")!)
            }
            .font(OwnerReadingFont.caption)
            Text("删除请求只记录为 requested_unconfirmed；本 App 不会冒充提供方已删除。联系 redacted@example.invalid。")
                .font(OwnerReadingFont.caption2)
                .foregroundStyle(.secondary)
        }
    }

    private func deepResearchMaterialBinding(
        _ id: String,
        pack: FrozenResearchEvidencePack
    ) -> Binding<Bool> {
        Binding(
            get: {
                guard let selected = twoLayerReportWorkspace.draft?.taskIntent?.selectedMaterialIds else { return false }
                return selected.contains(id)
            },
            set: { enabled in
                guard pack.materialSelectionMode != "explicit",
                      var intent = twoLayerReportWorkspace.draft?.taskIntent else { return }
                if enabled { intent.selectedMaterialIds.append(id) }
                else { intent.selectedMaterialIds.removeAll { $0 == id } }
                if intent.selectedMaterialIds.isEmpty && pack.researchMode != "limited" && !personalFormalMaterialReviewRequired { return }
                intent.selectedMaterialIds = Array(Set(intent.selectedMaterialIds)).sorted { Int($0)! < Int($1)! }
                let chosen = intent.selectedMaterialIds
                intent.selectedProviderScenarioIds = intent.selectedProviderScenarioIds?.filter { scenarioId in
                    researchValuationScenarioWorkspace.envelope?.providerScenarioSets?.contains(where: {
                        $0.id == scenarioId && chosen.contains($0.providerBasis.sourceMaterialId)
                    }) == true
                }
                intent.selectedProviderFcffScenarioIds = intent.selectedProviderFcffScenarioIds?.filter { scenarioId in
                    researchValuationScenarioWorkspace.envelope?.providerFcffScenarioSets?.contains(where: {
                        $0.id == scenarioId && chosen.contains($0.providerReference.materialId)
                            && ($0.providerReference.shareReference.map { share in
                                chosen.contains(share.issuedMaterialId) && chosen.contains(share.treasuryMaterialId)
                            } ?? true)
                    }) == true
                }
                if !pack.items.contains(where: { chosen.contains($0.id) && $0.futuFinancialSource != nil }) {
                    intent.includeProviderOwnerContext = nil
                }
                intent.confirmProviderAuthorization(false)
                twoLayerReportWorkspace.draft?.taskIntent = intent
#if OWNER_CLIENT
                if personalFormalMaterialReviewRequired {
                    personalFormalMaterialReviewed = false
                    personalFormalReviewedMaterialBinding = nil
                }
#endif
            }
        )
    }

    private func deepResearchProviderScenarioBinding(_ scenario: ResearchProviderValuationScenarioSetData,
        pack: FrozenResearchEvidencePack) -> Binding<Bool> {
        Binding(get: { twoLayerReportWorkspace.draft?.taskIntent?.selectedProviderScenarioIds?.contains(scenario.id) == true },
            set: { enabled in
                guard var intent = twoLayerReportWorkspace.draft?.taskIntent,
                    intent.selectedMaterialIds.contains(scenario.providerBasis.sourceMaterialId),
                    pack.items.contains(where: { $0.id == scenario.providerBasis.sourceMaterialId }) else { return }
                var ids = intent.selectedProviderScenarioIds ?? []
                if enabled && !ids.contains(scenario.id) && ids.count < 2 { ids.append(scenario.id) }
                if !enabled { ids.removeAll { $0 == scenario.id } }
                intent.selectedProviderScenarioIds = ids.sorted { Int($0)! < Int($1)! }
                intent.confirmProviderAuthorization(false)
                twoLayerReportWorkspace.draft?.taskIntent = intent
            })
    }

    private func deepResearchProviderFcffBinding(_ scenario: ResearchProviderFcffScenarioSetData,
        pack: FrozenResearchEvidencePack) -> Binding<Bool> {
        Binding(get: {
            twoLayerReportWorkspace.draft?.taskIntent?.selectedProviderFcffScenarioIds?.contains(scenario.id) == true
        }, set: { enabled in
            guard var intent = twoLayerReportWorkspace.draft?.taskIntent,
                  intent.selectedMaterialIds.contains(scenario.providerReference.materialId),
                  pack.items.contains(where: { $0.id == scenario.providerReference.materialId }),
                  scenario.providerReference.shareReference.map({ share in
                      intent.selectedMaterialIds.contains(share.issuedMaterialId)
                          && intent.selectedMaterialIds.contains(share.treasuryMaterialId)
                  }) ?? true else { return }
            intent.selectedProviderFcffScenarioIds = enabled ? [scenario.id] : []
            intent.confirmProviderAuthorization(false)
            twoLayerReportWorkspace.draft?.taskIntent = intent
        })
    }

    private func selectedResearchContextItemBinding(_ id: String, isPeer: Bool, isPeerFact: Bool = false,
        context: ResearchContextData, contentHash: String) -> Binding<Bool> {
        Binding(get: {
            guard let selection = twoLayerReportWorkspace.draft?.taskIntent?.selectedResearchContext,
                  selection.contextId == context.id, selection.contentHash == contentHash else { return false }
            return isPeer ? selection.peerIds.contains(id)
                : isPeerFact ? selection.peerFactIds?.contains(id) == true : selection.selectedFactIds.contains(id)
        }, set: { enabled in
            guard var intent = twoLayerReportWorkspace.draft?.taskIntent else { return }
            var selection = intent.selectedResearchContext.flatMap {
                $0.contextId == context.id && $0.contentHash == contentHash ? $0 : nil
            } ?? DeepResearchTaskIntent.SelectedResearchContext(
                contextId: context.id, contentHash: contentHash, selectedFactIds: [], peerIds: [])
            if isPeer {
                if enabled { selection.peerIds.append(id) } else { selection.peerIds.removeAll { $0 == id } }
                selection.peerIds = Array(Set(selection.peerIds)).sorted { Int($0)! < Int($1)! }
            } else if isPeerFact {
                var ids = selection.peerFactIds ?? []
                if enabled { ids.append(id) } else { ids.removeAll { $0 == id } }
                ids = Array(Set(ids)).sorted { Int($0)! < Int($1)! }
                selection.peerFactIds = ids.isEmpty ? nil : ids
            } else {
                if enabled { selection.selectedFactIds.append(id) }
                else { selection.selectedFactIds.removeAll { $0 == id } }
                selection.selectedFactIds = Array(Set(selection.selectedFactIds)).sorted { Int($0)! < Int($1)! }
            }
            intent.selectedResearchContext = selection.selectedFactIds.isEmpty && selection.peerIds.isEmpty
                && selection.peerFactIds == nil ? nil : selection
            intent.confirmProviderAuthorization(false)
            twoLayerReportWorkspace.draft?.taskIntent = intent
#if OWNER_CLIENT
            personalFormalMaterialReviewed = false
            personalFormalReviewedMaterialBinding = nil
#endif
        })
    }

    private func deepResearchProviderAuthorizationBinding() -> Binding<Bool> {
        Binding(
            get: { twoLayerReportWorkspace.draft?.taskIntent?.hasExactProviderAuthorization == true },
            set: { confirmed in
                twoLayerReportWorkspace.draft?.taskIntent?.confirmProviderAuthorization(confirmed)
            }
        )
    }

    private func deepResearchPriorReportBinding(_ reference: DeepResearchTaskIntent.PriorReport) -> Binding<Bool> {
        Binding(get: { twoLayerReportWorkspace.draft?.taskIntent?.priorReport == reference },
            set: { enabled in
                guard var intent = twoLayerReportWorkspace.draft?.taskIntent else { return }
                if enabled {
                    guard let pack = currentTwoLayerReportPack,
                          let report = latestEligiblePriorReport,
                          DeepResearchTaskIntent.eligiblePriorReport(report, for: pack,
                              decision: twoLayerReportWorkspace.envelope?.data?.userDecision) == reference else { return }
                }
                intent.priorReport = enabled ? reference : nil
                intent.confirmProviderAuthorization(false)
                twoLayerReportWorkspace.draft?.taskIntent = intent
            })
    }

    private func clearDeepResearchPriorReport() {
        guard var intent = twoLayerReportWorkspace.draft?.taskIntent else { return }
        intent.priorReport = nil
        intent.confirmProviderAuthorization(false)
        twoLayerReportWorkspace.draft?.taskIntent = intent
    }

    private func deepResearchSectionToggle(_ section: String, label: String) -> some View {
        Toggle(isOn: Binding(
            get: { twoLayerReportWorkspace.draft?.taskIntent?.includedStructuredSections.contains(section) == true },
            set: { enabled in
                guard var intent = twoLayerReportWorkspace.draft?.taskIntent else { return }
                if enabled { intent.includedStructuredSections.append(section) }
                else { intent.includedStructuredSections.removeAll { $0 == section } }
                let order = ["fundamentals", "research_context", "events", "operating_monitor"]
                intent.includedStructuredSections = order.filter(intent.includedStructuredSections.contains)
                if section == "research_context" && !enabled { intent.selectedResearchContext = nil }
                intent.confirmProviderAuthorization(false)
                twoLayerReportWorkspace.draft?.taskIntent = intent
            }
        )) { Text(label).font(OwnerReadingFont.caption) }
    }

    func twoLayerReportCard(_ report: TwoLayerReportData, previousReport: TwoLayerReportData?) -> AnyView {
        let decision = twoLayerReportWorkspace.envelope?.data?.decisions.first(
            where: { $0.reportId == report.id }
        )
        let reportPack = twoLayerReportWorkspace.envelope?.data?.evidencePacks
            .first(where: { $0.id == report.evidencePackId })
        let invalidationText = (
            report.currentness.invalidatedBy
                + report.currentness.evidencePackInvalidatedBy
        ).joined(separator: ", ")
        let lifecycle = report.lifecycleState(decision: decision)
        let completenessAllowsConfirmation = researchContextWorkspace.completeness?.data?.canFormalize == true
        return AnyView(ScrollViewReader { proxy in
          VStack(alignment: .leading, spacing: 20) {
            HStack {
                Text(report.isCurrentExact ? "当前深度研究 · #\(report.id) · v\(report.version)" : "历史报告 · #\(report.id) · v\(report.version)")
                    .font(Font.title3)
                Spacer()
                Text(reportLifecycleLabel(lifecycle, decision: decision))
                    .font(Font.footnote.weight(.bold))
                    .foregroundStyle(reportLifecycleColor(lifecycle))
                    .accessibilityIdentifier("twoLayerReportLifecycle-\(report.id)")
            }

            Text(decision?.decision == "rejected"
                 ? "当前报告已被你驳回；请先修订，再重新确认。"
                 : reportPresentationText(report, invalidationText: invalidationText))
                .font(Font.footnote.weight(.semibold))
                .foregroundStyle(decision?.decision == "rejected" ? .orange : report.isFormalizable ? .green : .orange)
            if decision?.decision == "rejected",
               let note = decision?.note,
               !note.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                Text("驳回原因：\(note)")
                    .font(Font.footnote)
                    .foregroundStyle(.orange)
            }

            if report.payload.adviceLayer != nil && report.payload.researchLayer != nil {
                Menu {
                    ForEach(["结论", "成立条件", "失效条件", "研究正文与依据", "风险", "待核实与下一步"], id: \.self) { section in
                        Button(section) { withAnimation { proxy.scrollTo("report:\(report.id):\(section)", anchor: .top) } }
                    }
                } label: { Label("报告目录", systemImage: "list.bullet").frame(minHeight: 44) }
            }
            if let advice = report.payload.adviceLayer,
               let research = report.payload.researchLayer {
                Group {
                    Text("结论").font(Font.headline).id("report:\(report.id):结论")
                    Text(advice.conclusion).font(.body).lineSpacing(6).textSelection(.enabled)
                        .accessibilityIdentifier("twoLayerReportConclusion-\(report.id)")
                    Text("信心：\(confidenceLabel(advice.confidence)) · 适用至 \(advice.applicableUntil.prefix(10))")
                        .font(Font.footnote)
                    deepResearchReviewSummary(research)
                    VStack(alignment: .leading, spacing: 16) {
                        VStack(alignment: .leading, spacing: 8) {
                            Text(advice.horizonStatement)
                                .font(Font.footnote)
                                .foregroundStyle(.secondary)
                            Text("成立条件").font(Font.headline).id("report:\(report.id):成立条件")
                            reportConditions("长期", advice.longTerm.conditions)
                            reportConditions("中短期", advice.mediumShortTerm.conditions)
                            Text("失效条件").font(Font.headline).id("report:\(report.id):失效条件")
                            reportConditions("长期", advice.longTerm.invalidationConditions)
                            reportConditions("中短期", advice.mediumShortTerm.invalidationConditions)
                            reportConditions("下一验证", report.payload.nextValidationQuestions)
                            Text("证据截止：\(report.payload.cutoffAt)")
                                .font(Font.footnote.monospaced())
                                .foregroundStyle(.secondary)
                            reportView("长期", advice.longTerm)
                            reportView("中短期", advice.mediumShortTerm)
                            Text("长短期关系：\(advice.conflict.description)")
                                .font(Font.footnote)
                        }
                        .padding(.top, 6)
                    }
                }
            } else {
                Text("历史内容：仅供查看，不会自动升级，也不能正式采用。")
                    .font(Font.footnote)
                    .foregroundStyle(.orange)
            }

            if let research = report.payload.researchLayer {
                VStack(alignment: .leading, spacing: 20) {
                    Text("研究正文与依据").font(.title3.bold()).id("report:\(report.id):研究正文与依据")
                    VStack(alignment: .leading, spacing: 8) {
                        if let pack = reportPack, pack.frozenResearchContext?.valuationScenario != nil {
                            Button {
                                Task { await openFrozenResearchEvidenceSource(pack) }
                            } label: {
                                Label("核对估值原始依据", systemImage: "doc.richtext")
                            }
                            .buttonStyle(.bordered)
                        }
                        deepResearchEvidenceSections(report, research, pack: reportPack)
                    }
                    .padding(.top, 6)
                }
            }
            if report.isCurrentExact {
                OwnerReportActions {
                    VStack(alignment: .leading, spacing: 8) {
                    Text("继续操作")
                        .font(Font.headline)
                    Text("追问 → 修正 → 确认报告 → 正式决定 → 跟踪 / 复盘")
                        .font(Font.footnote)
                        .foregroundStyle(.secondary)
                    DailyResponsiveActionGroup {
#if OWNER_CLIENT
                        NavigationLink {
                            ClientReadingPage(title: "向这份报告追问") { researchEvidenceQuestionSection() }
                        } label: { Label("追问报告", systemImage: "text.bubble") }
                        .disabled(currentResearchEvidenceQuestionReport?.id != report.id)
                        .accessibilityIdentifier("twoLayerReportAskQuestion-\(report.id)")
#else
                        Button {
                            isTwoLayerReportFieldFocused = true
                            pendingDecisionWorkspaceScrollTarget = "researchEvidenceQuestionSection"
                        } label: {
                            Label("追问报告", systemImage: "text.bubble")
                        }
                        .buttonStyle(.bordered)
                        .disabled(currentResearchEvidenceQuestionReport?.id != report.id)
                        .accessibilityIdentifier("twoLayerReportAskQuestion-\(report.id)")
#endif
                        twoLayerReportRevisionAction(for: report)
                    }

                    if let decision {
                        if decision.decision == "confirmed" {
                            Text("报告已于 \(decision.decidedAt.prefix(10)) 由你确认；确认报告不等于正式决定。")
                                .font(Font.footnote.weight(.semibold))
                            researchReportFormalDecisionAdoptionControl(report: report, decision: decision, pack: reportPack)
                        } else {
                            Text("报告已于 \(decision.decidedAt.prefix(10)) 被你驳回；请先修订报告，不能进入正式决定。")
                                .font(Font.footnote.weight(.semibold))
                                .foregroundStyle(.orange)
                        }
                    } else if report.isFormalizable {
                        TextField(
                            "驳回原因（驳回时必填）",
                            text: $twoLayerReportRejectionReason,
                            axis: .vertical
                        )
                        .textFieldStyle(.roundedBorder)
                        .accessibilityIdentifier("twoLayerReportRejectionReason-\(report.id)")
                        if !completenessAllowsConfirmation {
                            Text("报告正文已完成，但研究覆盖尚未达到确认门槛；你仍可驳回报告，确认前请先补齐并重新记录覆盖。")
                                .font(Font.footnote)
                                .foregroundStyle(.orange)
                            Button("查看研究覆盖缺口") {
                                selectedEvidenceWorkspace = .facts
                                pendingDecisionWorkspaceScrollTarget = "researchContextCompletionSection"
                            }
                            .buttonStyle(.borderedProminent)
                            .accessibilityIdentifier("twoLayerReportOpenCompleteness-\(report.id)")
                        }
                        DailyResponsiveActionGroup {
                            if completenessAllowsConfirmation,
                               todayReportConfirmationReservation(for: report) == nil {
                                Button("明确确认报告") {
                                    Task { await decideTwoLayerReport(report, decision: "confirmed") }
                                }
                                .buttonStyle(.borderedProminent)
                                .accessibilityIdentifier("todayReportConfirmButton")
                            }
                            Button("明确驳回报告") {
                                Task {
                                    await decideTwoLayerReport(
                                        report,
                                        decision: "rejected",
                                        note: twoLayerReportRejectionReason
                                    )
                                }
                            }
                            .buttonStyle(.bordered)
                            .disabled(
                                twoLayerReportRejectionReason.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                                    || twoLayerReportRejectionReason.count > 4_000
                            )
                        }
                    }
                    researchReportFormalDecisionSubmissionControl(report: report)
                }
                .padding(10)
                .background(Color.accentColor.opacity(0.08), in: RoundedRectangle(cornerRadius: 8))
                .disabled(twoLayerReportWorkspace.isBusy || twoLayerReportWorkspace.isStaleRead)
                .id("\(twoLayerReportFormalDecisionAnchor(report.id)):actions")
                }
            }

            DisclosureGroup("版本与审计信息") {
                VStack(alignment: .leading, spacing: 6) {
                    Text("report #\(report.id) v\(report.version) · contract=\(report.contractVersion) · fingerprint=\(report.reportFingerprint)")
                        .font(OwnerReadingFont.caption.monospaced())
                        .textSelection(.enabled)
                    if let snapshot = report.payload.snapshotBinding {
                        Text("synthesis snapshot=\(snapshot.snapshotId) · cutoff=\(snapshot.cutoffAt)")
                            .font(OwnerReadingFont.caption.monospaced())
                            .textSelection(.enabled)
                    }
                    if let reproducibility = report.payload.reproducibility {
                        Text("provider=\(reproducibility.provider) · model=\(reproducibility.model) · prompt=\(reproducibility.prompt) · tokens=\(reproducibility.tokenUsage) · cost=\(reproducibility.cost)")
                            .font(OwnerReadingFont.caption.monospaced())
                            .textSelection(.enabled)
                    }
                    if let manifest = report.payload.sendManifest {
                        Text("实际发送：\(manifest.selectedMaterialIds.count) 份材料 [\(manifest.selectedMaterialIds.joined(separator: ", "))] · 结构化分区 \(manifest.includedStructuredSections.joined(separator: "/"))")
                            .font(OwnerReadingFont.caption.monospaced()).textSelection(.enabled)
                            .accessibilityIdentifier("twoLayerReportSendManifest-\(report.id)")
                        Text("本地准备时间：\(manifest.preparedAt ?? "UNKNOWN")").font(OwnerReadingFont.caption.monospaced()).textSelection(.enabled)
                        Text("字段：\(manifest.payloadFields.joined(separator: ", ")) · source bindings=\(manifest.sourceBindingCount) · policy=\(manifest.policyVersion) · request SHA=\(manifest.requestBodySha256)")
                            .font(OwnerReadingFont.caption.monospaced()).textSelection(.enabled)
                        Text(manifest.policySnapshot?.sendManifestSummary ?? "历史发送未固化地区、保留与训练条款。")
                            .font(OwnerReadingFont.caption).textSelection(.enabled)
                        Text(manifest.sendAuthorization?.sendAuthorizationSummary ?? "历史发送未固化发送时 Owner 授权状态。")
                            .font(OwnerReadingFont.caption).textSelection(.enabled)
                        if let input = manifest.inputTokenUpperBound,
                           let output = manifest.maxOutputTokens,
                           let cost = manifest.estimatedMaxCostUsd,
                           let pricing = manifest.pricingIdentity {
                            Text("发送前成本上界：输入 ≤\(input) + 输出 ≤\(output) tokens · 最多约 US$\(String(format: "%.8f", cost)) · \(pricing)")
                                .font(OwnerReadingFont.caption.monospaced()).textSelection(.enabled)
                        }
                        Text("安全清单：full PDF=\(manifest.fullPdfSent) · credentials=\(manifest.credentialsSent) · official assets=\(manifest.officialAssetFactsSent)")
                            .font(OwnerReadingFont.caption.monospaced()).textSelection(.enabled)
                    } else if report.contractVersion == deepResearchSynthesisReportContractVersion {
                        Text("实际发送清单：历史报告未记录，保持 UNKNOWN。")
                            .font(OwnerReadingFont.caption).foregroundStyle(.secondary)
                    }
                    if let reportPack {
                        Text("pack #\(reportPack.id) v\(reportPack.version) · frozen=\(reportPack.frozenAt) · fingerprint=\(reportPack.packFingerprint)")
                            .font(OwnerReadingFont.caption.monospaced())
                            .textSelection(.enabled)
                        if let technical = reportPack.frozenResearchContext?.technical {
                            Text("snapshot=\(technical.dailyBars.snapshot?.snapshotSha ?? "UNKNOWN") · result=\(technical.technical.resultHash ?? "UNKNOWN") · cutoff=\(technical.dailyBars.source.dataCutoffAt ?? "UNKNOWN")")
                                .font(OwnerReadingFont.caption.monospaced())
                                .textSelection(.enabled)
                        }
                        if let quant = report.payload.evidencePackBinding?.quantPortfolio {
                            Text("quant=\(quant.decision.refinementId ?? quant.decision.status) · portfolio=\(quant.portfolio.evidenceId ?? quant.portfolio.status) · universe=\(quant.portfolio.hkConnectUniverse?.snapshotId ?? quant.decision.hkConnectUniverse?.snapshotId ?? "UNKNOWN")")
                                .font(OwnerReadingFont.caption.monospaced())
                                .textSelection(.enabled)
                                .accessibilityIdentifier("twoLayerReportQuantPortfolio-\(report.id)")
                        }
                    }
                    Text("status=\(report.status) · gateFailures=\(report.gateFailures.isEmpty ? "none" : report.gateFailures.joined(separator: "；"))")
                        .font(OwnerReadingFont.caption)
                    ResearchReportRevisionSummaryView(summary: report.revisionSummary(previous: previousReport))
                }
                .padding(.top, 6)
            }
            Button(role: .destructive) {
                Task { await deleteTwoLayerReport(report) }
            } label: {
                Label(
                    twoLayerReportWorkspace.pendingDeletionReportId == report.id
                        ? "再次确认删除报告正文" : "删除报告正文",
                    systemImage: "trash"
                )
            }
            .buttonStyle(.bordered)
            .disabled(twoLayerReportWorkspace.isBusy || twoLayerReportWorkspace.isStaleRead)
            .accessibilityIdentifier("deleteTwoLayerReport-\(report.id)")
        }
        .modifier(OwnerReportSurface())
        .id(twoLayerReportFormalDecisionAnchor(report.id))
        .accessibilityIdentifier("twoLayerReport-\(report.id)")
        })
    }

    @ViewBuilder
    func reportVersionComparison(_ reports: [TwoLayerReportData]) -> some View {
        if reports.count > 1 {
            let ordered = reports.sorted { $0.version > $1.version }
            let firstDefault = ordered.dropFirst().first?.id ?? ordered.last!.id
            let secondDefault = ordered.first!.id
            let firstBinding = Binding(
                get: { comparedReportFirstId ?? firstDefault },
                set: { comparedReportFirstId = $0 }
            )
            let secondBinding = Binding(
                get: { comparedReportSecondId ?? secondDefault },
                set: { comparedReportSecondId = $0 }
            )
            DisclosureGroup("比较报告版本") {
                VStack(alignment: .leading, spacing: 8) {
                    Picker("版本一", selection: firstBinding) {
                        ForEach(ordered) { report in
                            Text("v\(report.version) · #\(report.id)").tag(report.id)
                        }
                    }
                    Picker("版本二", selection: secondBinding) {
                        ForEach(ordered) { report in
                            Text("v\(report.version) · #\(report.id)").tag(report.id)
                        }
                    }
                    if let summary = reports.revisionSummary(
                        between: firstBinding.wrappedValue,
                        and: secondBinding.wrappedValue
                    ) {
                        ResearchReportRevisionSummaryView(summary: summary)
                    } else {
                        Text("请选择两个不同的不可变报告版本。")
                            .font(OwnerReadingFont.caption)
                            .foregroundStyle(.secondary)
                    }
                    Text("这里只比较当前股票的已读取版本，不混合 cutoff，不生成新结论。")
                        .font(OwnerReadingFont.caption2)
                        .foregroundStyle(.secondary)
                }
                .padding(.top, 6)
            }
            .accessibilityIdentifier("twoLayerReportVersionComparison")
        }
    }

    private func reportLifecycleColor(_ lifecycle: ResearchReportLifecycleState) -> Color {
        switch lifecycle {
        case .confirmed: .green
        case .completePendingConfirmation: .blue
        case .evidenceInsufficient, .rejected: .orange
        case .historical: .secondary
        }
    }

    private func reportLifecycleLabel(
        _ lifecycle: ResearchReportLifecycleState,
        decision: TwoLayerReportDecision?
    ) -> String {
        guard lifecycle == .historical else { return lifecycle.label }
        if decision?.decision == "confirmed" { return "历史版本 · 曾确认" }
        if decision?.decision == "rejected" { return "历史版本 · 曾驳回" }
        return lifecycle.label
    }

    private func reportEvidenceIds(for report: TwoLayerReportData?) -> Set<String> {
        guard let report else { return [] }
        let research = report.payload.researchLayer
        let facts = report.payload.factTable
            + (research?.fundamentals ?? [])
            + (research?.context ?? [])
            + (research?.valuation ?? [])
            + (research?.technical ?? [])
            + (research?.quantPortfolio ?? [])
            + (research?.eventsAndCatalysts ?? [])
            + (research?.operatingMonitor ?? [])
            + (research?.risks ?? [])
            + (research?.counterevidence ?? [])
            + (research?.unknowns ?? [])
        return Set(
            report.payload.supportEvidenceIds
                + report.payload.counterEvidenceIds
                + facts.flatMap(\.evidenceIds)
                + facts.compactMap { $0.citation?.evidenceId }
                + (research?.sourceConflicts.flatMap(\.evidenceIds) ?? [])
        )
    }

    @ViewBuilder
    private func latestResearchChanges(for report: TwoLayerReportData?) -> some View {
        let items = todayResearch.items.filter {
            $0.category == .researchChange
                && $0.trackingState == .needsReview
                && $0.bindings.eventRefs.contains { $0.coverageScope == "research_stock" }
        }
        if todayResearch.status == .available,
           todayResearch.membershipId == selectedMembership?.id,
           todayResearch.membershipVersion == selectedMembership?.version,
           todayResearch.requestedSymbol == selectedMembership?.symbol,
           !items.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                Text("最新变化")
                    .font(OwnerReadingFont.subheadline.weight(.semibold))
                ForEach(items) { item in
                    if let event = item.bindings.eventRefs.first(where: { $0.coverageScope == "research_stock" }) {
                        let material = item.bindings.factRefs.first
                        let evidenceIds = Set(item.bindings.factRefs.map(\.evidenceId))
                        let isInReport = !evidenceIds.isDisjoint(with: reportEvidenceIds(for: report))
                        VStack(alignment: .leading, spacing: 4) {
                            Text(item.title)
                                .font(OwnerReadingFont.callout.weight(.semibold))
                            Text(TodayMaterialChangePresentation.summary(item.summary))
                                .font(OwnerReadingFont.callout)
                            Text("来源：\(TodayMaterialChangePresentation.sourceLabel(material?.sourceType ?? "research_events")) · 发布 \((material?.publishedAt ?? "未提供").prefix(10))")
                            Text("对论点影响：\(TodayMaterialChangePresentation.impactLabel(event.hypothesisImpact))")
                            Text(isInReport ? "当前报告已引用这条变化" : "当前报告尚未引用这条变化")
                        }
                        .font(OwnerReadingFont.caption)
                        .foregroundStyle(.secondary)
                        .id("twoLayerReportLatestChange-\(event.eventId)")
                        .accessibilityElement(children: .combine)
                        .accessibilityIdentifier("twoLayerReportLatestChange-\(event.eventId)")
                    }
                }
                Button {
                    if let report {
                        Task { await beginTwoLayerReportRevision(report) }
                    } else {
                        selectedEvidenceWorkspace = .frozen
                    }
                } label: {
                    Label(
                        report == nil ? "查看变化并冻结新证据" : "复核变化并修订报告",
                        systemImage: report == nil ? "snowflake" : "arrow.triangle.2.circlepath.doc.on.clipboard"
                    )
                }
                .buttonStyle(.bordered)
                .disabled(twoLayerReportWorkspace.isBusy || twoLayerReportWorkspace.isStaleRead)
                .accessibilityIdentifier("twoLayerReportReviseForLatestChanges-\(report?.id ?? "unbound")")
            }
            .padding(8)
            .background(Color.orange.opacity(0.08), in: RoundedRectangle(cornerRadius: 8))
            .id("twoLayerReportLatestChanges")
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("twoLayerReportLatestChanges-\(report?.id ?? "unbound")")
        }
    }

    private func reportView(_ title: String, _ view: TwoLayerReportView) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("\(title)观点").font(OwnerReadingFont.caption.weight(.semibold))
            Text(view.view).font(OwnerReadingFont.caption)
            reportConditions("主要风险", view.risks)
        }
        .padding(8)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 8))
    }

    @ViewBuilder
    private func reportConditions(_ title: String, _ values: [String]) -> some View {
        if values.isEmpty {
            Text("\(title)：暂未提供")
                .font(OwnerReadingFont.caption)
                .foregroundStyle(.secondary)
        } else {
            Text("\(title)：\(values.joined(separator: "；"))")
                .font(OwnerReadingFont.caption)
        }
    }

    private func confidenceLabel(_ confidence: String) -> String {
        switch confidence {
        case "high": "高"
        case "medium": "中"
        case "low": "低"
        default: "待判断"
        }
    }

    private func reportPresentationText(
        _ report: TwoLayerReportData,
        invalidationText: String
    ) -> String {
        switch report.presentationState {
        case .historical:
            return invalidationText.isEmpty
                ? "此版本已不适用于当前研究，仅供历史回看，不能进入正式决定。"
                : "资料、研究上下文或报告版本已变化；此版本仅供历史回看，具体原因可在诊断信息中查看。"
        case .currentIncomplete:
            return "当前结论仍不完整；请补充对应证据后修订，暂不能确认或驳回。"
        case .formalizable:
            return "结论与证据检查已通过；等待你明确确认或驳回。"
        }
    }

    @ViewBuilder
    private func deepResearchEvidenceSections(
        _ report: TwoLayerReportData,
        _ research: TwoLayerResearch,
        pack: FrozenResearchEvidencePack?
    ) -> some View {
        VStack(alignment: .leading, spacing: 24) {
            VStack(alignment: .leading, spacing: 12) {
                reportFacts("基本面", research.fundamentals, report: report, pack: pack)
                    .padding(.top, 6)
            }
            VStack(alignment: .leading, spacing: 12) {
                if let context = research.context, !context.isEmpty {
                    reportFacts("行业与同业", context, report: report, pack: pack)
                        .padding(.top, 6)
                } else {
                    Text("该报告未绑定行业与同业上下文。")
                        .font(OwnerReadingFont.caption)
                        .foregroundStyle(.secondary)
                        .padding(.top, 6)
                }
            }
            VStack(alignment: .leading, spacing: 12) {
                reportFacts("估值", research.valuation, report: report, pack: pack)
                    .padding(.top, 6)
            }
            VStack(alignment: .leading, spacing: 12) {
                reportFacts("技术", research.technical, report: report, pack: pack)
                    .padding(.top, 6)
            }
            VStack(alignment: .leading, spacing: 12) {
                if let quant = research.quantPortfolio, !quant.isEmpty {
                    reportFacts("量化与组合风险", quant, report: report, pack: pack)
                        .padding(.top, 6)
                } else {
                    Text("该历史报告未绑定版本化量化与组合风险证据，保持 UNKNOWN。")
                        .font(OwnerReadingFont.caption)
                        .foregroundStyle(.secondary)
                        .padding(.top, 6)
                }
            }
            VStack(alignment: .leading, spacing: 12) {
                reportFacts(
                    "事件与催化剂",
                    research.eventsAndCatalysts + (research.operatingMonitor ?? []),
                    report: report,
                    pack: pack
                )
                    .padding(.top, 6)
            }
            VStack(alignment: .leading, spacing: 12) {
                reportFacts("风险", research.risks, report: report, pack: pack)
                    .padding(.top, 6)
            }
            VStack(alignment: .leading, spacing: 12) {
                reportFacts("反证", research.counterevidence, report: report, pack: pack)
                    .padding(.top, 6)
            }
            VStack(alignment: .leading, spacing: 12) {
                Text("待核实与下一步").font(.headline).id("report:\(report.id):待核实与下一步")
                deepResearchUnknowns(research)
                    .padding(.top, 6)
            }
        }
    }

    @ViewBuilder
    private func deepResearchUnknowns(_ research: TwoLayerResearch) -> some View {
        let unknowns = research.unknowns.map(\.statement)
        VStack(alignment: .leading, spacing: 4) {
            if unknowns.isEmpty {
                Text("当前没有额外待核实项。")
                    .font(OwnerReadingFont.caption)
                    .foregroundStyle(.secondary)
            } else {
                ForEach(unknowns.indices, id: \.self) { index in
                    Text("• \(unknowns[index])").font(OwnerReadingFont.caption)
                }
            }
            if !research.nextValidationQuestions.isEmpty {
                Text("下一步核实：\(research.nextValidationQuestions.joined(separator: "；"))")
                    .font(OwnerReadingFont.caption)
            }
        }
    }

    private func reportFacts(
        _ title: String,
        _ facts: [TwoLayerReportFact],
        report: TwoLayerReportData,
        pack: FrozenResearchEvidencePack?
    ) -> some View {
        let availableFacts = facts.filter { $0.sourceKind != "source_missing" }
        return VStack(alignment: .leading, spacing: 12) {
            Text(title).font(.headline).id("report:\(report.id):\(title)")
            if availableFacts.isEmpty {
                Text("当前没有可用的\(title)资料。")
                    .font(OwnerReadingFont.caption)
                    .foregroundStyle(.secondary)
            }
            ForEach(availableFacts.indices, id: \.self) { index in
                let fact = availableFacts[index]
                Text(fact.statement)
                    .font(.body).lineSpacing(6).textSelection(.enabled)
                Text((report.contractVersion == deepResearchSynthesisReportContractVersion ? "AI归纳与分析 · " : "") + reportFactSourceLabel(fact))
                    .font(OwnerReadingFont.caption2)
                    .foregroundStyle(.secondary)
                if let pack {
                    ForEach(pack.reopenableMaterials(for: fact)) { material in
                        Button {
                            Task {
                                await openTwoLayerMaterialCitation(
                                    report: report,
                                    pack: pack,
                                    material: material
                                )
                            }
                        } label: {
                            Label(
                                material.snapshotCitation != nil
                                    ? "打开已存网页原件 · 选段"
                                    : "打开原始材料 · 第 \(material.citation?.pageNumber ?? 0) 页",
                                systemImage: "doc.text.magnifyingglass"
                            )
                        }
                        .buttonStyle(.bordered)
                    }
                    twoLayerExternalSourceButton(pack: pack, fact: fact)
                }
                if let citation = fact.citation?.reopenableDocumentCitation {
                    Button("打开研究快照引用 · 第 \(citation.pageNumber) 页") {
                        Task {
                            if pack?.researchMode == "limited" && fact.sourceKind == "research_context" {
                                await openSelectedContextReportCitation(report: report, fact: fact, citation: citation)
                            } else {
                                await openResearchContextCitation(citation)
                            }
                        }
                    }
                    .buttonStyle(.bordered)
                }
                if let (citation, original) = fact.citation?.reopenableSnapshotCitation {
                    Button("打开研究快照网页原件 · 选段") {
                        Task { _ = await openStoredSourceCitation(citation, original: original) }
                    }.buttonStyle(.bordered)
                }
                if let citation = fact.citation?.reopenablePeerOriginalCitation {
                    Button(citation.sourceType == "issuer_public_html"
                           ? "打开报告引用的同行网页原件 · 选段"
                           : "打开报告引用的同行 OpenD 原始页 · 第三方未核实") {
                        Task {
                            await openSelectedContextPeerOriginal(report: report, fact: fact,
                                citation: citation)
                        }
                    }.buttonStyle(.bordered)
                }
            }
        }
    }

}
