import XCTest

final class GateBResearchUITests: XCTestCase {
    @MainActor
    func testF1DSessionDraftAdoptSubmitRefreshesTodayOnce() throws {
        let app = launchApp(
            symbol: "HK.09926",
            initialTab: "today",
            authToken: "f1d-fixture-read-actor-a",
            writeAuthToken: "f1d-fixture-write-actor-a"
        )
        let todayTab = app.tabBars.buttons["今日"]
        XCTAssertTrue(todayTab.waitForExistence(timeout: 10))
        XCTAssertTrue(todayTab.isSelected)
        let todayRoot = app.descendants(matching: .any)["todayRoot"].firstMatch
        XCTAssertTrue(todayRoot.waitForExistence(timeout: 10))
        let openDecision = app.buttons["todayActionInboxOpen-1"].firstMatch
        for _ in 0..<8 where !openDecision.isHittable {
            todayRoot.swipeUp()
        }
        XCTAssertTrue(openDecision.waitForExistence(timeout: 10))
        XCTAssertTrue(openDecision.isHittable)
        XCTAssertEqual(openDecision.label, "去形成正式决定")
        openDecision.tap()

        let researchTab = app.tabBars.buttons["研究"]
        XCTAssertTrue(researchTab.waitForExistence(timeout: 10))
        XCTAssertTrue(researchTab.isSelected)
        let reportWorkspace = app.descendants(matching: .any)["twoLayerReportWorkspace"].firstMatch
        scrollUntilVisible(reportWorkspace, in: app)
        XCTAssertTrue(reportWorkspace.waitForExistence(timeout: 10))
        let reportFailure = app.descendants(matching: .any)["deepResearchFailureMessage"].firstMatch
        if reportFailure.waitForExistence(timeout: 3) {
            XCTFail("current report read failed: \(reportFailure.label)")
            return
        }
        let report = app.descendants(matching: .any)["twoLayerReport-41"].firstMatch
        scrollUntilVisible(report, in: app)
        guard report.waitForExistence(timeout: 20) else {
            let diagnostics = [
                "twoLayerReportMessage", "researchReportFormalDecisionMessage",
                "decisionReviewMessage", "dailyClientContinuityStatus"
            ].map { identifier in
                let element = app.descendants(matching: .any)[identifier].firstMatch
                return "\(identifier)=\(element.exists ? element.label : "missing")"
            }.joined(separator: "; ")
            attachScreenshot(named: "f1d-formal-report-missing", app: app)
            XCTFail("current report did not load after Today formal-decision navigation; \(diagnostics)")
            return
        }
        let adopt = app.buttons["明确采用为正式决定来源"].firstMatch
        scrollUntilHittable(adopt, in: app)
        guard adopt.waitForExistence(timeout: 5) else {
            attachScreenshot(named: "f1d-formal-adoption-missing", app: app)
            XCTFail("formal adoption control is missing after the current report loaded")
            return
        }
        XCTAssertTrue(adopt.isEnabled)
        XCTAssertTrue(adopt.isHittable)
        adopt.tap()

        let reason = app.textFields["决定理由（必填）"].firstMatch
        scrollUntilHittable(reason, in: app)
        XCTAssertTrue(reason.waitForExistence(timeout: 10))
        XCTAssertTrue(reason.isHittable)
        reason.tap()
        reason.typeText("正式决定理由：继续等待当前利润率证据。")
        let keyboard = app.keyboards.firstMatch
        if keyboard.exists {
            app.scrollViews["researchScrollView"].firstMatch.swipeDown()
            XCTAssertTrue(keyboard.waitForNonExistence(timeout: 5))
        }

        let submit = app.buttons["提交报告绑定正式决定"].firstMatch
        scrollUntilHittable(submit, in: app)
        guard submit.isEnabled, submit.isHittable else {
            XCTFail("formal submit did not become reachable after explicit adoption")
            return
        }
        submit.doubleTap()

        XCTAssertTrue(todayTab.waitForExistence(timeout: 15))
        let todaySelected = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "selected == true"),
            object: todayTab
        )
        guard XCTWaiter.wait(for: [todaySelected], timeout: 20) == .completed else {
            let message = app.descendants(matching: .any)["researchReportFormalDecisionMessage"].firstMatch
            let freshTodayTab = app.tabBars.buttons["今日"].firstMatch
            let freshResearchTab = app.tabBars.buttons["研究"].firstMatch
            attachScreenshot(named: "f1d-formal-decision-readback-failed", app: app)
            XCTFail(
                "report-bound formal decision did not return to Today; "
                    + (message.exists ? message.label : "formal decision message missing")
                    + "; todaySelected=\(freshTodayTab.isSelected)"
                    + "; researchSelected=\(freshResearchTab.isSelected)"
                    + "; todayRoot=\(app.descendants(matching: .any)["todayRoot"].firstMatch.exists)"
            )
            return
        }

        let inboxCard = app.descendants(matching: .any)["todayActionInboxCard"].firstMatch
        XCTAssertTrue(inboxCard.waitForExistence(timeout: 15))
        let openReview = app.buttons["todayActionInboxOpen-1"].firstMatch
        for _ in 0..<8 where !openReview.isHittable { todayRoot.swipeUp() }
        XCTAssertTrue(openReview.waitForExistence(timeout: 20))
        XCTAssertEqual(openReview.label, "去完成每日跟踪")
        attachScreenshot(named: "f1d-session-draft-formal-decision", app: app)

        XCTAssertTrue(openReview.isHittable)
        openReview.tap()
        let researchSelected = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "selected == true"),
            object: researchTab
        )
        guard XCTWaiter.wait(for: [researchSelected], timeout: 10) == .completed else {
            attachScreenshot(named: "f1d-inbox-review-navigation-missing", app: app)
            XCTFail("Today inbox review action did not open Research")
            return
        }
        let layerMenu = app.buttons["dailyDecisionLayerToolbarMenu"].firstMatch
        XCTAssertTrue(layerMenu.waitForExistence(timeout: 20))
        XCTAssertEqual(layerMenu.value as? String, "复盘")

        let trackingConditions = app.descendants(matching: .any)["researchDailyTrackingFormalDecisionConditions"].firstMatch
        scrollUntilVisible(trackingConditions, in: app)
        XCTAssertTrue(trackingConditions.waitForExistence(timeout: 10))
        XCTAssertTrue(trackingConditions.label.contains("正式决定理由：继续等待当前利润率证据。"))
        XCTAssertTrue(trackingConditions.label.contains("复核："))

        let reviewEvidence = app.descendants(matching: .any)["researchDailyTrackingReviewEvidenceField"].firstMatch
        scrollUntilHittable(reviewEvidence, in: app)
        guard reviewEvidence.exists else {
            let checkIds = app.staticTexts
                .matching(identifier: "reviewDecisionCheckId")
                .allElementsBoundByIndex
                .map(\.label)
            let selectButtons = app.buttons
                .matching(NSPredicate(format: "identifier BEGINSWITH %@", "selectDecisionReviewCheck-"))
                .allElementsBoundByIndex
                .map(\.identifier)
            let historyMessage = app.staticTexts["decisionReviewMessage"].firstMatch
            let bindingMessage = app.staticTexts["decisionReviewSubmitMessage"].firstMatch
            XCTFail(
                "exact Today review form was not bound; checks=\(checkIds), "
                    + "selectButtons=\(selectButtons), "
                    + "historyMessage=\(historyMessage.exists ? historyMessage.label : "none"), "
                    + "bindingMessage=\(bindingMessage.exists ? bindingMessage.label : "none")"
            )
            return
        }
        replaceText(in: reviewEvidence, with: "人工复核：当前证据仍不足。", app: app)
        dismissDecisionReviewKeyboard(in: app)
        let reviewNote = app.descendants(matching: .any)["researchDailyTrackingReviewNoteField"].firstMatch
        scrollForwardUntilHittable(reviewNote, in: app)
        replaceText(in: reviewNote, with: "人工明确记录，不生成交易。", app: app)
        dismissDecisionReviewKeyboard(in: app)

        let submitReview = app.buttons["submitDailyTrackingReviewButton"].firstMatch
        let outcomePicker = app.descendants(matching: .any)["researchDailyTrackingReviewOutcomePicker"].firstMatch
        scrollForwardUntilHittable(submitReview, in: app)
        XCTAssertTrue(submitReview.waitForExistence(timeout: 10))
        XCTAssertTrue(outcomePicker.waitForExistence(timeout: 10))
        XCTAssertTrue(submitReview.isEnabled)
        submitReview.doubleTap()
        let formLocked = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "enabled == false"),
            object: reviewEvidence
        )
        XCTAssertEqual(XCTWaiter.wait(for: [formLocked], timeout: 5), .completed)
        XCTAssertFalse(outcomePicker.isEnabled, "outcome picker remained editable during review POST")
        XCTAssertFalse(reviewEvidence.isEnabled, "review evidence remained editable during review POST")
        XCTAssertFalse(reviewNote.isEnabled, "review note remained editable during review POST")
        attachScreenshot(named: "f1e-review-form-locked", app: app)

        let resolvedSelected = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "selected == true"),
            object: todayTab
        )
        guard XCTWaiter.wait(for: [resolvedSelected], timeout: 20) == .completed else {
            let submitMessage = app.descendants(matching: .any)["decisionReviewSubmitMessage"].firstMatch
            scrollUntilVisible(submitMessage, in: app)
            let historyMessage = app.descendants(matching: .any)["decisionReviewMessage"].firstMatch
            let unavailable = app.descendants(matching: .any)["researchDailyTrackingReviewUnavailable"].firstMatch
            XCTFail(
                "validated review did not return to Today; "
                    + "submit=\(submitMessage.exists ? submitMessage.label : "missing"); "
                    + "history=\(historyMessage.exists ? historyMessage.label : "missing"); "
                    + "unavailable=\(unavailable.exists ? unavailable.label : "missing")"
            )
            return
        }
        let completed = app.descendants(matching: .any)
            .matching(NSPredicate(format: "label == %@", "已完成 1 项"))
            .firstMatch
        for _ in 0..<8 where !completed.isHittable { todayRoot.swipeUp() }
        XCTAssertTrue(completed.waitForExistence(timeout: 20))
        completed.tap()
        attachScreenshot(named: "f1e-review-resolution-loop", app: app)

        let reopenReview = app.buttons["todayActionInboxOpen-1"].firstMatch
        for _ in 0..<8 where !reopenReview.isHittable { todayRoot.swipeUp() }
        XCTAssertTrue(reopenReview.waitForExistence(timeout: 20))
        XCTAssertTrue(reopenReview.isHittable)
        XCTAssertEqual(reopenReview.label, "查看已保存复盘")
        reopenReview.tap()
        XCTAssertTrue(researchTab.waitForExistence(timeout: 10))
        XCTAssertTrue(researchTab.isSelected)
        let earlierReview = app.descendants(matching: .any)["decisionReviewSource-9100"].firstMatch
        let savedReview = app.descendants(matching: .any)["decisionReviewSource-9101"].firstMatch
        let earlierReviewTarget = app.staticTexts["decisionReviewSourceTarget-9100"].firstMatch
        let savedReviewTarget = app.staticTexts["decisionReviewSourceTarget-9101"].firstMatch
        XCTAssertTrue(savedReview.waitForExistence(timeout: 20))
        XCTAssertTrue(earlierReview.waitForExistence(timeout: 10))
        XCTAssertTrue(savedReviewTarget.isHittable, "resolved Today target did not scroll to exact review 9101")
        XCTAssertFalse(earlierReviewTarget.isHittable, "resolved Today target stopped at earlier review 9100")
        attachScreenshot(named: "f1e-resolved-exact-review-9101", app: app)
    }

    @MainActor
    func testS1ABTodayNeedsEvidencePackFreezesAndReturnsNeedsResearch() throws {
        let app = launchApp(
            symbol: "HK.09926",
            initialTab: "today",
            authToken: "s1ab-read-token",
            writeAuthToken: "s1ab-write-token",
            requestDate: "2026-07-30"
        )
        let todayTab = app.tabBars.buttons["今日"]
        XCTAssertTrue(todayTab.waitForExistence(timeout: 10))
        XCTAssertTrue(todayTab.isSelected)
        let todayResearchContext = app.descendants(matching: .any)["todaySelectedResearchContext"].firstMatch
        XCTAssertTrue(todayResearchContext.waitForExistence(timeout: 20))
        XCTAssertTrue(todayResearchContext.label.contains("HK.00175"))
        XCTAssertTrue(todayResearchContext.label.contains("不以候选数量为门槛"))
        let todayRoot = app.descendants(matching: .any)["todayRoot"].firstMatch
        XCTAssertTrue(todayRoot.waitForExistence(timeout: 10))
        expandTodayResearchHistory(in: app)

        let initialState = app.staticTexts["todayResearchFeedTrackingState-1"].firstMatch
        for _ in 0..<10 where !initialState.isHittable {
            todayRoot.swipeUp()
        }
        XCTAssertTrue(initialState.waitForExistence(timeout: 15))
        expectation(
            for: NSPredicate(format: "label == %@", "待冻结证据"),
            evaluatedWith: initialState
        )
        waitForExpectations(timeout: 20)

        let openResearch = app.buttons["todayResearchFeedOpen-1"].firstMatch
        scrollTodayUntilHittable(openResearch, in: app)
        XCTAssertTrue(openResearch.waitForExistence(timeout: 10))
        XCTAssertTrue(openResearch.isHittable)
        openResearch.tap()

        let researchTab = app.tabBars.buttons["研究"]
        XCTAssertTrue(researchTab.waitForExistence(timeout: 10))
        XCTAssertTrue(researchTab.isSelected)
        let frozenWorkspace = app.descendants(matching: .any)["dailyEvidenceWorkspace-frozen"].firstMatch
        XCTAssertTrue(frozenWorkspace.waitForExistence(timeout: 30))
        let routedToFrozenWorkspace = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "selected == true"),
            object: frozenWorkspace
        )
        XCTAssertEqual(XCTWaiter.wait(for: [routedToFrozenWorkspace], timeout: 60), .completed)
        let runWeinstein = app.buttons["researchRunWeinsteinAnalysisButton"].firstMatch
        scrollUntilHittable(runWeinstein, in: app)
        XCTAssertTrue(runWeinstein.waitForExistence(timeout: 20))
        let runReady = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "enabled == true"),
            object: runWeinstein
        )
        XCTAssertEqual(XCTWaiter.wait(for: [runReady], timeout: 60), .completed)
        runWeinstein.tap()
        let weinsteinMessage = app.staticTexts["researchWeinsteinAnalysisMessage"].firstMatch
        let analysisReady = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "label BEGINSWITH %@", "主分析已完成"),
            object: weinsteinMessage
        )
        XCTAssertEqual(XCTWaiter.wait(for: [analysisReady], timeout: 30), .completed)
        let freezeButton = app.descendants(matching: .any)["freezeResearchEvidenceButton"].firstMatch
        scrollUntilHittable(freezeButton, in: app)
        XCTAssertTrue(freezeButton.waitForExistence(timeout: 20))
        let ownerConfirmation = app.descendants(matching: .any)["frozenResearchOwnerConfirmation"].firstMatch
        scrollUntilHittable(ownerConfirmation, in: app)
        XCTAssertTrue(ownerConfirmation.waitForExistence(timeout: 10))
        let confirmationReady = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "enabled == true"),
            object: ownerConfirmation
        )
        XCTAssertEqual(XCTWaiter.wait(for: [confirmationReady], timeout: 90), .completed)
        XCTAssertFalse(freezeButton.isEnabled, "freeze must remain disabled before explicit Owner confirmation")
        ownerConfirmation.tap()

        let enabled = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "enabled == true"),
            object: freezeButton
        )
        XCTAssertEqual(XCTWaiter.wait(for: [enabled], timeout: 20), .completed)
        XCTAssertTrue(freezeButton.isHittable)
        freezeButton.tap()

        let prepareDeepResearch = app.buttons["prepareDeepResearchButton"].firstMatch
        XCTAssertTrue(prepareDeepResearch.waitForExistence(timeout: 30))
        XCTAssertTrue(prepareDeepResearch.isHittable)
        attachScreenshot(named: "s1ab-today-freeze-return", app: app)

        todayTab.tap()
        let returnedState = app.staticTexts["todayResearchFeedTrackingState-1"].firstMatch
        XCTAssertTrue(returnedState.waitForExistence(timeout: 20))
        expectation(
            for: NSPredicate(format: "label == %@", "待生成报告"),
            evaluatedWith: returnedState
        )
        waitForExpectations(timeout: 20)
    }

    @MainActor
    func testS1ACTodayNeedsResearchSavesReportAndReturnsAwaitingConfirmation() throws {
        let app = launchApp(
            symbol: "HK.09926",
            initialTab: "today",
            authToken: "s1ac-read-token",
            writeAuthToken: "s1ac-write-token"
        )
        let todayTab = app.tabBars.buttons["今日"]
        XCTAssertTrue(todayTab.waitForExistence(timeout: 10))
        XCTAssertTrue(todayTab.isSelected)
        let todayRoot = app.descendants(matching: .any)["todayRoot"].firstMatch
        XCTAssertTrue(todayRoot.waitForExistence(timeout: 10))
        expandTodayResearchHistory(in: app)

        let initialState = app.staticTexts["todayResearchFeedTrackingState-1"].firstMatch
        for _ in 0..<10 where !initialState.isHittable {
            todayRoot.swipeUp()
        }
        XCTAssertTrue(initialState.waitForExistence(timeout: 15))
        expectation(
            for: NSPredicate(format: "label == %@", "待生成报告"),
            evaluatedWith: initialState
        )
        waitForExpectations(timeout: 20)

        let openResearch = app.buttons["todayResearchFeedOpen-1"].firstMatch
        scrollTodayUntilHittable(openResearch, in: app)
        XCTAssertTrue(openResearch.waitForExistence(timeout: 10))
        XCTAssertTrue(openResearch.isHittable)
        openResearch.tap()

        let researchTab = app.tabBars.buttons["研究"]
        XCTAssertTrue(researchTab.waitForExistence(timeout: 10))
        XCTAssertTrue(researchTab.isSelected)
        let prepareDeepResearch = app.buttons["prepareDeepResearchButton"].firstMatch
        scrollForwardUntilHittable(prepareDeepResearch, in: app)
        XCTAssertTrue(prepareDeepResearch.waitForExistence(timeout: 20))
        XCTAssertTrue(prepareDeepResearch.isHittable)
        prepareDeepResearch.tap()

        let providerAuthorization = app.switches["deepResearchProviderAuthorizationToggle"].firstMatch
        scrollForwardUntilHittable(providerAuthorization, in: app)
        XCTAssertTrue(providerAuthorization.waitForExistence(timeout: 20))
        expectation(
            for: NSPredicate(format: "enabled == true"),
            evaluatedWith: providerAuthorization
        )
        waitForExpectations(timeout: 20)
        providerAuthorization.coordinate(
            withNormalizedOffset: CGVector(dx: 0.9, dy: 0.5)
        ).tap()

        let startDeepResearch = app.buttons["saveTwoLayerReportButton"].firstMatch
        scrollForwardUntilHittable(startDeepResearch, in: app)
        XCTAssertTrue(startDeepResearch.waitForExistence(timeout: 20))
        expectation(
            for: NSPredicate(format: "enabled == true"),
            evaluatedWith: startDeepResearch
        )
        waitForExpectations(timeout: 20)
        XCTAssertTrue(startDeepResearch.isHittable)
        startDeepResearch.tap()

        let freshness = app.descendants(matching: .any)["deepResearchTaskFreshness"].firstMatch
        guard freshness.waitForExistence(timeout: 20) else {
            let failure = app.descendants(matching: .any)["deepResearchFailureMessage"].firstMatch
            let message = app.descendants(matching: .any)["twoLayerReportMessage"].firstMatch
            XCTFail(
                failure.exists
                    ? "deep research failed before task refresh: \(failure.label)"
                    : "deep research task did not appear: \(message.exists ? message.label : "no visible status")"
            )
            return
        }
        XCTAssertTrue(freshness.label.contains("任务更新"))

        let absorb = app.buttons["absorbDeepResearchButton"].firstMatch
        scrollUntilHittable(absorb, in: app)
        XCTAssertTrue(absorb.waitForExistence(timeout: 20))
        expectation(
            for: NSPredicate(format: "label == %@", "吸收到研究报告"),
            evaluatedWith: absorb
        )
        waitForExpectations(timeout: 30)
        let readyAbsorb = app.buttons.matching(
            NSPredicate(
                format: "identifier == %@ AND label == %@",
                "absorbDeepResearchButton",
                "吸收到研究报告"
            )
        ).firstMatch
        XCTAssertTrue(readyAbsorb.waitForExistence(timeout: 10))
        XCTAssertTrue(readyAbsorb.isHittable)
        attachScreenshot(named: "s1ac-deep-research-auto-refresh-ready", app: app)
        let absorbStarted = XCTNSPredicateExpectation(
            predicate: NSPredicate(
                format: "enabled == false OR exists == false OR label != %@",
                "吸收到研究报告"
            ),
            object: readyAbsorb
        )
        readyAbsorb.coordinate(
            withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)
        ).tap()
        if XCTWaiter.wait(for: [absorbStarted], timeout: 2) != .completed {
            let retryAbsorb = app.buttons.matching(
                NSPredicate(
                    format: "identifier == %@ AND label == %@",
                    "absorbDeepResearchButton",
                    "吸收到研究报告"
                )
            ).firstMatch
            scrollUntilHittable(retryAbsorb, in: app)
            XCTAssertTrue(retryAbsorb.waitForExistence(timeout: 10))
            XCTAssertTrue(retryAbsorb.isHittable)
            retryAbsorb.tap()
        }

        let returnedToday = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "selected == true"),
            object: todayTab
        )
        guard XCTWaiter.wait(for: [returnedToday], timeout: 30) == .completed else {
            let message = app.descendants(matching: .any)["twoLayerReportMessage"].firstMatch
            XCTFail(
                "saving the report did not return to Today after fresh GET: "
                    + (message.exists ? message.label : "no visible report message")
            )
            return
        }
        let finalState = app.staticTexts["todayResearchFeedTrackingState-1"].firstMatch
        XCTAssertTrue(finalState.waitForExistence(timeout: 20))
        expectation(
            for: NSPredicate(format: "label == %@", "待你确认"),
            evaluatedWith: finalState
        )
        waitForExpectations(timeout: 20)
        let sourceDetails = app.buttons["来源详情"].firstMatch
        scrollTodayUntilHittable(sourceDetails, in: app)
        let expanded = sourceDetails.images["expanded"].firstMatch
        if !expanded.exists {
            sourceDetails.tap()
            XCTAssertTrue(expanded.waitForExistence(timeout: 5))
        }
        let reportRef = app.staticTexts["todayResearchFeedReport-1"].firstMatch
        XCTAssertTrue(reportRef.waitForExistence(timeout: 15))
        XCTAssertTrue(reportRef.label.contains("报告 #41 v1"))
        XCTAssertTrue(reportRef.label.contains("证据包 #31"))
        attachScreenshot(named: "s1ac-today-report-save-return", app: app)
    }

    @MainActor
    func testS1ADTodayConfirmReportReturnsFormalDecisionDue() throws {
        let app = launchApp(
            symbol: "HK.09926",
            initialTab: "today",
            authToken: "s1ad-read-token",
            writeAuthToken: "s1ad-write-token"
        )
        let todayTab = app.tabBars.buttons["今日"]
        XCTAssertTrue(todayTab.waitForExistence(timeout: 10))
        XCTAssertTrue(todayTab.isSelected)
        let todayRoot = app.descendants(matching: .any)["todayRoot"].firstMatch
        XCTAssertTrue(todayRoot.waitForExistence(timeout: 10))
        expandTodayResearchHistory(in: app)

        let initialState = app.staticTexts["todayResearchFeedTrackingState-1"].firstMatch
        for _ in 0..<10 where !initialState.isHittable {
            todayRoot.swipeUp()
        }
        XCTAssertTrue(initialState.waitForExistence(timeout: 15))
        expectation(
            for: NSPredicate(format: "label == %@", "待你确认"),
            evaluatedWith: initialState
        )
        waitForExpectations(timeout: 20)

        let openResearch = app.buttons["todayResearchFeedOpen-1"].firstMatch
        scrollTodayUntilHittable(openResearch, in: app)
        XCTAssertTrue(openResearch.waitForExistence(timeout: 10))
        XCTAssertTrue(openResearch.isHittable)
        openResearch.tap()

        let researchTab = app.tabBars.buttons["研究"]
        XCTAssertTrue(researchTab.waitForExistence(timeout: 10))
        XCTAssertTrue(researchTab.isSelected)
        let confirm = app.descendants(matching: .any)
            .matching(NSPredicate(format: "label == %@", "确认报告并返回今日"))
            .firstMatch
        guard confirm.waitForExistence(timeout: 20) else {
            attachScreenshot(named: "s1ad-report-confirmation-missing", app: app)
            XCTFail("Today did not expose the exact report confirmation card")
            return
        }
        XCTAssertTrue(confirm.isHittable)
        XCTAssertTrue(confirm.label.contains("返回今日"))
        confirm.tap()

        let returnedToday = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "selected == true"),
            object: todayTab
        )
        guard XCTWaiter.wait(for: [returnedToday], timeout: 30) == .completed else {
            XCTFail("explicit report confirmation did not return to Today")
            return
        }
        let confirmedState = app.staticTexts["todayResearchFeedTrackingState-1"].firstMatch
        XCTAssertTrue(confirmedState.waitForExistence(timeout: 20))
        expectation(
            for: NSPredicate(format: "label == %@", "已确认"),
            evaluatedWith: confirmedState
        )
        waitForExpectations(timeout: 20)

        let inboxCard = app.descendants(matching: .any)["todayActionInboxCard"].firstMatch
        XCTAssertTrue(inboxCard.waitForExistence(timeout: 20))
        let sourceDisclosure = app.descendants(matching: .any)
            .matching(NSPredicate(format: "label == %@", "来源与状态"))
            .firstMatch
        for _ in 0..<10 where !sourceDisclosure.isHittable {
            todayRoot.swipeUp()
        }
        XCTAssertTrue(sourceDisclosure.waitForExistence(timeout: 20))
        sourceDisclosure.tap()
        let inboxIdentity = app.descendants(matching: .any)["todayActionInboxIdentity-1"].firstMatch
        XCTAssertTrue(inboxIdentity.waitForExistence(timeout: 20))
        XCTAssertTrue(inboxIdentity.label.contains("决定"))
        XCTAssertTrue(inboxIdentity.label.contains("待你处理"))
        let inboxSummary = app.descendants(matching: .any)["todayActionInboxSource-1"].firstMatch
        XCTAssertTrue(inboxSummary.waitForExistence(timeout: 10))
        XCTAssertTrue(inboxSummary.label.contains("正式决定与复盘"))
        let effects = app.descendants(matching: .any)["todayResearchFeedNoEffects"].firstMatch
        XCTAssertTrue(effects.waitForExistence(timeout: 10))
        XCTAssertTrue(effects.label.contains("不自动形成建议、正式决定、订单、交易"))
        attachScreenshot(named: "s1ad-today-report-confirmation-return", app: app)
    }

    @MainActor
    func testF1CTodayReviewDueOpensExactResearchReviewLayer() throws {
        let app = launchApp(
            symbol: "HK.00700",
            initialTab: "today",
            authToken: "today-review-due-read-token"
        )
        let todayTab = app.tabBars.buttons["今日"]
        XCTAssertTrue(todayTab.waitForExistence(timeout: 10))
        XCTAssertTrue(todayTab.isSelected)

        let todayRoot = app.descendants(matching: .any)["todayRoot"].firstMatch
        let card = app.descendants(matching: .any)["todayActionInboxCard"].firstMatch
        XCTAssertTrue(card.waitForExistence(timeout: 10))
        let fixtureBoundary = app.staticTexts["todayActionInboxFixtureBoundary"].firstMatch
        XCTAssertTrue(fixtureBoundary.waitForExistence(timeout: 10))
        XCTAssertTrue(fixtureBoundary.label.contains("测试样本 / 非真实行动"))
        let sourceDisclosure = app.staticTexts
            .matching(NSPredicate(format: "label == %@", "来源与状态"))
            .firstMatch
        for _ in 0..<8 where !sourceDisclosure.isHittable {
            todayRoot.swipeUp()
        }
        XCTAssertTrue(sourceDisclosure.waitForExistence(timeout: 10))
        sourceDisclosure.tap()
        let inboxIdentity = app.descendants(matching: .any)["todayActionInboxIdentity-1"].firstMatch
        XCTAssertTrue(inboxIdentity.waitForExistence(timeout: 10))
        XCTAssertTrue(inboxIdentity.label.contains("HK.00700"))
        XCTAssertTrue(inboxIdentity.label.contains("复盘"))
        XCTAssertTrue(inboxIdentity.label.contains("待你处理"))
        let inboxSource = app.descendants(matching: .any)["todayActionInboxSource-1"].firstMatch
        XCTAssertTrue(inboxSource.waitForExistence(timeout: 10))
        XCTAssertTrue(inboxSource.label.contains("正式决定与复盘"))
        XCTAssertTrue(inboxSource.label.contains("截止"))

        let openReview = app.buttons["todayActionInboxOpen-1"].firstMatch
        for _ in 0..<8 where !openReview.isHittable {
            todayRoot.swipeUp()
        }
        XCTAssertTrue(openReview.waitForExistence(timeout: 10))
        XCTAssertTrue(openReview.isHittable)
        openReview.tap()

        let researchTab = app.tabBars.buttons["研究"]
        XCTAssertTrue(researchTab.waitForExistence(timeout: 10))
        XCTAssertTrue(researchTab.isSelected)
        let layerMenu = app.buttons["dailyDecisionLayerToolbarMenu"].firstMatch
        XCTAssertTrue(layerMenu.waitForExistence(timeout: 20))
        XCTAssertEqual(layerMenu.value as? String, "复盘")
    }

    @MainActor
    func testGlobalSearchSelectsExactLocalFallbackAndOpensMarket() throws {
        let app = launchApp(
            symbol: "HK.00700",
            initialTab: "today",
            authToken: "global-search-read-token"
        )
        let search = app.buttons["globalHongKongSearch"].firstMatch
        XCTAssertTrue(search.waitForExistence(timeout: 10))
        search.tap()

        let input = app.textFields["globalSearchInput"].firstMatch
        XCTAssertTrue(input.waitForExistence(timeout: 10))
        input.tap()
        input.typeText("00175")
        app.buttons["globalKnownStockSearch"].firstMatch.tap()

        let result = app.buttons.matching(
            NSPredicate(format: "label CONTAINS %@", "HK.00175")
        ).firstMatch
        XCTAssertTrue(result.waitForExistence(timeout: 10))
        let fallback = app.staticTexts.matching(
            NSPredicate(format: "label CONTAINS %@", "本地数据库已收录")
        ).firstMatch
        XCTAssertTrue(fallback.waitForExistence(timeout: 5))
        result.tap()

        app.buttons["到市场查看并选择是否加入研究自选"].firstMatch.tap()
        let marketTab = app.tabBars.buttons["市场"]
        XCTAssertTrue(marketTab.waitForExistence(timeout: 10))
        XCTAssertTrue(marketTab.isSelected)
        let dailySymbol = app.descendants(matching: .any)["marketDailySymbol"].firstMatch
        XCTAssertTrue(dailySymbol.waitForExistence(timeout: 10))
        XCTAssertEqual(dailySymbol.label, "HK.00175")
        XCTAssertTrue(app.staticTexts["marketResearchAdmissionIssue"].firstMatch.waitForExistence(timeout: 10))
        let nextStep = app.buttons["marketResearchNextStepButton"].firstMatch
        XCTAssertTrue(nextStep.waitForExistence(timeout: 10))
        XCTAssertFalse(nextStep.isEnabled)
    }

    @MainActor
    func testFLA35FreshOpenDSearchMarketToExactResearchAcceptance() throws {
        let environment = ProcessInfo.processInfo.environment
        guard environment["FLA35_IOS_LIVE_ACCEPTANCE"] == "1" else {
            throw XCTSkip("FLA-35 live API acceptance is explicitly gated.")
        }
        let baseURL = try XCTUnwrap(environment["ANNUAL_RINGS_GATE_A_BASE_URL"])
        let readToken = try XCTUnwrap(environment["ANNUAL_RINGS_UI_AUTH_TOKEN"])
        let expectedMembershipId = try XCTUnwrap(environment["FLA35_EXPECTED_MEMBERSHIP_ID"])
        let expectedMembershipVersion = try XCTUnwrap(environment["FLA35_EXPECTED_MEMBERSHIP_VERSION"])
        let expectedSymbol = try XCTUnwrap(environment["FLA35_EXPECTED_SYMBOL"])
        let initialSymbol = expectedSymbol == "HK.00175" ? "HK.00700" : "HK.00175"
        XCTAssertFalse(baseURL.isEmpty)
        XCTAssertFalse(readToken.isEmpty)
        XCTAssertFalse(expectedMembershipId.isEmpty)
        XCTAssertFalse(expectedMembershipVersion.isEmpty)
        XCTAssertTrue(expectedSymbol.range(of: #"^HK\.\d{5}$"#, options: .regularExpression) != nil, "FLA35 expected symbol")
        let parsedBaseURL = try XCTUnwrap(URL(string: baseURL))
        let baseURLHost = try XCTUnwrap(parsedBaseURL.host?.lowercased())
        guard parsedBaseURL.scheme?.lowercased() == "http",
              parsedBaseURL.user == nil,
              parsedBaseURL.password == nil,
              parsedBaseURL.query == nil,
              parsedBaseURL.fragment == nil,
              ["127.0.0.1", "localhost", "::1", "[::1]"].contains(baseURLHost) else {
            XCTFail("FLA-35 live acceptance must use a credential-free task-owned loopback HTTP API forward.")
            return
        }

        let app = launchApp(symbol: initialSymbol, initialTab: "today", authToken: readToken)
        let search = app.buttons["globalHongKongSearch"].firstMatch
        XCTAssertTrue(search.waitForExistence(timeout: 20), "FLA35 global search")
        search.tap()

        let input = app.textFields["globalSearchInput"].firstMatch
        XCTAssertTrue(input.waitForExistence(timeout: 10), "FLA35 search input")
        input.tap()
        input.typeText(expectedSymbol)
        app.buttons["globalKnownStockSearch"].firstMatch.tap()

        let liveSearchMessage = app.staticTexts.matching(
            NSPredicate(
                format: "label == %@",
                "已读取 Futu/OpenD 港股基础资料；结果只用于标的识别，不是推荐或排名。"
            )
        ).firstMatch
        XCTAssertTrue(liveSearchMessage.waitForExistence(timeout: 30), "search did not prove the futu_opend envelope")
        XCTAssertFalse(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "本地数据库已收录")).firstMatch.exists)
        let result = app.buttons["globalSearchResult-\(expectedSymbol)"].firstMatch
        XCTAssertTrue(result.waitForExistence(timeout: 10), "search did not return the exact \(expectedSymbol) identity")
        result.tap()

        let openMarket = app.buttons["到市场查看并选择是否加入研究自选"].firstMatch
        XCTAssertTrue(openMarket.waitForExistence(timeout: 10), "FLA35 open market")
        openMarket.tap()

        let marketTab = app.tabBars.buttons["市场"].firstMatch
        XCTAssertTrue(marketTab.waitForExistence(timeout: 10), "FLA35 market tab")
        expectation(for: NSPredicate(format: "selected == true"), evaluatedWith: marketTab)
        waitForExpectations(timeout: 10)

        let quoteStatus = app.staticTexts["marketQuoteStatus"].firstMatch
        expectation(
            for: NSPredicate(format: "label == %@ OR label == %@", "实时", "最后观测 · 非实时"),
            evaluatedWith: quoteStatus
        )
        waitForExpectations(timeout: 30)
        let quoteSource = app.staticTexts["marketQuoteSource"].firstMatch
        XCTAssertTrue(quoteSource.waitForExistence(timeout: 10), "FLA35 quote source visible")
        XCTAssertTrue(quoteSource.label.contains("Futu 行情（只读）"), "FLA35 quote source")

        let dailySymbol = app.descendants(matching: .any)["marketDailySymbol"].firstMatch
        if !dailySymbol.exists {
            let marketFacts = app.descendants(matching: .any)["marketFactsDisclosure"].firstMatch
            scrollMarketControlUntilHittable(marketFacts, in: app)
            XCTAssertTrue(marketFacts.waitForExistence(timeout: 5), "FLA35 market facts disclosure")
            XCTAssertTrue(marketFacts.isHittable, "FLA35 market facts disclosure hittable")
            marketFacts.tap()
        }
        XCTAssertTrue(dailySymbol.waitForExistence(timeout: 30), "FLA35 daily symbol visible")
        XCTAssertEqual(dailySymbol.label, expectedSymbol)
        let dailyStatus = app.staticTexts["marketDailyStatus"].firstMatch
        expectation(for: NSPredicate(format: "label BEGINSWITH %@", "截至 "), evaluatedWith: dailyStatus)
        waitForExpectations(timeout: 30)
        XCTAssertTrue(app.descendants(matching: .any)["marketDailyTrend"].firstMatch.exists, "FLA35 daily trend")
        XCTAssertFalse(app.staticTexts["marketDailyFixtureWarning"].firstMatch.exists)

        let environmentSource = app.descendants(matching: .any)["marketEnvironmentSourceHeader"].firstMatch
        XCTAssertTrue(environmentSource.waitForExistence(timeout: 30), "market environment was not available")
        XCTAssertTrue(environmentSource.label.contains("Futu 行情（只读）"), "FLA35 environment source")
        if quoteStatus.label == "最后观测 · 非实时" {
            XCTAssertTrue(
                environmentSource.label.contains("港股已收市") || environmentSource.label.contains("港股盘前"),
                "FLA35 non-live market environment"
            )
        }

        let nextStep = app.buttons["marketResearchNextStepButton"].firstMatch
        let existingMembershipReady = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "enabled == true AND label == %@", "打开研究"),
            object: nextStep
        )
        XCTAssertEqual(XCTWaiter.wait(for: [existingMembershipReady], timeout: 30), .completed)
        XCTAssertFalse(app.staticTexts["marketResearchAdmissionIssue"].firstMatch.exists)
        scrollMarketControlUntilHittable(nextStep, in: app)
        XCTAssertTrue(nextStep.isHittable, "FLA35 research next step hittable")
        nextStep.tap()

        let researchTab = app.tabBars.buttons["研究"].firstMatch
        XCTAssertTrue(researchTab.waitForExistence(timeout: 10), "FLA35 research tab")
        expectation(for: NSPredicate(format: "selected == true"), evaluatedWith: researchTab)
        waitForExpectations(timeout: 20)
        let selectedSymbol = app.descendants(matching: .any)["annualDecisionRings"].firstMatch
        XCTAssertTrue(selectedSymbol.waitForExistence(timeout: 30), "FLA35 selected symbol visible")
        XCTAssertTrue((selectedSymbol.value as? String)?.contains(expectedSymbol) == true)
        let researchProgress = app.buttons["研究进度"].firstMatch
        scrollUntilHittable(researchProgress, in: app)
        XCTAssertTrue(researchProgress.waitForExistence(timeout: 10), "FLA35 research progress disclosure")
        researchProgress.tap()
        let continuity = app.staticTexts["dailyContinuityMessage"].firstMatch
        XCTAssertTrue(continuity.waitForExistence(timeout: 10), "FLA35 Research continuity visible")
        let freshReadComplete = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "label BEGINSWITH %@", "本轮"),
            object: continuity
        )
        XCTAssertEqual(XCTWaiter.wait(for: [freshReadComplete], timeout: 90), .completed)

        expandDisclosure(
            identifier: "annualDecisionBriefIdentityDisclosure",
            label: "事实来源与身份",
            in: app
        )
        let identity = app.descendants(matching: .any)["annualDecisionBriefIdentitySummary"].firstMatch
        XCTAssertTrue(identity.waitForExistence(timeout: 10), "FLA35 research identity visible")
        XCTAssertTrue(identity.label.contains("symbol=\(expectedSymbol);"), "FLA35 research symbol identity")
        XCTAssertTrue(identity.label.contains("membership=\(expectedMembershipId);"), "FLA35 research membership identity")
        XCTAssertTrue(identity.label.contains("version=\(expectedMembershipVersion);"), "FLA35 research membership version")

        if environment["HK_CONNECT_MULTI_STOCK_COMPARISON"] == "1" {
            let comparedSymbol = try XCTUnwrap(environment["HK_CONNECT_COMPARE_SYMBOL"])
            let comparedMembershipId = try XCTUnwrap(environment["HK_CONNECT_COMPARE_MEMBERSHIP_ID"])
            let comparedMembershipVersion = try XCTUnwrap(environment["HK_CONNECT_COMPARE_MEMBERSHIP_VERSION"])
            XCTAssertNotEqual(comparedSymbol, expectedSymbol)

            openEvidenceWorkspace("brief", in: app)
            let comparison = app.descendants(matching: .any)["crossStockReportComparison"].firstMatch
            scrollUntilHittable(comparison, in: app)
            XCTAssertTrue(comparison.waitForExistence(timeout: 20), "FLA35 comparison control")
            comparison.tap()

            let membershipPicker = app.buttons["crossStockMembershipPicker"].firstMatch
            scrollUntilHittable(membershipPicker, in: app)
            XCTAssertTrue(membershipPicker.waitForExistence(timeout: 10), "FLA35 comparison membership picker")
            membershipPicker.tap()
            let comparedMembership = app.buttons.matching(
                NSPredicate(format: "label CONTAINS %@", comparedSymbol)
            ).firstMatch
            XCTAssertTrue(comparedMembership.waitForExistence(timeout: 10), "FLA35 compared membership option")
            comparedMembership.tap()

            let loadCompared = app.buttons["loadComparedStockReportsButton"].firstMatch
            scrollUntilHittable(loadCompared, in: app)
            XCTAssertTrue(loadCompared.isEnabled, "FLA35 comparison load enabled")
            loadCompared.tap()

            let currentReportIdentity = app.staticTexts["crossStockCurrentReportIdentity"].firstMatch
            let comparedReportIdentity = app.staticTexts["crossStockComparedReportIdentity"].firstMatch
            XCTAssertTrue(currentReportIdentity.waitForExistence(timeout: 30), "FLA35 current report identity visible")
            XCTAssertTrue(comparedReportIdentity.waitForExistence(timeout: 30), "FLA35 compared report identity visible")
            XCTAssertTrue(currentReportIdentity.label.contains(expectedSymbol), "FLA35 current report symbol")
            XCTAssertTrue(comparedReportIdentity.label.contains(comparedSymbol), "FLA35 compared report symbol")
            for identity in [currentReportIdentity, comparedReportIdentity] {
                XCTAssertTrue(identity.label.contains("reportFingerprint="), "FLA35 report fingerprint")
                XCTAssertTrue(identity.label.contains("cutoff="), "FLA35 report cutoff")
                XCTAssertTrue(identity.label.contains("packFingerprint="), "FLA35 pack fingerprint")
            }
            XCTAssertTrue(app.descendants(matching: .any)["crossStockCurrentSourceLink"].firstMatch.waitForExistence(timeout: 10), "FLA35 current source link")
            XCTAssertTrue(app.descendants(matching: .any)["crossStockComparedSourceLink"].firstMatch.waitForExistence(timeout: 10), "FLA35 compared source link")

            app.buttons["globalHongKongSearch"].firstMatch.tap()
            let comparisonSearch = app.textFields["globalSearchInput"].firstMatch
            XCTAssertTrue(comparisonSearch.waitForExistence(timeout: 10), "FLA35 comparison switch search")
            comparisonSearch.tap()
            comparisonSearch.typeText(comparedSymbol)
            app.buttons["globalKnownStockSearch"].firstMatch.tap()
            let comparedResult = app.buttons["globalSearchResult-\(comparedSymbol)"].firstMatch
            XCTAssertTrue(comparedResult.waitForExistence(timeout: 30), "FLA35 comparison switch result")
            comparedResult.tap()
            app.buttons["到市场查看并选择是否加入研究自选"].firstMatch.tap()

            let compareNextStep = app.buttons["marketResearchNextStepButton"].firstMatch
            let comparedMembershipReady = XCTNSPredicateExpectation(
                predicate: NSPredicate(format: "enabled == true AND label == %@", "打开研究"),
                object: compareNextStep
            )
            XCTAssertEqual(XCTWaiter.wait(for: [comparedMembershipReady], timeout: 30), .completed)
            scrollMarketControlUntilHittable(compareNextStep, in: app)
            XCTAssertTrue(compareNextStep.isHittable, "FLA35 compared research next step hittable")
            compareNextStep.tap()
            let switchedResearchTab = app.tabBars.buttons["研究"].firstMatch
            expectation(for: NSPredicate(format: "selected == true"), evaluatedWith: switchedResearchTab)
            waitForExpectations(timeout: 30)
            let switchedSymbol = app.descendants(matching: .any)["annualDecisionRings"].firstMatch
            XCTAssertTrue(switchedSymbol.waitForExistence(timeout: 30), "FLA35 switched symbol visible")
            XCTAssertTrue((switchedSymbol.value as? String)?.contains(comparedSymbol) == true)
            XCTAssertTrue(comparedMembershipId.range(of: #"^[1-9]\d*$"#, options: .regularExpression) != nil, "FLA35 compared membership id")
            XCTAssertTrue(comparedMembershipVersion.range(of: #"^[1-9]\d*$"#, options: .regularExpression) != nil, "FLA35 compared membership version")
            XCTAssertTrue(comparedReportIdentity.waitForNonExistence(timeout: 10), "FLA35 stale comparison cleared")

            openReviewWorkspace("timeline", in: app)
            let decisionHistory = app.descendants(matching: .any)["crossStockDecisionHistory"].firstMatch
            scrollUntilHittable(decisionHistory, in: app)
            XCTAssertTrue(decisionHistory.waitForExistence(timeout: 10), "FLA35 cross-stock decision history")
            decisionHistory.tap()
            let historyPicker = app.buttons["crossStockDecisionHistoryMembershipPicker"].firstMatch
            scrollUntilHittable(historyPicker, in: app)
            XCTAssertTrue(historyPicker.waitForExistence(timeout: 10), "FLA35 decision history membership picker")
            historyPicker.tap()
            let historyMembership = app.buttons.matching(
                NSPredicate(format: "label CONTAINS %@", expectedSymbol)
            ).firstMatch
            XCTAssertTrue(historyMembership.waitForExistence(timeout: 10), "FLA35 decision history membership option")
            historyMembership.tap()
            let loadHistory = app.buttons["loadCrossStockDecisionHistoryButton"].firstMatch
            scrollUntilHittable(loadHistory, in: app)
            XCTAssertTrue(loadHistory.isEnabled, "FLA35 decision history load enabled")
            loadHistory.tap()
            let historyIdentity = app.staticTexts["crossStockDecisionHistoryIdentity"].firstMatch
            XCTAssertTrue(historyIdentity.waitForExistence(timeout: 30), "FLA35 decision history identity")
            XCTAssertTrue(historyIdentity.label.contains(expectedSymbol), "FLA35 decision history symbol")
            let historyCheck = app.descendants(matching: .any).matching(
                NSPredicate(format: "identifier BEGINSWITH %@", "crossStockDecisionHistoryCheck-")
            ).firstMatch
            XCTAssertTrue(historyCheck.waitForExistence(timeout: 10), "FLA35 preserved formal decision history")
            let continueHistory = app.buttons["openCrossStockDecisionHistory-\(expectedSymbol)"].firstMatch
            scrollUntilHittable(continueHistory, in: app)
            XCTAssertTrue(continueHistory.isHittable, "FLA35 decision history continuation")
            continueHistory.tap()
            let returnedSymbol = app.descendants(matching: .any)["annualDecisionRings"].firstMatch
            let returnedSymbolReady = XCTNSPredicateExpectation(
                predicate: NSPredicate(format: "value CONTAINS %@", expectedSymbol),
                object: returnedSymbol
            )
            XCTAssertEqual(XCTWaiter.wait(for: [returnedSymbolReady], timeout: 30), .completed)
            XCTAssertTrue(historyIdentity.waitForNonExistence(timeout: 10), "FLA35 stale decision history cleared")
        }

        if environment["HK_CONNECT_QUANT_PORTFOLIO"] == "1" {
            app.buttons["globalHongKongSearch"].firstMatch.tap()
            let portfolioSearch = app.textFields["globalSearchInput"].firstMatch
            XCTAssertTrue(portfolioSearch.waitForExistence(timeout: 10), "FLA35 portfolio switch search")
            portfolioSearch.tap()
            portfolioSearch.typeText(expectedSymbol)
            app.buttons["globalKnownStockSearch"].firstMatch.tap()
            let portfolioResult = app.buttons["globalSearchResult-\(expectedSymbol)"].firstMatch
            XCTAssertTrue(portfolioResult.waitForExistence(timeout: 30), "FLA35 portfolio switch result")
            portfolioResult.tap()
            app.buttons["打开已有研究"].firstMatch.tap()
            let portfolioSymbol = app.descendants(matching: .any)["annualDecisionRings"].firstMatch
            let portfolioSymbolReady = XCTNSPredicateExpectation(
                predicate: NSPredicate(format: "value CONTAINS %@", expectedSymbol),
                object: portfolioSymbol
            )
            XCTAssertEqual(XCTWaiter.wait(for: [portfolioSymbolReady], timeout: 30), .completed)

            openPortfolioWorkspace("current", in: app)
            let refreshPortfolio = app.buttons["refreshPortfolioDecisionButton"].firstMatch
            XCTAssertTrue(refreshPortfolio.waitForExistence(timeout: 10), "FLA35 portfolio refresh")
            expectation(for: NSPredicate(format: "enabled == true"), evaluatedWith: refreshPortfolio)
            waitForExpectations(timeout: 30)
            refreshPortfolio.tap()
            let currentPortfolioStatus = app.staticTexts["portfolioDecisionStatus"].firstMatch
            expectation(for: NSPredicate(format: "label IN %@", ["available", "stale"]), evaluatedWith: currentPortfolioStatus)
            waitForExpectations(timeout: 30)

            openPortfolioWorkspace("lab", in: app)
            let amountInput = app.textFields["annualPortfolioLabAmountsInput"].firstMatch
            XCTAssertTrue(amountInput.waitForExistence(timeout: 10), "FLA35 portfolio lab input")
            scrollUntilHittable(amountInput, in: app)
            replaceText(in: amountInput, with: "25000,5000", app: app)
            let keyboardDone = app.buttons["annualPortfolioLabKeyboardDone"].firstMatch
            if keyboardDone.waitForExistence(timeout: 3) { keyboardDone.tap() }
            let run = findButton(in: app, identifier: "annualPortfolioLabRunButton", label: "并列比较用户情景")
            scrollUntilHittable(run, in: app)
            expectation(for: NSPredicate(format: "enabled == true"), evaluatedWith: run)
            waitForExpectations(timeout: 30)
            run.tap()
            let status = app.staticTexts["annualPortfolioLabStatus"].firstMatch
            expectation(for: NSPredicate(format: "label == %@", "available"), evaluatedWith: status)
            waitForExpectations(timeout: 30)
            let universe = app.descendants(matching: .any)["annualPortfolioLabHkConnectUniverse"].firstMatch
            scrollUntilHittable(universe, in: app)
            XCTAssertTrue(universe.label.contains("2026-08-14 · 620 只"), "FLA35 official HK Connect universe")
            let coverage = app.descendants(matching: .any)["annualPortfolioLabQuantCoverage"].firstMatch
            scrollUntilHittable(coverage, in: app)
            XCTAssertTrue(coverage.label.contains("exact"), "FLA35 exact two-stock quant coverage")
            XCTAssertTrue(coverage.label.contains("HK.00175, HK.00700"), "FLA35 two-stock symbols")
        }
    }

    @MainActor
    func testF1BFourTabsKeepGlobalToolsReachableAndRingsReadOnly() throws {
        let app = launchApp(symbol: "HK.00700", initialTab: "today")
        let todayTab = app.tabBars.buttons["今日"]
        XCTAssertTrue(todayTab.waitForExistence(timeout: 10), "今日 tab is missing")
        XCTAssertTrue(todayTab.isSelected, "normal F1B launch did not begin on Today")
        assertGlobalTools(in: app)

        let marketTab = app.tabBars.buttons["市场"]
        XCTAssertTrue(marketTab.waitForExistence(timeout: 10), "市场 tab is missing")
        marketTab.tap()
        assertGlobalTools(in: app)
        let quoteStatus = app.staticTexts["marketQuoteStatus"].firstMatch
        XCTAssertTrue(quoteStatus.waitForExistence(timeout: 10))
        XCTAssertEqual(quoteStatus.label, "测试样本 / 非真实行情")
        let marketScroll = app.scrollViews["marketScrollView"].firstMatch
        XCTAssertTrue(marketScroll.waitForExistence(timeout: 5))
        let dailyStatus = app.descendants(matching: .any)["marketDailyStatus"].firstMatch
        for _ in 0..<4 where !dailyStatus.exists {
            marketScroll.swipeUp()
        }
        XCTAssertTrue(dailyStatus.waitForExistence(timeout: 10))
        expectation(
            for: NSPredicate(format: "label == %@", "暂不可用"),
            evaluatedWith: dailyStatus
        )
        waitForExpectations(timeout: 10)
        let dailyDetails = app.buttons["查看原因与截止信息"].firstMatch
        scrollUntilHittable(dailyDetails, in: app)
        dailyDetails.tap()
        let dailyUnavailable = app.descendants(matching: .any)["marketDailyUnavailableMessage"].firstMatch
        for _ in 0..<4 where !dailyUnavailable.exists {
            marketScroll.swipeUp()
        }
        XCTAssertTrue(dailyUnavailable.waitForExistence(timeout: 10))
        XCTAssertTrue(dailyUnavailable.label.contains("UNKNOWN"))

        let researchTab = app.tabBars.buttons["研究"]
        XCTAssertTrue(researchTab.waitForExistence(timeout: 10), "研究 tab is missing")
        researchTab.tap()
        assertGlobalTools(in: app)
        XCTAssertTrue(app.buttons["dailyEvidenceWorkspace-brief"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.descendants(matching: .any)["twoLayerReportWorkspace"].waitForExistence(timeout: 10))
        for layer in ["candidate", "evidence", "portfolio", "decision", "review"] {
            let ringButton = app.buttons["decisionRingLayer-\(layer)"].firstMatch
            XCTAssertTrue(ringButton.waitForExistence(timeout: 5), "\(layer) ring button is missing")
            ringButton.tap()
        }

        let assetsTab = app.tabBars.buttons["资产"]
        XCTAssertTrue(assetsTab.waitForExistence(timeout: 10), "资产 tab is missing")
        assetsTab.tap()
        assertGlobalTools(in: app)
        let assetsRoot = app.descendants(matching: .any)["assetsRoot"].firstMatch
        XCTAssertTrue(assetsRoot.waitForExistence(timeout: 5))
        let manualSnapshot = app.descendants(matching: .any)["assetsManualSnapshotBoundary"].firstMatch
        for _ in 0..<6 where !manualSnapshot.exists {
            assetsRoot.swipeUp()
        }
        XCTAssertTrue(manualSnapshot.waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["assetsSaveLocalDraft"].exists)
        XCTAssertFalse(app.descendants(matching: .any)["assetsLocalTradeBoundary"].exists)

        todayTab.tap()
        let todayRoot = app.descendants(matching: .any)["todayRoot"].firstMatch
        let currentCandidate = app.staticTexts["todayCurrentCandidate"].firstMatch
        let readOnlyCenter = app.descendants(matching: .any)["decisionRingSelectedLayer"].firstMatch
        XCTAssertTrue(todayRoot.waitForExistence(timeout: 10))
        expandTodayResearchHistory(in: app)
        XCTAssertTrue(app.descendants(matching: .any)["todayStatusRingsOverview"].waitForExistence(timeout: 10))
        XCTAssertTrue(currentCandidate.waitForExistence(timeout: 5))
        XCTAssertTrue(readOnlyCenter.waitForExistence(timeout: 5))
        XCTAssertTrue(todayTab.isSelected)

        let layers = ["candidate", "evidence", "portfolio", "decision", "review"]
        for layer in layers {
            let identifier = "decisionRingLayer-\(layer)"
            let node = app.descendants(matching: .any)[identifier].firstMatch
            XCTAssertTrue(node.waitForExistence(timeout: 5))
            XCTAssertFalse(app.buttons[identifier].exists)
        }
        XCTAssertTrue(todayRoot.exists)
        XCTAssertTrue(todayTab.isSelected)
        XCTAssertFalse(app.buttons["dailyDecisionLayerToolbarMenu"].exists)
    }

    @MainActor
    func testV4RealHK00175PersonalInvestmentMemoryTimeline() throws {
        let environment = ProcessInfo.processInfo.environment
        guard let token = environment["ANNUAL_RINGS_UI_AUTH_TOKEN"], !token.isEmpty,
              environment["ANNUAL_RINGS_GATE_A_BASE_URL"] != nil else {
            throw XCTSkip("V4 personal memory requires an explicit local API URL and short-lived read token")
        }
        let app = launchApp(symbol: "HK.00175", initialTab: "research", authToken: token)
        let title = app.descendants(matching: .any)["personalInvestmentMemoryTitle"].firstMatch
        XCTAssertTrue(title.waitForExistence(timeout: 30))
        scrollUntilVisible(title, in: app)
        XCTAssertEqual(title.label, "个人投资记忆")
        XCTAssertTrue(app.descendants(matching: .any)["researchOwnerAction"].firstMatch.label.contains("继续观察"))
        XCTAssertTrue(app.descendants(matching: .any)["researchOwnerReview"].firstMatch.label.contains("证据仍不足"))
        XCTAssertTrue(app.descendants(matching: .any).matching(
            NSPredicate(format: "identifier BEGINSWITH %@", "personalMemoryJudgment-")
        ).firstMatch.exists)
        let execution = app.descendants(matching: .any).matching(
            NSPredicate(format: "identifier BEGINSWITH %@", "personalMemoryExecution-")
        ).firstMatch
        XCTAssertTrue(execution.label.contains("UNKNOWN"))
        let scrollView = app.scrollViews["researchScrollView"].firstMatch
        scrollView.swipeUp()
        attachScreenshot(named: "v4-personal-investment-memory-judgment", app: app)
        scrollView.swipeUp()
        scrollView.swipeUp()
        attachScreenshot(named: "v4-personal-investment-memory-review", app: app)
    }

    @MainActor
    func testV4RealHK00175PersonalResearchChecklist() throws {
        let environment = ProcessInfo.processInfo.environment
        guard let token = environment["ANNUAL_RINGS_UI_AUTH_TOKEN"], !token.isEmpty,
              environment["ANNUAL_RINGS_GATE_A_BASE_URL"] != nil else {
            throw XCTSkip("V4 personal checklist requires an explicit local API URL and short-lived read token")
        }
        let app = launchApp(symbol: "HK.00175", initialTab: "research", authToken: token)
        let title = app.descendants(matching: .any)["personalResearchChecklistTitle"].firstMatch
        XCTAssertTrue(title.waitForExistence(timeout: 30))
        scrollUntilVisible(title, in: app)
        XCTAssertEqual(title.label, "个人研究清单")
        let firstGap = app.descendants(matching: .any)["personalRepeatedResearchGap-0"].firstMatch
        XCTAssertTrue(firstGap.exists)
        XCTAssertTrue(firstGap.label.contains("次"))
        XCTAssertTrue(app.descendants(matching: .any)["personalResearchChecklistItem-0"].firstMatch.exists)
        XCTAssertTrue(app.descendants(matching: .any)["personalResearchChecklistBoundary"].firstMatch.label.contains("不评分"))
        app.scrollViews["researchScrollView"].firstMatch.swipeUp()
        attachScreenshot(named: "v4-personal-research-checklist-real", app: app)
    }

    @MainActor
    func testV4RealHK00175HistoricalCasesAndIndustryTemplate() throws {
        let environment = ProcessInfo.processInfo.environment
        guard let token = environment["ANNUAL_RINGS_UI_AUTH_TOKEN"], !token.isEmpty,
              environment["ANNUAL_RINGS_GATE_A_BASE_URL"] != nil else {
            throw XCTSkip("V4 historical cases require an explicit local API URL and short-lived read token")
        }
        let app = launchApp(symbol: "HK.00175", initialTab: "research", authToken: token)
        let title = app.descendants(matching: .any)["personalHistoricalCasesTitle"].firstMatch
        XCTAssertTrue(title.waitForExistence(timeout: 30))
        scrollUntilVisible(title, in: app)
        XCTAssertEqual(title.label, "相似历史案例")
        XCTAssertTrue(app.descendants(matching: .any)["personalHistoricalCase-0"].firstMatch.exists)
        XCTAssertTrue(app.descendants(matching: .any)["personalHistoricalCasesBoundary"].firstMatch.label.contains("不自动形成投资决定"))
        let template = app.buttons["personalIndustryResearchTemplate"].firstMatch
        XCTAssertTrue(template.exists)
        template.tap()
        XCTAssertTrue(app.staticTexts["供给"].firstMatch.waitForExistence(timeout: 5))
        attachScreenshot(named: "v4-personal-historical-cases-industry-template-real", app: app)
    }

    @MainActor
    func testV4RealHK00175LocalMemoryControlsReachExistingArchive() throws {
        let environment = ProcessInfo.processInfo.environment
        guard let token = environment["ANNUAL_RINGS_UI_AUTH_TOKEN"], !token.isEmpty,
              environment["ANNUAL_RINGS_GATE_A_BASE_URL"] != nil else {
            throw XCTSkip("V4 local memory controls require an explicit local API URL and short-lived read token")
        }
        let app = launchApp(symbol: "HK.00175", initialTab: "research", authToken: token)
        let title = app.descendants(matching: .any)["personalLocalMemoryControlsTitle"].firstMatch
        XCTAssertTrue(title.waitForExistence(timeout: 30))
        scrollUntilVisible(title, in: app)
        XCTAssertEqual(title.label, "本地记忆与备份")
        XCTAssertTrue(app.descendants(matching: .any)["personalLocalMemoryControlsBoundary"].firstMatch.label.contains("明确动作"))
        app.scrollViews["researchScrollView"].firstMatch.swipeUp()
        attachScreenshot(named: "v4-personal-local-memory-entry-real", app: app)
        let open = app.buttons["openPersonalLocalMemoryControls"].firstMatch
        scrollUntilHittable(open, in: app)
        open.tap()
        XCTAssertTrue(app.buttons["dailyReviewWorkspace-local"].firstMatch.waitForExistence(timeout: 10))
        XCTAssertTrue(app.descendants(matching: .any)["researchArchiveExportSection"].firstMatch.waitForExistence(timeout: 10))
        let export = app.buttons["researchArchiveExport"].firstMatch
        XCTAssertTrue(export.waitForExistence(timeout: 10))
        XCTAssertFalse(app.descendants(matching: .any)["researchArchiveExportUnavailable"].firstMatch.exists)
        XCTAssertTrue(app.descendants(matching: .any)["researchArchiveBackupSection"].firstMatch.exists)
        XCTAssertTrue(app.buttons["researchArchiveRestorePreviewButton"].firstMatch.exists)
        scrollUntilVisible(export, in: app)
        attachScreenshot(named: "v4-personal-local-memory-controls-real", app: app)
    }

    @MainActor
    func testC6RealHK00175ReadOnlyDailyLoop() throws {
        let environment = ProcessInfo.processInfo.environment
        guard let token = environment["ANNUAL_RINGS_UI_AUTH_TOKEN"], !token.isEmpty,
              environment["ANNUAL_RINGS_GATE_A_BASE_URL"] != nil else {
            throw XCTSkip("C6 requires an explicit local API URL and short-lived read token")
        }
        let app = launchApp(symbol: "HK.00175", initialTab: "today", authToken: token)
        let todayTab = app.tabBars.buttons["今日"]
        XCTAssertTrue(todayTab.waitForExistence(timeout: 10))
        XCTAssertTrue(todayTab.isSelected)
        let inboxStatus = app.descendants(matching: .any)["todayActionInboxStatus"].firstMatch
        XCTAssertTrue(inboxStatus.waitForExistence(timeout: 20))
        expectation(for: NSPredicate(format: "label == %@", "已加载"), evaluatedWith: inboxStatus)
        waitForExpectations(timeout: 20)
        let primaryAction = app.descendants(matching: .any)["todayNextAction"].firstMatch
        let noChange = app.descendants(matching: .any)["todayNoChangeSummary"].firstMatch
        XCTAssertTrue(primaryAction.exists || noChange.exists)
        XCTAssertFalse(primaryAction.exists && noChange.exists)
        let portfolioScope = app.descendants(matching: .any)["todayPortfolioScopeSummary"].firstMatch
        XCTAssertTrue(portfolioScope.waitForExistence(timeout: 20))
        XCTAssertTrue(portfolioScope.label.contains("已比较 5 只持续跟踪股票"))
        XCTAssertTrue(primaryAction.exists)
        let selectionReason = app.descendants(matching: .any)["todayPrimarySelectionReason"].firstMatch
        XCTAssertTrue(selectionReason.waitForExistence(timeout: 20))
        XCTAssertTrue(
            selectionReason.label.contains("实质情景变化")
                || selectionReason.label.contains("最高研究机会成本")
        )
        let primaryHypothesis = app.descendants(matching: .any)["todayPrimaryHypothesis"].firstMatch
        let primaryOnlyAction = app.descendants(matching: .any)["todayPrimaryOnlyAction"].firstMatch
        let primaryCompletion = app.descendants(matching: .any)["todayPrimaryCompletion"].firstMatch
        XCTAssertTrue(primaryHypothesis.waitForExistence(timeout: 20))
        XCTAssertTrue(primaryOnlyAction.waitForExistence(timeout: 20))
        XCTAssertTrue(primaryCompletion.waitForExistence(timeout: 20))
        XCTAssertTrue(primaryCompletion.label.contains("来源可以重新打开"))
        attachScreenshot(named: "v5-s4-today-primary-real", app: app)
        attachScreenshot(named: "c6-01-today-real", app: app)
        let todayRoot = app.descendants(matching: .any)["todayRoot"].firstMatch
        let todayOpportunityCost = app.descendants(matching: .any)["todayPrimaryOpportunityCost"].firstMatch
        for _ in 0..<4 where !todayOpportunityCost.isHittable {
            todayRoot.swipeUp()
        }
        XCTAssertTrue(todayOpportunityCost.waitForExistence(timeout: 20))
        XCTAssertTrue(todayOpportunityCost.label.contains("HK.02233"))
        XCTAssertTrue(todayOpportunityCost.label.contains("HK.03800"))
        XCTAssertTrue(todayOpportunityCost.label.contains("HK.09926"))
        XCTAssertTrue(todayOpportunityCost.label.contains("稍后复核"))
        attachScreenshot(named: "v5-s4-today-opportunity-real", app: app)

        let marketTab = app.tabBars.buttons["市场"]
        marketTab.tap()
        XCTAssertTrue(app.descendants(matching: .any)["marketDailyTrend"].firstMatch.waitForExistence(timeout: 20))
        let marketDailySymbol = app.descendants(matching: .any)["marketDailySymbol"].firstMatch
        XCTAssertTrue(marketDailySymbol.waitForExistence(timeout: 20))
        XCTAssertEqual(marketDailySymbol.label, "HK.00175")
        XCTAssertTrue(app.descendants(matching: .any)["marketSelectedCandidateReason"].firstMatch.waitForExistence(timeout: 20))
        let marketScroll = app.descendants(matching: .any)["marketScrollView"].firstMatch
        let marketScenarioFreshness = app.descendants(matching: .any)["marketScenarioFreshness"].firstMatch
        XCTAssertTrue(marketScenarioFreshness.waitForExistence(timeout: 20))
        expectation(
            for: NSPredicate(
                format: "label CONTAINS %@ OR label CONTAINS %@",
                "当前确认研究判断",
                "上次有效研究判断"
            ),
            evaluatedWith: marketScenarioFreshness
        )
        waitForExpectations(timeout: 30)
        XCTAssertTrue(marketScenarioFreshness.label.contains("周线分析日"))
        let marketScenarioConditions = app.descendants(matching: .any)["marketScenarioConditions"].firstMatch
        for _ in 0..<5 where !marketScenarioConditions.isHittable {
            marketScroll.swipeUp()
        }
        XCTAssertTrue(marketScenarioConditions.waitForExistence(timeout: 20))
        XCTAssertTrue(marketScenarioConditions.label.contains("改善"))
        XCTAssertTrue(marketScenarioConditions.label.contains("维持"))
        XCTAssertTrue(marketScenarioConditions.label.contains("恶化"))
        attachScreenshot(named: "v5-s3-market-scenarios-real", app: app)
        let marketScenarioConclusion = app.descendants(matching: .any)["marketScenarioConclusion"].firstMatch
        for _ in 0..<4 where !marketScenarioConclusion.isHittable {
            marketScroll.swipeUp()
        }
        XCTAssertTrue(marketScenarioConclusion.waitForExistence(timeout: 20))
        XCTAssertTrue(marketScenarioConclusion.label.contains("传导关系"))
        XCTAssertTrue(
            marketScenarioConclusion.label.contains("不能确认改善或恶化")
                || marketScenarioConclusion.label.contains("不会自动")
                || marketScenarioConclusion.label.contains("不足以单独确认")
        )
        let marketNextObservation = app.descendants(matching: .any)["marketScenarioNextObservation"].firstMatch
        XCTAssertTrue(marketNextObservation.waitForExistence(timeout: 20))
        for internalTerm in ["snapshot", "data cutoff", "exact-current", "evidence pack", "membership"] {
            XCTAssertFalse(marketScenarioConditions.label.lowercased().contains(internalTerm))
            XCTAssertFalse(marketScenarioConclusion.label.lowercased().contains(internalTerm))
        }
        attachScreenshot(named: "v5-s3-market-transmission-real", app: app)
        attachScreenshot(named: "c6-02-market-real", app: app)

        let researchTab = app.tabBars.buttons["研究"]
        researchTab.tap()
        let researchIdentity = app.staticTexts.matching(
            NSPredicate(format: "label CONTAINS %@", "HK.00175")
        ).firstMatch
        XCTAssertTrue(researchIdentity.waitForExistence(timeout: 30))
        XCTAssertTrue(researchIdentity.label.contains("HK.00175"))
        XCTAssertTrue(app.descendants(matching: .any)["researchBriefJudgment"].firstMatch.waitForExistence(timeout: 30))
        let freshness = app.descendants(matching: .any)["researchOutcomeFreshness"].firstMatch
        XCTAssertTrue(freshness.waitForExistence(timeout: 30))
        XCTAssertTrue(freshness.label.contains("报告截止"))
        XCTAssertTrue(freshness.label.contains("技术日线截止"))
        XCTAssertFalse(freshness.label.contains("当前有效"))
        let decisionQuestion = app.descendants(matching: .any)["researchDecisionQuestionBrief"].firstMatch
        XCTAssertTrue(decisionQuestion.waitForExistence(timeout: 20))
        let question = app.descendants(matching: .any)["researchBriefNextObservation"].firstMatch
        let questionWhy = app.descendants(matching: .any)["researchDecisionQuestionWhy"].firstMatch
        let questionImpact = app.descendants(matching: .any)["researchDecisionQuestionImpact"].firstMatch
        XCTAssertTrue(question.waitForExistence(timeout: 20))
        XCTAssertTrue(questionWhy.waitForExistence(timeout: 20))
        XCTAssertTrue(questionImpact.waitForExistence(timeout: 20))
        XCTAssertTrue(questionWhy.label.contains("改善、维持或恶化"))
        attachScreenshot(named: "v6-q1-research-question-real", app: app)
        let questionDone = app.descendants(matching: .any)["researchDecisionQuestionDone"].firstMatch
        scrollUntilVisible(questionDone, in: app)
        XCTAssertTrue(questionDone.waitForExistence(timeout: 20))
        XCTAssertTrue(questionDone.label.contains("正式来源能从 App 重新打开"))
        let questionProgress = app.descendants(matching: .any)["researchDecisionQuestionProgress"].firstMatch
        XCTAssertTrue(questionProgress.waitForExistence(timeout: 20))
        XCTAssertTrue(questionProgress.label.contains("上次有效但已过期"))
        XCTAssertTrue(app.descendants(matching: .any)["researchBriefSource"].firstMatch.exists)
        let questionSourceButton = app.buttons["打开正式来源"].firstMatch
        scrollUntilHittable(questionSourceButton, in: app)
        XCTAssertTrue(questionSourceButton.waitForExistence(timeout: 20))
        attachScreenshot(named: "v6-q1-research-completion-source-real", app: app)
        attachScreenshot(named: "c6-03a-research-top-real", app: app)
        let scenarioConditions = app.descendants(matching: .any)["researchBriefScenarioConditions"].firstMatch
        XCTAssertTrue(scenarioConditions.waitForExistence(timeout: 20))
        XCTAssertTrue(scenarioConditions.label.contains("改善"))
        XCTAssertTrue(scenarioConditions.label.contains("维持"))
        XCTAssertTrue(scenarioConditions.label.contains("恶化"))
        for internalTerm in ["snapshot", "data cutoff", "exact-current", "evidence pack", "membership"] {
            XCTAssertFalse(scenarioConditions.label.lowercased().contains(internalTerm))
        }
        let affectedVariables = app.descendants(matching: .any)["researchBriefAffectedVariables"].firstMatch
        scrollUntilVisible(affectedVariables, in: app)
        XCTAssertTrue(affectedVariables.waitForExistence(timeout: 20))
        XCTAssertFalse(affectedVariables.label.contains("_"))
        attachScreenshot(named: "v5-s1-research-scenarios-real", app: app)
        scrollUntilVisible(question, in: app)
        XCTAssertTrue(question.waitForExistence(timeout: 20))
        XCTAssertTrue(app.descendants(matching: .any)["researchBriefSource"].firstMatch.exists)
        attachScreenshot(named: "v5-s1-research-observation-source-real", app: app)
        let ownerHistory = app.descendants(matching: .any)["researchOwnerActionReview"].firstMatch
        XCTAssertTrue(ownerHistory.waitForExistence(timeout: 30))
        scrollUntilVisible(ownerHistory, in: app)
        XCTAssertTrue(app.descendants(matching: .any)["researchOwnerAction"].firstMatch.label.contains("继续观察"))
        XCTAssertTrue(app.descendants(matching: .any)["researchOwnerReview"].firstMatch.label.contains("证据仍不足"))
        attachScreenshot(named: "c6-03-research-action-real", app: app)
        let questionTaskSummary = app.descendants(matching: .any)["researchQuestionTaskSummary"].firstMatch
        let questionTaskButton = app.buttons["researchQuestionTaskButton"].firstMatch
        scrollUntilHittable(questionTaskButton, in: app)
        XCTAssertTrue(questionTaskSummary.waitForExistence(timeout: 20))
        XCTAssertTrue(questionTaskButton.waitForExistence(timeout: 20))
        XCTAssertTrue(
            questionTaskSummary.label.contains("旧证据已过期")
                || questionTaskSummary.label.contains("只有你明确开始后才会创建任务")
                || questionTaskSummary.label.contains("再由你明确开始")
        )
        questionTaskButton.tap()
        let overviewQuestion = app.descendants(matching: .any)["researchQuestionTaskOverviewQuestion"].firstMatch
        let overviewStatus = app.descendants(matching: .any)["researchQuestionTaskOverviewStatus"].firstMatch
        XCTAssertTrue(overviewQuestion.waitForExistence(timeout: 20))
        XCTAssertEqual(overviewQuestion.label, question.label)
        XCTAssertTrue(overviewStatus.waitForExistence(timeout: 20))
        XCTAssertTrue(app.descendants(matching: .any)["researchBriefSource"].firstMatch.exists)
        XCTAssertTrue(
            app.buttons["prepareResearchQuestionTaskButton"].firstMatch.exists
                || app.buttons["refreshResearchQuestionEvidenceButton"].firstMatch.exists
        )
        attachScreenshot(named: "v6-q2-source-task-path-real", app: app)

        let assetsTab = app.tabBars.buttons["资产"]
        assetsTab.tap()
        let assetsResearchContext = app.descendants(matching: .any)["assetsSelectedResearchContext"].firstMatch
        XCTAssertTrue(assetsResearchContext.waitForExistence(timeout: 20))
        XCTAssertTrue(assetsResearchContext.label.contains("HK.00175"))
        let missingSnapshot = app.descendants(matching: .any)["assetsMissingSnapshotSummary"].firstMatch
        XCTAssertTrue(missingSnapshot.waitForExistence(timeout: 20))
        XCTAssertTrue(missingSnapshot.label.contains("尚未录入资产快照"))
        XCTAssertTrue(missingSnapshot.label.contains("单股研究可以继续"))
        XCTAssertFalse(missingSnapshot.label.contains("UNKNOWN"))
        XCTAssertTrue(app.buttons["assetsMissingSnapshotAction"].firstMatch.exists)
        attachScreenshot(named: "c6-04-assets-real", app: app)

        researchTab.tap()
        let reopenReview = app.buttons["openResearchOwnerReview"].firstMatch
        scrollUntilHittable(reopenReview, in: app)
        XCTAssertTrue(reopenReview.waitForExistence(timeout: 20))
        reopenReview.tap()
        XCTAssertTrue(app.descendants(matching: .any)["decisionReviewSourceTarget-4"].firstMatch.waitForExistence(timeout: 30))
        let reviewIdentity = app.descendants(matching: .any)["decisionReviewReportIdentity"].firstMatch
        XCTAssertTrue(reviewIdentity.waitForExistence(timeout: 30))
        XCTAssertTrue(reviewIdentity.label.contains("对应判断 #4"))
        XCTAssertTrue(reviewIdentity.label.contains("报告 #18 v15"))
        XCTAssertTrue(reviewIdentity.label.contains("报告确认 #5"))
        XCTAssertTrue(app.descendants(matching: .any)["decisionReviewEvidence"].firstMatch.label.contains("复盘证据仍不足"))
        attachScreenshot(named: "c6-05-owner-review-real", app: app)
    }

    @MainActor
    func testC7RealFourTrackedStocksClearAndRestoreResearchIdentity() throws {
        let environment = ProcessInfo.processInfo.environment
        guard let token = environment["ANNUAL_RINGS_UI_AUTH_TOKEN"], !token.isEmpty,
              environment["ANNUAL_RINGS_GATE_A_BASE_URL"] != nil else {
            throw XCTSkip("C7 requires an explicit local API URL and short-lived read token")
        }
        let app = launchApp(symbol: "HK.00175", initialTab: "research", authToken: token)
        XCTAssertTrue(app.descendants(matching: .any)["researchOwnerActionReview"].firstMatch.waitForExistence(timeout: 30))
        let initialReview = app.buttons["openResearchOwnerReview"].firstMatch
        scrollUntilHittable(initialReview, in: app)
        initialReview.tap()
        XCTAssertTrue(app.descendants(matching: .any)["decisionReviewSourceTarget-4"].firstMatch.waitForExistence(timeout: 30))
        XCTAssertTrue(app.descendants(matching: .any)["decisionReviewReportIdentity"].firstMatch.label.contains("报告 #18 v15"))
        attachScreenshot(named: "c7-01-geely-research", app: app)

        let trackedStocks = [
            (symbol: "HK.09926", code: "09926"),
            (symbol: "HK.03800", code: "03800"),
            (symbol: "HK.02233", code: "02233"),
            (symbol: "HK.00700", code: "00700")
        ]
        for stock in trackedStocks {
            switchStock(stock.symbol, in: app, destination: "到市场查看并选择是否加入研究自选")
            let marketSymbol = app.descendants(matching: .any)["marketDailySymbol"].firstMatch
            XCTAssertTrue(marketSymbol.waitForExistence(timeout: 30))
            expectation(for: NSPredicate(format: "label == %@", stock.symbol), evaluatedWith: marketSymbol)
            waitForExpectations(timeout: 30)
            let openResearch = app.buttons["marketResearchNextStepButton"].firstMatch
            XCTAssertTrue(openResearch.waitForExistence(timeout: 30))
            expectation(for: NSPredicate(format: "label == %@", "打开研究"), evaluatedWith: openResearch)
            waitForExpectations(timeout: 30)
            let marketOwnerTrend = app.descendants(matching: .any)["marketOwnerWeinsteinTrend"].firstMatch
            XCTAssertTrue(marketOwnerTrend.waitForExistence(timeout: 30))
            XCTAssertFalse(marketOwnerTrend.label.contains("HK.00175"))
            let marketStageCard = app.descendants(matching: .any)["weinsteinTechnicalAnalysisCard"].firstMatch
            let marketStage = app.descendants(matching: .any)["weinsteinAnalysisSummary"].firstMatch
            if marketStageCard.waitForExistence(timeout: 5) {
                scrollMarketControlUntilHittable(marketStageCard, in: app)
                if marketStage.waitForExistence(timeout: 10) {
                    XCTAssertTrue(marketStage.label.contains(stock.symbol))
                }
            }
            attachScreenshot(named: "c7-market-\(stock.code)", app: app)

            let noticeDisclosure = app.buttons.matching(
                NSPredicate(format: "label BEGINSWITH %@", "\(stock.symbol) OpenD 信息线索")
            ).firstMatch
            scrollMarketControlUntilHittable(noticeDisclosure, in: app)
            XCTAssertTrue(noticeDisclosure.waitForExistence(timeout: 30))
            noticeDisclosure.tap()
            let verifyNotice = app.buttons.matching(
                NSPredicate(format: "identifier BEGINSWITH %@", "marketDiscoveryVerifyNoticeLead-")
            ).firstMatch
            if verifyNotice.waitForExistence(timeout: 5) {
                scrollMarketControlUntilHittable(verifyNotice, in: app)
                verifyNotice.tap()
            } else {
                app.tabBars.buttons["研究"].tap()
            }
            XCTAssertTrue(app.tabBars.buttons["研究"].isSelected)
            let researchIdentity = app.descendants(matching: .any)["researchIdentityHeader"].firstMatch
            XCTAssertTrue(researchIdentity.waitForExistence(timeout: 30))
            XCTAssertTrue(researchIdentity.label.contains(stock.symbol))
            let judgment = app.descendants(matching: .any)["researchBriefJudgment"].firstMatch
            XCTAssertTrue(judgment.waitForExistence(timeout: 30))
            let drivers = app.descendants(matching: .any)["researchBriefDrivers"].firstMatch
            let valuation = app.descendants(matching: .any)["researchBriefValuation"].firstMatch
            let risk = app.descendants(matching: .any)["researchBriefRisk"].firstMatch
            let source = app.descendants(matching: .any)["researchBriefSource"].firstMatch
            XCTAssertTrue(judgment.label.contains("尚未形成当前判断") || judgment.label.contains("周线"))
            for element in [drivers, valuation, risk, source] where element.exists {
                XCTAssertFalse(element.label.contains("新能源渗透率与吉利市场份额"))
                XCTAssertFalse(element.label.contains("Geely Automobile Holdings Limited Annual Report 2025"))
            }
            XCTAssertFalse(app.descendants(matching: .any)["researchOwnerActionReview"].exists)
            XCTAssertFalse(app.descendants(matching: .any)["decisionReviewSourceTarget-4"].exists)
            XCTAssertFalse(app.descendants(matching: .any)["decisionReviewReportIdentity"].exists)
            XCTAssertFalse(app.descendants(matching: .any)["deepResearchTaskFreshness"].exists)
            XCTAssertFalse(app.descendants(matching: .any)["twoLayerReport-18"].exists)
            XCTAssertFalse(app.buttons["researchDocumentOpenPDFButton"].exists)
            XCTAssertFalse(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "继续观察，不自动生成交易")).firstMatch.exists)
            attachScreenshot(named: "c7-research-\(stock.code)", app: app)
            XCTAssertFalse(app.buttons["prepareResearchQuestionTaskButton"].exists)
            XCTAssertFalse(app.buttons["refreshResearchQuestionEvidenceButton"].exists)

            app.tabBars.buttons["资产"].tap()
            let assetsContext = app.descendants(matching: .any)["assetsSelectedResearchContext"].firstMatch
            XCTAssertTrue(assetsContext.waitForExistence(timeout: 30))
            expectation(for: NSPredicate(format: "label CONTAINS %@", stock.symbol), evaluatedWith: assetsContext)
            waitForExpectations(timeout: 30)
            XCTAssertTrue(app.staticTexts["\(stock.symbol) 组合影响"].firstMatch.waitForExistence(timeout: 30))
            for other in trackedStocks where other.symbol != stock.symbol {
                XCTAssertFalse(app.staticTexts["\(other.symbol) 组合影响"].exists)
            }
            let missingSnapshot = app.descendants(matching: .any)["assetsMissingSnapshotSummary"].firstMatch
            XCTAssertTrue(missingSnapshot.waitForExistence(timeout: 30))
            XCTAssertTrue(missingSnapshot.label.contains(stock.symbol))
            XCTAssertTrue(missingSnapshot.label.contains("尚未录入资产快照"))
            XCTAssertFalse(missingSnapshot.label.contains("UNKNOWN"))
            XCTAssertTrue(app.buttons["assetsMissingSnapshotAction"].firstMatch.exists)
            XCTAssertFalse(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "吉利汽车2025年营收")).firstMatch.exists)
            attachScreenshot(named: "c7-assets-\(stock.code)", app: app)
        }

        switchStock("HK.00175", in: app, destination: "打开已有研究")
        let restoredIdentity = app.descendants(matching: .any)["researchIdentityHeader"].firstMatch
        XCTAssertTrue(restoredIdentity.waitForExistence(timeout: 30))
        XCTAssertTrue(restoredIdentity.label.contains("HK.00175"))
        let restoredQuestion = app.descendants(matching: .any)["researchBriefNextObservation"].firstMatch
        XCTAssertTrue(restoredQuestion.waitForExistence(timeout: 30))
        XCTAssertTrue(restoredQuestion.label.contains("新能源渗透率与吉利市场份额"))
        XCTAssertTrue(app.buttons["打开正式来源"].firstMatch.exists)
        let restoredAction = app.descendants(matching: .any)["researchOwnerAction"].firstMatch
        XCTAssertTrue(restoredAction.waitForExistence(timeout: 30))
        XCTAssertTrue(restoredAction.label.contains("继续观察"))
        for stock in trackedStocks {
            XCTAssertFalse(app.staticTexts["\(stock.symbol) 组合影响"].exists)
        }
        let restoredReview = app.buttons["openResearchOwnerReview"].firstMatch
        scrollUntilHittable(restoredReview, in: app)
        restoredReview.tap()
        XCTAssertTrue(app.descendants(matching: .any)["decisionReviewSourceTarget-4"].firstMatch.waitForExistence(timeout: 30))
        XCTAssertTrue(app.descendants(matching: .any)["decisionReviewReportIdentity"].firstMatch.label.contains("报告 #18 v15"))
        attachScreenshot(named: "c7-05-geely-restored", app: app)
    }

    @MainActor
    func testAuthorizedPhysicalReadOnlyJourney() throws {
        let environment = ProcessInfo.processInfo.environment
        guard environment["PHYSICAL_DEVICE_EVIDENCE"] == "1" else {
            throw XCTSkip("Physical-device evidence is owner-gated.")
        }
        let baseURL = try XCTUnwrap(environment["ANNUAL_RINGS_GATE_A_BASE_URL"])
        let readToken = try XCTUnwrap(environment["PHYSICAL_DEVICE_READ_TOKEN"])
        let readHeader = environment["PHYSICAL_DEVICE_READ_HEADER"] ?? "x-readonly-validation-token"
        let app = XCUIApplication()
        app.launchArguments = [
            "--ui-testing",
            "--base-url", baseURL,
            "--symbol", "HK.00175",
            "--initial-tab", "research",
            "--auth-token", readToken,
            "--auth-header", readHeader,
            "--reset-daily-resume"
        ]
        app.launch()

        let candidateStatus = app.staticTexts["candidateOverviewStatus"]
        XCTAssertTrue(candidateStatus.waitForExistence(timeout: 20), "candidate overview did not load on the physical device")
        XCTAssertFalse(candidateStatus.label.localizedCaseInsensitiveContains("unauthorized"))
        addPhysicalScreenshot("physical-candidate-overview")

        let select = findButton(in: app, identifier: "selectCandidate-HK.00175", label: "查看辅助决策")
        scrollUntilHittable(select, in: app)
        XCTAssertTrue(select.waitForExistence(timeout: 10), "HK.00175 was not available for the physical read-only journey")
        select.tap()

        let selected = app.staticTexts["selectedSymbolCanonical"]
        XCTAssertTrue(selected.waitForExistence(timeout: 20), "selected candidate did not reach the decision workspace")
        XCTAssertEqual(selected.label, "HK.00175")

        openDecisionLayer("candidate", in: app)
        expandDisclosure(identifier: "candidateManagementDisclosure", label: "研究自选管理", in: app)
        waitForAvailableCandidateMemberships(in: app)
        let openWorkspace = findButton(
            in: app,
            identifier: "assistMobileWorkspaceOpen-HK.00175",
            label: "打开移动工作台"
        )
        scrollUntilHittable(openWorkspace, in: app)
        XCTAssertTrue(openWorkspace.waitForExistence(timeout: 10), "tracked membership did not expose the mobile workspace entry")
        openWorkspace.tap()

        openDecisionLayer("review", in: app)
        expandDisclosure(identifier: "localReviewRecordsDisclosure", label: "本地记录与复盘知识", in: app)
        let focusedRecords = app.descendants(matching: .any)["focusedLocalReviewRecordsSection"]
        XCTAssertTrue(focusedRecords.waitForExistence(timeout: 20), "focused local review records did not become visible")
        XCTAssertFalse(app.descendants(matching: .any)["assistMobileWorkspaceSection"].exists)
        addPhysicalScreenshot("physical-candidate-review-workspace")
    }

    @MainActor
    func testResearchEvidenceLayerRendersWithoutCrash() {
        let app = XCUIApplication()
        app.launchArguments = ["--initial-tab", "research", "--symbol", "HK.00175", "--reset-daily-resume"]
        app.launch()

        let evidence = app.buttons["decisionRingLayer-evidence"].firstMatch
        scrollUntilHittable(evidence, in: app)
        XCTAssertTrue(evidence.waitForExistence(timeout: 10))
        evidence.tap()
        let reports = app.buttons["dailyEvidenceWorkspace-brief"].firstMatch
        scrollUntilHittable(reports, in: app)
        XCTAssertTrue(reports.waitForExistence(timeout: 10))
        reports.tap()
        XCTAssertTrue(app.descendants(matching: .any)["twoLayerReportWorkspace"].waitForExistence(timeout: 20))
        attachScreenshot(named: "figma-v3-research-evidence", app: app)
    }

    @MainActor
    func testNormalDebugLaunchUsesEphemeralCredentials() throws {
        let app = XCUIApplication()
        let environment = ProcessInfo.processInfo.environment
        let baseURL = environment["ANNUAL_RINGS_GATE_A_BASE_URL"] ?? "http://127.0.0.1:4520"
        app.launchArguments = ["--base-url", baseURL, "--symbol", "00175.hk", "--initial-tab", "research", "--reset-daily-resume"]
        app.launchEnvironment["ANNUAL_RINGS_DEBUG_READ_AUTH_TOKEN"] = "normal-debug-read-token"
        app.launchEnvironment["ANNUAL_RINGS_DEBUG_WRITE_AUTH_TOKEN"] = "normal-debug-write-token"
        app.launch()

        assertCandidateOverviewAvailable(in: app)
    }

    @MainActor
    func testAcceptSuggestionDoesNotChangeThesis() throws {
        try decideSuggestionWithButton(identifier: "acceptSuggestionButton", label: "接受")
    }

    @MainActor
    func testRejectSuggestionDoesNotChangeThesis() throws {
        try decideSuggestionWithButton(identifier: "rejectSuggestionButton", label: "拒绝")
    }

    @MainActor
    func testQuoteActionNavigatesToAssistedDecisionOverview() throws {
        let app = launchMarketApp(authToken: "owner-read-token")
        XCTAssertTrue(app.staticTexts["selectedSymbolCanonical"].waitForExistence(timeout: 10) == false)
        let openCandidate = app.buttons["marketOpenCandidate-HK.00175"]
        XCTAssertTrue(openCandidate.waitForExistence(timeout: 10), "Market candidate research entry is missing")
        openCandidate.tap()

        let researchTab = app.tabBars.buttons["研究"]
        XCTAssertTrue(researchTab.waitForExistence(timeout: 20), "Research tab is missing")
        XCTAssertTrue(researchTab.isSelected, "Market candidate did not open Research")
        XCTAssertTrue(app.staticTexts["selectedSymbolCanonical"].waitForExistence(timeout: 20), "assisted decision tab did not open")
        XCTAssertEqual(app.staticTexts["selectedSymbolCanonical"].label, "HK.00175")
    }

    @MainActor
    func testDailyClientColdLaunchRestoresNavigationAndRereadsFacts() throws {
        let continuityToken = "daily-continuity-cold-launch"
        let firstLaunch = launchResearchApp(symbol: "09926.hk", authToken: continuityToken)
        assertResearchLayerMenu(in: firstLaunch)
        openDecisionLayer("review", in: firstLaunch)
        XCTAssertEqual(firstLaunch.buttons["dailyDecisionLayerToolbarMenu"].value as? String, "复盘")
        firstLaunch.terminate()

        let resumed = launchApp(
            symbol: "00175.hk",
            initialTab: nil,
            authToken: continuityToken,
            resetDailyResume: false
        )
        let todayTab = resumed.tabBars.buttons["今日"]
        XCTAssertTrue(todayTab.waitForExistence(timeout: 10))
        XCTAssertTrue(todayTab.isSelected, "normal cold launch must default to Today")
        expandTodayResearchHistory(in: resumed)
        XCTAssertEqual(resumed.staticTexts["todayCurrentCandidate"].label, "HK.09926")
        XCTAssertFalse(resumed.buttons["dailyDecisionLayerToolbarMenu"].exists)

        let researchTab = resumed.tabBars.buttons["研究"]
        XCTAssertTrue(researchTab.waitForExistence(timeout: 10))
        researchTab.tap()
        assertResearchLayerMenu(in: resumed)
        XCTAssertEqual(resumed.buttons["dailyDecisionLayerToolbarMenu"].value as? String, "复盘")

        openDecisionLayer("candidate", in: resumed)
        attachScreenshot(named: "daily-client-resume", app: resumed)
    }

    @MainActor
    func testDailyClientRetryRecoversUnauthorizedAndOfflineSources() throws {
        let app = launchResearchApp(
            symbol: "09926.hk",
            authToken: "daily-continuity-recovery"
        )
        assertResearchLayerMenu(in: app)
        XCUIDevice.shared.press(.home)
        app.activate()
        assertResearchLayerMenu(in: app)

        openDecisionLayer("candidate", in: app)
        let candidateStatus = app.descendants(matching: .any)["candidateOverviewStatus"].firstMatch
        XCTAssertTrue(candidateStatus.waitForExistence(timeout: 10))
        expectation(for: NSPredicate(format: "label BEGINSWITH %@", "已更新"), evaluatedWith: candidateStatus)
        waitForExpectations(timeout: 20)
        openDecisionLayer("portfolio", in: app)
        let recoveredPortfolioStatus = app.staticTexts["portfolioDecisionStatus"].firstMatch
        XCTAssertTrue(recoveredPortfolioStatus.waitForExistence(timeout: 10))
        XCTAssertEqual(recoveredPortfolioStatus.label, "available")
        openDecisionLayer("candidate", in: app)
        attachScreenshot(named: "daily-client-recovery", app: app)
    }

    @MainActor
    func testDailyWorkbenchCompactStandardAndLargeLayoutsRemainContained() throws {
        executionTimeAllowance = 900
        defer { XCUIDevice.shared.orientation = .portrait }
        let viewports = [
            (width: CGFloat(320), landscape: false, screenshot: "daily-workbench-compact-320"),
            (width: CGFloat(390), landscape: false, screenshot: "daily-workbench-standard-390"),
            (width: CGFloat(430), landscape: true, screenshot: "daily-workbench-large-430")
        ]

        for viewport in viewports {
            XCUIDevice.shared.orientation = viewport.landscape ? .landscapeLeft : .portrait
            let app = launchResearchApp(
                symbol: "09926.hk",
                preferredContentSizeCategory: "UICTContentSizeCategoryL",
                viewportWidth: Int(viewport.width)
            )
            assertResponsiveWorkbench(
                in: app,
                expectedWidth: viewport.width,
                screenshotName: viewport.screenshot,
                accessibilityText: false,
                checksLifecycleFocus: false
            )
            app.terminate()
        }
    }

    @MainActor
    func testDailyWorkbenchAccessibilityTextKeepsLayerMenuAndActionsReachable() throws {
        executionTimeAllowance = 900
        defer { XCUIDevice.shared.orientation = .portrait }
        let viewports = [
            (width: CGFloat(320), landscape: false, screenshot: "daily-workbench-accessibility-320"),
            (width: CGFloat(390), landscape: false, screenshot: "daily-workbench-accessibility-390"),
            (width: CGFloat(430), landscape: true, screenshot: "daily-workbench-accessibility-430")
        ]

        for viewport in viewports {
            XCUIDevice.shared.orientation = viewport.landscape ? .landscapeLeft : .portrait
            let app = launchResearchApp(
                symbol: "09926.hk",
                preferredContentSizeCategory: "UICTContentSizeCategoryAccessibilityXL",
                viewportWidth: Int(viewport.width)
            )
            assertResponsiveWorkbench(
                in: app,
                expectedWidth: viewport.width,
                screenshotName: viewport.screenshot,
                accessibilityText: true,
                checksLifecycleFocus: viewport.width == 320
            )
            app.terminate()
        }
    }

    @MainActor
    private func assertResponsiveWorkbench(
        in app: XCUIApplication,
        expectedWidth: CGFloat,
        screenshotName: String,
        accessibilityText: Bool,
        checksLifecycleFocus: Bool
    ) {
        let mode = accessibilityText ? "accessibility" : "standard-content-size"
        XCTAssertTrue(app.wait(for: .runningForeground, timeout: 20), "\(mode) launch did not reach the foreground")
        let expectedLandscape = expectedWidth == 430
        XCUIDevice.shared.orientation = expectedLandscape ? .landscapeLeft : .portrait
        let orientationSettled = NSPredicate(
            block: { object, _ in
                guard let application = object as? XCUIApplication else { return false }
                return expectedLandscape
                    ? application.frame.width > application.frame.height
                    : application.frame.height > application.frame.width
            }
        )
        expectation(for: orientationSettled, evaluatedWith: app)
        waitForExpectations(timeout: 10)
        let scrollView = app.scrollViews["researchScrollView"].firstMatch
        XCTAssertTrue(scrollView.waitForExistence(timeout: 10), "\(mode) workbench scroll view is missing")
        let viewportFrame = scrollView.frame
        XCTAssertEqual(
            viewportFrame.width,
            expectedWidth,
            accuracy: 1,
            "SwiftUI received a different viewport than the requested \(Int(expectedWidth))-point width"
        )
        XCTAssertGreaterThanOrEqual(viewportFrame.minX, app.frame.minX - 0.5)
        XCTAssertLessThanOrEqual(viewportFrame.maxX, app.frame.maxX + 0.5)
        XCTAssertEqual(
            scrollView.descendants(matching: .scrollView).count,
            0,
            "the daily workbench introduced a nested scrolling viewport at \(Int(expectedWidth)) points"
        )

        let toolbarMenu = app.buttons["dailyDecisionLayerToolbarMenu"].firstMatch
        XCTAssertTrue(toolbarMenu.waitForExistence(timeout: 5), "\(mode) Research layer toolbar menu is missing")
        XCTAssertTrue(toolbarMenu.isHittable, "\(mode) Research layer toolbar menu is not reachable")
        assertHorizontallyContained(
            toolbarMenu,
            in: viewportFrame,
            message: "Research layer menu escaped the \(Int(expectedWidth))-point viewport"
        )

        if accessibilityText {
            let layerMenu = app.buttons["dailyDecisionLayerMenu"].firstMatch
            scrollUntilHittable(layerMenu, in: app)
            XCTAssertTrue(layerMenu.waitForExistence(timeout: 5))
            XCTAssertTrue(layerMenu.isHittable, "accessibility text size did not expose the independent layer menu")
            if !expectedLandscape {
                assertHorizontallyContained(layerMenu, in: viewportFrame, message: "layer menu escaped the viewport")
            }
        } else {
            XCTAssertFalse(app.buttons["dailyDecisionLayerMenu"].exists, "standard layout unexpectedly duplicated the toolbar layer menu")
        }

        let nextStep = app.buttons["dailyDecisionNextStepButton"].firstMatch
        scrollUntilHittable(nextStep, in: app)
        XCTAssertTrue(nextStep.isHittable, "next-step action is not reachable in \(mode) mode")
        XCTAssertTrue(nextStep.label.contains("前往"), "next-step action lost its complete command label")
        XCTAssertGreaterThanOrEqual(nextStep.frame.height, 44)
        assertHorizontallyContained(nextStep, in: viewportFrame, message: "next-step action escaped the viewport")
        for identifier in ["dailyDecisionPath", "dailyDecisionNextStepTitle", "dailyDecisionNextStepDetail"] {
            let text = app.staticTexts[identifier].firstMatch
            XCTAssertTrue(text.waitForExistence(timeout: 5), "\(mode) \(identifier) text is missing")
            assertHorizontallyContained(text, in: viewportFrame, message: "\(identifier) escaped the viewport")
        }

        let nextStepCard = app.descendants(matching: .any)["dailyDecisionNextStepCard"].firstMatch
        let tabBar = app.tabBars.firstMatch
        XCTAssertTrue(nextStepCard.waitForExistence(timeout: 5))
        XCTAssertTrue(tabBar.waitForExistence(timeout: 5))
        for _ in 0..<8 where nextStepCard.frame.maxY > tabBar.frame.minY {
            scrollView.swipeUp()
        }
        XCTAssertLessThanOrEqual(
            nextStepCard.frame.maxY,
            tabBar.frame.minY + 0.5,
            "next-step card remained underneath the floating tab bar"
        )
        if expectedLandscape {
            addPhysicalScreenshot(screenshotName)
        } else {
            attachScreenshot(named: screenshotName, app: app)
        }
        if expectedLandscape {
            assertToolbarSelectsDecisionLayer("portfolio", in: app)
        }
        guard checksLifecycleFocus else { return }

        openDecisionLayerFromToolbar("candidate", in: app)
        let lifecycleWorkspace = app.descendants(matching: .any)["dailyCandidateWorkspace-lifecycle"].firstMatch
        scrollUntilHittable(lifecycleWorkspace, in: app)
        guard lifecycleWorkspace.waitForExistence(timeout: 10) else {
            return XCTFail("\(mode) lifecycle workspace is missing")
        }
        XCTAssertGreaterThanOrEqual(lifecycleWorkspace.frame.width, 44)
        XCTAssertGreaterThanOrEqual(lifecycleWorkspace.frame.height, 44)
        let openLifecycle = app.buttons["dailyCandidateLifecycleOpen"].firstMatch
        scrollUntilHittable(openLifecycle, in: app)
        guard openLifecycle.waitForExistence(timeout: 5), openLifecycle.isHittable else {
            return XCTFail("\(mode) candidate layer did not expose lifecycle management")
        }
        openLifecycle.tap()
        guard waitForWorkspaceContent("dailyCandidateWorkspace-lifecycle", in: app) else { return }
        guard waitForAvailableCandidateMemberships(in: app) else { return }
        let locateCurrent = app.buttons["candidateMembershipLocateCurrent"].firstMatch
        scrollUntilHittable(locateCurrent, in: app)
        guard locateCurrent.waitForExistence(timeout: 5), locateCurrent.isHittable else {
            return XCTFail("\(mode) lifecycle did not expose a current-symbol locator")
        }
        locateCurrent.tap()
        let currentSymbol = app.staticTexts["candidateMembershipSymbol-HK.09926"].firstMatch
        XCTAssertTrue(
            currentSymbol.waitForExistence(timeout: 10),
            "current-symbol focus did not reveal HK.09926"
        )
        let lifecycleActions = app.descendants(matching: .any)["candidateMembershipStateActions-HK.09926"].firstMatch
        XCTAssertTrue(
            lifecycleActions.waitForExistence(timeout: 10),
            "current-symbol focus did not expose the real lifecycle action group"
        )
        XCTAssertEqual(locateCurrent.label, "显示全部")
    }

    @MainActor
    func testCandidateOverviewAvailableSelectionHandoff() throws {
        let app = launchResearchApp()

        assertCandidateOverviewAvailable(in: app)
        XCTAssertEqual(app.staticTexts["candidateSymbol-HK.00175"].label, "1. HK.00175")
        XCTAssertEqual(app.staticTexts["candidateSymbol-HK.00005"].label, "2. HK.00005")
        XCTAssertEqual(app.staticTexts["candidateSymbol-HK.09926"].label, "3. HK.09926")
        XCTAssertEqual(app.staticTexts["candidateQuoteStatus-HK.00175"].label, "当前行情")
        XCTAssertEqual(app.staticTexts["candidateQuoteStatus-HK.00005"].label, "非实时行情")
        XCTAssertEqual(app.staticTexts["candidateQuoteStatus-HK.09926"].label, "行情暂不可用")
        XCTAssertEqual(app.staticTexts["candidateReviewMaintenance-HK.00175"].label, "当前无需复核")
        XCTAssertEqual(app.staticTexts["candidateReviewMaintenance-HK.00005"].label, "需要复核研究档案")
        XCTAssertEqual(app.staticTexts["candidateReviewMaintenance-HK.09926"].label, "当前无需复核")
        XCTAssertEqual(app.staticTexts["candidateLatestEvidence-HK.00175"].label, "2026-07-02T08:55:00.000Z")
        XCTAssertEqual(app.staticTexts["candidateLatestEvidence-HK.00005"].label, "未记录")
        XCTAssertEqual(app.staticTexts["candidateLatestEvidence-HK.09926"].label, "2026-06-30T10:20:00.000Z")
        XCTAssertTrue(app.staticTexts["candidateOverviewStatus"].label.contains("do not imply ranking or recommendation"))
        XCTAssertFalse(app.staticTexts["candidateOverviewStatus"].label.localizedCaseInsensitiveContains("score"))
        XCTAssertFalse(app.staticTexts["candidateOverviewStatus"].label.contains("推荐"))
        XCTAssertFalse(app.staticTexts["candidateRank-HK.00175"].exists)
        XCTAssertFalse(app.staticTexts["candidateScore-HK.00175"].exists)

        let selectCurrent = findButton(in: app, identifier: "selectCandidate-HK.00175", label: "查看辅助决策")
        scrollUntilHittable(selectCurrent, in: app)
        XCTAssertTrue(selectCurrent.waitForExistence(timeout: 5), "current candidate selection button is missing")
        selectCurrent.tap()
        XCTAssertEqual(app.buttons["dailyDecisionLayerToolbarMenu"].value as? String, "证据", "selecting the already-current symbol did not enter Evidence")
        XCTAssertEqual(app.staticTexts["selectedSymbolCanonical"].label, "HK.00175")

        openDecisionLayer("candidate", in: app)

        let selectHSBC = findButton(in: app, identifier: "selectCandidate-HK.00005", label: "查看辅助决策")
        scrollUntilHittable(selectHSBC, in: app)
        XCTAssertTrue(selectHSBC.waitForExistence(timeout: 5), "candidate selection button is missing")
        selectHSBC.tap()

        XCTAssertEqual(app.buttons["dailyDecisionLayerToolbarMenu"].value as? String, "证据", "candidate selection did not reveal Evidence")
        let selected = app.staticTexts["selectedSymbolCanonical"].firstMatch
        let predicate = NSPredicate(format: "label == %@", "HK.00005")
        expectation(for: predicate, evaluatedWith: selected)
        waitForExpectations(timeout: 10)
        let previousDecisionContext = app.staticTexts
            .matching(identifier: "decisionContextSymbol")
            .matching(NSPredicate(format: "label == %@", "HK.00175"))
            .firstMatch
        XCTAssertTrue(previousDecisionContext.waitForNonExistence(timeout: 10), "a new symbol must not reuse the previous decision context")
        XCTAssertEqual(app.staticTexts["dailyDecisionNextStepTitle"].label, "先把 HK.00005 加入研究")
        XCTAssertFalse(previousDecisionContext.exists, "the previous decision context returned after the new next step settled")
    }

    @MainActor
    func testQuantDecisionEvidenceRefinementShowsBoundedSamplesAndExecution() throws {
        let app = launchResearchApp(symbol: "09926.hk")
        openEvidenceWorkspace("facts", in: app)
        XCTAssertTrue(app.staticTexts["decisionContextSymbol"].waitForExistence(timeout: 10))
        XCTAssertEqual(app.staticTexts["decisionContextSymbol"].label, "HK.09926")

        let refinement = app.staticTexts["decisionQuantEvidenceRefinement"]
        scrollUntilHittable(refinement, in: app)
        XCTAssertTrue(refinement.waitForExistence(timeout: 10))
        XCTAssertTrue(refinement.label.contains("available"))
        XCTAssertTrue(refinement.label.contains("quant-decision-evidence:"))

        let samples = app.staticTexts["decisionQuantEvidenceSamples"]
        scrollUntilHittable(samples, in: app)
        XCTAssertTrue(samples.label.contains("train"))
        XCTAssertTrue(samples.label.contains("validation"))
        XCTAssertTrue(samples.label.contains("final_test"))

        let execution = app.staticTexts["decisionQuantEvidenceExecution"]
        scrollUntilHittable(execution, in: app)
        XCTAssertTrue(execution.label.contains("next_trading_day_open"))
        XCTAssertTrue(execution.label.contains("同 bar=false"))

        let robustness = app.staticTexts["decisionQuantEvidenceRobustness"]
        scrollUntilHittable(robustness, in: app)
        XCTAssertTrue(robustness.label.contains("final-test 调参=false"))
        XCTAssertTrue(robustness.label.contains("失败实验=not_captured"))
        attachScreenshot(named: "quant-decision-evidence", app: app)
    }

    @MainActor
    func testAnnualReviewLearningSummaryShowsMinimumSampleBoundary() throws {
        let app = launchResearchApp(
            symbol: "09926.hk",
            authToken: "review-learning-summary-read-token"
        )
        assertResearchLayerMenu(in: app)
        openDecisionLayer("review", in: app)

        let title = app.descendants(matching: .any)["annualReviewLearningSummaryTitle"].firstMatch
        guard title.waitForExistence(timeout: 20) else {
            let message = app.staticTexts["decisionReviewMessage"].firstMatch
            return XCTFail(
                "personal review-learning summary is missing; review state=\(message.exists ? message.label : "unavailable")"
            )
        }
        scrollUntilHittable(title, in: app)
        XCTAssertEqual(app.staticTexts["annualReviewLearningSummaryStatus"].firstMatch.label, "样本不足，不显示聚合")
        let counts = app.staticTexts["annualReviewLearningSummaryCounts"].firstMatch
        XCTAssertTrue(counts.label.contains("可评价 1"))
        XCTAssertTrue(counts.label.contains("已记录学习 1"))
        XCTAssertTrue(counts.label.contains("历史缺失 0"))
        XCTAssertTrue(counts.label.contains("最低 5"))
        XCTAssertFalse(app.staticTexts["annualReviewLearningConfidenceRow-0"].exists)
        XCTAssertFalse(app.staticTexts["annualReviewLearningQuantLimit-0"].exists)
        let safety = app.staticTexts["annualReviewLearningSummarySafety"].firstMatch
        scrollUntilHittable(safety, in: app)
        XCTAssertTrue(safety.label.contains("不从盈亏或单次结果推断正确性"))
        XCTAssertTrue(safety.label.contains("不生成推荐、排名、目标价、目标仓位、方向、订单或交易"))
        attachScreenshot(named: "annual-review-learning-summary", app: app)
    }

    @MainActor
    func testAnnualReviewLearningSummaryShowsReadySourcesAndDrillsIntoTimeline() throws {
        let app = launchResearchApp(
            symbol: "09926.hk",
            authToken: "review-learning-ready-read-token"
        )
        assertResearchLayerMenu(in: app)
        openDecisionLayer("review", in: app)

        let title = app.descendants(matching: .any)["annualReviewLearningSummaryTitle"].firstMatch
        XCTAssertTrue(title.waitForExistence(timeout: 20), "ready review-learning summary is missing")
        XCTAssertEqual(app.staticTexts["annualReviewLearningSummaryStatus"].firstMatch.label, "已达到个人描述性样本门槛")
        let counts = app.staticTexts["annualReviewLearningSummaryCounts"].firstMatch
        XCTAssertTrue(counts.label.contains("已记录学习 5"))

        let mediumSources = app.buttons["annualReviewLearningConfidenceSources-1"].firstMatch
        scrollUntilHittable(mediumSources, in: app)
        XCTAssertTrue(mediumSources.waitForExistence(timeout: 10), "confidence source drilldown is missing")
        XCTAssertTrue(app.descendants(matching: .any)["annualReviewLearningRepeatedLesson-0"].exists)
        XCTAssertTrue(app.buttons["annualReviewLearningQuantLimit-0"].exists)
        attachScreenshot(named: "annual-review-learning-ready", app: app)

        mediumSources.tap()
        let firstSource = app.buttons["annualReviewLearningReviewSource-review-ready-1"].firstMatch
        XCTAssertTrue(firstSource.waitForExistence(timeout: 5), "review source menu did not expose immutable source ids")
        firstSource.tap()
        let sourceTimeline = app.descendants(matching: .any)["decisionReviewSource-review-ready-1"].firstMatch
        XCTAssertTrue(sourceTimeline.waitForExistence(timeout: 10), "source drilldown did not reach the append-only review timeline")
        let sourceTarget = app.staticTexts["decisionReviewSourceTarget-review-ready-1"].firstMatch
        XCTAssertTrue(sourceTarget.waitForExistence(timeout: 10), "source drilldown target content is missing")
        let visible = XCTNSPredicateExpectation(predicate: NSPredicate(format: "hittable == true"), object: sourceTarget)
        XCTAssertEqual(XCTWaiter.wait(for: [visible], timeout: 10), .completed, "source drilldown target is not visible after navigation")
    }

    @MainActor
    func testAnnualDecisionBriefGoldenJourneyKeepsResearchLayersAndNoTradingSemantics() throws {
        let app = launchResearchApp(symbol: "09926.hk")
        assertResearchLayerMenu(in: app)
        openDecisionLayer("candidate", in: app)
        expandDisclosure(identifier: "candidateManagementDisclosure", label: "研究自选管理", in: app)
        waitForAvailableCandidateMemberships(in: app)

        let editResearch = findButton(
            in: app,
            identifier: "annualDecisionBriefEdit-HK.09926",
            label: "维护研究事实"
        )
        scrollUntilHittable(editResearch, in: app)
        XCTAssertTrue(editResearch.waitForExistence(timeout: 10), "tracked candidate did not expose the research editor entry")
        editResearch.tap()
        let draftSource = app.staticTexts["annualDecisionBriefProfileDraftSource"].firstMatch
        scrollUntilHittable(draftSource, in: app)
        XCTAssertTrue(draftSource.waitForExistence(timeout: 10), "profile draft source state did not render")
        XCTAssertTrue(draftSource.isHittable, "candidate editor entry did not focus the bound profile source")
        let sourceBound = NSPredicate(format: "label CONTAINS %@", "已绑定当前候选和版本")
        expectation(for: sourceBound, evaluatedWith: draftSource)
        waitForExpectations(timeout: 10)
        let profileSave = findButton(in: app, identifier: "annualDecisionBriefProfileSaveButton", label: "保存研究论点")
        scrollUntilHittable(profileSave, in: app)
        XCTAssertTrue(profileSave.waitForExistence(timeout: 10), "profile editor did not expand from the dedicated candidate action")
        guard profileSave.isHittable else {
            attachScreenshot(named: "profile-save-unreachable", app: app)
            let scrollFrame = app.scrollViews["researchScrollView"].firstMatch.frame
            let tabFrame = app.tabBars.firstMatch.frame
            return XCTFail(
                "profile save did not remain reachable; button=\(profileSave.frame), scroll=\(scrollFrame), tab=\(tabFrame)"
            )
        }
        XCTAssertTrue(profileSave.isEnabled, "profile save should be enabled for the tracked current candidate")
        let evidencePage = app.buttons["annualDecisionBriefResearchPage-evidence"].firstMatch
        scrollUntilHittable(evidencePage, in: app)
        XCTAssertTrue(evidencePage.isHittable, "research editor did not expose the evidence workspace")
        evidencePage.tap()
        let evidenceSave = findButton(in: app, identifier: "annualDecisionBriefEvidenceSaveButton", label: "记录证据")
        scrollUntilHittable(evidenceSave, in: app)
        XCTAssertTrue(evidenceSave.waitForExistence(timeout: 10), "evidence editor did not expose its submit control")
        XCTAssertTrue(evidenceSave.isHittable, "evidence save did not remain reachable from the dedicated candidate action")
        XCTAssertTrue(evidenceSave.isEnabled, "evidence save should be enabled for the tracked current candidate")

        openDecisionLayer("candidate", in: app)
        expandDisclosure(identifier: "candidateManagementDisclosure", label: "研究自选管理", in: app)
        let loadBrief = findButton(
            in: app,
            identifier: "annualDecisionBriefLoad-HK.09926",
            label: "读取每日决策简报"
        )
        scrollUntilHittable(loadBrief, in: app)
        XCTAssertTrue(loadBrief.waitForExistence(timeout: 10), "tracked candidate did not expose the decision brief entry")
        loadBrief.tap()

        let state = app.staticTexts["annualDecisionBriefState"].firstMatch
        let ready = NSPredicate(format: "label == %@", "三分钟复核就绪")
        let readyExpectation = XCTNSPredicateExpectation(predicate: ready, object: state)
        guard XCTWaiter.wait(for: [readyExpectation], timeout: 10) == .completed else {
            let messageElement = app.staticTexts["annualDecisionBriefMessage"].firstMatch
            let message = messageElement.exists ? messageElement.label : "message missing"
            let stateLabel = state.exists ? state.label : "state missing"
            return XCTFail("decision brief did not become ready: \(stateLabel); \(message)")
        }
        let briefSection = app.descendants(matching: .any)["annualDecisionBriefSection"].firstMatch
        XCTAssertTrue(briefSection.waitForExistence(timeout: 10), "decision brief section did not render")
        XCTAssertTrue(app.descendants(matching: .any)["annualDecisionBriefTargetSummary"].exists)
        expandDisclosure(
            identifier: "annualDecisionBriefIdentityDisclosure",
            label: "事实来源与身份",
            in: app
        )
        let identitySummary = app.descendants(matching: .any)["annualDecisionBriefIdentitySummary"].firstMatch
        XCTAssertTrue(identitySummary.waitForExistence(timeout: 5), "decision brief identity summary is missing")
        XCTAssertTrue(identitySummary.label.contains("symbol=HK.09926"), "decision brief target symbol is not current")
        XCTAssertTrue(identitySummary.label.contains("membership=1"), "decision brief membership identity is missing")
        XCTAssertTrue(identitySummary.label.contains("version=3"), "decision brief membership version is missing")
        XCTAssertTrue(identitySummary.label.contains("context=decision-context:HK.09926"), "decision context identity is missing")
        XCTAssertTrue(identitySummary.label.contains("research="), "decision brief source times are missing")
        XCTAssertTrue(identitySummary.label.contains("quote=HK.09926"), "decision brief quote snapshot is not bound to the candidate")
        XCTAssertFalse(app.staticTexts["annualDecisionBriefWhyNow"].label.contains("未记录"), "why-now was not displayed")
        XCTAssertFalse(app.staticTexts["annualDecisionBriefThesis"].label.contains("未记录"), "thesis was not displayed")
        let counterEvidence = app.descendants(matching: .any)["annualDecisionBriefEvidence-2"].firstMatch
        scrollUntilHittable(counterEvidence, in: app)
        XCTAssertTrue(counterEvidence.exists, "counter evidence was not displayed")
        let quantAuthority = app.staticTexts["annualDecisionBriefQuantAuthority"].firstMatch
        scrollUntilHittable(quantAuthority, in: app)
        XCTAssertTrue(quantAuthority.label.contains("researchOnly=true"), "quant evidence lost research-only authority")
        XCTAssertTrue(quantAuthority.label.contains("changesCandidateOrdering=false"), "quant evidence could change candidate ordering")
        let quantMetadata = app.staticTexts["annualDecisionBriefQuantMetadata"].firstMatch
        scrollUntilHittable(quantMetadata, in: app)
        XCTAssertTrue(quantMetadata.label.contains("historical"), "historical quant freshness is not visible in the decision brief")
        XCTAssertTrue(quantMetadata.label.contains("quant_evidence"), "quant evidence provenance is not visible in the decision brief")
        XCTAssertTrue(quantMetadata.label.contains("fixture=true"), "fixture quant provenance is not visible in the decision brief")
        let quantTimes = app.staticTexts["annualDecisionBriefQuantTimes"].firstMatch
        scrollUntilHittable(quantTimes, in: app)
        XCTAssertTrue(quantTimes.label.contains("asOf="), "quant evidence as-of time is not visible in the decision brief")
        XCTAssertTrue(quantTimes.label.contains("fetchedAt="), "quant evidence fetched-at time is not visible in the decision brief")
        let safety = app.staticTexts["annualDecisionBriefSafety"].firstMatch
        scrollUntilHittable(safety, in: app)
        XCTAssertTrue(safety.label.contains("不生成推荐、排名、目标价、目标仓位、交易方向、订单或成交"), "decision brief safety boundary is missing")

        openDecisionLayer("decision", in: app)
        XCTAssertTrue(app.buttons["submitHumanCheckButton"].waitForExistence(timeout: 10))
        openDecisionLayer("review", in: app)
        XCTAssertTrue(app.descendants(matching: .any)["reviewFeedbackCard"].waitForExistence(timeout: 10))
        openDecisionLayer("evidence", in: app)
        attachScreenshot(named: "annual-decision-rings", app: app)
        let briefTitle = app.staticTexts["annualDecisionBriefTitle"].firstMatch
        scrollUntilHittable(briefTitle, in: app)
        XCTAssertTrue(briefTitle.isHittable, "decision brief title did not enter the screenshot viewport")
        scrollForward(in: app, steps: 1)
        attachScreenshot(named: "annual-decision-brief", app: app)
    }

    @MainActor
    func testAnnualValuationQuantGoldenJourneyRecomputesAndClearsStaleResults() throws {
        let app = launchResearchApp(symbol: "09926.hk")
        assertResearchLayerMenu(in: app)
        openDecisionLayer("candidate", in: app)
        expandDisclosure(identifier: "candidateManagementDisclosure", label: "研究自选管理", in: app)
        waitForAvailableCandidateMemberships(in: app)

        let selectMembership = findButton(
            in: app,
            identifier: "annualValuationQuantOpen-HK.09926",
            label: "打开估值与量化"
        )
        scrollUntilHittable(selectMembership, in: app)
        XCTAssertTrue(selectMembership.waitForExistence(timeout: 10), "HK.09926 membership selection entry is missing")
        selectMembership.tap()
        let title = app.staticTexts["annualValuationQuantTitle"].firstMatch
        scrollUntilHittable(title, in: app)
        XCTAssertTrue(title.waitForExistence(timeout: 10), "valuation quant workbench is missing")

        let valuationInputs: [(identifier: String, value: String)] = [
            ("valuationMetricCurrencyField", "HKD"),
            ("valuationBaseMetricField", "1"),
            ("valuationGrowthField", "10"),
            ("valuationHorizonField", "3"),
            ("valuationMultipleField", "10"),
            ("valuationDiscountField", "8"),
            ("valuationNetCashField", "0.5"),
            ("valuationGrowthStepField", "5"),
            ("valuationMultipleStepField", "2"),
            ("quantMaxDrawdownField", "5"),
            ("quantMaxTurnoverField", "60"),
            ("quantMinTradeCountField", "2")
        ]
        guard enterValuationInputs(valuationInputs, in: app, checkpoint: nil) else { return }
        dismissValuationKeyboard(in: app)

        let recompute = findButton(in: app, identifier: "annualValuationQuantLoadButton", label: "复算用户情景")
        scrollUntilHittable(recompute, in: app)
        XCTAssertTrue(recompute.isEnabled, "valuation quant recompute is disabled after all user inputs")
        recompute.tap()

        let presentValue = app.staticTexts["annualValuationPresentValue"].firstMatch
        let exactPresentValue = NSPredicate(format: "label == %@", "11.065907 HKD")
        expectation(for: exactPresentValue, evaluatedWith: presentValue)
        waitForExpectations(timeout: 10)
        XCTAssertEqual(app.staticTexts["annualValuationImpliedGrowth"].label, "8.00%")

        let target = app.staticTexts["annualValuationQuantTarget"].firstMatch
        scrollUntilHittable(target, in: app)
        XCTAssertTrue(target.label.contains("HK.09926"))
        XCTAssertTrue(target.label.contains("membership=1"))
        XCTAssertTrue(target.label.contains("version=3"))

        let model = app.staticTexts["annualQuantModelIdentity"].firstMatch
        scrollUntilHittable(model, in: app)
        XCTAssertTrue(model.label.contains("hk-hk.09926-none-2026-05-04-2026-05-25"))
        XCTAssertTrue(model.label.contains("8ef93e7a2dacf7d26efe0fd9ebdac74f2572219ac888e59e106357bec79d47f6"))
        XCTAssertTrue(model.label.contains("adjustment=none"))
        XCTAssertTrue(model.label.contains("universe=HK.09926"))

        let execution = app.staticTexts["annualQuantExecution"].firstMatch
        scrollUntilHittable(execution, in: app)
        XCTAssertTrue(execution.label.contains("next_trading_day_open"))
        XCTAssertTrue(execution.label.contains("手数 100"))
        XCTAssertTrue(execution.label.contains("非零费用=true"))

        let diagnostics = app.descendants(matching: .any)["annualQuantDiagnostics"].firstMatch
        scrollUntilHittable(diagnostics, in: app)
        XCTAssertTrue(diagnostics.label.contains("基准：not_captured"))
        XCTAssertTrue(diagnostics.label.contains("集中度：not_captured"))
        XCTAssertTrue(diagnostics.label.contains("失败实验：not_captured"))

        let filter = app.descendants(matching: .any)["annualQuantFilterResults"].firstMatch
        scrollUntilHittable(filter, in: app)
        let train = app.staticTexts["annualQuantFilterSample-0-train"].firstMatch
        let validation = app.staticTexts["annualQuantFilterSample-1-validation"].firstMatch
        let finalTest = app.staticTexts["annualQuantFilterSample-2-final_test"].firstMatch
        XCTAssertTrue(train.waitForExistence(timeout: 5))
        XCTAssertTrue(validation.waitForExistence(timeout: 5))
        XCTAssertTrue(finalTest.waitForExistence(timeout: 5))
        XCTAssertLessThan(train.frame.minY, validation.frame.minY)
        XCTAssertLessThan(validation.frame.minY, finalTest.frame.minY)
        XCTAssertTrue([train, validation, finalTest].allSatisfy { $0.label.contains("条件匹配 是") })

        let safety = app.staticTexts["annualValuationQuantSafety"].firstMatch
        scrollUntilHittable(safety, in: app)
        XCTAssertTrue(safety.label.contains("不是系统目标价、评分、排序、推荐、仓位、方向或交易动作"))
        openDecisionLayer("evidence", in: app)
        scrollUntilHittable(presentValue, in: app)
        attachScreenshot(named: "annual-valuation-quant", app: app)

        openDecisionLayer("evidence", in: app)
        let changedGrowth = app.textFields["valuationGrowthField"].firstMatch
        scrollUntilHittable(changedGrowth, in: app)
        replaceTrailingText(in: changedGrowth, with: "11", app: app)
        let cleared = app.staticTexts["annualValuationQuantFailClosed"].firstMatch
        let clearedPredicate = NSPredicate(format: "label CONTAINS %@", "用户输入已变化")
        expectation(for: clearedPredicate, evaluatedWith: cleared)
        waitForExpectations(timeout: 10)
        XCTAssertFalse(app.staticTexts["annualValuationPresentValue"].exists, "old valuation survived a user-input change")
    }

    @MainActor
    func testAnnualPortfolioLabGoldenJourneyBindsOrderedScenariosAndClearsChangedAmounts() throws {
        let app = launchResearchApp(symbol: "09926.hk", authToken: "owner-read-token")
        assertResearchLayerMenu(in: app)
        openDecisionLayer("candidate", in: app)
        expandDisclosure(identifier: "candidateManagementDisclosure", label: "研究自选管理", in: app)
        waitForAvailableCandidateMemberships(in: app)

        let openLab = findButton(
            in: app,
            identifier: "annualPortfolioLabOpen-HK.09926",
            label: "打开组合实验室"
        )
        XCTAssertTrue(openLab.waitForExistence(timeout: 10), "HK.09926 portfolio lab entry is missing")
        scrollUntilHittable(openLab, in: app)
        openLab.tap()

        let title = app.staticTexts["annualPortfolioLabTitle"].firstMatch
        XCTAssertTrue(title.waitForExistence(timeout: 10), "portfolio lab did not open inside the portfolio ring")
        scrollUntilHittable(title, in: app)
        let amountInput = app.textFields["annualPortfolioLabAmountsInput"].firstMatch
        XCTAssertTrue(amountInput.waitForExistence(timeout: 10), "portfolio lab amount input is missing")
        scrollUntilHittable(amountInput, in: app)
        replaceText(in: amountInput, with: "25000,5000", app: app)
        XCTAssertEqual(amountInput.value as? String, "25000,5000", "portfolio lab amount input did not preserve exact user order")
        let keyboardDone = findButton(
            in: app,
            identifier: "annualPortfolioLabKeyboardDone",
            label: "收起情景金额键盘"
        )
        XCTAssertTrue(keyboardDone.waitForExistence(timeout: 5), "portfolio lab numeric keyboard has no explicit dismissal control")
        keyboardDone.tap()
        let run = findButton(in: app, identifier: "annualPortfolioLabRunButton", label: "并列比较用户情景")
        scrollUntilHittable(run, in: app)
        XCTAssertEqual(run.value as? String, "可读取", "unexpected portfolio lab readiness: \(String(describing: run.value))")
        expectation(for: NSPredicate(format: "enabled == true"), evaluatedWith: run)
        waitForExpectations(timeout: 15)
        XCTAssertTrue(
            run.isEnabled,
            "the account-bound portfolio lab should supersede an older context refresh once membership, symbol, and amounts are valid"
        )
        run.tap()

        let status = app.staticTexts["annualPortfolioLabStatus"].firstMatch
        expectation(for: NSPredicate(format: "label == %@", "available"), evaluatedWith: status)
        waitForExpectations(timeout: 10)
        let target = app.staticTexts["annualPortfolioLabTarget"].firstMatch
        scrollUntilHittable(target, in: app)
        XCTAssertTrue(target.label.contains("HK.09926"))
        XCTAssertTrue(target.label.contains("membership 1"))
        XCTAssertTrue(target.label.contains("version 3"))
        let snapshot = app.staticTexts["annualPortfolioLabSnapshotIdentity"].firstMatch
        scrollUntilHittable(snapshot, in: app)
        XCTAssertTrue(snapshot.label.contains("owner-main"))
        XCTAssertTrue(snapshot.label.contains("pingan-current-portfolio:fixture"))

        let firstAmount = app.staticTexts["annualPortfolioLabScenarioAmount-0"].firstMatch
        let secondAmount = app.staticTexts["annualPortfolioLabScenarioAmount-1"].firstMatch
        scrollUntilHittable(firstAmount, in: app)
        XCTAssertTrue(firstAmount.label.contains("25,000"), "first user scenario order was not preserved")
        XCTAssertTrue(secondAmount.label.contains("5,000"), "second user scenario order was not preserved")
        XCTAssertEqual(app.staticTexts["annualPortfolioLabScenarioWeight-0"].label, "60.00%")
        XCTAssertEqual(app.staticTexts["annualPortfolioLabScenarioWeight-1"].label, "52.38%")
        XCTAssertEqual(app.staticTexts["annualPortfolioLabCurrentRiskContribution"].label, "-115.39%")
        XCTAssertEqual(app.staticTexts["annualPortfolioLabScenarioRiskContribution-0"].label, "-26.83%")

        let coverage = app.staticTexts["annualPortfolioLabQuantCoverage"].firstMatch
        scrollUntilHittable(coverage, in: app)
        XCTAssertTrue(coverage.label.contains("exact"))
        XCTAssertTrue(coverage.label.contains("HK.03800, HK.09926"))
        XCTAssertTrue(coverage.label.contains("缺失 无"))
        let correlation = app.staticTexts["annualPortfolioLabCorrelationWindow"].firstMatch
        XCTAssertTrue(correlation.label.contains("n=4"))
        XCTAssertTrue(correlation.label.contains("insufficient_tiny_sample"))
        let liquidity = app.staticTexts["annualPortfolioLabLiquidity"].firstMatch
        scrollUntilHittable(liquidity, in: app)
        XCTAssertTrue(liquidity.label.contains("board lot 100"))
        XCTAssertTrue(liquidity.label.contains("non-zero costs true"))
        let boundary = app.staticTexts["annualPortfolioLabBoundary"].firstMatch
        scrollUntilHittable(boundary, in: app)
        XCTAssertTrue(boundary.label.contains("不生成优选情景、建议金额、目标权重、方向、股数或订单"))

        expandDisclosure(identifier: "crossStockPortfolioLabComparison", label: "跨股票组合风险比较", in: app)
        let comparePicker = app.descendants(matching: .any)["crossStockPortfolioLabMembershipPicker"].firstMatch
        scrollUntilHittable(comparePicker, in: app)
        XCTAssertTrue(comparePicker.waitForExistence(timeout: 5), "cross-stock portfolio picker is missing")
        comparePicker.tap()
        let compareOption = app.buttons["HK.03800 · GCL Technology"].firstMatch
        XCTAssertTrue(compareOption.waitForExistence(timeout: 5), "HK.03800 is missing from tracked comparison stocks")
        compareOption.tap()
        let compareRun = findButton(in: app, identifier: "loadCrossStockPortfolioLabButton", label: "读取同金额组合风险")
        scrollUntilHittable(compareRun, in: app)
        XCTAssertTrue(compareRun.isEnabled, "cross-stock portfolio comparison is disabled after an exact tracked selection")
        compareRun.tap()

        let pairIdentity = app.descendants(matching: .any)["crossStockPortfolioLabIdentity"].firstMatch
        scrollUntilHittable(pairIdentity, in: app)
        XCTAssertTrue(pairIdentity.label.contains("HK.09926 #1 v3 ↔ HK.03800 #2 v2"))
        let sharedVersion = app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "2026-06-20")).firstMatch
        scrollUntilHittable(sharedVersion, in: app)
        XCTAssertTrue(sharedVersion.exists)
        let universeVersion = app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "2026-06-01 · 620 只")).firstMatch
        scrollUntilHittable(universeVersion, in: app)
        XCTAssertTrue(universeVersion.exists)
        let riskConclusion = app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "同一量化窗口下的假设金额变化")).firstMatch
        scrollUntilHittable(riskConclusion, in: app)
        XCTAssertTrue(riskConclusion.label.contains("不构成投资建议"))
        attachScreenshot(named: "annual-portfolio-lab", app: app)

        XCTAssertTrue(selectWorkspace("dailyPortfolioWorkspace-current", in: app))
        XCTAssertTrue(
            app.descendants(matching: .any)["dailyPortfolioWorkspace-current"].firstMatch.isSelected,
            "current portfolio workspace did not expose selected state"
        )
        XCTAssertFalse(
            app.descendants(matching: .any)["dailyPortfolioWorkspace-lab"].firstMatch.isSelected,
            "portfolio lab remained selected after switching to current portfolio"
        )
        XCTAssertTrue(
            app.descendants(matching: .any)["portfolioDecisionTitle"].firstMatch.exists,
            "current portfolio content did not become active"
        )
        XCTAssertFalse(
            app.descendants(matching: .any)["annualPortfolioLabTitle"].firstMatch.exists,
            "portfolio lab content remained active after switching workspaces"
        )
        XCTAssertTrue(selectWorkspace("dailyPortfolioWorkspace-lab", in: app))

        scrollUntilHittable(amountInput, in: app)
        replaceText(in: amountInput, with: "5000,25000", app: app)
        let message = app.staticTexts["annualPortfolioLabMessage"].firstMatch
        expectation(for: NSPredicate(format: "label CONTAINS %@", "用户情景金额已变化"), evaluatedWith: message)
        waitForExpectations(timeout: 10)
        XCTAssertFalse(app.staticTexts["annualPortfolioLabScenarioAmount-0"].exists, "old first scenario survived amount change")
        XCTAssertFalse(app.staticTexts["annualPortfolioLabScenarioAmount-1"].exists, "old second scenario survived amount change")
    }

    @MainActor
    func testAnnualConditionalDecisionGoldenJourneyFreezesBoundFactsAndRejectsStalePreview() throws {
        let app = launchResearchApp(symbol: "09926.hk", authToken: "conditional-decision-read-token")
        guard prepareAnnualConditionalDecisionPrerequisites(in: app) else { return }

        let scenarioCount = app.staticTexts["annualConditionalScenarioCount"].firstMatch
        XCTAssertTrue(scenarioCount.waitForExistence(timeout: 10), "conditional decision scenario count is missing")
        XCTAssertTrue(scenarioCount.label.contains("2"), "conditional decision did not preserve both user-ordered scenarios")

        let previewButton = findButton(
            in: app,
            identifier: "annualConditionalDecisionPreviewButton",
            label: "冻结当前事实"
        )
        scrollUntilHittable(previewButton, in: app)
        XCTAssertTrue(previewButton.isEnabled, "conditional decision preview is disabled after every prerequisite is current")
        previewButton.tap()

        let status = app.staticTexts["annualConditionalDecisionStatus"].firstMatch
        expectation(for: NSPredicate(format: "label == %@", "available"), evaluatedWith: status)
        waitForExpectations(timeout: 15)

        let previewId = app.staticTexts["annualConditionalPreviewId"].firstMatch
        scrollUntilHittable(previewId, in: app)
        XCTAssertEqual(
            previewId.label,
            "annual-conditional-preview:cfe42c7b6bd6f9b6baf9fc6eaf54b01fd79c6e24f86e9e8e63545c4388b0455f"
        )
        let target = app.staticTexts["annualConditionalTarget"].firstMatch
        XCTAssertTrue(target.label.contains("HK.09926"))
        XCTAssertTrue(target.label.contains("membership=1"))
        XCTAssertTrue(target.label.contains("version=3"))
        XCTAssertEqual(app.staticTexts["annualConditionalThesis"].firstMatch.label, "研发进展是核心假设。")

        let valuation = app.staticTexts["annualConditionalValuation"].firstMatch
        scrollUntilHittable(valuation, in: app)
        XCTAssertTrue(valuation.label.contains("quote=63.5"), valuation.label)
        XCTAssertTrue(valuation.label.contains("user scenario=42.1356"), valuation.label)
        XCTAssertTrue(valuation.label.contains("implied growth=32.21%"), valuation.label)
        let quant = app.staticTexts["annualConditionalQuantIdentity"].firstMatch
        scrollUntilHittable(quant, in: app)
        XCTAssertTrue(quant.label.contains("ios-fixture-hk.09926-2026-05-04-2026-05-25"), quant.label)
        XCTAssertTrue(quant.label.contains("ios-candidate-fixture-baseline-experiment"), quant.label)
        XCTAssertTrue(quant.label.contains("cutoff=not_captured"), quant.label)

        let portfolio = app.staticTexts["annualConditionalPortfolioIdentity"].firstMatch
        scrollUntilHittable(portfolio, in: app)
        XCTAssertTrue(portfolio.label.contains("account=owner-main"))
        XCTAssertTrue(portfolio.label.contains("portfolio=pingan-current-portfolio:fixture"))
        let risk = app.staticTexts["annualConditionalRiskIdentity"].firstMatch
        scrollUntilHittable(risk, in: app)
        XCTAssertTrue(risk.label.contains("annual-portfolio-scenario:f526a05ae9e90fe67eda5aa23e392a57d6ab5ef9fa217c938a28e83fef807f71"))
        XCTAssertTrue(risk.label.contains("portfolio-risk-impact:dbf66a464bbc03573095541f5173fea84dd3dbf8d873d8fc05c2d63f0bf053a1"))
        XCTAssertTrue(risk.label.contains("amount=25,000"))
        let opportunityCost = app.staticTexts["annualConditionalOpportunityCost"].firstMatch
        scrollUntilHittable(opportunityCost, in: app)
        XCTAssertTrue(opportunityCost.label.contains("Cash and funding source are unknown"))
        let safety = app.staticTexts["annualConditionalDecisionSafety"].firstMatch
        scrollUntilHittable(safety, in: app)
        XCTAssertTrue(safety.label.contains("无推荐、排序、目标价、目标仓位、方向、订单或自动状态变化"))
        attachScreenshot(named: "annual-conditional-decision", app: app)

        scrollUntilHittable(previewButton, in: app)
        previewButton.tap()
        let loading = app.staticTexts["annualConditionalDecisionMessage"].firstMatch
        expectation(for: NSPredicate(format: "label CONTAINS %@", "正在由服务端重读"), evaluatedWith: loading)
        waitForExpectations(timeout: 5)

        let scenarioPicker = app.buttons["annualConditionalScenarioPicker"].firstMatch
        scrollUntilHittable(scenarioPicker, in: app)
        XCTAssertTrue(scenarioPicker.isHittable, "conditional scenario picker is not reachable during the delayed preview")
        scenarioPicker.tap()
        let secondScenario = app.descendants(matching: .any)
            .matching(NSPredicate(format: "label BEGINSWITH %@", "情景 2"))
            .firstMatch
        XCTAssertTrue(secondScenario.waitForExistence(timeout: 5), "second conditional scenario option is missing")
        secondScenario.tap()

        let invalidated = app.staticTexts["annualConditionalDecisionMessage"].firstMatch
        expectation(for: NSPredicate(format: "label CONTAINS %@", "选中组合情景已变化"), evaluatedWith: invalidated)
        waitForExpectations(timeout: 5)
        let stalePreviewReappeared = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "label == %@", "available"),
            object: status
        )
        stalePreviewReappeared.isInverted = true
        XCTAssertEqual(
            XCTWaiter.wait(for: [stalePreviewReappeared], timeout: 5),
            .completed,
            "the delayed scenario-0 preview reappeared after scenario 1 became current"
        )
        XCTAssertEqual(status.label, "unavailable")
        XCTAssertFalse(app.descendants(matching: .any)["annualConditionalFrozenPreview"].exists)
        XCTAssertFalse(app.staticTexts["annualConditionalPreviewId"].exists)
        XCTAssertFalse(findButton(in: app, identifier: "submitHumanCheckButton", label: "记录条件判断").isEnabled)
        attachScreenshot(named: "annual-conditional-decision-fail-closed", app: app)
    }

    @MainActor
    func testCandidateOverviewEmptyShowsNoRows() throws {
        assertCandidateOverviewFailsClosed(authToken: "candidate-empty")
    }

    @MainActor
    func testCandidateOverviewUnauthorizedShowsNoRows() throws {
        assertCandidateOverviewFailsClosed(authToken: "candidate-unauthorized")
    }

    @MainActor
    func testCandidateOverviewUnavailableShowsNoRows() throws {
        assertCandidateOverviewFailsClosed(authToken: "candidate-unavailable")
    }

    @MainActor
    func testCandidateOverviewMalformedShowsNoRows() throws {
        assertCandidateOverviewFailsClosed(authToken: "candidate-malformed")
    }

    @MainActor
    func testCandidateRefreshDoesNotHideCurrentJourney() throws {
        let app = launchResearchApp(authToken: "candidate-missing-quote")

        openDecisionLayer("candidate", in: app)
        selectWorkspace("dailyCandidateWorkspace-overview", in: app)
        XCTAssertTrue(app.staticTexts["candidateQuoteStatus-HK.00175"].waitForExistence(timeout: 10))
        XCTAssertEqual(app.staticTexts["candidateQuoteStatus-HK.00175"].label, "行情暂不可用")
        openEvidenceWorkspace("facts", in: app)
        XCTAssertTrue(app.staticTexts["researchSymbol"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["decisionContextSymbol"].waitForExistence(timeout: 10))

        openDecisionLayer("candidate", in: app)
        let refresh = findButton(in: app, identifier: "refreshCandidatesButton", label: "刷新")
        XCTAssertTrue(refresh.waitForExistence(timeout: 5), "candidate refresh button is missing")
        refresh.tap()

        openEvidenceWorkspace("facts", in: app)
        XCTAssertTrue(app.staticTexts["researchSymbol"].waitForExistence(timeout: 10))
        XCTAssertEqual(app.staticTexts["researchSymbol"].label, "HK.00175")
        XCTAssertTrue(app.staticTexts["decisionContextSymbol"].waitForExistence(timeout: 10))
        XCTAssertEqual(app.staticTexts["decisionContextSymbol"].label, "HK.00175")
    }

    @MainActor
    func testAnnualRingsEightQuestionGoldenJourneyCreatesAuditedLearning() throws {
        executionTimeAllowance = 900
        let journeyStartedAt = Date()
        let checkpoint: (String) -> Void = { name in
            let elapsed = Int(Date().timeIntervalSince(journeyStartedAt) * 1_000)
            NSLog("EIGHT_QUESTION_CHECKPOINT %@ elapsedMs=%d", name, elapsed)
        }
        defer { XCUIDevice.shared.orientation = .portrait }
        XCUIDevice.shared.orientation = .portrait
        let app = launchResearchApp(
            symbol: "09926.hk",
            authToken: "conditional-decision-read-token"
        )
        checkpoint("launch")
        guard prepareAnnualConditionalDecisionPrerequisites(
            in: app,
            validatesEightQuestions: true,
            checkpoint: checkpoint
        ) else { return }
        checkpoint("prerequisites")

        let previewButton = findButton(
            in: app,
            identifier: "annualConditionalDecisionPreviewButton",
            label: "冻结当前事实"
        )
        scrollUntilHittable(previewButton, in: app)
        previewButton.tap()
        let previewStatus = app.staticTexts["annualConditionalDecisionStatus"].firstMatch
        expectation(for: NSPredicate(format: "label == %@", "available"), evaluatedWith: previewStatus)
        waitForExpectations(timeout: 15)

        for (identifier, expectedFragment) in [
            ("annualConditionalPreviewId", "annual-conditional-preview"),
            ("annualConditionalTarget", "membership=1"),
            ("annualConditionalQuantIdentity", "snapshot="),
            ("annualConditionalPortfolioIdentity", "account="),
            ("annualConditionalRiskIdentity", "scenario=")
        ] {
            let source = app.staticTexts[identifier].firstMatch
            assertReadableMovingForward(
                source,
                in: app,
                message: "conditional-decision source \(identifier) is not reachable in the eight-question journey"
            )
            XCTAssertTrue(source.label.contains(expectedFragment), "conditional-decision source \(identifier) lost its bound identity")
        }
        let opportunityCost = app.staticTexts["annualConditionalOpportunityCost"].firstMatch
        assertReadableMovingForward(
            opportunityCost,
            in: app,
            message: "conditional-decision opportunity cost is not reachable in the eight-question journey"
        )
        XCTAssertTrue(opportunityCost.label.contains("Cash and funding source are unknown"), "question 6 lost explicit opportunity-cost gaps")

        let assumptions = app.textFields["annualConditionalAssumptionsField"].firstMatch
        replaceText(in: assumptions, with: "商业采用保持可核验。", app: app)
        dismissConditionalKeyboard(in: app)
        XCTAssertEqual(assumptions.value as? String, "商业采用保持可核验。", "question 7 lost the human condition")
        assertReadableMovingForward(
            assumptions,
            in: app,
            message: "question 7 assumptions are not reachable in the eight-question journey"
        )

        let invalidation = app.textFields["annualConditionalInvalidationField"].firstMatch
        replaceText(in: invalidation, with: "商业采用低于声明阈值。", app: app)
        dismissConditionalKeyboard(in: app)
        XCTAssertEqual(invalidation.value as? String, "商业采用低于声明阈值。", "question 7 lost the invalidation condition")
        assertReadableMovingForward(
            invalidation,
            in: app,
            message: "question 7 invalidation condition is not reachable in the eight-question journey"
        )

        let portfolioThreshold = app.textFields["annualConditionalPortfolioThresholdField"].firstMatch
        replaceText(in: portfolioThreshold, with: "90", app: app)
        dismissConditionalKeyboard(in: app)
        let portfolioRationale = app.textFields["annualConditionalPortfolioRationaleField"].firstMatch
        replaceText(in: portfolioRationale, with: "同一用户金额情景达到该暴露水平时，仅请求人工复核。", app: app)
        dismissConditionalKeyboard(in: app)
        checkpoint("conditions")

        let conditionalSafety = app.staticTexts["annualConditionalDecisionSafety"].firstMatch
        assertReadableMovingForward(
            conditionalSafety,
            in: app,
            message: "conditional-decision safety boundary is not reachable in the eight-question journey"
        )
        XCTAssertTrue(conditionalSafety.label.contains("无推荐、排序、目标价、目标仓位、方向、订单或自动状态变化"))

        let writeButton = findButton(in: app, identifier: "submitHumanCheckButton", label: "记录条件判断")
        scrollForwardUntilHittable(writeButton, in: app)
        XCTAssertTrue(writeButton.waitForExistence(timeout: 5), "submit human check button is missing")
        XCTAssertTrue(writeButton.isHittable, "submit human check button is not hittable")
        attachScreenshot(named: "selected-symbol-decision-screen", app: app)
        expectation(for: NSPredicate(format: "enabled == true"), evaluatedWith: writeButton)
        waitForExpectations(timeout: 5)
        writeButton.tap()

        let decisionMessage = app.descendants(matching: .any)["researchDecisionMessage"].firstMatch
        let predicate = NSPredicate(format: "label CONTAINS %@", "without creating an order, trade, cash movement, fee, or position mutation")
        expectation(for: predicate, evaluatedWith: decisionMessage)
        waitForExpectations(timeout: 10)
        XCTAssertTrue(
            decisionMessage.label.contains("without creating an order, trade, cash movement, fee, or position mutation"),
            "decision submission state: \(decisionMessage.label)"
        )
        checkpoint("decision-submit")

        openDecisionLayer("decision", in: app)
        selectWorkspace("dailyHumanDecisionWorkspace-snapshot", in: app)
        let submittedIdentity = app.staticTexts["submittedDecisionCheckId"].firstMatch
        assertReadableMovingForward(
            submittedIdentity,
            in: app,
            message: "submitted check identity is not reachable in the eight-question journey"
        )
        let humanCheckResult = app.staticTexts["submittedDecisionHumanCheckResult"].firstMatch
        assertReadableMovingForward(
            humanCheckResult,
            in: app,
            message: "submitted human-check result is not reachable in the eight-question journey"
        )
        XCTAssertEqual(humanCheckResult.label, "needs_more_evidence")
        let submittedSnapshot = app.staticTexts["submittedDecisionSnapshot"].firstMatch
        assertReadableMovingForward(
            submittedSnapshot,
            in: app,
            message: "submitted decision snapshot is not reachable in the eight-question journey"
        )
        XCTAssertTrue(submittedSnapshot.label.contains("preserved"))
        XCTAssertTrue(submittedSnapshot.label.contains("组合=current"))
        XCTAssertTrue(submittedSnapshot.label.contains("风险=captured"))
        let safetyEvidence = app.staticTexts["submittedDecisionSafetyEvidence"].firstMatch
        assertReadableMovingForward(
            safetyEvidence,
            in: app,
            message: "submitted safety evidence is not reachable in the eight-question journey"
        )
        let conditionalAvailability = app.staticTexts["submittedConditionalDecisionAvailability"].firstMatch
        assertReadableMovingForward(
            conditionalAvailability,
            in: app,
            message: "submitted conditional availability is not reachable in the eight-question journey"
        )
        XCTAssertEqual(conditionalAvailability.label, "preserved")
        let conditionalConfidence = app.staticTexts["submittedConditionalConfidence"].firstMatch
        assertReadableMovingForward(
            conditionalConfidence,
            in: app,
            message: "submitted conditional confidence is not reachable in the eight-question journey"
        )
        XCTAssertEqual(conditionalConfidence.label, "中")
        let submittedReviewCondition = app.staticTexts
            .matching(NSPredicate(format: "label CONTAINS %@", "仅触发人工复核"))
            .firstMatch
        assertReadableMovingForward(
            submittedReviewCondition,
            in: app,
            message: "submitted portfolio review condition is not reachable in the eight-question journey"
        )
        let conditionalWorkflow = app.staticTexts["submittedConditionalWorkflow"].firstMatch
        assertReadableMovingForward(
            conditionalWorkflow,
            in: app,
            message: "submitted conditional workflow is not reachable in the eight-question journey"
        )
        XCTAssertEqual(conditionalWorkflow.label, "继续研究")
        let conditionalMonitor = app.staticTexts["submittedConditionalMonitor"].firstMatch
        assertReadableMovingForward(
            conditionalMonitor,
            in: app,
            message: "submitted conditional monitor is not reachable in the eight-question journey"
        )
        XCTAssertTrue(conditionalMonitor.label.contains("watching"))
        XCTAssertTrue(conditionalMonitor.label.contains("事实身份未变化"))
        XCTAssertTrue(safetyEvidence.label.contains("createsOrder=false"))
        XCTAssertTrue(safetyEvidence.label.contains("createsTrade=false"))
        XCTAssertTrue(safetyEvidence.label.contains("mutatesCash=false"))
        XCTAssertTrue(safetyEvidence.label.contains("writesFee=false"))
        XCTAssertTrue(safetyEvidence.label.contains("mutatesPosition=false"))
        XCTAssertTrue(safetyEvidence.label.contains("callsBroker=false"))
        attachScreenshot(named: "submitted-check-result", app: app)
        checkpoint("snapshot")

        openDecisionLayer("review", in: app)
        let reviewSafety = app.staticTexts["decisionReviewSafety"].firstMatch
        assertReadableMovingForward(
            reviewSafety,
            in: app,
            message: "review safety boundary is not reachable in the eight-question journey"
        )
        let reviewSnapshot = app.descendants(matching: .any)["reviewDecisionFullSnapshotAvailability"].firstMatch
        assertReadableMovingForward(
            reviewSnapshot,
            in: app,
            message: "review history decision snapshot is not reachable in the eight-question journey"
        )
        XCTAssertTrue(reviewSnapshot.waitForExistence(timeout: 10), "review history decision snapshot is missing")
        XCTAssertTrue(reviewSnapshot.label.contains("preserved"))
        let reviewConditional = app.staticTexts["submittedConditionalDecisionAvailability"].firstMatch
        XCTAssertTrue(reviewConditional.waitForExistence(timeout: 10))
        XCTAssertEqual(reviewConditional.label, "preserved")
        let reviewButton = findButton(in: app, identifier: "submitDecisionReviewButton", label: "提交复盘")
        if reviewButton.exists {
            XCTAssertFalse(reviewButton.isEnabled, "conditional review must require an explicit correction and process lesson")
        }

        guard enterReviewLearningInputs(
            [
                ("reviewLearningJudgmentCorrectionField", "保留原判断，但将证据不足明确改为待核验条件。"),
                ("reviewLearningProcessLessonField", "先核对反方证据与事实时点，再解释结果。"),
                ("reviewLearningNextQuestionField", "哪个披露事实最能区分采用趋势与短期渠道波动？")
            ],
            in: app,
            checkpoint: checkpoint
        ) else { return }
        dismissReviewLearningKeyboard(in: app)
        let enabledReviewButton = findButton(
            in: app,
            identifier: "submitDecisionReviewButton",
            label: "提交复盘"
        )
        let reviewEnabled = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "enabled == true"),
            object: enabledReviewButton
        )
        XCTAssertEqual(
            XCTWaiter.wait(for: [reviewEnabled], timeout: 5),
            .completed,
            "complete review learning should enable append-only submission"
        )
        scrollForwardUntilHittable(enabledReviewButton, in: app)

        enabledReviewButton.tap()

        let reviewSubmitMessage = app.descendants(matching: .any)["decisionReviewSubmitMessage"].firstMatch
        let reviewSubmitPredicate = NSPredicate(format: "label CONTAINS %@", "without creating an order, trade, cash movement, fee, position mutation, or broker call")
        let reviewSubmitCompleted = XCTNSPredicateExpectation(predicate: reviewSubmitPredicate, object: reviewSubmitMessage)
        guard XCTWaiter.wait(for: [reviewSubmitCompleted], timeout: 10) == .completed else {
            return XCTFail("review-learning submission did not complete: \(reviewSubmitMessage.label)")
        }
        checkpoint("review-submit")
        let humanConclusion = app.descendants(matching: .any)["decisionReviewHumanConclusionTitle"].firstMatch
        scrollUntilVisible(humanConclusion, in: app)
        XCTAssertTrue(humanConclusion.exists, "portfolio review human conclusion is missing")
        assertReadableMovingForward(
            app.staticTexts["decisionReviewReviewedAt"].firstMatch,
            in: app,
            message: "question 8 review time is not reachable in the eight-question journey"
        )
        assertReadableMovingForward(
            app.staticTexts["reviewLearningFactsAt"].firstMatch,
            in: app,
            message: "question 8 later-facts time is not reachable in the eight-question journey"
        )
        let monitorState = app.staticTexts["reviewLearningMonitorState"].firstMatch
        assertReadableMovingForward(
            monitorState,
            in: app,
            message: "question 8 monitor state is not reachable in the eight-question journey"
        )
        XCTAssertEqual(monitorState.label, "watching")
        let judgmentCorrection = app.staticTexts["reviewLearningJudgmentCorrection"].firstMatch
        assertReadableMovingForward(
            judgmentCorrection,
            in: app,
            message: "question 8 judgment correction is not reachable in the eight-question journey"
        )
        XCTAssertEqual(
            judgmentCorrection.label,
            "保留原判断，但将证据不足明确改为待核验条件。",
            "question 8 lost the append-only judgment correction"
        )
        let processLesson = app.staticTexts["reviewLearningProcessLesson"].firstMatch
        assertReadableMovingForward(
            processLesson,
            in: app,
            message: "question 8 process lesson is not reachable in the eight-question journey"
        )
        XCTAssertEqual(
            processLesson.label,
            "先核对反方证据与事实时点，再解释结果。"
        )
        assertReadableMovingForward(
            app.staticTexts["reviewLearningNoFactChanges"].firstMatch,
            in: app,
            message: "question 8 no-fact-change boundary is not reachable in the eight-question journey"
        )
        for identifier in [
            "decisionTimePortfolioReviewTitle",
            "reviewTimePortfolioReviewTitle",
            "neutralPortfolioComparisonTitle"
        ] {
            assertReadableMovingForward(
                app.descendants(matching: .any)[identifier].firstMatch,
                in: app,
                message: "portfolio review section \(identifier) is not reachable in the eight-question journey"
            )
        }
        let comparisonStatus = app.descendants(matching: .any)["neutralPortfolioComparisonStatus"].firstMatch
        assertReadableMovingForward(
            comparisonStatus,
            in: app,
            message: "neutral comparison status is not reachable in the eight-question journey"
        )
        XCTAssertEqual(comparisonStatus.label, "comparable")
        let unknownCash = app.descendants(matching: .any)["neutralPortfolioCashUnknown"].firstMatch
        assertReadableMovingForward(
            unknownCash,
            in: app,
            message: "neutral comparison cash boundary is not reachable in the eight-question journey"
        )
        XCTAssertTrue(unknownCash.label.contains("unknown"))
        let reviewMessage = app.descendants(matching: .any)["decisionReviewSubmitMessage"].firstMatch
        scrollForwardUntilVisible(reviewMessage, in: app)
        let reviewPredicate = NSPredicate(format: "label CONTAINS %@", "without creating an order, trade, cash movement, fee, position mutation, or broker call")
        let reviewCompleted = XCTNSPredicateExpectation(predicate: reviewPredicate, object: reviewMessage)
        guard XCTWaiter.wait(for: [reviewCompleted], timeout: 10) == .completed else {
            return XCTFail("review-learning submission did not complete: \(reviewMessage.label)")
        }
        selectWorkspace("dailyReviewWorkspace-learning", in: app)
        let learningSummaryTitle = app.descendants(matching: .any)["annualReviewLearningSummaryTitle"].firstMatch
        scrollForwardUntilHittable(learningSummaryTitle, in: app)
        XCTAssertTrue(learningSummaryTitle.exists)
        XCTAssertEqual(app.staticTexts["annualReviewLearningSummaryStatus"].firstMatch.label, "样本不足，不显示聚合")
        XCTAssertTrue(app.staticTexts["annualReviewLearningSummaryCounts"].firstMatch.label.contains("已记录学习 1"))
        XCTAssertTrue(app.staticTexts["annualReviewLearningSummaryCounts"].firstMatch.label.contains("最低 5"))
        let learningSafety = app.staticTexts["annualReviewLearningSummarySafety"].firstMatch
        XCTAssertTrue(learningSafety.exists)
        assertReadableMovingForward(
            learningSafety,
            in: app,
            message: "review-learning safety boundary is not reachable in the eight-question journey"
        )
        attachScreenshot(named: "annual-review-learning-summary", app: app)
        selectWorkspace("dailyReviewWorkspace-timeline", in: app)
        scrollForwardUntilHittable(app.staticTexts["reviewLearningJudgmentCorrection"].firstMatch, in: app)
        attachScreenshot(named: "annual-review-learning", app: app)
        attachScreenshot(named: "annual-rings-eight-question-golden", app: app)
        checkpoint("complete")
    }

    @MainActor
    func testPinganSnapshotUnavailableShowsNoPositionRows() throws {
        let app = launchResearchApp(symbol: "00005.hk")
        assertResearchLayerMenu(in: app)
        openEvidenceWorkspace("facts", in: app)
        XCTAssertTrue(app.staticTexts["selectedSymbolAlias"].waitForExistence(timeout: 10))
        XCTAssertEqual(app.staticTexts["selectedSymbolCanonical"].label, "HK.00005")
        expandDisclosure(identifier: "historicalPinganDisclosure", label: "历史研究快照", in: app)
        XCTAssertTrue(app.staticTexts["pinganSnapshotStatus"].waitForExistence(timeout: 10), "Pingan snapshot status did not load")
        XCTAssertTrue(app.staticTexts["pinganSnapshotStatus"].label.contains("unavailable"))
        XCTAssertTrue(app.staticTexts["pinganSnapshotNoPositions"].exists)
        XCTAssertFalse(app.staticTexts["pinganSnapshotPositionRow"].exists)
        XCTAssertTrue(app.staticTexts["pinganSnapshotRiskImpactBlocked"].label.contains("blocked"))
        XCTAssertTrue(app.staticTexts["pinganSnapshotAuthorityBlocked"].label.contains("brokerReconciliation=blocked"))
        XCTAssertTrue(app.staticTexts["pinganSnapshotAuthorityBlocked"].label.contains("accountTruth=blocked"))
        XCTAssertTrue(app.staticTexts["pinganSnapshotAuthorityBlocked"].label.contains("accounting=blocked"))
        XCTAssertTrue(app.staticTexts["pinganSnapshotAuthorityBlocked"].label.contains("execution=blocked"))
        attachScreenshot(named: "pingan-snapshot-unavailable", app: app)
    }

    @MainActor
    func testCurrentPortfolioNeutralRiskClearsFactsAfterBlockedRecalculation() throws {
        let app = launchResearchApp()
        assertResearchLayerMenu(in: app)
        attachScreenshot(named: "annual-decision-rings", app: app)
        openDecisionLayer("portfolio", in: app)

        let status = app.staticTexts["portfolioDecisionStatus"]
        XCTAssertTrue(status.waitForExistence(timeout: 10), "current portfolio status did not load")
        XCTAssertEqual(status.label, "available")
        XCTAssertEqual(app.staticTexts["portfolioAuthoritySource"].label, "平安导入快照")
        XCTAssertEqual(app.staticTexts["portfolioAsOf"].label, "2026-07-15T01:39:00.000Z")
        XCTAssertEqual(app.staticTexts["portfolioQuoteAsOf-HK.00175"].label, "2026-07-15T01:39:00.000Z")
        XCTAssertEqual(app.staticTexts["portfolioQuoteFetchedAt-HK.00175"].label, "2026-07-15T01:39:01.000Z")
        XCTAssertTrue(app.staticTexts["portfolioCashStatus"].label.contains("未知"))
        XCTAssertTrue(app.staticTexts["portfolioConcentration"].label.contains("最大仓位"))
        XCTAssertTrue(app.staticTexts["portfolioFactAuthorityBoundary"].label.contains("持仓=平安"))
        XCTAssertTrue(app.staticTexts["portfolioFactAuthorityBoundary"].label.contains("报价=Futu"))

        selectWorkspace("dailyPortfolioWorkspace-risk", in: app)
        let amount = app.textFields["portfolioRiskAmountInput"]
        scrollUntilHittable(amount, in: app)
        XCTAssertTrue(amount.waitForExistence(timeout: 5), "portfolio risk amount input is missing")
        amount.tap()
        amount.typeText("10000")
        let keyboardDone = findButton(
            in: app,
            identifier: "portfolioRiskKeyboardDone",
            label: "收起风险金额键盘"
        )
        XCTAssertTrue(keyboardDone.waitForExistence(timeout: 5), "portfolio risk numeric keyboard has no explicit dismissal control")
        keyboardDone.tap()

        let calculate = findButton(in: app, identifier: "calculatePortfolioRiskButton", label: "计算风险影响")
        scrollUntilHittable(calculate, in: app)
        XCTAssertTrue(calculate.waitForExistence(timeout: 5), "portfolio risk calculation button is missing")
        XCTAssertTrue(calculate.isEnabled, "portfolio risk calculation must be enabled only for current complete facts")
        calculate.tap()

        let result = app.descendants(matching: .any)["portfolioRiskResult"]
        XCTAssertTrue(result.waitForExistence(timeout: 10), "neutral portfolio risk result did not appear")
        XCTAssertEqual(app.staticTexts["portfolioRiskCandidate"].label, "HK.00175")
        XCTAssertTrue(app.staticTexts["portfolioRiskAmount"].label.contains("10,000"))
        XCTAssertEqual(app.staticTexts["portfolioRiskWeightChange"].label, "0.00%")
        XCTAssertTrue(app.staticTexts["portfolioRiskGuardrails"].label.contains("不生成方向"))
        XCTAssertTrue(app.staticTexts["portfolioRiskGuardrails"].label.contains("不创建订单"))
        scrollUntilHittable(result, in: app)
        attachScreenshot(named: "current-portfolio-neutral-risk", app: app)

        openPortfolioWorkspace("risk", in: app)
        let recalculate = findButton(in: app, identifier: "calculatePortfolioRiskButton", label: "计算风险影响")
        scrollUntilHittable(recalculate, in: app)
        XCTAssertTrue(recalculate.isHittable, "blocked recalculation trigger is not hittable")
        recalculate.tap()

        XCTAssertTrue(app.staticTexts["portfolioRiskMessage"].label.contains("blocked"))
        XCTAssertFalse(app.descendants(matching: .any)["portfolioRiskResult"].waitForExistence(timeout: 2), "old risk result remained after blocked response")
        XCTAssertFalse(findButton(in: app, identifier: "calculatePortfolioRiskButton", label: "计算风险影响").isEnabled)
        selectWorkspace("dailyPortfolioWorkspace-current", in: app)
        XCTAssertTrue(app.staticTexts["portfolioDecisionNoFacts"].waitForExistence(timeout: 10), "blocked risk response did not clear portfolio facts")
        XCTAssertTrue(app.staticTexts["portfolioDecisionMessage"].label.contains("重新读取"))
        XCTAssertFalse(app.descendants(matching: .any)["portfolioPosition-HK.00175"].exists, "old portfolio position remained after blocked response")
    }

    @MainActor
    func testDailyNextStepReviewFeedbackAndFocusedRecordsRemainReachable() throws {
        let app = launchResearchApp()
        assertResearchLayerMenu(in: app)
        XCTAssertTrue(app.descendants(matching: .any)["dailyDecisionNextStepCard"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["dailyDecisionPath"].label.contains("组合风险"))

        openDecisionLayer("review", in: app)
        XCTAssertTrue(app.descendants(matching: .any)["reviewFeedbackCard"].waitForExistence(timeout: 10))
        expandDisclosure(identifier: "localReviewRecordsDisclosure", label: "本地记录与复盘知识", in: app)
        XCTAssertTrue(app.descendants(matching: .any)["focusedLocalReviewRecordsSection"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["focusedLocalReviewRecordSafety"].label.contains("不会上传 API"))
        XCTAssertFalse(app.descendants(matching: .any)["assistMobileWorkspaceSection"].exists)
        XCTAssertFalse(app.staticTexts["assistMobileWorkspacePortfolioOmitted"].exists)
        XCTAssertFalse(app.staticTexts["assistMobileWorkspacePinganHistoricalOnly"].exists)
    }

    @MainActor
    func testCurrentPortfolioStaleRemainsVisibleAndDisablesRisk() throws {
        assertCurrentPortfolioWarning(authToken: "portfolio-stale", expectedStatus: "stale")
    }

    @MainActor
    func testCurrentPortfolioPartialRemainsVisibleAndDisablesRisk() throws {
        assertCurrentPortfolioWarning(authToken: "portfolio-partial", expectedStatus: "partial")
    }

    @MainActor
    func testCurrentPortfolioConflictClearsPriorFacts() throws {
        assertCurrentPortfolioMaterialFailure(authToken: "portfolio-conflict")
    }

    @MainActor
    func testCurrentPortfolioUnauthorizedClearsPriorFacts() throws {
        assertCurrentPortfolioMaterialFailure(authToken: "portfolio-unauthorized")
    }

    @MainActor
    func testCurrentPortfolioOfflineClearsPriorFacts() throws {
        assertCurrentPortfolioMaterialFailure(authToken: "portfolio-offline")
    }

    @MainActor
    func testCurrentPortfolioMalformedClearsPriorFacts() throws {
        assertCurrentPortfolioMaterialFailure(authToken: "portfolio-malformed")
    }

    @MainActor
    func testMismatchedRiskResponseClearsCurrentFacts() throws {
        let app = launchResearchApp(authToken: "portfolio-risk-mismatch")
        openDecisionLayer("portfolio", in: app)
        XCTAssertTrue(app.staticTexts["portfolioDecisionStatus"].waitForExistence(timeout: 10))
        XCTAssertEqual(app.staticTexts["portfolioDecisionStatus"].label, "available")
        replacePortfolioRiskAmount(in: app, with: "10000")

        let calculate = findButton(in: app, identifier: "calculatePortfolioRiskButton", label: "计算风险影响")
        scrollUntilHittable(calculate, in: app)
        calculate.tap()
        XCTAssertTrue(app.descendants(matching: .any)["portfolioRiskResult"].waitForExistence(timeout: 10))

        scrollUntilHittable(calculate, in: app)
        calculate.tap()
        XCTAssertTrue(app.staticTexts["portfolioRiskMessage"].label.contains("不匹配"))
        XCTAssertFalse(app.descendants(matching: .any)["portfolioRiskResult"].exists)
        selectWorkspace("dailyPortfolioWorkspace-current", in: app)
        XCTAssertTrue(app.staticTexts["portfolioDecisionNoFacts"].waitForExistence(timeout: 10))
    }

    @MainActor
    func testAmountChangeKeepsNewerRiskSuccessAfterOlderFailure() throws {
        let app = launchResearchApp(authToken: "portfolio-risk-delay-amount")
        openDecisionLayer("portfolio", in: app)
        XCTAssertTrue(app.staticTexts["portfolioDecisionStatus"].waitForExistence(timeout: 10))
        XCTAssertEqual(app.staticTexts["portfolioDecisionStatus"].label, "available")

        replacePortfolioRiskAmount(in: app, with: "10000")
        let calculate = findButton(in: app, identifier: "calculatePortfolioRiskButton", label: "计算风险影响")
        scrollUntilHittable(calculate, in: app)
        calculate.tap()
        replacePortfolioRiskAmount(in: app, with: "20000")
        scrollUntilHittable(calculate, in: app)
        XCTAssertTrue(calculate.isEnabled)
        calculate.tap()

        XCTAssertTrue(app.descendants(matching: .any)["portfolioRiskResult"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["portfolioRiskAmount"].label.contains("20,000"))
        Thread.sleep(forTimeInterval: 1.2)
        XCTAssertTrue(app.descendants(matching: .any)["portfolioRiskResult"].exists, "older failure cleared the newer success")
        selectWorkspace("dailyPortfolioWorkspace-current", in: app)
        XCTAssertTrue(app.descendants(matching: .any)["portfolioPosition-HK.00175"].exists, "older failure cleared the bound context")
    }

    @MainActor
    func testSymbolChangeKeepsReloadedContextAfterOlderRiskFailure() throws {
        let app = launchResearchApp(authToken: "portfolio-risk-delay-symbol")
        openDecisionLayer("portfolio", in: app)
        XCTAssertTrue(app.staticTexts["portfolioDecisionStatus"].waitForExistence(timeout: 10))
        replacePortfolioRiskAmount(in: app, with: "10000")
        let calculate = findButton(in: app, identifier: "calculatePortfolioRiskButton", label: "计算风险影响")
        scrollUntilHittable(calculate, in: app)
        calculate.tap()

        openDecisionLayer("candidate", in: app)
        assertCandidateOverviewAvailable(in: app)
        let selectHSBC = findButton(in: app, identifier: "selectCandidate-HK.00005", label: "查看辅助决策")
        scrollUntilHittable(selectHSBC, in: app)
        selectHSBC.tap()
        XCTAssertTrue(app.staticTexts["selectedSymbolCanonical"].waitForExistence(timeout: 10))
        XCTAssertEqual(app.staticTexts["selectedSymbolCanonical"].label, "HK.00005")
        Thread.sleep(forTimeInterval: 1.2)

        openDecisionLayer("portfolio", in: app)
        selectWorkspace("dailyPortfolioWorkspace-current", in: app)
        let portfolioStatus = app.staticTexts["portfolioDecisionStatus"]
        XCTAssertTrue(portfolioStatus.waitForExistence(timeout: 10))
        expectation(for: NSPredicate(format: "label == %@", "available"), evaluatedWith: portfolioStatus)
        waitForExpectations(timeout: 10)
        XCTAssertTrue(app.descendants(matching: .any)["portfolioPosition-HK.00175"].exists)
        XCTAssertFalse(app.descendants(matching: .any)["portfolioRiskResult"].exists)
    }

    @MainActor
    private func decideSuggestionWithButton(identifier: String, label: String) throws {
        let app = launchResearchApp()

        openEvidenceWorkspace("facts", in: app)
        XCTAssertTrue(app.staticTexts["researchSymbol"].waitForExistence(timeout: 10), "research profile did not load")
        let thesisText = app.staticTexts["researchCurrentThesisText"]
        XCTAssertTrue(thesisText.exists, "current thesis text is missing")
        let originalThesis = thesisText.label

        let acceptButton = findButton(in: app, identifier: "acceptSuggestionButton", label: "接受")
        let rejectButton = findButton(in: app, identifier: "rejectSuggestionButton", label: "拒绝")
        XCTAssertTrue(acceptButton.waitForExistence(timeout: 5), "accept suggestion button is missing")
        XCTAssertTrue(rejectButton.waitForExistence(timeout: 5), "reject suggestion button is missing")

        let actionButton = findButton(in: app, identifier: identifier, label: label)
        scrollUntilHittable(actionButton, in: app)
        XCTAssertTrue(actionButton.waitForExistence(timeout: 5), "\(label) suggestion button is missing")
        XCTAssertTrue(actionButton.isHittable, "\(label) suggestion button is not hittable")
        actionButton.tap()

        let decisionMessage = app.descendants(matching: .any)["researchDecisionMessage"].firstMatch
        let predicate = NSPredicate(format: "label CONTAINS %@", "not auto-modified")
        expectation(for: predicate, evaluatedWith: decisionMessage)
        waitForExpectations(timeout: 10)

        XCTAssertEqual(app.staticTexts["researchCurrentThesisText"].label, originalThesis)
    }

    @MainActor
    private func prepareAnnualConditionalDecisionPrerequisites(
        in app: XCUIApplication,
        validatesEightQuestions: Bool = false,
        checkpoint: ((String) -> Void)? = nil
    ) -> Bool {
        let identified: (String) -> XCUIElement = { identifier in
            let element = app.descendants(matching: .any)[identifier].firstMatch
            self.assertReadableMovingForward(
                element,
                in: app,
                message: "eight-question fact \(identifier) is not reachable in the golden journey"
            )
            return element
        }
        assertResearchLayerMenu(in: app)
        openDecisionLayer("candidate", in: app)
        expandDisclosure(identifier: "candidateManagementDisclosure", label: "研究自选管理", in: app)
        waitForAvailableCandidateMemberships(in: app)
        if validatesEightQuestions {
            for identifier in [
                "candidateMembershipUpdatedAt-HK.09926",
                "candidateMembershipQuote-HK.09926",
                "candidateMembershipSafety-HK.09926"
            ] {
                assertReadableMovingForward(
                    app.descendants(matching: .any)[identifier].firstMatch,
                    in: app,
                    message: "candidate source or safety fact \(identifier) is not reachable in the golden journey"
                )
            }
            checkpoint?("prerequisites-candidate")
        }

        let loadBrief = findButton(
            in: app,
            identifier: "annualDecisionBriefLoad-HK.09926",
            label: "读取每日决策简报"
        )
        scrollUntilHittable(loadBrief, in: app)
        XCTAssertTrue(loadBrief.waitForExistence(timeout: 10), "conditional journey decision brief entry is missing")
        loadBrief.tap()
        let briefState = app.staticTexts["annualDecisionBriefState"].firstMatch
        expectation(for: NSPredicate(format: "label == %@", "三分钟复核就绪"), evaluatedWith: briefState)
        waitForExpectations(timeout: 10)
        if validatesEightQuestions {
            _ = identified("annualDecisionBriefQuantMetadata")
            let quantTimes = identified("annualDecisionBriefQuantTimes")
            XCTAssertTrue(quantTimes.label.contains("asOf="))
            XCTAssertTrue(quantTimes.label.contains("fetchedAt="))
            XCTAssertTrue(identified("annualDecisionBriefQuantAuthority").label.contains("researchOnly=true"), "question 5 lost historical quant authority")
            let identitySummary = identified("annualDecisionBriefIdentitySummary")
            XCTAssertTrue(identitySummary.label.contains("freshness=historical"), "decision brief lost explicit historical freshness")
            XCTAssertTrue(identitySummary.label.contains("fixture=true"), "decision brief lost explicit fixture provenance")
            XCTAssertTrue(identitySummary.label.contains("generated="))
            XCTAssertTrue(identitySummary.label.contains("research="))
            XCTAssertTrue(identitySummary.label.contains("evidence="))
            XCTAssertTrue(identitySummary.label.contains("quote=HK.09926:"), "decision brief lost its Futu quote snapshot identity")
            let whyNow = identified("annualDecisionBriefWhyNow")
            XCTAssertTrue(whyNow.waitForExistence(timeout: 10))
            XCTAssertFalse(whyNow.label.contains("未记录"), "question 2 lost why this candidate is worth researching now")
            XCTAssertFalse(identified("annualDecisionBriefThesis").label.contains("未记录"), "question 3 lost the business thesis")
            XCTAssertFalse(identified("annualDecisionBriefInvalidation").label.contains("未记录"), "question 3 lost a material risk")
            XCTAssertTrue(identified("annualDecisionBriefVariable-new_energy_volume").exists, "question 3 lost a key business driver")
            XCTAssertTrue(identified("annualDecisionBriefEvidence-1").exists, "question 5 lost supporting fundamental evidence")
            XCTAssertTrue(identified("annualDecisionBriefEvidence-2").exists, "question 5 lost counter evidence")
            let briefSafety = identified("annualDecisionBriefSafety")
            XCTAssertTrue(briefSafety.label.contains("不生成推荐、排名、目标价、目标仓位、交易方向、订单或成交"))
            checkpoint?("prerequisites-brief")
        }

        openEvidenceWorkspace("valuation", in: app)
        XCTAssertTrue(
            app.staticTexts["annualValuationQuantTitle"].firstMatch.waitForExistence(timeout: 10),
            "conditional journey valuation workspace is missing"
        )
        let valuationInputs: [(identifier: String, value: String)] = [
            ("valuationMetricCurrencyField", "HKD"),
            ("valuationBaseMetricField", "2"),
            ("valuationGrowthField", "15"),
            ("valuationHorizonField", "3"),
            ("valuationMultipleField", "18"),
            ("valuationDiscountField", "10"),
            ("valuationNetCashField", "1"),
            ("valuationGrowthStepField", "5"),
            ("valuationMultipleStepField", "2"),
            ("quantMaxDrawdownField", "50"),
            ("quantMaxTurnoverField", "1000"),
            ("quantMinTradeCountField", "1")
        ]
        guard enterValuationInputs(valuationInputs, in: app, checkpoint: checkpoint) else { return false }
        dismissValuationKeyboard(in: app)
        let recompute = findButton(in: app, identifier: "annualValuationQuantLoadButton", label: "复算用户情景")
        scrollForwardUntilHittable(recompute, in: app)
        XCTAssertTrue(recompute.isEnabled, "conditional journey valuation inputs are not valid")
        recompute.tap()
        let valuationStatus = app.staticTexts["annualValuationQuantStatus"].firstMatch
        expectation(for: NSPredicate(format: "label == %@", "已计算"), evaluatedWith: valuationStatus)
        waitForExpectations(timeout: 10)
        let presentValue: XCUIElement
        if validatesEightQuestions {
            _ = identified("annualValuationQuantContext")
            let valuationQuote = identified("annualValuationQuote")
            XCTAssertTrue(valuationQuote.label.contains("HK.09926"), "valuation lost the current Futu quote snapshot")
            presentValue = identified("annualValuationPresentValue")
        } else {
            presentValue = app.staticTexts["annualValuationPresentValue"].firstMatch
        }
        expectation(for: NSPredicate(format: "label == %@", "42.135612 HKD"), evaluatedWith: presentValue)
        waitForExpectations(timeout: 10)
        if validatesEightQuestions {
            XCTAssertEqual(presentValue.label, "42.135612 HKD", "question 4 lost the exact user valuation scenario")
            let impliedGrowth = identified("annualValuationImpliedGrowth")
            XCTAssertTrue(impliedGrowth.exists, "question 4 lost implied expectations")
            _ = identified("annualQuantModelIdentity")
            let valuationSafety = identified("annualValuationQuantSafety")
            XCTAssertTrue(valuationSafety.label.contains("不是系统目标价、评分、排序、推荐、仓位、方向或交易动作"))
            checkpoint?("prerequisites-valuation")
        }

        openPortfolioWorkspace("lab", in: app)
        let amountInput = app.textFields["annualPortfolioLabAmountsInput"].firstMatch
        scrollUntilHittable(amountInput, in: app)
        XCTAssertTrue(amountInput.waitForExistence(timeout: 10), "conditional journey scenario amount input is missing")
        replaceText(in: amountInput, with: "25000,5000", app: app)
        let keyboardDone = findButton(
            in: app,
            identifier: "annualPortfolioLabKeyboardDone",
            label: "收起情景金额键盘"
        )
        XCTAssertTrue(keyboardDone.waitForExistence(timeout: 5), "conditional journey scenario keyboard dismissal is missing")
        keyboardDone.tap()
        let runLab = findButton(in: app, identifier: "annualPortfolioLabRunButton", label: "并列比较用户情景")
        scrollUntilHittable(runLab, in: app)
        expectation(for: NSPredicate(format: "enabled == true"), evaluatedWith: runLab)
        waitForExpectations(timeout: 15)
        runLab.tap()
        let labStatus = app.staticTexts["annualPortfolioLabStatus"].firstMatch
        expectation(for: NSPredicate(format: "label == %@", "available"), evaluatedWith: labStatus)
        waitForExpectations(timeout: 10)
        if validatesEightQuestions {
            let labFactTime = identified("annualPortfolioLabFactTime")
            XCTAssertTrue(labFactTime.label.contains("Pingan"))
            XCTAssertTrue(labFactTime.label.contains("Futu"))
            _ = identified("annualPortfolioLabSnapshotIdentity")
            let scenarioWeight = identified("annualPortfolioLabScenarioWeight-0")
            XCTAssertEqual(
                scenarioWeight.label,
                "60.00%",
                "question 6 lost the user-entered marginal portfolio scenario"
            )
            let labBoundary = identified("annualPortfolioLabBoundary")
            XCTAssertTrue(labBoundary.label.contains("不生成优选情景、建议金额、目标权重、方向、股数或订单"))
            guard selectWorkspace("dailyPortfolioWorkspace-current", in: app) else { return false }
            XCTAssertFalse(
                app.descendants(matching: .any)["annualPortfolioLabTitle"].firstMatch.exists,
                "portfolio lab content remained active after selecting current portfolio"
            )
            XCTAssertEqual(identified("portfolioAuthoritySource").label, "平安导入快照")
            let portfolioAsOf = identified("portfolioAsOf")
            XCTAssertTrue(portfolioAsOf.waitForExistence(timeout: 10), "question 1 lost current holdings time")
            XCTAssertEqual(
                portfolioAsOf.label,
                "2026-07-17T02:58:00.000Z",
                "question 1 did not advance to the account-bound portfolio-lab snapshot"
            )
            let quoteAsOf = identified("portfolioQuoteAsOf-HK.09926")
            let quoteFetchedAt = identified("portfolioQuoteFetchedAt-HK.09926")
            XCTAssertFalse(quoteAsOf.label.contains("unavailable"), "question 1 lost Futu quote as-of freshness")
            XCTAssertFalse(quoteFetchedAt.label.contains("unavailable"), "question 1 lost Futu fetched-at freshness")
            XCTAssertTrue(app.descendants(matching: .any)["portfolioPosition-HK.09926"].exists, "question 1 lost the current Pingan holding")
            let authorityBoundary = identified("portfolioFactAuthorityBoundary")
            XCTAssertTrue(authorityBoundary.label.contains("持仓=平安"))
            XCTAssertTrue(authorityBoundary.label.contains("报价=Futu"))
            let dataUseBoundary = identified("portfolioDataUseBoundary")
            XCTAssertTrue(dataUseBoundary.label.contains("生产组合、券商对账、会计和执行均为 blocked"))
            checkpoint?("prerequisites-portfolio")
        }

        openDecisionLayer("decision", in: app)
        selectWorkspace("dailyHumanDecisionWorkspace-conditions", in: app)
        let conditionalTitle = app.staticTexts["annualConditionalDecisionTitle"].firstMatch
        scrollForwardUntilHittable(conditionalTitle, in: app)
        XCTAssertTrue(conditionalTitle.waitForExistence(timeout: 10))
        XCTAssertTrue(conditionalTitle.isHittable)
        checkpoint?("prerequisites-ready")
        return true
    }

    @MainActor
    private func launchResearchApp(
        symbol: String = "00175.hk",
        authToken: String? = nil,
        preferredContentSizeCategory: String? = nil,
        viewportWidth: Int? = nil
    ) -> XCUIApplication {
        launchApp(
            symbol: symbol,
            initialTab: "research",
            authToken: authToken,
            preferredContentSizeCategory: preferredContentSizeCategory,
            viewportWidth: viewportWidth
        )
    }

    @MainActor
    private func switchStock(_ symbol: String, in app: XCUIApplication, destination: String) {
        let search = app.buttons["globalHongKongSearch"].firstMatch
        XCTAssertTrue(search.waitForExistence(timeout: 10))
        search.tap()
        let input = app.textFields["globalSearchInput"].firstMatch
        XCTAssertTrue(input.waitForExistence(timeout: 10))
        input.tap()
        input.typeText(symbol)
        app.buttons["globalKnownStockSearch"].firstMatch.tap()
        let result = app.buttons["globalSearchResult-\(symbol)"].firstMatch
        XCTAssertTrue(result.waitForExistence(timeout: 30))
        result.tap()
        let destinationButton = app.buttons[destination].firstMatch
        XCTAssertTrue(destinationButton.waitForExistence(timeout: 10))
        destinationButton.tap()
    }

    @MainActor
    private func launchMarketApp(symbol: String = "00175.hk", authToken: String? = nil) -> XCUIApplication {
        launchApp(symbol: symbol, initialTab: "market", authToken: authToken)
    }

    @MainActor
    private func launchApp(
        symbol: String,
        initialTab: String?,
        authToken: String? = nil,
        writeAuthToken: String? = nil,
        fixtureFormalDecisionDemo: Bool = false,
        resetDailyResume: Bool = true,
        requestDate: String? = nil,
        preferredContentSizeCategory: String? = nil,
        viewportWidth: Int? = nil
    ) -> XCUIApplication {
        let app = XCUIApplication()
        let environment = ProcessInfo.processInfo.environment
        let baseURL = environment["ANNUAL_RINGS_GATE_A_BASE_URL"] ?? "http://127.0.0.1:4520"
        var launchArguments = ["--ui-testing", "--base-url", baseURL, "--symbol", symbol]
        if let initialTab {
            launchArguments.append(contentsOf: ["--initial-tab", initialTab])
        }
        let resolvedAuthToken = authToken ?? environment["ANNUAL_RINGS_UI_AUTH_TOKEN"]
        if let resolvedAuthToken, !resolvedAuthToken.isEmpty {
            launchArguments.append(contentsOf: ["--auth-token", resolvedAuthToken])
        }
        if let writeAuthToken, !writeAuthToken.isEmpty {
            launchArguments.append(contentsOf: ["--write-auth-token", writeAuthToken])
        }
        if fixtureFormalDecisionDemo {
            launchArguments.append("--fixture-formal-decision-demo")
        }
        if let requestDate {
            launchArguments.append(contentsOf: ["--ui-test-request-date", requestDate])
        }
        if let authHeader = environment["ANNUAL_RINGS_UI_AUTH_HEADER"], !authHeader.isEmpty {
            launchArguments.append(contentsOf: ["--auth-header", authHeader])
        }
        if resetDailyResume {
            launchArguments.append("--reset-daily-resume")
        }
        if let preferredContentSizeCategory {
            launchArguments.append(contentsOf: [
                "-UIPreferredContentSizeCategoryName",
                preferredContentSizeCategory
            ])
        }
        if let viewportWidth {
            launchArguments.append(contentsOf: ["--ui-test-viewport-width", String(viewportWidth)])
        }
        app.launchArguments = launchArguments
        app.launchEnvironment["ANNUAL_RINGS_GATE_A_BASE_URL"] = baseURL
        app.launchEnvironment["ANNUAL_RINGS_GATE_A_SYMBOL"] = symbol
        if let initialTab {
            app.launchEnvironment["ANNUAL_RINGS_INITIAL_TAB"] = initialTab
        }
        if let resolvedAuthToken, !resolvedAuthToken.isEmpty {
            app.launchEnvironment["ANNUAL_RINGS_UI_AUTH_TOKEN"] = resolvedAuthToken
        }
        if let screenshotDirectory = environment["ANNUAL_RINGS_SCREENSHOT_DIR"], !screenshotDirectory.isEmpty {
            app.launchEnvironment["ANNUAL_RINGS_SCREENSHOT_DIR"] = screenshotDirectory
        }
        app.launch()
        return app
    }

    @MainActor
    private func assertGlobalTools(in app: XCUIApplication) {
        XCTAssertTrue(app.buttons["globalHongKongSearch"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["globalAssistant"].waitForExistence(timeout: 5))
    }

    @MainActor
    private func assertResearchLayerMenu(in app: XCUIApplication) {
        XCTAssertTrue(
            app.buttons["dailyDecisionLayerToolbarMenu"].firstMatch.waitForExistence(timeout: 20),
            "independent Research layer menu is missing"
        )
    }

    @MainActor
    private func assertCandidateOverviewAvailable(in app: XCUIApplication) {
        openDecisionLayer("candidate", in: app)
        selectWorkspace("dailyCandidateWorkspace-overview", in: app)
        let title = app.staticTexts["candidateOverviewTitle"].firstMatch
        scrollForwardUntilHittable(title, in: app)
        XCTAssertTrue(title.waitForExistence(timeout: 10), "candidate overview section is missing")
        XCTAssertTrue(title.isHittable, "candidate overview section is outside the visible workspace")
        let status = app.staticTexts["candidateOverviewStatus"]
        XCTAssertTrue(status.waitForExistence(timeout: 10), "candidate overview status is missing")
        expectation(for: NSPredicate(format: "label BEGINSWITH %@", "已更新"), evaluatedWith: status)
        waitForExpectations(timeout: 20)
        XCTAssertTrue(app.staticTexts["candidateOverviewProvenance"].label.contains("不读取资产账户"))
        XCTAssertTrue(app.staticTexts["candidateSymbol-HK.00175"].waitForExistence(timeout: 10), "first candidate row is missing")
        XCTAssertTrue(app.staticTexts["candidateSymbol-HK.00005"].waitForExistence(timeout: 10), "second candidate row is missing")
        XCTAssertTrue(app.staticTexts["candidateSymbol-HK.09926"].waitForExistence(timeout: 10), "third candidate row is missing")
        XCTAssertTrue(app.staticTexts["candidateResearchUpdatedAt-HK.00175"].waitForExistence(timeout: 10), "first candidate card facts are missing")
        XCTAssertTrue(app.staticTexts["candidateResearchUpdatedAt-HK.00005"].waitForExistence(timeout: 10), "second candidate card facts are missing")
        XCTAssertTrue(app.staticTexts["candidateResearchUpdatedAt-HK.09926"].waitForExistence(timeout: 10), "third candidate card facts are missing")
    }

    @MainActor
    private func assertCandidateOverviewFailsClosed(authToken: String) {
        let app = launchResearchApp(authToken: authToken)
        openDecisionLayer("candidate", in: app)
        selectWorkspace("dailyCandidateWorkspace-overview", in: app)
        XCTAssertTrue(app.staticTexts["candidateOverviewStatus"].waitForExistence(timeout: 10), "candidate status missing for \(authToken)")
        XCTAssertTrue(app.staticTexts["candidateOverviewEmpty"].waitForExistence(timeout: 10), "candidate empty/fail-closed message missing for \(authToken)")
        XCTAssertFalse(app.staticTexts["candidateSymbol-HK.00175"].exists, "candidate row leaked for \(authToken)")
    }

    @MainActor
    private func assertCurrentPortfolioWarning(authToken: String, expectedStatus: String) {
        let app = launchResearchApp(authToken: authToken)
        openDecisionLayer("portfolio", in: app)

        let status = app.staticTexts["portfolioDecisionStatus"]
        XCTAssertTrue(status.waitForExistence(timeout: 10), "portfolio status missing for \(authToken)")
        XCTAssertEqual(status.label, expectedStatus)
        XCTAssertTrue(app.descendants(matching: .any)["portfolioPosition-HK.00175"].exists, "warning facts were hidden for \(authToken)")
        XCTAssertTrue(app.staticTexts["portfolioRiskAvailability"].label.contains("blocked"))
        selectWorkspace("dailyPortfolioWorkspace-risk", in: app)
        XCTAssertFalse(findButton(in: app, identifier: "calculatePortfolioRiskButton", label: "计算风险影响").isEnabled)
        XCTAssertFalse(app.descendants(matching: .any)["portfolioRiskResult"].exists)
    }

    @MainActor
    private func assertCurrentPortfolioMaterialFailure(authToken: String) {
        let app = launchResearchApp(authToken: authToken)
        openDecisionLayer("portfolio", in: app)
        XCTAssertTrue(app.staticTexts["portfolioDecisionStatus"].waitForExistence(timeout: 10), "initial portfolio status missing for \(authToken)")
        XCTAssertEqual(app.staticTexts["portfolioDecisionStatus"].label, "available")
        XCTAssertTrue(app.descendants(matching: .any)["portfolioPosition-HK.00175"].exists)

        let refresh = findButton(in: app, identifier: "refreshPortfolioDecisionButton", label: "刷新当前组合")
        scrollUntilHittable(refresh, in: app)
        refresh.tap()

        XCTAssertTrue(app.staticTexts["portfolioDecisionNoFacts"].waitForExistence(timeout: 10), "old facts survived \(authToken)")
        XCTAssertFalse(app.descendants(matching: .any)["portfolioPosition-HK.00175"].exists, "old position survived \(authToken)")
        XCTAssertFalse(app.descendants(matching: .any)["portfolioRiskResult"].exists, "old risk survived \(authToken)")
        selectWorkspace("dailyPortfolioWorkspace-risk", in: app)
        XCTAssertFalse(findButton(in: app, identifier: "calculatePortfolioRiskButton", label: "计算风险影响").isEnabled)
    }

    @MainActor
    private func findButton(in app: XCUIApplication, identifier: String, label _: String) -> XCUIElement {
        app.descendants(matching: .any)[identifier].firstMatch
    }

    @MainActor
    private func assertDecisionContextIdentity(
        symbol expectedSymbol: String,
        expectedGeneratedAt: String? = nil,
        in app: XCUIApplication
    ) -> (contextId: String, contextHash: String, generatedAt: String) {
        let symbol = app.descendants(matching: .any)["decisionContextSymbol"].firstMatch
        let contextId = app.descendants(matching: .any)["decisionContextId"].firstMatch
        let contextHash = app.descendants(matching: .any)["decisionContextHash"].firstMatch
        let generatedAt = app.descendants(matching: .any)["decisionContextGeneratedAt"].firstMatch

        scrollForwardUntilHittable(symbol, in: app)
        XCTAssertTrue(symbol.waitForExistence(timeout: 20), "decision context symbol did not become available")
        scrollForwardUntilHittable(contextId, in: app)
        XCTAssertTrue(contextId.waitForExistence(timeout: 10), "decision context identity did not become available")
        scrollForwardUntilHittable(contextHash, in: app)
        XCTAssertTrue(contextHash.waitForExistence(timeout: 10), "decision context hash did not become available")
        scrollForwardUntilHittable(generatedAt, in: app)
        XCTAssertTrue(generatedAt.waitForExistence(timeout: 10), "decision context generation time did not become available")
        if let expectedGeneratedAt {
            expectation(
                for: NSPredicate(format: "label == %@", expectedGeneratedAt),
                evaluatedWith: generatedAt
            )
            waitForExpectations(timeout: 20)
        }
        XCTAssertEqual(symbol.label, expectedSymbol)

        let id = contextId.label
        let hash = contextHash.label
        let prefix = "decision-context:\(expectedSymbol):"
        XCTAssertTrue(id.hasPrefix(prefix), "decision context identity is not bound to \(expectedSymbol)")
        XCTAssertNotNil(hash.range(of: "^[0-9a-f]{64}$", options: .regularExpression))
        XCTAssertEqual(String(id.dropFirst(prefix.count)), String(hash.prefix(16)))
        return (id, hash, generatedAt.label)
    }

    @MainActor
    private func openDecisionLayer(_ layer: String, in app: XCUIApplication) {
        if decisionLayerIsOpen(layer, in: app) { return }
        let ring = app.buttons["decisionRingLayer-\(layer)"].firstMatch
        scrollUntilHittable(ring, in: app)
        if ring.isHittable {
            ring.tap()
            for _ in 0..<25 {
                if decisionLayerIsOpen(layer, in: app) { return }
                RunLoop.current.run(until: Date().addingTimeInterval(0.2))
            }
        }
        openDecisionLayerFromToolbar(layer, in: app)
    }

    @MainActor
    private func openDecisionLayerFromToolbar(
        _ layer: String,
        in app: XCUIApplication
    ) {
        let menu = app.buttons["dailyDecisionLayerToolbarMenu"].firstMatch
        guard menu.waitForExistence(timeout: 5), menu.isHittable else {
            XCTFail("persistent decision-layer menu is unavailable for \(layer)")
            return
        }
        menu.tap()
        let option = app.buttons["dailyDecisionLayerMenuOption-\(layer)"].firstMatch
        guard option.waitForExistence(timeout: 5), option.isHittable else {
            XCTFail("persistent decision-layer menu omitted \(layer)")
            return
        }
        option.tap()
        for _ in 0..<25 {
            if decisionLayerIsOpen(layer, in: app) { return }
            RunLoop.current.run(until: Date().addingTimeInterval(0.2))
        }
        XCTFail("Research layer \(layer) did not expose its workspace content")
    }

    @MainActor
    private func assertToolbarSelectsDecisionLayer(_ layer: String, in app: XCUIApplication) {
        openDecisionLayerFromToolbar(layer, in: app)
        let title = decisionLayerTitle(layer)
        let menu = app.buttons["dailyDecisionLayerToolbarMenu"].firstMatch
        let selected = NSPredicate(format: "value == %@", title)
        expectation(for: selected, evaluatedWith: menu)
        waitForExpectations(timeout: 5)
    }

    @MainActor
    private func decisionLayerIsOpen(_ layer: String, in app: XCUIApplication) -> Bool {
        let menu = app.buttons["dailyDecisionLayerToolbarMenu"].firstMatch
        if menu.exists, menu.value as? String == decisionLayerTitle(layer) { return true }
        let workspaceIdentifier = [
            "candidate": "dailyCandidateWorkspace-overview",
            "evidence": "dailyEvidenceWorkspace-brief",
            "portfolio": "dailyPortfolioWorkspace-current",
            "decision": "dailyHumanDecisionWorkspace-conditions",
            "review": "dailyReviewWorkspace-learning"
        ][layer]
        return workspaceIdentifier.map {
            app.buttons[$0].firstMatch.exists
        } == true
    }

    private func decisionLayerTitle(_ layer: String) -> String {
        ["candidate": "候选", "evidence": "证据", "portfolio": "组合风险", "decision": "决定", "review": "复盘"][layer] ?? layer
    }

    @MainActor
    private func openEvidenceWorkspace(_ workspace: String, in app: XCUIApplication) {
        openDecisionLayer("evidence", in: app)
        selectWorkspace("dailyEvidenceWorkspace-\(workspace)", in: app)
    }

    @MainActor
    private func openPortfolioWorkspace(_ workspace: String, in app: XCUIApplication) {
        openDecisionLayer("portfolio", in: app)
        selectWorkspace("dailyPortfolioWorkspace-\(workspace)", in: app)
    }

    @MainActor
    private func openReviewWorkspace(_ workspace: String, in app: XCUIApplication) {
        openDecisionLayer("review", in: app)
        selectWorkspace("dailyReviewWorkspace-\(workspace)", in: app)
    }

    @MainActor
    @discardableResult
    private func selectWorkspace(_ identifier: String, in app: XCUIApplication) -> Bool {
        for _ in 0..<3 {
            let initialButton = app.descendants(matching: .any)[identifier].firstMatch
            scrollUntilHittable(initialButton, in: app)
            guard initialButton.waitForExistence(timeout: 10) else {
                XCTFail("workspace \(identifier) is missing")
                return false
            }
            guard scrollControlIntoSafeViewport(initialButton, in: app) else { continue }
            guard let button = stableButton(identifier, in: app) else { continue }
            XCTAssertGreaterThanOrEqual(button.frame.width, 44, "workspace \(identifier) is narrower than 44 points")
            XCTAssertGreaterThanOrEqual(button.frame.height, 44, "workspace \(identifier) is shorter than 44 points")
            if button.isSelected {
                if waitForWorkspaceTransition(identifier, in: app) { return true }
                continue
            }
            let freshButton = app.descendants(matching: .any)[identifier].firstMatch
            guard freshButton.exists, freshButton.isHittable else { continue }
            freshButton.tap()

            for _ in 0..<30 {
                if workspaceTransitionIsComplete(identifier, in: app) { return true }
                RunLoop.current.run(until: Date().addingTimeInterval(0.1))
            }
        }
        let activePeers = workspacePeerIdentifiers(identifier).filter {
            app.descendants(matching: .any)[$0].firstMatch.isSelected
        }
        XCTFail(
            "workspace \(identifier) did not complete selection; "
                + "selected=\(app.descendants(matching: .any)[identifier].firstMatch.isSelected), "
                + "activePeers=\(activePeers), content=\(workspaceContentExists(identifier, in: app))"
        )
        return false
    }

    @MainActor
    private func assertHorizontallyContained(
        _ element: XCUIElement,
        in bounds: CGRect,
        message: String,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        let frame = element.frame
        XCTAssertFalse(frame.isEmpty, message, file: file, line: line)
        XCTAssertGreaterThanOrEqual(frame.minX, bounds.minX - 0.5, message, file: file, line: line)
        XCTAssertLessThanOrEqual(frame.maxX, bounds.maxX + 0.5, message, file: file, line: line)
    }

    @MainActor
    private func assertReadableInsideResearchViewport(
        _ element: XCUIElement,
        in app: XCUIApplication,
        message: String,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        XCTAssertTrue(element.waitForExistence(timeout: 10), message, file: file, line: line)
        scrollUntilVisible(element, in: app)
        let viewport = app.scrollViews["researchScrollView"].firstMatch
        XCTAssertTrue(viewport.exists, "research viewport is missing", file: file, line: line)
        assertHorizontallyContained(element, in: viewport.frame, message: message, file: file, line: line)
        XCTAssertTrue(
            element.frame.maxY >= viewport.frame.minY - 0.5 && element.frame.minY <= viewport.frame.maxY + 0.5,
            message,
            file: file,
            line: line
        )
    }

    @MainActor
    private func assertReadableMovingForward(
        _ element: XCUIElement,
        in app: XCUIApplication,
        message: String,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        scrollForwardUntilVisible(element, in: app)
        XCTAssertTrue(element.exists, message, file: file, line: line)
        let viewport = app.scrollViews["researchScrollView"].firstMatch
        XCTAssertTrue(viewport.exists, "research viewport is missing", file: file, line: line)
        assertHorizontallyContained(element, in: viewport.frame, message: message, file: file, line: line)
        XCTAssertTrue(
            element.frame.maxY >= viewport.frame.minY - 0.5 && element.frame.minY <= viewport.frame.maxY + 0.5,
            message,
            file: file,
            line: line
        )
    }

    @MainActor
    private func waitForWorkspaceContent(_ identifier: String, in app: XCUIApplication) -> Bool {
        guard let contentIdentifiers = workspaceContentIdentifiers(identifier) else {
            XCTFail("workspace \(identifier) has no content handshake")
            return false
        }
        for _ in 0..<30 {
            if workspaceContentExists(contentIdentifiers, in: app) { return true }
            RunLoop.current.run(until: Date().addingTimeInterval(0.1))
        }
        XCTFail("workspace \(identifier) selected without showing \(contentIdentifiers.joined(separator: ", "))")
        return false
    }

    @MainActor
    private func waitForWorkspaceTransition(_ identifier: String, in app: XCUIApplication) -> Bool {
        for _ in 0..<30 {
            if workspaceTransitionIsComplete(identifier, in: app) { return true }
            RunLoop.current.run(until: Date().addingTimeInterval(0.1))
        }
        return false
    }

    @MainActor
    private func workspaceTransitionIsComplete(_ identifier: String, in app: XCUIApplication) -> Bool {
        let selectedButton = app.descendants(matching: .any)[identifier].firstMatch
        guard selectedButton.exists, selectedButton.isSelected, workspaceContentExists(identifier, in: app) else {
            return false
        }
        for peerIdentifier in workspacePeerIdentifiers(identifier) where peerIdentifier != identifier {
            let peerButton = app.descendants(matching: .any)[peerIdentifier].firstMatch
            if peerButton.exists, peerButton.isSelected { return false }
        }
        return true
    }

    @MainActor
    private func workspaceContentExists(_ identifier: String, in app: XCUIApplication) -> Bool {
        guard let contentIdentifiers = workspaceContentIdentifiers(identifier) else { return false }
        return workspaceContentExists(contentIdentifiers, in: app)
    }

    @MainActor
    private func workspaceContentExists(_ identifiers: [String], in app: XCUIApplication) -> Bool {
        identifiers.contains {
            app.descendants(matching: .any)[$0].firstMatch.exists
        }
    }

    private func workspaceContentIdentifiers(_ identifier: String) -> [String]? {
        let identifiers: [String] = switch identifier {
        case "dailyCandidateWorkspace-overview": ["candidateOverviewTitle"]
        case "dailyCandidateWorkspace-lifecycle": ["candidateMembershipTitle"]
        case "dailyEvidenceWorkspace-brief": ["annualDecisionBriefTitle"]
        case "dailyEvidenceWorkspace-valuation": ["annualValuationQuantTitle"]
        case "dailyEvidenceWorkspace-research": ["annualDecisionBriefResearchEditorDisclosure"]
        case "dailyEvidenceWorkspace-facts": ["candidateDecisionIntakeTitle"]
        case "dailyPortfolioWorkspace-current": ["portfolioDecisionTitle"]
        case "dailyPortfolioWorkspace-risk": ["portfolioRiskTitle"]
        case "dailyPortfolioWorkspace-lab": ["annualPortfolioLabTitle"]
        case "dailyHumanDecisionWorkspace-conditions": ["annualConditionalDecisionTitle"]
        case "dailyHumanDecisionWorkspace-snapshot": ["submittedDecisionCheckId", "dailyDecisionSnapshotUnavailable"]
        case "dailyHumanDecisionWorkspace-boundaries": ["assistAdvisoryScopeTitle"]
        case "dailyReviewWorkspace-learning": ["reviewFeedbackCard"]
        case "dailyReviewWorkspace-timeline": ["decisionReviewLimitation", "decisionReviewMessage"]
        case "dailyReviewWorkspace-followUp": ["assistReviewFollowUpWorkflowTitle"]
        case "dailyReviewWorkspace-local": ["focusedLocalReviewRecordsSection"]
        default: []
        }
        return identifiers.isEmpty ? nil : identifiers
    }

    private func workspacePeerIdentifiers(_ identifier: String) -> [String] {
        let groups = [
            ["dailyCandidateWorkspace-overview", "dailyCandidateWorkspace-lifecycle"],
            ["dailyEvidenceWorkspace-brief", "dailyEvidenceWorkspace-valuation", "dailyEvidenceWorkspace-research", "dailyEvidenceWorkspace-facts"],
            ["dailyPortfolioWorkspace-current", "dailyPortfolioWorkspace-risk", "dailyPortfolioWorkspace-lab"],
            ["dailyHumanDecisionWorkspace-conditions", "dailyHumanDecisionWorkspace-snapshot", "dailyHumanDecisionWorkspace-boundaries"],
            ["dailyReviewWorkspace-learning", "dailyReviewWorkspace-timeline", "dailyReviewWorkspace-followUp", "dailyReviewWorkspace-local"]
        ]
        return groups.first { $0.contains(identifier) } ?? [identifier]
    }

    @MainActor
    private func stableButton(_ identifier: String, in app: XCUIApplication) -> XCUIElement? {
        var previousFrame = CGRect.null
        var stableSamples = 0
        var lastHittableButton: XCUIElement?
        for _ in 0..<8 {
            let button = app.descendants(matching: .any)[identifier].firstMatch
            let frame = button.frame
            if button.exists, button.isHittable, !frame.isEmpty {
                lastHittableButton = button
                let stableFrame = !previousFrame.isNull
                    && frame.insetBy(dx: -0.5, dy: -0.5).contains(previousFrame)
                    && previousFrame.insetBy(dx: -0.5, dy: -0.5).contains(frame)
                if stableFrame {
                    stableSamples += 1
                    if stableSamples >= 2 { return button }
                } else {
                    stableSamples = 0
                    previousFrame = frame
                }
            }
            RunLoop.current.run(until: Date().addingTimeInterval(0.15))
        }
        return lastHittableButton
    }

    @MainActor
    private func scrollControlIntoSafeViewport(_ element: XCUIElement, in app: XCUIApplication) -> Bool {
        let scrollView = app.scrollViews["researchScrollView"].firstMatch
        guard scrollView.waitForExistence(timeout: 10) else {
            XCTFail("research scroll view is missing")
            return false
        }
        let tabBar = app.tabBars.firstMatch
        for _ in 0..<12 {
            let frame = element.frame
            let safeTop = scrollView.frame.minY + 8
            let tabBarTop = tabBar.exists && !tabBar.frame.isEmpty
                ? tabBar.frame.minY
                : scrollView.frame.maxY
            let safeBottom = min(
                scrollView.frame.maxY,
                tabBarTop
            ) - 8
            guard safeBottom > safeTop else { return false }
            if element.isHittable, frame.minY >= safeTop, frame.maxY <= safeBottom { return true }
            if frame.midY < (safeTop + safeBottom) / 2 {
                scrollView.swipeDown()
            } else {
                scrollView.swipeUp()
            }
        }
        return false
    }

    @MainActor
    private func expandDisclosure(identifier: String, label: String, in app: XCUIApplication) {
        let replacementWorkspace = [
            "candidateManagementDisclosure": "dailyCandidateWorkspace-lifecycle",
            "decisionBoundaryDisclosure": "dailyHumanDecisionWorkspace-boundaries",
            "localReviewRecordsDisclosure": "dailyReviewWorkspace-local"
        ][identifier]
        if let replacementWorkspace {
            selectWorkspace(replacementWorkspace, in: app)
            return
        }

        let disclosure = app.descendants(matching: .any)[identifier].firstMatch
        scrollUntilHittable(disclosure, in: app)
        XCTAssertTrue(disclosure.waitForExistence(timeout: 5), "disclosure \(label) is missing")
        XCTAssertTrue(disclosure.isHittable, "disclosure \(label) is not hittable")
        let expanded = disclosure.descendants(matching: .image)["expanded"].firstMatch
        if !expanded.exists {
            disclosure.tap()
            XCTAssertTrue(expanded.waitForExistence(timeout: 5), "disclosure \(label) did not expand")
        }
    }

    @MainActor
    private func expandTodayResearchHistory(in app: XCUIApplication) {
        let scrollView = app.scrollViews.firstMatch
        XCTAssertTrue(scrollView.waitForExistence(timeout: 10), "Today scroll view is missing")
        let disclosure = app.buttons["研究进度与已完成记录"].firstMatch
        for _ in 0..<10 where !disclosure.isHittable { scrollView.swipeUp() }
        XCTAssertTrue(disclosure.waitForExistence(timeout: 10), "Today research history disclosure is missing")
        XCTAssertTrue(disclosure.isHittable, "Today research history disclosure is not hittable")
        let expanded = disclosure.images["expanded"].firstMatch
        if !expanded.exists {
            disclosure.tap()
            XCTAssertTrue(expanded.waitForExistence(timeout: 5), "Today research history did not expand")
        }
    }

    @MainActor
    private func scrollTodayUntilHittable(_ element: XCUIElement, in app: XCUIApplication) {
        let scrollView = app.scrollViews.firstMatch
        XCTAssertTrue(scrollView.waitForExistence(timeout: 10), "Today scroll view is missing")
        for _ in 0..<12 where !element.isHittable { scrollView.swipeUp() }
        XCTAssertTrue(element.isHittable, "Today control \(element.identifier) is not hittable")
    }

    @MainActor
    @discardableResult
    private func waitForAvailableCandidateMemberships(in app: XCUIApplication) -> Bool {
        let status = app.descendants(matching: .any)["candidateMembershipStatus"].firstMatch
        guard status.waitForExistence(timeout: 10) else {
            XCTFail("candidate membership status is missing")
            return false
        }
        let ready = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "label BEGINSWITH %@", "已更新"),
            object: status
        )
        guard XCTWaiter.wait(for: [ready], timeout: 20) == .completed else {
            XCTFail("candidate memberships did not become available: \(status.label)")
            return false
        }
        return true
    }

    @MainActor
    private func scrollUntilHittable(_ element: XCUIElement, in app: XCUIApplication) {
        let reached = { element.isHittable || element.exists && !element.isEnabled }
        if reached() { return }
        guard app.state == .runningForeground else {
            XCTFail("research app is not running before scroll")
            return
        }
        let scrollView = app.scrollViews["researchScrollView"].firstMatch
        guard scrollView.waitForExistence(timeout: 10) else {
            XCTFail("research scroll view is missing")
            return
        }
        let scrollTowardElement: () -> Void = {
            let targetFrame = element.frame
            if element.exists,
               !targetFrame.isEmpty,
               targetFrame.minY < scrollView.frame.minY {
                self.scrollBackward(in: app, steps: 1)
            } else {
                self.scrollForward(in: app, steps: 1)
            }
        }

        if element.exists {
            for _ in 0..<12 {
                if reached() { return }
                scrollTowardElement()
            }
        }

        // SwiftUI may omit distant ScrollView children from the automation tree.
        // Search toward the top first, then scan forward from that stable edge.
        for _ in 0..<12 {
            if reached() { return }
            if element.exists {
                scrollTowardElement()
            } else {
                scrollView.swipeDown()
            }
        }
        for _ in 0..<32 {
            if reached() { return }
            if element.exists {
                scrollTowardElement()
            } else {
                scrollForward(in: app, steps: 1)
            }
        }
    }

    @MainActor
    private func scrollMarketControlUntilHittable(_ element: XCUIElement, in app: XCUIApplication) {
        let scrollView = app.scrollViews["marketScrollView"].firstMatch
        guard scrollView.waitForExistence(timeout: 10) else {
            XCTFail("market scroll view is missing")
            return
        }
        for _ in 0..<20 where !element.isHittable {
            if element.exists, !element.frame.isEmpty, element.frame.minY < scrollView.frame.minY {
                scrollView.swipeDown()
            } else {
                scrollView.swipeUp()
            }
        }
    }

    @MainActor
    private func scrollForwardUntilHittable(_ element: XCUIElement, in app: XCUIApplication) {
        let reached = { element.exists && (element.isHittable || !element.isEnabled) }
        if reached() { return }
        guard app.state == .runningForeground else {
            XCTFail("research app is not running before forward control scroll")
            return
        }
        let scrollView = app.scrollViews["researchScrollView"].firstMatch
        guard scrollView.waitForExistence(timeout: 10) else {
            XCTFail("research scroll view is missing")
            return
        }
        for _ in 0..<40 {
            if reached() { return }
            scrollForward(in: app, steps: 1)
        }
        XCTFail("control \(element.identifier) did not become reachable while scanning forward")
    }

    @MainActor
    private func scrollUntilVisible(_ element: XCUIElement, in app: XCUIApplication) {
        guard app.state == .runningForeground else {
            XCTFail("research app is not running before visible-element scroll")
            return
        }
        let scrollView = app.scrollViews["researchScrollView"].firstMatch
        guard scrollView.waitForExistence(timeout: 10) else {
            XCTFail("research scroll view is missing")
            return
        }
        let reached = {
            guard element.exists else { return false }
            let frame = element.frame
            return !frame.isEmpty
                && frame.maxY >= scrollView.frame.minY
                && frame.minY <= scrollView.frame.maxY
        }
        let moveTowardElement = {
            guard element.exists else {
                self.scrollForward(in: app, steps: 1)
                return
            }
            let frame = element.frame
            if !frame.isEmpty, frame.minY < scrollView.frame.minY {
                self.scrollBackward(in: app, steps: 1)
            } else {
                self.scrollForward(in: app, steps: 1)
            }
        }
        if reached() { return }
        for _ in 0..<12 {
            if reached() { return }
            if element.exists { moveTowardElement() } else { scrollView.swipeDown() }
        }
        for _ in 0..<32 {
            if reached() { return }
            if element.exists { moveTowardElement() } else { scrollForward(in: app, steps: 1) }
        }
    }

    @MainActor
    private func scrollForwardUntilVisible(_ element: XCUIElement, in app: XCUIApplication) {
        guard app.state == .runningForeground else {
            XCTFail("research app is not running before forward visible-element scroll")
            return
        }
        let scrollView = app.scrollViews["researchScrollView"].firstMatch
        guard scrollView.waitForExistence(timeout: 10) else {
            XCTFail("research scroll view is missing")
            return
        }
        for _ in 0..<40 {
            guard element.exists else {
                scrollForward(in: app, steps: 1)
                continue
            }
            let frame = element.frame
            if !frame.isEmpty,
               frame.maxY >= scrollView.frame.minY,
               frame.minY <= scrollView.frame.maxY {
                return
            }
            scrollForward(in: app, steps: 1)
        }
    }

    @MainActor
    private func scrollBackward(in app: XCUIApplication, steps: Int) {
        guard app.state == .runningForeground else {
            XCTFail("research app is not running before backward scroll")
            return
        }
        let scrollView = app.scrollViews["researchScrollView"].firstMatch
        guard scrollView.waitForExistence(timeout: 10) else {
            XCTFail("research scroll view is missing")
            return
        }
        let dragStart = scrollView.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.3))
        let dragEnd = scrollView.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.7))
        for _ in 0..<steps {
            dragStart.press(
                forDuration: 0.05,
                thenDragTo: dragEnd,
                withVelocity: .fast,
                thenHoldForDuration: 0
            )
        }
    }

    @MainActor
    private func scrollForward(in app: XCUIApplication, steps: Int) {
        guard app.state == .runningForeground else {
            XCTFail("research app is not running before forward scroll")
            return
        }
        let scrollView = app.scrollViews["researchScrollView"].firstMatch
        guard scrollView.waitForExistence(timeout: 10) else {
            XCTFail("research scroll view is missing")
            return
        }
        let dragStart = scrollView.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.7))
        let dragEnd = scrollView.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.3))
        for _ in 0..<steps {
            dragStart.press(
                forDuration: 0.05,
                thenDragTo: dragEnd,
                withVelocity: .fast,
                thenHoldForDuration: 0
            )
        }
    }

    @MainActor
    private func replaceText(in element: XCUIElement, with value: String, app: XCUIApplication) {
        let identifier = element.identifier
        guard !identifier.isEmpty else {
            return XCTFail("text field is missing a stable accessibility identifier")
        }
        var field = app.descendants(matching: .any)[identifier].firstMatch
        guard bringTextFieldIntoViewport(identifier: identifier, in: app) else { return }
        field = app.descendants(matching: .any)[identifier].firstMatch
        guard field.exists else {
            return XCTFail("text field \(identifier) is missing after viewport scan")
        }
        let focused = NSPredicate(format: "hasKeyboardFocus == true")
        var acquiredFocus = false
        for _ in 0..<3 {
            field = app.descendants(matching: .any)[identifier].firstMatch
            field.coordinate(withNormalizedOffset: CGVector(dx: 0.85, dy: 0.5)).tap()
            let expectation = XCTNSPredicateExpectation(predicate: focused, object: field)
            if XCTWaiter.wait(for: [expectation], timeout: 2) == .completed {
                acquiredFocus = true
                break
            }
            guard bringTextFieldIntoViewport(field, in: app) else { return }
        }
        guard acquiredFocus else {
            return XCTFail("text field \(identifier) did not acquire keyboard focus")
        }
        let current = (field.value as? String) ?? ""
        if !current.isEmpty, current != field.placeholderValue {
            field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: current.count))
        }
        field.typeText(value)
        let committedValue = NSPredicate(format: "value == %@", value)
        let committed = XCTNSPredicateExpectation(predicate: committedValue, object: field)
        guard XCTWaiter.wait(for: [committed], timeout: 5) == .completed else {
            return XCTFail("text field \(identifier) did not commit the expected value; value=\(String(describing: field.value))")
        }
    }

    @MainActor
    private func replaceUnidentifiedText(in element: XCUIElement, with value: String) {
        XCTAssertTrue(element.waitForExistence(timeout: 5), "unidentified text editor is missing")
        element.coordinate(withNormalizedOffset: CGVector(dx: 0.85, dy: 0.5)).tap()
        let current = (element.value as? String) ?? ""
        if !current.isEmpty, current != element.placeholderValue {
            element.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: current.count))
        }
        element.typeText(value)
        let committed = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "value == %@", value),
            object: element
        )
        XCTAssertEqual(
            XCTWaiter.wait(for: [committed], timeout: 5),
            .completed,
            "unidentified text editor did not commit the expected value"
        )
    }

    @MainActor
    private func dismissDecisionReviewKeyboard(in app: XCUIApplication) {
        let done = app.buttons["decisionReviewKeyboardDone"].firstMatch
        guard done.waitForExistence(timeout: 5) else {
            return XCTFail("decision review keyboard has no explicit dismissal control")
        }
        done.tap()
        let dismissed = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "exists == false"),
            object: app.keyboards.firstMatch
        )
        guard XCTWaiter.wait(for: [dismissed], timeout: 5) == .completed else {
            return XCTFail("decision review keyboard did not dismiss")
        }
    }

    @MainActor
    private func replacePortfolioRiskAmount(in app: XCUIApplication, with value: String) {
        var amount = app.textFields["portfolioRiskAmountInput"]
        if !amount.exists {
            selectWorkspace("dailyPortfolioWorkspace-risk", in: app)
            amount = app.textFields["portfolioRiskAmountInput"]
        }
        scrollUntilHittable(amount, in: app)
        replaceText(in: amount, with: value, app: app)
        let done = findButton(
            in: app,
            identifier: "portfolioRiskKeyboardDone",
            label: "收起风险金额键盘"
        )
        XCTAssertTrue(done.waitForExistence(timeout: 5), "portfolio risk keyboard dismissal is missing")
        done.tap()
    }

    @MainActor
    private func dismissConditionalKeyboard(in app: XCUIApplication) {
        let done = app.buttons["annualConditionalKeyboardDone"].firstMatch
        guard done.waitForExistence(timeout: 5) else {
            XCTFail("conditional keyboard dismissal is missing")
            return
        }
        done.tap()
        let keyboardHidden = NSPredicate(format: "exists == false")
        let hidden = XCTNSPredicateExpectation(predicate: keyboardHidden, object: app.keyboards.firstMatch)
        XCTAssertEqual(
            XCTWaiter.wait(for: [hidden], timeout: 5),
            .completed,
            "conditional keyboard did not dismiss"
        )
    }

    @MainActor
    private func enterText(_ value: String, in element: XCUIElement, app: XCUIApplication) {
        let identifier = element.identifier
        guard !identifier.isEmpty else {
            return XCTFail("valuation text field is missing a stable accessibility identifier")
        }
        enterTextKeepingKeyboardOpen(value, identifier: identifier, app: app)
        dismissValuationKeyboard(in: app)
    }

    @MainActor
    private func enterValuationInputs(
        _ inputs: [(identifier: String, value: String)],
        in app: XCUIApplication,
        checkpoint: ((String) -> Void)?
    ) -> Bool {
        guard let first = inputs.first else { return true }
        guard bringTextFieldIntoViewport(identifier: first.identifier, in: app) else { return false }

        for (index, input) in inputs.enumerated() {
            if index > 0 {
                let next = app.buttons["valuationKeyboardNextButton"].firstMatch
                guard next.waitForExistence(timeout: 3), next.isHittable else {
                    XCTFail("valuation keyboard next control is unavailable before \(input.identifier)")
                    return false
                }
                next.tap()
            }

            let field = app.textFields[input.identifier].firstMatch
            let focused = XCTNSPredicateExpectation(
                predicate: NSPredicate(format: "hasKeyboardFocus == true"),
                object: field
            )
            if index == 0 {
                guard field.exists else {
                    XCTFail("valuation text field \(input.identifier) is missing after viewport scan")
                    return false
                }
                field.coordinate(withNormalizedOffset: CGVector(dx: 0.85, dy: 0.5)).tap()
            }
            guard XCTWaiter.wait(for: [focused], timeout: 3) == .completed else {
                XCTFail("valuation text field \(input.identifier) did not receive keyboard focus")
                return false
            }
            field.typeText(input.value)
            let committed = XCTNSPredicateExpectation(
                predicate: NSPredicate(format: "value == %@", input.value),
                object: field
            )
            guard XCTWaiter.wait(for: [committed], timeout: 3) == .completed else {
                XCTFail("valuation text field \(input.identifier) did not commit \(input.value)")
                return false
            }
            checkpoint?("prerequisites-valuation-input-\(input.identifier)")
        }
        return true
    }

    @MainActor
    private func enterReviewLearningInputs(
        _ inputs: [(identifier: String, value: String)],
        in app: XCUIApplication,
        checkpoint: ((String) -> Void)?
    ) -> Bool {
        guard let first = inputs.first else { return true }
        guard bringTextFieldIntoViewport(identifier: first.identifier, in: app) else { return false }

        for (index, input) in inputs.enumerated() {
            if index > 0 {
                let next = app.buttons["reviewLearningKeyboardNextButton"].firstMatch
                guard next.waitForExistence(timeout: 3), next.isHittable else {
                    XCTFail("review learning keyboard next control is unavailable before \(input.identifier)")
                    return false
                }
                next.tap()
            }

            let field = app.textFields[input.identifier].firstMatch
            guard field.exists else {
                XCTFail("review learning text field \(input.identifier) is missing")
                return false
            }
            if index == 0 {
                field.coordinate(withNormalizedOffset: CGVector(dx: 0.85, dy: 0.5)).tap()
            }
            let focused = XCTNSPredicateExpectation(
                predicate: NSPredicate(format: "hasKeyboardFocus == true"),
                object: field
            )
            guard XCTWaiter.wait(for: [focused], timeout: 3) == .completed else {
                XCTFail("review learning text field \(input.identifier) did not receive keyboard focus")
                return false
            }
            field.typeText(input.value)
            let committed = XCTNSPredicateExpectation(
                predicate: NSPredicate(format: "value == %@", input.value),
                object: field
            )
            guard XCTWaiter.wait(for: [committed], timeout: 3) == .completed else {
                XCTFail("review learning text field \(input.identifier) did not commit the expected value")
                return false
            }
            checkpoint?("review-learning-input-\(input.identifier)")
        }
        return true
    }

    @MainActor
    private func enterTextKeepingKeyboardOpen(_ value: String, identifier: String, app: XCUIApplication) {
        guard bringTextFieldIntoViewport(identifier: identifier, in: app) else { return }
        let focused = NSPredicate(format: "hasKeyboardFocus == true")
        var field = app.textFields[identifier].firstMatch
        var acquiredFocus = false
        for attempt in 0..<2 {
            field = app.textFields[identifier].firstMatch
            guard field.exists else {
                return XCTFail("valuation text field \(identifier) is missing after forward scan")
            }
            field.coordinate(withNormalizedOffset: CGVector(dx: 0.85, dy: 0.5)).tap()
            let expectation = XCTNSPredicateExpectation(predicate: focused, object: field)
            if XCTWaiter.wait(for: [expectation], timeout: 2) == .completed {
                acquiredFocus = true
                break
            }
            if attempt == 1 {
                return XCTFail("text field \(identifier) did not acquire keyboard focus")
            }
        }
        guard acquiredFocus else { return }
        field.typeText(value)
        let committed = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "value == %@", value),
            object: field
        )
        XCTAssertEqual(
            XCTWaiter.wait(for: [committed], timeout: 3),
            .completed,
            "valuation text field \(identifier) did not commit \(value)"
        )
    }

    @MainActor
    private func replaceTrailingText(in element: XCUIElement, with value: String, app: XCUIApplication) {
        XCTAssertTrue(element.waitForExistence(timeout: 5), "text field is missing")
        let identifier = element.identifier
        guard bringTextFieldIntoViewport(identifier: identifier, in: app) else { return }
        let field = app.textFields[identifier].firstMatch
        XCTAssertTrue(field.exists, "text field \(identifier) is missing after viewport positioning")
        field.coordinate(withNormalizedOffset: CGVector(dx: 0.85, dy: 0.5)).tap()
        let focusExpectation = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "hasKeyboardFocus == true"),
            object: field
        )
        guard XCTWaiter.wait(for: [focusExpectation], timeout: 2) == .completed else {
            XCTFail("text field \(identifier) did not acquire keyboard focus")
            return
        }
        let current = (field.value as? String) ?? ""
        if !current.isEmpty, current != field.label {
            field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: current.count))
        }
        field.typeText(value)
        dismissValuationKeyboard(in: app)
    }

    @MainActor
    private func bringTextFieldIntoViewport(_ element: XCUIElement, in app: XCUIApplication) -> Bool {
        let identifier = element.identifier
        guard !identifier.isEmpty else {
            XCTFail("text field is missing a stable accessibility identifier")
            return false
        }
        return bringTextFieldIntoViewport(identifier: identifier, in: app)
    }

    @MainActor
    private func bringTextFieldIntoViewport(identifier: String, in app: XCUIApplication) -> Bool {
        let scrollView = app.scrollViews["researchScrollView"].firstMatch
        XCTAssertTrue(scrollView.waitForExistence(timeout: 10), "research scroll view is missing")
        for _ in 0..<20 {
            let field = app.descendants(matching: .any)[identifier].firstMatch
            guard field.exists else {
                scrollView.swipeUp()
                continue
            }
            let frame = field.frame
            let keyboard = app.keyboards.firstMatch
            let tabBar = app.tabBars.firstMatch
            let navigationBar = app.navigationBars.firstMatch
            var visibleTop = max(scrollView.frame.minY, app.frame.minY) + 12
            if navigationBar.exists {
                visibleTop = max(visibleTop, navigationBar.frame.maxY + 12)
            }
            var visibleBottom = min(scrollView.frame.maxY, app.frame.maxY) - 12
            if keyboard.exists {
                visibleBottom = min(visibleBottom, keyboard.frame.minY - 12)
            }
            if tabBar.exists {
                visibleBottom = min(visibleBottom, tabBar.frame.minY - 12)
            }
            if !frame.isEmpty, frame.minY >= visibleTop, frame.maxY <= visibleBottom {
                return true
            }
            if frame.isEmpty || frame.maxY > visibleBottom {
                scrollView.swipeUp()
            } else {
                scrollView.swipeDown()
            }
        }
        let field = app.descendants(matching: .any)[identifier].firstMatch
        XCTFail("text field \(identifier) did not enter the visible viewport; frame=\(field.frame)")
        return false
    }

    @MainActor
    private func dismissReviewLearningKeyboard(in app: XCUIApplication) {
        let done = app.buttons["reviewLearningKeyboardDone"].firstMatch
        guard done.waitForExistence(timeout: 5) else {
            XCTFail("review learning keyboard dismissal is missing")
            return
        }
        done.tap()
        let keyboardHidden = NSPredicate(format: "exists == false")
        let hidden = XCTNSPredicateExpectation(predicate: keyboardHidden, object: app.keyboards.firstMatch)
        XCTAssertEqual(
            XCTWaiter.wait(for: [hidden], timeout: 5),
            .completed,
            "review learning keyboard did not dismiss"
        )
    }

    @MainActor
    private func dismissValuationKeyboard(in app: XCUIApplication) {
        let hidden = NSPredicate(format: "exists == false")
        for attempt in 0..<3 {
            let dismiss = app.buttons["valuationKeyboardDismissButton"].firstMatch
            XCTAssertTrue(dismiss.waitForExistence(timeout: 3), "valuation keyboard dismiss control is missing")
            dismiss.tap()
            let expectation = XCTNSPredicateExpectation(predicate: hidden, object: app.keyboards.firstMatch)
            if XCTWaiter.wait(for: [expectation], timeout: 2) == .completed {
                return
            }
            if attempt < 2 {
                app.scrollViews["researchScrollView"].firstMatch.swipeDown()
            }
        }
        XCTFail("valuation keyboard did not dismiss after bounded retries")
    }

    @MainActor
    private func addPhysicalScreenshot(_ name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    @MainActor
    private func attachScreenshot(named name: String, app: XCUIApplication) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

}
