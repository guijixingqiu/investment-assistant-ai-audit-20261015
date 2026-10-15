import SwiftUI

struct ResearchSourceIntakeImpact: Decodable { let questionIds:[String]; let thesisTestIds:[String]; let partialThesisTestIds:[String]?; let missingDependenciesByTest:[String:[String]]?; let candidateIds:[String]; let limitation:String }
struct ResearchSourceVersion:Decodable,Identifiable {let documentId:String;let pdfSha256:String;let pageCount:Int;let reviewState:String;let importedAt:String;let textFingerprint:String;var id:String {documentId}}
struct ResearchSourceEvent:Decodable,Identifiable {let sequence:Int?;let eventId:String;let leadId:String;let fromStatus:String?;let toStatus:String;let eventType:String;let documentId:String?;let pdfSha256:String?;let previousDocumentId:String?;let previousPdfSha256:String?;let reason:String?;let reasonCode:String?;let reasonSnapshot:String?;let observedAt:String;let actor:String;var id:String {eventId}}
struct ResearchSourceEventPage:Decodable {let events:[ResearchSourceEvent];let nextBeforeSequence:Int?}
struct ResearchSourceLeadPage:Decodable {let leads:[ResearchSourceLead];let nextBeforeLeadId:String?}
struct ResearchInboxItem:Decodable,Identifiable {let id:String;let leadId:String;let type:String;let actionability:String;let relevance:String;let title:String;let summary:String;let effectiveAt:String;let eventId:String?;let eventSequence:Int?;let documentId:String?;let factGroupIds:[String];let questionIds:[String];let thesisTestIds:[String]}
struct ResearchFactReviewGroup:Decodable,Identifiable {let id:String;let title:String;let assertionSourceCount:Int;let recommendedAction:String}
struct ResearchInboxProjection:Decodable {struct Counts:Decodable {let required:Int;let reviewWhenRelevant:Int;let informational:Int;let resolved:Int};let requiredCount:Int;let otherCount:Int;let items:[ResearchInboxItem];let factGroups:[ResearchFactReviewGroup];let counts:Counts}
struct ResearchSourceLead: Decodable, Identifiable {
    let leadId:String;let symbol:String;let membershipId:String;let membershipVersion:Int;let sourceType:String;let publisher:String;let title:String;let publicationDate:String?;let publishedAt:String;let discoveredAt:String;let canonicalUrl:String;let documentKind:String;let status:String;let origin:String;let documentId:String?;let documentPdfSha256:String?;let reviewReason:String?;let statusChangedAt:String;let documentReviewState:String?;let extractionStatus:String?;let versions:[ResearchSourceVersion]?;let impact:ResearchSourceIntakeImpact?
    let latestObservedDocumentId:String?;let latestObservedPdfSha256:String?;let activeTrustedDocumentId:String?;let activeTrustedPdfSha256:String?;let pendingReviewDocumentId:String?;let lastFetchFailureCode:String?;let nextRetryAt:String?
    var id:String {leadId}
}
struct ResearchSourceIntakeEnvelope: Decodable {
    struct Metrics:Decodable {let leadsDiscovered:Int;let documentsImported:Int;let duplicates:Int;let candidatesProposed:Int;let questionsImpacted:Int;let unsupportedTemplates:Int}
    struct RefreshState:Decodable {let lastAttemptAt:String?;let lastSuccessAt:String?;let lastDiscoverySuccessAt:String?;let lastFailureAt:String?;let discoveryFailureClass:String?;let failureClass:String?;let consecutiveFailures:Int}
    struct Monitoring:Decodable {
        struct Rule:Decodable,Identifiable {let variableName:String;let category:String;let cadence:String;let mode:String;let nextCheckAt:String?;var id:String {variableName}}
        let mode:String;let nextCheckAt:String?;let rules:[Rule];let issue:String?
    }
    let status:String;let symbol:String?;let membershipId:String;let membershipVersion:Int?;let leads:[ResearchSourceLead];let historyPage:ResearchSourceLeadPage?;let events:[ResearchSourceEvent]?;let inbox:ResearchInboxProjection?;let refreshState:RefreshState?;let monitoring:Monitoring?;let pendingReviewCount:Int;let lastSuccessfulRefresh:String?;let metrics:Metrics
}
struct ResearchSourceIntakeView:View {
    let symbol:String
    var researchPreparation = false
    @Environment(\.dismiss) private var dismiss
    @State private var researchBrief: PersonalBrief?
    @State private var readinessMessage = ""
    @State private var cloudAiEnabled: Bool?
    @State private var checkingReadiness = false
    @State private var readinessRevision = UUID()
    @ObservedObject private var api=OwnerClientStore.shared
    @State private var message=""
    @State private var refreshing=false
    @State private var candidates:[OperatingFactCandidate]=[]
    @State private var sourceURL=""
    @State private var sourceTitle=""
    @State private var sourceDate=Date()
    @State private var documentKind="announcement"
    @State private var versionReviewReason=""
    @State private var eventHistory:[ResearchSourceEvent]=[]
    @State private var historyCursor:Int?
    @State private var allLeads:[ResearchSourceLead]=[]
    @State private var leadCursor:String?
    private var envelope:ResearchSourceIntakeEnvelope? { api.sourceIntake?.symbol == symbol ? api.sourceIntake : nil }
    var body:some View {ClientPage(title:researchPreparation ? "准备研究资料" : "资料更新") {
        if researchPreparation { preparationStatus }

        Button(refreshing ? "检查中…" : "立即检查最新官方资料") { Task { await refresh(force:true) } }.disabled(refreshing).accessibilityIdentifier("phase8RefreshOfficialSources")
        DisclosureGroup("提供官方 PDF 链接") {
            TextField("港交所 PDF 链接（吉利亦支持官网）",text:$sourceURL).textInputAutocapitalization(.never).autocorrectionDisabled().accessibilityIdentifier("phase8OfficialURL")
            TextField("披露标题",text:$sourceTitle).accessibilityIdentifier("phase8OfficialTitle")
            DatePicker("披露日期",selection:$sourceDate,in:...Date(),displayedComponents:.date).accessibilityIdentifier("phase8OfficialPublishedAt")
            Picker("资料类型",selection:$documentKind) { Text("经营公告").tag("monthly_sales"); Text("财务业绩").tag("financial_results"); Text("其他公告").tag("announcement") }
            Button("核对并导入官方资料") { Task { await refresh(manual:true) } }.disabled(refreshing || sourceURL.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty || sourceTitle.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty).accessibilityIdentifier("phase8SubmitOfficialURL")
            Text("当前支持港交所 PDF，以及吉利官网 PDF。核对公司身份并取得财报正文后，才能用于资料问答；结构化财务候选的确认另行处理。") .font(.caption2).foregroundStyle(.secondary)
        }
        if !message.isEmpty {Text(message).font(.caption).foregroundStyle(.secondary)}
        if let data=envelope {
            if (data.inbox?.requiredCount ?? data.pendingReviewCount) > 0 {Text("需要你处理 \(data.inbox?.requiredCount ?? data.pendingReviewCount) 项").font(.headline).foregroundStyle(Theme.gold).accessibilityIdentifier("phase10RequiredCount")}
            else if data.refreshState?.discoveryFailureClass != nil {Text("本轮官方资料发现未完成；现有待办数不能代表没有新公告。").font(.subheadline).foregroundStyle(Theme.gold).accessibilityIdentifier("phase10RequiredCount")}
            else {Text("当前已读取范围内没有必须处理的资料事项").font(.subheadline).foregroundStyle(.secondary).accessibilityIdentifier("phase10RequiredCount")}
            Text("另有 \(data.inbox?.otherCount ?? 0) 项资料更新 · 上次成功发现：\(data.refreshState?.lastDiscoverySuccessAt?.prefix(16) ?? data.lastSuccessfulRefresh?.prefix(16) ?? "尚无")").font(.caption2).foregroundStyle(.secondary)
            if data.refreshState?.discoveryFailureClass != nil { Text("本次官方发现暂不可用；已有研究数据仍可查看。").font(.caption2).foregroundStyle(Theme.gold) }
            monitoringSection(data)
            let items=data.inbox?.items ?? []
            let required=items.filter {$0.actionability == "REQUIRED"}
            let relevant=items.filter {$0.actionability == "REVIEW_WHEN_RELEVANT"}
            let other=items.filter {$0.actionability == "INFORMATIONAL"}
            let resolved=items.filter {$0.actionability == "RESOLVED"}
            if !required.isEmpty {
                Text("需要你处理").font(.subheadline).foregroundStyle(Theme.gold)
                ForEach(Array(required.prefix(3))) { inboxRow($0,leads:data.leads) }
                if required.count > 3 { DisclosureGroup("更多待处理 · \(required.count - 3)") { ForEach(Array(required.dropFirst(3))) { inboxRow($0,leads:data.leads) } } }
            }
            if !relevant.isEmpty {
                Text("与当前研究相关").font(.subheadline)
                ForEach(Array(relevant.prefix(3))) { inboxRow($0,leads:data.leads) }
                if relevant.count > 3 { DisclosureGroup("更多相关资料 · \(relevant.count - 3)") { ForEach(Array(relevant.dropFirst(3))) { inboxRow($0,leads:data.leads) } } }
            }
            if !other.isEmpty { DisclosureGroup("其他更新 · \(other.count)") { ForEach(other) { inboxRow($0,leads:data.leads) } } }
            if !resolved.isEmpty { DisclosureGroup("已处理 · \(resolved.count)") { ForEach(resolved) { inboxRow($0,leads:data.leads) } } }
            DisclosureGroup("全部资料与历史 · \(data.metrics.leadsDiscovered)") {
                ForEach(allLeads.isEmpty ? data.historyPage?.leads ?? data.leads : allLeads) { leadRow($0) }
                if (allLeads.isEmpty ? data.historyPage?.nextBeforeLeadId : leadCursor) != nil {Button("查看更早资料") {Task {await loadMoreLeads()}}.accessibilityIdentifier("phase11LoadMoreSourceLeads")}
            }
            Color.clear.frame(height:110)
        } else { Text("尚未读取资料更新；现有研究仍可继续查看。").font(.caption).foregroundStyle(.secondary) }
    }.task(id:"\(symbol):\(api.authorizationRevision)") {
        candidates=[];allLeads=[];leadCursor=nil;researchBrief=nil;message=""
        if researchPreparation { documentKind="financial_results" }
        guard api.selectedSymbol==symbol else { readinessMessage="当前公司已变化，请返回后重新进入。";return }
        let auth=AppEnvironment.researchAuthorizationContext()
        do {
            try await api.fetchSourceIntake(symbol:symbol)
            let values=try await api.factCandidates(symbol:symbol)
            guard auth==AppEnvironment.researchAuthorizationContext(),api.selectedSymbol==symbol else{return}
            candidates=values
        } catch {
            guard auth==AppEnvironment.researchAuthorizationContext(),api.selectedSymbol==symbol else{return}
            message="资料更新暂不可用，已有报告仍可阅读。"
        }
        if researchPreparation { await checkReadiness() }
    }.toolbar {
        if researchPreparation { ToolbarItem(placement:.confirmationAction) { Button("返回研究") { dismiss() }.disabled(refreshing) } }
    }.interactiveDismissDisabled(refreshing) }
    private var preparationStatus: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(symbol).font(.footnote).foregroundStyle(.secondary)
            Text(researchBrief?.status == "available" ? "已取得可用于研究的财报正文" : "先准备可查证的公开财报").font(.title3.bold())
            if checkingReadiness { ProgressView("正在核对资料是否可用于研究…") }
            if let brief=researchBrief, brief.status == "available" {
                Text("已取得 \(brief.sources.count) 页可查证正文。生成研究时仍会保留来源、期间及缺口。")
                Button("公开财报已准备，返回研究") { dismiss() }.buttonStyle(.borderedProminent)
                    .accessibilityIdentifier("researchPreparationReady")
            } else {
                Text("先检查官方资料；没有找到财报时，可补充该公司财报的港交所公开链接，并选择“财务业绩”。")
                Text("仅上传本地 PDF 只授权本地阅读，不会自动解锁 AI 研究。已有本地文件时，可以按其公开来源链接重新获取；不会修改原文件的授权。")
                    .font(.footnote).foregroundStyle(.secondary)
            }
            Text(cloudAiEnabled == true ? "AI 使用授权：已启用；生成时仍会再次核对。"
                 : cloudAiEnabled == false ? "AI 使用授权：尚未启用。请在公司分析 → 研究报告 → AI 使用设置中核对。"
                 : "AI 使用授权：尚未核对。资料就绪不代表已获准发送给模型。")
                .font(.footnote).foregroundStyle(.secondary)
            if !readinessMessage.isEmpty { Text(readinessMessage).font(.footnote).foregroundStyle(Theme.amber) }
            Button("重新检查研究资料") { Task { await checkReadiness() } }.disabled(refreshing || checkingReadiness)
            Divider()
        }.font(.body)
    }
    @MainActor private func checkReadiness() async {
        let revision=UUID();readinessRevision=revision
        checkingReadiness=true;researchBrief=nil;cloudAiEnabled=nil;readinessMessage=""
        defer { if readinessRevision==revision { checkingReadiness=false } }
        guard api.selectedSymbol==symbol,let member=api.membershipEnvelope?.memberships.first(where:{$0.symbol==symbol && $0.state.rawValue=="tracked"}) else {
            readinessMessage="请先将这家公司加入研究自选，再准备资料。";return
        }
        let auth=AppEnvironment.researchAuthorizationContext()
        do {
            let result=try await PersonalBriefClient.load(member)
            guard !Task.isCancelled,readinessRevision==revision,auth==AppEnvironment.researchAuthorizationContext(),api.selectedSymbol==symbol,
                  api.membershipEnvelope?.memberships.contains(where:{$0.id==member.id && $0.version==member.version && $0.state.rawValue=="tracked"})==true else{return}
            researchBrief=result
            let client=ResearchClient(baseURL:auth.baseURL,authToken:auth.readToken,authHeaderName:auth.readHeaderName)
            let policy=try? await client.fetchCloudAiPolicy(expectedActorId:member.actorId)
            guard !Task.isCancelled,readinessRevision==revision,auth==AppEnvironment.researchAuthorizationContext(),api.selectedSymbol==symbol,
                  api.membershipEnvelope?.memberships.contains(where:{$0.id==member.id && $0.version==member.version && $0.state.rawValue=="tracked"})==true else{return}
            cloudAiEnabled=policy?.isEnabled
            if result.status != "available" { readinessMessage="尚未取得已核对的公开财报正文。仅有标题、待审版本或本地上传文件不能作为当前研究依据。" }
        } catch {
            guard readinessRevision==revision,auth==AppEnvironment.researchAuthorizationContext(),api.selectedSymbol==symbol else{return}
            readinessMessage="研究资料核对暂未完成，请检查连接后重试。"
        }
    }
    private func statusLabel(_ status:String)->String {
        switch status {case "NEEDS_REVIEW":return "需要核对来源";case "DUPLICATE":return "已关联现有资料";case "IMPORTED":return "已导入";case "DISCOVERED":return "发现新线索";case "SUPPORTED":return "官方来源已识别";case "REJECTED":return "捕获版本已拒绝";default:return "状态待确认"}
    }
    private func inboxRow(_ item:ResearchInboxItem,leads:[ResearchSourceLead])->some View {
        let group=envelope?.inbox?.factGroups.first(where:{item.factGroupIds.contains($0.id)})
        return NavigationLink {
            if let lead=leads.first(where:{$0.leadId==item.leadId}) {leadDetail(lead)} else {ClientPage(title:"资料更新") {Text("该资料已不在当前研究范围，请重新读取。")}}
        } label: {
            VStack(alignment:.leading,spacing:5) {
                Text(item.title).font(.subheadline).lineLimit(2)
                Text(item.summary).font(.caption2).foregroundStyle(.secondary).lineLimit(3)
                if let group,group.assertionSourceCount>1 {Text(group.recommendedAction == "REVIEW_CONFLICT" ? "同一期间存在冲突披露" : "同一经济事实 · \(group.assertionSourceCount) 个来源一致").font(.caption2).foregroundStyle(Theme.gold)}
            }
        }.accessibilityIdentifier("phase10Inbox-" + item.id)
    }
    private func leadRow(_ lead:ResearchSourceLead)->some View {
        let item=envelope?.inbox?.items.first(where:{$0.leadId==lead.leadId})
        let label=item?.type == "ADMINISTRATIVE_DISCLOSURE" ? "行政资料已存档" : item?.type == "DUPLICATE_RESOLVED" ? "已关联现有资料" : lead.status == "NEEDS_REVIEW" && lead.pendingReviewDocumentId == nil ? "来源获取或身份待核对" : statusLabel(lead.status)
        return NavigationLink { leadDetail(lead) } label: {VStack(alignment:.leading,spacing:4){Text(lead.title).font(.subheadline).lineLimit(2);Text("\(lead.publisher) · \(lead.publishedAt.prefix(10)) · \(label)").font(.caption2).foregroundStyle(.secondary)}}.accessibilityIdentifier("phase8Lead-" + lead.leadId)
    }
    private func leadDetail(_ lead:ResearchSourceLead)->some View {ClientPage(title:"官方资料线索") {
        Text(lead.title).font(.headline)
        Text("来源：\(lead.publisher) · \(lead.sourceType)")
        Text("披露：\(lead.publishedAt)\n发现：\(lead.discoveredAt)\n状态：\(statusLabel(lead.status))").font(.caption)
        if let active=lead.activeTrustedDocumentId {Text("当前可信文档 #\(active) · 可用于后续候选核对").font(.caption).foregroundStyle(.secondary)}
        if let latest=lead.latestObservedDocumentId,latest != lead.activeTrustedDocumentId {Text("最近捕获文档 #\(latest) · 与当前可信版本不同").font(.caption).foregroundStyle(Theme.gold)}
        if lead.pendingReviewDocumentId != nil {Text("待核对版本未确认前，旧版本可阅读，但暂停新增 FACT 确认。").font(.caption2).foregroundStyle(Theme.gold)}
        if lead.lastFetchFailureCode != nil {Text("来源暂时无法自动获取；系统按该来源单独重试，不阻断其他公告。").font(.caption2).foregroundStyle(.secondary)}
        if let url=URL(string:lead.canonicalUrl){Link("打开发布方链接",destination:url)}
        if let reason=lead.reviewReason {Text(reason).font(.caption).foregroundStyle(Theme.gold)}
        if let versions=lead.versions, !versions.isEmpty {
            Text("文档版本 · 当前可信 / 待审 / 历史").font(.subheadline)
            ForEach(versions) { version in Text("#\(version.documentId) · \(version.reviewState == "TRUSTED" ? "已核对" : version.reviewState == "REJECTED" ? "已拒绝" : "待核对") · \(version.pageCount) 页\nPDF \(version.pdfSha256)\n页面文本 \(version.textFingerprint)").font(.caption2).textSelection(.enabled) }
        }
        Button("查看线索与版本历史") {Task {await loadHistory(lead,reset:true)}}.accessibilityIdentifier("phase10LeadHistory")
        ForEach(eventHistory.filter{$0.leadId==lead.leadId}) { event in
            Text("\(event.observedAt.prefix(16)) · \(statusLabel(event.toStatus))\n\(event.reasonSnapshot ?? event.eventType)").font(.caption2).foregroundStyle(.secondary)
        }
        if historyCursor != nil {Button("查看更早记录") {Task {await loadHistory(lead,reset:false)}}}
        if let documentId=lead.pendingReviewDocumentId,lead.documentReviewState == "NEEDS_REVIEW" {
            TextField("文档版本核对理由",text:$versionReviewReason).accessibilityIdentifier("phase9VersionReviewReason")
            Button("允许新文档版本进入候选核对") { Task { await reviewVersion(lead,documentId:documentId,accept:true) } }.disabled(versionReviewReason.trimmingCharacters(in:.whitespacesAndNewlines).count<3).accessibilityIdentifier("phase9AcceptDocumentVersion")
            Button("拒绝此捕获版本") { Task { await reviewVersion(lead,documentId:documentId,accept:false) } }.disabled(versionReviewReason.trimmingCharacters(in:.whitespacesAndNewlines).count<3).accessibilityIdentifier("phase9RejectDocumentVersion")
            Text("审核文档版本不会确认任何候选 FACT。").font(.caption2).foregroundStyle(.secondary)
        }
        if let documentId=lead.latestObservedDocumentId {
            Text("已导入文档 #\(documentId) · PDF SHA \(lead.documentPdfSha256 ?? "UNKNOWN")").font(.caption2)
            NavigationLink("查看文档与候选") { DocumentFactCandidatesView(symbol:symbol) }
        }
        if let impact=lead.impact {
            Text("可能影响的问题：\(impact.questionIds.count) · Thesis Test：\(impact.thesisTestIds.count)").font(.caption)
            if let partial=impact.partialThesisTestIds,!partial.isEmpty {Text("仅补到部分依赖：\(partial.joined(separator:", ")) · 仍缺 \(impact.missingDependenciesByTest?[partial[0]]?.joined(separator:", ") ?? "其他同口径输入")").font(.caption2).foregroundStyle(Theme.gold)}
            Text(impact.limitation).font(.caption2).foregroundStyle(.secondary)
        } else {Text("历史线索 · 当前研究影响未计算").font(.caption2).foregroundStyle(.secondary)}
        let related=candidates.filter { lead.impact?.candidateIds.contains($0.id) == true && $0.symbol==symbol && $0.membershipVersion==lead.membershipVersion }
        if lead.status == "IMPORTED" && lead.extractionStatus == "NO_SUPPORTED_TEMPLATE_OR_ROWS" {Text("文件已保存，但当前没有受支持的结构化提取模板。仍可打开官方原文人工阅读。").font(.caption).foregroundStyle(.secondary)}
        if lead.extractionStatus == "NOT_SCANNED_OR_LIMITED" {Text("文件已保存；当前提取窗口尚不足以判定模板是否支持，请人工阅读。").font(.caption).foregroundStyle(.secondary)}
        ForEach(Array(related.prefix(6))) { candidate in NavigationLink { OperatingCandidateConfirmation(candidate:candidate) } label: { OperatingCandidateListLabel(candidate:candidate) } }
        if related.count>6 { DisclosureGroup("更多已提取项目 · \(related.count-6)") {ForEach(Array(related.dropFirst(6))) {candidate in NavigationLink {OperatingCandidateConfirmation(candidate:candidate)} label:{OperatingCandidateListLabel(candidate:candidate)}}} }
    }}
    @MainActor private func refresh(manual:Bool=false,force:Bool=false) async {
        guard !refreshing else{return}
        let auth=AppEnvironment.researchAuthorizationContext()
        refreshing=true;defer{refreshing=false};do {
        let day=DateFormatter();day.dateFormat="yyyy-MM-dd";day.locale=Locale(identifier:"en_US_POSIX");day.timeZone=TimeZone(identifier:"Asia/Hong_Kong")
        let proposal:[String:String]? = manual ? ["url":sourceURL.trimmingCharacters(in:.whitespacesAndNewlines),"title":sourceTitle.trimmingCharacters(in:.whitespacesAndNewlines),"publicationDate":day.string(from:sourceDate),"documentKind":documentKind] : nil
        try await api.refreshSourceIntake(symbol:symbol,manual:proposal,force:force)
        let values=try await api.factCandidates(symbol:symbol)
        guard auth==AppEnvironment.researchAuthorizationContext(),api.selectedSymbol==symbol else{return}
        candidates=values
        if api.sourceIntake?.refreshState?.discoveryFailureClass != nil {
            message="本轮官方新资料发现未完成；已保存的旧资料仍可阅读，不能据此判断没有新公告。"
        } else if api.sourceIntake?.leads.contains(where: { $0.lastFetchFailureCode != nil }) == true {
            message="官方资料发现已完成，但部分原件抓取失败；请查看下方对应来源状态。"
        } else {
            message="本轮范围内的官方资料检查已返回，研究是否可用以正文核对结果为准。"
        }
        if researchPreparation { await checkReadiness() }
    }catch{
        guard auth==AppEnvironment.researchAuthorizationContext(),api.selectedSymbol==symbol else{return}
        message="官方资料获取尚未完成，已有研究仍可查看。"
        if researchPreparation { await checkReadiness() }
    }}
    @MainActor private func reviewVersion(_ lead:ResearchSourceLead,documentId:String,accept:Bool) async {do {try await api.reviewSourceDocumentVersion(symbol:symbol,leadId:lead.leadId,documentId:documentId,accept:accept,reason:versionReviewReason);candidates=try await api.factCandidates(symbol:symbol);message=accept ? "新文档版本可进入候选核对，尚未确认任何 FACT。" : "捕获版本已拒绝并保留历史。"}catch{message="文档版本核对失败：\(error.localizedDescription)"}}
    @MainActor private func loadHistory(_ lead:ResearchSourceLead,reset:Bool) async {
        do {let page=try await api.sourceLeadHistory(symbol:symbol,leadId:lead.leadId,beforeSequence:reset ? nil:historyCursor);eventHistory=reset ? page.events:eventHistory+page.events;historyCursor=page.nextBeforeSequence}
        catch {message="历史记录暂不可用：\(error.localizedDescription)"}
    }
    @MainActor private func loadMoreLeads() async {
        guard let data=envelope,let cursor=allLeads.isEmpty ? data.historyPage?.nextBeforeLeadId : leadCursor else{return}
        do {let page=try await api.sourceLeadPage(symbol:symbol,beforeLeadId:cursor);let first=allLeads.isEmpty ? data.historyPage?.leads ?? [] : allLeads;allLeads=first+page.leads;leadCursor=page.nextBeforeLeadId}
        catch {message="更早资料暂不可用：\(error.localizedDescription)"}
    }
    @ViewBuilder private func monitoringSection(_ data:ResearchSourceIntakeEnvelope)->some View {
        if let monitoring=data.monitoring {
            VStack(alignment:.leading,spacing:5) {
                Text(monitoring.mode == "active" ? "本地服务运行时按已确认规则检查官方来源" : monitoring.mode == "manual_only" ? "当前规则需要人工核对来源" : monitoring.mode == "paused" ? "公司跟踪已暂停；不会继续定期检查" : "监控规则暂不可核对；自动检查已暂停")
                    .font(.caption).foregroundStyle(monitoring.mode == "active" ? Color.secondary : Theme.gold)
                Text("上次尝试：\(data.refreshState?.lastAttemptAt?.prefix(16) ?? "尚无") · 下次最早：\(monitoring.nextCheckAt?.prefix(16) ?? "无定期计划")（UTC）")
                    .font(.caption2).foregroundStyle(.secondary)
                if let failure=data.refreshState?.failureClass ?? data.refreshState?.discoveryFailureClass {
                    Text("上次来源检查失败：\(failure) · \(data.refreshState?.lastFailureAt?.prefix(16) ?? "时间未知") UTC")
                        .font(.caption2).foregroundStyle(Theme.gold)
                }
                if let issue=monitoring.issue { Text(issue).font(.caption2).foregroundStyle(Theme.gold) }
                if !monitoring.rules.isEmpty {
                    DisclosureGroup("规则检查范围") {
                        ForEach(monitoring.rules) { rule in
                            Text("\(rule.variableName) · \(monitorCategoryLabel(rule.category)) · \(monitorCadenceLabel(rule.cadence)) · \(rule.mode == "scheduled" ? "官方来源定期检查" : rule.mode == "manual_only" ? "仍需人工核对" : "未启用")")
                                .font(.caption2).foregroundStyle(.secondary)
                        }
                    }
                }
            }
        } else { Text("定期监控状态尚未读取；可手动检查官方资料。").font(.caption2).foregroundStyle(.secondary) }
    }
    private func monitorCategoryLabel(_ category:String)->String {
        ["announcement":"公告","financial_report":"财报","corporate_action":"公司行动","major_news":"重大新闻","price_volume_anomaly":"价量异常","operating_kpi":"经营指标","industry_chain_price":"产业链价格","competition":"竞争","policy":"政策","macro":"宏观"][category] ?? category
    }
    private func monitorCadenceLabel(_ cadence:String)->String {
        ["on_event":"每6小时轮询（非实时）","daily":"每日","weekly":"每周","monthly":"每月","quarterly":"每季度"][cadence] ?? cadence
    }
}
