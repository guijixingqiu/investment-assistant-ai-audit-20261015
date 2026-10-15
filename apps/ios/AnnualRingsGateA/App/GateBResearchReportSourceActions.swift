import Foundation

extension GateBResearchScreen {
    @MainActor
    func openSelectedContextPeerOriginal(report: TwoLayerReportData,
        fact: TwoLayerReportFact, citation: ResearchPeerMaterialCitation) async {
        guard let membership = selectedMembership,
              fact.sourceKind == "research_context", let sourceId = fact.sourceId else { return }
        let parts = sourceId.split(separator: ":").map(String.init)
        guard parts.count == 4, parts[0] == "research-context",
              ["fact", "peer"].contains(parts[2]) else {
            twoLayerReportWorkspace.message = "报告来源 ID 不是可重开的同行档案条目。"
            return
        }
        let identity = researchDocumentTaskIdentity
        researchReportPeerOriginalPresentation = nil
        do {
            let workspace = try await client.fetchFrozenResearchEvidence(membership: membership)
            guard selectedMembership?.id == membership.id,
                  selectedMembership?.version == membership.version,
                  researchDocumentTaskIdentity == identity,
                  workspace.requestedActorId == membership.actorId,
                  workspace.membershipId == membership.id,
                  let freshReport = workspace.data?.reports.first(where: {
                      $0.id == report.id && $0.version == report.version
                          && $0.reportFingerprint == report.reportFingerprint
                  }), freshReport.isImmutableExact,
                  freshReport.payload.researchLayer?.context?.contains(fact) == true,
                  let binding = freshReport.payload.snapshotBinding,
                  let frozen = freshReport.payload.snapshot, frozen.binds(binding),
                  let selection = frozen.intent.selectedResearchContext,
                  let selected = frozen.selectedResearchContext,
                  selected.contextId == parts[1],
                  selected.contentHash == selection.contentHash,
                  selected.membershipId == membership.id,
                  selected.membershipVersion == binding.membershipVersion,
                  selected.selectedSymbol == membership.symbol else {
                throw ResearchContextClientError.invalidResponse
            }
            let selectedCitation: ResearchPeerCitation?
            let peerSymbol: String
            if parts[2] == "fact", let selectedFact = selected.peerFacts?.first(where: {
                $0.id == parts[3] && (selection.peerFactIds ?? []).contains($0.id)
            }) {
                selectedCitation = selectedFact.citation; peerSymbol = selectedFact.symbol
            } else if parts[2] == "peer", let peer = selected.peers.first(where: {
                $0.id == parts[3] && selection.peerIds.contains($0.id)
            }) {
                selectedCitation = peer.citation; peerSymbol = peer.symbol
            } else { throw ResearchContextClientError.invalidResponse }
            guard let selectedCitation,
                  case .savedMaterial(let exact) = selectedCitation,
                  exact == citation else { throw ResearchContextClientError.invalidResponse }
            let sourceMembership: CandidateMembershipData
            if let source = exact.sourceMembership {
#if OWNER_CLIENT
                guard source.symbol == peerSymbol,
                      let peer = ownerStore.membershipEnvelope?.memberships.first(where: {
                          $0.id == source.membershipId && $0.version == source.membershipVersion
                              && $0.symbol == source.symbol && $0.actorId == membership.actorId
                              && $0.state == .tracked
                      }) else { throw ResearchContextClientError.invalidResponse }
                sourceMembership = peer
#else
                throw ResearchContextClientError.invalidResponse
#endif
            } else { sourceMembership = membership }
            let sourceWorkspace = try await client.fetchFrozenResearchEvidence(membership: sourceMembership)
            guard sourceWorkspace.requestedActorId == membership.actorId,
                  sourceWorkspace.membershipId == sourceMembership.id,
                  let material = sourceWorkspace.data?.materials.first(where: { $0.id == exact.materialId }),
                  material.validates(expected: sourceMembership),
                  material.revision == exact.materialRevision,
                  material.revisionState == "current", material.freshness == "fresh",
                  material.contentFingerprint == exact.contentFingerprint,
                  material.sourceType == exact.sourceType,
                  material.sourceVersion == exact.sourceVersion,
                  material.sourceUrl == exact.sourceUrl else {
                throw ResearchContextClientError.invalidResponse
            }
            let presentation: ResearchSavedOriginalPresentation
            if material.sourceType == "issuer_public_html",
               let cited = exact.snapshotCitation,
               let original = material.snapshotOriginal,
               let rawSha = exact.snapshotRawSha256 {
                let snapshot = try await client.readResearchSourceSnapshot(
                    membership: sourceMembership, snapshotId: cited.snapshotId)
                _ = try await client.readResearchSourceSnapshotOriginal(
                    membership: sourceMembership, snapshot: snapshot)
                let range = NSRange(location: cited.startUtf16,
                    length: cited.endUtf16 - cited.startUtf16)
                guard material.snapshotCitation == cited,
                      snapshot.rawSha256 == rawSha,
                      snapshot.rawSha256 == original.rawSha256,
                      snapshot.responseUrl == original.responseUrl,
                      snapshot.textSha256 == cited.textSha256,
                      snapshot.selectedCitation(range: range)?.0 == cited,
                      snapshot.selectedCitation(range: range)?.1 == material.contentText,
                      let text = snapshot.normalizedText else {
                    throw ResearchContextClientError.invalidResponse
                }
                presentation = ResearchSavedOriginalPresentation(
                    title: "\(sourceMembership.symbol) · 已保存官方网页",
                    body: text,
                    verification: "已核对报告冻结选择、材料版本、网页原始字节与确切选段；在线页面可能已变化。",
                    highlightRange: range)
            } else if material.sourceType == "futu_opend_financial_statement_provider",
                      let cited = exact.providerOriginal,
                      let source = material.futuFinancialSource {
                let capture = try await client.readFutuFinancialCapture(
                    membership: sourceMembership, captureId: cited.captureId)
                guard source.validates(sourceMembership), source.captureId == cited.captureId,
                      source.pages.contains(where: { $0.pageId == cited.pageId
                          && $0.rawSha256 == cited.rawSha256 && $0.reportSha256 == cited.reportSha256 }),
                      let page = capture.pages.first(where: { $0.id == cited.pageId
                          && $0.rawSha256 == cited.rawSha256
                          && $0.reports.contains(where: { $0.reportSha256 == cited.reportSha256 }) }) else {
                    throw ResearchContextClientError.invalidResponse
                }
                let original = try await client.readFutuFinancialOriginal(
                    membership: sourceMembership, capture: capture, page: page)
                presentation = ResearchSavedOriginalPresentation(
                    title: "\(sourceMembership.symbol) · OpenD 已保存原始页",
                    body: original.rawText,
                    verification: "已核对报告冻结选择、材料版本、捕获页与原始字节。第三方资料，未核实；不是发行人财务事实。",
                    highlightRange: nil)
            } else { throw ResearchContextClientError.invalidResponse }
            guard researchDocumentTaskIdentity == identity,
                  selectedMembership?.id == membership.id,
                  selectedMembership?.version == membership.version else { return }
#if OWNER_CLIENT
            if exact.sourceMembership != nil,
               ownerStore.membershipEnvelope?.memberships.contains(where: {
                   $0.id == sourceMembership.id && $0.version == sourceMembership.version
                       && $0.symbol == sourceMembership.symbol && $0.actorId == membership.actorId
                       && $0.state == .tracked
               }) != true { throw ResearchContextClientError.invalidResponse }
#endif
            researchReportPeerOriginalPresentation = presentation
        } catch {
            guard researchDocumentTaskIdentity == identity else { return }
            twoLayerReportWorkspace.message = "报告冻结的同行来源或原件无法精确重开；未使用当前替代材料。"
        }
    }

    @MainActor
    func openSelectedContextReportCitation(report: TwoLayerReportData,
        fact: TwoLayerReportFact, citation: ResearchContextCitation) async {
        guard let membership = selectedMembership,
              fact.sourceKind == "research_context",
              let sourceId = fact.sourceId else { return }
        let parts = sourceId.split(separator: ":").map(String.init)
        guard parts.count == 4, parts[0] == "research-context",
              ["fact", "peer"].contains(parts[2]) else {
            researchContextWorkspace.message = "报告来源 ID 不是可重开的档案条目。"
            return
        }
        do {
            let workspace = try await client.fetchFrozenResearchEvidence(membership: membership)
            guard selectedMembership?.id == membership.id,
                  selectedMembership?.version == membership.version,
                  workspace.requestedActorId == membership.actorId,
                  workspace.membershipId == membership.id,
                  let freshReport = workspace.data?.reports.first(where: {
                      $0.id == report.id && $0.version == report.version
                          && $0.reportFingerprint == report.reportFingerprint
                  }),
                  freshReport.isImmutableExact,
                  freshReport.payload.researchLayer?.context?.contains(fact) == true,
                  let binding = freshReport.payload.snapshotBinding,
                  let frozen = freshReport.payload.snapshot,
                  frozen.binds(binding),
                  let selection = frozen.intent.selectedResearchContext,
                  let selected = frozen.selectedResearchContext,
                  selected.contextId == parts[1],
                  selected.contentHash == selection.contentHash,
                  selected.membershipId == membership.id,
                  selected.membershipVersion == binding.membershipVersion,
                  selected.selectedSymbol == membership.symbol else {
                researchContextWorkspace.message = "报告冻结选择或原始页引用已变化；未打开替代来源。"
                return
            }
            let exact: ResearchContextCitation?
            if parts[2] == "fact" {
                let selectedFact = selected.selectedFacts.first(where: {
                    $0.id == parts[3] && selection.selectedFactIds.contains($0.id)
                }) ?? selected.peerFacts?.first(where: {
                    $0.id == parts[3] && (selection.peerFactIds ?? []).contains($0.id)
                })
                if let selectedFact, case .pdf(let pdf) = selectedFact.citation { exact = pdf }
                else { exact = nil }
            } else if let peer = selected.peers.first(where: {
                $0.id == parts[3] && selection.peerIds.contains($0.id)
            }), case .pdf(let pdf) = peer.citation {
                exact = pdf
            } else {
                exact = nil
            }
            guard let exact,
                  exact.documentId == citation.documentId,
                  exact.pageNumber == citation.pageNumber,
                  exact.pageTextSha256 == citation.pageTextSha256,
                  exact.sourceMembership == citation.sourceMembership else {
                researchContextWorkspace.message = "报告冻结选择或原始页引用已变化；未打开替代来源。"
                return
            }
            await openResearchContextCitation(exact, requireFreshDocumentList: true)
        } catch {
            researchContextWorkspace.message = "报告档案来源重新核对失败；未打开替代来源。"
        }
    }
    @MainActor
    func openTwoLayerMaterialCitation(
        report: TwoLayerReportData,
        pack: FrozenResearchEvidencePack,
        material: ResearchMaterialData
    ) async {
        guard let membership = selectedMembership,
              report.evidencePackId == pack.id,
              report.payload.evidencePackBinding?.id == pack.id,
              report.payload.evidencePackBinding?.version == pack.version,
              report.payload.evidencePackBinding?.fingerprint == pack.packFingerprint,
              pack.membershipId == membership.id,
              pack.symbol == membership.symbol,
              pack.items.contains(material),
              material.citation != nil || material.snapshotCitation != nil else {
            researchDocumentWorkspace.message = "报告材料已不匹配 exact evidence pack；未打开替代来源。"
            return
        }
        do {
            let workspace = try await client.fetchFrozenResearchEvidence(membership: membership)
            guard selectedMembership?.id == membership.id,
                  selectedMembership?.version == membership.version,
                  parsedSymbol?.canonical == membership.symbol,
                  let data = workspace.data,
                  let freshReport = data.reports.first(where: {
                      $0.id == report.id && $0.version == report.version
                          && $0.reportFingerprint == report.reportFingerprint
                          && $0.evidencePackId == report.evidencePackId
                  }),
                  let freshPack = data.evidencePacks.first(where: {
                      $0.id == pack.id && $0.version == pack.version
                          && $0.packFingerprint == pack.packFingerprint
                  }),
                  freshReport.payload.evidencePackBinding?.fingerprint == freshPack.packFingerprint,
                  let freshMaterial = freshPack.items.first(where: {
                      $0.evidenceId == material.evidenceId
                          && $0.contentFingerprint == material.contentFingerprint
                          && $0.revision == material.revision
                          && $0.citation == material.citation
                          && $0.snapshotCitation == material.snapshotCitation
                          && $0.snapshotOriginal == material.snapshotOriginal
                  }) else {
                researchDocumentWorkspace.message = "报告、证据包或原始材料已变化；未打开缓存或替代来源。"
                return
            }
            if let citation = freshMaterial.snapshotCitation,
               let original = freshMaterial.snapshotOriginal {
                if !(await openStoredSourceCitation(citation, original: original)) {
                    researchDocumentWorkspace.message = "报告网页原件与选段未能精确重开；没有使用在线替代版本。"
                }
                return
            }
            await loadResearchDocuments()
            guard selectedMembership?.id == membership.id,
                  selectedMembership?.version == membership.version,
                  let list = researchDocumentWorkspace.list,
                  let currentMaterial = list.materials.first(where: {
                      $0.evidenceId == freshMaterial.evidenceId
                          && $0.contentFingerprint == freshMaterial.contentFingerprint
                          && $0.revision == freshMaterial.revision
                          && $0.citation == freshMaterial.citation
                  }),
                  let documentId = currentMaterial.citation?.documentId,
                  let document = list.documents.first(where: { $0.id == documentId }) else {
                researchDocumentWorkspace.message = "当前证据版本中的原始文档页暂时无法打开；没有用其他来源替代。"
                return
            }
            researchDocumentWorkspace.selectedDocumentId = document.id
            await openPersistedResearchDocumentCitation(document: document, material: currentMaterial)
        } catch {
            researchDocumentWorkspace.message = "报告来源重新核对失败；未打开缓存或替代来源：\(twoLayerReportErrorMessage(error))"
        }
    }
}
