import Cocoa
import UniformTypeIdentifiers
import WebKit

private let backgroundColor = NSColor(
    calibratedRed: 0.024,
    green: 0.031,
    blue: 0.024,
    alpha: 1
)

final class DropWebView: WKWebView {
    var onFileDrop: ((URL) -> Void)?

    override init(frame: NSRect, configuration: WKWebViewConfiguration) {
        super.init(frame: frame, configuration: configuration)
        registerForDraggedTypes([.fileURL])
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) is not supported")
    }

    override func draggingEntered(_ sender: any NSDraggingInfo) -> NSDragOperation {
        draggedFile(from: sender) == nil ? [] : .copy
    }

    override func draggingUpdated(_ sender: any NSDraggingInfo) -> NSDragOperation {
        draggedFile(from: sender) == nil ? [] : .copy
    }

    override func prepareForDragOperation(_ sender: any NSDraggingInfo) -> Bool {
        draggedFile(from: sender) != nil
    }

    override func performDragOperation(_ sender: any NSDraggingInfo) -> Bool {
        guard let url = draggedFile(from: sender) else { return false }
        onFileDrop?(url)
        return true
    }

    private func draggedFile(from info: any NSDraggingInfo) -> URL? {
        let options: [NSPasteboard.ReadingOptionKey: Any] = [
            .urlReadingFileURLsOnly: true
        ]
        return (info.draggingPasteboard.readObjects(
            forClasses: [NSURL.self],
            options: options
        ) as? [URL])?.first
    }
}

final class MitosisWindowController: NSWindowController, WKNavigationDelegate, WKUIDelegate {
    private let webView: DropWebView
    private var isReady = false
    private var pendingFile: URL?

    init() {
        let configuration = WKWebViewConfiguration()
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
        configuration.websiteDataStore = .default()
        webView = DropWebView(frame: .zero, configuration: configuration)

        let visible = NSScreen.main?.visibleFrame ?? NSRect(
            x: 0,
            y: 0,
            width: 1440,
            height: 960
        )
        let width = min(1440, max(900, visible.width * 0.92))
        let height = min(960, max(650, visible.height * 0.92))
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: width, height: height),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "MITOSIS"
        window.minSize = NSSize(width: 760, height: 620)
        window.backgroundColor = backgroundColor
        window.appearance = NSAppearance(named: .darkAqua)
        window.center()
        window.setFrameAutosaveName("MITOSISMainWindow")

        super.init(window: window)

        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = false
        webView.underPageBackgroundColor = backgroundColor
        webView.onFileDrop = { [weak self] url in
            self?.acceptFile(at: url)
        }
        window.contentView = webView

        guard
            let indexURL = Bundle.main.url(
                forResource: "index",
                withExtension: "html",
                subdirectory: "web"
            )
        else {
            presentFatalError("The bundled interface is missing from MITOSIS.app.")
            return
        }
        webView.loadFileURL(
            indexURL,
            allowingReadAccessTo: indexURL.deletingLastPathComponent()
        )
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) is not supported")
    }

    private func presentFatalError(_ message: String) {
        let alert = NSAlert()
        alert.messageText = "MITOSIS could not start"
        alert.informativeText = message
        alert.alertStyle = .critical
        alert.runModal()
        NSApp.terminate(nil)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        isReady = true
        if let file = pendingFile {
            pendingFile = nil
            acceptFile(at: file)
        }
    }

    func acceptFile(at url: URL) {
        guard isReady else {
            pendingFile = url
            return
        }
        guard url.isFileURL else { return }

        do {
            let values = try url.resourceValues(forKeys: [.fileSizeKey])
            if let size = values.fileSize, size > 32 * 1024 * 1024 {
                showWarning(
                    "Specimen too large",
                    "The desktop app accepts files up to 32 MB. The browser build has the same analysis limits."
                )
                return
            }

            let data = try Data(contentsOf: url)
            let mime = UTType(filenameExtension: url.pathExtension)?.preferredMIMEType
                ?? "application/octet-stream"
            let name = jsLiteral(url.lastPathComponent)
            let type = jsLiteral(mime)
            let base64 = data.base64EncodedString()
            let script = """
            (() => {
              try {
                const binary = atob("\(base64)");
                const bytes = new Uint8Array(binary.length);
                for (let index = 0; index < binary.length; index++) {
                  bytes[index] = binary.charCodeAt(index);
                }
                const file = new File([bytes], \(name), { type: \(type) });
                const transfer = new DataTransfer();
                transfer.items.add(file);
                window.dispatchEvent(new DragEvent("drop", {
                  bubbles: true,
                  cancelable: true,
                  dataTransfer: transfer
                }));
                return true;
              } catch (error) {
                return String(error);
              }
            })()
            """

            webView.evaluateJavaScript(script) { [weak self] _, error in
                if let error {
                    self?.showWarning(
                        "Could not hand over the specimen",
                        error.localizedDescription
                    )
                }
            }
        } catch {
            showWarning("Could not read the specimen", error.localizedDescription)
        }
    }

    private func jsLiteral(_ value: String) -> String {
        guard
            let data = try? JSONSerialization.data(withJSONObject: [value]),
            let encoded = String(data: data, encoding: .utf8)
        else {
            return "\"\""
        }
        return String(encoded.dropFirst().dropLast())
    }

    private func showWarning(_ title: String, _ message: String) {
        let alert = NSAlert()
        alert.messageText = title
        alert.informativeText = message
        alert.alertStyle = .warning
        alert.runModal()
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        if
            navigationAction.navigationType == .linkActivated,
            let url = navigationAction.request.url,
            url.scheme == "http" || url.scheme == "https"
        {
            NSWorkspace.shared.open(url)
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }

    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        if let url = navigationAction.request.url {
            NSWorkspace.shared.open(url)
        }
        return nil
    }

    func webView(
        _ webView: WKWebView,
        runOpenPanelWith parameters: WKOpenPanelParameters,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping ([URL]?) -> Void
    ) {
        guard let window = webView.window else {
            completionHandler(nil)
            return
        }
        let panel = makeOpenPanel()
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.beginSheetModal(for: window) { response in
            completionHandler(response == .OK ? panel.urls : nil)
        }
    }

    @objc func openSpecimen() {
        guard let window else { return }
        let panel = makeOpenPanel()
        panel.beginSheetModal(for: window) { [weak self] response in
            guard response == .OK, let url = panel.url else { return }
            self?.acceptFile(at: url)
        }
    }

    private func makeOpenPanel() -> NSOpenPanel {
        let panel = NSOpenPanel()
        panel.title = "Open Specimen"
        panel.message = "Choose an image, text or code file, or binary to clone."
        panel.prompt = "Dissect"
        panel.canChooseFiles = true
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = false
        return panel
    }

    func webView(
        _ webView: WKWebView,
        didFail navigation: WKNavigation!,
        withError error: Error
    ) {
        presentFatalError(error.localizedDescription)
    }

    func webView(
        _ webView: WKWebView,
        didFailProvisionalNavigation navigation: WKNavigation!,
        withError error: Error
    ) {
        presentFatalError(error.localizedDescription)
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var controller: MitosisWindowController?

    func applicationDidFinishLaunching(_ notification: Notification) {
        let controller = MitosisWindowController()
        self.controller = controller
        installMenu(controller: controller)
        controller.showWindow(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    func application(_ sender: NSApplication, openFiles filenames: [String]) {
        guard
            let path = filenames.first,
            let controller
        else {
            sender.reply(toOpenOrPrint: .failure)
            return
        }
        controller.acceptFile(at: URL(fileURLWithPath: path))
        sender.reply(toOpenOrPrint: .success)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }

    func applicationSupportsSecureRestorableState(_ app: NSApplication) -> Bool {
        true
    }

    private func installMenu(controller: MitosisWindowController) {
        let mainMenu = NSMenu()

        let appItem = NSMenuItem()
        let appMenu = NSMenu(title: "MITOSIS")
        appMenu.addItem(
            withTitle: "About MITOSIS",
            action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)),
            keyEquivalent: ""
        )
        appMenu.addItem(.separator())
        appMenu.addItem(
            withTitle: "Hide MITOSIS",
            action: #selector(NSApplication.hide(_:)),
            keyEquivalent: "h"
        )
        let hideOthers = appMenu.addItem(
            withTitle: "Hide Others",
            action: #selector(NSApplication.hideOtherApplications(_:)),
            keyEquivalent: "h"
        )
        hideOthers.keyEquivalentModifierMask = [.command, .option]
        appMenu.addItem(
            withTitle: "Show All",
            action: #selector(NSApplication.unhideAllApplications(_:)),
            keyEquivalent: ""
        )
        appMenu.addItem(.separator())
        appMenu.addItem(
            withTitle: "Quit MITOSIS",
            action: #selector(NSApplication.terminate(_:)),
            keyEquivalent: "q"
        )
        appItem.submenu = appMenu
        mainMenu.addItem(appItem)

        let fileItem = NSMenuItem()
        let fileMenu = NSMenu(title: "File")
        let openItem = fileMenu.addItem(
            withTitle: "Open Specimen…",
            action: #selector(MitosisWindowController.openSpecimen),
            keyEquivalent: "o"
        )
        openItem.target = controller
        fileMenu.addItem(.separator())
        fileMenu.addItem(
            withTitle: "Close Window",
            action: #selector(NSWindow.performClose(_:)),
            keyEquivalent: "w"
        )
        fileItem.submenu = fileMenu
        mainMenu.addItem(fileItem)

        let editItem = NSMenuItem()
        let editMenu = NSMenu(title: "Edit")
        editMenu.addItem(
            withTitle: "Undo",
            action: Selector(("undo:")),
            keyEquivalent: "z"
        )
        editMenu.addItem(
            withTitle: "Redo",
            action: Selector(("redo:")),
            keyEquivalent: "Z"
        )
        editMenu.addItem(.separator())
        editMenu.addItem(
            withTitle: "Cut",
            action: #selector(NSText.cut(_:)),
            keyEquivalent: "x"
        )
        editMenu.addItem(
            withTitle: "Copy",
            action: #selector(NSText.copy(_:)),
            keyEquivalent: "c"
        )
        editMenu.addItem(
            withTitle: "Paste",
            action: #selector(NSText.paste(_:)),
            keyEquivalent: "v"
        )
        editMenu.addItem(
            withTitle: "Select All",
            action: #selector(NSText.selectAll(_:)),
            keyEquivalent: "a"
        )
        editItem.submenu = editMenu
        mainMenu.addItem(editItem)

        let windowItem = NSMenuItem()
        let windowMenu = NSMenu(title: "Window")
        windowMenu.addItem(
            withTitle: "Minimize",
            action: #selector(NSWindow.miniaturize(_:)),
            keyEquivalent: "m"
        )
        windowMenu.addItem(
            withTitle: "Zoom",
            action: #selector(NSWindow.zoom(_:)),
            keyEquivalent: ""
        )
        windowMenu.addItem(.separator())
        windowMenu.addItem(
            withTitle: "Bring All to Front",
            action: #selector(NSApplication.arrangeInFront(_:)),
            keyEquivalent: ""
        )
        windowItem.submenu = windowMenu
        mainMenu.addItem(windowItem)

        NSApp.windowsMenu = windowMenu
        NSApp.mainMenu = mainMenu
    }
}

let application = NSApplication.shared
let delegate = AppDelegate()
application.delegate = delegate
application.setActivationPolicy(.regular)
application.run()
