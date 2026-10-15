import Foundation

struct TodayReportNavigationResolution {
    let report: TwoLayerReportData
    let confirmation: TodayReportConfirmationReservation?
}

func resolveTodayReportNavigation(
    item: TodayResearchItem,
    target: TodayResearchNavigationTarget,
    report: TodayResearchReportNavigationTarget,
    membership: CandidateMembershipData,
    authorizationRevision: UUID,
    data: FrozenResearchEvidenceWorkspace.DataPayload
) -> TodayReportNavigationResolution? {
    let requiresConfirmation = item.trackingState == .awaitingUserConfirmation
    let confirmation = requiresConfirmation
        ? TodayReportConfirmationReservation(
            item: item,
            membership: membership,
            authorizationRevision: authorizationRevision
        )
        : nil
    guard !requiresConfirmation || confirmation != nil,
          let loadedReport = data.reports.first(where: {
              $0.id == report.id
                  && $0.version == report.version
                  && $0.evidencePackId == report.evidencePackId
          }),
          loadedReport.isCurrentExact,
          loadedReport.reportFingerprint == target.source.sourceFingerprint,
          let latestPack = data.latestPack,
          latestPack.id == report.evidencePackId,
          latestPack.currentness.status == "current",
          !requiresConfirmation || confirmation?.matches(
              report: loadedReport,
              evidencePack: latestPack,
              membership: membership
          ) == true,
          requiresConfirmation
            || [TodayResearchTrackingState.confirmed, .rejected].contains(item.trackingState) else {
        return nil
    }
    return TodayReportNavigationResolution(report: loadedReport, confirmation: confirmation)
}
