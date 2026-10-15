import SwiftUI

extension GateBResearchScreen {
    var currentSessionDraft: LocalDecisionDraft? {
        guard let symbol = parsedSymbol?.canonical,
              localDecisionDraft?.isBound(to: symbol) == true else {
            return nil
        }
        return localDecisionDraft
    }

    var canSubmitSessionDraftDecision: Bool {
        !submissionState.isInFlight
            && decisionContext?.research.status == "available"
            && sessionDraftAdoption.isCurrent(
                draft: currentSessionDraft,
                context: decisionContext,
                correction: sessionDraftCorrection
            )
    }

    @MainActor
    func invalidateSessionDraftAdoption() {
        sessionDraftAdoption.invalidate()
        submissionState.resetForNewCheck()
        sessionDraftMessage = nil
    }

    @MainActor
    func adoptSessionDraftForFormalDecision() {
        guard let context = decisionContext,
              context.research.status == "available",
              sessionDraftAdoption.adopt(
            draft: currentSessionDraft,
            context: context,
            correction: sessionDraftCorrection
        ) else {
            sessionDraftMessage = "当前标的、研究证据、规范决策上下文或人工修正不可用；尚未采用。"
            return
        }
        submissionState.resetForNewCheck()
        sessionDraftMessage = "已明确采用当前标的、草稿、人工修正与规范上下文；尚未上传。"
    }

    @MainActor
    func submitSessionDraftFormalDecision() async {
        guard let symbol = parsedSymbol,
              let context = decisionContext,
              context.research.status == "available",
              let binding = sessionDraftAdoption.binding,
              binding.matches(
                draft: currentSessionDraft,
                context: context,
                correction: sessionDraftCorrection
              ) else {
            sessionDraftMessage = "请先明确采用当前标的、草稿、人工修正与规范上下文；当前请求未发送。"
            return
        }
        let finalDecision = binding.formalDecisionText
        let fingerprint = DecisionCheckSubmissionFingerprint(
            contextId: context.contextId,
            contextHash: context.contextHash,
            sessionDraftBinding: binding,
            actionIntent: actionIntent.rawValue,
            humanCheckResult: humanCheckResult.rawValue,
            userFinalDecision: finalDecision
        )
        guard let pending = submissionState.begin(fingerprint: fingerprint) else { return }
        let authorizationRevision = viewModel.authorizationRevision
        sessionDraftMessage = "正在提交正式决定；这不是订单或交易。"

        do {
            let response = try await client.createDecisionCheck(
                market: symbol.market,
                code: symbol.code,
                request: CreateDecisionCheckRequest(
                    decisionContextSchemaVersion: context.schemaVersion,
                    contextId: pending.fingerprint.contextId,
                    contextHash: pending.fingerprint.contextHash,
                    actionIntent: pending.fingerprint.actionIntent,
                    humanCheckResult: pending.fingerprint.humanCheckResult,
                    userFinalDecision: pending.fingerprint.userFinalDecision,
                    reviewedAt: nil,
                    idempotencyKey: pending.idempotencyKey
                )
            )
            guard dailyClientAuthorizationIsCurrent(authorizationRevision) else {
                _ = submissionState.finishFailurePreservingRetry(for: pending)
                return
            }
            let responseIsCurrent = submissionState.isCurrent(pending)
                && sessionDraftAdoption.isCurrent(
                    draft: currentSessionDraft,
                    context: decisionContext,
                    correction: sessionDraftCorrection
                )
                && parsedSymbol?.canonical == symbol.canonical
                && response.data.symbol == symbol.canonical
                && response.data.contextId == context.contextId
                && response.data.contextHash == context.contextHash
            let accepted = submissionState.finishSuccessOrReplay(for: pending)
            guard responseIsCurrent, accepted,
                  localDecisionDraft == binding.draft else {
                clearSubmittedDecision()
                sessionDraftMessage = "正式决定已提交，但当前标的、草稿或上下文已变化；保留当前草稿且不跳转。"
                return
            }

            submittedDecision = response.data
            submittedDecisionSymbol = symbol.canonical
            localDecisionDraft = nil
            sessionDraftAdoption.invalidate()
            sessionDraftMessage = AppEnvironment.isFixtureFormalDecisionDemo
                ? "测试样本 / 非真实正式事件：mock 成功仅验证客户端流程。"
                : response.message
            todayRefreshRevision &+= 1
            selectedTab = .today
        } catch {
            guard dailyClientAuthorizationIsCurrent(authorizationRevision) else {
                _ = submissionState.finishFailurePreservingRetry(for: pending)
                return
            }
            guard submissionState.finishFailurePreservingRetry(for: pending) else { return }
            clearSubmittedDecision()
            sessionDraftMessage = decisionWriteFailurePresentation(
                for: error,
                operation: .humanCheck
            ).message
        }
    }

    func sessionDraftFormalDecisionSection() -> some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionTitle("会话草稿 → 研究判断")
            Text("人工修正是本次 App 会话内的可编辑文本：未上传、非模型生成，也不是模型对话 runtime。采用与正式提交是两个独立动作。")
                .font(.caption)
                .foregroundStyle(.secondary)
                .accessibilityIdentifier("sessionDraftCorrectionBoundary")

            if AppEnvironment.isFixtureFormalDecisionDemo {
                Text("测试样本 / 非真实正式事件：当前仅演示 mock 客户端闭环，不证明真实数据库、provider 或 runtime。")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.orange)
                    .accessibilityIdentifier("sessionDraftFixtureBoundary")
            }

            if let draft = currentSessionDraft {
                InfoBlock(title: "草稿标的", value: draft.symbol, valueIdentifier: "sessionDraftSymbol")
                InfoBlock(title: "草稿逻辑", value: draft.thesis, valueIdentifier: "sessionDraftThesis")
                InfoBlock(title: "行动计划（不执行）", value: draft.actionPlan, valueIdentifier: "sessionDraftActionPlan")
                InfoBlock(title: "草稿边界", value: "\(draft.authority) · session-local · not_uploaded · \(draft.executionStatus)")
                TextField("人工修正（必填，非模型生成）", text: $sessionDraftCorrection, axis: .vertical)
                    .textFieldStyle(.roundedBorder)
                    .lineLimit(2...6)
                    .focused($isSessionDraftCorrectionFocused)
                    .submitLabel(.done)
                    .onSubmit { isSessionDraftCorrectionFocused = false }
                    .accessibilityIdentifier("sessionDraftCorrection")

                Button("采用当前草稿与规范上下文") {
                    adoptSessionDraftForFormalDecision()
                }
                .buttonStyle(.bordered)
                .disabled(decisionContext?.requestedSymbol != draft.symbol || decisionContext?.research.status != "available" || submissionState.isInFlight)
                .accessibilityIdentifier("sessionDraftAdopt")

                Picker("actionIntent（建议/决定，非订单）", selection: $actionIntent) {
                    ForEach(DecisionActionIntent.clientVisibleCases) { intent in
                        Text(sessionDraftActionIntentLabel(intent)).tag(intent)
                    }
                }
                .pickerStyle(.menu)
                .accessibilityIdentifier("sessionDraftActionIntent")

                Picker("humanCheckResult", selection: $humanCheckResult) {
                    ForEach(HumanCheckResult.allCases) { result in
                        Text(result.label).tag(result)
                    }
                }
                .pickerStyle(.menu)
                .accessibilityIdentifier("sessionDraftHumanCheckResult")

                Text("当前值：\(actionIntent.rawValue) + \(humanCheckResult.rawValue)。这是建议/决定记录，不会创建订单、交易、现金、费用、持仓或券商动作。")
                    .font(.caption)
                    .foregroundStyle(.orange)
                    .accessibilityIdentifier("sessionDraftNoEffects")

                Button {
                    Task { await submitSessionDraftFormalDecision() }
                } label: {
                    Label(submissionState.isInFlight ? "提交中" : "明确提交研究判断", systemImage: "checkmark.seal")
                }
                .buttonStyle(.borderedProminent)
                .disabled(!canSubmitSessionDraftDecision)
                .accessibilityIdentifier("sessionDraftSubmit")
            } else if let localDecisionDraft {
                Text("当前仅有其他标的 \(localDecisionDraft.symbol) 的会话草稿；不会展示、采用、覆盖或提交到当前标的。")
                    .font(.callout)
                    .foregroundStyle(.orange)
                    .accessibilityIdentifier("sessionDraftOtherSymbol")
            } else {
                Text("当前标的没有会话内草稿。可从资产页形成非正式草稿后回到研究页。")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("sessionDraftUnavailable")
            }

            if let sessionDraftMessage {
                Text(sessionDraftMessage)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("sessionDraftMessage")
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.secondarySystemGroupedBackground))
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .toolbar {
            ToolbarItemGroup(placement: .keyboard) {
                Spacer()
                Button {
                    isSessionDraftCorrectionFocused = false
                } label: {
                    Label("收起人工修正键盘", systemImage: "keyboard.chevron.compact.down")
                }
                .accessibilityIdentifier("sessionDraftCorrectionKeyboardDone")
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("sessionDraftFormalDecisionSection")
    }

    private func sessionDraftActionIntentLabel(_ value: DecisionActionIntent) -> String {
        "\(value.label)（仅研究，不执行）"
    }
}
