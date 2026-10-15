import Foundation
import SwiftUI
extension GateBResearchScreen {
    @ViewBuilder
    func deepResearchJourneyStatus(currentReport: TwoLayerReportData?) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            if twoLayerReportWorkspace.requests.isSaving {
                ProgressView("深度研究正在综合当前证据")
                Text("完成前不会确认报告、提交正式决定或触发交易。")
                    .font(OwnerReadingFont.caption)
                    .foregroundStyle(.secondary)
            } else if let failure = twoLayerReportWorkspace.failureMessage,
                      let retryAction = twoLayerReportWorkspace.retryAction {
                Label("本次深度研究未完成", systemImage: "exclamationmark.triangle.fill")
                    .font(OwnerReadingFont.subheadline.weight(.semibold))
                    .foregroundStyle(.orange)
                Text(failure)
                    .font(OwnerReadingFont.caption)
                    .accessibilityIdentifier("deepResearchFailureMessage")
                Button {
                    switch retryAction {
                    case .load:
                        Task { await loadTwoLayerReports() }
                    case .synthesis:
                        if twoLayerReportWorkspace.draft == nil {
                            createTwoLayerDraft()
                        } else {
                            Task { await saveTwoLayerDraft() }
                        }
                    case .absorption:
                        Task { await saveTwoLayerDraft() }
                    }
                } label: {
                    Label(
                        retryAction == .load
                            ? "明确重试读取"
                            : retryAction == .absorption
                                ? "用同一身份明确重试吸收"
                            : twoLayerReportWorkspace.draft == nil
                                ? "重新准备深度研究"
                                : twoLayerReportWorkspace.pendingSynthesisTask?.status == "failed"
                                    ? "沿用证据重试模型（可能产生费用）"
                                    : "重新读取同一任务",
                        systemImage: "arrow.clockwise"
                    )
                }
                .buttonStyle(.borderedProminent)
                .disabled(twoLayerReportWorkspace.isBusy)
                .accessibilityIdentifier("retryDeepResearchButton")
            } else if let task = twoLayerReportWorkspace.pendingSynthesisTask {
                let isRunning = task.status == "pending" || task.status == "running"
                let isCanceled = task.status == "canceled"
                let isFailed = task.status == "failed"
                let isSucceeded = task.status == "succeeded"
                let packVersion = task.snapshotBinding?.evidencePackVersion
                    ?? (currentTwoLayerReportPack?.id == task.evidencePackId
                        ? currentTwoLayerReportPack?.version
                        : nil)
                let startedText = task.startedAt.map { " · 开始 \(compactUtcDateTime($0))" } ?? ""
                let completedText = task.completedAt.map { " · 完成 \(compactUtcDateTime($0))" } ?? ""
                let packVersionText = packVersion.map { " v\($0)" } ?? ""
                Label(
                    isCanceled ? "本次深度研究已结束" : isFailed ? "本次深度研究失败" : isRunning ? "深度研究正在运行" : isSucceeded ? "深度研究已吸收到报告" : "深度研究综合已完成",
                    systemImage: isCanceled || isFailed ? "xmark.circle" : isRunning ? "clock.arrow.circlepath" : "checkmark.shield.fill"
                )
                    .font(OwnerReadingFont.subheadline.weight(.semibold))
                    .foregroundStyle(isFailed ? Color.orange : isCanceled ? Color.secondary : isRunning ? Color.blue : Color.green)
                Text(isFailed
                     ? "任务 #\(task.id) 未完成。\(deepResearchTaskFailureMessage(task))"
                     : isCanceled
                     ? "任务 #\(task.id) \(task.errorCode == "user_rejected" ? "未被采用" : task.errorCode == "material_deleted" ? "因来源材料删除而失效" : "已取消")；没有生成报告。重新开始需要你再次明确确认。"
                     : isRunning
                        ? "任务 #\(task.id) 已保存；可以离开本页，稍后回来刷新，不会重复发起。"
                     : isSucceeded
                        ? "任务 #\(task.id) 已在同一 Owner 的另一客户端吸收到报告；请读取当前报告核对。"
                        : "任务 #\(task.id) 已绑定当前证据快照；尚未写入报告。请明确吸收后再审阅报告。")
                    .font(OwnerReadingFont.caption)
                Text(
                    "创建 \(compactUtcDateTime(task.createdAt))"
                        + startedText
                        + completedText
                )
                    .font(OwnerReadingFont.caption2)
                    .foregroundStyle(.secondary)
                Text(
                    "任务更新 \(compactUtcDateTime(task.updatedAt)) · 最近读取 "
                        + (twoLayerReportWorkspace.synthesisTaskLastReadAt.map {
                            $0.formatted(date: .omitted, time: .standard)
                        } ?? "等待前台刷新")
                )
                    .font(OwnerReadingFont.caption2)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("deepResearchTaskFreshness")
                if isRunning && twoLayerReportWorkspace.synthesisTaskAutoRefreshPaused {
                    Text("前台自动刷新已暂停；任务仍已保存，点击“刷新任务状态”继续。")
                        .font(OwnerReadingFont.caption2)
                        .foregroundStyle(.orange)
                }
                if let previousTaskId = task.previousTaskId {
                    Text("续自任务 #\(previousTaskId)；旧任务状态和证据绑定保持不变。")
                        .font(OwnerReadingFont.caption2)
                        .foregroundStyle(.secondary)
                }
                Text(
                    "cutoff \(compactUtcDateTime(task.intent.cutoffAt))"
                        + " · pack #\(task.evidencePackId)"
                        + packVersionText
                        + " · SHA \(task.evidencePackFingerprint.prefix(12))…"
                )
                    .font(OwnerReadingFont.caption2.monospaced())
                    .textSelection(.enabled)
                if let duration = deepResearchTaskDurationSeconds(
                    startedAt: task.startedAt,
                    completedAt: task.completedAt
                ) {
                    Text("实际耗时 \(duration) 秒 · 尝试 \(task.attemptCount)/3")
                        .font(OwnerReadingFont.caption2)
                        .foregroundStyle(.secondary)
                } else {
                    Text(
                        task.status == "pending"
                            ? "等待开始 · 时限 \(task.intent.maxDurationSeconds ?? 60) 秒"
                            : "处理中 · 时限 \(task.intent.maxDurationSeconds ?? 60) 秒 · 尝试 \(task.attemptCount)/3"
                    )
                        .font(OwnerReadingFont.caption2)
                        .foregroundStyle(.secondary)
                }
                if let synthesis = task.synthesis {
                    Text("provider=\(synthesis.provider) · model=\(synthesis.model) · tokens=\(synthesis.tokenUsage) · cost=\(synthesis.cost)")
                        .font(OwnerReadingFont.caption2.monospaced())
                        .textSelection(.enabled)
                    if task.previousTaskId != nil || task.attemptCount > 1 {
                        Text("全部发送尝试累计 tokens/cost = UNKNOWN；至少一次历史尝试缺少可核验提供方回执。")
                            .font(OwnerReadingFont.caption2)
                            .foregroundStyle(.orange)
                    }
                    if let manifest = synthesis.sendManifest {
                        DisclosureGroup("\(task.status == "failed" ? "本次发送尝试清单（提供方是否收到仍 UNKNOWN）" : "本次实际发送清单") · \(manifest.selectedMaterialIds.count) 份材料") {
                            Text("本地准备时间：\(manifest.preparedAt ?? "UNKNOWN")")
                            Text("材料 ID：\(manifest.selectedMaterialIds.joined(separator: ", "))")
                            Text("结构化分区：\(manifest.includedStructuredSections.joined(separator: ", "))")
                            Text("来源绑定 \(manifest.sourceBindingCount) 项 · payload \(manifest.payloadFields.joined(separator: ", "))")
                            if let input = manifest.inputTokenUpperBound,
                               let output = manifest.maxOutputTokens,
                               let cost = manifest.estimatedMaxCostUsd,
                               let pricing = manifest.pricingIdentity {
                                Text("发送前成本上界：输入 ≤\(input) tokens（按 UTF-8 字节数保守估算）+ 输出 ≤\(output) tokens · 最多约 US$\(String(format: "%.8f", cost)) · \(pricing)")
                            }
                            Text("policy \(manifest.policyVersion) · request SHA \(manifest.requestBodySha256)")
                                .monospaced()
                                .textSelection(.enabled)
                            Text(manifest.policySnapshot?.sendManifestSummary ?? "历史发送未固化地区、保留与训练条款。")
                            Text(manifest.sendAuthorization?.sendAuthorizationSummary ?? "历史发送未固化发送时 Owner 授权状态。")
                            Text("未发送整份 PDF、凭据或正式资产事实。")
                                .foregroundStyle(.secondary)
                        }
                        .font(OwnerReadingFont.caption2)
                        .accessibilityIdentifier("deepResearchSendManifest")
                    } else {
                        Text("历史任务未记录逐次发送清单。")
                            .font(OwnerReadingFont.caption2)
                            .foregroundStyle(.secondary)
                    }
                }
                if isCanceled || isFailed {
                    Button {
                        createTwoLayerDraft()
                    } label: {
                        Label("重新准备深度研究", systemImage: "sparkles")
                    }
                    .buttonStyle(.bordered)
                    .disabled(twoLayerReportWorkspace.isBusy)
                } else if isSucceeded {
                    Button {
                        Task { await loadTwoLayerReports() }
                    } label: {
                        Label("读取当前报告", systemImage: "doc.text.magnifyingglass")
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(twoLayerReportWorkspace.isBusy)
                    .accessibilityIdentifier("readAbsorbedDeepResearchReportButton")
                } else {
                    HStack {
                        Button {
                            Task {
                                if isRunning {
                                    await refreshDeepResearchTaskStatus()
                                } else {
                                    await saveTwoLayerDraft()
                                }
                            }
                        } label: {
                            Label(isRunning ? "刷新任务状态" : "吸收到研究报告", systemImage: isRunning ? "arrow.clockwise" : "tray.and.arrow.down")
                        }
                        .buttonStyle(.borderedProminent)
                        .accessibilityIdentifier("absorbDeepResearchButton")
                        .id("absorbDeepResearchButton")
                        Button("稍后处理") {
                            deferDeepResearchTask()
                        }
                        .buttonStyle(.bordered)
                        .accessibilityIdentifier("deferDeepResearchTaskButton")
                        Button(isRunning ? "取消任务" : "不采用结果", role: .destructive) {
                            Task {
                                await cancelDeepResearchTask(
                                    reason: isRunning ? "user_canceled" : "user_rejected"
                                )
                            }
                        }
                        .buttonStyle(.bordered)
                        .accessibilityIdentifier("cancelDeepResearchTaskButton")
                    }
                    .disabled(twoLayerReportWorkspace.isBusy)
                }
                Text(twoLayerReportWorkspace.message)
                    .font(OwnerReadingFont.caption2)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("twoLayerReportMessage")
            } else if let currentReport {
                Label("深度研究结果已返回", systemImage: "checkmark.circle.fill")
                    .font(OwnerReadingFont.subheadline.weight(.semibold))
                    .foregroundStyle(.green)
                Text(currentReport.isFormalizable
                     ? "请先审阅结论与失效条件，再决定是否追问、吸收到研究档案或明确确认报告。"
                     : "结论仍不完整；请查看对应缺失项，补充证据后再修订。")
                Text(twoLayerReportWorkspace.message)
                    .font(OwnerReadingFont.caption2)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("twoLayerReportMessage")
            } else if twoLayerReportWorkspace.draft != nil {
                Label("当前证据已就绪，等待你发起", systemImage: "checkmark.shield")
                    .font(OwnerReadingFont.subheadline.weight(.semibold))
                Text("发起后会显示运行状态；结果返回后仍需你审阅并明确决定。")
                    .font(OwnerReadingFont.caption)
                    .foregroundStyle(.secondary)
            } else if currentTwoLayerReportPack?.currentness.status == "current" {
                Text("当前证据已冻结，可以准备一次新的深度研究。")
                    .font(OwnerReadingFont.callout)
                Button {
                    createTwoLayerDraft()
                } label: {
                    Label("准备深度研究", systemImage: "sparkles")
                }
                .buttonStyle(.borderedProminent)
                .disabled(twoLayerReportWorkspace.isBusy)
                .accessibilityIdentifier("prepareDeepResearchButton")
            } else if frozenResearchEvidenceWorkspace.envelope?.data?.completion.state == "materials_required" {
                Text("下一步：导入并核对官方 PDF 原文，再返回这里冻结证据。")
                    .font(OwnerReadingFont.callout)
                    .foregroundStyle(.secondary)
            } else if frozenResearchEvidenceWorkspace.envelope?.data?.completion.state == "pack_required" {
                Text("下一步：核对最新估值与日线技术，由你明确冻结当前证据版本。")
                    .font(OwnerReadingFont.callout)
                    .foregroundStyle(.secondary)
            } else {
                Text("下一步：补齐当前研究证据并冻结版本，再发起深度研究。")
                    .font(OwnerReadingFont.callout)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(10)
        .background(Color.accentColor.opacity(0.08), in: RoundedRectangle(cornerRadius: 8))
        .id("deepResearchJourneyStatus")
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("deepResearchJourneyStatus")
    }

    func reportFactSourceLabel(_ fact: TwoLayerReportFact) -> String {
        let source = switch fact.sourceKind {
        case "material": "原始材料"
        case "valuation_context": "冻结估值"
        case "technical_context": "冻结技术证据"
        case "quant_portfolio_context": "冻结量化与组合风险"
        case "research_context": fact.citation?.sourceType == "futu_opend_financial_statement_provider"
            ? "同行 OpenD 第三方未核实原件" : "冻结研究档案"
        default: "报告证据"
        }
        let stance = switch fact.stance {
        case "support": "支持"
        case "refute": "反证"
        case "neutral": "中性"
        default: "待核实"
        }
        return "引用来源：\(source) · 原材料标注：\(stance)"
    }

    func twoLayerReportErrorMessage(_ error: Error) -> String {
        if case FrozenResearchEvidenceClientError.taskFailure(let code) = error {
            return deepResearchTaskFailureDescription(code).1
        }
        if error as? FrozenResearchEvidenceClientError == .providerUnavailable {
            return "AI 服务当前不可用；冻结证据仍已保存，恢复后可明确重试生成报告。"
        }
        if error as? FrozenResearchEvidenceClientError == .taskFailed {
            return "研究任务已明确失败；请核对证据后重新发起。"
        }
        if error as? FrozenResearchEvidenceClientError == .bindingDrift {
            return "研究对象或冻结证据已变化；旧状态已清除，请刷新后重新准备。"
        }
        if case FrozenResearchEvidenceClientError.httpStatus(let status) = error {
            switch status {
            case 401, 403:
                return "当前授权不可用；旧报告状态已清除。"
            case 404:
                return "当前研究对象或报告不存在；旧结果已清除。"
            case 409:
                return "研究对象、冻结证据或请求身份发生冲突；请刷新后重试。"
            case 422:
                return "报告未通过证据绑定或结构门禁；没有显示保存或决定成功。"
            default:
                return "深度研究服务暂不可用；旧成功状态已清除。"
            }
        }
        if let urlError = error as? URLError {
            switch urlError.code {
            case .notConnectedToInternet:
                return "当前离线；本次深度研究未完成。"
            case .timedOut, .networkConnectionLost, .cannotConnectToHost, .cannotFindHost:
                return "网络连接中断或超时；可用同一请求明确重试。"
            default:
                return "网络请求失败；本次深度研究未完成。"
            }
        }
        return "两层报告响应缺失、漂移或无法严格解码；旧成功态已清除。"
    }

    func todayReadyTaskNavigationMatches(
        item: TodayResearchItem,
        target: TodayResearchNavigationTarget
    ) -> Bool {
        guard let task = target.task, let pack = item.bindings.evidencePackRef else { return false }
        return target.report == nil
            && item.category == .userAction
            && task.evidencePackId == pack.id
            && task.evidencePackFingerprint == pack.packFingerprint
            && target.source.lane == "research"
            && target.source.id == item.id
            && target.source.sourceType == "deep_research_tasks"
            && target.source.sourceFingerprint == task.requestFingerprint
    }

    func todayResearchNavigationMatches(
        item: TodayResearchItem,
        target: TodayResearchNavigationTarget
    ) -> Bool {
        if target.task != nil && target.report == nil {
            return todayReadyTaskNavigationMatches(item: item, target: target)
        }
        if target.source.matches(item) { return true }
        return false
    }

    func todayResearchTargetBindingMatches(
        item: TodayResearchItem,
        target: TodayResearchNavigationTarget
    ) -> Bool {
        if target.task != nil && target.report == nil {
            return todayReadyTaskNavigationMatches(item: item, target: target)
        }
        return item.bindings.reportRef?.id == target.report?.id
            && item.bindings.reportRef?.version == target.report?.version
            && item.bindings.reportRef?.evidencePackId == target.report?.evidencePackId
    }

    @MainActor
    func openReadyDeepResearchTaskFromToday(
        target: TodayResearchNavigationTarget,
        item: TodayResearchItem,
        membership: CandidateMembershipData,
        authorizationRevision: UUID
    ) async -> Bool {
        guard let taskTarget = target.task else { return false }
        await loadTwoLayerReports()
        guard requestedTodayResearchTarget == target,
              dailyClientAuthorizationIsCurrent(authorizationRevision),
              selectedMembership?.id == membership.id,
              selectedMembership?.version == membership.version,
              let pack = currentTwoLayerReportPack,
              pack.id == taskTarget.evidencePackId,
              pack.packFingerprint == taskTarget.evidencePackFingerprint,
              pack.currentness.status == "current",
              let requestBody = pack.deterministicTwoLayerRequest(
                idempotencyKey: "ios-ready-task-readback-\(taskTarget.id)"
              ) else {
            clearRequestedTodayResearchTarget(
                "Today 中的待吸收任务已不再绑定当前证据版本；没有打开旧综合结果。"
            )
            return false
        }
        do {
            let task = try await client.fetchDeepResearchTask(
                membership: membership,
                taskId: taskTarget.id,
                requestBody: requestBody,
                expectedRequestFingerprint: taskTarget.requestFingerprint
            )
            guard requestedTodayResearchTarget == target,
                  dailyClientAuthorizationIsCurrent(authorizationRevision),
                  !Task.isCancelled,
                  selectedMembership?.id == membership.id,
                  selectedMembership?.version == membership.version,
                  ["pending", "running", "ready_to_absorb"].contains(task.status),
                  task.evidencePackId == taskTarget.evidencePackId,
                  task.evidencePackFingerprint == taskTarget.evidencePackFingerprint else {
                clearRequestedTodayResearchTarget("Today 待吸收任务状态已变化；请重新读取最新 Today。")
                return false
            }
            let source = target.source
            pendingTodayResearchReportSaveReservation = TodayResearchReportSaveReservation(
                itemId: item.id,
                membershipId: membership.id,
                membershipVersion: membership.version,
                symbol: membership.symbol,
                actorId: membership.actorId,
                sourceLane: source.lane,
                sourceId: source.id,
                sourceVersion: source.version,
                sourceType: source.sourceType,
                sourceFingerprint: source.sourceFingerprint,
                evidencePackId: pack.id,
                evidencePackVersion: pack.version,
                evidencePackFingerprint: pack.packFingerprint,
                authorizationRevision: authorizationRevision
            )
            twoLayerReportWorkspace.draft = TwoLayerEditableDraft(
                baseRequest: requestBody,
                taskIntent: task.intent
            )
            twoLayerReportWorkspace.pendingSynthesisTask = task
            twoLayerReportWorkspace.saveReservation.clear()
            twoLayerReportWorkspace.retryReservation.clear()
            twoLayerReportWorkspace.absorptionReservation.clear()
            twoLayerReportWorkspace.message = switch task.status {
            case "ready_to_absorb": "任务 #\(task.id) 已核对；综合结果等待你明确吸收到报告。"
            case "pending", "running": "任务 #\(task.id) 已核对，仍在处理中；刷新状态不会重复发起。"
            default: "任务 #\(task.id) 已核对。"
            }
            selectedDecisionLayer = .evidence
            selectedEvidenceWorkspace = .brief
            pendingDecisionWorkspaceScrollTarget = "absorbDeepResearchButton"
            return true
        } catch {
            guard requestedTodayResearchTarget == target,
                  dailyClientAuthorizationIsCurrent(authorizationRevision),
                  !Task.isCancelled,
                  selectedMembership?.id == membership.id,
                  selectedMembership?.version == membership.version else { return false }
            clearRequestedTodayResearchTarget(
                "无法核对 Today 中的待吸收任务；没有使用旧任务状态。"
            )
            return false
        }
    }

    func todayResearchReportSaveSuccess(
        _ envelope: TodayResearchEnvelope,
        reservation: TodayResearchReportSaveReservation,
        report: TwoLayerReportData
    ) -> Bool {
        guard envelope.status == .available,
              envelope.membershipId == reservation.membershipId,
              envelope.membershipVersion == reservation.membershipVersion,
              envelope.requestedSymbol == reservation.symbol,
              envelope.requestedActorId == reservation.actorId,
              envelope.items.contains(where: { $0.id == reservation.itemId }) == false,
              let item = envelope.items.first(where: {
                  $0.symbol == reservation.symbol
                      && $0.trackingState == .awaitingUserConfirmation
                      && $0.bindings.reportRef?.id == report.id
                      && $0.bindings.reportRef?.version == report.version
                      && $0.bindings.reportRef?.evidencePackId == report.evidencePackId
              }),
              let pack = item.bindings.evidencePackRef,
              pack.id == reservation.evidencePackId,
              pack.version == reservation.evidencePackVersion,
              pack.packFingerprint == reservation.evidencePackFingerprint,
              envelope.quality?.researchStructure.reportRef?.id == report.id,
              envelope.quality?.researchStructure.reportRef?.version == report.version else {
            return false
        }
        let source = TodayResearchSourceNavigationTarget(item: item)
        return source.lane == "research"
            && source.id == report.id
            && source.version == report.version
            && source.sourceType == "deep_research_reports"
            && source.sourceFingerprint == report.reportFingerprint
    }

    func todayResearchSaveReservationMatchesCurrentToday(
        _ reservation: TodayResearchReportSaveReservation,
        membership: CandidateMembershipData
    ) -> Bool {
        guard todayResearch.status == .available,
              reservation.authorizationRevision == viewModel.authorizationRevision,
              todayResearch.membershipId == reservation.membershipId,
              todayResearch.membershipVersion == reservation.membershipVersion,
              todayResearch.requestedSymbol == reservation.symbol,
              todayResearch.requestedActorId == membership.actorId,
              reservation.actorId == membership.actorId,
              let item = todayResearch.items.first(where: { $0.id == reservation.itemId }),
              (item.trackingState == .needsResearch || reservation.sourceType == "deep_research_tasks"),
              item.bindings.membershipId == membership.id,
              item.bindings.membershipVersion == membership.version,
              item.symbol == membership.symbol,
              let pack = item.bindings.evidencePackRef,
              pack.id == reservation.evidencePackId,
              pack.version == reservation.evidencePackVersion,
              pack.packFingerprint == reservation.evidencePackFingerprint else {
            return false
        }
        let source = TodayResearchSourceNavigationTarget(item: item)
        let sourceMatches = source.lane == reservation.sourceLane
            && source.id == reservation.sourceId
            && source.version == reservation.sourceVersion
            && source.sourceType == reservation.sourceType
            && source.sourceFingerprint == reservation.sourceFingerprint
        let completedTaskSourceMatches = reservation.sourceLane == "research"
            && reservation.sourceId == item.id
            && reservation.sourceVersion == nil
            && reservation.sourceType == "deep_research_tasks"
            && reservation.sourceFingerprint != nil
        return sourceMatches || completedTaskSourceMatches
    }
}
