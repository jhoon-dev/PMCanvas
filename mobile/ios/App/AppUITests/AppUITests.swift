import XCTest

final class AppUITests: XCTestCase {
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
        web.buttons["저장"].tap()
        XCTAssertTrue(web.staticTexts["iPhone persistence check"].waitForExistence(timeout: 10))

        let overview = XCTAttachment(screenshot: app.screenshot())
        overview.name = "iPhone project overview"
        overview.lifetime = .keepAlways
        add(overview)

        app.terminate()
        app.launch()
        let savedProject = app.webViews.buttons.matching(NSPredicate(format: "label CONTAINS %@", "iPhone persistence check")).firstMatch
        XCTAssertTrue(savedProject.waitForExistence(timeout: 20), "Committed project disappeared after relaunch")
        savedProject.tap()
        XCTAssertTrue(app.webViews.staticTexts["iPhone persistence check"].waitForExistence(timeout: 10))
        let restored = XCTAttachment(screenshot: app.screenshot())
        restored.name = "iPhone project restored after relaunch"
        restored.lifetime = .keepAlways
        add(restored)
    }
}
