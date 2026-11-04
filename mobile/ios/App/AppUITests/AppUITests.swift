import XCTest

final class AppUITests: XCTestCase {
    private var storeApp: XCUIApplication?

    override func tearDown() {
        if let app = storeApp, testRun?.hasSucceeded == false {
            let shot = XCTAttachment(screenshot: app.screenshot())
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
        // A single rapid key sequence can outrun WKWebView on shared CI hosts.
        // Let XCTest idle between characters, then commit the keyboard input.
        // Send keys to the application's native first responder. Re-resolving a
        // WKWebView field for every character can lose its native focus snapshot.
        for character in text { app.typeText(String(character)) }
        dismissKeyboard(app)
        let committed = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "value == %@", text), object: field
        )
        XCTAssertEqual(XCTWaiter.wait(for: [committed], timeout: 10), .completed,
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

        web.links["인력"].tap()
        let addPerson = web.buttons.matching(identifier: "＋ 참여인력 추가").firstMatch
        XCTAssertTrue(addPerson.wait(for: \.isHittable, toEqual: true, timeout: 10))
        addPerson.tap()
        let person = web.textFields["이름"]
        XCTAssertTrue(person.waitForExistence(timeout: 5))
        enter("Alex", in: person, app: app)
        web.buttons["저장"].tap()
        XCTAssertTrue(web.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Alex")).firstMatch.waitForExistence(timeout: 10))

        web.links["업무"].tap()
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
        keepStoreScreenshot(app, "tasks")
        web.links["완료 체크"].tap()
        // WKWebView exposes HTML checkboxes as native accessibility switches.
        let check = web.switches.matching(NSPredicate(format: "label CONTAINS %@", "Review navigation")).firstMatch
        XCTAssertTrue(check.waitForExistence(timeout: 10), app.debugDescription)
        reveal(check, in: web, app: app)
        check.tap()
        let checked = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "value == %@", "1"), object: check
        )
        XCTAssertEqual(XCTWaiter.wait(for: [checked], timeout: 10), .completed, app.debugDescription)
        keepStoreScreenshot(app, "checklist")
        web.links["현황"].tap()
        XCTAssertTrue(web.staticTexts["33%"].waitForExistence(timeout: 10))
        keepStoreScreenshot(app, "overview")
        web.links["인력"].tap()
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
        XCTAssertTrue(web.links.matching(NSPredicate(format: "label CONTAINS %@", "iPhone persistence check")).firstMatch.waitForExistence(timeout: 10), app.debugDescription)

        let overview = XCTAttachment(screenshot: app.screenshot())
        overview.name = "iPhone project overview"
        overview.lifetime = .keepAlways
        add(overview)

        app.terminate()
        app.launch()
        let relaunchedWeb = app.webViews.firstMatch
        // A fresh WebContent process can start after native launch has idled.
        // Check page readiness separately so a slow boot is not reported as data loss.
        XCTAssertTrue(relaunchedWeb.buttons["＋ 새 프로젝트"].waitForExistence(timeout: 120), "Bundled iPhone screen did not load after relaunch: \(app.debugDescription)")
        let savedProject = relaunchedWeb.buttons.matching(NSPredicate(format: "label CONTAINS %@", "iPhone persistence check")).firstMatch
        XCTAssertTrue(savedProject.waitForExistence(timeout: 20), "Committed project disappeared after relaunch: \(app.debugDescription)")
        savedProject.tap()
        XCTAssertTrue(app.webViews.links.matching(NSPredicate(format: "label CONTAINS %@", "iPhone persistence check")).firstMatch.waitForExistence(timeout: 10))
        let restored = XCTAttachment(screenshot: app.screenshot())
        restored.name = "iPhone project restored after relaunch"
        restored.lifetime = .keepAlways
        add(restored)
    }
}
