import SwiftUI

enum WorkspaceTimestamp {
    static func hongKong(_ value: String) -> String {
        let parser = ISO8601DateFormatter()
        parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = parser.date(from: value) ?? ISO8601DateFormatter().date(from: value) else { return "时间待核对" }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "zh_CN")
        formatter.timeZone = TimeZone(identifier: "Asia/Hong_Kong")
        formatter.dateFormat = "MM-dd HH:mm"
        return formatter.string(from: date) + " 香港时间"
    }
}

enum CompanyWorkspaceTab: String, CaseIterable, Identifiable {
    case overview = "概览", documents = "资料", analysis = "分析", judgment = "判断"
    var id: String { rawValue }
}

struct WorkspaceRowLabel: View {
    let title: String
    var subtitle: String = ""
    var icon: String? = nil
    var titleLineLimit: Int? = nil
    var subtitleLineLimit: Int? = nil
    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            if let icon { Image(systemName: icon).foregroundStyle(Theme.gold).frame(width: 24) }
            VStack(alignment: .leading, spacing: 5) {
                Text(title).font(.body).foregroundStyle(Theme.textPrimary).lineLimit(titleLineLimit)
                if !subtitle.isEmpty { Text(subtitle).font(.footnote).foregroundStyle(Theme.textSecondary).lineLimit(subtitleLineLimit).fixedSize(horizontal: false, vertical: true) }
            }
            Spacer(minLength: 8)
            Image(systemName: "chevron.right").font(.caption).foregroundStyle(Theme.textSecondary)
        }.frame(maxWidth: .infinity, minHeight: 52, alignment: .leading)
            .padding(.vertical, 8).contentShape(Rectangle())
    }
}

struct WorkspacePrimaryButton: View {
    let title: String
    var icon = "arrow.right"
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            HStack { Spacer(); Text(title).font(.headline); Spacer(); Image(systemName: icon) }
                .padding(.horizontal, 16).frame(minHeight: 49)
                .foregroundStyle(.white).background(Theme.gold, in: RoundedRectangle(cornerRadius: 13))
        }.buttonStyle(.plain)
    }
}

struct WorkspaceTools: ToolbarContent {
    @Environment(\.antigravityActions) private var actions
    var showsSearch = true
    var body: some ToolbarContent {
        ToolbarItemGroup(placement: .topBarTrailing) {
            if showsSearch { Button("搜索", systemImage: "magnifyingglass") { actions.search() }.labelStyle(.iconOnly) }
            Menu {
                Button("研究助手", systemImage: "sparkles") { actions.assistant() }
                Button("连接与授权", systemImage: "gearshape") { actions.connection() }
                ThemeToggleButton()
            } label: { Label("更多", systemImage: "ellipsis").labelStyle(.iconOnly).frame(minWidth: 44, minHeight: 44) }
        }
    }
}

struct CompanyDocumentsView: View {
    @ObservedObject private var store = OwnerClientStore.shared
    @State private var requestRevision = UUID()
    let membership: CandidateMembershipData
    @Environment(\.antigravityActions) private var actions
    @State private var list: ResearchDocumentListEnvelope?
    @State private var snapshots: [ResearchSourceSnapshotData] = []
    @State private var snapshotsLoaded = false
    @State private var query = ""
    @State private var issue: String?
    @State private var loading = false
    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            HStack {
                Image(systemName: "magnifyingglass")
                TextField("搜索这家公司的资料标题", text: $query)
                    .accessibilityIdentifier("companyDocumentSearch")
            }.padding(14).background(Theme.bgSecondary, in: RoundedRectangle(cornerRadius: 13))
            HStack {
                Text("财报与公告").font(.headline)
                Spacer()
                Button("导入") { actions.workflow(.materials) }.frame(minHeight: 44)
            }
            if loading { ProgressView("正在读取公司资料…") }
            else if let issue {
                Text(issue).font(.subheadline).foregroundStyle(Theme.textSecondary)
                Button("重新读取") { Task { await load() } }
            } else if list != nil || snapshotsLoaded {
                let documents = (list?.documents ?? []).filter { query.isEmpty || $0.title.localizedCaseInsensitiveContains(query) }
                let storedPages = snapshots.filter { query.isEmpty || $0.publisher.localizedCaseInsensitiveContains(query)
                    || $0.summary.localizedCaseInsensitiveContains(query) }
                if list?.documents.isEmpty != false && snapshots.isEmpty {
                    Text("还没有取得这家公司的原文资料。可以先导入财报或查看资料线索。")
                        .font(.body).foregroundStyle(Theme.textSecondary)
                    WorkspacePrimaryButton(title: "导入资料") { actions.workflow(.materials) }
                } else if documents.isEmpty && storedPages.isEmpty {
                    Text("没有匹配的资料标题。全文检索可在资料工作区中继续。")
                        .font(.subheadline).foregroundStyle(Theme.textSecondary)
                }
                ForEach(documents) { document in
                    NavigationLink {
                        CompanyDocumentReader(membership: membership, document: document)
                    } label: {
                        WorkspaceRowLabel(title: document.title,
                            subtitle: "\(document.publishedAt.prefix(10)) · \(document.pageCount) 页 · \(document.isSourceAvailable ? "可读取原文" : "原文暂不可用")", icon: "doc.text")
                    }.buttonStyle(.plain)
                    Divider()
                }
                ForEach(storedPages) { snapshot in
                    NavigationLink {
                        CompanyStoredSourceReader(membership: membership, snapshotId: snapshot.id)
                    } label: {
                        WorkspaceRowLabel(title: snapshot.summary,
                            subtitle: "\(snapshot.publishedAt?.prefix(10) ?? "披露日待核对") · 官方网页 · \(snapshot.reviewState == "pending_review" ? "需要重新核对" : snapshot.reviewState == "historical" ? "历史原文" : "已保存原文")",
                            icon: "doc.text")
                    }.buttonStyle(.plain)
                    Divider()
                }
            }
            Button { actions.workflow(.materials) } label: {
                WorkspaceRowLabel(title: "全文检索与资料管理", subtitle: "搜索原文内容、导入与引用核对", icon: "text.magnifyingglass")
            }.buttonStyle(.plain)
            Text("需要核对").font(.headline)
            NavigationLink { DocumentFactCandidatesView(symbol: membership.symbol) } label: {
                WorkspaceRowLabel(title: "事实候选", subtitle: "待确认内容，不等于已核实事实", icon: "checkmark")
            }.buttonStyle(.plain)
            Divider()
            NavigationLink { ResearchSourceIntakeView(symbol: membership.symbol) } label: {
                WorkspaceRowLabel(title: "资料线索与版本更新", subtitle: "包含仅有标题、尚未取得正文的线索", icon: "arrow.clockwise")
            }.buttonStyle(.plain)
        }.task(id: "\(membership.id):\(membership.version):\(store.authorizationRevision)") { await load() }
    }
    private func load() async {
        let revision = UUID(); requestRevision = revision
        defer { if requestRevision == revision { loading = false } }
        list = nil; snapshots = []; snapshotsLoaded = false; issue = nil; loading = true
        let auth = AppEnvironment.researchAuthorizationContext()
        let client = ResearchClient(baseURL: auth.baseURL, authToken: auth.readToken, authHeaderName: auth.readHeaderName)
        var documentFailed = false
        var snapshotFailed = false
        do { list = try await client.fetchResearchDocuments(membership: membership) }
        catch { documentFailed = true }
        guard !Task.isCancelled, requestRevision == revision,
              auth == AppEnvironment.researchAuthorizationContext() else { return }
        do { snapshots = try await client.listResearchSourceSnapshots(membership: membership); snapshotsLoaded = true }
        catch { snapshotFailed = true }
        guard !Task.isCancelled, requestRevision == revision,
              auth == AppEnvironment.researchAuthorizationContext() else { return }
        if documentFailed && snapshotFailed { issue = "公司资料暂未读取成功，请核对连接与读取授权后重试。" }
        else if documentFailed || snapshotFailed { issue = nil }
        loading = false
    }
}

struct CompanyStoredSourceReader: View {
    @ObservedObject private var store = OwnerClientStore.shared
    let membership: CandidateMembershipData
    let snapshotId: String
    var expectedCitation: ResearchSnapshotCitation? = nil
    var expectedOriginal: ResearchSnapshotOriginal? = nil
    var expectedCoordinate: PersonalFormalSnapshotCoordinate? = nil
    @State private var snapshot: ResearchSourceSnapshotData?
    @State private var selectedExcerpt: String?
    @State private var issue: String?
    @State private var requestRevision = UUID()
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                if let snapshot, let text = snapshot.normalizedText {
                    Text("已保存官方网页 · \(snapshot.publisher)").font(.headline)
                    Text(snapshot.reviewState == "pending_review" ? "新版本需要重新核对" : snapshot.reviewState == "historical" ? "历史原文" : "原件已核对")
                        .font(.caption).foregroundStyle(Theme.gold)
                    if let selectedExcerpt {
                        Text("引用段落").font(.headline)
                        Text(selectedExcerpt).textSelection(.enabled)
                        Divider()
                    }
                    Text(text).textSelection(.enabled)
                    if let url = URL(string: snapshot.responseUrl) { Link("发布方现场链接", destination: url) }
                    DisclosureGroup("原件身份") {
                        Text("raw \(snapshot.rawSha256)\ntext \(snapshot.textSha256)")
                            .font(.caption.monospaced()).textSelection(.enabled)
                    }
                } else {
                    Text(issue ?? "正在读取已保存原文…")
                    Button("重新读取") { Task { await load() } }
                }
            }.padding(20)
        }
        .background(Theme.bgPrimary)
        .navigationTitle("已保存原文")
        .task(id: "\(membership.id):\(membership.version):\(snapshotId):\(store.authorizationRevision)") { await load() }
    }
    private func load() async {
        let revision = UUID(); requestRevision = revision
        snapshot = nil; selectedExcerpt = nil; issue = nil
        let auth = AppEnvironment.researchAuthorizationContext()
        let client = ResearchClient(baseURL: auth.baseURL, authToken: auth.readToken, authHeaderName: auth.readHeaderName)
        do {
            let fresh = try await client.readResearchSourceSnapshot(membership: membership, snapshotId: snapshotId)
            _ = try await client.readResearchSourceSnapshotOriginal(membership: membership, snapshot: fresh)
            let excerpt: String?
            if let expectedCoordinate {
                guard expectedCoordinate.isValid,
                      expectedCoordinate.snapshotId == fresh.id,
                      expectedCoordinate.rawSha256 == fresh.rawSha256,
                      expectedCoordinate.textSha256 == fresh.textSha256,
                      let text = fresh.normalizedText,
                      expectedCoordinate.endUtf16 <= text.utf16.count,
                      expectedCoordinate.readEndUtf16 <= text.utf16.count else {
                    throw ResearchDocumentClientError.invalidResponse
                }
                let full = text as NSString
                let selected = full.substring(with: NSRange(location: expectedCoordinate.startUtf16,
                    length: expectedCoordinate.endUtf16 - expectedCoordinate.startUtf16))
                let read = full.substring(with: NSRange(location: expectedCoordinate.readStartUtf16,
                    length: expectedCoordinate.readEndUtf16 - expectedCoordinate.readStartUtf16))
                guard researchDocumentSha256(Data(selected.utf8)) == expectedCoordinate.excerptSha256,
                      researchDocumentSha256(Data(read.utf8)) == expectedCoordinate.readExcerptSha256 else {
                    throw ResearchDocumentClientError.invalidResponse
                }
                excerpt = selected
            } else if let expectedCitation, let expectedOriginal {
                guard expectedCitation.isValid,
                      expectedCitation.snapshotId == fresh.id,
                      expectedCitation.textSha256 == fresh.textSha256,
                      expectedOriginal.rawSha256 == fresh.rawSha256,
                      expectedOriginal.byteLength == fresh.byteLength,
                      expectedOriginal.canonicalUrl == fresh.canonicalUrl,
                      expectedOriginal.responseUrl == fresh.responseUrl,
                      let text = fresh.normalizedText,
                      expectedCitation.endUtf16 <= text.utf16.count,
                      let bound = fresh.selectedCitation(range: NSRange(location: expectedCitation.startUtf16,
                          length: expectedCitation.endUtf16 - expectedCitation.startUtf16)),
                      bound.0 == expectedCitation else { throw ResearchDocumentClientError.invalidResponse }
                excerpt = bound.1
            } else { excerpt = nil }
            guard !Task.isCancelled, requestRevision == revision,
                  auth == AppEnvironment.researchAuthorizationContext() else { return }
            snapshot = fresh
            selectedExcerpt = excerpt
        } catch {
            guard !Task.isCancelled, requestRevision == revision else { return }
            issue = "已保存原件暂不可用或哈希不符；请重试读取。"
        }
    }
}

struct CompanyDocumentReader: View {
    @ObservedObject private var store = OwnerClientStore.shared
    @State private var requestRevision = UUID()
    let membership: CandidateMembershipData
    let document: ResearchDocumentData
    var pageNumber = 1
    @State private var data: Data?
    @State private var issue: String?
    @State private var loading = false
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(document.title).font(.headline)
            Text("\(membership.research.name ?? membership.symbol) · \(document.publishedAt.prefix(10)) · 第 \(pageNumber) 页")
                .font(.footnote).foregroundStyle(Theme.textSecondary)
            if let data { ResearchDocumentPDFView(data: data, pageNumber: pageNumber) }
            else if loading { ProgressView("正在读取原文…").frame(maxWidth: .infinity, maxHeight: .infinity) }
            else {
                Text(issue ?? "原文暂不可用").font(.body)
                Button("重新读取原文") { Task { await load() } }.frame(minHeight: 44)
                if let raw = document.capturedSourceUrl, let url = URL(string: raw), ["https", "http"].contains(url.scheme?.lowercased() ?? "") {
                    Link("打开原始来源", destination: url)
                }
                Spacer()
            }
        }.padding(24).background(Theme.bgPrimary).navigationTitle("原文")
            .navigationBarTitleDisplayMode(.inline)
            .task(id: "\(membership.id):\(membership.version):\(document.id):\(pageNumber):\(store.authorizationRevision)") { await load() }
    }
    private func load() async {
        let revision = UUID(); requestRevision = revision
        defer { if requestRevision == revision { loading = false } }
        data = nil; issue = nil; loading = true
        guard document.symbol == membership.symbol, document.membershipId == membership.id,
              document.isSourceAvailable, pageNumber > 0, pageNumber <= document.pageCount else {
            issue = "这份原文尚不可读，或引用页与当前资料不匹配。"; loading = false; return
        }
        let auth = AppEnvironment.researchAuthorizationContext()
        do {
            let result = try await ResearchClient(baseURL: auth.baseURL, authToken: auth.readToken, authHeaderName: auth.readHeaderName)
                .fetchResearchDocumentContent(membership: membership, document: document)
            guard !Task.isCancelled, requestRevision == revision, auth == AppEnvironment.researchAuthorizationContext() else { return }
            data = result
        } catch {
            guard !Task.isCancelled, requestRevision == revision, auth == AppEnvironment.researchAuthorizationContext() else { return }
            issue = "这份原文暂时打不开，请检查网络或来源状态。未显示旧的原文。"
        }
        loading = false
    }
}
