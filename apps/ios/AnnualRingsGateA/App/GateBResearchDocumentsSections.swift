import SwiftUI
import UniformTypeIdentifiers
import UIKit

struct ResearchSourceSnapshotWorkspaceState {
    var identity: String?
    var snapshots: [ResearchSourceSnapshotData] = []
    var current: ResearchSourceSnapshotData?
    var rawVerified = false
    var selection = NSRange(location: 0, length: 0)
    var citation: ResearchSnapshotCitation?
    var selectedExcerpt: String?
    var url = ""
    var validUntil = Calendar.current.date(byAdding: .year, value: 1, to: Date()) ?? Date()
    var ownerConfirmed = false
    var message = "读取当前公司后可保存支持的官方网页。"
    var busy = false
    var requestRevision = UUID()
    var captureReservation = ResearchDocumentIdempotencyReservation()
    var confirmReservation = ResearchDocumentIdempotencyReservation()

    mutating func clear(_ nextIdentity: String) {
        identity = nextIdentity
        requestRevision = UUID()
        snapshots = []
        current = nil
        rawVerified = false
        selection = NSRange(location: 0, length: 0)
        citation = nil
        selectedExcerpt = nil
        ownerConfirmed = false
        busy = false
        message = "正在读取已保存的官方网页。"
        captureReservation.clear()
        confirmReservation.clear()
    }

    mutating func clearAction() {
        current = nil
        rawVerified = false
        selection = NSRange(location: 0, length: 0)
        citation = nil
        selectedExcerpt = nil
        ownerConfirmed = false
        confirmReservation.clear()
    }
}

struct ResearchStoredTextPresentation: Identifiable {
    let snapshot: ResearchSourceSnapshotData
    let excerpt: String
    var id: String { "\(snapshot.id):\(snapshot.textSha256):\(excerpt.hashValue)" }
}

private struct ResearchStoredTextSelection: UIViewRepresentable {
    let text: String
    @Binding var selection: NSRange

    func makeUIView(context: Context) -> UITextView {
        let view = UITextView()
        view.isEditable = false
        view.isSelectable = true
        view.font = .preferredFont(forTextStyle: .body)
        view.backgroundColor = .secondarySystemGroupedBackground
        view.delegate = context.coordinator
        view.accessibilityIdentifier = "researchStoredSourceText"
        return view
    }

    func updateUIView(_ view: UITextView, context: Context) {
        if view.text != text {
            view.text = text
            view.selectedRange = NSRange(location: 0, length: 0)
        }
    }

    func makeCoordinator() -> Coordinator { Coordinator(selection: $selection) }

    final class Coordinator: NSObject, UITextViewDelegate {
        var selection: Binding<NSRange>
        init(selection: Binding<NSRange>) { self.selection = selection }
        func textViewDidChangeSelection(_ textView: UITextView) {
            selection.wrappedValue = textView.selectedRange
        }
    }
}

struct ResearchSavedOriginalTextView: UIViewRepresentable {
    let text: String
    let highlightRange: NSRange?

    func makeUIView(context: Context) -> UITextView {
        let view = UITextView()
        view.isEditable = false
        view.isSelectable = true
        view.isScrollEnabled = true
        view.backgroundColor = .secondarySystemGroupedBackground
        view.accessibilityIdentifier = "researchSavedOriginalText"
        return view
    }

    func updateUIView(_ view: UITextView, context: Context) {
        guard view.text != text || context.coordinator.highlightRange != highlightRange else { return }
        let attributed = NSMutableAttributedString(string: text, attributes: [
            .font: UIFont.preferredFont(forTextStyle: .body), .foregroundColor: UIColor.label
        ])
        if let highlightRange, NSMaxRange(highlightRange) <= (text as NSString).length {
            attributed.addAttribute(.backgroundColor, value: UIColor.systemYellow.withAlphaComponent(0.55),
                range: highlightRange)
        }
        view.attributedText = attributed
        context.coordinator.highlightRange = highlightRange
        if let highlightRange {
            view.selectedRange = highlightRange
            view.layoutIfNeeded()
            view.scrollRangeToVisible(highlightRange)
        }
    }

    func makeCoordinator() -> Coordinator { Coordinator() }
    final class Coordinator { var highlightRange: NSRange? }
}

extension GateBResearchScreen {
    @ViewBuilder
    func researchDocumentsWorkspace() -> some View {
        VStack(alignment: .leading, spacing: 16) {
#if OWNER_CLIENT
            ClientCard(title: "查找资料", icon: "magnifyingglass", tone: Theme.green) {
                NavigationLink { ClientReadingPage(title: "搜索原文") { researchDocumentSearchCard() } }
                    label: { ClientLinkLabel(title: "搜索已存原文和材料", icon: "magnifyingglass", tone: Theme.green) }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("researchDocumentsSearchEntry")
            }
            ClientCard(title: "富途财报", icon: "tablecells", tone: Theme.green) {
                NavigationLink { ClientReadingPage(title: "富途财报") { futuFinancialSection() } }
                    label: { ClientLinkLabel(title: "查看富途财报", subtitle: "三表、各自期间和已核验原始页", icon: "tablecells", tone: Theme.green) }
                    .buttonStyle(.plain)
            }
            ClientCard(title: "原文资料", icon: "doc.richtext", tone: Theme.green) {
                if let list = researchDocumentWorkspace.list, !list.documents.isEmpty {
                    ForEach(list.documents) { document in
                        NavigationLink {
                            ClientReadingPage(title: "原文与引用") {
                                researchDocumentList(list)
                            }
                            .onAppear {
                                if researchDocumentWorkspace.selectedDocumentId != document.id {
                                    researchDocumentWorkspace.selectedDocumentId = document.id
                                    researchDocumentWorkspace.selectedPage = nil
                                    researchDocumentWorkspace.confirmation = nil
                                    researchDocumentWorkspace.clearOcrNoteDraft()
                                    researchDocumentWorkspace.quote = ""
                                    researchDocumentWorkspace.statement = ""
                                }
                            }
                        } label: {
                            ClientLinkLabel(title: document.title, subtitle: documentSourceSuffix(document), icon: "doc.richtext", tone: Theme.green)
                        }.buttonStyle(.plain)
                    }
                }
                ForEach(researchSourceSnapshotWorkspace.snapshots) { snapshot in
                    NavigationLink { ClientReadingPage(title: "已保存官方网页") { researchSourceSnapshotCard() } }
                        label: { ClientLinkLabel(title: snapshot.summary,
                            subtitle: snapshot.reviewState == "pending_review" ? "官方网页 · 需要重新核对"
                                : snapshot.reviewState == "historical" ? "官方网页 · 历史原文"
                                : "官方网页 · 已保存原文", icon: "doc.text", tone: Theme.green) }
                        .buttonStyle(.plain)
                }
                if researchDocumentWorkspace.list?.documents.isEmpty != false
                    && researchSourceSnapshotWorkspace.snapshots.isEmpty {
                    Text(researchDocumentWorkspace.list == nil
                        ? "正在读取资料；若读取失败，状态会显示在下方。"
                        : "尚无已导入 PDF；已保存网页可在下方读取或重新核对。")
                }
            }
            .task(id: researchDocumentTaskIdentity) {
                if researchSourceSnapshotWorkspace.identity != researchDocumentTaskIdentity {
                    researchSourceSnapshotWorkspace.clear(researchDocumentTaskIdentity)
                    await loadResearchSourceSnapshots()
                }
            }
            ClientCard(title: "资料操作", icon: "folder", tone: Theme.green) {
                NavigationLink { ClientReadingPage(title: "已保存官方网页") { researchSourceSnapshotCard() } }
                    label: { ClientLinkLabel(title: "保存并核对官方网页", subtitle: "选择原文段落后明确保存为材料", icon: "doc.text", tone: Theme.green) }
                NavigationLink { ClientReadingPage(title: "导入 PDF") { researchDocumentImportCard() } }
                    label: { ClientLinkLabel(title: "导入官方 PDF", subtitle: "选择文件后核对来源并明确确认", icon: "plus", tone: Theme.green) }
            }.buttonStyle(.plain)
            Text(researchDocumentWorkspace.message.replacingOccurrences(of: "fresh read-back", with: "读取并核对")).font(OwnerReadingFont.caption).foregroundStyle(.secondary)
                .accessibilityIdentifier("researchDocumentMessage")
#else
            DisclosureGroup("富途财报") { futuFinancialSection() }
            DisclosureGroup("已保存官方网页") { researchSourceSnapshotCard() }
            Text("PDF 原文核对")
                .font(OwnerReadingFont.title3.bold())
            Text("核对原文、页码与引用；扫描识别文字需对照原页。")
                .font(OwnerReadingFont.callout)
                .foregroundStyle(.secondary)
            DisclosureGroup("读取说明") {
                Text("仅处理你明确允许本地使用、未加密的官方 PDF：既支持带可搜索文本层的 PDF，也支持扫描件在本机本地识别文字（不上云）；扫描页识别结果需人工对照原页核验。点击搜索结果可直接打开原 PDF 的同一页对照，原文核对不会把事实升级为独立验证。")
                    .font(OwnerReadingFont.caption)
                    .foregroundStyle(.secondary)
            }
            .font(OwnerReadingFont.callout)

            if let list = researchDocumentWorkspace.list, !list.documents.isEmpty {
                researchDocumentList(list)
                researchDocumentSearchCard()
                if researchDocumentWorkspace.pendingImport != nil {
                    researchDocumentImportCard()
                } else {
                    DisclosureGroup("导入新PDF") {
                        researchDocumentImportCard(showsHeader: false)
                    }
                    .font(OwnerReadingFont.callout.weight(.semibold))
                }
            } else {
                researchDocumentSearchCard()
                researchDocumentImportCard()
                if let list = researchDocumentWorkspace.list {
                    researchDocumentList(list)
                }
            }

            Text(researchDocumentWorkspace.message)
                .font(OwnerReadingFont.callout)
                .foregroundStyle(.secondary)
                .accessibilityIdentifier("researchDocumentMessage")
#endif
        }
        .task(id: researchDocumentTaskIdentity) {
            let identity = researchDocumentTaskIdentity
            if researchDocumentWorkspace.identity == identity {
                await loadResearchDocuments(preservingCurrent: true)
                await loadResearchFundamentals(refreshDocuments: false)
            } else {
                await resetAndLoadResearchDocuments(identity: identity)
            }
        }
        .id("researchDocumentsWorkspaceAnchor")
        .fileImporter(
            isPresented: Binding(
                get: { researchDocumentWorkspace.isImporterPresented },
                set: { researchDocumentWorkspace.isImporterPresented = $0 }
            ),
            allowedContentTypes: [.pdf],
            allowsMultipleSelection: false
        ) { result in
            handleResearchDocumentSelection(result)
        }
    }

    private func researchSourceSnapshotCard() -> some View {
        VStack(alignment: .leading, spacing: 10) {
            TextField("受支持的官方网页 HTTPS 链接", text: $researchSourceSnapshotWorkspace.url)
                .textInputAutocapitalization(.never).autocorrectionDisabled()
                .textFieldStyle(.roundedBorder)
                .accessibilityIdentifier("researchSourceSnapshotURL")
            HStack {
                Button("保存官方网页") { Task { await captureResearchSourceSnapshot() } }
                    .disabled(researchSourceSnapshotWorkspace.busy || selectedMembership == nil
                        || researchSourceSnapshotWorkspace.url.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    .accessibilityIdentifier("researchSourceSnapshotCapture")
                Button("重读已保存原文") { Task { await loadResearchSourceSnapshots() } }
                    .disabled(researchSourceSnapshotWorkspace.busy || selectedMembership == nil)
            }.buttonStyle(.bordered)
            if researchSourceSnapshotWorkspace.snapshots.isEmpty {
                Text("当前没有已保存网页；仅发布方链接不能作为已存原文。")
                    .font(OwnerReadingFont.caption).foregroundStyle(.secondary)
            }
            ForEach(researchSourceSnapshotWorkspace.snapshots) { snapshot in
                Button("\(snapshot.publisher) · \(snapshot.publishedAt?.prefix(10) ?? "披露日待核对") · \(snapshot.reviewState == "pending_review" ? "需要重新核对" : snapshot.reviewState == "historical" ? "历史原文" : "已保存原文")") {
                    Task { await openResearchSourceSnapshot(snapshot.id) }
                }
                .buttonStyle(.bordered)
                .accessibilityIdentifier("researchSourceSnapshotOpen-\(snapshot.id)")
            }
            if let current = researchSourceSnapshotWorkspace.current,
               let text = current.normalizedText, researchSourceSnapshotWorkspace.rawVerified {
                Text("已保存原文 · \(current.publisher) · \(current.publishedAt?.prefix(10) ?? "披露日待核对")")
                    .font(OwnerReadingFont.headline)
                ResearchStoredTextSelection(text: text, selection: $researchSourceSnapshotWorkspace.selection)
                    .frame(height: 290)
                Button("采用所选段落") { selectResearchSourceSnapshotExcerpt() }
                    .buttonStyle(.bordered)
                    .accessibilityIdentifier("researchSourceSnapshotSelectExcerpt")
                if let excerpt = researchSourceSnapshotWorkspace.selectedExcerpt {
                    Text("已选择 \(excerpt.utf16.count) 个 UTF-16 字元；请核对以下原文。")
                        .font(OwnerReadingFont.caption)
                    Text(excerpt).font(OwnerReadingFont.body).textSelection(.enabled)
                    DatePicker("材料有效至", selection: $researchSourceSnapshotWorkspace.validUntil,
                               in: Date()..., displayedComponents: [.date])
                    Toggle("我已核对原文、选段及有效期，确认保存为材料", isOn: $researchSourceSnapshotWorkspace.ownerConfirmed)
                    Button("确认所选原文材料") { Task { await confirmResearchSourceSnapshotMaterial() } }
                        .disabled(researchSourceSnapshotWorkspace.busy || !researchSourceSnapshotWorkspace.ownerConfirmed
                            || current.membershipVersion != selectedMembership?.version
                            || !["unconfirmed", "current"].contains(current.reviewState))
                        .buttonStyle(.borderedProminent)
                        .accessibilityIdentifier("researchSourceSnapshotConfirmMaterial")
                }
                if let url = URL(string: current.responseUrl) { Link("发布方现场链接", destination: url) }
                DisclosureGroup("原件身份") {
                    Text("raw SHA-256 \(current.rawSha256)\ntext SHA-256 \(current.textSha256)\nUTF-16 · \(current.extractionVersion)")
                        .font(OwnerReadingFont.caption.monospaced()).textSelection(.enabled)
                }
            }
            Text(researchSourceSnapshotWorkspace.message)
                .font(OwnerReadingFont.caption).foregroundStyle(.secondary)
                .accessibilityIdentifier("researchSourceSnapshotMessage")
        }
        .task(id: researchDocumentTaskIdentity) {
            if researchSourceSnapshotWorkspace.identity != researchDocumentTaskIdentity {
                researchSourceSnapshotWorkspace.clear(researchDocumentTaskIdentity)
                await loadResearchSourceSnapshots()
            }
        }
    }

    @MainActor
    private func loadResearchSourceSnapshots() async {
        guard let membership = selectedMembership else {
            researchSourceSnapshotWorkspace.clearAction()
            researchSourceSnapshotWorkspace.message = "请先选择当前研究公司。"
            return
        }
        let identity = researchDocumentTaskIdentity
        let revision = UUID()
        researchSourceSnapshotWorkspace.requestRevision = revision
        researchSourceSnapshotWorkspace.busy = true
        researchSourceSnapshotWorkspace.clearAction()
        defer { if researchSourceSnapshotWorkspace.requestRevision == revision { researchSourceSnapshotWorkspace.busy = false } }
        do {
            let snapshots = try await client.listResearchSourceSnapshots(membership: membership)
            guard researchSourceSnapshotWorkspace.requestRevision == revision,
                  researchDocumentTaskIdentity == identity else { return }
            researchSourceSnapshotWorkspace.snapshots = snapshots
            researchSourceSnapshotWorkspace.message = snapshots.isEmpty ? "尚无已保存网页。" : "已读取 \(snapshots.count) 份原文；请选择一份核对。"
        } catch {
            guard researchSourceSnapshotWorkspace.requestRevision == revision else { return }
            researchSourceSnapshotWorkspace.snapshots = []
            researchSourceSnapshotWorkspace.message = "原文列表读取失败；旧内容已清除，请检查连接后重读。"
        }
    }

    @MainActor
    func openResearchSourceSnapshot(_ snapshotId: String) async {
        guard let membership = selectedMembership else { return }
        let identity = researchDocumentTaskIdentity
        let revision = UUID()
        researchSourceSnapshotWorkspace.requestRevision = revision
        researchSourceSnapshotWorkspace.busy = true
        researchSourceSnapshotWorkspace.clearAction()
        defer { if researchSourceSnapshotWorkspace.requestRevision == revision { researchSourceSnapshotWorkspace.busy = false } }
        do {
            let snapshot = try await client.readResearchSourceSnapshot(membership: membership, snapshotId: snapshotId)
            _ = try await client.readResearchSourceSnapshotOriginal(membership: membership, snapshot: snapshot)
            guard researchSourceSnapshotWorkspace.requestRevision == revision,
                  researchDocumentTaskIdentity == identity else { return }
            researchSourceSnapshotWorkspace.current = snapshot
            researchSourceSnapshotWorkspace.rawVerified = true
            researchSourceSnapshotWorkspace.message = snapshot.reviewState == "pending_review"
                ? "正文已有新版本；可读历史原文，新增确认需重新核对。"
                : snapshot.reviewState == "historical" ? "历史原文仅供阅读。" : "原始字节与已存正文均已核对；请选择准确段落。"
        } catch {
            guard researchSourceSnapshotWorkspace.requestRevision == revision else { return }
            researchSourceSnapshotWorkspace.clearAction()
            researchSourceSnapshotWorkspace.message = "已存原文不可用或校验失败；旧选段已清除，请重读。"
        }
    }

    @MainActor
    func openStoredSourceCitation(_ citation: ResearchSnapshotCitation,
                                  original: ResearchSnapshotOriginal) async -> Bool {
        await openResearchSourceSnapshot(citation.snapshotId)
        guard let snapshot = researchSourceSnapshotWorkspace.current,
              researchSourceSnapshotWorkspace.rawVerified,
              snapshot.id == citation.snapshotId,
              snapshot.textSha256 == citation.textSha256,
              snapshot.rawSha256 == original.rawSha256,
              snapshot.byteLength == original.byteLength,
              snapshot.canonicalUrl == original.canonicalUrl,
              snapshot.responseUrl == original.responseUrl,
              let text = snapshot.normalizedText,
              citation.isValid, citation.endUtf16 <= text.utf16.count,
              let selected = snapshot.selectedCitation(range: NSRange(location: citation.startUtf16,
                  length: citation.endUtf16 - citation.startUtf16)),
              selected.0 == citation else { return false }
        researchStoredTextPresentation = ResearchStoredTextPresentation(snapshot: snapshot, excerpt: selected.1)
        return true
    }

    @MainActor
    private func captureResearchSourceSnapshot() async {
        guard let membership = selectedMembership else { return }
        let identity = researchDocumentTaskIdentity
        let url = researchSourceSnapshotWorkspace.url.trimmingCharacters(in: .whitespacesAndNewlines)
        let key = researchSourceSnapshotWorkspace.captureReservation.reserve(for: "\(identity)|\(url)", prefix: "ios-source-capture")
        researchSourceSnapshotWorkspace.busy = true
        researchSourceSnapshotWorkspace.clearAction()
        defer { researchSourceSnapshotWorkspace.busy = false }
        do {
            let snapshot = try await client.captureResearchSourceSnapshot(membership: membership, url: url, idempotencyKey: key)
            guard researchDocumentTaskIdentity == identity else { return }
            researchSourceSnapshotWorkspace.captureReservation.clear()
            await loadResearchSourceSnapshots()
            await openResearchSourceSnapshot(snapshot.id)
        } catch {
            guard researchDocumentTaskIdentity == identity else { return }
            researchSourceSnapshotWorkspace.message = "保存网页失败；请核对官方链接、发布日与连接后重试。"
        }
    }

    @MainActor
    private func selectResearchSourceSnapshotExcerpt() {
        guard researchSourceSnapshotWorkspace.rawVerified,
              let snapshot = researchSourceSnapshotWorkspace.current,
              let selected = snapshot.selectedCitation(range: researchSourceSnapshotWorkspace.selection) else {
            researchSourceSnapshotWorkspace.citation = nil
            researchSourceSnapshotWorkspace.selectedExcerpt = nil
            researchSourceSnapshotWorkspace.ownerConfirmed = false
            researchSourceSnapshotWorkspace.message = "请在已保存原文中选择不超过 4000 字的完整段落。"
            return
        }
        researchSourceSnapshotWorkspace.citation = selected.0
        researchSourceSnapshotWorkspace.selectedExcerpt = selected.1
        researchSourceSnapshotWorkspace.ownerConfirmed = false
        researchSourceSnapshotWorkspace.confirmReservation.clear()
        researchFundamentalWorkspace.confirmationBinding.clear()
        researchFundamentalWorkspace.reservation.clear()
        researchSourceSnapshotWorkspace.message = "选段已定位；核对原文和有效期后再明确确认。"
    }

    @MainActor
    private func confirmResearchSourceSnapshotMaterial() async {
        guard let membership = selectedMembership,
              let snapshot = researchSourceSnapshotWorkspace.current,
              let citation = researchSourceSnapshotWorkspace.citation,
              researchSourceSnapshotWorkspace.rawVerified,
              researchSourceSnapshotWorkspace.ownerConfirmed,
              snapshot.membershipVersion == membership.version,
              ["unconfirmed", "current"].contains(snapshot.reviewState) else { return }
        let identity = researchDocumentTaskIdentity
        let expiry = ISO8601DateFormatter().string(from: researchSourceSnapshotWorkspace.validUntil)
        let key = researchSourceSnapshotWorkspace.confirmReservation.reserve(
            for: "\(identity)|\(snapshot.id)|\(citation.startUtf16)-\(citation.endUtf16)|\(citation.excerptSha256)|\(expiry)",
            prefix: "ios-source-material")
        researchSourceSnapshotWorkspace.busy = true
        defer { researchSourceSnapshotWorkspace.busy = false }
        do {
            let material = try await client.confirmResearchSourceSnapshotMaterial(
                membership: membership, snapshot: snapshot, citation: citation,
                validUntil: expiry, idempotencyKey: key)
            guard researchDocumentTaskIdentity == identity else { return }
            researchSourceSnapshotWorkspace.confirmReservation.clear()
            researchSourceSnapshotWorkspace.ownerConfirmed = false
            await openResearchSourceSnapshot(snapshot.id)
            researchSourceSnapshotWorkspace.message = "已保存并重读材料 #\(material.id)；请到基本面核对原始数值。"
            await loadResearchFundamentals(refreshDocuments: false)
        } catch {
            guard researchDocumentTaskIdentity == identity else { return }
            researchSourceSnapshotWorkspace.message = "材料确认或回读失败；请重读原文后再确认。"
            researchSourceSnapshotWorkspace.ownerConfirmed = false
        }
    }

    private func researchDocumentSearchCard() -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("搜索已存原文和材料")
                .font(OwnerReadingFont.headline)
            Text("输入研究问题或关键词，搜索当前公司已存 PDF、官方网页正文及富途提供方已保存材料。扫描页在本机识别（不上云），可能漏检；命中不等于已核验事实。")
                .font(OwnerReadingFont.caption)
                .foregroundStyle(.secondary)
            HStack {
                TextField("研究问题或关键词", text: Binding(
                    get: { researchDocumentWorkspace.searchQuery },
                    set: { researchDocumentWorkspace.setSearchQuery($0) }
                ))
                .textFieldStyle(.roundedBorder)
                .disabled(researchDocumentWorkspace.isBusy)
                Button(researchDocumentWorkspace.isSearching ? "搜索中" : "搜索") {
                    Task { await searchResearchDocumentText() }
                }
                .buttonStyle(.borderedProminent)
                .disabled(
                    researchDocumentWorkspace.isBusy
                        || selectedMembership == nil
                        || !(1...80).contains(
                            researchDocumentWorkspace.searchQuery
                                .trimmingCharacters(in: .whitespacesAndNewlines).count
                        )
                )
                .accessibilityIdentifier("researchDocumentSearchButton")
            }
            if let originalQuestion = researchDocumentWorkspace.originalSearchQuestion {
                Text("原问题：\(originalQuestion)")
                    .font(OwnerReadingFont.caption)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("researchDocumentOriginalQuestion")
                if researchDocumentWorkspace.searchQuery != originalQuestion {
                    Button("恢复原问题并搜索") {
                        researchDocumentWorkspace.setSearchQuery(originalQuestion, keepingOriginalQuestion: true)
                        Task { await searchResearchDocumentText() }
                    }
                    .buttonStyle(.bordered)
                    .disabled(researchDocumentWorkspace.isBusy || selectedMembership == nil)
                    .accessibilityIdentifier("researchDocumentRestoreQuestion")
                }
                if !researchDocumentWorkspace.suggestedSearchQueries.isEmpty {
                    Text("可明确选择一个财务关键词查找原文；关键词命中不代表原问题已得到回答。")
                        .font(OwnerReadingFont.caption)
                        .foregroundStyle(.secondary)
                    ForEach(researchDocumentWorkspace.suggestedSearchQueries, id: \.self) { keyword in
                        Button("用「\(keyword)」搜索原文") {
                            researchDocumentWorkspace.setSearchQuery(keyword, keepingOriginalQuestion: true)
                            Task { await searchResearchDocumentText() }
                        }
                        .buttonStyle(.bordered)
                        .disabled(researchDocumentWorkspace.isBusy || selectedMembership == nil)
                        .accessibilityIdentifier("researchDocumentSuggestedQuery-\(keyword)")
                    }
                }
            }
            Text(researchDocumentWorkspace.searchStatus)
                .font(OwnerReadingFont.caption)
                .foregroundStyle(.secondary)
                .accessibilityIdentifier("researchDocumentSearchStatus")
            if let savedOpenStatus = researchDocumentWorkspace.savedOpenStatus {
                Text(savedOpenStatus)
                    .font(OwnerReadingFont.caption)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("researchSavedSourceOpenStatus")
            }
            if let search = researchDocumentWorkspace.searchEnvelope {
                if search.results.isEmpty && researchDocumentWorkspace.savedSearchEnvelope?.results.isEmpty == true
                    && researchDocumentWorkspace.savedSearchEnvelope?.unavailableSources.isEmpty == true
                    && researchDocumentWorkspace.savedSearchEnvelope?.laneFailures.isEmpty == true {
                    Text("没有命中已存原文或材料。")
                        .font(OwnerReadingFont.caption)
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(search.results) { hit in
                        VStack(alignment: .leading, spacing: 5) {
                            Text("\(researchDocumentSearchKind(hit.kind)) · 第 \(hit.pageNumber) 页")
                                .font(OwnerReadingFont.caption.weight(.semibold))
                                .foregroundStyle(.secondary)
                            Text(hit.title)
                                .font(OwnerReadingFont.callout.weight(.semibold))
                            Text(hit.excerpt)
                                .font(OwnerReadingFont.caption)
                                .lineLimit(3)
                            Text("来源版本：\(hit.sourceVersion) · \(researchDocumentSearchEvidenceLabel(hit))")
                                .font(OwnerReadingFont.caption2)
                                .foregroundStyle(.secondary)
                            Button("打开原 PDF 同一页并重新读取") {
                                Task { await openResearchDocumentSearchHit(hit) }
                            }
                            .buttonStyle(.bordered)
                            .disabled(researchDocumentWorkspace.isBusy)
                        }
                        .padding(.vertical, 4)
                        .accessibilityElement(children: .contain)
                        .accessibilityIdentifier("researchDocumentSearchHit-\(hit.id)")
                    }
                }
            }
            if let saved = researchDocumentWorkspace.savedSearchEnvelope {
                if saved.glossaryVersion != nil {
                    Text("已匹配常见财务同义词；请以重新打开的原文为准。")
                        .font(OwnerReadingFont.caption).foregroundStyle(.secondary)
                }
                ForEach(saved.results) { hit in
                    VStack(alignment: .leading, spacing: 5) {
                        Text(hit.sourceLabel)
                            .font(OwnerReadingFont.caption.weight(.semibold))
                            .foregroundStyle(.secondary)
                        if let state = hit.reviewState {
                            Text(state == "pending_review" ? "网页原文待重新核对" : state == "historical"
                                ? "历史网页原文" : state == "unconfirmed" ? "网页原文尚未确认为材料" : "当前已存网页原文")
                                .font(OwnerReadingFont.caption2).foregroundStyle(.secondary)
                        }
                        Text(hit.title).font(OwnerReadingFont.callout.weight(.semibold))
                        Text(hit.excerpt).font(OwnerReadingFont.caption).lineLimit(3)
                        Button("重新读取对应原件") {
                            Task { await openSavedSourceSearchHit(hit) }
                        }
                        .buttonStyle(.bordered)
                        .disabled(researchDocumentWorkspace.isBusy)
                    }
                    .padding(.vertical, 4)
                    .accessibilityElement(children: .contain)
                    .accessibilityIdentifier("researchSavedSourceSearchHit-\(hit.id)")
                }
                if !saved.unavailableSources.isEmpty {
                    Text("以下已存来源未通过原件核验，本次未作为可打开命中：")
                        .font(OwnerReadingFont.caption.weight(.semibold))
                    ForEach(saved.unavailableSources) { source in
                        Text("\(source.title) · \(source.reason.title)")
                            .font(OwnerReadingFont.caption)
                            .foregroundStyle(.secondary)
                            .accessibilityIdentifier("researchSavedSourceUnavailable-\(source.id)")
                    }
                }
                ForEach(saved.laneFailures) { failure in
                    Text("\(failure.kind == "html" ? "已存网页" : "富途材料")搜索暂不可用；其他来源的结果仍可阅读。")
                        .font(OwnerReadingFont.caption).foregroundStyle(.orange)
                }
            }
        }
        .padding(12)
        .background(Color(.secondarySystemGroupedBackground))
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("researchDocumentSearchCard")
        .sheet(item: Binding(
            get: { researchDocumentWorkspace.savedOriginal },
            set: { researchDocumentWorkspace.savedOriginal = $0 }
        )) { original in
            NavigationStack {
                VStack(alignment: .leading, spacing: 12) {
                    Text(original.verification).font(OwnerReadingFont.caption).foregroundStyle(.secondary)
                    ResearchSavedOriginalTextView(text: original.body, highlightRange: original.highlightRange)
                }
                .padding()
                .navigationTitle(original.title)
                .navigationBarTitleDisplayMode(.inline)
            }
        }
    }

    /// 当前标的、membership 与授权修订的身份键；PDF 与基本面工作区共用同一次 fresh read 身份。
    var researchDocumentTaskIdentity: String {
        guard let membership = selectedMembership else {
            return "unselected:\(viewModel.authorizationRevision.uuidString)"
        }
        return "\(membership.id):\(membership.version):\(membership.symbol):\(membership.actorId):\(membership.state.rawValue):\(viewModel.authorizationRevision.uuidString)"
    }

    private func researchDocumentImportCard(showsHeader: Bool = true) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            if showsHeader {
                Text("导入本地 PDF")
                    .font(OwnerReadingFont.headline)
            }
#if OWNER_CLIENT
            Text("本地上传用于阅读和引用核对，不会自动取得 AI 使用资格。用于 AI 研究的公开财报，请从官方来源获取。")
                .font(.footnote).foregroundStyle(.secondary)
            if let membership = selectedMembership {
                NavigationLink("获取可用于研究的公开财报") {
                    ResearchSourceIntakeView(symbol: membership.symbol, researchPreparation: true)
                }.frame(minHeight: 44)
            }
#endif
            TextField("文档标题", text: Binding(
                get: { researchDocumentWorkspace.importTitle },
                set: {
                    if $0 != researchDocumentWorkspace.importTitle {
                        researchDocumentWorkspace.clearPendingImport()
                    }
                    researchDocumentWorkspace.importTitle = $0
                }
            ))
            .textFieldStyle(.roundedBorder)
            .disabled(researchDocumentWorkspace.isBusy)
            TextField("来源版本（例如 2026 年报）", text: Binding(
                get: { researchDocumentWorkspace.importSourceVersion },
                set: {
                    if $0 != researchDocumentWorkspace.importSourceVersion {
                        researchDocumentWorkspace.clearPendingImport()
                    }
                    researchDocumentWorkspace.importSourceVersion = $0
                }
            ))
            .textFieldStyle(.roundedBorder)
            .disabled(researchDocumentWorkspace.isBusy)
            DatePicker(
                "发布日期",
                selection: Binding(
                    get: { researchDocumentWorkspace.importPublishedAt },
                    set: {
                        if $0 != researchDocumentWorkspace.importPublishedAt {
                            researchDocumentWorkspace.clearPendingImport()
                        }
                        researchDocumentWorkspace.importPublishedAt = $0
                    }
                ),
                displayedComponents: [.date]
            )
            .disabled(researchDocumentWorkspace.isBusy)
            Button {
                researchDocumentWorkspace.isImporterPresented = true
            } label: {
                Label(researchDocumentWorkspace.isImporting ? "读取中" : "选择 PDF", systemImage: "doc.badge.plus")
            }
            .buttonStyle(.borderedProminent)
            .disabled(
                researchDocumentWorkspace.isBusy
                    || selectedMembership == nil
                    || researchDocumentWorkspace.importTitle.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                    || researchDocumentWorkspace.importSourceVersion.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            )
            .accessibilityIdentifier("researchDocumentImportButton")
            if let pending = researchDocumentWorkspace.pendingImport {
                Text("待确认文件：\(pending.filename)\nSHA-256：\(pending.pdfSha256)")
                    .font(OwnerReadingFont.caption.monospaced())
                    .textSelection(.enabled)
                Toggle("我确认有权在本地处理上述精确 PDF 文件", isOn: Binding(
                    get: { researchDocumentWorkspace.rightsConfirmed },
                    set: { researchDocumentWorkspace.rightsConfirmed = $0 }
                ))
                .disabled(researchDocumentWorkspace.isBusy)
                Button("确认权利并上传") {
                    Task { await uploadPendingResearchDocument() }
                }
                .buttonStyle(.borderedProminent)
                .disabled(researchDocumentWorkspace.isBusy || !researchDocumentWorkspace.rightsConfirmed)
                .accessibilityIdentifier("researchDocumentUploadButton")
            }
        }
        .padding(12)
        .background(Color(.secondarySystemGroupedBackground))
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    private func researchDocumentList(_ list: ResearchDocumentListEnvelope) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("当前材料")
                    .font(OwnerReadingFont.headline)
                Spacer()
                Button {
                    Task { await loadResearchDocuments() }
                } label: {
                    Image(systemName: "arrow.clockwise")
                }
                .disabled(researchDocumentWorkspace.isBusy)
            }

            if list.documents.isEmpty {
                Text("尚未导入 PDF。")
                    .foregroundStyle(.secondary)
            } else {
                Picker("PDF", selection: Binding(
                    get: { researchDocumentWorkspace.selectedDocumentId ?? list.documents[0].id },
                    set: {
                        researchDocumentWorkspace.selectedDocumentId = $0
                        researchDocumentWorkspace.selectedPage = nil
                        researchDocumentWorkspace.confirmation = nil
                        researchDocumentWorkspace.clearOcrNoteDraft()
                        researchDocumentWorkspace.quote = ""
                        researchDocumentWorkspace.statement = ""
                    }
                )) {
                    ForEach(list.documents) { document in
                        Text("\(document.title)\(documentSourceSuffix(document))").tag(document.id)
                    }
                }
                .pickerStyle(.menu)
                .disabled(researchDocumentWorkspace.isBusy)

                if let document = selectedResearchDocument {
                    documentProvenance(document)
                    ForEach(list.materials.filter { $0.citation?.documentId == document.id }) { material in
                        if let citation = material.citation {
                            persistedResearchMaterialCard(document: document, material: material, citation: citation)
                        }
                    }
                    HStack {
                        TextField("页码", text: Binding(
                            get: { researchDocumentWorkspace.pageNumberText },
                            set: {
                                researchDocumentWorkspace.pageNumberText = $0
                                researchDocumentWorkspace.selectedPage = nil
                                researchDocumentWorkspace.confirmation = nil
                                researchDocumentWorkspace.clearOcrNoteDraft()
                            }
                        ))
                        .keyboardType(.numberPad)
                        .textFieldStyle(.roundedBorder)
                        .disabled(researchDocumentWorkspace.isBusy || !document.isSourceAvailable)
                        Button("读取原文") {
                            Task { await loadSelectedResearchDocumentPage() }
                        }
                        .disabled(researchDocumentWorkspace.isBusy || !document.isSourceAvailable)
                    }
                    if let page = researchDocumentWorkspace.selectedPage {
                        researchDocumentConfirmCard(document: document, page: page)
                        if page.textSource == "ocr" {
                            researchDocumentOcrCorrectionCard(document: document, page: page)
                        }
                    }
                    if let confirmation = researchDocumentWorkspace.confirmation {
                        researchDocumentConfirmationCard(confirmation)
                    }
                    if let note = researchDocumentWorkspace.ocrNoteConfirmation {
                        researchDocumentOcrNoteConfirmationCard(note)
                    }
                }
            }
            if let deletions = list.materialDeletions, !deletions.isEmpty {
                DisclosureGroup("已删除材料凭证 \(deletions.count) 条") {
                    ForEach(deletions, id: \.materialId) { deletion in
                        VStack(alignment: .leading, spacing: 3) {
                            Text("material #\(deletion.materialId) · evidence #\(deletion.evidenceId) · membership v\(deletion.membershipVersion)")
                                .font(OwnerReadingFont.caption.weight(.semibold))
                            Text("删除于 \(deletion.deletedAt) · SHA-256 \(deletion.contentFingerprint)")
                                .font(OwnerReadingFont.caption2.monospaced())
                                .textSelection(.enabled)
                        }
                        .accessibilityElement(children: .combine)
                        .accessibilityIdentifier("researchMaterialDeletion-\(deletion.materialId)")
                    }
                    Text("正文已从当前材料、全文搜索和 AI 上下文移除；原 PDF 与此前外部备份仍可能保留旧内容。")
                        .font(OwnerReadingFont.caption)
                        .foregroundStyle(.secondary)
                }
                .accessibilityIdentifier("researchMaterialDeletionHistory")
            }
        }
        .padding(12)
        .background(Color(.secondarySystemGroupedBackground))
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    private func documentProvenance(_ document: ResearchDocumentData) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("来源状态：\(documentSourceLabel(document)) · 由你提供 · 使用权已确认")
                .font(OwnerReadingFont.subheadline.bold())
            if !document.isSourceAvailable {
                Text("数据库中的资料身份与既有引用仍保留，但原 PDF 不能读取、确认或用于新的档案事实。")
                    .font(OwnerReadingFont.caption)
                    .foregroundStyle(.orange)
                    .accessibilityIdentifier("researchDocumentSourceUnavailable")
            }
            Text("文件校验码：\(document.pdfSha256)")
                .font(OwnerReadingFont.caption.monospaced())
                .textSelection(.enabled)
            Text("\(document.pageCount) 页 · 导入时研究成员版本 \(document.membershipVersionAtImport)")
                .font(OwnerReadingFont.caption)
                .foregroundStyle(.secondary)
            if !document.ocrPageNumbers.isEmpty {
                Text("第 \(document.ocrPageNumbers.map(String.init).joined(separator: "、")) 页为本机 OCR 文本，待人工对照原页核验。")
                    .font(OwnerReadingFont.caption)
                    .foregroundStyle(.orange)
            } else if document.ocr?.status == "unavailable" {
                Text("本机 OCR 未成功：扫描页仍无文本，全文搜索可能漏掉这些页；请对照原始 PDF 页。")
                    .font(OwnerReadingFont.caption)
                    .foregroundStyle(.orange)
            }
        }
    }

    private func researchDocumentConfirmCard(
        document: ResearchDocumentData,
        page: ResearchDocumentPageData
    ) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("第 \(page.pageNumber) 页规范化原文")
                .font(OwnerReadingFont.headline)
            Text(page.normalizedText.isEmpty ? "此页无可用文本，不能引用。" : page.normalizedText)
                .font(OwnerReadingFont.callout)
                .textSelection(.enabled)
            if page.textSource == "ocr" {
                Label("此页文本来自本机识别文字（不上云），待人工对照原页核验；引用前请查看原始 PDF 页。", systemImage: "exclamationmark.triangle")
                    .font(OwnerReadingFont.caption.weight(.semibold))
                    .foregroundStyle(.orange)
            }
            Text("页文本 SHA-256：\(page.pageTextSha256)")
                .font(OwnerReadingFont.caption.monospaced())
                .textSelection(.enabled)
            if let replacedId = researchDocumentWorkspace.replacementMaterial?.id {
                Label("将创建当前材料 #\(replacedId) 的替代版本；请选择同类 PDF 的新版本或新页。", systemImage: "arrow.triangle.2.circlepath")
                    .font(OwnerReadingFont.caption.weight(.semibold))
                    .foregroundStyle(.orange)
                Button("取消替代") {
                    researchDocumentWorkspace.replacementMaterial = nil
                    researchDocumentWorkspace.confirmReservation.clear()
                }
                .buttonStyle(.bordered)
            }
            TextField("粘贴目标页原文（必须恰好出现一次）", text: Binding(
                get: { researchDocumentWorkspace.quote },
                set: { researchDocumentWorkspace.quote = $0; researchDocumentWorkspace.confirmation = nil }
            ), axis: .vertical)
            .textFieldStyle(.roundedBorder)
            .disabled(researchDocumentWorkspace.isBusy)
            TextField("输入一条事实陈述", text: Binding(
                get: { researchDocumentWorkspace.statement },
                set: { researchDocumentWorkspace.statement = $0; researchDocumentWorkspace.confirmation = nil }
            ), axis: .vertical)
            .textFieldStyle(.roundedBorder)
            .disabled(researchDocumentWorkspace.isBusy)
            DatePicker(
                "事实有效至",
                selection: Binding(
                    get: { researchDocumentWorkspace.validUntil },
                    set: { researchDocumentWorkspace.validUntil = $0; researchDocumentWorkspace.confirmation = nil }
                ),
                displayedComponents: [.date]
            )
            .disabled(researchDocumentWorkspace.isBusy)
            Button {
                Task { await confirmSelectedResearchDocumentFact(document: document, page: page) }
            } label: {
                Label(
                    researchDocumentWorkspace.isConfirming
                        ? "确认并回读中"
                        : researchDocumentWorkspace.replacementMaterial == nil
                            ? "明确确认原文与事实"
                            : "明确保存替代证据",
                    systemImage: "checkmark.seal"
                )
            }
            .buttonStyle(.borderedProminent)
            .disabled(
                researchDocumentWorkspace.isBusy
                    || !document.isSourceAvailable
                    || page.normalizedText.isEmpty
                    || researchDocumentWorkspace.quote.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                    || researchDocumentWorkspace.statement.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            )
            .accessibilityIdentifier("researchDocumentConfirmButton")
            Text("确认语义固定为 issuer_statement / unverified / user_provided：原文已核对，事实未独立验证。")
                .font(OwnerReadingFont.caption)
                .foregroundStyle(.secondary)
        }
        .padding(.top, 8)
    }

    private func researchDocumentOcrCorrectionCard(
        document: ResearchDocumentData,
        page: ResearchDocumentPageData
    ) -> some View {
        DisclosureGroup("添加 OCR 人工校对备注", isExpanded: Binding(
            get: { researchDocumentWorkspace.showOcrNoteEditor },
            set: { researchDocumentWorkspace.showOcrNoteEditor = $0 }
        )) {
            VStack(alignment: .leading, spacing: 9) {
                Text("请先对照原始 PDF。备注保留 OCR 原文和你的校对建议，仍待核验，不会改写原 PDF 或变成发行人原句。")
                    .font(OwnerReadingFont.caption).foregroundStyle(.secondary)
                Button("打开原始 PDF 第 \(page.pageNumber) 页") {
                    Task { await openSelectedResearchDocumentPDF(document: document, page: page) }
                }
                .buttonStyle(.bordered)
                .disabled(researchDocumentWorkspace.isBusy || !document.isSourceAvailable)
                if let replacement = researchDocumentWorkspace.replacementOcrNote {
                    Text("正在修订备注 #\(replacement.id)，旧版将保留。")
                        .font(OwnerReadingFont.caption.weight(.semibold)).foregroundStyle(.orange)
                    Button("取消修订") {
                        researchDocumentWorkspace.replacementOcrNote = nil
                        researchDocumentWorkspace.ocrNoteReservation.clear()
                    }
                    .buttonStyle(.bordered)
                }
                TextField("OCR 显示的错误片段（须出现在本页）", text: Binding(
                    get: { researchDocumentWorkspace.ocrExcerpt },
                    set: { researchDocumentWorkspace.ocrExcerpt = $0; researchDocumentWorkspace.ocrNoteConfirmation = nil }
                ), axis: .vertical)
                .textFieldStyle(.roundedBorder)
                .disabled(researchDocumentWorkspace.isBusy)
                TextField("你建议的正确文字", text: Binding(
                    get: { researchDocumentWorkspace.correctedOcrText },
                    set: { researchDocumentWorkspace.correctedOcrText = $0; researchDocumentWorkspace.ocrNoteConfirmation = nil }
                ), axis: .vertical)
                .textFieldStyle(.roundedBorder)
                .disabled(researchDocumentWorkspace.isBusy)
                TextField("校对说明（可选）", text: Binding(
                    get: { researchDocumentWorkspace.ocrNoteExplanation },
                    set: { researchDocumentWorkspace.ocrNoteExplanation = $0; researchDocumentWorkspace.ocrNoteConfirmation = nil }
                ), axis: .vertical)
                .textFieldStyle(.roundedBorder)
                .disabled(researchDocumentWorkspace.isBusy)
                DatePicker("备注有效至", selection: Binding(
                    get: { researchDocumentWorkspace.ocrNoteValidUntil },
                    set: { researchDocumentWorkspace.ocrNoteValidUntil = $0; researchDocumentWorkspace.ocrNoteConfirmation = nil }
                ), displayedComponents: [.date])
                .disabled(researchDocumentWorkspace.isBusy)
                Button {
                    Task { await saveSelectedResearchDocumentOcrCorrectionNote(document: document, page: page) }
                } label: {
                    Label(researchDocumentWorkspace.isSavingOcrNote ? "保存并核对中" : "保存未核验校对备注",
                          systemImage: "square.and.pencil")
                }
                .buttonStyle(.borderedProminent)
                .disabled(researchDocumentWorkspace.isBusy || !document.isSourceAvailable
                    || researchDocumentWorkspace.ocrExcerpt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                    || researchDocumentWorkspace.correctedOcrText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                .accessibilityIdentifier("researchDocumentOcrCorrectionSave")
            }
            .padding(.top, 6)
        }
        .padding(.top, 8)
    }

    private func researchDocumentOcrNoteConfirmationCard(_ note: ResearchDocumentOcrCorrectionReadBack) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("人工 OCR 校对备注 · 未核验")
                .font(OwnerReadingFont.subheadline.bold()).foregroundStyle(.orange)
            Text(note.material.contentText).textSelection(.enabled)
            Button("重新打开原始 PDF 第 \(note.page.pageNumber) 页") {
                Task { await openPersistedResearchDocumentCitation(document: note.document, material: note.material) }
            }
            .buttonStyle(.bordered)
        }
        .padding(10)
        .background(Color.orange.opacity(0.08))
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
    }

    private func researchDocumentConfirmationCard(_ confirmation: ResearchDocumentConfirmationReadBack) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("原文已核对 / 事实未独立验证")
                .font(OwnerReadingFont.headline)
                .foregroundStyle(.orange)
                .accessibilityIdentifier("researchDocumentConfirmationStatus")
            Text("第 \(confirmation.page.pageNumber) 页已确认原文")
                .font(OwnerReadingFont.subheadline.bold())
            Text(confirmation.material.contentText)
                .textSelection(.enabled)
            Text("事实：\(confirmation.material.summary)")
                .font(OwnerReadingFont.body.bold())
                .textSelection(.enabled)
            Button {
                Task { await openConfirmedResearchDocumentPDF(confirmation) }
            } label: {
                Label("打开同一 PDF 的第 \(confirmation.page.pageNumber) 页", systemImage: "doc.text.magnifyingglass")
            }
            .buttonStyle(.bordered)
            .disabled(researchDocumentWorkspace.isBusy || !confirmation.document.isSourceAvailable)
            .accessibilityIdentifier("researchDocumentOpenPDFButton")
        }
        .padding(12)
        .background(Color.orange.opacity(0.1))
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    private func persistedResearchMaterialCard(
        document: ResearchDocumentData,
        material: ResearchMaterialData,
        citation: ResearchMaterialCitation
    ) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            let ocrNote = material.sourceType == "owner_ocr_correction_note"
            Text(ocrNote ? "人工 OCR 校对备注 · 未核验" : "原文已核对 / 事实未独立验证")
                .font(OwnerReadingFont.subheadline.bold())
                .foregroundStyle(.orange)
            if !ocrNote {
                Text("事实：\(material.summary)")
                    .font(OwnerReadingFont.body.bold())
                    .textSelection(.enabled)
            }
            Text(ocrNote ? "第 \(citation.pageNumber) 页校对建议：\(material.contentText)"
                         : "第 \(citation.pageNumber) 页原文：\(material.contentText)")
                .font(OwnerReadingFont.callout)
                .textSelection(.enabled)
            Text("修订 \(material.revision) · \(material.revisionState == "current" ? "当前版本" : "已被替代")")
                .font(OwnerReadingFont.caption)
                .foregroundStyle(.secondary)
            Button {
                Task { await openPersistedResearchDocumentCitation(document: document, material: material) }
            } label: {
                Label("重新核对并打开原始 PDF 页", systemImage: "doc.text.magnifyingglass")
            }
            .buttonStyle(.bordered)
            .disabled(researchDocumentWorkspace.isBusy || !document.isSourceAvailable)
            if ocrNote && material.revisionState == "current" {
                Button("修订这条校对备注") {
                    Task { await prepareResearchDocumentOcrNoteRevision(document: document, material: material) }
                }
                .buttonStyle(.bordered)
                .disabled(researchDocumentWorkspace.isBusy || !document.isSourceAvailable)
            }
            Button(role: .destructive) {
                Task { await deletePersistedResearchMaterial(material) }
            } label: {
                Label(
                    researchDocumentWorkspace.pendingDeletionMaterialId == material.id
                        ? "再次点击确认删除正文"
                        : "删除这条材料正文",
                    systemImage: "trash"
                )
            }
            .buttonStyle(.bordered)
            .disabled(researchDocumentWorkspace.isBusy)
            .accessibilityIdentifier("researchMaterialDelete-\(material.id)")
        }
        .padding(10)
        .background(Color.orange.opacity(0.08))
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
    }

    var selectedResearchDocument: ResearchDocumentData? {
        guard let list = researchDocumentWorkspace.list else { return nil }
        let id = researchDocumentWorkspace.selectedDocumentId ?? list.documents.first?.id
        return list.documents.first(where: { $0.id == id })
    }

    private func documentSourceLabel(_ document: ResearchDocumentData) -> String {
        switch document.sourceState {
        case "available": "可用"
        case "missing": "原文件缺失"
        case "corrupt": "文件校验失败"
        default: "不可用"
        }
    }

    private func documentSourceSuffix(_ document: ResearchDocumentData) -> String {
        document.isSourceAvailable ? "" : "（\(documentSourceLabel(document))）"
    }
}

private func researchDocumentSearchKind(_ kind: ResearchDocumentSearchHitKind) -> String {
    switch kind {
    case .document: "文档"
    case .page: "文本页"
    case .material: "引用材料"
    }
}

private func researchDocumentSearchEvidenceLabel(_ hit: ResearchDocumentSearchHit) -> String {
    if hit.evidenceStatus == "owner_ocr_correction_note_unverified" {
        return "用户人工 OCR 校对备注，未核验；不是原 PDF 文字"
    }
    return hit.evidenceStatus == "ocr_text_pending_manual_verification"
        ? "本机 OCR 页，待人工对照原页核验" : "可搜索文本层"
}
