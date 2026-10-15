import SwiftUI

extension GateBResearchScreen {
    @ViewBuilder
    func crossStockReportComparison(_ currentReports: [TwoLayerReportData]) -> some View {
        let exactCurrentReports = currentReports.filter(\.isImmutableExact)
        let otherMemberships = candidateMemberships.memberships.filter {
            $0.actorId == selectedMembership?.actorId
                && $0.symbol != selectedMembership?.symbol
                && $0.state != .archived
        }
        Text("可暂不选择，保留现金，先核实关键条件；本比较不生成交易信号，也不改动任何组合或现金事实。")
            .font(.caption)
            .foregroundStyle(.secondary)
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityIdentifier("crossStockCashAlternative")
        if !otherMemberships.isEmpty, !currentReports.isEmpty, exactCurrentReports.isEmpty {
            Text("跨股票比较暂不可用：当前股票没有可验证 fingerprint 与证据包绑定的报告。")
                .font(.caption)
                .foregroundStyle(.orange)
                .accessibilityIdentifier("crossStockReportComparisonUnavailable")
        }
        if !otherMemberships.isEmpty, !exactCurrentReports.isEmpty {
            DisclosureGroup {
                VStack(alignment: .leading, spacing: 8) {
                    Picker("对比股票", selection: Binding(
                        get: { comparedMembershipId ?? "" },
                        set: {
                            comparedMembershipId = $0
                            comparedExternalWorkspace = nil
                            comparedExternalReportId = nil
                            comparedCurrentCrossStockReportId = nil
                            comparedExternalMessage = "股票已变化，请明确读取对应报告。"
                        }
                    )) {
                        Text("请选择").tag("")
                        ForEach(otherMemberships) { membership in
                            Text("\(membership.symbol) · \(membership.research.name ?? "未命名")")
                                .tag(membership.id)
                        }
                    }
                    .accessibilityIdentifier("crossStockMembershipPicker")
                    Button(isLoadingComparedExternalReports ? "正在读取" : "读取对比股票报告") {
                        Task { await loadComparedExternalReports() }
                    }
                    .buttonStyle(.bordered)
                    .disabled(isLoadingComparedExternalReports || (comparedMembershipId ?? "").isEmpty)
                    .accessibilityIdentifier("loadComparedStockReportsButton")
                    Text(comparedExternalMessage)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    if let external = comparedExternalWorkspace?.data,
                       let target = otherMemberships.first(where: { $0.id == comparedMembershipId }) {
                        let exactExternalReports = external.reports.filter(\.isImmutableExact)
                        if !exactExternalReports.isEmpty {
                            let currentId = exactCurrentReports.first(where: {
                                $0.id == comparedCurrentCrossStockReportId
                            })?.id ?? exactCurrentReports[0].id
                            let externalId = exactExternalReports.first(where: {
                                $0.id == comparedExternalReportId
                            })?.id ?? exactExternalReports[0].id
                            Picker("当前股票版本", selection: Binding(
                                get: { currentId },
                                set: { comparedCurrentCrossStockReportId = $0 }
                            )) {
                                ForEach(exactCurrentReports) { report in
                                    Text("v\(report.version) · #\(report.id)").tag(report.id)
                                }
                            }
                            .accessibilityIdentifier("crossStockCurrentReportPicker")
                            Picker("对比股票版本", selection: Binding(
                                get: { externalId },
                                set: { comparedExternalReportId = $0 }
                            )) {
                                ForEach(exactExternalReports) { report in
                                    Text("v\(report.version) · #\(report.id)").tag(report.id)
                                }
                            }
                            .accessibilityIdentifier("crossStockComparedReportPicker")
                            if let current = exactCurrentReports.first(where: { $0.id == currentId }),
                               let compared = exactExternalReports.first(where: { $0.id == externalId }) {
                                let currentSymbol = selectedMembership?.symbol ?? "当前股票"
                                let currentReading = current.crossStockReading(symbol: currentSymbol)
                                let comparedReading = compared.crossStockReading(symbol: target.symbol)
                                let differences = current.researchSectionDifferences(with: compared)
                                let cutoff = ResearchCutoffComparison(
                                    current: current.payload.cutoffAt,
                                    compared: compared.payload.cutoffAt
                                )
                                Text("\(currentSymbol) report #\(current.id) v\(current.version) ↔ \(target.symbol) report #\(compared.id) v\(compared.version)")
                                    .font(.caption.monospaced())
                                    .textSelection(.enabled)
                                Group {
                                    researchBriefLine(
                                        title: "\(currentSymbol) 当前判断",
                                        value: currentReading.judgment,
                                        identifier: "crossStockCurrentReportJudgment"
                                    )
                                    researchBriefLine(
                                        title: "\(currentSymbol) 价格条件、假设与情景",
                                        value: currentReading.priceConditions,
                                        identifier: "crossStockCurrentReportPriceConditions"
                                    )
                                    researchBriefLine(
                                        title: "\(currentSymbol) 风险、失效与未知项",
                                        value: currentReading.risksAndInvalidation,
                                        identifier: "crossStockCurrentReportRisks"
                                    )
                                    researchBriefLine(
                                        title: "\(currentSymbol) 下一步验证",
                                        value: currentReading.nextValidationAction,
                                        identifier: "crossStockCurrentReportNextValidation"
                                    )
                                    researchBriefLine(
                                        title: "\(target.symbol) 当前判断",
                                        value: comparedReading.judgment,
                                        identifier: "crossStockComparedReportJudgment"
                                    )
                                    researchBriefLine(
                                        title: "\(target.symbol) 价格条件、假设与情景",
                                        value: comparedReading.priceConditions,
                                        identifier: "crossStockComparedReportPriceConditions"
                                    )
                                    researchBriefLine(
                                        title: "\(target.symbol) 风险、失效与未知项",
                                        value: comparedReading.risksAndInvalidation,
                                        identifier: "crossStockComparedReportRisks"
                                    )
                                    researchBriefLine(
                                        title: "\(target.symbol) 下一步验证",
                                        value: comparedReading.nextValidationAction,
                                        identifier: "crossStockComparedReportNextValidation"
                                    )
                                    Text(cutoff.ownerText)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                        .fixedSize(horizontal: false, vertical: true)
                                        .accessibilityIdentifier("crossStockCutoffComparison")
                                }
                                DisclosureGroup("展开原始报告身份、证据包与哈希") {
                                    VStack(alignment: .leading, spacing: 3) {
                                        Text("\(currentSymbol) · reportFingerprint=\(current.reportFingerprint) · cutoff=\(current.payload.cutoffAt) · pack=\(current.payload.evidencePackBinding?.id ?? "UNKNOWN")/v\(current.payload.evidencePackBinding?.version ?? 0) · packFingerprint=\(current.payload.evidencePackBinding?.fingerprint ?? "UNKNOWN")")
                                            .textSelection(.enabled)
                                            .accessibilityIdentifier("crossStockCurrentReportIdentity")
                                        Text("\(target.symbol) · reportFingerprint=\(compared.reportFingerprint) · cutoff=\(compared.payload.cutoffAt) · pack=\(compared.payload.evidencePackBinding?.id ?? "UNKNOWN")/v\(compared.payload.evidencePackBinding?.version ?? 0) · packFingerprint=\(compared.payload.evidencePackBinding?.fingerprint ?? "UNKNOWN")")
                                            .textSelection(.enabled)
                                            .accessibilityIdentifier("crossStockComparedReportIdentity")
                                    }
                                    .font(.caption2.monospaced())
                                }
                                .accessibilityIdentifier("crossStockRawReportIdentity")
                                if exactComparisonSourceURL(report: current, workspace: twoLayerReportWorkspace.envelope?.data) != nil,
                                   let currentMembership = selectedMembership {
                                    Button("重开当前股票来源") {
                                        comparedCurrentCrossStockReportId = current.id
                                        Task { await openFreshComparisonSource(report: current, membership: currentMembership) }
                                    }
                                    .accessibilityIdentifier("crossStockCurrentSourceLink")
                                }
                                if exactComparisonSourceURL(report: compared, workspace: external) != nil {
                                    Button("重开对比股票来源") {
                                        comparedExternalReportId = compared.id
                                        Task { await openFreshComparisonSource(report: compared, membership: target) }
                                    }
                                    .accessibilityIdentifier("crossStockComparedSourceLink")
                                }
                                Button {
                                    selectedEvidenceWorkspace = .brief
                                    selectMembershipForAction(target, layer: .evidence, expandResult: true)
                                } label: {
                                    Label("切换到对比股票继续研究 / 正式决定", systemImage: "arrow.right.circle")
                                }
                                .buttonStyle(.borderedProminent)
                                .accessibilityIdentifier("openCrossStockComparedReport-\(target.symbol)")
                                Group {
                                    if let reason = differences.comparisonUnavailableReason {
                                        Text(reason)
                                            .font(.caption)
                                            .foregroundStyle(.orange)
                                            .fixedSize(horizontal: false, vertical: true)
                                            .accessibilityIdentifier("crossStockComparisonUnavailableReason")
                                    }
                                    if currentReading.isIncompatibleFormat || comparedReading.isIncompatibleFormat {
                                        Text("至少一侧报告格式不兼容：不能按现有字段读取，未列出差异不等于两侧判断相同。")
                                            .font(.caption)
                                            .foregroundStyle(.orange)
                                            .fixedSize(horizontal: false, vertical: true)
                                            .accessibilityIdentifier("crossStockComparisonIncompatibleFormat")
                                    }
                                    if currentReading.isEvidenceInsufficient || comparedReading.isEvidenceInsufficient {
                                        Text("至少一侧报告存在证据不充分状态或未补齐的缺失事实：缺失内容保持不可用，未列出的差异不等于两侧判断相同。")
                                            .font(.caption)
                                            .foregroundStyle(.orange)
                                            .fixedSize(horizontal: false, vertical: true)
                                            .accessibilityIdentifier("crossStockComparisonEvidenceInsufficient")
                                    }
                                    if differences.comparisonUnavailableReason == nil {
                                        Text("不同：\(differences.changedSections.isEmpty ? "两侧报告没有可比的结构化差异，仍需核对原文" : differences.changedSections.joined(separator: "、"))")
                                            .font(.caption)
                                            .foregroundStyle(differences.changedSections.isEmpty ? Color.secondary : Color.orange)
                                            .fixedSize(horizontal: false, vertical: true)
                                        if !differences.unchangedSections.isEmpty {
                                            Text("相同：\(differences.unchangedSections.joined(separator: "、"))")
                                                .font(.caption)
                                                .foregroundStyle(.secondary)
                                                .fixedSize(horizontal: false, vertical: true)
                                        }
                                        if !differences.unrecordedSections.isEmpty {
                                            Text("两侧都未记录：\(differences.unrecordedSections.joined(separator: "、"))；未记录不等于两侧判断相同，仍需核对原文。")
                                                .font(.caption)
                                                .foregroundStyle(.secondary)
                                                .fixedSize(horizontal: false, vertical: true)
                                                .accessibilityIdentifier("crossStockComparisonUnrecordedSections")
                                        }
                                    }
                                    Text(ResearchSharedExposureNote.line(currentReading, comparedReading))
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                        .fixedSize(horizontal: false, vertical: true)
                                        .accessibilityIdentifier("crossStockSharedExposureNote")
                                }
                            }
                            Text("两边保持各自 cutoff、pack 与 fingerprint；只横向比较，不暗示先后、优劣、推荐或排序。")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        } else {
                            Text("该股票没有可验证 fingerprint 与证据包绑定的报告，不能参与精确比较。")
                                    .font(.caption)
                                    .foregroundStyle(.orange)
                        }
                    }
                }
                .padding(.top, 6)
            } label: {
                Text("跨股票比较")
                    .accessibilityIdentifier("crossStockReportComparison")
            }
        }
    }

    private func exactComparisonSourceURL(
        report: TwoLayerReportData,
        workspace: FrozenResearchEvidenceWorkspace.DataPayload?
    ) -> URL? {
        guard let workspace,
              let binding = report.payload.evidencePackBinding,
              let pack = workspace.evidencePacks.first(where: {
                  $0.id == binding.id
                      && $0.version == binding.version
                      && $0.packFingerprint == binding.fingerprint
              }) else { return nil }
        let sourceFacts = report.payload.researchLayer.map {
            $0.fundamentals
                + ($0.context ?? [])
                + $0.eventsAndCatalysts
                + ($0.operatingMonitor ?? [])
                + $0.risks
                + $0.counterevidence
        } ?? report.payload.factTable
        return sourceFacts.lazy.compactMap {
            pack.exactExternalSourceURL(for: $0, events: workspace.events)
        }.first
    }

    @MainActor
    private func openFreshComparisonSource(
        report: TwoLayerReportData,
        membership: CandidateMembershipData
    ) async {
        guard !isLoadingComparedExternalReports,
              let selected = selectedMembership else { return }
        let requestId = UUID()
        let authorizationRevision = viewModel.authorizationRevision
        comparedExternalRequestId = requestId
        isLoadingComparedExternalReports = true
        defer {
            if comparedExternalRequestId == requestId { isLoadingComparedExternalReports = false }
        }
        do {
            let fresh = try await client.fetchFrozenResearchEvidence(membership: membership)
            let selectedReportId = membership.id == selected.id
                ? comparedCurrentCrossStockReportId : comparedExternalReportId
            let matches = fresh.data?.reports.filter {
                $0.id == report.id
                    && $0.version == report.version
                    && $0.reportFingerprint == report.reportFingerprint
                    && $0.evidencePackId == report.evidencePackId
                    && $0.isImmutableExact
            } ?? []
            guard comparedExternalRequestId == requestId,
                  dailyClientAuthorizationIsCurrent(authorizationRevision),
                  selectedMembership?.id == selected.id,
                  selectedMembership?.version == selected.version,
                  selectedReportId == report.id,
                  candidateMemberships.memberships.contains(where: {
                      $0.id == membership.id
                          && $0.version == membership.version
                          && $0.symbol == membership.symbol
                          && $0.state == membership.state
                  }),
                  matches.count == 1,
                  let data = fresh.data,
                  let freshReport = matches.first,
                  let url = exactComparisonSourceURL(report: freshReport, workspace: data) else {
                comparedExternalMessage = "报告、证据包或来源身份已经变化；未打开缓存来源。"
                return
            }
            openURL(url)
            if membership.id != selected.id { comparedExternalWorkspace = fresh }
            comparedExternalMessage = "已 fresh-read 报告、证据包和来源身份后打开网页来源。"
        } catch {
            guard comparedExternalRequestId == requestId else { return }
            comparedExternalMessage = "来源重新核对失败；未打开缓存来源。"
        }
    }
}
