import XCTest

final class AppUITests: XCTestCase {
    private var storeApp: XCUIApplication?

    override func tearDown() {
        // hasSucceeded isn't final during tearDown. Only recorded failures need
        // diagnostics; successful tests must not request another screenshot/tree.
        if let app = storeApp, (testRun?.totalFailureCount ?? 0) > 0 {
            let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
            shot.name = "Store failure state"
            shot.lifetime = .keepAlways
            add(shot)
            let tree = XCTAttachment(string: app.debugDescription)
            tree.name = "Store failure accessibility"
            tree.lifetime = .keepAlways
            add(tree)
        }
        super.tearDown()
    }

    private func dismissKeyboard(_ app: XCUIApplication) {
        let done = app.buttons["Done"]
        if done.exists { done.tap() }
        else {
            let hide = app.keyboards.buttons["Hide keyboard"]
            if hide.exists { hide.tap() }
        }
    }

    private func enter(_ text: String, in field: XCUIElement, app: XCUIApplication) {
        XCTAssertTrue(field.wait(for: \.isHittable, toEqual: true, timeout: 10))
        field.tap()
        let keyboard = app.keyboards.firstMatch
        // Allow the software keyboard's resize to settle. An attached hardware
        // keyboard (including iPad's input assistant) has no Keyboard element;
        // native typeText still verifies that a first responder accepts input.
        _ = keyboard.waitForExistence(timeout: 5)
        // Address the labeled field, not whichever descendant of the app has
        // native focus. Wait for WebKit to expose each delivered character before
        // sending the next one; a dropped key must fail here, not pass unnoticed.
        var entered = ""
        for character in text {
            field.typeText(String(character))
            entered.append(character)
            let delivered = XCTNSPredicateExpectation(
                predicate: NSPredicate(format: "value == %@", entered), object: field
            )
            // A hosted iPad simulator can spend more than ten seconds resolving
            // an accessibility snapshot even when WebKit accepted the key. Keep
            // the exact value check, allowing the native snapshot to catch up.
            XCTAssertEqual(XCTWaiter.wait(for: [delivered], timeout: 30), .completed,
                           "Input delivery: \(String(reflecting: field.value)); expected: \(String(reflecting: entered))\n\(app.debugDescription)")
        }
        dismissKeyboard(app)
        let committed = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "value == %@", text), object: field
        )
        XCTAssertEqual(XCTWaiter.wait(for: [committed], timeout: 30), .completed,
                       "Input value: \(String(reflecting: field.value)); expected: \(String(reflecting: text))\n\(app.debugDescription)")
    }

    private func reveal(_ element: XCUIElement, in web: XCUIElement, app: XCUIApplication) {
        // WKWebView can expose a checkbox below the viewport as hittable. Keep
        // its whole frame between the fixed header and bottom navigation before
        // sending a native tap, so the navigation cannot intercept the gesture.
        let visible = CGRect(x: app.frame.minX, y: app.frame.minY + 160,
                             width: app.frame.width, height: app.frame.height - 290)
        for _ in 0..<8 {
            let frame = element.frame
            if element.isHittable && visible.contains(frame) { return }
            // A full swipe can move the row past the header and oscillate back
            // below the footer. Use a bounded drag and stop before lifting.
            let distance = max(-180, min(180, frame.midY - visible.midY))
            let start = web.coordinate(withNormalizedOffset: CGVector(dx: 0.85, dy: 0.55))
            let end = start.withOffset(CGVector(dx: 0, dy: -distance))
            start.press(forDuration: 0.1, thenDragTo: end,
                        withVelocity: .slow, thenHoldForDuration: 0.2)
        }
        XCTAssertTrue(element.isHittable && visible.contains(element.frame),
                      "Control did not enter the visible workspace: \(element.debugDescription)")
    }

    private func keepScreenshot(_ app: XCUIApplication, _ name: String,
                                ready element: XCUIElement, repetitions: Int = 1) {
        guard app.wait(for: .runningForeground, timeout: 10) else {
            XCTFail("Screenshot requires the foreground app: \(name)")
            return
        }
        guard element.waitForExistence(timeout: 10) else {
            XCTFail("Screenshot content did not become ready: \(name)")
            return
        }
        // Both Store and persistence captures wait for save feedback to disappear.
        let toast = app.webViews.staticTexts.matching(NSPredicate(
            format: "label ENDSWITH %@ OR label == %@", "했습니다.",
            "새 프로젝트를 만들었습니다. 참여인력부터 추가해 보세요."
        )).firstMatch
        guard !toast.exists || toast.waitForNonExistence(timeout: 8) else {
            XCTFail("Save feedback still covers the screenshot: \(name)")
            return
        }
        for index in 1...repetitions {
            XCTAssertEqual(app.state, .runningForeground)
            XCTAssertTrue(element.exists, "Screenshot content disappeared: \(name)")
            // Capture the device screen directly instead of an app-element crop.
            // A capture error still fails the test; no retries or skipped assertions.
            let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
            shot.name = index == 1 ? name : "\(name) repeat \(index)"
            shot.lifetime = .keepAlways
            add(shot)
        }
    }

    private func openScreen(_ title: String, in web: XCUIElement) {
        let menu = web.buttons["프로젝트 메뉴 열기"]
        XCTAssertTrue(menu.wait(for: \.isHittable, toEqual: true, timeout: 10))
        menu.tap()
        let destination = web.links[title]
        XCTAssertTrue(destination.wait(for: \.isHittable, toEqual: true, timeout: 10))
        destination.tap()
        XCTAssertTrue(web.staticTexts[title].waitForExistence(timeout: 10))
    }

    func testStoreScreenshots() {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .portrait
        let app = XCUIApplication()
        storeApp = app
        app.launch()
        let web = app.webViews.firstMatch
        let create = web.buttons["＋ 새 프로젝트"]
        XCTAssertTrue(create.wait(for: \.isHittable, toEqual: true, timeout: 120), "Bundled Store screen did not load")
        web.buttons["개인정보처리방침"].tap()
        XCTAssertTrue(web.staticTexts["기기에 보관하는 정보"].waitForExistence(timeout: 20))
        web.buttons["개인정보처리방침 닫기"].tap()
        create.tap()
        let projectName = "Autumn Release Plan"
        let name = web.textFields["프로젝트명"]
        XCTAssertTrue(name.waitForExistence(timeout: 10))
        enter(projectName, in: name, app: app)
        web.buttons["저장"].tap()
        XCTAssertTrue(web.links.matching(NSPredicate(format: "label CONTAINS %@", projectName)).firstMatch.waitForExistence(timeout: 10))

        openScreen("참여인력", in: web)
        let addPerson = web.buttons.matching(identifier: "＋ 참여인력 추가").firstMatch
        XCTAssertTrue(addPerson.wait(for: \.isHittable, toEqual: true, timeout: 10))
        addPerson.tap()
        let person = web.textFields["이름"]
        XCTAssertTrue(person.waitForExistence(timeout: 5))
        enter("Alex", in: person, app: app)
        web.buttons["저장"].tap()
        XCTAssertTrue(web.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Alex")).firstMatch.waitForExistence(timeout: 10))

        openScreen("업무 · 일정", in: web)
        for (task, detail) in [("UX review", "Review navigation"), ("Release build", "Prepare store package"), ("Launch checklist", "Confirm launch readiness")] {
            web.buttons.matching(NSPredicate(format: "label == %@", "＋ 업무 추가")).firstMatch.tap()
            // Track the input by its stable label while its editing state changes,
            // rather than re-resolving a placeholder predicate after typing.
            let title = web.textFields["업무명"]
            XCTAssertTrue(title.waitForExistence(timeout: 5))
            enter(task, in: title, app: app)
            let item = web.textFields["세부 작업 이름"]
            XCTAssertTrue(item.waitForExistence(timeout: 5))
            enter(detail, in: item, app: app)
            web.buttons["저장"].tap()
            XCTAssertTrue(web.buttons[task].waitForExistence(timeout: 10), app.debugDescription)
        }
        keepScreenshot(app, "Store tasks", ready: web.staticTexts["업무 · 일정"])
        openScreen("완료 체크", in: web)
        // WKWebView exposes HTML checkboxes as native accessibility switches.
        let check = web.switches.matching(NSPredicate(format: "label CONTAINS %@", "Review navigation")).firstMatch
        XCTAssertTrue(check.waitForExistence(timeout: 10), app.debugDescription)
        reveal(check, in: web, app: app)
        check.tap()
        let checked = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "value == %@", "1"), object: check
        )
        XCTAssertEqual(XCTWaiter.wait(for: [checked], timeout: 10), .completed, app.debugDescription)
        keepScreenshot(app, "Store checklist", ready: web.staticTexts["완료 체크"])
        openScreen("프로젝트 현황", in: web)
        XCTAssertTrue(web.staticTexts["33%"].waitForExistence(timeout: 10))
        keepScreenshot(app, "Store overview", ready: web.staticTexts["프로젝트 현황"])
        openScreen("참여인력", in: web)
        keepScreenshot(app, "Store people", ready: web.staticTexts["참여인력"])

        app.terminate(); app.launch()
        let saved = app.webViews.buttons.matching(NSPredicate(format: "label CONTAINS %@", projectName)).firstMatch
        XCTAssertTrue(saved.waitForExistence(timeout: 30), "Store sample disappeared after relaunch")
        saved.tap()
        XCTAssertTrue(app.webViews.staticTexts["33%"].waitForExistence(timeout: 10))
    }

    func testProjectSurvivesRelaunchAndPolicyIsAvailableOffline() {
        continueAfterFailure = false
        let app = XCUIApplication()
        storeApp = app
        app.launch()
        let web = app.webViews.firstMatch
        let create = web.buttons["＋ 새 프로젝트"]
        XCTAssertTrue(create.wait(for: \.isHittable, toEqual: true, timeout: 120), "Bundled iPhone screen did not load")

        web.buttons["개인정보처리방침"].tap()
        XCTAssertTrue(web.staticTexts["기기에 보관하는 정보"].waitForExistence(timeout: 20))
        web.buttons["개인정보처리방침 닫기"].tap()

        create.tap()
        let name = web.textFields["프로젝트명"]
        enter("iPhone persistence check", in: name, app: app)
        web.buttons["저장"].tap()
        let project = web.links.matching(NSPredicate(format: "label CONTAINS %@", "iPhone persistence check")).firstMatch
        XCTAssertTrue(project.waitForExistence(timeout: 10), app.debugDescription)
        keepScreenshot(app, "iPhone project overview", ready: project, repetitions: 3)

        app.terminate()
        app.launch()
        let relaunchedWeb = app.webViews.firstMatch
        // A fresh WebContent process can start after native launch has idled.
        // Check page readiness separately so a slow boot is not reported as data loss.
        XCTAssertTrue(relaunchedWeb.buttons["＋ 새 프로젝트"].waitForExistence(timeout: 120), "Bundled iPhone screen did not load after relaunch: \(app.debugDescription)")
        let savedProject = relaunchedWeb.buttons.matching(NSPredicate(format: "label CONTAINS %@", "iPhone persistence check")).firstMatch
        XCTAssertTrue(savedProject.waitForExistence(timeout: 20), "Committed project disappeared after relaunch: \(app.debugDescription)")
        savedProject.tap()
        let restored = app.webViews.links.matching(NSPredicate(format: "label CONTAINS %@", "iPhone persistence check")).firstMatch
        XCTAssertTrue(restored.waitForExistence(timeout: 10))
        keepScreenshot(app, "iPhone project restored after relaunch", ready: restored, repetitions: 3)
    }
}
