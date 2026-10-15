import SwiftUI

struct AntigravityEvidenceDetailSheet: View {
    @ObservedObject var api = OwnerClientStore.shared
    @Environment(\.antigravityActions) private var actions
    public let dossier: InvestmentDecisionDossier
    @State private var page: ResearchDocumentPageData?
    @State private var readMessage = ""
    let initialFactId: String?
    private var fact: EvidenceFactItem? {
        let facts = api.templateEvidenceFacts(symbol: dossier.symbol)
        return initialFactId.flatMap { id in facts.first { $0.id == id } } ?? (initialFactId == nil ? facts.first : nil)
    }
    private var document: ResearchDocumentData? {
        guard let documents = api.boundTemplateDocuments(symbol: dossier.symbol) else { return nil }
        if let fact { return documents.documents.first { $0.id == fact.documentId && $0.pdfSha256 == fact.sha256 } }
        return initialFactId == nil ? documents.documents.first : nil
    }
    @Environment(\.dismiss) private var dismiss
    
    init(dossier: InvestmentDecisionDossier, initialFactId: String? = nil) {
        self.initialFactId = initialFactId
        self.dossier = dossier
    }
    
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    // Document Meta Header
                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            Text(fact?.sourceType ?? "原文资料")
                                .font(.system(size: 11, weight: .bold))
                                .foregroundColor(Theme.blue)
                                .padding(.horizontal, 6)
                                .padding(.vertical, 3)
                                .background(Theme.blue.opacity(0.12))
                                .clipShape(RoundedRectangle(cornerRadius: 4))
                            Spacer()
                            Text("发布时间: \(fact?.publishDate ?? document?.publishedAt ?? "未读取")")
                                .font(.system(size: 11))
                                .foregroundColor(Theme.textTertiary)
                        }
                        
                        Text(fact?.sourceTitle ?? document?.title ?? "尚未关联可展示的原文引用")
                            .font(.system(size: 17, weight: .bold))
                            .foregroundColor(Theme.textPrimary)
                        
                        Text("文件指纹: \(fact?.sha256 ?? document?.pdfSha256 ?? "未返回")")
                            .font(.system(size: 11, design: .monospaced))
                            .foregroundColor(Theme.textTertiary)
                            .lineLimit(1)
                    }
                    .padding(14)
                    .templateCardStyle(elevated: true)
                    
                    // Page 3 Segment: Brand Deliveries
                    VStack(alignment: .leading, spacing: 10) {
                        HStack {
                            Image(systemName: "doc.text.viewfinder")
                                .foregroundColor(Theme.gold)
                            Text("PDF 原文第 \(fact.map { String($0.pageNumber) } ?? page.map { String($0.pageNumber) } ?? "—") 页")
                                .font(.system(size: 13, weight: .bold))
                                .foregroundColor(Theme.textPrimary)
                            Spacer()
                            Text("原页核对")
                                .font(.system(size: 10, design: .monospaced))
                                .foregroundColor(Theme.textTertiary)
                        }
                        
                        Divider().background(Theme.border)
                        
                        VStack(alignment: .leading, spacing: 8) {
                            Text("【原文摘录】")
                                .font(.system(size: 11, weight: .semibold))
                                .foregroundColor(Theme.textTertiary)
                            
                            Text(page?.normalizedText ?? (readMessage.isEmpty ? "正在读取并核对引用原页…" : readMessage))
                                .font(.system(size: 12.5))
                                .foregroundColor(Theme.textPrimary)
                                .lineSpacing(3)
                                .padding(10)
                                .background(Theme.bgSecondary)
                                .clipShape(RoundedRectangle(cornerRadius: 6))
                        }
                        
                        // Extracted Confirmed Facts
                        VStack(alignment: .leading, spacing: 6) {
                            Text("【原文与引用核对】")
                                .font(.system(size: 11, weight: .semibold))
                                .foregroundColor(Theme.green)
                            
                            Button("打开已导入 PDF 与引用") { dismiss(); actions.workflow(.materials) }
                                .font(.system(size: 12, weight: .semibold)).foregroundColor(Theme.blue)
                        }
                        .padding(.top, 4)
                    }
                    .padding(14)
                    .templateCardStyle()
                    
                    // Audit Verification Badge
                    HStack(spacing: 8) {
                        Image(systemName: "checkmark.shield.fill")
                            .foregroundColor(Theme.green)
                            .font(.system(size: 16))
                        VStack(alignment: .leading, spacing: 2) {
                            Text(fact?.verifiedState ?? "尚未核对原页")
                                .font(.system(size: 12, weight: .bold))
                                .foregroundColor(Theme.textPrimary)
                            Text("打开已导入文档，核对原页与引用；读取成功不等于事实已独立验证。")
                                .font(.system(size: 11))
                                .foregroundColor(Theme.textTertiary)
                        }
                    }
                    .padding(12)
                    .templateCardStyle()
                }
                .padding(16)
            }
            .background(Theme.bgPrimary.ignoresSafeArea())
            .task(id: "\(dossier.symbol)|\(initialFactId ?? "first")") {
                page = nil; readMessage = ""
                let boundFact = fact
                guard let document, let membership = api.membershipEnvelope?.memberships.first(where: { $0.symbol == dossier.symbol }) else { readMessage = "没有精确绑定的文档引用，请在资料页核对。"; return }
                let context = AppEnvironment.researchAuthorizationContext()
                do {
                    let value = try await ResearchClient(baseURL: context.baseURL, authToken: context.readToken, authHeaderName: context.readHeaderName)
                        .fetchResearchDocumentPage(membership: membership, documentId: document.id, pageNumber: boundFact?.pageNumber ?? 1)
                    guard AppEnvironment.researchAuthorizationContext() == context, api.currentSymbol == dossier.symbol,
                          api.membershipEnvelope?.memberships.first(where: { $0.id == membership.id })?.version == membership.version else { return }
                    guard boundFact?.id == fact?.id, document.id == self.document?.id,
                          boundFact == nil || value.pageTextSha256 == boundFact?.pageTextSha256 else {
                        readMessage = "原文页或引用版本已变化，请重新核对资料。"; return
                    }
                    page = value
                } catch { readMessage = "原文页读取失败，请在资料页面核对来源后重试。" }
            }
            .navigationTitle("证据原文核验")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("完成") { dismiss() }
                        .foregroundColor(Theme.blue)
                }
            }
        }
    }
    
    private func factItem(label: String, val: String, change: String) -> some View {
        HStack {
            Text("• \(label):")
                .font(.system(size: 12))
                .foregroundColor(Theme.textSecondary)
            Text(val)
                .font(.system(size: 12, weight: .bold, design: .monospaced))
                .foregroundColor(Theme.textPrimary)
            Spacer()
            Text(change)
                .font(.system(size: 11, weight: .semibold, design: .monospaced))
                .foregroundColor(Theme.green)
        }
        .padding(.vertical, 2)
    }
}
