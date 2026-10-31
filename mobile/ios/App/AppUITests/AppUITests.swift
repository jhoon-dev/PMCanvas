import XCTest

final class AppUITests: XCTestCase {
    private func dismissKeyboard(_ app: XCUIApplication) {
        let done = app.toolbars.buttons["Done"]
        if done.waitForExistence(timeout: 5) { done.tap() }
    }

    private func keepStoreScreenshot(_ app: XCUIApplication, _ name: String) {
        // Wait for the save toast to disappear so the actual content is unobscured.
        let toast = app.webViews.staticTexts.matching(NSPredicate(format: "label ENDSWITH %@", "했습니다.")).firstMatch
        if toast.exists { XCTAssertTrue(toast.waitForNonExistence(timeout: 8)) }
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = "Store " + name
        shot.lifetime = .keepAlways
        add(shot)
    }

    func testStoreScreenshots() {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .portrait
        let app = XCUIApplication()
        app.launch()
        let web = app.webViews.firstMatch
        let create = web.buttons["＋ 새 프로젝트"]
        XCTAssertTrue(create.waitForExistence(timeout: 60), "Bundled Store screen did not load")
        web.buttons["개인정보처리방침"].tap()
        XCTAssertTrue(web.staticTexts["기기에 보관하는 정보"].waitForExistence(timeout: 10))
        web.buttons["개인정보처리방침 닫기"].tap()
        create.tap()
        let projectName = "Autumn Release Plan"
        let name = web.textFields.firstMatch
        XCTAssertTrue(name.waitForExistence(timeout: 10))
        name.tap(); name.typeText(projectName); dismissKeyboard(app)
        web.buttons["저장"].tap()
        XCTAssertTrue(web.staticTexts[projectName].waitForExistence(timeout: 10))

        web.links["더보기"].tap()
        web.buttons["＋ 추가"].tap()
        let person = web.textFields.firstMatch
        XCTAssertTrue(person.waitForExistence(timeout: 5))
        person.tap(); person.typeText("Alex"); dismissKeyboard(app)
        web.buttons["저장"].tap()
        XCTAssertTrue(web.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Alex")).firstMatch.waitForExistence(timeout: 10))

        web.links["업무"].tap()
        for (task, detail) in [("UX review", "Review navigation"), ("Release build", "Prepare store package"), ("Launch checklist", "Confirm launch readiness")] {
            web.buttons.matching(NSPredicate(format: "label == %@", "＋ 업무 추가")).firstMatch.tap()
            let title = web.textFields.matching(NSPredicate(format: "placeholderValue == %@", "예: 회원 관리 기능 개발")).firstMatch
            XCTAssertTrue(title.waitForExistence(timeout: 5))
            title.tap(); title.typeText(task); dismissKeyboard(app)
            let item = web.textFields["세부 작업 이름"]
            XCTAssertTrue(item.waitForExistence(timeout: 5))
            item.tap(); item.typeText(detail); dismissKeyboard(app)
            web.buttons["저장"].tap()
            XCTAssertTrue(web.buttons[task].waitForExistence(timeout: 10))
        }
        keepStoreScreenshot(app, "tasks")
        web.links["완료 체크"].tap()
        let check = web.checkBoxes.matching(NSPredicate(format: "label CONTAINS %@", "Review navigation")).firstMatch
        XCTAssertTrue(check.waitForExistence(timeout: 10), app.debugDescription)
        check.tap()
        keepStoreScreenshot(app, "checklist")
        web.links["현황"].tap()
        XCTAssertTrue(web.staticTexts["33%"].waitForExistence(timeout: 10))
        keepStoreScreenshot(app, "overview")
        web.links["더보기"].tap()
        keepStoreScreenshot(app, "people")

        app.terminate(); app.launch()
        let saved = app.webViews.buttons.matching(NSPredicate(format: "label CONTAINS %@", projectName)).firstMatch
        XCTAssertTrue(saved.waitForExistence(timeout: 30), "Store sample disappeared after relaunch")
        saved.tap()
        XCTAssertTrue(app.webViews.staticTexts["33%"].waitForExistence(timeout: 10))
    }

    func testProjectSurvivesRelaunchAndPolicyIsAvailableOffline() {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launch()
        let web = app.webViews.firstMatch
        let create = web.buttons["＋ 새 프로젝트"]
        XCTAssertTrue(create.waitForExistence(timeout: 30), "Bundled iPhone screen did not load")

        web.buttons["개인정보처리방침"].tap()
        XCTAssertTrue(web.staticTexts["기기에 보관하는 정보"].waitForExistence(timeout: 5))
        web.buttons["개인정보처리방침 닫기"].tap()

        create.tap()
        let name = web.textFields.firstMatch
        XCTAssertTrue(name.waitForExistence(timeout: 5))
        name.tap()
        name.typeText("iPhone persistence check")
        // WKWebView's accessory toolbar covers the form actions while typing.
        // Dismiss it through the same native Done control available to users.
        let keyboardDone = app.toolbars.buttons["Done"]
        XCTAssertTrue(keyboardDone.waitForExistence(timeout: 5))
        keyboardDone.tap()
        web.buttons["저장"].tap()
        XCTAssertTrue(web.staticTexts["iPhone persistence check"].waitForExistence(timeout: 10), app.debugDescription)

        let overview = XCTAttachment(screenshot: app.screenshot())
        overview.name = "iPhone project overview"
        overview.lifetime = .keepAlways
        add(overview)

        app.terminate()
        app.launch()
        let relaunchedWeb = app.webViews.firstMatch
        // A fresh WebContent process can start after native launch has idled.
        // Check page readiness separately so a slow boot is not reported as data loss.
        XCTAssertTrue(relaunchedWeb.buttons["＋ 새 프로젝트"].waitForExistence(timeout: 60), "Bundled iPhone screen did not load after relaunch: \(app.debugDescription)")
        let savedProject = relaunchedWeb.buttons.matching(NSPredicate(format: "label CONTAINS %@", "iPhone persistence check")).firstMatch
        XCTAssertTrue(savedProject.waitForExistence(timeout: 20), "Committed project disappeared after relaunch: \(app.debugDescription)")
        savedProject.tap()
        XCTAssertTrue(app.webViews.staticTexts["iPhone persistence check"].waitForExistence(timeout: 10))
        let restored = XCTAttachment(screenshot: app.screenshot())
        restored.name = "iPhone project restored after relaunch"
        restored.lifetime = .keepAlways
        add(restored)
    }
}
