import SwiftUI

extension GlobalSearchSheet {
    var antigravitySearchBody: some View {
        VStack(spacing: 12) {
            HStack {
                Image(systemName: "magnifyingglass").foregroundStyle(Theme.textTertiary)
                TextField("输入代码或名称 (如 00175, 吉利, 腾讯)…", text: $input)
                    .font(.system(size: 14)).foregroundStyle(Theme.textPrimary)
                    .textInputAutocapitalization(.characters).autocorrectionDisabled()
                    .submitLabel(.search).onSubmit { Task { await search() } }
                    .accessibilityIdentifier("globalSearchInput")
                if !input.isEmpty {
                    Button { input = "" } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(Theme.textTertiary) }
                }
                Button(isSearching ? "读取中" : "搜索") { Task { await search() } }
                    .font(.system(size: 12)).foregroundStyle(Theme.blue).disabled(isSearching || input.isEmpty)
                    .accessibilityIdentifier("globalKnownStockSearch")
            }.padding(10).background(Theme.bgSecondary, in: RoundedRectangle(cornerRadius: 10))
                .padding(.horizontal, 16).padding(.top, 8)
            Text(message).font(.system(size: 11)).foregroundStyle(Theme.textTertiary)
                .frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 18)
            if SecuritySymbol.parseHongKongAlias(input) != nil {
                HStack(spacing: 20) {
                    Button("查看该股行情") { apply(tab: .market) }
                    Button("打开研究") { Task { await openExistingResearch() } }
                }.font(.system(size: 12)).foregroundStyle(Theme.gold)
            }
            List {
                ForEach(results, id: \.symbol) { result in
                    Button {
                        Task { await openExistingResearch(selectedSymbol: result.symbol) }
                    } label: {
                        HStack {
                            VStack(alignment: .leading, spacing: 3) {
                                HStack(spacing: 6) {
                                    Text(result.symbol).font(.system(size: 13, weight: .bold, design: .monospaced)).foregroundStyle(Theme.gold)
                                    Text(result.name ?? "名称未提供").font(.system(size: 15, weight: .semibold)).foregroundStyle(Theme.textPrimary)
                                }
                                Text("打开并核对研究身份").font(.system(size: 11)).foregroundStyle(Theme.textTertiary)
                            }
                            Spacer()
                            Image(systemName: "chevron.right").font(.system(size: 12)).foregroundStyle(Theme.textTertiary)
                        }
                    }.listRowBackground(Theme.bgCard)
                }
            }.listStyle(.plain).scrollContentBackground(.hidden).background(Theme.bgPrimary)
        }.background(Theme.bgPrimary.ignoresSafeArea())
    }
}
