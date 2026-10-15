import SwiftUI

struct GateAMarketDiscoverySection: View {
    let refreshRevision: UInt64
    @Binding var symbolInput: String
    @Binding var membershipWriteMessage: String?
    @Binding var pendingAnnouncement: OfficialAnnouncementDiscoveryItem?
    @Binding var pendingNoticeLead: NoticeLeadResearchHandoff?
    @Binding var discoveryGeneration: UUID
    let reloadCandidateOverview: @MainActor () async -> Bool
    let refreshMarketResearchAdmission: @MainActor () async -> MarketResearchAdmissionToken?
    let marketResearchAdmissionIsCurrent: @MainActor (MarketResearchAdmissionToken) -> Bool
    let discoveryContinuationIsCurrent: @MainActor (MarketDiscoveryContinuationToken?) -> Bool
    let openResearchCandidate: (TodayCandidateNavigationTarget) -> Void
    let openImportedAnnouncement: (TodayCandidateNavigationTarget, OfficialAnnouncementDiscoveryItem) -> Void
    let openAssistedDecision: (String) -> Void
    let openQualifiedCandidate: @MainActor (MarketDiscoveryQualificationEnvelope, MarketDiscoveryContinuationToken) async -> Void
    @State private var importingId: String?
    @State private var importReservation = ResearchDocumentIdempotencyReservation()

    var body: some View {
        VStack(spacing: 16) {
            if let pendingAnnouncement {
                pendingAnnouncementCard(pendingAnnouncement)
            }
            MarketDiscoveryCard(
                refreshRevision: refreshRevision,
                noticeSymbol: SecuritySymbol.parseHongKongAlias(symbolInput)?.canonical ?? "HK.00175",
                onSelectCandidate: { symbol in
                    symbolInput = symbol
                    membershipWriteMessage = "已选择真实行情候选；请查看行情后再决定是否加入研究。"
                },
                onImportAnnouncement: importOfficialAnnouncement,
                onVerifyNoticeLead: { handoff in
                    symbolInput = handoff.item.symbol
                    openAssistedDecision(handoff.item.symbol)
                    pendingNoticeLead = handoff
                },
                onOpenQualifiedCandidate: openQualifiedCandidate,
                onDiscoveryGenerationChanged: { discoveryGeneration = $0 },
                excludedAnnouncementId: pendingAnnouncement?.id
            )
        }
    }

    @ViewBuilder
    private func pendingAnnouncementCard(_ item: OfficialAnnouncementDiscoveryItem) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("待继续的官方公告")
                .font(.headline)
            Text("\(item.publishedDate) · \(item.title)")
                .font(.callout.weight(.semibold))
            Text("已保留公告身份 \(item.id.prefix(12))…；导入前会重新读取官网发现结果并要求你再次明确确认。")
                .font(.caption)
                .foregroundStyle(.secondary)
            HStack {
                if let url = item.url {
                    Link("打开官方 PDF", destination: url)
                        .buttonStyle(.bordered)
                }
                Button("确认并继续导入") {
                    Task { await importOfficialAnnouncement(item, continuation: nil) }
                }
                .buttonStyle(.borderedProminent)
                .disabled(importingId != nil)
                Button("取消") {
                    pendingAnnouncement = nil
                }
                .buttonStyle(.bordered)
                .disabled(importingId != nil)
            }
        }
        .padding(12)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 8))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("pendingMarketAnnouncement")
    }

    @MainActor
    private func importOfficialAnnouncement(
        _ item: OfficialAnnouncementDiscoveryItem,
        continuation initialContinuation: MarketDiscoveryContinuationToken?
    ) async {
        guard importingId == nil else { return }
        guard item.symbol.range(of: "^HK\\.\\d{5}$", options: .regularExpression) != nil,
              let url = item.url,
              url.host == "www1.hkexnews.hk" else {
            membershipWriteMessage = "公告身份无效，未导入。"
            return
        }
        let context = AppEnvironment.researchAuthorizationContext()
        let expectedGeneration = initialContinuation?.generation ?? discoveryGeneration
        guard initialContinuation.map({
            $0.authorizationContext == context
                && $0.identityFingerprint == item.id
                && discoveryContinuationIsCurrent($0)
        }) ?? true else {
            membershipWriteMessage = "今日发现已变化；旧公告入口已失效，请重新读取。"
            return
        }
        pendingAnnouncement = item
        guard SecuritySymbol.parseHongKongAlias(symbolInput)?.canonical == item.symbol else {
            symbolInput = item.symbol
            membershipWriteMessage = "已切换到 \(item.symbol)；请先核对市场事实，再次确认同一公告导入。"
            return
        }
        importingId = item.id
        membershipWriteMessage = "正在重新核对公告身份与研究成员；不会自动导入或生成结论。"
        defer {
            importingId = nil
            if AppEnvironment.researchAuthorizationContext() != context,
               pendingAnnouncement == item {
                pendingAnnouncement = nil
                membershipWriteMessage = "连接已变化；旧公告入口已清除，请重新读取后继续。"
            }
        }
        do {
            let discovery = try await MarketQuoteClient(
                baseURL: context.baseURL,
                authToken: context.readToken,
                authHeaderName: context.readHeaderName
            ).fetchDailyDiscovery(noticeSymbol: item.symbol)
            guard AppEnvironment.researchAuthorizationContext() == context,
                  discoveryGeneration == expectedGeneration,
                  pendingAnnouncement == item else { return }
            guard discovery.announcements.status == .available,
                  let fetchedAt = discovery.announcements.fetchedAt,
                  discovery.announcements.items.contains(item) else {
                pendingAnnouncement = nil
                membershipWriteMessage = "官网发现结果已变化；旧公告身份已清除，请刷新后重新选择。"
                return
            }
            if let initialContinuation,
               fetchedAt != initialContinuation.laneFetchedAt {
                membershipWriteMessage = "官网发现结果已更新；公告身份已保留，请再次确认后继续导入。"
                return
            }
            let continuation = initialContinuation ?? MarketDiscoveryContinuationToken(
                generation: expectedGeneration,
                authorizationContext: context,
                laneFetchedAt: fetchedAt,
                identityFingerprint: item.id
            )
            guard discoveryContinuationIsCurrent(continuation) else { return }
            let client = ResearchClient(
                baseURL: context.baseURL,
                authToken: context.readToken,
                authHeaderName: context.readHeaderName,
                writeAuthToken: context.writeToken,
                writeAuthHeaderName: context.writeHeaderName
            )
            let freshMemberships = await client.fetchCandidateMemberships(includeArchived: false)
            guard AppEnvironment.researchAuthorizationContext() == context,
                  pendingAnnouncement == item else { return }
            guard freshMemberships.status != .unavailable else {
                membershipWriteMessage = "研究成员来源暂不可用；公告身份已保留，请恢复连接后重试。"
                return
            }
            let activeMemberships = freshMemberships.memberships.filter {
                $0.symbol == item.symbol && $0.state != .archived
            }
            guard !activeMemberships.isEmpty else {
                guard let admission = await refreshMarketResearchAdmission(),
                      marketResearchAdmissionIsCurrent(admission),
                      admission.symbol == item.symbol,
                      AppEnvironment.researchAuthorizationContext() == context,
                      discoveryContinuationIsCurrent(continuation),
                      pendingAnnouncement == item else { return }
                membershipWriteMessage = "先进入研究加入或恢复 \(item.symbol)；完成后会返回同一公告，再由你明确确认导入。"
                openAssistedDecision(item.symbol)
                return
            }
            guard activeMemberships.count == 1, let membership = activeMemberships.first else {
                membershipWriteMessage = "研究成员身份冲突；未向可能错绑的成员导入公告。"
                return
            }
            membershipWriteMessage = "正在从 HKEXnews 下载并导入同一官方 PDF；不会自动生成结论或正式决定。"
            var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 20)
            request.setValue("application/pdf", forHTTPHeaderField: "accept")
            let (bytes, response) = try await URLSession.shared.data(for: request)
            guard AppEnvironment.researchAuthorizationContext() == context,
                  discoveryContinuationIsCurrent(continuation),
                  pendingAnnouncement == item,
                  let http = response as? HTTPURLResponse,
                  http.statusCode == 200,
                  http.url == url,
                  http.mimeType?.lowercased() == "application/pdf",
                  bytes.count <= ResearchDocumentClientLimits.maxPDFBytes,
                  bytes.prefix(1_024).range(of: Data("%PDF-".utf8)) != nil else {
                throw ResearchDocumentClientError.invalidResponse
            }
            let filename = url.lastPathComponent
            let publishedAt = "\(item.publishedDate)T00:00:00+08:00"
            let sourceVersion = "hkexnews-official:publication-date-only:\(item.publishedDate):\(item.id)"
            let semantic = researchDocumentImportSemantic(
                membership: membership,
                title: item.title,
                publishedAt: publishedAt,
                sourceVersion: sourceVersion,
                rightsConfirmed: true,
                filename: filename,
                pdfSha256: researchDocumentSha256(bytes)
            )
            guard discoveryContinuationIsCurrent(continuation) else { return }
            _ = try await client.importResearchDocument(
                membership: membership,
                metadata: ImportResearchDocumentMetadata(
                    membershipVersion: membership.version,
                    title: item.title,
                    publishedAt: publishedAt,
                    sourceVersion: sourceVersion,
                    rightsConfirmed: true,
                    idempotencyKey: importReservation.reserve(for: semantic, prefix: "ios-market-pdf-import")
                ),
                filename: filename,
                pdfBytes: bytes
            )
            guard AppEnvironment.researchAuthorizationContext() == context,
                  discoveryContinuationIsCurrent(continuation),
                  pendingAnnouncement == item else { return }
            let readBackMemberships = await client.fetchCandidateMemberships(includeArchived: false)
            guard AppEnvironment.researchAuthorizationContext() == context,
                  discoveryContinuationIsCurrent(continuation),
                  pendingAnnouncement == item else { return }
            guard await reloadCandidateOverview() else { return }
            guard AppEnvironment.researchAuthorizationContext() == context,
                  discoveryContinuationIsCurrent(continuation),
                  pendingAnnouncement == item else { return }
            guard let target = candidateResearchNavigationTarget(for: item.symbol, in: readBackMemberships) else {
                membershipWriteMessage = "官方 PDF 已导入，但研究成员 fresh read 未通过；没有打开可能错绑的研究。"
                return
            }
            guard let admission = await refreshMarketResearchAdmission(),
                  marketResearchAdmissionIsCurrent(admission),
                  admission.symbol == item.symbol,
                  AppEnvironment.researchAuthorizationContext() == context,
                  discoveryContinuationIsCurrent(continuation),
                  pendingAnnouncement == item else { return }
            pendingAnnouncement = nil
            membershipWriteMessage = "官方 PDF 已进入本地 raw-store 与研究资料；发布日期为日精度，日期起点仅作存储锚点，仍需人工确认事实。"
            openImportedAnnouncement(target, item)
        } catch {
            guard AppEnvironment.researchAuthorizationContext() == context else { return }
            membershipWriteMessage = "官方 PDF 下载、导入或 fresh read 失败；没有打开未核实资料。"
        }
    }
}
