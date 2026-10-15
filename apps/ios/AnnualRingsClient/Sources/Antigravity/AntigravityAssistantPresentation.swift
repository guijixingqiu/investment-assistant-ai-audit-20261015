import SwiftUI

extension GlobalAssistantSheet {
    var antigravityAssistantBody: some View {
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Image(systemName: "cpu.fill")
                    Text(cloudAiPolicy.map { "\($0.policy.provider) · \($0.policy.model)" } ?? "正在核对 AI 配置")
                        .font(.system(size: 12, weight: .bold, design: .monospaced))
                    Spacer()
                    Text(cloudAiPolicy?.isEnabled == true ? "已授权" : "待核对")
                        .font(.system(size: 11)).foregroundStyle(cloudAiPolicy?.isEnabled == true ? Theme.green : Theme.amber)
                }.foregroundStyle(Theme.gold)
                Text("当前标的 \(symbolInput) · \(currentResearchReportMessage)")
                    .font(.system(size: 11)).foregroundStyle(Theme.textTertiary)
                HStack(spacing: 16) {
                    Button("重新检查") { Task { await loadCloudAiPolicy() } }.disabled(isAsking || isLoadingCloudAiPolicy)
                    Button("研究与 AI 设置") { Task { await openCurrentResearch() } }.disabled(isAsking)
                }.font(.system(size: 11)).foregroundStyle(Theme.gold)
                DisclosureGroup("发送边界与授权详情") { globalAssistantCloudAiPolicySection }
                    .font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
            }.padding(.horizontal, 14).padding(.vertical, 10).background(Theme.bgSecondary)
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    globalAssistantSessionControls
                    if conversation.isEmpty {
                        Text("\(question.trimmingCharacters(in: .whitespacesAndNewlines).utf16.count) / 1000")
                    .font(.system(size: 10)).foregroundStyle(question.utf16.count > 1000 ? Theme.amber : Theme.textTertiary)
                Text(message).font(.system(size: 12.5)).foregroundStyle(Theme.textSecondary)
                            .lineSpacing(3).padding(14).templateCardStyle()
                    }
                    ForEach(conversation) { turn in
                        HStack {
                            Spacer(minLength: 30)
                            Text(turn.response.question).font(.system(size: 13)).foregroundStyle(Theme.textPrimary)
                                .padding(12).background(Theme.blue.opacity(0.25), in: RoundedRectangle(cornerRadius: 12))
                                .frame(maxWidth: 280, alignment: .trailing)
                        }
                        VStack(alignment: .leading, spacing: 8) {
                            Label("研究助手", systemImage: "sparkles").font(.system(size: 12, weight: .bold)).foregroundStyle(Theme.gold)
                            Text(turn.response.answer ?? turn.response.message).font(.system(size: 12.5))
                                .foregroundStyle(Theme.textPrimary).lineSpacing(3).textSelection(.enabled)
                                .accessibilityIdentifier("globalAssistantAnswer")
                            if let report = answeredReport {
                                Divider()
                                DisclosureGroup("引用、来源与截止") { globalAssistantTurn(turn, report: report) }
                                    .font(.system(size: 11))
                            }
                        }.padding(14).templateCardStyle()
                    }
                    if let response, response.status != "available" {
                        VStack(alignment: .leading, spacing: 8) {
                            Text(response.message.contains("HTTP 402")
                                 ? "模型服务拒绝本次请求（HTTP 402）。请核对服务账户的额度或计费状态；恢复后可重新发送。"
                                 : response.message)
                                .font(.system(size: 12)).foregroundStyle(Theme.amber)
                            DisclosureGroup("本次请求与发送记录") { globalAssistantSendManifest(response) }
                                .font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
                        }.accessibilityIdentifier("clientAssistantFailure")
                    }
                    if let latest = conversation.last?.response, let report = answeredReport {
                        DisclosureGroup("修订与后续核实") {
                            TextField("记录要修正或继续核实的内容", text: $correction, axis: .vertical)
                            Button("形成报告修订草稿") { openAssistantHandoff(.reportRevision(correction.trimmingCharacters(in: .whitespacesAndNewlines)), response: latest, report: report) }
                                .disabled(!validAssistantCorrection)
                            Button("加入研究待办") { openAssistantHandoff(.researchTodo(correction.trimmingCharacters(in: .whitespacesAndNewlines)), response: latest, report: report) }
                                .disabled(!validAssistantCorrection)
                        }.font(.system(size: 12))
                    }
                    DisclosureGroup("本机临时对话") {
                        Picker("保留期", selection: $temporaryConversationRetentionRaw) {
                            ForEach(ResearchTemporaryConversationRetention.allCases, id: \.rawValue) { Text($0.title).tag($0.rawValue) }
                        }
                        Button("恢复当前报告临时对话") { Task { await restoreTemporaryConversation() } }.disabled(isAsking)
                        Button("保存当前临时对话") { saveTemporaryConversationWithMessage() }.disabled(answeredMembership == nil || answeredReport == nil)
                        Button(temporaryConversationDeletionPending ? "再次确认删除全部本机临时对话" : "删除全部本机临时对话", role: .destructive) { deleteAllTemporaryConversations() }
                    }.font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
                }.padding(16)
            }
            Divider().overlay(Theme.border)
            VStack(spacing: 10) {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(["核查失效条件", "总结主要反证", "核对估值依据"], id: \.self) { prompt in
                            Button(prompt) { question = "根据当前报告，\(prompt)，请列出对应来源和仍需核实的内容。" }
                                .disabled(activeAssistantSessionCount >= researchEvidenceQuestionSessionLimit)
                                .font(.system(size: 11)).foregroundStyle(Theme.gold).padding(.horizontal, 10).padding(.vertical, 5)
                                .background(Theme.gold.opacity(0.10), in: Capsule())
                        }
                    }
                }
                HStack(alignment: .bottom, spacing: 10) {
                    TextField("围绕当前报告继续提问…", text: $question, axis: .vertical)
                        .font(.system(size: 13)).lineLimit(1...5).padding(10)
                        .background(Theme.bgSecondary, in: RoundedRectangle(cornerRadius: 8))
                        .disabled(isAsking || activeAssistantSessionCount >= researchEvidenceQuestionSessionLimit)
                        .accessibilityIdentifier("globalAssistantQuestion")
                    Button { Task { await ask() } } label: {
                        Image(systemName: isAsking ? "hourglass.circle.fill" : "arrow.up.circle.fill")
                            .font(.system(size: 28)).foregroundStyle(Theme.gold)
                    }.disabled(isAsking || activeAssistantSessionCount >= researchEvidenceQuestionSessionLimit
                        || cloudAiPolicy?.isEnabled != true || !currentResearchReportReady
                        || question.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                        || question.trimmingCharacters(in: .whitespacesAndNewlines).utf16.count > 1000
                        || AppEnvironment.authToken() == nil || AppEnvironment.writeAuthToken() == nil)
                    .accessibilityLabel("询问助手").accessibilityIdentifier("globalAssistantAsk")
                }
                Text(message).font(.system(size: 10)).foregroundStyle(Theme.textTertiary).lineLimit(3)
            }.padding(14).background(Theme.bgCard)
        }.background(Theme.bgPrimary).tint(Theme.gold).navigationBarTitleDisplayMode(.inline)
    }
}
