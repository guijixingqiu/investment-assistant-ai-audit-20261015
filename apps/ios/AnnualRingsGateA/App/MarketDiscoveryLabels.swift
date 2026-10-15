func noticeLeadEventKindLabel(_ value: String) -> String {
    switch value {
    case "financial_report": "财务报告"
    case "corporate_action": "公司行动"
    case "major_news": "重大新闻"
    default: "公告"
    }
}

func announcementCategory(_ value: OfficialAnnouncementCategory) -> String {
    switch value {
    case .financialReport: "财务报告"
    case .corporateAction: "公司行动"
    case .businessChange: "经营/融资/交易事项"
    case .administrative: "常规披露"
    case .other: "待判断"
    }
}
