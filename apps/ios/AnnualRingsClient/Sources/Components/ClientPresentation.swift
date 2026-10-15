import SwiftUI
import CryptoKit

/// A local navigation intent. It contains the Owner's question and read-only
/// source coordinates, never an investigation answer or provider credential.
struct PersonalFormalSnapshotCoordinate: Codable, Equatable {
    let snapshotId: String
    let rawSha256: String
    let textSha256: String
    let startUtf16: Int
    let endUtf16: Int
    let excerptSha256: String
    let readStartUtf16: Int
    let readEndUtf16: Int
    let readExcerptSha256: String
    let readTruncated: Bool

    var identityParts: [String] {
        [snapshotId, rawSha256, textSha256, String(startUtf16), String(endUtf16), excerptSha256,
         String(readStartUtf16), String(readEndUtf16), readExcerptSha256, readTruncated ? "1" : "0"]
    }

    var isValid: Bool {
        snapshotId.range(of: "^[1-9][0-9]*$", options: .regularExpression) != nil
            && [rawSha256, textSha256, excerptSha256, readExcerptSha256].allSatisfy {
                $0.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil
            }
            && startUtf16 >= 0 && endUtf16 > startUtf16
            && readStartUtf16 >= startUtf16 && readEndUtf16 > readStartUtf16
            && readEndUtf16 <= endUtf16
    }
}

struct PersonalFormalSourceHint: Equatable {
    let sourceType: String
    let url: String
    let pageNumber: Int?
    let pageTextSha256: String
    var snapshotCitation: PersonalFormalSnapshotCoordinate? = nil
}

struct PersonalFormalReadSource: Equatable {
    let symbol: String
    let sourceType: String
    let readStatus: String
    let url: String?
    let pageNumber: Int?
    let contentSha256: String
    var snapshotCitation: PersonalFormalSnapshotCoordinate? = nil
}

struct PersonalFormalProviderSourceHint: Codable, Equatable {
    let captureId: String
    let financialType: String
    let periodEnd: String
    let sourceFingerprint: String
    let materials: [FutuFinancialMaterialIdentity]
}

enum PersonalResearchHandoffPurpose: Equatable {
    case formalTask
    case manualJudgment
}

/// Local, selected source coordinates for an editable human research draft.
/// The evidence API stores a source description, not this exact material binding.
struct PersonalManualSelectedSource: Equatable, Identifiable {
    let id: String
    let title: String
    let sourceType: String
    let url: String?
    let retrievedAt: String
    let publishedAt: String?
    let contentSha256: String
    let pageNumber: Int?
    let documentId: String?
    let documentPdfSha256: String?
    let snapshotCitation: PersonalFormalSnapshotCoordinate?
    let provider: PersonalFormalProviderSourceHint?

    var savedMaterial: FutuFinancialMaterialIdentity? {
        provider?.materials.count == 1 ? provider?.materials.first : nil
    }
}

/// Read-only context carried into an editable ordinary judgment handoff.
struct PersonalOrdinaryChangeContext: Equatable {
    let reasoningFingerprint: String
    let comparison: OperatingDisclosureComparison?
    let sourceFacts: [OperatingFact]
    let selectedFactId: String?
    let changeTriggerType: String?
    let changeId: String?
    let previousOrdinaryCheckId: String?
    let operatingMeaning: String
    let unknown: String
    let nextQuestion: String
    var changeSourcesSelected = false
}

struct PersonalFormalResearchHandoff: Equatable {
    let id = UUID()
    let symbol: String
    let membershipId: String
    let membershipVersion: Int
    let mode: String
    let eventDate: String?
    let question: String
    let readSourceScope: String
    let connectionScope: String
    let sources: [PersonalFormalSourceHint]
    var providerSources: [PersonalFormalProviderSourceHint] = []
    var purpose: PersonalResearchHandoffPurpose = .formalTask
    var manualSources: [PersonalManualSelectedSource] = []
    var ordinaryChangeContext: PersonalOrdinaryChangeContext? = nil

    static func currentConnectionScope() -> String {
        let auth = AppEnvironment.researchAuthorizationContext()
        let identity = [auth.baseURL.absoluteString, auth.readHeaderName, auth.readToken ?? ""].joined(separator: "\u{0}")
        return SHA256.hash(data: Data(identity.utf8)).map { String(format: "%02x", $0) }.joined()
    }

    static func sourceScope(_ sources: [PersonalFormalReadSource]) -> String {
        let coordinates = sources.map {
            ([$0.symbol, $0.sourceType, $0.readStatus, $0.url ?? "", $0.pageNumber.map { String($0) } ?? "", $0.contentSha256]
                + ($0.snapshotCitation?.identityParts ?? ["no_snapshot_citation"]))
                .joined(separator: "\u{0}")
        }.sorted().joined(separator: "\u{1}")
        return SHA256.hash(data: Data(coordinates.utf8)).map { String(format: "%02x", $0) }.joined()
    }
}

/// Navigation carries the stock identity; all research destinations belong to Research.
enum ClientDestination: String, Hashable {
    case templateHome, stock, report, valuation, quant, materials, tasks, manualResearch, review, researchReview, todayResearchReview, manage, facts, workflow, decision, portfolio
    case market, environment, announcements, assets, assetPortfolio, assetNotes, inbox
    var title: String {
        switch self {
        case .templateHome: "深度投研"
        case .decision: "个人决定"
        case .portfolio: "组合解释与实验"
        case .workflow: "研究进展"
        case .stock: "个股研究"
        case .report: "研究报告"
        case .valuation: "估值与技术"
        case .quant: "历史策略回测"
        case .materials: "资料与原文"
        case .tasks: "更新研究"
        case .manualResearch: "记录我的判断"
        case .review: "决定与复盘"
        case .researchReview: "持续验证与复核"
        case .todayResearchReview: "Today 正式复核"
        case .manage: "研究清单管理"
        case .facts: "财务与经营"
        case .market: "个股分析"
        case .environment: "市场环境"
        case .announcements: "发现与公告"
        case .assets: "快照与组合背景"
        case .assetPortfolio: "组合研究"
        case .assetNotes: "历史成交备注"
        case .inbox: "今日待办"
        }
    }
}
struct ClientResearchNavigation: Equatable {
    let id = UUID()
    let symbol: String
    let destination: ClientDestination
}
private struct ClientDestinationKey: EnvironmentKey {
    static let defaultValue: ClientDestination = .report
}
extension EnvironmentValues {
    var clientDestination: ClientDestination {
        get { self[ClientDestinationKey.self] }
        set { self[ClientDestinationKey.self] = newValue }
    }
}

struct ClientPage<Content: View>: View {
    let title: String
    var subtitle: String = ""
    @ViewBuilder let content: () -> Content
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                if !subtitle.isEmpty {
                    Text(subtitle).font(.system(size: 12)).foregroundStyle(Theme.textSecondary)
                }
                content()
            }.frame(maxWidth: 680, alignment: .leading).padding(.horizontal, 16).padding(.vertical, 14)
                .frame(maxWidth: .infinity)
        }
        .background(Theme.bgPrimary.ignoresSafeArea())
        .navigationTitle(title).navigationBarTitleDisplayMode(.inline)
        .font(.system(size: 14)).foregroundStyle(Theme.textPrimary)
    }
}
struct ClientSection<Content: View>: View {
    let title: String
    @ViewBuilder let content: () -> Content
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title).font(.system(size: 15, weight: .semibold))
            content()
        }
    }
}
struct ClientRow: View {
    let title: String
    var subtitle: String = ""
    var icon: String = "doc.text"
    var tone: Color = Theme.blue
    var action: () -> Void
    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Image(systemName: icon).font(.system(size: 16)).foregroundStyle(tone)
                    .frame(width: 34, height: 34).background(tone.opacity(0.09), in: RoundedRectangle(cornerRadius: 10))
                VStack(alignment: .leading, spacing: 4) {
                    Text(title).font(.system(size: 14)).foregroundStyle(Theme.textPrimary)
                    if !subtitle.isEmpty {
                        Text(subtitle).font(.system(size: 12)).foregroundStyle(Theme.textSecondary).lineLimit(2)
                    }
                }
                Spacer(minLength: 4)
                Image(systemName: "chevron.right").font(.system(size: 10, weight: .semibold)).foregroundStyle(Theme.textTertiary)
            }.frame(minHeight: 48).padding(.vertical, 5).contentShape(Rectangle())
        }.buttonStyle(.plain)
    }
}
struct ClientNote: View {
    let text: String
    var tone: Color = Theme.textSecondary
    var body: some View {
        Text(text).font(.system(size: 12)).foregroundStyle(tone)
            .frame(maxWidth: .infinity, alignment: .leading).padding(13)
            .background(tone.opacity(0.07), in: RoundedRectangle(cornerRadius: 12))
    }
}
struct ClientPrimaryButton: View {
    let title: String
    var action: () -> Void
    var body: some View {
        Button(action: action) {
            Text(title).font(.system(size: 14, weight: .semibold)).frame(maxWidth: .infinity, minHeight: 44)
        }.buttonStyle(.borderedProminent).tint(Theme.blue)
    }
}

/// Shared surface used by overview, stock, reading and edit pages.
struct ClientCard<Content: View>: View {
    let title: String
    var icon: String = "doc.text"
    var tone: Color = Theme.purple
    @ViewBuilder var content: () -> Content
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 7) {
                Image(systemName: icon).foregroundStyle(tone)
                Text(title).foregroundStyle(Theme.textPrimary)
            }.font(.system(size: 14, weight: .semibold))
            content()
        }.font(.system(size: 13)).foregroundStyle(Theme.textSecondary)
            .padding(14).frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.bgCard, in: RoundedRectangle(cornerRadius: 12))
            .overlay { RoundedRectangle(cornerRadius: 12).stroke(Theme.border.opacity(0.55), lineWidth: 0.5) }
    }
}
struct ClientReadingPage<Content: View>: View {
    let title: String
    @ViewBuilder var content: () -> Content
    var body: some View {
        ClientPage(title: title) { content() }
            .buttonStyle(.bordered).controlSize(.small)
            .tint(Theme.blue)
    }
}
struct ClientLinkLabel: View {
    let title: String
    var subtitle: String = ""
    var icon: String = "doc.text"
    var tone: Color = Theme.purple
    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: icon).font(.system(size: 15)).foregroundStyle(tone)
                .frame(width: 30, height: 32).background(tone.opacity(0.08), in: RoundedRectangle(cornerRadius: 8))
            VStack(alignment: .leading, spacing: 4) {
                Text(title).font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.textPrimary)
                if !subtitle.isEmpty { Text(subtitle).font(.system(size: 11)).foregroundStyle(Theme.textSecondary).lineLimit(2) }
            }
            Spacer(minLength: 6)
            Image(systemName: "chevron.right").font(.system(size: 10)).foregroundStyle(Theme.textTertiary)
        }.padding(.vertical, 5).contentShape(Rectangle())
    }
}
