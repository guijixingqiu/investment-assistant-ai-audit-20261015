import SwiftUI

struct ResearchView: View {
    @ObservedObject private var api = OwnerClientStore.shared
    let openResearch: (String, ClientDestination) -> Void
    let manage: () -> Void
    @State private var filter = "全部"
    private var candidates: [CandidateMembership] {
        api.candidates.filter { filter == "全部" || (filter == "跟踪中" ? $0.state == "tracked" : $0.state == "paused") }
    }
    var body: some View {
        ClientPage(title: "研究", subtitle: "我的研究清单") {
            Picker("研究状态", selection: $filter) {
                ForEach(["全部", "跟踪中", "暂停"], id: \.self) { Text($0) }
            }.pickerStyle(.segmented)
            if candidates.isEmpty {
                ClientNote(text: api.loading ? "正在读取研究清单…" : api.membershipEnvelope?.status == .available ? "此分类暂无研究标的。" : "研究清单暂不可用，请下拉重试。")
            }
            ForEach(candidates) { candidate in
                Button { openResearch(candidate.symbol, .stock) } label: {
                    VStack(alignment: .leading, spacing: 10) {
                        HStack {
                            Text(candidate.name).font(.system(size: 16, weight: .semibold))
                            Text(candidate.symbol).font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
                            Spacer()
                            Image(systemName: "chevron.right").font(.system(size: 10))
                        }
                        Text(candidate.currentDossier.thesisSummary).font(.system(size: 13))
                            .foregroundStyle(Theme.textSecondary).lineLimit(2)
                        HStack {
                            Text(stateLabel(candidate.state)).font(.system(size: 11)).foregroundStyle(Theme.purple)
                            Spacer()
                            Text("继续研究 →").font(.system(size: 13)).foregroundStyle(Theme.blue)
                        }
                    }.padding(15).frame(maxWidth: .infinity, alignment: .leading)
                        .background(Theme.purple.opacity(0.07), in: RoundedRectangle(cornerRadius: 13))
                }.buttonStyle(.plain).accessibilityIdentifier("researchCandidate-\(candidate.symbol)")
            }
            ClientSection(title: "研究动态") {
                ClientRow(title: "当前标的研究报告", subtitle: api.currentSymbol, tone: Theme.purple) {
                    openResearch(api.currentSymbol, .report)
                }.accessibilityIdentifier("openResearchWorkflow")
                ClientRow(title: "个人决定与到期复盘", icon: "clock.arrow.circlepath", tone: Theme.amber) {
                    openResearch(api.currentSymbol, .review)
                }
            }
            ClientRow(title: "管理与添加研究标的", subtitle: "纳入、暂停与归档", icon: "plus.circle", action: manage)
        }.refreshable { await api.load(tab: .research, symbol: api.currentSymbol) }
        .accessibilityIdentifier("clientResearch")
    }
    private func stateLabel(_ state: String) -> String {
        switch state { case "tracked": "跟踪中"; case "paused": "已暂停"; case "archived": "已归档"; default: "研究候选" }
    }
}
