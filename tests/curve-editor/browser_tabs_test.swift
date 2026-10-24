import AppKit
import Foundation

@main
enum BrowserTabsTests {
    static func main() throws {
        let url = URL(string: "http://127.0.0.1:8773?client=member-a")!
        let chrome = BrowserTarget(bundleID: "com.google.Chrome", name: "Chrome", kind: .chromium)
        let safari = BrowserTarget(bundleID: "com.apple.Safari", name: "Safari", kind: .safari)
        let variants = BrowserTabAddress.candidates(for: url)
        precondition(variants.contains("http://127.0.0.1:8773/?client=member-a"))
        precondition(variants.contains(url.absoluteString))
        precondition(!variants.contains("http://127.0.0.1:8773/?client=member-b"))
        precondition(!variants.contains("http://127.0.0.1:8774/?client=member-a"))
        precondition(!variants.contains("http://localhost:8773/?client=member-a"))

        var visited: [String] = []
        var opened = 0
        let found = try BrowserTabRouter.open(url, browsers: [safari, chrome], preferredBundleID: chrome.bundleID,
            activate: { browser, targets in
                visited.append(browser.bundleID)
                precondition(targets == variants)
                return browser.bundleID == chrome.bundleID
            }, openNew: { _ in opened += 1; return true })
        precondition(found == .activated && opened == 0 && visited == [chrome.bundleID])

        visited = []
        let elsewhere = try BrowserTabRouter.open(url, browsers: [chrome, safari], preferredBundleID: chrome.bundleID,
            activate: { browser, _ in visited.append(browser.bundleID); return browser.bundleID == safari.bundleID },
            openNew: { _ in opened += 1; return true })
        precondition(elsewhere == .activated && opened == 0 && visited == [chrome.bundleID, safari.bundleID])

        let absent = try BrowserTabRouter.open(url, browsers: [chrome], preferredBundleID: nil,
            activate: { _, _ in false }, openNew: { actual in precondition(actual == url); opened += 1; return true })
        precondition(absent == .opened && opened == 1)
        let noBrowser = try BrowserTabRouter.open(url, browsers: [], preferredBundleID: nil,
            activate: { _, _ in preconditionFailure("must not query a stopped browser") },
            openNew: { _ in opened += 1; return true })
        precondition(noBrowser == .opened && opened == 2)

        enum Denied: Error { case automation }
        do {
            _ = try BrowserTabRouter.open(url, browsers: [chrome], preferredBundleID: nil,
                activate: { _, _ in throw Denied.automation }, openNew: { _ in opened += 1; return true })
            preconditionFailure("permission errors must remain visible")
        } catch Denied.automation { precondition(opened == 2) }
        let afterError = try BrowserTabRouter.open(url, browsers: [chrome, safari], preferredBundleID: nil,
            activate: { browser, _ in if browser == chrome { throw Denied.automation }; return true },
            openNew: { _ in opened += 1; return true })
        precondition(afterError == .activated && opened == 2)

        let chromiumScript = BrowserTabScript.source(browser: chrome, candidates: variants)
        let safariScript = BrowserTabScript.source(browser: safari, candidates: variants)
        for source in [chromiumScript, safariScript] {
            precondition(!source.contains("set URL") && !source.contains("reload"))
            precondition(source.contains("return true") && source.contains("return false"))
            var error: NSDictionary?
            precondition(NSAppleScript(source: source)!.compileAndReturnError(&error), "script compilation failed: \(String(describing: error))")
        }
        print("Passed: URL identity, existing-tab activation, default-browser priority, new-tab fallback, denied access and script compilation")
    }
}
