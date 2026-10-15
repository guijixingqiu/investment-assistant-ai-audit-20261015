import SwiftUI

extension GateBResearchScreen {
    func profileSection(_ profile: ResearchProfileData) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(profile.symbol)
                .font(.title2.weight(.semibold))
                .accessibilityIdentifier("researchSymbol")
            if let name = profile.name {
                Text(name)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            InfoBlock(title: "当前观点", value: profile.currentView)
                .accessibilityIdentifier("researchCurrentView")
            InfoBlock(title: "当前假设", value: profile.currentThesis, valueIdentifier: "researchCurrentThesisText")
            if let disagreement = profile.marketDisagreement {
                InfoBlock(title: "市场分歧", value: disagreement)
            }
            if let invalidation = profile.invalidationCondition {
                InfoBlock(title: "失效条件", value: invalidation)
            }
        }
    }

    func selectedSymbolSection() -> some View {
        VStack(alignment: .leading, spacing: 6) {
            SectionTitle("选择标的")
            InfoBlock(title: "输入别名", value: symbolInput, valueIdentifier: "selectedSymbolAlias")
            InfoBlock(title: "规范标的", value: parsedSymbol?.canonical ?? "无效输入", valueIdentifier: "selectedSymbolCanonical")
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder
    func researchOnboardingEntry() -> some View {
            if let symbol = parsedSymbol,
               candidateMemberships.status != .unavailable,
               selectedMembership == nil,
               !candidateMemberships.memberships.contains(where: { $0.symbol == symbol.canonical && $0.state != .archived }) {
                let restoresArchived = candidateMemberships.memberships.contains {
                    $0.symbol == symbol.canonical && $0.state == .archived
                }
                Button {
                    Task { await startCurrentSymbolResearch() }
                } label: {
                    Label(
                        restoresArchived ? "恢复已归档研究自选并开始研究" : "加入研究自选并开始研究",
                        systemImage: "plus.circle"
                    )
                }
                .buttonStyle(.borderedProminent)
                .disabled(isWritingMembership || isLoadingMobileWorkspace)
                .accessibilityIdentifier("researchOnboardingButton")
            }
            Button {
                focusesCurrentMembership = false
                showDailyDecisionLayer(.candidate, expandResult: true)
            } label: {
                Label("管理研究自选", systemImage: "list.bullet.rectangle")
            }
            .buttonStyle(.bordered)
            .accessibilityIdentifier("researchWatchlistManageButton")
            .accessibilityHint("打开生命周期管理，可手动新增、跟踪、暂停或归档；只切换界面，不写入研究自选")
            Text("只切换界面，不会写入研究自选；手动输入普通港股代码与完整清单都在生命周期里。")
                .font(.caption)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("researchWatchlistManageNote")
    }

    @ViewBuilder
    func limitedResearchEntry() -> some View {
        if let membership = selectedMembership, membership.state != .archived {
            let authorization = AppEnvironment.researchAuthorizationContext()
            let holdingMaterialIds = Set((frozenResearchEvidenceWorkspace.envelope?.data?.events ?? [])
                .filter { $0.coverageScope == "current_holding" }.map { $0.source.materialId })
            let availableMaterials = (frozenResearchEvidenceWorkspace.envelope?.data?.materials ?? [])
                .filter { $0.revisionState == "current" && $0.sourceType != "owner_verified_holding_logic"
                    && $0.sourceType != "exchange_announcement_lead"
                    && !holdingMaterialIds.contains($0.id) }
                .sorted { (Int($0.id) ?? 0) < (Int($1.id) ?? 0) }
            let selectionMatchesMembership = frozenResearchEvidenceWorkspace.limitedSelectionMembershipKey
                == FrozenResearchEvidenceWorkspaceState.limitedSelectionKey(membership)
            let selectedCount = selectionMatchesMembership
                ? frozenResearchEvidenceWorkspace.limitedSelectedMaterials.count : 0
            let invalidSelectedCount = frozenResearchEvidenceWorkspace.invalidLimitedMaterialCount(
                membership: membership, available: availableMaterials)
            Button("添加资料") { showsResearchSourceImport = true }
                .buttonStyle(.bordered)
                .disabled(frozenResearchEvidenceWorkspace.isBusy || twoLayerReportWorkspace.isBusy || twoLayerReportWorkspace.draft != nil || twoLayerReportWorkspace.hasActiveSynthesisTask)
                .accessibilityIdentifier("researchSourceImportButton")
                .sheet(isPresented: $showsResearchSourceImport) {
                    ResearchSourceImportSheet(membership: membership, client: client, maySave: {
                        selectedMembership?.id == membership.id && selectedMembership?.version == membership.version
                            && selectedMembership?.actorId == membership.actorId && selectedMembership?.state != .archived
                            && !frozenResearchEvidenceWorkspace.isBusy && !twoLayerReportWorkspace.isBusy
                            && twoLayerReportWorkspace.draft == nil && !twoLayerReportWorkspace.hasActiveSynthesisTask
                            && parsedSymbol?.canonical == membership.symbol
                            && AppEnvironment.researchAuthorizationContext() == authorization
                    }, onSaved: { workspace in
                        invalidateTwoLayerReport("新资料已保存，可用已有材料更新研究。")
                        frozenResearchEvidenceWorkspace.envelope = workspace
                        twoLayerReportWorkspace.envelope = workspace
                        frozenResearchEvidenceWorkspace.message = "资料已保存并读回。下一步：用已有材料开始有限研究。"
                        todayRefreshRevision &+= 1
                    })
                    .id("\(membership.actorId):\(membership.id):\(membership.version):\(viewModel.authorizationRevision)")
                }
            Button("重新读取可选材料") { Task { await loadFrozenResearchEvidence() } }
                .disabled(frozenResearchEvidenceWorkspace.isBusy)
            if availableMaterials.isEmpty {
                Text("当前没有可选的研究材料；请先添加资料或刷新材料读取。")
                    .font(.caption).foregroundStyle(.secondary)
            } else {
                Text("选择本次有限研究使用的材料（冻结前）")
                    .font(.caption.weight(.semibold))
                ForEach(availableMaterials) { material in
                    let usable = material.freshness == "fresh"
                        && !["conflict", "rejected"].contains(material.verificationStatus)
                        && ["user_provided", "authorized_public"].contains(material.rightsStatus)
                    let selected = selectionMatchesMembership
                        && frozenResearchEvidenceWorkspace.limitedSelectedMaterials.contains { $0.matches(material) }
                    Toggle(isOn: Binding(
                        get: { selected },
                        set: { enabled in
                            if !enabled || usable {
                                frozenResearchEvidenceWorkspace.setLimitedMaterial(
                                    material, membership: membership, selected: enabled)
                            }
                        }
                    )) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(material.title).font(.caption.weight(.semibold))
                            Text(material.summary).font(.caption2).foregroundStyle(.secondary)
                            if !usable { Text("当前版本不可用于冻结").font(.caption2).foregroundStyle(.secondary) }
                        }
                    }
                    .disabled((!usable && !selected) || frozenResearchEvidenceWorkspace.isBusy || twoLayerReportWorkspace.isBusy)
                    .accessibilityIdentifier("limitedResearchMaterial-\(material.id)")
                }
            }
            if invalidSelectedCount > 0 {
                Text("已选材料中有 \(invalidSelectedCount) 项已过期或版本变化。请取消或清空后重新选择；不会自动改用新版本。")
                    .font(.caption).foregroundStyle(.secondary)
            }
            if selectedCount > 0 {
                Button("清空本次选择（\(selectedCount)）") {
                    frozenResearchEvidenceWorkspace.clearLimitedMaterials(membership: membership)
                }
                .buttonStyle(.bordered)
                .disabled(frozenResearchEvidenceWorkspace.isBusy || twoLayerReportWorkspace.isBusy)
                .accessibilityIdentifier("clearLimitedResearchMaterialsButton")
            }
            Button(latestResearchReportForStatus == nil ? "用所选材料开始有限研究" : "用所选材料更新研究") { Task { await prepareLimitedResearch() } }
                .buttonStyle(.borderedProminent)
                .disabled(frozenResearchEvidenceWorkspace.isBusy || twoLayerReportWorkspace.isBusy || twoLayerReportWorkspace.draft != nil || twoLayerReportWorkspace.hasActiveSynthesisTask
                    || frozenResearchEvidenceWorkspace.selectedLimitedMaterials(membership: membership, available: availableMaterials) == nil)
                .accessibilityIdentifier("prepareLimitedResearchButton")
            Text("至少选一份有效材料。冻结后本次发送范围固定为所选材料；估值、技术数据可后补。")
                .font(.caption).foregroundStyle(.secondary)
            if !frozenResearchEvidenceWorkspace.message.isEmpty {
                Text(frozenResearchEvidenceWorkspace.message).font(.caption)
            }
        }
    }

    @MainActor
    func startCurrentSymbolResearch() async {
        guard let symbol = parsedSymbol,
              candidateMemberships.status != .unavailable,
              selectedMembership == nil,
              !isLoadingMobileWorkspace else { return }
        if !includeArchivedMemberships {
            includeArchivedMemberships = true
            await refreshMemberships()
            guard candidateMemberships.status != .unavailable,
                  selectedMembership == nil,
                  parsedSymbol?.canonical == symbol.canonical else { return }
        }
        let context = AppEnvironment.researchAuthorizationContext()
        let authorizationRevision = viewModel.authorizationRevision
        membershipInput = symbol.canonical
        membershipInitialState = .tracked
        restoreArchivedMembership = candidateMemberships.memberships.contains {
            $0.symbol == symbol.canonical && $0.state == .archived
        }
        guard let created = await createMembership() else { return }
        guard AppEnvironment.researchAuthorizationContext() == context,
              dailyClientAuthorizationIsCurrent(authorizationRevision),
              parsedSymbol?.canonical == symbol.canonical else { return }
        guard created.symbol == symbol.canonical else {
            membershipWriteMessage = "写入响应与当前标的不一致；未打开工作台。"
            return
        }
        guard let exact = candidateMemberships.memberships.first(where: {
            $0.id == created.id && $0.version == created.version &&
                $0.symbol == symbol.canonical && $0.state != .archived
        }) else {
            membershipWriteMessage = "写入已返回，但 fresh 研究自选未精确匹配；未打开工作台。"
            return
        }
        await openMobileWorkspace(for: exact)
        resumePendingMarketAnnouncement(symbol.canonical)
    }

    func coreJourneyOverviewSection() -> some View {
        let state = CoreJourneyState.derive(
            symbol: parsedSymbol?.canonical ?? "无效输入",
            isLoading: isLoading || isLoadingDecisionReviewHistory,
            malformedInputMessage: malformedInputMessage,
            researchEnvelope: envelope,
            decisionContext: decisionContext,
            decisionContextMessage: decisionContextMessage,
            pinganSnapshot: pinganSnapshot,
            pinganSnapshotMessage: pinganSnapshotMessage,
            submittedDecision: currentSubmittedDecision,
            decisionReviewHistory: decisionReviewHistory,
            decisionReviewMessage: decisionReviewMessage
        )
        let nextAction = CoreJourneyNextAction.derive(
            state: state,
            decisionEnabled: decisionContext?.research.status == "available" && !hasCurrentDecision && !isLoading && !isLoadingDecisionReviewHistory && !submissionState.isInFlight,
            reviewEnabled: currentReviewableCheck != nil && !isLoading && !isLoadingDecisionReviewHistory && !reviewSubmissionState.isInFlight,
            loadEnabled: !isLoading && !isLoadingDecisionReviewHistory && !submissionState.isInFlight
        )

        return VStack(alignment: .leading, spacing: 12) {
            SectionTitle("核心辅助旅程")
                .accessibilityIdentifier("coreJourneyOverview")
            Text(state.symbol)
                .font(.subheadline.weight(.semibold))
                .accessibilityIdentifier("coreJourneySymbol")

            ForEach(state.stages) { stage in
                HStack(alignment: .top, spacing: 10) {
                    Text("\(stage.order)")
                        .font(.caption.weight(.bold))
                        .frame(width: 24, height: 24)
                        .foregroundStyle(.white)
                        .background(stageColor(stage.status))
                        .clipShape(Circle())
                    VStack(alignment: .leading, spacing: 3) {
                        Text(stage.title)
                            .font(.callout.weight(.semibold))
                        Text("\(stage.status.label)：\(stage.detail)")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                            .accessibilityIdentifier(stage.accessibilityIdentifier)
                    }
                }
            }

            Text(state.safetyStatement)
                .font(.footnote.weight(.semibold))
                .foregroundStyle(.red)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("coreJourneySafetyStatement")

            nextActionCard(nextAction)

            reviewFeedbackCard(ReviewFeedbackCard.derive(
                state: state,
                currentDecisionContext: decisionContext,
                submittedDecision: currentSubmittedDecision,
                submittedReview: currentSubmittedReview,
                reviewHistory: decisionReviewHistory,
                pinganSnapshot: pinganSnapshot
            ))
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.secondarySystemGroupedBackground))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }

    func nextActionCard(_ action: CoreJourneyNextAction) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(coreJourneyActionLabel(action.kind))
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
                .accessibilityIdentifier("coreJourneyNextActionKind")
            Text(action.title)
                .font(.callout.weight(.semibold))
                .accessibilityIdentifier("coreJourneyNextActionTitle")
            Text(action.explanation)
                .font(.caption)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("coreJourneyNextActionExplanation")
            Text("\(coreJourneyOperationLabel(action.operation)) · \(action.enabled ? "现在可执行" : "等待条件")")
                .font(.caption2.weight(.semibold))
                .foregroundStyle(action.enabled ? .green : .secondary)
                .accessibilityIdentifier("coreJourneyNextActionOperation")
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.tertiarySystemBackground))
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("coreJourneyNextActionCard")
    }

    func decisionContextSection(_ context: DecisionContextEnvelope) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionTitle("决策上下文")
            Text(context.requestedSymbol)
                .font(.title2.weight(.semibold))
                .accessibilityIdentifier("decisionContextSymbol")
            InfoBlock(title: "上下文标识", value: context.contextId, valueIdentifier: "decisionContextId")
            InfoBlock(title: "上下文哈希", value: context.contextHash, valueIdentifier: "decisionContextHash")
            InfoBlock(title: "上下文生成时间", value: context.generatedAt, valueIdentifier: "decisionContextGeneratedAt")
            InfoBlock(title: "报价新鲜度", value: quoteStatusText(context.quote), valueIdentifier: "decisionQuoteStatus")
            InfoBlock(title: "报价来源", value: assetsQuoteSourceLabel(context.quote.source), valueIdentifier: "decisionQuoteSource")
            InfoBlock(title: "抓取时间", value: context.quote.fetchedAt ?? "未提供", valueIdentifier: "decisionQuoteFetchedAt")
            InfoBlock(title: "研究证据状态", value: "\(context.research.status)：\(context.research.message)", valueIdentifier: "decisionResearchStatus")
            InfoBlock(title: "建议摘要（辅助信息）", value: context.suggestionSummary.summary, valueIdentifier: "decisionSuggestionSummary")
            InfoBlock(title: "量化研究证据", value: quantEvidenceStatusText(context.quantEvidence), valueIdentifier: "decisionQuantEvidenceStatus")
            InfoBlock(title: "量化身份边界", value: quantEvidenceIdentityText(context.quantEvidence), valueIdentifier: "decisionQuantEvidenceIdentity")
            InfoBlock(title: "量化样本边界", value: context.quantEvidence.sampleBoundary.limitation, valueIdentifier: "decisionQuantEvidenceSampleBoundary")
            InfoBlock(title: "量化决策证据", value: quantDecisionEvidenceSummary(context.quantEvidence), valueIdentifier: "decisionQuantEvidenceRefinement")
            InfoBlock(title: "分段模拟观察", value: quantDecisionEvidenceSamples(context.quantEvidence), valueIdentifier: "decisionQuantEvidenceSamples")
            InfoBlock(title: "量化执行边界", value: quantDecisionEvidenceExecution(context.quantEvidence), valueIdentifier: "decisionQuantEvidenceExecution")
            InfoBlock(title: "量化稳健性边界", value: quantDecisionEvidenceRobustness(context.quantEvidence), valueIdentifier: "decisionQuantEvidenceRobustness")
            InfoBlock(
                title: "组合兼容边界",
                value: "此兼容上下文未内嵌当前组合；Pingan 当前组合独立显示在组合风险层，且尚未绑定到本上下文。",
                valueIdentifier: "decisionPortfolioCompatibilityBoundary"
            )
            Text("上下文版本 \(context.schemaVersion)")
                .font(.caption)
                .foregroundStyle(.secondary)
                .accessibilityIdentifier("decisionContextVersion")
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.secondarySystemGroupedBackground))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }

    func pinganSnapshotSection(_ snapshot: PinganSnapshotEnvelope) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionTitle("平安历史持仓快照")
            InfoBlock(title: "快照状态", value: "\(pinganSnapshotStatusLabel(snapshot.status))：\(snapshot.stateMessage)", valueIdentifier: "pinganSnapshotStatus")
            InfoBlock(title: "请求标的", value: snapshot.requestedSymbol, valueIdentifier: "pinganSnapshotRequestedSymbol")
            InfoBlock(title: "来源系统", value: assetsPortfolioSourceLabel(snapshot.sourceSystem), valueIdentifier: "pinganSnapshotSourceSystem")
            InfoBlock(title: "来源快照", value: snapshot.sourceSnapshotId ?? "未提供", valueIdentifier: "pinganSnapshotSourceId")
            InfoBlock(title: "来源时点", value: snapshot.sourceAsOf ?? "未提供", valueIdentifier: "pinganSnapshotSourceAsOf")
            InfoBlock(title: "导入时间", value: snapshot.importedAt ?? "未提供", valueIdentifier: "pinganSnapshotImportedAt")
            InfoBlock(title: "抓取时间", value: snapshot.fetchedAt ?? "未提供", valueIdentifier: "pinganSnapshotFetchedAt")
            InfoBlock(title: "警示", value: snapshot.warning ?? snapshot.stateMessage, valueIdentifier: "pinganSnapshotWarning")
            InfoBlock(title: "限制", value: snapshot.limitation, valueIdentifier: "pinganSnapshotLimitation")
            InfoBlock(title: "风险影响", value: "风险影响计算已阻止：\(snapshot.dataUse.riskImpact)。此数据不代表实时持仓、自动刷新、券商对账、交易或会计权限。", valueIdentifier: "pinganSnapshotRiskImpactBlocked")
            InfoBlock(title: "权威边界", value: "brokerReconciliation=\(snapshot.dataUse.brokerReconciliation); accountTruth=\(snapshot.dataUse.accountTruth); accounting=\(snapshot.dataUse.accounting); execution=\(snapshot.dataUse.execution)", valueIdentifier: "pinganSnapshotAuthorityBlocked")

            if snapshot.hasDisplayablePositions {
                ForEach(snapshot.positions) { position in
                    VStack(alignment: .leading, spacing: 6) {
                        Text("\(position.symbol) \(position.name ?? "")")
                            .font(.callout.weight(.semibold))
                            .accessibilityIdentifier("pinganSnapshotPositionRow")
                        InfoBlock(title: "数量", value: formatNumber(position.quantity))
                        InfoBlock(title: "币种", value: position.currency ?? "未提供")
                        InfoBlock(title: "平均成本", value: formatOptionalNumber(position.averageCost))
                        InfoBlock(title: "来源行", value: position.sourceRowId, valueIdentifier: "pinganSnapshotSourceRowId")
                    }
                    .padding(10)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color(.tertiarySystemBackground))
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                }
            } else {
                Text("没有可展示的平安快照持仓行；失败、未授权、冲突或未批准状态不会复用旧快照。")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("pinganSnapshotNoPositions")
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.secondarySystemGroupedBackground))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }

    func evidenceSection(_ evidence: [EvidenceItemData]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionTitle("证据")
            ForEach(evidence) { item in
                VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: 8) {
                        Text(factKindLabel(item.factKind))
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(item.factKind == .fact ? .green : .orange)
                        Text(evidenceStanceLabel(item.stance))
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(stanceColor(item.stance))
                        if let variableName = item.variableName {
                            Text(variableName)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                    Text(item.summary)
                        .font(.callout)
                }
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color(.secondarySystemGroupedBackground))
                .clipShape(RoundedRectangle(cornerRadius: 8))
            }
        }
        .accessibilityIdentifier("researchEvidenceList")
    }

    func suggestionSection(_ suggestions: [AiUpdateSuggestionData]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionTitle("AI 建议")
            ForEach(suggestions) { suggestion in
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        Text(suggestionStatusLabel(suggestion.status))
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(suggestion.status == .pending ? .blue : .secondary)
                            .accessibilityIdentifier("researchSuggestionStatus")
                        Spacer()
                    }
                    Text(suggestion.summary)
                        .font(.callout.weight(.medium))

                    if suggestion.status == .pending {
                        HStack {
                            Button {
                                Task { await decide(suggestion: suggestion, action: .accepted) }
                            } label: {
                                Label("接受", systemImage: "checkmark")
                            }
                            .buttonStyle(.borderedProminent)
                            .disabled(decisionInFlight != nil)
                            .accessibilityIdentifier("acceptSuggestionButton")

                            Button {
                                Task { await decide(suggestion: suggestion, action: .rejected) }
                            } label: {
                                Label("拒绝", systemImage: "xmark")
                            }
                            .buttonStyle(.bordered)
                            .disabled(decisionInFlight != nil)
                            .accessibilityIdentifier("rejectSuggestionButton")
                        }
                    }

                    BulletList(title: "支持", items: suggestion.supports)
                    BulletList(title: "削弱", items: suggestion.weakens)
                    BulletList(title: "缺口", items: suggestion.missingEvidence)

                    if let decisionNote = suggestion.decisionNote {
                        Text(decisionNote)
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                }
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color(.secondarySystemGroupedBackground))
                .clipShape(RoundedRectangle(cornerRadius: 8))
                .accessibilityIdentifier("researchSuggestionCard")
            }
        }
    }

    func submittedDecisionSection(_ decision: DecisionCheckData) -> some View {
        submittedDecisionSection(
            title: "已提交检查",
            id: decision.id,
            checkedAt: decision.checkedAt,
            contextId: decision.contextId,
            humanCheckResult: decision.humanCheckResult,
            userFinalDecision: decision.userFinalDecision,
            decisionSnapshot: decision.decisionSnapshot,
            safety: decision.safety
        )
    }

    func submittedDecisionSection(_ decision: RecordedDecisionCheckReviewState) -> some View {
        submittedDecisionSection(
            title: "已从历史读回检查",
            id: decision.id,
            checkedAt: decision.checkedAt,
            contextId: decision.contextId,
            humanCheckResult: decision.humanCheckResult,
            userFinalDecision: decision.userFinalDecision,
            decisionSnapshot: decision.decisionSnapshot,
            safety: decision.safety
        )
    }

    private func submittedDecisionSection(
        title: String,
        id: String,
        checkedAt: String,
        contextId: String,
        humanCheckResult: String,
        userFinalDecision: String?,
        decisionSnapshot: DecisionSnapshotState?,
        safety: DecisionCheckSafety
    ) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionTitle(title)
            InfoBlock(title: "检查标识", value: id, valueIdentifier: "submittedDecisionCheckId")
            InfoBlock(title: "检查时间", value: checkedAt, valueIdentifier: "submittedDecisionCheckedAt")
            InfoBlock(title: "上下文标识", value: contextId, valueIdentifier: "submittedDecisionContextId")
            InfoBlock(title: "检查结论", value: humanCheckResult, valueIdentifier: "submittedDecisionHumanCheckResult")
            InfoBlock(title: "最终决定", value: userFinalDecision ?? "未填写", valueIdentifier: "submittedDecisionUserFinalDecision")
            InfoBlock(
                title: "决策事实快照",
                value: decisionSnapshotAvailabilityText(decisionSnapshot),
                valueIdentifier: "submittedDecisionSnapshot"
            )
            InfoBlock(title: "安全证据", value: safetyEvidenceText(safety), valueIdentifier: "submittedDecisionSafetyEvidence")
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.secondarySystemGroupedBackground))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }

}
