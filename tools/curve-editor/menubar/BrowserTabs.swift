import AppKit
import Foundation

struct BrowserTarget: Equatable {
    enum Kind { case chromium, safari }
    let bundleID: String
    let name: String
    let kind: Kind

    static func supported(_ app: NSRunningApplication) -> BrowserTarget? {
        guard let id = app.bundleIdentifier else { return nil }
        let kind: Kind
        switch id {
        case "com.google.Chrome", "com.microsoft.edgemac", "com.brave.Browser": kind = .chromium
        case "com.apple.Safari": kind = .safari
        default: return nil
        }
        return BrowserTarget(bundleID: id, name: app.localizedName ?? id, kind: kind)
    }
}

enum BrowserTabAddress {
    static func candidates(for url: URL) -> [String] {
        guard var parts = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return [url.absoluteString] }
        var result = [url.absoluteString]
        // Browsers add a slash to root URLs. Keep every query parameter: a
        // different client can have a different draft in a shared workspace.
        if parts.path.isEmpty || parts.path == "/" {
            parts.path = parts.path.isEmpty ? "/" : ""
            if let variant = parts.string, !result.contains(variant) { result.append(variant) }
        }
        return result
    }
}

enum BrowserTabOpenResult { case activated, opened }

enum BrowserTabError: LocalizedError {
    case unavailable(String)
    case permission(String)
    case openFailed

    var errorDescription: String? {
        switch self {
        case .unavailable(let name): return "暂时无法检查 \(name) 的标签页，请稍后重试。"
        case .permission(let name):
            return "需要允许“通用矢量图编辑器”控制 \(name)，才能切换已有标签页。请在系统设置 → 隐私与安全性 → 自动化中允许后重试。"
        case .openFailed: return "浏览器未能打开编辑器地址，请稍后重试。"
        }
    }
}

enum BrowserTabRouter {
    static func open(_ url: URL, browsers: [BrowserTarget], preferredBundleID: String?,
                     activate: (BrowserTarget, [String]) throws -> Bool,
                     openNew: (URL) -> Bool) throws -> BrowserTabOpenResult {
        let ordered = browsers.filter { $0.bundleID == preferredBundleID } + browsers.filter { $0.bundleID != preferredBundleID }
        let candidates = BrowserTabAddress.candidates(for: url)
        var failure: Error?
        for browser in ordered {
            do { if try activate(browser, candidates) { return .activated } }
            catch { if failure == nil { failure = error } }
        }
        // A denied/timed-out check is not evidence that the tab is absent.
        if let failure { throw failure }
        guard openNew(url) else { throw BrowserTabError.openFailed }
        return .opened
    }
}

enum BrowserTabScript {
    private static func literal(_ value: String) -> String {
        "\"" + value.replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
            .replacingOccurrences(of: "\r", with: "\\r")
            .replacingOccurrences(of: "\n", with: "\\n") + "\""
    }

    static func source(browser: BrowserTarget, candidates: [String]) -> String {
        let selection: String
        switch browser.kind {
        case .chromium:
            selection = "set active tab index of browserWindow to tabIndex\nset minimized of browserWindow to false"
        case .safari:
            selection = "set current tab of browserWindow to tab tabIndex of browserWindow"
        }
        return """
        set desiredURLs to {\(candidates.map(literal).joined(separator: ", "))}
        if application id \(literal(browser.bundleID)) is not running then return false
        with timeout of 10 seconds
            tell application id \(literal(browser.bundleID))
                repeat with browserWindow in windows
                    set tabURLs to URL of every tab of browserWindow
                    repeat with tabIndex from 1 to count of tabURLs
                        considering case
                            set matchesAddress to (item tabIndex of tabURLs) is in desiredURLs
                        end considering
                        if matchesAddress then
                            \(selection)
                            set index of browserWindow to 1
                            activate
                            return true
                        end if
                    end repeat
                end repeat
            end tell
        end timeout
        return false
        """
    }
}

struct BrowserTabOpener {
    func open(_ url: URL) throws -> BrowserTabOpenResult {
        let workspace = NSWorkspace.shared
        let browsers = workspace.runningApplications.compactMap(BrowserTarget.supported)
        let preferred = workspace.urlForApplication(toOpen: url).flatMap { Bundle(url: $0)?.bundleIdentifier }
        return try BrowserTabRouter.open(url, browsers: browsers, preferredBundleID: preferred,
            activate: { browser, candidates in
                guard let script = NSAppleScript(source: BrowserTabScript.source(browser: browser, candidates: candidates)) else {
                    throw BrowserTabError.unavailable(browser.name)
                }
                var error: NSDictionary?
                let result = script.executeAndReturnError(&error)
                if let error {
                    let code = error[NSAppleScript.errorNumber] as? Int
                    if code == -600 { return false } // The browser quit during discovery.
                    if code == -1743 { throw BrowserTabError.permission(browser.name) }
                    throw BrowserTabError.unavailable(browser.name)
                }
                return result.booleanValue
            }, openNew: { workspace.open($0) })
    }
}
