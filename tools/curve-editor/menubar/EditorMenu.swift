import AppKit
import Foundation

private struct AppConfiguration: Decodable {
    let python: String
    let manager: String
    let project: String
}

private struct Editor: Decodable {
    let id: String
    let drawingId: String?
    let name: String
    let edition: String?
    let url: String
    let project: String
    let legacy: Bool?
}

private struct ListResponse: Decodable { let editors: [Editor] }
private struct EditorResponse: Decodable { let editor: Editor }
private struct RemoveResponse: Decodable { let removed: Bool }
private struct RestartResponse: Decodable { let restarted: Int; let errors: [String]; let editors: [Editor] }
private struct ErrorResponse: Decodable { let error: String; let url: String? }

private enum ManagerFailure: LocalizedError {
    case message(String)

    var errorDescription: String? {
        switch self { case .message(let text): return text }
    }
}

private final class ActionButton: NSButton {
    var handler: (() -> Void)?
    var showsLinkCursor = false

    convenience init(title: String, handler: @escaping () -> Void) {
        self.init(title: title, target: nil, action: nil)
        self.handler = handler
        target = self
        action = #selector(runHandler)
    }

    @objc private func runHandler() { handler?() }

    override func resetCursorRects() {
        super.resetCursorRects()
        if showsLinkCursor { addCursorRect(bounds, cursor: .pointingHand) }
    }
}

private final class EditorRowView: NSView {
    private let alternate: Bool
    private var hovered = false
    private var hoverTracking: NSTrackingArea?

    init(alternate: Bool) {
        self.alternate = alternate
        super.init(frame: .zero)
        wantsLayer = true
        layer?.cornerRadius = 6
        updateBackground()
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        if let hoverTracking { removeTrackingArea(hoverTracking) }
        let tracking = NSTrackingArea(rect: bounds, options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect], owner: self)
        addTrackingArea(tracking)
        hoverTracking = tracking
    }

    override func mouseEntered(with event: NSEvent) { hovered = true; updateBackground() }
    override func mouseExited(with event: NSEvent) { hovered = false; updateBackground() }
    override func viewDidChangeEffectiveAppearance() { super.viewDidChangeEffectiveAppearance(); updateBackground() }

    private func updateBackground() {
        let dark = effectiveAppearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
        let values: (CGFloat, CGFloat, CGFloat)
        if dark {
            values = hovered ? (0.24, 0.29, 0.35) : alternate ? (0.19, 0.21, 0.25) : (0.14, 0.16, 0.19)
        } else {
            values = hovered ? (0.88, 0.92, 0.96) : alternate ? (0.93, 0.95, 0.97) : (1, 1, 1)
        }
        layer?.backgroundColor = NSColor(srgbRed: values.0, green: values.1, blue: values.2, alpha: 1).cgColor
    }
}

private final class ManagerClient {
    private let configuration: AppConfiguration

    init(configuration: AppConfiguration) { self.configuration = configuration }

    func run<T: Decodable>(_ arguments: [String], as type: T.Type,
                           completion: @escaping (Result<T, Error>) -> Void) {
        let configuration = self.configuration
        DispatchQueue.global(qos: .userInitiated).async {
            let process = Process()
            let output = Pipe()
            let errors = Pipe()
            process.executableURL = URL(fileURLWithPath: configuration.python)
            process.arguments = [configuration.manager] + arguments
            process.standardOutput = output
            process.standardError = errors

            do {
                try process.run()
                let stdout = output.fileHandleForReading.readDataToEndOfFile()
                let stderr = errors.fileHandleForReading.readDataToEndOfFile()
                process.waitUntilExit()

                if process.terminationStatus == 0 {
                    let value = try JSONDecoder().decode(T.self, from: stdout)
                    DispatchQueue.main.async { completion(.success(value)) }
                    return
                }

                if let response = try? JSONDecoder().decode(ErrorResponse.self, from: stdout) {
                    var message = response.error
                    if let url = response.url, !url.isEmpty { message += "\n\n" + url }
                    throw ManagerFailure.message(message)
                }
                let text = String(data: stderr.isEmpty ? stdout : stderr, encoding: .utf8)?
                    .trimmingCharacters(in: .whitespacesAndNewlines)
                throw ManagerFailure.message(text?.isEmpty == false ? text! : "编辑器管理程序运行失败。")
            } catch {
                DispatchQueue.main.async { completion(.failure(error)) }
            }
        }
    }
}

private final class NameProjectAccessory: NSView {
    let nameField = NSTextField(string: "未命名")
    let projectField: NSTextField

    init(project: String, showsProject: Bool) {
        projectField = NSTextField(string: project)
        super.init(frame: NSRect(x: 0, y: 0, width: 390, height: showsProject ? 92 : 38))

        let prefix = NSTextField(labelWithString: "通用矢量图编辑器 ·")
        prefix.font = .systemFont(ofSize: 13)
        nameField.placeholderString = "未命名"
        nameField.maximumNumberOfLines = 1
        nameField.toolTip = "页面名称，最多 80 个字符"
        nameField.setAccessibilityLabel("页面名称")
        addSubview(prefix)
        addSubview(nameField)

        prefix.translatesAutoresizingMaskIntoConstraints = false
        nameField.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            prefix.leadingAnchor.constraint(equalTo: leadingAnchor),
            prefix.centerYAnchor.constraint(equalTo: nameField.centerYAnchor),
            nameField.leadingAnchor.constraint(equalTo: prefix.trailingAnchor, constant: 6),
            nameField.trailingAnchor.constraint(equalTo: trailingAnchor),
            nameField.topAnchor.constraint(equalTo: topAnchor)
        ])

        guard showsProject else { return }

        let projectLabel = NSTextField(labelWithString: "项目")
        projectField.lineBreakMode = .byTruncatingMiddle
        projectField.toolTip = "新页面保存到这个项目"
        projectField.setAccessibilityLabel("项目目录")
        let choose = ActionButton(title: "选择…") { [weak projectField] in
            let panel = NSOpenPanel()
            panel.title = "选择项目目录"
            panel.prompt = "选择"
            panel.canChooseDirectories = true
            panel.canChooseFiles = false
            panel.allowsMultipleSelection = false
            if panel.runModal() == .OK, let path = panel.url?.path { projectField?.stringValue = path }
        }
        choose.bezelStyle = .rounded
        choose.toolTip = "选择其他项目目录"
        choose.setAccessibilityLabel("选择项目目录")
        [projectLabel, projectField, choose].forEach {
            addSubview($0)
            $0.translatesAutoresizingMaskIntoConstraints = false
        }
        NSLayoutConstraint.activate([
            projectLabel.leadingAnchor.constraint(equalTo: leadingAnchor),
            projectLabel.centerYAnchor.constraint(equalTo: projectField.centerYAnchor),
            projectField.leadingAnchor.constraint(equalTo: projectLabel.trailingAnchor, constant: 8),
            projectField.topAnchor.constraint(equalTo: nameField.bottomAnchor, constant: 18),
            choose.leadingAnchor.constraint(equalTo: projectField.trailingAnchor, constant: 8),
            choose.trailingAnchor.constraint(equalTo: trailingAnchor),
            choose.centerYAnchor.constraint(equalTo: projectField.centerYAnchor),
            projectField.widthAnchor.constraint(greaterThanOrEqualToConstant: 235)
        ])
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
}

private final class EditorListViewController: NSViewController {
    private let client: ManagerClient
    private let defaultProject: String
    private let listStack = NSStackView()
    private let statusLabel = NSTextField(labelWithString: "正在读取…")
    private let scrollView = NSScrollView()
    private var editors: [Editor] = []
    private var loading = false
    private var restarting = false
    private var restartButton: NSButton?

    init(client: ManagerClient, defaultProject: String) {
        self.client = client
        self.defaultProject = defaultProject
        super.init(nibName: nil, bundle: nil)
        preferredContentSize = NSSize(width: 410, height: 430)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func loadView() {
        view = NSView(frame: NSRect(origin: .zero, size: preferredContentSize))

        let title = NSTextField(labelWithString: "通用矢量图编辑器")
        title.font = .systemFont(ofSize: 15, weight: .semibold)
        let reload = ActionButton(title: "刷新") { [weak self] in self?.reload() }
        reload.bezelStyle = .inline
        reload.image = NSImage(systemSymbolName: "arrow.clockwise", accessibilityDescription: "刷新")
        reload.imagePosition = .imageOnly
        reload.toolTip = "刷新编辑器列表"
        reload.setAccessibilityLabel("刷新编辑器列表")

        scrollView.hasVerticalScroller = true
        scrollView.autohidesScrollers = true
        scrollView.drawsBackground = false
        listStack.setFrameSize(NSSize(width: preferredContentSize.width - 16, height: 8))
        listStack.orientation = .vertical
        listStack.alignment = .leading
        listStack.spacing = 4
        listStack.edgeInsets = NSEdgeInsets(top: 4, left: 0, bottom: 4, right: 0)
        scrollView.documentView = listStack

        let create = ActionButton(title: "新建页面…") { [weak self] in self?.createEditor() }
        create.bezelStyle = .rounded
        create.image = NSImage(systemSymbolName: "plus", accessibilityDescription: nil)
        create.toolTip = "在项目中创建新页面"
        create.setAccessibilityLabel("新建页面")
        let restart = ActionButton(title: "重新启动") { [weak self] in self?.restartEditors() }
        restart.bezelStyle = .rounded
        restart.toolTip = "重启编辑服务，恢复意外停止的作品；保留原地址和画布"
        restart.setAccessibilityLabel("重新启动编辑服务")
        restartButton = restart
        let quit = ActionButton(title: "退出") { NSApp.terminate(nil) }
        quit.bezelStyle = .rounded
        quit.toolTip = "退出菜单栏应用，编辑服务会继续运行"
        quit.setAccessibilityLabel("退出菜单栏应用")

        statusLabel.textColor = .secondaryLabelColor
        statusLabel.font = .systemFont(ofSize: 11)
        statusLabel.lineBreakMode = .byTruncatingTail

        [title, reload, scrollView, statusLabel, create, restart, quit].forEach {
            view.addSubview($0)
            $0.translatesAutoresizingMaskIntoConstraints = false
        }
        NSLayoutConstraint.activate([
            title.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 14),
            title.topAnchor.constraint(equalTo: view.topAnchor, constant: 13),
            reload.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -12),
            reload.centerYAnchor.constraint(equalTo: title.centerYAnchor),
            reload.widthAnchor.constraint(equalToConstant: 28),
            reload.heightAnchor.constraint(equalToConstant: 28),
            scrollView.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 8),
            scrollView.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -8),
            scrollView.topAnchor.constraint(equalTo: title.bottomAnchor, constant: 10),
            scrollView.bottomAnchor.constraint(equalTo: statusLabel.topAnchor, constant: -7),
            statusLabel.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 14),
            statusLabel.trailingAnchor.constraint(lessThanOrEqualTo: create.leadingAnchor, constant: -8),
            statusLabel.centerYAnchor.constraint(equalTo: create.centerYAnchor),
            create.trailingAnchor.constraint(equalTo: restart.leadingAnchor, constant: -8),
            create.bottomAnchor.constraint(equalTo: view.bottomAnchor, constant: -12),
            restart.trailingAnchor.constraint(equalTo: quit.leadingAnchor, constant: -8),
            restart.centerYAnchor.constraint(equalTo: create.centerYAnchor),
            quit.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -12),
            quit.centerYAnchor.constraint(equalTo: create.centerYAnchor)
        ])
    }

    func reload(showNewest: Bool = false) {
        guard !loading && !restarting else { return }
        let scrollToTop = showNewest || editors.isEmpty
        loading = true
        statusLabel.stringValue = "正在读取…"
        client.run(["list"], as: ListResponse.self) { [weak self] result in
            guard let self else { return }
            self.loading = false
            switch result {
            case .success(let response):
                self.editors = response.editors
                self.renderEditors(showNewest: scrollToTop)
                self.statusLabel.stringValue = response.editors.isEmpty ? "当前没有编辑器" : "共 \(response.editors.count) 个编辑器"
            case .failure(let error):
                self.statusLabel.stringValue = "读取失败"
                self.showError(error)
            }
        }
    }

    private func restartEditors() {
        guard !loading && !restarting else { return }
        restarting = true
        restartButton?.isEnabled = false
        statusLabel.stringValue = "正在重启…"
        listStack.isHidden = true
        client.run(["restart"], as: RestartResponse.self) { [weak self] result in
            guard let self else { return }
            self.restarting = false
            self.restartButton?.isEnabled = true
            self.listStack.isHidden = false
            switch result {
            case .success(let response):
                self.editors = response.editors
                self.renderEditors(showNewest: false)
                self.statusLabel.stringValue = response.errors.isEmpty
                    ? (response.restarted == 0 ? "没有可重启服务" : "已重启 \(response.restarted) 个")
                    : "部分重启失败"
                if !response.errors.isEmpty {
                    self.showError(ManagerFailure.message(response.errors.joined(separator: "\n")))
                }
            case .failure(let error):
                self.statusLabel.stringValue = "重启失败"
                self.showError(error)
            }
        }
    }

    private func renderEditors(showNewest: Bool) {
        listStack.arrangedSubviews.forEach { view in
            listStack.removeArrangedSubview(view)
            view.removeFromSuperview()
        }
        // Size the document before constraining its rows. A newly opened
        // scroll view can still report zero width during its first layout.
        view.layoutSubtreeIfNeeded()
        let width = scrollView.contentSize.width > 0 ? scrollView.contentSize.width : preferredContentSize.width - 16
        let height = max(scrollView.contentSize.height, CGFloat(editors.count) * 82 + 8)
        listStack.setFrameSize(NSSize(width: width, height: height))
        if editors.isEmpty {
            let empty = NSTextField(labelWithString: "没有正在管理的编辑器")
            empty.alignment = .center
            empty.textColor = .secondaryLabelColor
            empty.font = .systemFont(ofSize: 13)
            listStack.addArrangedSubview(empty)
            empty.heightAnchor.constraint(equalToConstant: 90).isActive = true
        } else {
            for (index, editor) in editors.enumerated() {
                let row = makeRow(for: editor, alternate: index.isMultiple(of: 2) == false)
                listStack.addArrangedSubview(row)
                row.widthAnchor.constraint(equalTo: listStack.widthAnchor).isActive = true
            }
        }
        listStack.setFrameSize(NSSize(width: width, height: height))
        if showNewest {
            listStack.layoutSubtreeIfNeeded()
            let top = listStack.isFlipped ? 0 : max(0, listStack.bounds.height - scrollView.contentSize.height)
            scrollView.contentView.scroll(to: NSPoint(x: 0, y: top))
            scrollView.reflectScrolledClipView(scrollView.contentView)
        }
    }

    private func makeRow(for editor: Editor, alternate: Bool) -> NSView {
        let row = EditorRowView(alternate: alternate)

        let editionLabel = editor.edition == "test" ? "测试" : "正式"
        let openTitle = "\(editor.name) [\(editionLabel)]"
        let open = ActionButton(title: openTitle) { [weak self] in self?.open(editor) }
        open.bezelStyle = .regularSquare
        open.isBordered = false
        open.alignment = .left
        open.font = .systemFont(ofSize: 13, weight: .semibold)
        open.contentTintColor = .labelColor
        open.showsLinkCursor = true
        open.lineBreakMode = .byTruncatingTail
        open.toolTip = "打开\(editionLabel)页面 · \(editor.name)\n\(editor.url)"
        open.setAccessibilityLabel("打开\(editionLabel)页面 · \(editor.name)")

        let folderName = URL(fileURLWithPath: editor.project).lastPathComponent
        let project = NSTextField(labelWithString: folderName.isEmpty ? editor.project : folderName)
        project.textColor = .secondaryLabelColor
        project.alignment = .left
        project.font = .systemFont(ofSize: 11)
        project.lineBreakMode = .byTruncatingMiddle
        project.toolTip = editor.project

        let stableDrawingId = editor.drawingId?.trimmingCharacters(in: .whitespacesAndNewlines)
        let hasStableDrawingId = stableDrawingId?.isEmpty == false
        let displayedId = hasStableDrawingId ? stableDrawingId! : String(editor.id.prefix(12))
        let idCaption = hasStableDrawingId ? "图纸 ID：" : "登记 ID 前缀："
        let drawingId = NSTextField(labelWithString: idCaption + displayedId)
        drawingId.textColor = .secondaryLabelColor
        drawingId.alignment = .left
        drawingId.font = .monospacedSystemFont(ofSize: 10.5, weight: .regular)
        drawingId.lineBreakMode = .byTruncatingTail
        drawingId.isSelectable = true
        drawingId.toolTip = hasStableDrawingId
            ? "稳定图纸 ID；页面改名后保持不变，可选中复制"
            : "后端暂未提供稳定图纸 ID；这里显示当前登记 ID 的前 12 位"
        drawingId.setAccessibilityLabel(idCaption + displayedId)

        let copyId = iconButton(symbol: "doc.on.doc", label: "复制\(idCaption)\(displayedId)") {
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(displayedId, forType: .string)
        }
        let openIcon = iconButton(symbol: "arrow.up.forward.square", label: "打开 \(editor.name)") { [weak self] in self?.open(editor) }
        let rename = iconButton(symbol: "pencil", label: "重命名 \(editor.name)") { [weak self] in self?.rename(editor) }
        let remove = iconButton(symbol: "trash", label: "关闭并移除 \(editor.name)") { [weak self] in self?.remove(editor) }
        [open, project, drawingId, copyId, openIcon, rename, remove].forEach {
            row.addSubview($0)
            $0.translatesAutoresizingMaskIntoConstraints = false
        }
        NSLayoutConstraint.activate([
            row.heightAnchor.constraint(equalToConstant: 78),
            open.leadingAnchor.constraint(equalTo: row.leadingAnchor, constant: 12),
            open.trailingAnchor.constraint(equalTo: openIcon.leadingAnchor, constant: -6),
            open.topAnchor.constraint(equalTo: row.topAnchor, constant: 7),
            project.leadingAnchor.constraint(equalTo: open.leadingAnchor),
            project.trailingAnchor.constraint(equalTo: open.trailingAnchor),
            project.topAnchor.constraint(equalTo: open.bottomAnchor, constant: 1),
            drawingId.leadingAnchor.constraint(equalTo: project.leadingAnchor),
            drawingId.trailingAnchor.constraint(equalTo: copyId.leadingAnchor, constant: -3),
            drawingId.topAnchor.constraint(equalTo: project.bottomAnchor, constant: 1),
            copyId.trailingAnchor.constraint(equalTo: open.trailingAnchor),
            copyId.centerYAnchor.constraint(equalTo: drawingId.centerYAnchor),
            copyId.widthAnchor.constraint(equalToConstant: 24),
            copyId.heightAnchor.constraint(equalToConstant: 22),
            openIcon.trailingAnchor.constraint(equalTo: rename.leadingAnchor, constant: -2),
            openIcon.centerYAnchor.constraint(equalTo: row.centerYAnchor),
            openIcon.widthAnchor.constraint(equalToConstant: 26),
            openIcon.heightAnchor.constraint(equalToConstant: 28),
            rename.trailingAnchor.constraint(equalTo: remove.leadingAnchor, constant: -4),
            rename.centerYAnchor.constraint(equalTo: row.centerYAnchor),
            rename.widthAnchor.constraint(equalToConstant: 28),
            rename.heightAnchor.constraint(equalToConstant: 28),
            remove.trailingAnchor.constraint(equalTo: row.trailingAnchor, constant: -6),
            remove.centerYAnchor.constraint(equalTo: row.centerYAnchor),
            remove.widthAnchor.constraint(equalToConstant: 28),
            remove.heightAnchor.constraint(equalToConstant: 28)
        ])
        return row
    }

    private func iconButton(symbol: String, label: String, handler: @escaping () -> Void) -> NSButton {
        let button = ActionButton(title: "", handler: handler)
        button.bezelStyle = .inline
        button.image = NSImage(systemSymbolName: symbol, accessibilityDescription: label)
        button.imagePosition = .imageOnly
        button.toolTip = label
        button.setAccessibilityLabel(label)
        return button
    }

    private func open(_ editor: Editor) {
        guard let url = URL(string: editor.url) else {
            showError(ManagerFailure.message("编辑器地址无效。")); return
        }
        do { _ = try BrowserTabOpener().open(url) }
        catch { showError(error) }
    }

    private func createEditor() {
        guard !restarting else { return }
        guard let values = runNameDialog(title: "新建页面", action: "创建", name: "未命名", project: defaultProject) else { return }
        statusLabel.stringValue = "正在创建…"
        client.run(["create", "--project", values.project, "--name", values.name], as: EditorResponse.self) { [weak self] result in
            switch result {
            case .success(let response):
                self?.open(response.editor)
                self?.reload()
            case .failure(let error): self?.showError(error)
            }
        }
    }

    private func rename(_ editor: Editor) {
        guard let values = runNameDialog(title: "重命名页面", action: "重命名", name: editor.name, project: nil) else { return }
        client.run(["rename", "--id", editor.id, "--name", values.name], as: EditorResponse.self) { [weak self] result in
            switch result {
            case .success: self?.reload()
            case .failure(let error): self?.showError(error)
            }
        }
    }

    private func remove(_ editor: Editor) {
        let alert = NSAlert()
        alert.messageText = editor.legacy == true ? "隐藏这个旧版编辑器？" : "关闭并移除这个编辑器？"
        alert.informativeText = editor.legacy == true
            ? "旧版编辑器可能只能从列表中隐藏。已保存文件会保留。"
            : "“\(editor.name)”的已保存文件会保留。若仍有未保存内容，编辑器会拒绝关闭。"
        alert.alertStyle = .warning
        alert.addButton(withTitle: editor.legacy == true ? "隐藏" : "关闭并移除")
        alert.addButton(withTitle: "取消")
        NSApp.activate(ignoringOtherApps: true)
        guard alert.runModal() == .alertFirstButtonReturn else { return }
        client.run(["remove", "--id", editor.id], as: RemoveResponse.self) { [weak self] result in
            switch result {
            case .success(let response):
                if response.removed { self?.reload() }
                else { self?.showError(ManagerFailure.message("编辑器未被移除。")) }
            case .failure(let error): self?.showError(error)
            }
        }
    }

    private func runNameDialog(title: String, action: String, name: String, project: String?) -> (name: String, project: String)? {
        let alert = NSAlert()
        alert.messageText = title
        alert.informativeText = "名称最多 80 个字符。"
        let accessory = NameProjectAccessory(project: project ?? "", showsProject: project != nil)
        accessory.nameField.stringValue = name
        alert.accessoryView = accessory
        alert.addButton(withTitle: action)
        alert.addButton(withTitle: "取消")
        NSApp.activate(ignoringOtherApps: true)
        while alert.runModal() == .alertFirstButtonReturn {
            let value = accessory.nameField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
            let selectedProject = accessory.projectField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
            if value.isEmpty || value.count > 80 {
                showError(ManagerFailure.message("请输入 1–80 个字符的页面名称。")); continue
            }
            if project != nil && selectedProject.isEmpty {
                showError(ManagerFailure.message("请选择项目目录。")); continue
            }
            return (value, selectedProject)
        }
        return nil
    }

    private func showError(_ error: Error) {
        let alert = NSAlert(error: error)
        alert.messageText = "操作失败"
        alert.informativeText = error.localizedDescription
        NSApp.activate(ignoringOtherApps: true)
        alert.runModal()
    }
}

private final class AppDelegate: NSObject, NSApplicationDelegate, NSPopoverDelegate {
    private var statusItem: NSStatusItem!
    private let popover = NSPopover()
    private var listController: EditorListViewController?
    private var timer: Timer?

    func applicationDidFinishLaunching(_ notification: Notification) {
        do {
            let configuration = try loadConfiguration()
            let controller = EditorListViewController(client: ManagerClient(configuration: configuration), defaultProject: configuration.project)
            listController = controller
            popover.contentViewController = controller
            popover.behavior = .transient
            popover.delegate = self

            statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
            if let button = statusItem.button {
                button.image = makeStatusImage()
                button.image?.isTemplate = true
                button.toolTip = "通用矢量图编辑器"
                button.setAccessibilityLabel("通用矢量图编辑器")
                button.target = self
                button.action = #selector(togglePopover)
            }
            timer = Timer.scheduledTimer(withTimeInterval: 8, repeats: true) { [weak self] _ in
                if self?.popover.isShown == true { self?.listController?.reload() }
            }
        } catch {
            let alert = NSAlert(error: error)
            alert.messageText = "无法启动菜单栏应用"
            alert.informativeText = error.localizedDescription
            alert.runModal()
            NSApp.terminate(nil)
        }
    }

    @objc private func togglePopover() {
        guard let button = statusItem.button else { return }
        if popover.isShown { popover.performClose(nil) }
        else {
            listController?.reload(showNewest: true)
            popover.show(relativeTo: button.bounds, of: button, preferredEdge: .minY)
            NSApp.activate(ignoringOtherApps: true)
        }
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !popover.isShown { togglePopover() }
        return true
    }

    private func loadConfiguration() throws -> AppConfiguration {
        guard let url = Bundle.main.url(forResource: "config", withExtension: "json") else {
            throw ManagerFailure.message("应用资源中缺少 config.json。")
        }
        return try JSONDecoder().decode(AppConfiguration.self, from: Data(contentsOf: url))
    }

    private func makeStatusImage() -> NSImage {
        let image = NSImage(size: NSSize(width: 19, height: 19), flipped: false) { rect in
            NSColor.labelColor.setStroke()
            let frame = NSBezierPath(roundedRect: NSRect(x: 1.5, y: 3, width: 13, height: 12), xRadius: 1.5, yRadius: 1.5)
            frame.lineWidth = 1.5
            frame.stroke()

            let picture = NSBezierPath()
            picture.move(to: NSPoint(x: 3, y: 5))
            picture.line(to: NSPoint(x: 6.4, y: 9))
            picture.line(to: NSPoint(x: 8.7, y: 7))
            picture.line(to: NSPoint(x: 12.8, y: 11.4))
            picture.lineWidth = 1.25
            picture.stroke()

            let pencil = NSBezierPath()
            pencil.move(to: NSPoint(x: 10.2, y: 3.2))
            pencil.line(to: NSPoint(x: 16.5, y: 9.5))
            pencil.move(to: NSPoint(x: 11.1, y: 2.4))
            pencil.line(to: NSPoint(x: 17.3, y: 8.6))
            pencil.lineWidth = 1.7
            pencil.stroke()
            return true
        }
        image.isTemplate = true
        return image
    }
}

@main
private enum CurveEditorMenuApplication {
    static func main() {
        let application = NSApplication.shared
        let appDelegate = AppDelegate()
        application.delegate = appDelegate
        application.setActivationPolicy(.accessory)
        withExtendedLifetime(appDelegate) { application.run() }
    }
}
