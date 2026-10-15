import SwiftUI

struct AntigravityStockDetailView: View {
    public let dossier: InvestmentDecisionDossier
    @ObservedObject var api = OwnerClientStore.shared
    @Environment(\.antigravityActions) private var actions
    @Environment(\.dismiss) private var dismiss
    
    @State private var showAIAssistant: Bool = false
    @State private var showEvidenceDetail: Bool = false
    
    init(dossier: InvestmentDecisionDossier) {
        self.dossier = dossier
    }
    
    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    // Header: Symbol, Name, Real Quote & Badges
                    stockHeaderCard
                    
                    // 1. 【当前判断】Current Stance & Core Thesis
                    section1CurrentJudgment
                    
                    // 2. 【发生了什么】What Happened (Market & Catalyst)
                    section2WhatHappened
                    
                    // 3. 【研究证据链】Evidence Chain & Documents
                    section3EvidenceChain
                    
                    // 4. 【估值与价格条件】Valuation & Conditions
                    section4ValuationAndQuant
                        .id("section4")
                    
                    // 5. 【最大风险与失效条件】Key Risks & Invalidation
                    section5RisksAndInvalidation
                    
                    // 6. 【资产与组合影响】Portfolio Impact Context
                    section6PortfolioImpact
                    
                    // 7. 【下一步行动】Next Action (Manual confirmation required)
                    section7NextAction
                    
                    // 8. 【依据与审计记录】Audit & Technical Diagnostic Logs
                    AuditLogSection(
                        provider: api.activeQuote != nil ? "Futu/OpenD (港股历史行情)" : "年轮证据链 · 研报基线",
                        cutoff: api.activeQuote?.quoteTime ?? dossier.dataCutoff,
                        evidenceHash: dossier.evidenceHash ?? "未提供",
                        taskStatus: dossier.deepResearchStatus,
                        provenance: api.activeQuote != nil ? .real(source: "Futu OpenD", freshness: .stale, timestamp: api.activeQuote!.quoteTime) : dossier.provenance
                    )
                    .id("bottomSection")
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 14)
            }
            .background(Theme.bgPrimary.ignoresSafeArea())
            .navigationTitle(dossier.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button(action: { showAIAssistant = true }) {
                        HStack(spacing: 4) {
                            Image(systemName: "sparkles")
                            Text("AI 助手")
                        }
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundColor(Theme.gold)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(Theme.gold.opacity(0.15))
                        .clipShape(Capsule())
                    }
                }
            }
            .onChange(of: showAIAssistant) { _, shown in if shown { showAIAssistant = false; actions.assistant() } }
            .sheet(isPresented: $showEvidenceDetail) {
                AntigravityEvidenceDetailSheet(dossier: dossier)
            }
            .task {
                if ProcessInfo.processInfo.arguments.contains("--scroll-bottom") {
                    try? await Task.sleep(nanoseconds: 300_000_000)
                    withAnimation {
                        proxy.scrollTo("bottomSection", anchor: .bottom)
                    }
                } else if ProcessInfo.processInfo.arguments.contains("--scroll-valuation") {
                    try? await Task.sleep(nanoseconds: 300_000_000)
                    withAnimation {
                        proxy.scrollTo("section4", anchor: .top)
                    }
                }
            }
        }
    }
    
    // MARK: - Header
    private var stockHeaderCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 8) {
                        Text(dossier.symbol)
                            .font(.system(size: 15, weight: .bold, design: .monospaced))
                            .foregroundColor(Theme.gold)
                        Text(dossier.name)
                            .font(.system(size: 22, weight: .bold))
                            .foregroundColor(Theme.textPrimary)
                    }
                    Text(api.currentCandidate.industry)
                        .font(.system(size: 12))
                        .foregroundColor(Theme.textTertiary)
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 2) {
                    if let q = api.activeQuote {
                        Text(String(format: "%.2f", q.price))
                            .font(.system(size: 24, weight: .bold, design: .monospaced))
                            .foregroundColor(Theme.textPrimary)
                        Text(templateNumber(q.changePercent, format: "%+.2f%%"))
                            .font(.system(size: 13, weight: .semibold, design: .monospaced))
                            .foregroundColor(q.isPositive ? Theme.green : Theme.red)
                    } else {
                        Text(templateNumber(dossier.currentPrice, format: "%.2f"))
                            .font(.system(size: 24, weight: .bold, design: .monospaced))
                            .foregroundColor(Theme.textPrimary)
                        Text("涨跌未返回")
                            .font(.system(size: 13, weight: .semibold, design: .monospaced))
                            .foregroundColor(Theme.red)
                    }
                }
            }
            
            HStack {
                if let q = api.activeQuote {
                    StatusBadgeView(.real(source: "Futu 行情 (已持久化)", freshness: q.isStale ? .stale : .fresh, timestamp: q.quoteTime))
                } else {
                    StatusBadgeView(dossier.provenance)
                }
                Spacer()
                Text("昨收 \(templateNumber(api.activeQuote?.previousClose)) HKD")
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundColor(Theme.textTertiary)
            }
        }
        .padding(16)
        .templateCardStyle(elevated: true)
    }
    
    // MARK: - 1. 当前判断
    private var section1CurrentJudgment: some View {
        VStack(alignment: .leading, spacing: 10) {
            sectionHeader(num: "1", title: "当前判断 (Current Stance)", tag: dossier.stance, tagColor: Theme.gold)
            
            VStack(alignment: .leading, spacing: 10) {
                Text(dossier.judgmentTitle)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundColor(Theme.textPrimary)
                    .lineSpacing(2)
                
                Text(dossier.thesisSummary)
                    .font(.system(size: 13))
                    .foregroundColor(Theme.textSecondary)
                    .lineSpacing(4)
                
                HStack(spacing: 16) {
                    HStack(spacing: 4) {
                        Text("信心评级:")
                            .font(.system(size: 11))
                            .foregroundColor(Theme.textTertiary)
                        Text(dossier.confidence)
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundColor(Theme.gold)
                    }
                    HStack(spacing: 4) {
                        Text("投资视野:")
                            .font(.system(size: 11))
                            .foregroundColor(Theme.textTertiary)
                        Text(dossier.horizon)
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundColor(Theme.textPrimary)
                    }
                }
                .padding(.top, 4)
            }
            .padding(14)
            .templateCardStyle()
        }
    }
    
    // MARK: - 2. 发生了什么
    private var section2WhatHappened: some View {
        VStack(alignment: .leading, spacing: 10) {
            sectionHeader(num: "2", title: "发生了什么 (What Happened)", tag: "基本面与行情脉动", tagColor: Theme.blue)
            
            VStack(alignment: .leading, spacing: 10) {
                Text(dossier.priceNarrative)
                    .font(.system(size: 13))
                    .foregroundColor(Theme.textSecondary)
                    .lineSpacing(3)
                
                Divider().background(Theme.border)
                
                Text("近期关键催化事件:")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundColor(Theme.textPrimary)
                
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(dossier.latestCatalysts, id: \.self) { catalyst in
                        HStack(alignment: .top, spacing: 6) {
                            Circle().fill(Theme.blue).frame(width: 4, height: 4).padding(.top, 6)
                            Text(catalyst)
                                .font(.system(size: 12))
                                .foregroundColor(Theme.textSecondary)
                                .lineSpacing(2)
                        }
                    }
                }
            }
            .padding(14)
            .templateCardStyle()
        }
    }
    
    // MARK: - 3. 研究证据链
    private var section3EvidenceChain: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                sectionHeader(num: "3", title: "研究证据链 (Evidence Chain)", tag: "\(api.currentCandidate.evidenceFacts.count) 项引用", tagColor: Theme.green)
                Spacer()
                Button(action: { showEvidenceDetail = true }) {
                    Text("查看 PDF 原文")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundColor(Theme.blue)
                }
            }
            
            VStack(alignment: .leading, spacing: 8) {
                ForEach(api.currentCandidate.evidenceFacts) { fact in
                    evidenceRow(title: fact.sourceTitle, fact: fact.quoteSnippet, date: fact.publishDate)
                }
                if api.currentCandidate.evidenceFacts.isEmpty {
                    evidenceRow(title: "尚未读取原文引用", fact: "打开资料核对文档与引用", date: "—")
                }
            }
            .padding(12)
            .templateCardStyle()
        }
    }
    
    private func evidenceRow(title: String, fact: String, date: String) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack {
                Text(title)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundColor(Theme.textPrimary)
                Spacer()
                Text(date)
                    .font(.system(size: 10))
                    .foregroundColor(Theme.textTertiary)
            }
            Text("核验事实: \(fact)")
                .font(.system(size: 11.5))
                .foregroundColor(Theme.textSecondary)
        }
        .padding(.vertical, 4)
    }
    
    // MARK: - 4. 估值锚点与量化技术分析
    private var section4ValuationAndQuant: some View {
        VStack(alignment: .leading, spacing: 12) {
            sectionHeader(num: "4", title: "估值锚点与量化技术分析 (Valuation & Technics)", tag: "PE \(templateNumber(dossier.peTtm, format: "%.1f"))x", tagColor: Theme.gold)
            
            // 4.1 Visual Progress Gauge
            AntigravityPriceGauge(
                currentPrice: api.activeQuote?.price ?? dossier.currentPrice,
                safetyMargin: dossier.safetyMarginPrice,
                targetBase: dossier.targetPriceBase,
                targetBull: dossier.targetPriceBull
            )
            
            // 4.2 量化估值模型核算
            quantValuationCard
            
            // 4.3 真实个股日线量化技术指标 (来自后端真实 /daily-bars 接口)
            dailyTechnicalIndicatorsCard
            
            // 4.4 真实 Stan Weinstein 周线阶段分析 (来自后端真实 /weinstein 接口)
            weinsteinAnalysisCard
            
            // 4.5 价格触发条件矩阵
            conditionTriggersCard
        }
    }
    
    private var quantValuationCard: some View {
        let fcff = api.templateValuation?.symbol == dossier.symbol
            ? api.templateValuation?.fcffScenarioSets?.first(where: {
                $0.scenarioState == "current" && $0.recomputable && $0.invalidatedBy.isEmpty
            }) : nil
        return VStack(alignment: .leading, spacing: 8) {
            HStack {
                Image(systemName: "chart.xyaxis.line")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(Theme.gold)
                Text("量化估值模型核算")
                    .font(.system(size: 13, weight: .bold))
                    .foregroundColor(Theme.textPrimary)
                Spacer()
                StatusBadgeView(fcff.map {
                    .real(source: "原件与个人假设", freshness: .fresh, timestamp: $0.createdAt)
                } ?? .unavailable(reason: "需核对估值情景"))
            }
            
            HStack(spacing: 8) {
                quantMetricBox(title: "FCFF 折现情景", value: fcff.map {
                    "\(String(format: "%.2f", $0.calculation.commonEquityValuePerShare)) \($0.calculation.currency)/股"
                } ?? "—", subtitle: fcff.map { "情景 #\($0.id) · 来源与假设已复核" }
                    ?? "当前无可重算的现金流情景", color: Theme.gold)
                quantMetricBox(title: "历史PE分位", value: templateNumber(dossier.pePercentile), subtitle: "以估值来源为准", color: Theme.green)
                quantMetricBox(title: "隐含营收增速", value: "—", subtitle: "尚未绑定隐含预期", color: Theme.blue)
            }
            Button("打开估值与量化工作区") { actions.workflow(.valuation) }
                .font(.system(size: 12, weight: .semibold)).foregroundColor(Theme.gold)
        }
        .padding(14)
        .templateCardStyle()
    }
    
    private func quantMetricBox(title: String, value: String, subtitle: String, color: Color) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(title)
                .font(.system(size: 10.5))
                .foregroundColor(Theme.textTertiary)
            Text(value)
                .font(.system(size: 13.5, weight: .bold, design: .monospaced))
                .foregroundColor(color)
            Text(subtitle)
                .font(.system(size: 9.5))
                .foregroundColor(Theme.textSecondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(8)
        .background(Theme.bgSecondary)
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }
    
    private var dailyTechnicalIndicatorsCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Image(systemName: "waveform.path.ecg")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(Theme.blue)
                Text("个股量化技术分析 (Daily Indicators)")
                    .font(.system(size: 13, weight: .bold))
                    .foregroundColor(Theme.textPrimary)
                Spacer()
                if let tech = api.technicalIndicators {
                    StatusBadgeView(.real(source: "日线技术引擎", freshness: .stale, timestamp: tech.session))
                } else {
                    StatusBadgeView(.unavailable(reason: "技术数据未返回"))
                }
            }
            
            let tech = api.technicalIndicators
            let ma20 = tech?.ma20
            let ma60 = tech?.ma60
            let rsi = tech?.rsi14
            let macdHist = tech?.macdHistogram
            let bollLower = tech?.bollingerLower
            let bollUpper = tech?.bollingerUpper
            
            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 8) {
                techCell(title: "均线系统 (MA20 / MA60)", value: "\(templateNumber(ma20)) / \(templateNumber(ma60))", desc: "后端同一日线快照", color: Theme.amber)
                techCell(title: "MACD (12, 26, 9)", value: templateNumber(macdHist, format: "柱: %.3f"), desc: "后端同一日线快照", color: Theme.blue)
                techCell(title: "布林通道 (20, 2SD)", value: "\(templateNumber(bollLower)) ~ \(templateNumber(bollUpper))", desc: "后端同一日线快照", color: Theme.gold)
                techCell(title: "RSI14 (Wilder)", value: templateNumber(rsi, format: "%.1f"), desc: "后端同一日线快照", color: (rsi ?? .infinity) < 35 ? Theme.green : Theme.textPrimary)
            }
        }
        .padding(14)
        .templateCardStyle()
    }
    
    private func techCell(title: String, value: String, desc: String, color: Color) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(title)
                .font(.system(size: 10))
                .foregroundColor(Theme.textTertiary)
            Text(value)
                .font(.system(size: 13, weight: .bold, design: .monospaced))
                .foregroundColor(color)
            Text(desc)
                .font(.system(size: 9.5))
                .foregroundColor(Theme.textSecondary)
                .lineLimit(1)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(8)
        .background(Theme.bgSecondary)
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }
    
    private var weinsteinAnalysisCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Image(systemName: "chart.line.uptrend.xyaxis")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(Theme.purple)
                Text("Stan Weinstein 周线阶段分析")
                    .font(.system(size: 13, weight: .bold))
                    .foregroundColor(Theme.textPrimary)
                Spacer()
                StatusBadgeView(.unavailable(reason: "以后台分析时点为准"))
            }
            
            let wein = api.weinsteinAnalysis
            let stage = wein?.stockStage ?? "未返回"
            let ma30 = wein?.ma30wDirection ?? "未返回"
            
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    HStack(spacing: 4) {
                        Text("当前阶段:")
                            .font(.system(size: 11.5))
                            .foregroundColor(Theme.textSecondary)
                        Text(stage)
                            .font(.system(size: 12, weight: .bold))
                            .foregroundColor(Theme.gold)
                    }
                    Spacer()
                    HStack(spacing: 4) {
                        Text("30周均线:")
                            .font(.system(size: 11.5))
                            .foregroundColor(Theme.textSecondary)
                        Text(ma30)
                            .font(.system(size: 12, weight: .bold))
                            .foregroundColor(Theme.green)
                    }
                }
                
                HStack {
                    HStack(spacing: 4) {
                        Text("阻力区间:")
                            .font(.system(size: 11.5))
                            .foregroundColor(Theme.textSecondary)
                        Text(api.weinsteinAnalysis?.resistanceLevel ?? "未返回")
                            .font(.system(size: 11.5, weight: .semibold, design: .monospaced))
                            .foregroundColor(Theme.red)
                    }
                    Spacer()
                    HStack(spacing: 4) {
                        Text("防守支撑:")
                            .font(.system(size: 11.5))
                            .foregroundColor(Theme.textSecondary)
                        Text(api.weinsteinAnalysis?.supportLevel ?? "未返回")
                            .font(.system(size: 11.5, weight: .semibold, design: .monospaced))
                            .foregroundColor(Theme.green)
                    }
                }
                
                Divider().background(Theme.border)
                
                HStack(alignment: .top, spacing: 6) {
                    Image(systemName: "info.circle.fill")
                        .font(.system(size: 11))
                        .foregroundColor(Theme.blue)
                        .padding(.top, 2)
                    Text(wein?.summary ?? "周线分析暂不可用。")
                        .font(.system(size: 11))
                        .foregroundColor(Theme.textSecondary)
                }
            }
            .padding(10)
            .background(Theme.bgSecondary)
            .clipShape(RoundedRectangle(cornerRadius: 8))
        }
        .padding(14)
        .templateCardStyle()
    }
    
    private var conditionTriggersCard: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("操作价格条件矩阵:")
                .font(.system(size: 12, weight: .semibold))
                .foregroundColor(Theme.textPrimary)
            
            ForEach(dossier.conditionTriggers, id: \.self) { cond in
                HStack(alignment: .top, spacing: 6) {
                    Image(systemName: "checkmark.diamond.fill")
                        .font(.system(size: 10))
                        .foregroundColor(Theme.gold)
                        .padding(.top, 3)
                    Text(cond)
                        .font(.system(size: 12))
                        .foregroundColor(Theme.textSecondary)
                }
            }
        }
        .padding(14)
        .templateCardStyle()
    }
    
    // MARK: - 5. 最大风险与失效条件
    private var section5RisksAndInvalidation: some View {
        VStack(alignment: .leading, spacing: 10) {
            sectionHeader(num: "5", title: "最大风险与失效条件 (Risks & Invalidation)", tag: "回撤 \(dossier.maxDrawdownEst ?? "未估计")", tagColor: Theme.red)
            
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Image(systemName: "shield.slash.fill")
                        .foregroundColor(Theme.red)
                        .font(.system(size: 14))
                    Text("逻辑证伪警报（触发后重新核对判断）")
                        .font(.system(size: 12.5, weight: .bold))
                        .foregroundColor(Theme.red)
                }
                
                ForEach(dossier.invalidationConditions, id: \.self) { inv in
                    HStack(alignment: .top, spacing: 6) {
                        Circle().fill(Theme.red).frame(width: 4, height: 4).padding(.top, 6)
                        Text(inv)
                            .font(.system(size: 12))
                            .foregroundColor(Theme.textSecondary)
                            .lineSpacing(2)
                    }
                }
                
                Divider().background(Theme.border)
                
                Text("持续监测指标:")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundColor(Theme.textPrimary)
                
                ForEach(dossier.monitoringMetrics, id: \.self) { m in
                    HStack(spacing: 6) {
                        Image(systemName: "gauge.with.needle")
                            .font(.system(size: 11))
                            .foregroundColor(Theme.textTertiary)
                        Text(m)
                            .font(.system(size: 11.5))
                            .foregroundColor(Theme.textSecondary)
                    }
                }
            }
            .padding(14)
            .templateCardStyle()
        }
    }
    
    // MARK: - 6. 组合影响
    private var section6PortfolioImpact: some View {
        VStack(alignment: .leading, spacing: 10) {
            sectionHeader(num: "6", title: "资产与组合影响 (Portfolio Impact)", tag: "模拟推演", tagColor: Theme.blue)
            
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 12) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("当前持仓")
                            .font(.system(size: 10))
                            .foregroundColor(Theme.textTertiary)
                        Text(api.currentHoldingSummary(symbol: dossier.symbol))
                            .font(.system(size: 13, weight: .bold))
                            .foregroundColor(Theme.textPrimary)
                    }
                    Spacer()
                    VStack(alignment: .leading, spacing: 2) {
                        Text("建议观察仓位")
                            .font(.system(size: 10))
                            .foregroundColor(Theme.textTertiary)
                        Text("未设定")
                            .font(.system(size: 13, weight: .bold))
                            .foregroundColor(Theme.gold)
                    }
                    Spacer()
                    VStack(alignment: .leading, spacing: 2) {
                        Text("波动率增量")
                            .font(.system(size: 10))
                            .foregroundColor(Theme.textTertiary)
                        Text("未计算")
                            .font(.system(size: 13, weight: .bold, design: .monospaced))
                            .foregroundColor(Theme.blue)
                    }
                }
                .padding(10)
                .background(Theme.bgSecondary)
                .clipShape(RoundedRectangle(cornerRadius: 8))
                
                Text("持仓来自当前记录；情景仓位与波动率增量需在组合实验中按你的输入计算。")
                    .font(.system(size: 11))
                    .foregroundColor(Theme.textTertiary)
                Button("查看组合解释与实验") { actions.workflow(.portfolio) }
                    .font(.system(size: 12, weight: .semibold)).foregroundColor(Theme.gold)
            }
            .padding(14)
            .templateCardStyle()
        }
    }
    
    // MARK: - 7. 下一步行动
    private var section7NextAction: some View {
        VStack(alignment: .leading, spacing: 10) {
            sectionHeader(num: "7", title: "下一步行动 (Next Action)", tag: dossier.actionBadge, tagColor: Theme.blue)
            
            VStack(alignment: .leading, spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(dossier.nextActionTitle)
                        .font(.system(size: 14, weight: .bold))
                        .foregroundColor(Theme.textPrimary)
                    Text(dossier.nextActionDetail)
                        .font(.system(size: 12.5))
                        .foregroundColor(Theme.textSecondary)
                        .lineSpacing(3)
                }
                
                Button(action: {
                    withAnimation {
                        actions.workflow(.materials)
                    }
                }) {
                    HStack {
                        Image(systemName: "doc.text.magnifyingglass")
                        Text("打开资料与原文")
                    }
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(Theme.textPrimary)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 10)
                    .background(Theme.blue)
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                }
                .buttonStyle(.plain)
            }
            .padding(14)
            .templateCardStyle()
        }
    }
    
    // MARK: - Helper
    private func sectionHeader(num: String, title: String, tag: String, tagColor: Color) -> some View {
        HStack {
            Text(title)
                .font(.system(size: 14, weight: .bold))
                .foregroundColor(Theme.textPrimary)
            Spacer()
            Text(tag)
                .font(.system(size: 11, weight: .medium))
                .foregroundColor(tagColor)
                .padding(.horizontal, 6)
                .padding(.vertical, 2)
                .background(tagColor.opacity(0.12))
                .clipShape(Capsule())
        }
    }
}
