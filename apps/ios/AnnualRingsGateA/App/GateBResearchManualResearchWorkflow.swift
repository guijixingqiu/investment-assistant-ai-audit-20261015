import SwiftUI

#if OWNER_CLIENT
private func manualReviewDateString(_ date: Date) -> String {
    let formatter = DateFormatter()
    formatter.calendar = Calendar(identifier: .gregorian)
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = TimeZone(identifier: "Asia/Hong_Kong")
    formatter.dateFormat = "yyyy-MM-dd"
    return formatter.string(from: date)
}

struct ManualDirectSavedSourceSelection: Equatable {
    let membershipKey: String
    let membershipId: String
    let membershipVersion: Int
    let material: ResearchMaterialData
    let document: ResearchDocumentData?
    let page: ResearchDocumentPageData?

    var binding: ManualDecisionSourceBinding {
        ManualDecisionSourceBinding(
            evidenceId: nil,
            sourceId: "saved-material:\(material.id):r\(material.revision)",
            title: material.title,
            sourceType: material.sourceType,
            sourceUrl: material.sourceUrl,
            contentSha256: page?.pageTextSha256 ?? material.snapshotCitation?.textSha256 ?? material.contentFingerprint,
            pageNumber: page?.pageNumber,
            documentId: document?.id,
            documentPdfSha256: document?.pdfSha256,
            snapshotId: material.snapshotCitation?.snapshotId,
            snapshotRawSha256: material.snapshotOriginal?.rawSha256,
            materialId: material.id,
            materialRevision: material.revision,
            materialFingerprint: material.contentFingerprint,
            bindingKind: "saved_material",
            membershipId: membershipId,
            membershipVersion: membershipVersion
        )
    }
}

extension GateBResearchScreen {
    @MainActor
    func beginManualReviewQuestionHandoff(_ handoff: ResearchReviewQuestionHandoff) {
        guard handoff.target.reportBinding == nil, let symbol = parsedSymbol else { return }
        let authorizationRevision = viewModel.authorizationRevision
        Task {
            await refreshDecisionReviewHistoryAfterWrite(for: symbol)
            guard dailyClientAuthorizationIsCurrent(authorizationRevision),
                  parsedSymbol?.canonical == handoff.target.canonicalSymbol,
                  let membership = selectedMembership,
                  handoff.resolveQuestion(
                    history: decisionReviewHistory, membership: membership, workspace: nil
                  ) != nil else {
                manualReviewResearchHandoff = nil
                manualReviewResearchQuestionOnlyDraft = ""
                manualReviewResearchQuestionDraft = ""
                manualReviewResearchMessage = "复盘、检查、成员版本或记录者已变化；旧草稿已清除。"
                return
            }
            manualReviewResearchHandoff = handoff
            manualReviewResearchQuestionOnlyDraft = handoff.question
            manualReviewResearchQuestionDraft = handoff.question
            manualReviewResearchMessage = handoff.question.isEmpty
                ? "这次复盘没有保存下一研究问题；请先写当前问题，再明确选择要带入的复盘材料。尚未保存、发起任务或调用模型。"
                : "已选择保存的下一研究问题；可编辑，判断修正与流程教训需另行勾选带入。尚未保存、发起任务或调用模型。"
            selectedDecisionLayer = .evidence
            selectedEvidenceWorkspace = .brief
            pendingDecisionWorkspaceScrollTarget = "manualReviewLearningResearchDraft"
        }
    }

    @ViewBuilder
    func manualReviewLearningResearchDraftSection() -> some View {
        if let handoff = manualReviewResearchHandoff,
           let membership = selectedMembership,
           membership.id == handoff.target.membershipId,
           membership.version == handoff.target.membershipVersion,
           membership.symbol == handoff.target.canonicalSymbol {
            VStack(alignment: .leading, spacing: 8) {
                SectionTitle("复盘带来的当前研究问题")
                Text("来源：复盘 #\(handoff.target.reviewId ?? "UNKNOWN") · 检查 #\(handoff.target.decisionCheckId) · \(handoff.reviewReviewedAt)。人工复盘只作待核查上下文，不是已验证财务证据。")
                    .font(.caption).foregroundStyle(.secondary)
                TextField("编辑当前研究问题", text: Binding(
                    get: { manualReviewResearchQuestionOnlyDraft },
                    set: {
                        manualReviewResearchQuestionOnlyDraft = $0
                        manualReviewResearchQuestionDraft = ""
                    }
                ), axis: .vertical)
                    .textFieldStyle(.roundedBorder)
                    .accessibilityIdentifier("manualReviewResearchQuestionDraft")
                Toggle("带入保存的判断修正", isOn: Binding(
                    get: { manualReviewResearchHandoff?.includesJudgmentCorrection == true },
                    set: { manualReviewResearchHandoff?.includesJudgmentCorrection = $0 }
                ))
                Toggle("带入保存的流程教训", isOn: Binding(
                    get: { manualReviewResearchHandoff?.includesProcessLesson == true },
                    set: { manualReviewResearchHandoff?.includesProcessLesson = $0 }
                ))
                Button("更新可编辑研究准备草稿") {
                    guard let current = manualReviewResearchHandoff,
                          let latestMembership = selectedMembership,
                          latestMembership.id == membership.id,
                          latestMembership.version == membership.version,
                          latestMembership.actorId == membership.actorId,
                          current.resolveQuestion(history: decisionReviewHistory,
                                                  membership: latestMembership, workspace: nil) != nil else {
                        manualReviewResearchHandoff = nil
                        manualReviewResearchQuestionOnlyDraft = ""
                        manualReviewResearchQuestionDraft = ""
                        manualReviewResearchMessage = "复盘来源已变化；草稿已清除。"
                        return
                    }
                    let currentQuestion = manualReviewResearchQuestionOnlyDraft.trimmingCharacters(in: .whitespacesAndNewlines)
                    guard !currentQuestion.isEmpty else {
                        manualReviewResearchMessage = "请先写当前研究问题；不会凭复盘教训生成问句。"
                        return
                    }
                    let prepared = current.selectedQuestionDraft(startingWith: currentQuestion)
                    guard prepared.utf16.count <= ResearchReviewQuestionHandoff.maximumQuestionLength else {
                        manualReviewResearchMessage = "问题与所选原文超过 1000 字上限；请减少勾选或编辑问题。"
                        return
                    }
                    manualReviewResearchQuestionDraft = prepared
                    manualReviewResearchMessage = "所选原文已进入可编辑草稿；未自动保存、发送或形成决定。"
                }
                .buttonStyle(.bordered)
                .accessibilityIdentifier("manualReviewLearningApplySelection")
                TextField("可编辑研究准备草稿", text: $manualReviewResearchQuestionDraft, axis: .vertical)
                    .textFieldStyle(.roundedBorder)
                    .accessibilityIdentifier("manualReviewPreparedDraft")
                Button("把当前问题加入研究证据缺口草稿") {
                    guard let current = manualReviewResearchHandoff,
                          let latestMembership = selectedMembership,
                          latestMembership.id == membership.id,
                          latestMembership.version == membership.version,
                          latestMembership.actorId == membership.actorId,
                          current.resolveQuestion(history: decisionReviewHistory,
                                                  membership: latestMembership, workspace: nil) != nil else {
                        manualReviewResearchMessage = "复盘来源已变化；没有写入研究草稿。"
                        return
                    }
                    let currentQuestion = manualReviewResearchQuestionOnlyDraft.trimmingCharacters(in: .whitespacesAndNewlines)
                    let question = manualReviewResearchQuestionDraft.trimmingCharacters(in: .whitespacesAndNewlines)
                    guard !currentQuestion.isEmpty, question.hasPrefix(currentQuestion) else {
                        manualReviewResearchMessage = "请先写当前问题并更新准备草稿；没有保存的问题不会由教训替代。"
                        return
                    }
                    let line = "待核查（人工复盘 #\(current.target.reviewId ?? "UNKNOWN")）：\(question)"
                    do {
                        guard try annualDecisionBriefProfileDraft.appendEvidenceGap(line) else {
                            manualReviewResearchMessage = "这条问题已在草稿中；没有重复加入。"
                            return
                        }
                    } catch AnnualDecisionBriefDraftError.invalid(let message) {
                        manualReviewResearchMessage = "\(message)草稿未改变。"
                        return
                    } catch {
                        manualReviewResearchMessage = "证据缺口草稿无效；没有加入。"
                        return
                    }
                    selectedResearchEditorPage = .profile
                    manualReviewResearchMessage = "已放入一条未保存的研究档案草稿；请逐项检查并明确保存。"
                }
                .buttonStyle(.bordered)
                .accessibilityIdentifier("manualReviewLearningToGapDraft")
                if let manualReviewResearchMessage {
                    Text(manualReviewResearchMessage).font(.caption).foregroundStyle(.secondary)
                }
            }
            .id("manualReviewLearningResearchDraft")
            .accessibilityIdentifier("manualReviewLearningResearchDraft")
        }
    }

    @MainActor
    func reconcilePersonalManualResearchHandoff() async {
        guard clientDestination == .manualResearch,
              let handoff = ownerStore.personalFormalHandoff,
              handoff.purpose == .manualJudgment,
              !handoff.manualSources.isEmpty,
              personalFormalVerificationId == nil,
              [.checked, .limited].contains(dailyRefreshGate.phase) else { return }
        personalFormalVerificationId = handoff.id
        defer { personalFormalVerificationId = nil }
        guard let membership = selectedMembership,
              membership.state != .archived,
              membership.id == handoff.membershipId,
              membership.version == handoff.membershipVersion,
              membership.symbol == handoff.symbol,
              parsedSymbol?.canonical == handoff.symbol,
              handoff.connectionScope == PersonalFormalResearchHandoff.currentConnectionScope() else {
            manualHandoffSession.invalidate()
            ownerStore.clearPersonalFormalHandoff()
            manualResearchMessage = "公司、成员版本或连接已变化；请重新选择来源。"
            return
        }
        let readback = await ownerStore.verifyPersonalFormalHandoff(handoff)
        guard ownerStore.personalFormalHandoff == handoff else { return }
        guard selectedMembership?.id == handoff.membershipId,
              selectedMembership?.version == handoff.membershipVersion,
              parsedSymbol?.canonical == handoff.symbol,
              handoff.connectionScope == PersonalFormalResearchHandoff.currentConnectionScope() else {
            manualHandoffSession.invalidate()
            manualResearchMessage = "读取期间研究身份已变化；请重新核对。"
            return
        }
        switch readback {
        case .unavailable:
            manualHandoffSession.invalidate()
            manualResearchMessage = "所选来源暂不能重新核验；问题和编辑草稿仍保留，请刷新。"
        case .drifted:
            manualHandoffSession.invalidate()
            ownerStore.clearPersonalFormalHandoff()
            manualResearchMessage = "所选来源已变化；请返回原问题重新核对。"
        case .current:
            if manualHandoffSession.accept(handoffId: handoff.id, question: handoff.question) {
                manualSelectedEvidenceSourceId = nil
                manualDecisionReadbackId = nil
                manualDecisionText = ""
                manualReviewDateEnabled = false
                manualReviewDate = Date()
            }
            manualResearchMessage = "当前问题和所选原件已重新核对；以下编辑内容只有点保存才会写入。"
        }
    }

    @ViewBuilder
    func manualResearchHandoffSection() -> some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionTitle("当前问题与选定来源")
            if let manualResearchMessage {
                Text(manualResearchMessage).font(.footnote).foregroundStyle(.secondary)
                    .accessibilityIdentifier("manualResearchVerificationMessage")
            }
            if let handoff = ownerStore.personalFormalHandoff,
               handoff.purpose == .manualJudgment,
               handoff.symbol == parsedSymbol?.canonical {
                if let context = handoff.ordinaryChangeContext {
                    if manualOrdinaryChangeIsCurrent(handoff) {
                        VStack(alignment: .leading, spacing: 5) {
                            Text("已读经营资料 · 判断修订参考").font(.headline)
                            if let comparison = context.comparison {
                                Text("较早：\(comparison.earlier.text) · 公开于 \(comparison.earlier.source.publishedAt.prefix(10))")
                                Text("较新：\(comparison.later.text) · 公开于 \(comparison.later.source.publishedAt.prefix(10))")
                                if case .some(.recorded(let previous)) = ownerStore.manualJudgmentProjection(symbol: handoff.symbol) {
                                    let latestDate = String(comparison.later.source.publishedAt.prefix(10))
                                    let judgmentDate = String(previous.checkedAt.prefix(10))
                                    Text(latestDate < judgmentDate
                                         ? "较新一份资料也早于旧判断（\(judgmentDate)）；这是历史比较，不是判断后的新披露。"
                                         : latestDate > judgmentDate
                                            ? "较新资料晚于旧判断（\(judgmentDate)）；请评估其影响。"
                                            : "较新资料与旧判断同日；需先核对具体时点。")
                                        .font(.caption).foregroundStyle(.orange)
                                }
                            } else if let fact = context.sourceFacts.first(where: { $0.id == context.selectedFactId }) {
                                Text("\(context.changeTriggerType == "verification_upgrade" ? "核对升级，数值未变" : "历史资料变化") · \(fact.text)")
                                Text("原件公开于 \(fact.source.publishedAt.prefix(10)) · 期间截至 \(fact.period.end)")
                                if case .some(.recorded(let previous)) = ownerStore.manualJudgmentProjection(symbol: handoff.symbol) {
                                    let sourceDate = String(fact.source.publishedAt.prefix(10))
                                    let judgmentDate = String(previous.checkedAt.prefix(10))
                                    Text(sourceDate < judgmentDate
                                         ? "这份资料早于旧判断（\(judgmentDate)），属于历史参考，不是事后新公告。"
                                         : sourceDate > judgmentDate
                                            ? "这份资料晚于旧判断（\(judgmentDate)），请评估是否修订。"
                                            : "资料与旧判断同日；需先核对具体时点。")
                                        .font(.caption).foregroundStyle(.orange)
                                }
                            }
                            if !context.operatingMeaning.isEmpty { Text("经营解释候选：" + context.operatingMeaning) }
                            Text("仍然未知：" + context.unknown)
                            Text("下一问题：" + context.nextQuestion)
                            if !context.changeSourcesSelected {
                                Text("本次选择未完整匹配变化原件；可继续记录普通判断，但不会把比较或变化关联写成已核实。")
                                    .font(.caption).foregroundStyle(.orange)
                            } else if context.changeId != nil && manualCurrentResearchChangeBinding(for: handoff) == nil {
                                Text("资料变化关联已非当前版本；这些原件仍可作历史参考，保存普通判断时不会提交结构化变化关联。")
                                    .font(.caption).foregroundStyle(.orange)
                            }
                            Text("这些文字只是草稿提示，不会自动成为你的判断。请核对下方所选原件和证据摘要。")
                                .font(.caption).foregroundStyle(.secondary)
                        }.accessibilityIdentifier("manualChangeComparisonDraft")
                    } else {
                        Text("上一笔普通判断已改变或暂不可核对；原件与编辑草稿保留，请返回公司研究重新核对后再修订。")
                            .font(.caption).foregroundStyle(.orange)
                            .accessibilityIdentifier("manualChangeComparisonDrift")
                    }
                }
                TextField("当前待核查问题", text: $manualHandoffSession.questionDraft, axis: .vertical)
                    .textFieldStyle(.roundedBorder)
                    .accessibilityIdentifier("manualResearchQuestion")
                Button("把当前问题加入证据缺口草稿") {
                    let question = manualHandoffSession.questionDraft.trimmingCharacters(in: .whitespacesAndNewlines)
                    let line = "待核查：\(question)"
                    guard !question.isEmpty else {
                        manualResearchMessage = "请先填写当前待核查问题。"
                        return
                    }
                    do {
                        guard try annualDecisionBriefProfileDraft.appendEvidenceGap(line) else {
                            manualResearchMessage = "这条问题已经在草稿里；没有重复加入。"
                            return
                        }
                    } catch AnnualDecisionBriefDraftError.invalid(let message) {
                        manualResearchMessage = "\(message)草稿未改变。"
                        return
                    } catch {
                        manualResearchMessage = "证据缺口草稿无效；没有加入。"
                        return
                    }
                    selectedResearchEditorPage = .profile
                    manualResearchMessage = "问题已加入未保存的证据缺口草稿；请检查论点并明确保存。"
                }
                .disabled(manualHandoffSession.verifiedHandoffId != handoff.id)
                .accessibilityIdentifier("manualQuestionToGap")
                Text("来源坐标仅帮助填写证据草稿。摘要与判断由你撰写；证据记录接口不会冻结原件或 OpenD 材料的精确绑定。")
                    .font(.caption).foregroundStyle(.secondary)
                ForEach(handoff.manualSources) { source in
                    VStack(alignment: .leading, spacing: 4) {
                        Text(source.title).font(.callout.weight(.semibold))
                        Text(source.provider == nil
                             ? "已读公开原件\(source.pageNumber.map { " · 第\($0)页" } ?? "")"
                             : "OpenD 已保存材料 · 第三方未核实")
                            .font(.caption).foregroundStyle(.secondary)
                        if let material = source.savedMaterial, let provider = source.provider {
                            Text("财务期间 \(provider.periodEnd)")
                                .font(.caption).foregroundStyle(.secondary)
                            DisclosureGroup("查看材料详情") {
                                Text("材料 \(material.id) · 修订 \(material.revision)")
                                Text("材料指纹 \(material.contentFingerprint)").textSelection(.enabled)
                            }.font(.caption)
                        }
                        DisclosureGroup("查看来源详情") {
                            Text("来源类型 \(source.sourceType)")
                            Text("取得时间 \(source.retrievedAt)")
                            if let publishedAt = source.publishedAt { Text("发布时间 \(publishedAt)") }
                            Text("内容指纹 \(source.contentSha256)").textSelection(.enabled)
                            if let documentId = source.documentId, let pdfSha = source.documentPdfSha256 {
                                Text("已存 PDF #\(documentId) · 原文件 SHA-256 \(pdfSha)").textSelection(.enabled)
                            }
                        }
                        .font(.caption)
                        if let raw = source.url, let url = URL(string: raw) {
                            Link("查看原始来源", destination: url)
                        }
                        Button("用这条来源填写证据草稿") {
                            guard annualDecisionBriefEvidenceDraft.summary.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                                manualResearchMessage = "当前证据摘要尚未保存；请先保存或手动清空，再切换来源。"
                                return
                            }
                            manualSelectedEvidenceSourceId = source.id
                            selectedResearchEditorPage = .evidence
                            annualDecisionBriefEvidenceDraft.sourceType = source.provider == nil
                                ? source.sourceType : "futu_opend_financial_statement_provider"
                            annualDecisionBriefEvidenceDraft.sourceURL = source.provider == nil ? (source.url ?? "") : ""
                            annualDecisionBriefEvidenceDraft.summary = ""
                            manualResearchMessage = "已填写来源类型与地址；请独立撰写摘要、核对立场，再点记录证据。"
                        }
                        .disabled(manualHandoffSession.verifiedHandoffId != handoff.id || isWritingAnnualDecisionBriefResearch)
                        .accessibilityIdentifier("manualEvidenceSource-\(source.id)")
                        ForEach(manualExistingEvidence(for: source)) { item in
                            Button("核对并采用已保存证据：\(String(item.summary.prefix(55)))") {
                                manualHandoffSession.savedEvidenceBySource[source.id] = item.id
                                manualResearchMessage = "已采用当前档案中这条现有证据。来源类型和地址相符；内容指纹没有不可变绑定，请再核对摘要和原件。"
                            }
                            .disabled(manualHandoffSession.verifiedHandoffId != handoff.id)
                            .accessibilityIdentifier("manualExistingEvidence-\(source.id)-\(item.id)")
                        }
                    }
                    .padding(10)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.secondary.opacity(0.07), in: RoundedRectangle(cornerRadius: 10))
                }
            } else {
                Text("当前问题交接不可用；请从公司页重新选择来源。")
                    .font(.footnote).foregroundStyle(.secondary)
            }
        }
        .accessibilityIdentifier("manualResearchHandoff")
    }

    func manualExistingEvidence(for source: PersonalManualSelectedSource) -> [EvidenceItemData] {
        let expectedType = source.provider == nil ? source.sourceType : "futu_opend_financial_statement_provider"
        let expectedURL = source.provider == nil ? source.url : nil
        return envelope.data?.evidence.filter {
            $0.sourceType == expectedType && $0.sourceUrl == expectedURL
        } ?? []
    }

    func manualCurrentEvidenceIds(for handoff: PersonalFormalResearchHandoff) -> Set<String> {
        Set(handoff.manualSources.compactMap { source in
            guard let id = manualHandoffSession.savedEvidenceBySource[source.id],
                  envelope.data?.evidence.contains(where: { $0.id == id }) == true else { return nil }
            return id
        })
    }

    func manualCurrentSourceBindings(for handoff: PersonalFormalResearchHandoff) -> [ManualDecisionSourceBinding]? {
        guard let evidence = envelope.data?.evidence else { return nil }
        let bindings = handoff.manualSources.compactMap { source -> ManualDecisionSourceBinding? in
            guard let evidenceId = manualHandoffSession.savedEvidenceBySource[source.id],
                  let item = evidence.first(where: { $0.id == evidenceId }),
                  item.sourceType == (source.provider == nil ? source.sourceType : "futu_opend_financial_statement_provider"),
                  item.sourceUrl == (source.provider == nil ? source.url : nil) else { return nil }
            let material = source.savedMaterial
            return ManualDecisionSourceBinding(
                evidenceId: evidenceId, sourceId: source.id, title: source.title,
                sourceType: item.sourceType, sourceUrl: item.sourceUrl,
                contentSha256: source.contentSha256, pageNumber: source.pageNumber,
                documentId: source.documentId, documentPdfSha256: source.documentPdfSha256,
                snapshotId: source.snapshotCitation?.snapshotId,
                snapshotRawSha256: source.snapshotCitation?.rawSha256,
                materialId: material?.id, materialRevision: material?.revision,
                materialFingerprint: material?.contentFingerprint
            )
        }
        guard !bindings.isEmpty, bindings.count == handoff.manualSources.count,
              Set(bindings.map(\.evidenceId)).count == bindings.count else { return nil }
        return bindings
    }

    var manualDirectMembershipKey: String? {
        guard let member = selectedMembership, member.state == .tracked,
              parsedSymbol?.canonical == member.symbol else { return nil }
        return "\(member.actorId)|\(member.id)|\(member.version)|\(member.symbol)"
    }

    var manualDirectSavedMaterials: [ResearchMaterialData] {
        guard let member = selectedMembership, manualDirectMembershipKey != nil else { return [] }
        return manualDirectAvailableMaterials.filter { material in
            guard material.symbol == member.symbol,
                  material.revisionState == "current", material.freshness == "fresh",
                  !["conflict", "rejected"].contains(material.verificationStatus),
                  parseInstant(material.validUntil).map({ $0 > Date() }) == true,
                  ["user_provided", "authorized_public"].contains(material.rightsStatus) else { return false }
            switch material.sourceType {
            case "owner_provided_pdf", "issuer_public_pdf":
                guard let list = researchDocumentWorkspace.list,
                      list.requestedActorId == member.actorId,
                      list.membershipId == member.id, list.membershipVersion == member.version,
                      list.symbol == member.symbol,
                      let citation = material.citation,
                      let document = list.documents.first(where: { $0.id == citation.documentId })
                else { return false }
                return document.isSourceAvailable && document.symbol == member.symbol
                    && citation.pageNumber > 0 && citation.pageNumber <= document.pageCount
            case "issuer_public_html":
                return material.snapshotCitation?.isValid == true && material.snapshotOriginal?.isValid == true
            case "futu_opend_financial_statement_provider":
                guard let source = material.futuFinancialSource else { return false }
                return source.membershipId == member.id && source.symbol == member.symbol
                    && source.membershipVersion > 0 && source.membershipVersion <= member.version
                    && !source.pages.isEmpty
            default: return false
            }
        }.sorted { (Int($0.id) ?? 0) > (Int($1.id) ?? 0) }
    }

    var manualDirectCurrentBindings: [ManualDecisionSourceBinding]? {
        guard let key = manualDirectMembershipKey,
              manualDirectSelectionMembershipKey == key,
              !manualDirectSelectedMaterialIds.isEmpty,
              manualDirectSelectedMaterialIds.count == manualDirectVerifiedSources.count,
              Set(manualDirectVerifiedSources.map { $0.material.id }) == manualDirectSelectedMaterialIds,
              manualDirectVerifiedSources.allSatisfy({ $0.membershipKey == key }) else { return nil }
        return manualDirectVerifiedSources.map(\.binding).sorted { $0.sourceId < $1.sourceId }
    }

    @MainActor
    func loadManualDirectSourcesIfNeeded() async {
        guard let key = manualDirectMembershipKey,
              let membership = selectedMembership else { return }
        if manualDirectSelectionMembershipKey != key {
            manualDirectSelectionMembershipKey = key
            manualDirectSelectedMaterialIds = []
            manualDirectAvailableMaterials = []
            manualDirectVerifiedSources = []
            manualDirectSelectionId = UUID()
            manualDirectSourceMessage = nil
        }
        if researchDocumentWorkspace.list?.membershipId != membership.id
            || researchDocumentWorkspace.list?.membershipVersion != membership.version
            || researchDocumentWorkspace.list?.requestedActorId != membership.actorId {
            await loadResearchDocuments()
        }
        await refreshManualDirectAvailableMaterials()
    }

    @MainActor
    func refreshManualDirectAvailableMaterials() async {
        guard let membership = selectedMembership, let key = manualDirectMembershipKey else { return }
        let authorization = AppEnvironment.researchAuthorizationContext()
        do {
            let workspace = try await client.fetchFrozenResearchEvidence(membership: membership)
            guard manualDirectMembershipKey == key,
                  AppEnvironment.researchAuthorizationContext() == authorization,
                  workspace.data?.target.membershipId == membership.id,
                  workspace.data?.target.membershipVersion == membership.version else { return }
            manualDirectAvailableMaterials = workspace.data?.materials ?? []
            if !manualDirectSelectedMaterialIds.isSubset(of: Set(manualDirectSavedMaterials.map(\.id)))
                || manualDirectVerifiedSources.contains(where: { verified in
                    !manualDirectAvailableMaterials.contains(where: { $0 == verified.material })
                }) {
                manualDirectVerifiedSources = []
                manualDirectSourceMessage = "所选材料已变化，请重新选择并核对原件。"
            }
        } catch {
            guard manualDirectMembershipKey == key else { return }
            manualDirectAvailableMaterials = []
            manualDirectVerifiedSources = []
            manualDirectSourceMessage = "当前公司材料暂不可读取；无法保存来源绑定。"
        }
    }

    @MainActor
    func verifyManualDirectSources() async {
        guard let membership = selectedMembership, let key = manualDirectMembershipKey,
              manualDirectSelectionMembershipKey == key,
              !manualDirectSelectedMaterialIds.isEmpty,
              manualDirectSelectedMaterialIds.count <= 20,
              manualPendingDecisionRequest == nil,
              !isVerifyingManualDirectSources else { return }
        let selectionId = manualDirectSelectionId
        let selectedIds = manualDirectSelectedMaterialIds
        let authorization = AppEnvironment.researchAuthorizationContext()
        isVerifyingManualDirectSources = true
        defer { isVerifyingManualDirectSources = false }
        manualDirectVerifiedSources = []
        manualDirectSourceMessage = "正在核对所选原件与当前材料版本。"
        do {
            let workspace = try await client.fetchFrozenResearchEvidence(membership: membership)
            guard workspace.data?.target.membershipId == membership.id,
                  workspace.data?.target.membershipVersion == membership.version else {
                throw ResearchDocumentClientError.invalidResponse
            }
            let needsPDF = workspace.data?.materials.contains(where: {
                selectedIds.contains($0.id) && ["owner_provided_pdf", "issuer_public_pdf"].contains($0.sourceType)
            }) == true
            let list: ResearchDocumentListEnvelope? = needsPDF
                ? try await client.fetchResearchDocuments(membership: membership) : nil
            guard manualDirectSelectionId == selectionId,
                  manualDirectSelectedMaterialIds == selectedIds,
                  manualDirectMembershipKey == key,
                  AppEnvironment.researchAuthorizationContext() == authorization else { return }
            var verified: [ManualDirectSavedSourceSelection] = []
            for materialId in selectedIds.sorted() {
                guard let material = workspace.data?.materials.first(where: { $0.id == materialId }),
                      material.revisionState == "current", material.freshness == "fresh",
                      !["conflict", "rejected"].contains(material.verificationStatus),
                      parseInstant(material.validUntil).map({ $0 > Date() }) == true,
                      ["user_provided", "authorized_public"].contains(material.rightsStatus),
                      material.symbol == membership.symbol,
                      researchDocumentSha256(Data(material.contentText.utf8)) == material.contentFingerprint else {
                    throw ResearchDocumentClientError.invalidResponse
                }
                var document: ResearchDocumentData?
                var page: ResearchDocumentPageData?
                switch material.sourceType {
                case "owner_provided_pdf", "issuer_public_pdf":
                    guard let list, let citation = material.citation,
                          let savedDocument = list.documents.first(where: { $0.id == citation.documentId }),
                          savedDocument.isSourceAvailable else { throw ResearchDocumentClientError.invalidResponse }
                    let savedPage = try await client.fetchResearchDocumentPage(
                        membership: membership, documentId: savedDocument.id, pageNumber: citation.pageNumber)
                    guard material.validatesPDFCitation(document: savedDocument, page: savedPage),
                          material.sourceVersion == "pdf:\(savedDocument.pdfSha256):p\(savedPage.pageNumber):\(savedPage.pageTextSha256.prefix(16))" else {
                        throw ResearchDocumentClientError.invalidResponse
                    }
                    _ = try await client.fetchResearchDocumentContent(membership: membership, document: savedDocument)
                    document = savedDocument; page = savedPage
                case "issuer_public_html":
                    guard let citation = material.snapshotCitation, let original = material.snapshotOriginal else {
                        throw ResearchDocumentClientError.invalidResponse
                    }
                    let snapshot = try await client.readResearchSourceSnapshot(
                        membership: membership, snapshotId: citation.snapshotId)
                    _ = try await client.readResearchSourceSnapshotOriginal(membership: membership, snapshot: snapshot)
                    guard snapshot.textSha256 == citation.textSha256,
                          snapshot.rawSha256 == original.rawSha256,
                          snapshot.byteLength == original.byteLength,
                          snapshot.canonicalUrl == original.canonicalUrl,
                          snapshot.responseUrl == original.responseUrl,
                          material.sourceUrl == snapshot.responseUrl,
                          snapshot.selectedCitation(range: NSRange(location: citation.startUtf16,
                              length: citation.endUtf16 - citation.startUtf16))?.0 == citation else {
                        throw ResearchDocumentClientError.invalidResponse
                    }
                case "futu_opend_financial_statement_provider":
                    guard material.sourceUrl == nil, let source = material.futuFinancialSource,
                          source.membershipId == membership.id, source.symbol == membership.symbol,
                          source.membershipVersion > 0, source.membershipVersion <= membership.version,
                          !source.pages.isEmpty else { throw ResearchDocumentClientError.invalidResponse }
                    let saved = try await client.readHistoricalFutuFinancialMaterial(
                        membership: membership, materialId: material.id, revision: material.revision,
                        contentFingerprint: material.contentFingerprint)
                    guard saved == material else { throw ResearchDocumentClientError.invalidResponse }
                    let capture = try await client.readFutuFinancialCapture(
                        membership: membership, captureId: source.captureId)
                    guard capture.membershipVersion == source.membershipVersion else {
                        throw ResearchDocumentClientError.invalidResponse
                    }
                    for coordinate in source.pages {
                        guard let originalPage = capture.pages.first(where: { $0.id == coordinate.pageId
                            && $0.statementType == coordinate.statementType
                            && $0.rawSha256 == coordinate.rawSha256
                            && $0.reports.contains(where: { $0.reportSha256 == coordinate.reportSha256 }) }) else {
                            throw ResearchDocumentClientError.invalidResponse
                        }
                        _ = try await client.readFutuFinancialOriginal(
                            membership: membership, capture: capture, page: originalPage)
                    }
                default: throw ResearchDocumentClientError.invalidResponse
                }
                verified.append(ManualDirectSavedSourceSelection(
                    membershipKey: key, membershipId: membership.id,
                    membershipVersion: membership.version,
                    material: material, document: document, page: page
                ))
            }
            guard manualDirectSelectionId == selectionId,
                  manualDirectSelectedMaterialIds == selectedIds,
                  manualDirectMembershipKey == key,
                  AppEnvironment.researchAuthorizationContext() == authorization else { return }
            if let list { researchDocumentWorkspace.list = list }
            manualDirectAvailableMaterials = workspace.data?.materials ?? []
            manualDirectVerifiedSources = verified
            manualDirectSourceMessage = "已核对 \(verified.count) 条当前公司原件；保存时还会重新读取同一版本。"
        } catch {
            guard manualDirectSelectionId == selectionId else { return }
            manualDirectSourceMessage = "所选材料或原件已变化或暂不可读取；没有形成可保存的来源绑定。"
        }
    }

    @MainActor
    func openManualDirectSource(_ selected: ResearchMaterialData) async {
        guard let membership = selectedMembership, let key = manualDirectMembershipKey,
              manualDirectSavedMaterials.contains(selected) else { return }
        let authorization = AppEnvironment.researchAuthorizationContext()
        do {
            let workspace = try await client.fetchFrozenResearchEvidence(membership: membership)
            guard workspace.data?.materials.contains(selected) == true,
                  selected.revisionState == "current", selected.freshness == "fresh",
                  manualDirectMembershipKey == key,
                  AppEnvironment.researchAuthorizationContext() == authorization else {
                throw ResearchDocumentClientError.invalidResponse
            }
            switch selected.sourceType {
            case "owner_provided_pdf", "issuer_public_pdf":
                guard let citation = selected.citation else { throw ResearchDocumentClientError.invalidResponse }
                let list = try await client.fetchResearchDocuments(membership: membership)
                guard let document = list.documents.first(where: { $0.id == citation.documentId }),
                      document.isSourceAvailable else { throw ResearchDocumentClientError.invalidResponse }
                let page = try await client.fetchResearchDocumentPage(
                    membership: membership, documentId: document.id, pageNumber: citation.pageNumber)
                guard selected.validatesPDFCitation(document: document, page: page) else {
                    throw ResearchDocumentClientError.invalidResponse
                }
                researchDocumentWorkspace.list = list
                researchDocumentWorkspace.selectedDocumentId = document.id
                researchDocumentWorkspace.selectedPage = page
                researchDocumentWorkspace.pageNumberText = String(page.pageNumber)
                await openSelectedResearchDocumentPDF(document: document, page: page)
            case "issuer_public_html":
                guard let citation = selected.snapshotCitation, let original = selected.snapshotOriginal,
                      await openStoredSourceCitation(citation, original: original) else {
                    throw ResearchDocumentClientError.invalidResponse
                }
            case "futu_opend_financial_statement_provider":
                guard let source = selected.futuFinancialSource else { throw ResearchDocumentClientError.invalidResponse }
                let saved = try await client.readHistoricalFutuFinancialMaterial(
                    membership: membership, materialId: selected.id, revision: selected.revision,
                    contentFingerprint: selected.contentFingerprint)
                guard saved == selected else { throw ResearchDocumentClientError.invalidResponse }
                let capture = try await client.readFutuFinancialCapture(membership: membership,
                    captureId: source.captureId)
                guard capture.membershipVersion == source.membershipVersion else {
                    throw ResearchDocumentClientError.invalidResponse
                }
                var originals: [String] = []
                for coordinate in source.pages {
                    guard let page = capture.pages.first(where: { $0.id == coordinate.pageId
                        && $0.statementType == coordinate.statementType && $0.rawSha256 == coordinate.rawSha256
                        && $0.reports.contains(where: { $0.reportSha256 == coordinate.reportSha256 }) }) else {
                        throw ResearchDocumentClientError.invalidResponse
                    }
                    let original = try await client.readFutuFinancialOriginal(membership: membership,
                        capture: capture, page: page)
                    originals.append("\(page.statementType.title) · 原始页 #\(page.id)\n\(original.rawText)")
                }
                guard manualDirectMembershipKey == key,
                      AppEnvironment.researchAuthorizationContext() == authorization else {
                    throw ResearchDocumentClientError.invalidResponse
                }
                researchDocumentWorkspace.savedOriginal = ResearchSavedOriginalPresentation(
                    title: "OpenD 材料 #\(selected.id)",
                    body: "已存材料：\n\(selected.contentText)\n\n原始响应：\n\(originals.joined(separator: "\n\n"))",
                    verification: "已核对保存版本和原始页字节。第三方声明，未核实；不是发行人事实。",
                    highlightRange: nil)
            default: throw ResearchDocumentClientError.invalidResponse
            }
            guard manualDirectMembershipKey == key,
                  AppEnvironment.researchAuthorizationContext() == authorization else {
                throw ResearchDocumentClientError.invalidResponse
            }
        } catch {
            guard manualDirectMembershipKey == key else { return }
            manualDirectSourceMessage = "原件无法按当前材料版本打开；没有用相似资料替代。"
        }
    }

    @ViewBuilder
    func manualDirectSavedSourcesSection() -> some View {
        let materials = manualDirectSavedMaterials
        VStack(alignment: .leading, spacing: 7) {
            Text(manualDirectCurrentBindings.map { "已核对 \($0.count) 条当前公司原件" }
                 ?? "已选 \(manualDirectSelectedMaterialIds.count) 条；保存前须核对原件")
                .font(.caption).foregroundStyle(.secondary)
            DisclosureGroup("选择已保存的公司资料") {
                if materials.isEmpty {
                    Text("当前没有可选的有效已存 PDF、HTML 或 OpenD 材料。可先到资料与原文核对现有资料。")
                        .font(.caption).foregroundStyle(.orange)
                    Button("打开资料与原文") { researchActions.workflow(.materials) }
                        .buttonStyle(.bordered)
                }
                ForEach(materials) { material in
                    VStack(alignment: .leading, spacing: 4) {
                        Toggle(isOn: Binding(
                            get: { manualDirectSelectedMaterialIds.contains(material.id) },
                            set: { selected in
                                if selected { manualDirectSelectedMaterialIds.insert(material.id) }
                                else { manualDirectSelectedMaterialIds.remove(material.id) }
                                manualDirectVerifiedSources = []
                                manualDirectSelectionId = UUID()
                                manualDirectSourceMessage = "所选资料已变化，请重新核对原件。"
                            }
                        )) {
                            Text(material.title).font(.callout.weight(.semibold))
                        }
                        .disabled(manualPendingDecisionRequest != nil || isVerifyingManualDirectSources
                            || manualDecisionPreflightInFlight
                            || (!manualDirectSelectedMaterialIds.contains(material.id)
                                && manualDirectSelectedMaterialIds.count >= 20))
                        Text("材料 #\(material.id) r\(material.revision) · \(material.sourceType) · \(String((material.publishedAt ?? "未知日期").prefix(10)))\(material.citation.map { " · 第\($0.pageNumber)页" } ?? "")")
                            .font(.caption2).foregroundStyle(.secondary)
                        Button("打开已存原件") { Task { await openManualDirectSource(material) } }
                            .buttonStyle(.bordered)
                    }.padding(.vertical, 4)
                }
                Button(isVerifyingManualDirectSources ? "正在核对" : "核对已选原件") {
                    Task { await verifyManualDirectSources() }
                }
                .disabled(manualDirectSelectedMaterialIds.isEmpty || isVerifyingManualDirectSources
                    || manualPendingDecisionRequest != nil || manualDecisionPreflightInFlight)
                .buttonStyle(.borderedProminent)
                Button("重新读取当前公司材料") { Task { await loadManualDirectSourcesIfNeeded() } }
                    .buttonStyle(.bordered)
            }
            if let manualDirectSourceMessage {
                Text(manualDirectSourceMessage).font(.caption).foregroundStyle(.secondary)
                    .accessibilityIdentifier("manualDirectSourceMessage")
            }
        }
        .task(id: manualDirectMembershipKey ?? "none") { await loadManualDirectSourcesIfNeeded() }
        .sheet(item: Binding(
            get: { researchDocumentWorkspace.savedOriginal },
            set: { researchDocumentWorkspace.savedOriginal = $0 }
        )) { original in
            NavigationStack {
                VStack(alignment: .leading, spacing: 12) {
                    Text(original.verification).font(.caption).foregroundStyle(.secondary)
                    ScrollView { Text(original.body).textSelection(.enabled) }
                }
                .padding()
                .navigationTitle(original.title)
                .navigationBarTitleDisplayMode(.inline)
            }
        }
        .accessibilityIdentifier("manualDirectSavedSources")
    }

    func manualOrdinaryChangeIsCurrent(_ handoff: PersonalFormalResearchHandoff) -> Bool {
        guard let context = handoff.ordinaryChangeContext else { return true }
        guard let membership = selectedMembership,
              membership.id == handoff.membershipId,
              membership.version == handoff.membershipVersion,
              let history = ownerStore.decisionHistory(symbol: handoff.symbol, member: membership) else { return false }
        return history.last(where: { ownerStore.isOrdinaryDecisionRecord($0) })?.id
            == context.previousOrdinaryCheckId
    }

    func manualOrdinaryChangeBindingIsCurrent(_ handoff: PersonalFormalResearchHandoff) -> Bool {
        guard let context = handoff.ordinaryChangeContext,
              context.changeSourcesSelected,
              let changeId = context.changeId,
              let selectedFactId = context.selectedFactId,
              let reasoning = ownerStore.boundOperatingReasoning(symbol: handoff.symbol),
              reasoning.inputFingerprint == context.reasoningFingerprint,
              reasoning.researchUpdate?.change?.id == changeId,
              reasoning.publicResearchChangeFact?.id == selectedFactId,
              context.comparison.map({ reasoning.publicDisclosureComparison == $0 }) ?? true else { return false }
        return true
    }

    func manualCurrentResearchChangeBinding(for handoff: PersonalFormalResearchHandoff) -> OrdinaryResearchChangeBinding? {
        guard manualOrdinaryChangeIsCurrent(handoff), manualOrdinaryChangeBindingIsCurrent(handoff),
              let context = handoff.ordinaryChangeContext,
              let previousId = context.previousOrdinaryCheckId,
              let selectedFactId = context.selectedFactId,
              let reasoning = ownerStore.boundOperatingReasoning(symbol: handoff.symbol),
              let update = reasoning.researchUpdate,
              let change = update.change,
              change.id == context.changeId,
              change.changedFactIds.contains(selectedFactId),
              let fact = reasoning.facts.first(where: { $0.id == selectedFactId }),
              change.sourceIds.contains(fact.source.materialId),
              let member = selectedMembership,
              member.id == handoff.membershipId, member.actorId == reasoning.actorId,
              let material = ownerStore.templateFrozen?.data?.materials.first(where: {
                  $0.id == fact.source.materialId && $0.revision == fact.source.revision
                    && $0.contentFingerprint == fact.source.contentFingerprint
                    && $0.revisionState == "current" && $0.freshness == "fresh"
                    && parseInstant($0.validUntil).map({ $0 > Date() }) == true
              }), material.symbol == handoff.symbol,
              parseInstant(fact.source.validUntil).map({ $0 > Date() }) == true,
              handoff.manualSources.contains(where: { source in
                  source.publishedAt.map({ String($0.prefix(10)) }) == String(fact.source.publishedAt.prefix(10))
                    && (fact.source.snapshotCitation.map { citation in
                        source.snapshotCitation?.snapshotId == citation.snapshotId
                            && source.snapshotCitation?.textSha256 == citation.textSha256
                            && source.snapshotCitation?.rawSha256 == fact.source.snapshotOriginal?.rawSha256
                    } ?? (source.documentId == fact.source.documentId
                            && source.documentPdfSha256 == fact.source.documentPdfSha256
                            && source.pageNumber == fact.source.pageNumber
                            && source.contentSha256 == fact.source.pageTextSha256))
              }) else { return nil }
        return OrdinaryResearchChangeBinding(
            membershipId: handoff.membershipId, membershipVersion: handoff.membershipVersion,
            symbol: handoff.symbol, changeId: change.id,
            reasoningFingerprint: update.reasoningFingerprint,
            selectedFactId: fact.id, sourceMaterialId: fact.source.materialId,
            sourceMaterialRevision: fact.source.revision,
            sourceContentFingerprint: fact.source.contentFingerprint,
            sourcePublishedAt: fact.source.publishedAt, factPeriodEnd: fact.period.end,
            previousDecisionCheckId: previousId, nextQuestion: update.nextQuestion)
    }

    @ViewBuilder
    func manualOrdinaryDecisionSection() -> some View {
        let handoff = ownerStore.personalFormalHandoff?.purpose == .manualJudgment
            ? ownerStore.personalFormalHandoff : nil
        let handoffReady = handoff.map {
            manualHandoffSession.verifiedHandoffId == $0.id
                && manualOrdinaryChangeIsCurrent($0)
                && manualCurrentSourceBindings(for: $0) != nil
        } ?? false
        let directReady = handoff == nil && manualDirectCurrentBindings != nil
        VStack(alignment: .leading, spacing: 10) {
            SectionTitle("记录我的判断")
            Text("先写你的判断，再明确选择行动方向与复盘日期。保存前会核对所选来源和当前研究身份；记录不会下单。")
                .font(.footnote).foregroundStyle(.secondary)
            TextField("写下自己的判断及理由", text: $manualDecisionText, axis: .vertical)
                .textFieldStyle(.roundedBorder)
                .lineLimit(3...6)
                .accessibilityIdentifier("manualOrdinaryDecisionText")
            Text("行动方向").font(.callout.weight(.semibold))
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(minimum: 66), spacing: 6),
                                     count: dynamicTypeSize.isAccessibilitySize ? 2 : 4), spacing: 6) {
                ForEach(DecisionActionIntent.formalDecisionCases) { intent in
                    Button(intent.label) { actionIntent = intent }
                        .frame(maxWidth: .infinity, minHeight: 44)
                        .buttonStyle(.bordered)
                        .tint(actionIntent == intent ? Color.accentColor : Color.secondary)
                        .background(actionIntent == intent ? Color.accentColor.opacity(0.12) : Color.clear,
                                    in: RoundedRectangle(cornerRadius: 8))
                        .accessibilityIdentifier("manualActionIntent-\(intent.rawValue)")
                }
            }
            Picker("人工检查", selection: $humanCheckResult) {
                ForEach(HumanCheckResult.allCases) { result in Text(result.label).tag(result) }
            }
            Toggle("设定下一次复盘日期（香港时间）", isOn: $manualReviewDateEnabled)
                .accessibilityIdentifier("manualReviewDateEnabled")
            DatePicker("复盘日期", selection: $manualReviewDate, displayedComponents: .date)
                .environment(\.timeZone, TimeZone(identifier: "Asia/Hong_Kong")!)
                .disabled(!manualReviewDateEnabled)
                .accessibilityIdentifier("manualReviewDueOn")
            if manualReviewDateEnabled {
                Text("到期前不会列入 Today；提前复盘仍保存在同一决定的历史中。")
                    .font(.footnote).foregroundStyle(.secondary)
            }
            if let handoff {
                if manualHandoffSession.verifiedHandoffId == handoff.id {
                    Text("已选 \(handoff.manualSources.count) 条来源并重新核对；详情可在下方展开。")
                        .font(.caption).foregroundStyle(.secondary)
                } else {
                    Text("所选来源交接尚未重新核对；判断草稿保留，保存暂不可用。")
                        .font(.caption).foregroundStyle(.orange)
                    Button("重新核对所选来源") {
                        Task { await reconcilePersonalManualResearchHandoff() }
                    }.buttonStyle(.bordered)
                }
            } else {
                manualDirectSavedSourcesSection()
            }
            if handoff != nil, annualDecisionBriefProfileDraft != annualDecisionBriefProfileLoadedDraft {
                Text("研究档案仍有未保存的编辑；先保存或撤销草稿，再记录决定。")
                    .font(.footnote).foregroundStyle(.orange)
            }
            if handoff != nil,
               !annualDecisionBriefEvidenceDraft.summary.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                Text("证据摘要还有未保存的编辑；先保存或清空草稿。")
                    .font(.footnote).foregroundStyle(.orange)
            }
            if ownerStore.personalFormalHandoff?.purpose == .manualJudgment,
               ownerStore.personalFormalHandoff.flatMap({ manualCurrentSourceBindings(for: $0) }) == nil {
                Text("这条交接仍需保存所选原件的证据摘要；也可返回公司页重新选择来源。")
                    .font(.footnote).foregroundStyle(.secondary)
            }
            if let reserved = manualPendingDecisionRequest {
                Text("上一笔仍待核对：\(reserved.request.userFinalDecision ?? "未填写决定")")
                    .font(.footnote).foregroundStyle(.orange)
            }
            Button(manualDecisionPreflightInFlight || manualDecisionSubmissionState.isInFlight
                   ? "核对中" : manualPendingDecisionRequest == nil ? "确认并记录判断" : "核对或重试上一笔判断") {
                Task { await submitManualOrdinaryDecision() }
            }
            .buttonStyle(.borderedProminent)
            .disabled(manualDecisionPreflightInFlight || manualDecisionSubmissionState.isInFlight
                      || (manualPendingDecisionRequest == nil && (
                          manualDecisionText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                          || (handoff == nil && !directReady)
                          || (handoff != nil && (!handoffReady
                              || annualDecisionBriefProfileDraft != annualDecisionBriefProfileLoadedDraft
                              || !annualDecisionBriefEvidenceDraft.summary.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)))))
            .accessibilityIdentifier("submitManualOrdinaryDecision")
            if let manualDecisionMessage {
                Text(manualDecisionMessage).font(.footnote).foregroundStyle(.secondary)
                    .accessibilityIdentifier("manualOrdinaryDecisionMessage")
            }
            if let handoff = ownerStore.personalFormalHandoff,
               handoff.purpose == .manualJudgment,
               handoff.ordinaryChangeContext != nil {
                DisclosureGroup("查看上一次判断与修订参考") {
                    switch ownerStore.manualJudgmentProjection(symbol: handoff.symbol) {
                    case .some(.recorded(let previous)):
                        Text("上一次普通判断 · \(WorkspaceTimestamp.hongKong(previous.checkedAt))")
                            .font(.subheadline.weight(.semibold))
                        Text(verbatim: previous.originalText).textSelection(.enabled)
                        Button("用旧判断开始编辑") {
                            guard manualDecisionText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                                  manualPendingDecisionRequest == nil else { return }
                            manualDecisionText = previous.originalText
                        }
                        .disabled(!manualDecisionText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                                  || manualPendingDecisionRequest != nil)
                        .accessibilityIdentifier("copyPreviousOrdinaryJudgmentDraft")
                    case .some(.stale), .some(.unavailable), nil:
                        Text("旧普通判断暂不能可靠回读；请先核对决定历史。")
                            .font(.caption).foregroundStyle(.orange)
                    default:
                        Text("当前没有可对照的旧普通判断。")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                }
            }
            if manualUnconfirmedDecision != nil {
                Button("查看尚待回读的决定历史") {
                    selectedDecisionLayer = .review
                    selectedReviewWorkspace = .timeline
                }.accessibilityIdentifier("openUnconfirmedManualDecisionReview")
            }
            if manualDecisionReadbackId != nil {
                Button("查看现有决定与复盘") {
                    selectedDecisionLayer = .review
                    selectedReviewWorkspace = .timeline
                }.accessibilityIdentifier("openManualDecisionReview")
            }
        }
        .padding(.top, 10)
        .accessibilityIdentifier("manualOrdinaryDecision")
    }

    @MainActor
    func manualReservationIdentityCurrent(_ reserved: ManualDecisionRequestReservation) -> Bool {
        guard let membership = selectedMembership, let symbol = parsedSymbol,
              reserved.recoverableRequest(
                symbol: symbol.canonical, membershipId: membership.id,
                membershipVersion: membership.version,
                connectionScope: PersonalFormalResearchHandoff.currentConnectionScope(),
                handoffId: reserved.handoffId,
                authorizationRevision: viewModel.authorizationRevision
              ) != nil else { return false }
        if let bindings = reserved.request.manualSourceBindings,
           !bindings.isEmpty, bindings.allSatisfy({ $0.bindingKind == "saved_material" }) {
            return ownerStore.personalFormalHandoff?.purpose != .manualJudgment
                && manualDirectSelectionId == reserved.handoffId
                && manualDirectCurrentBindings == bindings
        }
        guard let handoff = ownerStore.personalFormalHandoff else { return false }
        return handoff.purpose == .manualJudgment
            && handoff.id == reserved.handoffId
            && manualHandoffSession.verifiedHandoffId == handoff.id
    }

    @MainActor
    func submitManualOrdinaryDecision() async {
        guard !manualDecisionPreflightInFlight, !manualDecisionSubmissionState.isInFlight else { return }
        manualDecisionPreflightInFlight = true
        defer { manualDecisionPreflightInFlight = false }

        // An unknown prior POST always wins over a new decision. Its original
        // request and key can replay before the server checks today's context.
        if let reserved = manualPendingDecisionRequest {
            guard manualReservationIdentityCurrent(reserved) else {
                manualDecisionMessage = "上一笔决定仍待核对；当前公司、成员、连接或交接已变化，未发送新请求。"
                return
            }
            guard let pending = manualDecisionSubmissionState.begin(fingerprint: reserved.fingerprint),
                  pending.idempotencyKey == reserved.request.idempotencyKey else {
                manualDecisionMessage = "上一笔决定的幂等身份不一致，未发送请求。"
                return
            }
            await finishManualDecisionReservation(reserved, pending: pending)
            return
        }

        if ownerStore.personalFormalHandoff?.purpose != .manualJudgment {
            await submitManualDirectSavedSourceDecision()
            return
        }

        guard let handoff = ownerStore.personalFormalHandoff,
              handoff.purpose == .manualJudgment,
              manualOrdinaryChangeIsCurrent(handoff),
              manualHandoffSession.verifiedHandoffId == handoff.id,
              let membership = selectedMembership,
              membership.id == handoff.membershipId,
              membership.version == handoff.membershipVersion,
              let symbol = parsedSymbol,
              symbol.canonical == handoff.symbol,
              annualDecisionBriefProfileDraftSource?.state == .existing,
              annualDecisionBriefProfileDraft == annualDecisionBriefProfileLoadedDraft,
              annualDecisionBriefEvidenceDraft.summary.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              !isWritingAnnualDecisionBriefResearch,
              let sourceBindings = manualCurrentSourceBindings(for: handoff),
              let context = decisionContext,
              context.requestedSymbol == symbol.canonical,
              context.research.status == "available",
              let metadata = context.research.metadata,
              metadata.freshness == "fresh", !metadata.stale, !metadata.conflict,
              !metadata.fixture, metadata.provenance == "research_only",
              metadata.authority == "research_evidence",
              sourceBindings.allSatisfy({ binding in
                  context.research.evidence.contains(where: { item in
                      item.id == binding.evidenceId && item.sourceType == binding.sourceType
                          && item.sourceUrl == binding.sourceUrl
                  })
              }) else {
            manualDecisionMessage = "请先核对所选来源并保存当前研究档案；决定资料须可用且非测试样本。"
            return
        }
        let decision = manualDecisionText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !decision.isEmpty else { return }
        let reviewDueOn = manualReviewDateEnabled ? manualReviewDateString(manualReviewDate) : nil
        let intent = actionIntent.rawValue
        let checkResult = humanCheckResult.rawValue
        let authorizationRevision = viewModel.authorizationRevision
        do {
            let sourceReadback = await ownerStore.verifyPersonalFormalHandoff(handoff)
            guard case .current = sourceReadback,
                  dailyClientAuthorizationIsCurrent(authorizationRevision),
                  ownerStore.personalFormalHandoff == handoff else {
                manualDecisionMessage = "所选原件已变化或暂不可核验；判断草稿保留，未发送写入。"
                return
            }
            let fresh = try await client.fetchDecisionContext(market: symbol.market, code: symbol.code)
            guard dailyClientAuthorizationIsCurrent(authorizationRevision),
                  ownerStore.personalFormalHandoff == handoff,
                  manualOrdinaryChangeIsCurrent(handoff),
                  manualHandoffSession.verifiedHandoffId == handoff.id,
                  selectedMembership?.id == membership.id,
                  selectedMembership?.version == membership.version,
                  parsedSymbol?.canonical == symbol.canonical,
                  manualDecisionText.trimmingCharacters(in: .whitespacesAndNewlines) == decision,
                  (manualReviewDateEnabled ? manualReviewDateString(manualReviewDate) : nil) == reviewDueOn,
                  actionIntent.rawValue == intent,
                  humanCheckResult.rawValue == checkResult else { return }
            guard fresh.contextId == context.contextId, fresh.contextHash == context.contextHash,
                  fresh.research.status == "available",
                  fresh.research.metadata?.freshness == "fresh",
                  fresh.research.metadata?.stale == false,
                  fresh.research.metadata?.conflict == false,
                  fresh.research.metadata?.fixture == false,
                  fresh.research.metadata?.provenance == "research_only",
                  fresh.research.metadata?.authority == "research_evidence",
                  fresh.research.evidence.filter({ item in
                      sourceBindings.contains(where: { $0.evidenceId == item.id
                          && $0.sourceType == item.sourceType && $0.sourceUrl == item.sourceUrl })
                  }).count == sourceBindings.count else {
                decisionContext = fresh
                manualDecisionMessage = "决定资料已变化；当前草稿保留，请重新核对后再记录。"
                return
            }
            let researchChangeBinding = manualCurrentResearchChangeBinding(for: handoff)
            let fingerprint = DecisionCheckSubmissionFingerprint(
                contextId: fresh.contextId, contextHash: fresh.contextHash,
                actionIntent: intent, humanCheckResult: checkResult,
                userFinalDecision: decision,
                reviewDueOn: reviewDueOn,
                manualSourceBindings: sourceBindings,
                researchChangeBinding: researchChangeBinding
            )
            guard let pending = manualDecisionSubmissionState.begin(fingerprint: fingerprint) else { return }
            let request = CreateDecisionCheckRequest(
                decisionContextSchemaVersion: fresh.schemaVersion,
                contextId: fresh.contextId, contextHash: fresh.contextHash,
                actionIntent: intent, humanCheckResult: checkResult,
                userFinalDecision: decision, reviewedAt: nil,
                reviewDueOn: reviewDueOn,
                manualSourceBindings: sourceBindings,
                researchChangeBinding: researchChangeBinding,
                idempotencyKey: pending.idempotencyKey
            )
            let reserved = ManualDecisionRequestReservation(
                symbol: symbol.canonical, membershipId: membership.id,
                membershipVersion: membership.version, connectionScope: handoff.connectionScope,
                handoffId: handoff.id, authorizationRevision: authorizationRevision,
                request: request
            )
            manualPendingDecisionRequest = reserved
            await finishManualDecisionReservation(reserved, pending: pending)
        } catch {
            manualDecisionMessage = "决定资料读取失败；草稿保留：\(error.localizedDescription)"
        }
    }

    @MainActor
    func submitManualDirectSavedSourceDecision() async {
        guard ownerStore.personalFormalHandoff?.purpose != .manualJudgment,
              let membership = selectedMembership, membership.state == .tracked,
              let symbol = parsedSymbol, symbol.canonical == membership.symbol,
              let sourceBindings = manualDirectCurrentBindings,
              let membershipKey = manualDirectMembershipKey,
              manualDirectSelectionMembershipKey == membershipKey else {
            manualDecisionMessage = "请先在本页选择当前公司的已存资料并核对原件；判断草稿保留。"
            return
        }
        let decision = manualDecisionText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !decision.isEmpty else { return }
        let reviewDueOn = manualReviewDateEnabled ? manualReviewDateString(manualReviewDate) : nil
        let intent = actionIntent.rawValue
        let checkResult = humanCheckResult.rawValue
        let selectionId = manualDirectSelectionId
        let authorizationRevision = viewModel.authorizationRevision
        let authorization = AppEnvironment.researchAuthorizationContext()
        await verifyManualDirectSources()
        guard dailyClientAuthorizationIsCurrent(authorizationRevision),
              AppEnvironment.researchAuthorizationContext() == authorization,
              ownerStore.personalFormalHandoff?.purpose != .manualJudgment,
              selectedMembership == membership, parsedSymbol?.canonical == symbol.canonical,
              manualDirectSelectionId == selectionId,
              manualDirectMembershipKey == membershipKey,
              manualDirectCurrentBindings == sourceBindings else {
            manualDecisionMessage = "所选原件、成员或连接已变化；原判断草稿保留，未发送。"
            return
        }
        do {
            let fresh = try await client.fetchDecisionContext(market: symbol.market, code: symbol.code)
            guard dailyClientAuthorizationIsCurrent(authorizationRevision),
                  AppEnvironment.researchAuthorizationContext() == authorization,
                  selectedMembership == membership, parsedSymbol?.canonical == symbol.canonical,
                  manualDirectSelectionId == selectionId,
                  manualDirectCurrentBindings == sourceBindings,
                  manualDecisionText.trimmingCharacters(in: .whitespacesAndNewlines) == decision,
                  (manualReviewDateEnabled ? manualReviewDateString(manualReviewDate) : nil) == reviewDueOn,
                  actionIntent.rawValue == intent, humanCheckResult.rawValue == checkResult,
                  fresh.requestedSymbol == symbol.canonical else { return }
            if let previous = decisionContext,
               (previous.contextId != fresh.contextId || previous.contextHash != fresh.contextHash) {
                decisionContext = fresh
                manualDecisionMessage = "决定资料已变化；当前判断保留，请核对后再次保存。"
                return
            }
            decisionContext = fresh
            let fingerprint = DecisionCheckSubmissionFingerprint(
                contextId: fresh.contextId, contextHash: fresh.contextHash,
                actionIntent: intent, humanCheckResult: checkResult,
                userFinalDecision: decision, reviewDueOn: reviewDueOn,
                manualSourceBindings: sourceBindings
            )
            guard let pending = manualDecisionSubmissionState.begin(fingerprint: fingerprint) else { return }
            let request = CreateDecisionCheckRequest(
                decisionContextSchemaVersion: fresh.schemaVersion,
                contextId: fresh.contextId, contextHash: fresh.contextHash,
                actionIntent: intent, humanCheckResult: checkResult,
                userFinalDecision: decision, reviewedAt: nil,
                reviewDueOn: reviewDueOn, manualSourceBindings: sourceBindings,
                researchChangeBinding: nil, idempotencyKey: pending.idempotencyKey
            )
            let reserved = ManualDecisionRequestReservation(
                symbol: symbol.canonical, membershipId: membership.id,
                membershipVersion: membership.version,
                connectionScope: PersonalFormalResearchHandoff.currentConnectionScope(),
                handoffId: selectionId, authorizationRevision: authorizationRevision,
                request: request
            )
            manualPendingDecisionRequest = reserved
            await finishManualDecisionReservation(reserved, pending: pending)
        } catch {
            manualDecisionMessage = "决定资料读取失败；判断草稿与已核对原件保持原样。"
        }
    }

    @MainActor
    func finishManualDecisionReservation(_ reserved: ManualDecisionRequestReservation,
                                         pending: PendingDecisionCheckSubmission) async {
        guard let symbol = parsedSymbol,
              reserved == manualPendingDecisionRequest,
              manualReservationIdentityCurrent(reserved),
              manualDecisionSubmissionState.isCurrent(pending),
              pending.idempotencyKey == reserved.request.idempotencyKey else {
            _ = manualDecisionSubmissionState.finishFailurePreservingRetry(for: pending)
            manualDecisionMessage = "上一笔决定的身份已变化；草稿和原幂等键保留，未发送新请求。"
            return
        }
        let request = reserved.request
        let authorizationRevision = reserved.authorizationRevision
        manualDecisionMessage = manualUnconfirmedDecision == nil
            ? "正在核对或重试同一笔决定；不会下单。"
            : "正在回读上一笔决定；不会重复写入。"
        let responseData: DecisionCheckData
        if let unconfirmed = manualUnconfirmedDecision {
            guard unconfirmed.symbol == reserved.symbol,
                  unconfirmed.contextId == request.contextId,
                  unconfirmed.contextHash == request.contextHash,
                  unconfirmed.actionIntent == request.actionIntent,
                  unconfirmed.humanCheckResult == request.humanCheckResult,
                  unconfirmed.userFinalDecision == request.userFinalDecision,
                  unconfirmed.reviewDueOn == request.reviewDueOn,
                  unconfirmed.manualSourceBindings == request.manualSourceBindings,
                  unconfirmed.researchChangeBinding == request.researchChangeBinding else {
                _ = manualDecisionSubmissionState.finishFailurePreservingRetry(for: pending)
                manualDecisionMessage = "待回读决定与原请求不一致；未发送新的写入。"
                return
            }
            responseData = unconfirmed
        } else {
            do {
                let response = try await client.createDecisionCheck(
                    market: symbol.market, code: symbol.code, request: request
                )
                guard dailyClientAuthorizationIsCurrent(authorizationRevision),
                      manualDecisionSubmissionState.isCurrent(pending),
                      reserved == manualPendingDecisionRequest,
                      manualReservationIdentityCurrent(reserved),
                      selectedMembership?.id == reserved.membershipId,
                      selectedMembership?.version == reserved.membershipVersion,
                      parsedSymbol?.canonical == reserved.symbol,
                      response.data.symbol == reserved.symbol,
                      response.data.contextId == request.contextId,
                      response.data.contextHash == request.contextHash,
                      response.data.actionIntent == request.actionIntent,
                      response.data.humanCheckResult == request.humanCheckResult,
                      response.data.userFinalDecision == request.userFinalDecision,
                      response.data.reviewDueOn == request.reviewDueOn,
                      response.data.manualSourceBindings == request.manualSourceBindings,
                      response.data.researchChangeBinding == request.researchChangeBinding else {
                    _ = manualDecisionSubmissionState.finishFailurePreservingRetry(for: pending)
                    manualDecisionMessage = "写入响应与原请求或当前身份不一致；原幂等键保留。"
                    return
                }
                manualUnconfirmedDecision = response.data
                responseData = response.data
            } catch {
                guard manualDecisionSubmissionState.finishFailurePreservingRetry(for: pending) else { return }
                manualDecisionMessage = decisionWriteFailurePresentation(for: error, operation: .humanCheck).message
                return
            }
        }
        let history: DecisionReviewHistoryEnvelope
        do {
            history = try await client.fetchDecisionReviewHistory(market: symbol.market, code: symbol.code)
        } catch {
            _ = manualDecisionSubmissionState.finishFailurePreservingRetry(for: pending)
            manualDecisionMessage = "写入响应已收到，但复盘历史回读失败；原请求与幂等键保留，请稍后核对。"
            return
        }
        guard dailyClientAuthorizationIsCurrent(authorizationRevision),
              manualDecisionSubmissionState.isCurrent(pending),
              reserved == manualPendingDecisionRequest,
              manualReservationIdentityCurrent(reserved),
              selectedMembership?.id == reserved.membershipId,
              selectedMembership?.version == reserved.membershipVersion,
              parsedSymbol?.canonical == reserved.symbol,
              history.requestedSymbol == reserved.symbol,
              history.checks.contains(where: { $0.id == responseData.id
                  && $0.contextId == request.contextId && $0.contextHash == request.contextHash
                  && $0.reviewDueOn == request.reviewDueOn
                  && $0.manualSourceBindings == request.manualSourceBindings
                  && $0.researchChangeBinding == request.researchChangeBinding }) else {
            _ = manualDecisionSubmissionState.finishFailurePreservingRetry(for: pending)
            manualDecisionMessage = "写入响应已收到，但复盘历史尚未回读到同一记录；原请求与幂等键保留。"
            return
        }
        guard manualDecisionSubmissionState.finishSuccessOrReplay(for: pending) else { return }
        manualPendingDecisionRequest = nil
        manualUnconfirmedDecision = nil
        submittedDecision = responseData
        submittedDecisionSymbol = reserved.symbol
        decisionReviewHistory = history
        manualDecisionReadbackId = responseData.id
        manualDecisionMessage = request.manualSourceBindings?.allSatisfy({ $0.bindingKind == "saved_material" }) == true
            ? "已用选定的当前公司材料记录普通判断，并回读到同一笔复盘历史；Today 将重新读取。"
            : request.researchChangeBinding == nil
                ? "普通判断已记录并在复盘历史中回读；这次资料变化未作为结构化关联保存。"
                : "判断与选定资料变化已记录，并在复盘历史中回读；可继续填写后续复盘。"
        todayRefreshRevision &+= 1
    }

}
#endif
