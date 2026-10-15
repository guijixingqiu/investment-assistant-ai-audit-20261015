import SwiftUI

extension GateBResearchScreen {
    func assistMobileWorkspaceModel() -> AssistMobileWorkspaceRenderModel {
        assistMobileWorkspaceRenderModel(
            selectedMembership: selectedMembership,
            candidateMembershipMetadata: candidateMemberships.metadata,
            researchProfile: envelope,
            decisionContext: decisionContext,
            decisionContextMessage: decisionContextMessage,
            decisionReviewHistory: decisionReviewHistory,
            decisionIntake: decisionIntakeModel,
            advisoryScope: advisoryScopeModel,
            humanReviewWorkspace: humanReviewWorkspaceModel,
            followUpWorkflow: reviewFollowUpWorkflowModel,
            decisionNoteWorkflow: decisionNoteWorkflowModel,
            pinganSnapshot: pinganSnapshot,
            pinganSnapshotMessage: pinganSnapshotMessage,
            drafts: AssistMobileWorkspaceLocalDraftState(
                followUpManualNoteDraft: reviewFollowUpDrafts.manualNote,
                followUpLaterReviewDraft: reviewFollowUpDrafts.laterReview,
                followUpEvidenceGapChecklistDraft: reviewFollowUpDrafts.evidenceGapChecklist,
                decisionNoteDraft: decisionNoteDrafts.decisionNote
            ),
            localRecordDrafts: localRecordDrafts,
            localRecordSnapshotSummary: localRecordSnapshotSummary,
            isLoading: isLoadingMobileWorkspace
        )
    }

    func assistMobileWorkspaceSection() -> some View {
        let workspaceModel = assistMobileWorkspaceModel()

        return VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                SectionTitle("ASSIST-1 移动工作台")
                    .accessibilityIdentifier("assistMobileWorkspaceTitle")
                Spacer()
                Text(workspaceModel.loadingState.rawValue)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(workspaceModel.loadingState == .loading ? .blue : .secondary)
                    .accessibilityIdentifier("assistMobileWorkspaceLoadingState")
            }

            VStack(alignment: .leading, spacing: 8) {
                Text("日常使用快照")
                    .font(.callout.weight(.semibold))
                InfoBlock(title: "状态", value: workspaceModel.dailyUseStatus, valueIdentifier: AssistMobileWorkspaceAccessibility.dailyUseStatus)
                InfoBlock(title: "当前候选", value: workspaceModel.currentCandidateSummary, valueIdentifier: AssistMobileWorkspaceAccessibility.currentCandidateSummary)
                InfoBlock(title: "研究摘要", value: workspaceModel.conciseResearchSummary, valueIdentifier: AssistMobileWorkspaceAccessibility.conciseResearchSummary)
                InfoBlock(title: "决策上下文", value: workspaceModel.conciseDecisionContextSummary, valueIdentifier: AssistMobileWorkspaceAccessibility.conciseDecisionContextSummary)
                InfoBlock(title: "本地草稿状态", value: workspaceModel.localDraftStatus, valueIdentifier: AssistMobileWorkspaceAccessibility.localDraftStatus)
                InfoBlock(title: "证据缺口状态", value: workspaceModel.evidenceGapStatus, valueIdentifier: AssistMobileWorkspaceAccessibility.evidenceGapStatus)
                InfoBlock(title: "可用状态", value: workspaceModel.availabilityStatus, valueIdentifier: AssistMobileWorkspaceAccessibility.availabilityStatus)
                InfoBlock(title: "安全短句", value: workspaceModel.safetyShortCopy, valueIdentifier: AssistMobileWorkspaceAccessibility.safetyShortCopy)
                BulletList(title: "来源权威标签", items: workspaceModel.dailyUseAuthorityBadges)
                    .accessibilityIdentifier(AssistMobileWorkspaceAccessibility.dailyUseAuthorityBadges)
                BulletList(title: "日常快捷动作", items: workspaceModel.dailyUseQuickActions)
                    .accessibilityIdentifier(AssistMobileWorkspaceAccessibility.dailyUseQuickActions)
                BulletList(title: "日常复核路径", items: workspaceModel.dailyUseReviewPathRail)
                    .accessibilityIdentifier(AssistMobileWorkspaceAccessibility.dailyUseReviewPathRail)
            }
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier(AssistMobileWorkspaceAccessibility.dailyUseSnapshot)

            InfoBlock(title: "选中候选", value: workspaceModel.selectedCandidate, valueIdentifier: AssistMobileWorkspaceAccessibility.selectedCandidate)
            InfoBlock(title: "当前关注", value: workspaceModel.currentFocus, valueIdentifier: AssistMobileWorkspaceAccessibility.currentFocus)
            InfoBlock(title: "下一步本地查看", value: workspaceModel.nextLocalAction, valueIdentifier: AssistMobileWorkspaceAccessibility.nextLocalAction)
            InfoBlock(title: "日常复核路径", value: workspaceModel.dailyReviewPath, valueIdentifier: AssistMobileWorkspaceAccessibility.dailyReviewPath)
            InfoBlock(title: "研究证据清晰度", value: workspaceModel.researchEvidenceClarity, valueIdentifier: AssistMobileWorkspaceAccessibility.researchEvidenceClarity)
            InfoBlock(title: "成员状态", value: workspaceModel.candidateMembershipState, valueIdentifier: "assistMobileWorkspaceMembershipState")
            InfoBlock(title: "研究画像", value: workspaceModel.researchProfileSummary, valueIdentifier: AssistMobileWorkspaceAccessibility.researchProfile)
            InfoBlock(title: "决策上下文", value: workspaceModel.decisionContextSummary, valueIdentifier: AssistMobileWorkspaceAccessibility.decisionContext)
            InfoBlock(title: "决策准备", value: workspaceModel.decisionIntakeSummary, valueIdentifier: AssistMobileWorkspaceAccessibility.decisionIntake)
            InfoBlock(title: "ASSIST 范围", value: workspaceModel.advisoryScopeSummary, valueIdentifier: AssistMobileWorkspaceAccessibility.advisoryScope)
            InfoBlock(title: "人工复核工作台", value: workspaceModel.humanReviewWorkspaceSummary, valueIdentifier: AssistMobileWorkspaceAccessibility.humanReviewWorkspace)
            InfoBlock(title: "复核后续", value: workspaceModel.followUpWorkflowSummary, valueIdentifier: AssistMobileWorkspaceAccessibility.followUpWorkflow)
            InfoBlock(title: "Decision note", value: workspaceModel.decisionNoteSummary, valueIdentifier: AssistMobileWorkspaceAccessibility.decisionNoteWorkflow)
            InfoBlock(title: "Note / follow-up 状态", value: workspaceModel.decisionNoteFollowUpStatus, valueIdentifier: AssistMobileWorkspaceAccessibility.decisionNoteFollowUpStatus)
            InfoBlock(title: "平安边界", value: workspaceModel.pinganHistoricalOnlyBoundary, valueIdentifier: "assistMobileWorkspacePinganHistoricalOnly")
            InfoBlock(title: "组合边界", value: workspaceModel.portfolioOmittedBoundary, valueIdentifier: "assistMobileWorkspacePortfolioOmitted")
            InfoBlock(title: "组合权威边界", value: workspaceModel.portfolioAuthorityBoundary, valueIdentifier: AssistMobileWorkspaceAccessibility.portfolioAuthorityBoundary)
            BulletList(title: "组合/平安权威状态矩阵", items: workspaceModel.portfolioAuthorityStateMatrix)
                .accessibilityIdentifier(AssistMobileWorkspaceAccessibility.portfolioAuthorityStateMatrix)
            InfoBlock(title: "本地草稿", value: workspaceModel.localOnlyDraftExplanation, valueIdentifier: AssistMobileWorkspaceAccessibility.localDraftFields)
            InfoBlock(title: "本地记录状态", value: workspaceModel.localRecordStatus, valueIdentifier: AssistMobileWorkspaceAccessibility.localRecordStatus)
            InfoBlock(title: "本地记录来源", value: workspaceModel.localRecordSourceSignature == "unavailable" ? "unavailable" : "current source signature present; full signature is not shown as authority", valueIdentifier: AssistMobileWorkspaceAccessibility.localRecordSourceSignature)
            localRecordEditor(workspaceModel)
            reviewKnowledgeEditor(workspaceModel)
            InfoBlock(title: "安全边界", value: workspaceModel.safetyBoundary, valueIdentifier: AssistMobileWorkspaceAccessibility.safetyBoundary)
            BulletList(title: "事实引用", items: workspaceModel.factReferences)
                .accessibilityIdentifier("assistMobileWorkspaceFactReferences")
            BulletList(title: "未解决证据缺口", items: workspaceModel.unresolvedEvidenceGaps)
                .accessibilityIdentifier("assistMobileWorkspaceEvidenceGaps")
            BulletList(title: "已阻止外部动作", items: workspaceModel.blockedExternalActions)
                .accessibilityIdentifier(AssistMobileWorkspaceAccessibility.blockedExternalActions)
            BulletList(title: "失败关闭", items: workspaceModel.failClosedExplanation)
                .accessibilityIdentifier(AssistMobileWorkspaceAccessibility.failClosedMessage)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.secondarySystemGroupedBackground))
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .accessibilityIdentifier("assistMobileWorkspaceSection")
    }
    func focusedLocalReviewRecordsSection() -> some View {
        let workspaceModel = assistMobileWorkspaceModel()
        return VStack(alignment: .leading, spacing: 12) {
            researchSecondOpinionEntry()
            researchArchiveExportSection()
            InfoBlock(
                title: "当前记录范围",
                value: workspaceModel.localRecordCanSave
                    ? "已绑定当前候选事实来源；仅可保存本机非官方记录。"
                    : "当前候选事实来源不可用；旧本地记录保持隐藏且不可复用。",
                valueIdentifier: "focusedLocalReviewRecordScope"
            )
            localRecordEditor(workspaceModel)
            reviewKnowledgeEditor(workspaceModel)
            Text("这些编辑器不会上传 API、写入数据库、修改官方复盘或组合事实，也不会调用券商或产生交易。")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("focusedLocalReviewRecordSafety")
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("focusedLocalReviewRecordsSection")
    }

    @ViewBuilder
    private func researchArchiveExportSection() -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("研究档案导出").font(.callout.weight(.semibold))
            NavigationLink {
                FormalResearchBackupView()
            } label: {
                Label("全公司正式研究备份", systemImage: "externaldrive")
            }.accessibilityIdentifier("formalBackupFromResearchArchive")
            Text("此入口读取 Owner 全公司正式档案；下方的当前公司导出仍只对应选中研究对象。")
                .font(.caption).foregroundStyle(.secondary)
            Text("显式导出可包含当前 exact report 的未过期临时对话；同步目录备份会排除临时对话和未吸收草稿，只保存 fresh read 的正式研究、证据、报告、决定、复盘、删除记录、PDF 与已存网页原字节及各自清单。凭据和正式资产事实不进入备份，云端是否已同步仍为 UNKNOWN。")
                .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            if twoLayerReportWorkspace.isStaleRead {
                Text("当前报告读取已过期：本机保留了上次成功读取的档案只读历史，但不再把它们当作当前事实导出。请先重新读取当前证据包，再导出报告。")
                    .font(.caption).foregroundStyle(.orange)
                    .accessibilityIdentifier("researchArchiveExportStale")
            }
            if let archive = currentResearchArchiveExport(includeTemporaryConversation: true) {
                ShareLink(
                    item: archive,
                    subject: Text("\(selectedMembership?.symbol ?? "当前标的") 研究档案"),
                    message: Text("advisory-only Owner export；请保存到 Files 或你选择的同步目录。"),
                    preview: SharePreview(archive.filename)
                ) {
                    Label("导出当前研究档案", systemImage: "archivebox")
                }
                .buttonStyle(.bordered)
                .accessibilityIdentifier("researchArchiveExport")
                if let summary = currentResearchArchiveComponentSummary(archive) {
                    Text(summary)
                        .font(.caption).foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityIdentifier("researchArchiveExportComponents")
                }
                if let csv = try? makeResearchArchiveCSVExport(archive) {
                    ShareLink(item: csv, preview: SharePreview(csv.filename)) {
                        Label("导出当前研究 CSV", systemImage: "tablecells")
                    }
                    .buttonStyle(.bordered)
                    .accessibilityIdentifier("researchArchiveExportCSV")
                }
                ResearchArchiveBackupSection(
                    membership: selectedMembership,
                    archive: currentResearchArchiveExport(includeTemporaryConversation: false),
                    originalPDFLoader: { try await currentResearchArchiveOriginalPDFs() },
                    originalHTMLLoader: { try await currentResearchArchiveOriginalHTMLs() }
                )
            } else {
                Text(currentResearchArchiveUnavailableText)
                    .font(.caption).foregroundStyle(.orange)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("researchArchiveExportUnavailable")
            }
            researchReportPDFExport()
            ResearchArchiveRestoreSection(membership: selectedMembership, restoreLocalMemory: restoreLocalMemoryFromResearchArchive).id("\(selectedMembership.map { "\($0.id):\($0.version):\($0.state.rawValue):\($0.symbol)" } ?? "none"):\(currentLocalRecordSourceSignature())")
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("researchArchiveExportSection")
    }

    /**
     Explicitly selected human-readable report export. It binds the exact saved report of the
     current selection and states which report is exported (saved / limited / deleted). It never
     regenerates a report, never mutates the database and stays distinct from the recovery archive.

     It renders directly from the freshly selected two-layer workspace through
     `makeResearchReportHumanPDFExport` instead of roundtripping a machine recovery archive, so an
     unrelated optional lane (or an unavailable recovery archive) cannot drop the evidence
     workspace or block this export.
     */
    @ViewBuilder
    private func researchReportPDFExport() -> some View {
        let report = currentResearchEvidenceQuestionReport
        let stale = twoLayerReportWorkspace.isStaleRead
        if !stale, let pdf = humanResearchReportPDF(report: report) {
            ShareLink(
                item: pdf,
                subject: Text("\(selectedMembership?.symbol ?? "当前标的") 研究报告 PDF"),
                message: Text("人类可读研究报告；只含已保存报告的结论、风险、反证与来源，不含原始 JSON、哈希、临时对话或持仓。"),
                preview: SharePreview(pdf.filename)
            ) {
                Label("导出可读报告 PDF", systemImage: "doc.text")
            }
            .buttonStyle(.bordered)
            .accessibilityIdentifier("researchArchiveExportReportPDF")
        } else {
            Text(researchReportPDFExportUnavailableText(
                stale: stale,
                report: report,
                workspaceAvailable: twoLayerReportWorkspace.envelope != nil
            ))
                .font(.caption).foregroundStyle(.orange)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("researchArchiveExportReportPDFUnavailable")
        }
        Text(researchReportExportStateText(report))
            .font(.caption)
            .foregroundStyle(.secondary)
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityIdentifier("researchArchiveExportReportState")
    }

    /// Direct human-readable report PDF for the current selection: the freshly frozen two-layer
    /// workspace plus the exact identity of the report selected on screen. A missing workspace,
    /// missing report, stale read or drift of report/pack identity returns nil here and shows the
    /// fail-closed message instead of exporting an unrelated or placeholder report.
    private func humanResearchReportPDF(report: TwoLayerReportData?) -> ResearchArchivePDFDocument? {
        guard let membership = selectedMembership,
              let workspace = twoLayerReportWorkspace.envelope,
              let report else {
            return nil
        }
        return try? makeResearchReportHumanPDFExport(
            membership: membership,
            workspace: workspace,
            identity: ResearchReportExportIdentity(report: report)
        )
    }

    private func researchReportPDFExportUnavailableText(
        stale: Bool,
        report: TwoLayerReportData?,
        workspaceAvailable: Bool
    ) -> String {
        if stale {
            return "当前报告读取已过期：可读 PDF 暂停导出。请先重新读取当前证据包并重新冻结报告，再导出；本机保留的旧报告只作为只读历史。"
        }
        guard let report else {
            return "本机没有当前已保存报告，因此不提供可读 PDF。请先读取当前证据包并明确保存研究报告；未保存时不生成占位报告。"
        }
        if !workspaceAvailable {
            return "当前没有通过校验的两层证据工作区（尚未读取、读取已过期或身份漂移），因此不提供可读 PDF。请重新读取当前证据包并重新冻结报告；不会改用其他报告或占位报告代替。"
        }
        return "所选报告 #\(report.id) v\(report.version) 未通过当前证据工作区校验（报告号、版本、指纹、证据包或证据包绑定不一致），因此不提供可读 PDF。请先重新读取当前报告后再导出；不会改用其他报告代替。"
    }

    private func researchReportExportStateText(_ report: TwoLayerReportData?) -> String {
        guard let report else {
            return "导出状态：本机没有当前已保存报告，不提供可读 PDF；请先读取并明确保存当前报告。"
        }
        let state: String
        switch report.presentationState {
        case .historical: state = "历史或已失效"
        case .currentIncomplete: state = "当前但未完成，不能形成正式决定"
        case .formalizable: state = "当前且可进入正式决定复核"
        }
        return "导出状态：报告 #\(report.id) v\(report.version) · \(state) · 状态码 \(report.status)。导出只读，不重新生成、不写数据库、不上传云端。"
    }

    func currentResearchArchiveExport(includeTemporaryConversation: Bool = true) -> ResearchArchiveExportDocument? {
        guard let membership = selectedMembership else { return nil }
        let sourceSignature = currentLocalRecordSourceSignature()
        let localRecord = sourceSignature == "unavailable"
            ? nil
            : assistMobileWorkspaceLoadLocalRecordEnvelope(
                raw: viewModel.localDefaults.string(
                    forKey: GateBLocalRecordStorage.envelopeKey(sourceSignature)
                ),
                expectedSourceSignature: sourceSignature
            ).envelope
        let localRecordDeletion = localRecord == nil && sourceSignature != "unavailable"
            ? viewModel.localDefaults.string(
                forKey: GateBLocalRecordStorage.deletionKey(sourceSignature)
            ).map {
                ResearchArchiveLocalRecordDeletion(
                    sourceSignature: sourceSignature,
                    deletedAt: $0
                )
            }
            : nil
        let temporaryConversation: ResearchArchiveTemporaryConversation? = includeTemporaryConversation ? currentResearchEvidenceQuestionReport.flatMap { report in
                guard let snapshot = try? loadResearchTemporaryConversation(
                    membership: membership,
                    report: report,
                    defaults: viewModel.localDefaults,
                    cleanupExpired: false
                ) else { return nil }
                return ResearchArchiveTemporaryConversation(
                    membership: membership,
                    report: report,
                    snapshot: snapshot
                )
            } : nil
        // ponytail: a lane that is still loading, unavailable or drifted is omitted honestly; it can no
        // longer fail the shared strict archive and delete already valid research from the export.
        // `evidenceWorkspace` and `decisionReviewHistory` stay mandatory: a present core source that
        // cannot be encoded/validated makes the strict archive throw and the UI reports an honest failure.
        do {
        return try makeResearchArchiveExport(
            membership: membership,
            profile: researchArchiveAvailableLane(
                envelope.requestedSymbol == membership.symbol ? envelope : nil
            ) { try $0.validateForDisplay(market: membership.market, code: membership.code) },
            fundamentals: researchArchiveAvailableLane(researchFundamentalWorkspace.envelope) {
                try $0.validate(expected: membership)
            },
            context: researchArchiveAvailableLane(researchContextWorkspace.envelope) {
                try $0.validate(expected: membership)
            },
            completeness: researchArchiveAvailableLane(researchContextWorkspace.completeness) {
                try $0.validate(expected: membership)
            },
            valuationScenarios: researchArchiveAvailableLane(
                researchValuationScenarioWorkspace.envelope
            ) { _ = try $0.validated(expected: membership) },
            evidenceWorkspace: frozenResearchEvidenceWorkspace.envelope,
            decisionReviewHistory: decisionReviewHistory,
            localReviewKnowledge: reviewKnowledgeEntries.map(\.envelope),
            localRecord: researchArchiveAvailableLane(localRecord) {
                try $0.validateForUserDefaults()
            },
            localRecordDeletion: localRecordDeletion,
            materialDeletions: researchDocumentWorkspace.materialDeletions.isEmpty
                ? nil
                : ResearchArchiveMaterialDeletions(items: researchDocumentWorkspace.materialDeletions),
            temporaryConversation: temporaryConversation
        )
        } catch {
            NSLog("IASArchiveExport member=%@ error=%@", membership.id, String(String(describing: error).prefix(1200)))
            return nil
        }
    }

    /// Archive includes X and omits Y, read from the strict-validated archive manifest, so the Owner can
    /// see what an unavailable lane cost and refresh that lane by re-reading it.
    func currentResearchArchiveComponentSummary(_ archive: ResearchArchiveExportDocument) -> String? {
        guard let preview = try? inspectResearchArchiveForRestore(archive.data) else { return nil }
        let names = ["researchProfile": "研究画像", "fundamentals": "结构化财务",
                     "researchContext": "研究背景", "researchCompleteness": "资料完整度",
                     "valuationScenarios": "估值情景", "evidenceWorkspace": "研究资料与报告",
                     "decisionReviewHistory": "决定与复盘", "localReviewKnowledge": "本机复盘知识",
                     "localRecord": "本机草稿", "localRecordDeletion": "草稿删除记录",
                     "materialDeletions": "资料删除记录", "temporaryConversation": "临时对话"]
        let excludes = preview.omittedComponents.isEmpty
            ? "无"
            : preview.omittedComponents.map { names[$0] ?? $0 }.joined(separator: "、")
        return "本次档案包含：\(preview.componentNames.map { names[$0] ?? $0 }.joined(separator: "、"))；本次省略：\(excludes)。省略项未写入此档案；可能尚无记录或当前未通过校验，请核对需要保留的内容。"
    }

    /// Honest failure text for the machine archive path: a present core evidence workspace that cannot be
    /// validated returns nil instead of a smaller archive that could be mistaken for a complete backup.
    var currentResearchArchiveUnavailableText: String {
        guard selectedMembership != nil else {
            return "请先选择当前研究成员并读取至少一项可验证研究内容；身份漂移时不会导出旧档案。"
        }
        return "当前内容未能生成通过校验的研究档案，尚未完成备份。现有资料已保留；不会回退为缺少研究内容的档案。"
    }

    @MainActor
    func currentResearchArchiveOriginalPDFs() async throws -> [ResearchArchiveOriginalPDFBackup] {
        guard let membership = selectedMembership else {
            throw ResearchArchiveExportError.invalidSource
        }
        if researchDocumentWorkspace.list?.membershipId != membership.id
            || researchDocumentWorkspace.list?.membershipVersion != membership.version {
            await loadResearchDocuments()
        }
        guard let list = researchDocumentWorkspace.list,
              list.membershipId == membership.id,
              list.membershipVersion == membership.version,
              list.symbol == membership.symbol,
              list.documents.allSatisfy(\.isSourceAvailable) else {
            throw ResearchArchiveExportError.invalidSource
        }
        var originals: [ResearchArchiveOriginalPDFBackup] = []
        for document in list.documents {
            let data = try await client.fetchResearchDocumentContent(
                membership: membership,
                document: document
            )
            guard selectedMembership?.id == membership.id,
                  selectedMembership?.version == membership.version,
                  researchDocumentWorkspace.list == list else {
                throw ResearchArchiveExportError.invalidSource
            }
            originals.append(ResearchArchiveOriginalPDFBackup(document: document, data: data))
        }
        return originals
    }

    @MainActor
    func currentResearchArchiveOriginalHTMLs() async throws -> [ResearchArchiveOriginalHTMLBackup] {
        guard let membership = selectedMembership else { throw ResearchArchiveExportError.invalidSource }
        let snapshots = try await client.listResearchSourceSnapshots(membership: membership)
        guard Set(snapshots.map(\.id)).count == snapshots.count else { throw ResearchArchiveExportError.invalidSource }
        var originals: [ResearchArchiveOriginalHTMLBackup] = []
        for item in snapshots {
            let snapshot = try await client.readResearchSourceSnapshot(membership: membership, snapshotId: item.id)
            let data = try await client.readResearchSourceSnapshotOriginal(membership: membership, snapshot: snapshot)
            guard selectedMembership?.id == membership.id,
                  selectedMembership?.version == membership.version,
                  parsedSymbol?.canonical == membership.symbol,
                  snapshot.id == item.id,
                  snapshot.rawSha256 == item.rawSha256,
                  snapshot.textSha256 == item.textSha256 else { throw ResearchArchiveExportError.invalidSource }
            originals.append(ResearchArchiveOriginalHTMLBackup(snapshot: snapshot, data: data))
        }
        return originals
    }

    func localRecordEditor(_ workspaceModel: AssistMobileWorkspaceRenderModel) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("本地记录")
                .font(.callout.weight(.semibold))
            Text("以下内容只保存到本机 UserDefaults；不是官方复核记录，不持久化到服务器，不发送，不同步券商，不构成组合事实。")
                .font(.caption)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)

            TextField("研究想法", text: localRecordBinding(\.researchThought), axis: .vertical)
                .textFieldStyle(.roundedBorder)
                .disabled(!workspaceModel.localRecordCanSave)
                .accessibilityIdentifier("assistMobileWorkspaceLocalRecordResearchThought")

            TextField("决策想法", text: localRecordBinding(\.decisionThought), axis: .vertical)
                .textFieldStyle(.roundedBorder)
                .disabled(!workspaceModel.localRecordCanSave)
                .accessibilityIdentifier("assistMobileWorkspaceLocalRecordDecisionThought")

            TextField("证据缺口备注", text: localRecordBinding(\.evidenceGapNote), axis: .vertical)
                .textFieldStyle(.roundedBorder)
                .disabled(!workspaceModel.localRecordCanSave)
                .accessibilityIdentifier("assistMobileWorkspaceLocalRecordEvidenceGapNote")

            TextField("稍后复核备注", text: localRecordBinding(\.laterReviewNote), axis: .vertical)
                .textFieldStyle(.roundedBorder)
                .disabled(!workspaceModel.localRecordCanSave)
                .accessibilityIdentifier("assistMobileWorkspaceLocalRecordLaterReviewNote")

            DailyResponsiveActionGroup {
                Button {
                    saveLocalRecord(sourceSignature: workspaceModel.localRecordSourceSignature)
                } label: {
                    Label("保存本地记录", systemImage: "square.and.arrow.down")
                }
                .buttonStyle(.borderedProminent)
                .disabled(!workspaceModel.localRecordCanSave)
                .accessibilityIdentifier("assistMobileWorkspaceLocalRecordSave")

                Button {
                    loadLocalRecord(sourceSignature: workspaceModel.localRecordSourceSignature)
                } label: {
                    Label("读取", systemImage: "arrow.down.doc")
                }
                .buttonStyle(.bordered)
                .disabled(!workspaceModel.localRecordCanSave)
                .accessibilityIdentifier("assistMobileWorkspaceLocalRecordLoad")

                Button {
                    clearLocalRecord(sourceSignature: workspaceModel.localRecordSourceSignature)
                } label: {
                    Label("清除", systemImage: "xmark.circle")
                }
                .buttonStyle(.bordered)
                .accessibilityIdentifier("assistMobileWorkspaceLocalRecordClear")
            }
            .accessibilityIdentifier(AssistMobileWorkspaceAccessibility.localRecordActions)

            if let localRecordMessage {
                Text(localRecordMessage)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("assistMobileWorkspaceLocalRecordMessage")
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(AssistMobileWorkspaceAccessibility.localRecordFields)
    }

    func reviewKnowledgeEditor(_ workspaceModel: AssistMobileWorkspaceRenderModel) -> some View {
        let selectedEntry = reviewKnowledgeEntries.first { $0.envelope.knowledgeId == selectedReviewKnowledgeId && !$0.envelope.isDeletionTombstone }
        let lineageNeedsTarget = reviewKnowledgeLineageMode != .newEntry
        let canSave = workspaceModel.localRecordCanSave && !reviewKnowledgeFieldsValue.isEmpty && (!lineageNeedsTarget || selectedEntry != nil)
        return VStack(alignment: .leading, spacing: 10) {
            reviewKnowledgeHeader()
            reviewKnowledgeFieldsSection(canEdit: workspaceModel.localRecordCanSave)
            reviewKnowledgeLineageSection(selectedEntry: selectedEntry, lineageNeedsTarget: lineageNeedsTarget)
            reviewKnowledgeActionsSection(canSave: canSave, sourceSignature: workspaceModel.localRecordSourceSignature, selectedEntry: selectedEntry)
            reviewKnowledgeFeedbackSection()
            reviewKnowledgeEntriesSection()
            reviewKnowledgeSelectedEntrySection(selectedEntry)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(AssistMobileWorkspaceAccessibility.reviewKnowledgeSection)
    }

    @ViewBuilder
    private func reviewKnowledgeHeader() -> some View {
        Text("本地复盘知识").font(.callout.weight(.semibold))
        Text("按标的保存在本机 UserDefaults。它是非官方、只读辅助的历史记录；官方人工检查和复盘只保存 ID 引用，不复制官方事实，也不会改变候选顺序或产生交易动作。")
            .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
    }

    private func reviewKnowledgeFieldsSection(canEdit: Bool) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            TextField("证据教训", text: reviewKnowledgeEvidenceLessonBinding(), axis: .vertical)
                .textFieldStyle(.roundedBorder).disabled(!canEdit).accessibilityIdentifier("assistReviewKnowledgeEvidenceLesson")
            TextField("流程教训", text: reviewKnowledgeProcessLessonBinding(), axis: .vertical)
                .textFieldStyle(.roundedBorder).disabled(!canEdit).accessibilityIdentifier("assistReviewKnowledgeProcessLesson")
            TextField("未解决问题", text: reviewKnowledgeUnresolvedQuestionBinding(), axis: .vertical)
                .textFieldStyle(.roundedBorder).disabled(!canEdit).accessibilityIdentifier("assistReviewKnowledgeUnresolvedQuestion")
            TextField("不确定性说明", text: reviewKnowledgeUncertaintyNoteBinding(), axis: .vertical)
                .textFieldStyle(.roundedBorder).disabled(!canEdit).accessibilityIdentifier("assistReviewKnowledgeUncertaintyNote")
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(AssistMobileWorkspaceAccessibility.reviewKnowledgeFields)
    }

    private func reviewKnowledgeEvidenceLessonBinding() -> Binding<String> {
        Binding(get: { reviewKnowledgeEvidenceLesson }, set: { reviewKnowledgeEvidenceLesson = String($0.prefix(4000)); reviewKnowledgeDraftDidChange() })
    }

    private func reviewKnowledgeProcessLessonBinding() -> Binding<String> {
        Binding(get: { reviewKnowledgeProcessLesson }, set: { reviewKnowledgeProcessLesson = String($0.prefix(4000)); reviewKnowledgeDraftDidChange() })
    }

    private func reviewKnowledgeUnresolvedQuestionBinding() -> Binding<String> {
        Binding(get: { reviewKnowledgeUnresolvedQuestion }, set: { reviewKnowledgeUnresolvedQuestion = String($0.prefix(4000)); reviewKnowledgeDraftDidChange() })
    }

    private func reviewKnowledgeUncertaintyNoteBinding() -> Binding<String> {
        Binding(get: { reviewKnowledgeUncertaintyNote }, set: { reviewKnowledgeUncertaintyNote = String($0.prefix(4000)); reviewKnowledgeDraftDidChange() })
    }

    private func reviewKnowledgeDraftDidChange() {
        reviewKnowledgeClearConfirmationId = nil
        reviewKnowledgeInvalidCollectionConfirmationSymbol = nil
        reviewKnowledgeMessage = "复盘知识草稿只在当前界面变化；保存后才写入本机 UserDefaults。"
    }

    @ViewBuilder
    private func reviewKnowledgeLineageSection(selectedEntry: AssistReviewKnowledgeViewEntry?, lineageNeedsTarget: Bool) -> some View {
        Picker("条目关系", selection: $reviewKnowledgeLineageMode) {
            ForEach(ReviewKnowledgeLineageMode.allCases, id: \.self) { mode in Text(mode.title).tag(mode) }
        }
        .pickerStyle(.menu)
        .accessibilityIdentifier(AssistMobileWorkspaceAccessibility.reviewKnowledgeLineage)
        if lineageNeedsTarget {
            Text(selectedEntry == nil ? "请先从下方列表选择要纠正或替换的历史条目。" : "关系目标：\(selectedEntry?.envelope.knowledgeId ?? "未选择")。旧条目保持不变，新条目记录 lineage。")
                .font(.caption).foregroundStyle(selectedEntry == nil ? .orange : .secondary)
                .fixedSize(horizontal: false, vertical: true).accessibilityIdentifier("assistReviewKnowledgeLineageTarget")
        }
    }

    private func reviewKnowledgeActionsSection(canSave: Bool, sourceSignature: String, selectedEntry: AssistReviewKnowledgeViewEntry?) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            reviewKnowledgeActionButtons(canSave: canSave, sourceSignature: sourceSignature, selectedEntry: selectedEntry)
        }
    }

    @ViewBuilder
    private func reviewKnowledgeActionButtons(canSave: Bool, sourceSignature: String, selectedEntry: AssistReviewKnowledgeViewEntry?) -> some View {
        reviewKnowledgeSaveButton(canSave: canSave, sourceSignature: sourceSignature)
        reviewKnowledgeLoadButton()
        reviewKnowledgeClearButton(selectedEntry: selectedEntry)
    }

    @ViewBuilder
    private func reviewKnowledgeFeedbackSection() -> some View {
        if assistReviewKnowledgeCanClearInvalidCollection(state: reviewKnowledgeLoadState) {
            Button { clearInvalidReviewKnowledgeCollection() } label: { Label("清除无效本地集合", systemImage: "trash.slash") }
                .buttonStyle(.bordered).accessibilityIdentifier(AssistMobileWorkspaceAccessibility.reviewKnowledgeClearInvalidCollection)
        }
        if let reviewKnowledgeMessage {
            Text(reviewKnowledgeMessage).font(.footnote)
                .foregroundStyle((assistReviewKnowledgeCanClearInvalidCollection(state: reviewKnowledgeLoadState) || reviewKnowledgeLoadState == .storageUnavailable) ? .orange : .secondary)
                .fixedSize(horizontal: false, vertical: true).accessibilityIdentifier(AssistMobileWorkspaceAccessibility.reviewKnowledgeMessage)
        }
    }

    @ViewBuilder
    private func reviewKnowledgeEntriesSection() -> some View {
        let visibleEntries = reviewKnowledgeEntries.filter { !$0.envelope.isDeletionTombstone }
        let deletionCount = reviewKnowledgeEntries.count - visibleEntries.count
        if visibleEntries.isEmpty {
            Text("当前标的没有可显示的本地复盘知识。失败或无数据不会回退展示旧成功状态。")
                .font(.caption).foregroundStyle(.secondary).accessibilityIdentifier("assistReviewKnowledgeEmpty")
        } else {
            VStack(alignment: .leading, spacing: 8) {
                Text("历史条目（\(visibleEntries.count)）").font(.caption.weight(.semibold))
                ForEach(Array(visibleEntries.enumerated()), id: \.element.envelope.knowledgeId) { index, entry in
                    Button { selectReviewKnowledgeEntry(entry) } label: { reviewKnowledgeEntryLabel(entry) }
                        .buttonStyle(.plain).accessibilityIdentifier("assistReviewKnowledgeEntry-\(index)")
                    Divider()
                }
            }
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier(AssistMobileWorkspaceAccessibility.reviewKnowledgeList)
        }
        if deletionCount > 0 {
            Text("无正文删除记录：\(deletionCount) 条。已从界面、搜索和本机知识上下文移除正文；此前导出的备份副本仍可能保留旧内容。")
                .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("assistReviewKnowledgeDeletionTombstones")
        }
    }

    private func reviewKnowledgeEntryLabel(_ entry: AssistReviewKnowledgeViewEntry) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text("\(entry.relation.rawValue) · \(entry.envelope.updatedAt)").font(.caption.weight(.semibold))
            Text(entry.envelope.knowledgeId).font(.caption2).foregroundStyle(.secondary).lineLimit(2)
        }.frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder
    private func reviewKnowledgeSelectedEntrySection(_ selectedEntry: AssistReviewKnowledgeViewEntry?) -> some View {
        if let selectedEntry {
            VStack(alignment: .leading, spacing: 6) {
                Text("已选条目").font(.caption.weight(.semibold))
                BulletList(title: "来源与引用", items: assistReviewKnowledgeEntrySummary(selectedEntry))
                reviewKnowledgeSelectedFields(selectedEntry)
                if let export = try? assistReviewKnowledgeExportJSON(selectedEntry.envelope) {
                    ShareLink(
                        item: export,
                        subject: Text("\(selectedEntry.envelope.target.symbol) 本机复盘知识"),
                        message: Text("非官方本机辅助记录；不含官方复盘正文，不构成投资建议或交易指令。")
                    ) {
                        Label("导出所选条目", systemImage: "square.and.arrow.up")
                    }
                    .buttonStyle(.bordered)
                    .accessibilityIdentifier("assistReviewKnowledgeExportEntry")
                }
            }
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier(AssistMobileWorkspaceAccessibility.reviewKnowledgeSelectedEntry)
        }
    }

    @ViewBuilder
    private func reviewKnowledgeSelectedFields(_ entry: AssistReviewKnowledgeViewEntry) -> some View {
        InfoBlock(title: "证据教训", value: entry.envelope.fields.evidenceLesson.isEmpty ? "未填写" : entry.envelope.fields.evidenceLesson, valueIdentifier: "assistReviewKnowledgeSelectedEvidenceLesson")
        InfoBlock(title: "流程教训", value: entry.envelope.fields.processLesson.isEmpty ? "未填写" : entry.envelope.fields.processLesson, valueIdentifier: "assistReviewKnowledgeSelectedProcessLesson")
        InfoBlock(title: "未解决问题", value: entry.envelope.fields.unresolvedQuestion.isEmpty ? "未填写" : entry.envelope.fields.unresolvedQuestion, valueIdentifier: "assistReviewKnowledgeSelectedUnresolvedQuestion")
        InfoBlock(title: "不确定性", value: entry.envelope.fields.uncertaintyNote.isEmpty ? "未填写" : entry.envelope.fields.uncertaintyNote, valueIdentifier: "assistReviewKnowledgeSelectedUncertaintyNote")
    }

    func reviewKnowledgeSaveButton(canSave: Bool, sourceSignature: String) -> some View {
        Button {
            saveReviewKnowledge(sourceSignature: sourceSignature)
        } label: {
            Label("保存复盘知识", systemImage: "tray.and.arrow.down")
        }
        .buttonStyle(.borderedProminent)
        .disabled(!canSave)
        .accessibilityIdentifier(AssistMobileWorkspaceAccessibility.reviewKnowledgeSave)
    }

    func reviewKnowledgeLoadButton() -> some View {
        Button {
            loadReviewKnowledgeForSelectedCandidate()
        } label: {
            Label("读取知识", systemImage: "list.bullet.rectangle")
        }
        .buttonStyle(.bordered)
        .disabled(selectedMembership == nil)
        .accessibilityIdentifier(AssistMobileWorkspaceAccessibility.reviewKnowledgeLoad)
    }

    func reviewKnowledgeClearButton(selectedEntry: AssistReviewKnowledgeViewEntry?) -> some View {
        Button {
            Task { await clearSelectedReviewKnowledgeEntry() }
        } label: {
            Label("删除所选正文", systemImage: "trash")
        }
        .buttonStyle(.bordered)
        .disabled(selectedEntry == nil)
        .accessibilityIdentifier(AssistMobileWorkspaceAccessibility.reviewKnowledgeClearEntry)
    }

}
