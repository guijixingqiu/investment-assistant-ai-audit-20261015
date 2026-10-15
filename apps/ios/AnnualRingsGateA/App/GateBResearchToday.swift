import SwiftUI

extension GateBResearchScreen {
    @MainActor
    func clearRequestedTodayCandidateTargetIfNeeded(for canonical: String?) {
        guard requestedTodayCandidateTarget?.symbol != canonical else { return }
        requestedTodayCandidateTarget = nil
    }
    @MainActor
    func openRequestedTodayCandidateTarget() async {
        guard let target = requestedTodayCandidateTarget else { return }
        guard parsedSymbol?.canonical == target.symbol else {
            requestedTodayCandidateTarget = nil
            dailyContinuityMessage = "Today 候选目标与当前标的不一致；请求已清除。"
            return
        }
        let authorizationRevision = viewModel.authorizationRevision
        await refreshDailyClient(
            restoredNavigation: false,
            preferredMembership: selectedMembership,
            preferredMembershipIdentity: target
        )
        guard requestedTodayCandidateTarget == target else { return }
        guard parsedSymbol?.canonical == target.symbol,
              dailyClientAuthorizationIsCurrent(authorizationRevision),
              candidateMemberships.status != .unavailable,
              let membership = selectedMembership,
              membership.id == target.membershipId,
              membership.version == target.membershipVersion,
              membership.symbol == target.symbol else {
            requestedTodayCandidateTarget = nil
            dailyContinuityMessage = "Today 候选成员已因 membership、版本、标的或来源变化而清除；未打开旧候选。"
            return
        }
        if !target.opensResearchProfileReview && !target.opensPortfolioLab && !target.opensHoldingLogicCapture {
            selectedDecisionLayer = .evidence
            selectedEvidenceWorkspace = .brief
            isAnnualDecisionBriefExpanded = true
        }
        if target.opensResearchProfileReview {
            await openResearchProfileReview(for: membership)
        }
        if target.opensPortfolioLab {
            portfolioLabAmountsInput = ""
            hasExplicitPortfolioReportExplanationAmount = false
            selectedDecisionLayer = .portfolio
            selectedPortfolioWorkspace = .lab
            pendingDecisionWorkspaceScrollTarget = "annualPortfolioLabAnchor"
        }
        if target.opensHoldingLogicCapture,
           !(await openHoldingLogicCapture(target: target, membership: membership, authorizationRevision: authorizationRevision)) { return }
        if let item = pendingOfficialAnnouncement,
           item.symbol == membership.symbol {
            prepareOfficialAnnouncementForVerification(item)
            pendingOfficialAnnouncement = nil
        }
        requestedTodayCandidateTarget = nil
    }
    @MainActor
    func loadTodayResearch(for membership: CandidateMembershipData) async {
        let requestId = UUID()
        todayResearchRequestId = requestId
        isLoadingTodayResearch = true
        todayResearch = .unavailable(message: "正在读取 \(membership.symbol) 的今日事项。", membershipId: membership.id)
        let envelope = await client.fetchTodayResearch(membershipId: membership.id)
        guard todayResearchRequestId == requestId else { return }
        isLoadingTodayResearch = false
        guard candidateMembershipIdentityMatches(
            membership,
            membershipIds: [selectedMembership?.id],
            symbol: selectedMembership?.symbol,
            version: selectedMembership?.version
        ) else { return }
        let exposesIdentity = envelope.membershipVersion != nil || envelope.requestedSymbol != nil
        guard envelope.membershipId == membership.id,
              envelope.requestedActorId == membership.actorId,
              exposesIdentity == false || envelope.membershipVersion == membership.version && envelope.requestedSymbol == membership.symbol else {
            todayResearch = .unavailable(
                .malformed,
                message: "今日事项的成员、标的或版本与当前来源不一致，已停止展示。",
                membershipId: membership.id
            )
            return
        }
        todayResearch = envelope
    }
    @MainActor
    func clearTodayResearch(_ message: String, membershipId: String? = nil) {
        todayResearchRequestId = UUID()
        isLoadingTodayResearch = false
        pendingTodayReportConfirmationReservation = nil
        todayResearch = .unavailable(message: message, membershipId: membershipId ?? "unselected")
    }
    @MainActor
    func clearRequestedTodayResearchTarget(_ message: String) {
        let membershipId = requestedTodayResearchTarget?.membershipId
        requestedTodayResearchTarget = nil
        pendingTodayReportConfirmationReservation = nil
        clearTodayResearch(message, membershipId: membershipId)
    }
    func todayResearchActionDestination(_ item: TodayResearchItem) -> TodayResearchActionDestination {
        TodayResearchActionDestination(trackingState: item.trackingState, hasReport: item.bindings.reportRef != nil)
    }
    @MainActor
    func openRequestedTodayResearchTarget() async {
        guard let target = requestedTodayResearchTarget else { return }
        guard parsedSymbol?.canonical == target.symbol else {
            clearRequestedTodayResearchTarget("Today 研究事项与当前标的不一致；请求已清除。")
            return
        }
        selectedDecisionLayer = target.preferredLayer
        let actionPrefix = "action:\(target.membershipId):v\(target.membershipVersion):"
        if target.preferredLayer == .evidence,
           target.report == nil,
           target.task == nil,
           target.itemId.hasPrefix(actionPrefix) {
            switch String(target.itemId.dropFirst(actionPrefix.count)) {
            case TodayResearchTrackingState.needsMaterial.rawValue, TodayResearchTrackingState.needsEvidencePack.rawValue:
                selectedEvidenceWorkspace = .brief
            case TodayResearchTrackingState.needsResearch.rawValue:
                selectedEvidenceWorkspace = .brief
            default:
                break
            }
        }
        let authorizationRevision = viewModel.authorizationRevision
        await refreshDailyClient(restoredNavigation: false, preferredMembership: selectedMembership)
        guard requestedTodayResearchTarget == target else { return }
        guard let item = todayResearch.items.first(where: {
            $0.id == target.itemId && $0.symbol == target.symbol
        }),
              parsedSymbol?.canonical == target.symbol,
              dailyClientAuthorizationIsCurrent(authorizationRevision),
              let membership = selectedMembership,
              membership.id == target.membershipId,
              membership.version == target.membershipVersion,
              membership.symbol == target.symbol,
              todayResearch.status == .available,
              todayResearch.membershipId == target.membershipId,
              todayResearch.membershipVersion == target.membershipVersion,
              todayResearch.requestedSymbol == target.symbol,
              todayResearchNavigationMatches(item: item, target: target) else {
            clearRequestedTodayResearchTarget("Today 研究事项已因 membership、版本、标的或来源变化而清除；未打开旧事项。")
            return
        }
        guard todayResearchTargetBindingMatches(item: item, target: target) else {
            clearRequestedTodayResearchTarget("Today 研究事项已因 report、证据包或任务版本变化而清除；未打开旧事项。")
            return
        }
        if target.task != nil && target.report == nil {
            guard await openReadyDeepResearchTaskFromToday(target: target, item: item, membership: membership, authorizationRevision: authorizationRevision) else { return }
        } else if target.source.lane == "research_material" {
            guard routeTodayResearchMaterialAction(item) else { clearRequestedTodayResearchTarget("Today 持仓逻辑与 fresh workspace 或当前持仓快照不一致；未打开旧事项。"); return }
        } else if let report = target.report {
            await loadTwoLayerReports()
            guard requestedTodayResearchTarget == target else { return }
            guard parsedSymbol?.canonical == target.symbol,
                  dailyClientAuthorizationIsCurrent(authorizationRevision),
                  selectedMembership?.id == membership.id,
                  selectedMembership?.version == membership.version,
                  let data = twoLayerReportWorkspace.envelope?.data,
                  let resolution = resolveTodayReportNavigation(
                      item: item,
                      target: target,
                      report: report,
                      membership: membership,
                      authorizationRevision: authorizationRevision,
                      data: data
                  ) else {
                clearRequestedTodayResearchTarget("Today 报告已因 report、evidence pack 或来源 currentness 变化而清除；未打开旧报告。")
                return
            }
            pendingTodayReportConfirmationReservation = resolution.confirmation
            selectedDecisionLayer = .evidence
            selectedEvidenceWorkspace = .brief
            pendingDecisionWorkspaceScrollTarget = twoLayerReportFormalDecisionAnchor(resolution.report.id)
            pendingDecisionWorkspaceScrollTarget?.append(":confirmation")
        } else {
            routeTodayResearchAction(item)
        }
        requestedTodayResearchTarget = nil
    }
    @MainActor
    func decideTwoLayerReport(
        _ report: TwoLayerReportData,
        decision: String,
        note: String? = nil
    ) async {
        guard !twoLayerReportWorkspace.isBusy else { return }
        let rejectionReason = note?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard let membership = selectedMembership,
              membership.state != .archived,
              ["confirmed", "rejected"].contains(decision),
              decision != "rejected" || (!rejectionReason.isEmpty && rejectionReason.count <= 4_000),
              report.isFormalizable,
              currentTwoLayerReportBindingIdentity == twoLayerReportWorkspace.bindingIdentity else {
            invalidateTwoLayerReport("报告已非 exact-current；不可正式确认或驳回。")
            return
        }
        let revision = twoLayerReportWorkspace.requests.beginDecision()
        defer { twoLayerReportWorkspace.requests.finishDecision(revision) }
        let authorizationRevision = viewModel.authorizationRevision
        let todayConfirmation = decision == "confirmed"
            ? pendingTodayReportConfirmationReservation
            : nil
        let decisionNote = decision == "rejected"
            ? rejectionReason
            : "你已明确确认这份证据绑定报告。"
        let fingerprint = "\(report.id)|\(report.reportFingerprint)|\(decision)|\(decisionNote)"
        let isExplicitAmbiguousRetry = todayConfirmation != nil
            && twoLayerReportWorkspace.decisionReservation.fingerprint == fingerprint
            && twoLayerReportWorkspace.decisionReservation.key != nil
        if let todayConfirmation {
            guard todayConfirmation.matches(report: report, evidencePack: currentTwoLayerReportPack, membership: membership),
                  todayConfirmation.authorizationRevision == authorizationRevision,
                  dailyClientAuthorizationIsCurrent(authorizationRevision) else {
                invalidateTwoLayerReport("Today 报告确认来源已漂移；未写入 report decision。")
                return
            }
            if !isExplicitAmbiguousRetry {
                let freshToday = await client.fetchTodayResearch(membershipId: membership.id)
                guard twoLayerReportWorkspace.requests.acceptsDecision(revision),
                      dailyClientAuthorizationIsCurrent(authorizationRevision),
                      todayAwaitingConfirmationMatches(freshToday, reservation: todayConfirmation) else {
                    twoLayerReportWorkspace.message = "今日报告确认事项已变化或不可用；未保存报告决定。"
                    return
                }
            }
        }
        let key = twoLayerReportWorkspace.decisionReservation.reserve(
            for: fingerprint,
            prefix: "ios-two-layer-decision"
        )
        let decisionVerb = decision == "confirmed" ? "确认" : "驳回"
        let previousEnvelope = twoLayerReportWorkspace.envelope
        twoLayerReportWorkspace.envelope = nil
        do {
            let result = try await client.decideTwoLayerReportAndReadBack(
                membership: membership,
                report: report,
                requestBody: DecideTwoLayerReportRequest(
                    membershipVersion: membership.version,
                    decision: decision,
                    note: todayConfirmation == nil
                        ? decisionNote
                        : "你从今日事项中\(decisionVerb)了这份报告。",
                    idempotencyKey: key
                )
            )
            guard twoLayerReportWorkspace.requests.acceptsDecision(revision),
                  selectedMembership?.id == membership.id,
                  selectedMembership?.version == membership.version,
                  parsedSymbol?.canonical == membership.symbol,
                  result.decision.reportId == report.id,
                  result.decision.decision == decision else { return }
            if let todayConfirmation {
                let freshToday = await client.fetchTodayResearch(membershipId: membership.id)
                let freshInbox = await client.fetchTodayActionInbox()
                guard dailyClientAuthorizationIsCurrent(authorizationRevision),
                      todayConfirmationSuccess(freshToday, reservation: todayConfirmation, decision: result.decision),
                      todayFormalDecisionDueMatches(
                          freshInbox,
                          reservation: todayConfirmation,
                          decision: result.decision,
                          actorId: membership.actorId
                      ) else {
                    twoLayerReportWorkspace.preserveAmbiguousDecision(
                        previousEnvelope: previousEnvelope,
                        message: "报告结果已经提交，但重新读取时未能同时确认报告状态和待提交正式决定事项；没有显示成功，明确重试会沿用同一请求身份。"
                    )
                    return
                }
                todayResearch = freshToday
                frozenResearchEvidenceWorkspace.envelope = result.workspace
                twoLayerReportWorkspace.envelope = result.workspace
                twoLayerReportWorkspace.decisionReservation.clear()
                pendingTodayReportConfirmationReservation = nil
                todayRefreshRevision &+= 1
                scheduleResearchArchiveAutomaticBackup(.reportConfirmation(result.decision.id), membership: membership)
                selectedTab = .today
                twoLayerReportWorkspace.message = "报告 #\(report.id) 已由你确认；今日事项已显示待提交正式决定，尚未自动采用或提交。"
                return
            }
            frozenResearchEvidenceWorkspace.envelope = result.workspace
            twoLayerReportWorkspace.envelope = result.workspace
            twoLayerReportWorkspace.decisionReservation.clear()
            twoLayerReportRejectionReason = ""
            if decision == "confirmed" {
                scheduleResearchArchiveAutomaticBackup(.reportConfirmation(result.decision.id), membership: membership)
            }
            twoLayerReportWorkspace.message =
                "保存并重新读取后，已确认报告 #\(report.id) 的结果为\(decisionVerb)；未创建订单或修改资产事实。"
        } catch {
            guard twoLayerReportWorkspace.requests.acceptsDecision(revision) else { return }
            if twoLayerReportFailureRequiresClear(error) {
                invalidateTwoLayerReport(twoLayerReportErrorMessage(error))
            } else {
                twoLayerReportWorkspace.preserveAmbiguousDecision(
                    previousEnvelope: previousEnvelope,
                    message: "保存结果尚未确认；报告与本次确认意图已保留，明确重试将解析同一不可变记录。"
                )
            }
        }
    }
    @ViewBuilder
    func todayResearchSection(layout: DailyWorkbenchLayoutMetrics) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                Label("今日事项", systemImage: "sun.max")
                    .font(.headline)
                Spacer()
                Text(isLoadingTodayResearch ? "读取中" : todayResearch.status.userLabel)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(todayResearch.status == .available ? .green : .secondary)
                    .accessibilityIdentifier("todayResearchStatus")
            }

            if let quality = todayResearch.quality {
                Text(quality.sourceHealth.status == .healthy ? "来源已核对" : "来源需要复核")
                    .font(.caption2.monospaced())
                    .foregroundStyle(quality.sourceHealth.status == .healthy ? .green : .orange)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("todayResearchSourceHealth")
                Text("结构检查 \(quality.researchStructure.checks.filter(\.passed).count)/\(quality.researchStructure.checks.count) 通过")
                    .font(.caption2.monospaced())
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("todayResearchStructureQuality")
                if quality.sourceHealth.issueCodes.isEmpty == false {
                    Text("来源问题：\(quality.sourceHealth.userIssueSummary)")
                        .font(.caption)
                        .foregroundStyle(.orange)
                        .accessibilityIdentifier("todayResearchSourceIssues")
                    Button("去处理来源问题") {
                        openTodaySourceRecovery(quality.sourceHealth.recoveryDestination)
                    }
                    .buttonStyle(.bordered)
                    .accessibilityIdentifier("todayResearchSourceRecovery")
                }
            }

            if todayResearch.status == .available {
                ForEach(todayResearch.items) { item in
                    todayResearchItem(item)
                }
                if todayResearch.omittedItemCount > 0 {
                    Text("已按固定优先级省略 \(todayResearch.omittedItemCount) 个较低优先事项。")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .accessibilityIdentifier("todayResearchOmitted")
                }
            } else {
                Text(todayResearch.message)
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("todayResearchUnavailable")
            }
        }
        .padding(layout.cardPadding)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 8))
        .overlay {
            RoundedRectangle(cornerRadius: 8)
                .stroke(Color.orange.opacity(0.18), lineWidth: 1)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("todayResearchSection")
    }

    @MainActor
    private func openTodaySourceRecovery(_ destination: TodayResearchSourceRecoveryDestination) {
        switch destination {
        case .documents:
            selectedDecisionLayer = .evidence
            selectedEvidenceWorkspace = .documents
        case .frozenEvidence:
            selectedDecisionLayer = .evidence
            selectedEvidenceWorkspace = .frozen
        case .report:
            selectedDecisionLayer = .evidence
            selectedEvidenceWorkspace = .brief
        case .portfolio:
            selectedDecisionLayer = .portfolio
            selectedPortfolioWorkspace = .current
        }
    }

    @ViewBuilder
    private func todayResearchItem(_ item: TodayResearchItem) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline) {
                Text(item.title)
                    .font(.callout.weight(.semibold))
                Spacer()
                Text(item.trackingState.userLabel)
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(item.trackingState == .needsReview ? .orange : .secondary)
                    .accessibilityIdentifier("todayResearchTrackingState-\(item.order)")
            }
            Text(item.summary)
                .font(.caption)
                .fixedSize(horizontal: false, vertical: true)
            DisclosureGroup("来源与版本") {
                VStack(alignment: .leading, spacing: 4) {
                    Text("#\(item.order) · \(item.id)")
                        .accessibilityIdentifier("todayResearchIdentity-\(item.order)")
                    Text("来源：\(TodayResearchSourceNavigationTarget(item: item).displayLine)")
                        .accessibilityIdentifier("todayResearchSourceIdentity-\(item.order)")
                    Text(todayResearchVersionLine(item))
                        .accessibilityIdentifier("todayResearchVersions-\(item.order)")
                }
                .font(.caption2.monospaced())
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 4)
            }
            if let revision = item.reportRevision {
                Text(revision.previous.map { "报告版本 v\($0.version) → v\(revision.current.version)" } ?? "报告版本 v\(revision.current.version) · 首版")
                    .font(.caption.weight(.semibold))
                    .accessibilityIdentifier("todayResearchReportRevision-\(item.order)")
                Text("版本说明：\(revision.declaredChange)")
                    .font(.caption)
                    .accessibilityIdentifier("todayResearchReportDeclaredChange-\(item.order)")
                Text("结构化变化：\(revision.bindingChanged == nil ? "尚未完成可比判断" : revision.changedSections.isEmpty ? "未检测到" : revision.changedSections.joined(separator: "、"))")
                    .font(.caption)
                    .foregroundStyle(revision.changedSections.isEmpty ? Color.secondary : Color.orange)
                    .accessibilityIdentifier("todayResearchReportChangedSections-\(item.order)")
                Text(revision.bindingChanged.map { $0 ? "证据绑定：已变化" : "证据绑定：未变化" } ?? (revision.previous == nil ? "首版报告，暂无可比较的上一版" : "暂不可比较：历史报告格式不同，不能认定判断未变。"))
                    .font(.caption)
                    .foregroundStyle(revision.bindingChanged == true || revision.bindingChanged == nil ? Color.orange : Color.secondary)
                    .accessibilityIdentifier("todayResearchReportBinding-\(item.order)")
            }
            if let thesis = item.thesis {
                InfoBlock(title: "持仓/研究逻辑", value: thesis, valueIdentifier: "todayResearchThesis-\(item.order)")
            }
            if item.invalidationConditions.isEmpty == false {
                BulletList(title: "证伪条件", items: item.invalidationConditions)
            }
            if let versionChange = item.versionChange {
                InfoBlock(title: "相对上一版", value: versionChange, valueIdentifier: "todayResearchChange-\(item.order)")
            }
            if let checkpoint = item.nextCheckpoint {
                InfoBlock(title: "下一检查点", value: checkpoint, valueIdentifier: "todayResearchCheckpoint-\(item.order)")
            }
            Button {
                showDailyDecisionLayer(item.category == .holdingLogicChange ? .portfolio : .evidence)
            } label: {
                Label(item.category == .holdingLogicChange ? "查看资产影响" : "查看研究证据", systemImage: "arrow.right.circle")
            }
            .buttonStyle(.bordered)
            .accessibilityIdentifier("todayResearchOpen-\(item.order)")
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.tertiarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 8))
        .id("todayResearchItem:\(item.id)")
    }

    private func todayResearchVersionLine(_ item: TodayResearchItem) -> String {
        let facts = item.bindings.factRefs.map { "\($0.materialId):r\($0.revision):\($0.sourceVersion)" }.joined(separator: ",")
        let events = item.bindings.eventRefs.map { "\($0.eventId):v\($0.eventVersion)" }.joined(separator: ",")
        let monitor = item.bindings.monitorRef.map { "\($0.kind):\($0.id):v\($0.runVersion)" } ?? "none"
        let report = item.bindings.reportRef.map { "\($0.id):v\($0.version)" } ?? "none"
        let holdings = item.bindings.holdingSnapshotRefs.map(\.snapshotId).joined(separator: ",")
        return "member \(item.bindings.membershipId):v\(item.bindings.membershipVersion) · facts \(facts.isEmpty ? "none" : facts) · events \(events.isEmpty ? "none" : events) · monitor \(monitor) · report \(report) · holding \(holdings.isEmpty ? "none" : holdings)"
    }
}
