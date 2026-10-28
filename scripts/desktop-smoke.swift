import Cocoa
import Darwin
import WebKit

guard CommandLine.arguments.count > 1 else {
    fputs("usage: desktop-smoke <path-to-index.html>\n", stderr)
    exit(2)
}

let indexURL = URL(fileURLWithPath: CommandLine.arguments[1]).standardizedFileURL

final class Probe: NSObject, WKNavigationDelegate {
    let webView: WKWebView
    private var window: NSWindow?

    override init() {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.userContentController.addUserScript(
            WKUserScript(
                source: """
                window.__smokeErrors = [];
                window.addEventListener('error', (event) => {
                  window.__smokeErrors.push(String(event.message || event.error));
                });
                window.addEventListener('unhandledrejection', (event) => {
                  window.__smokeErrors.push('rejection: ' + String(event.reason));
                });
                """,
                injectionTime: .atDocumentStart,
                forMainFrameOnly: true
            )
        )
        webView = WKWebView(
            frame: NSRect(x: 0, y: 0, width: 1280, height: 900),
            configuration: configuration
        )
        super.init()
        webView.navigationDelegate = self
        let window = NSWindow(
            contentRect: NSRect(x: -5000, y: -5000, width: 1280, height: 900),
            styleMask: [.borderless],
            backing: .buffered,
            defer: false
        )
        window.contentView = webView
        window.orderFront(nil)
        self.window = window
    }

    func start() {
        webView.loadFileURL(
            indexURL,
            allowingReadAccessTo: indexURL.deletingLastPathComponent()
        )
        DispatchQueue.main.asyncAfter(deadline: .now() + 20) {
            print("SMOKE_TIMEOUT")
            fflush(stdout)
            exit(2)
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) {
            self.probe(webView)
        }
    }

    private func probe(_ webView: WKWebView) {
        let script = #"""
        (() => {
          const result = {
            title: document.title,
            readyState: document.readyState,
            scripts: document.scripts.length,
            rootChildren: document.getElementById('root')?.childElementCount ?? -1,
            rootText: (document.getElementById('root')?.textContent ?? '').slice(0, 90),
            brand: document.querySelector('.brand-text h1')?.textContent ?? null,
            dropPlate: Boolean(document.querySelector('.drop-plate')),
            stylesheets: document.styleSheets.length,
            background: getComputedStyle(document.body).backgroundColor,
            cryptoSubtle: Boolean(window.crypto && window.crypto.subtle),
            errors: window.__smokeErrors || []
          };
          try {
            const previous = localStorage.getItem('mitosis.smoke');
            localStorage.setItem('mitosis.smoke', 'ok');
            result.storage = { available: true, previous: previous, written: 'ok' };
          } catch (error) {
            result.storage = { available: false, error: String(error) };
          }
          return JSON.stringify(result);
        })()
        """#
        webView.evaluateJavaScript(script) { value, error in
            if let error {
                print("SMOKE_JS_ERROR \(error.localizedDescription)")
                fflush(stdout)
                exit(1)
            }
            print(value as? String ?? "SMOKE_NULL")
            fflush(stdout)
            exit(0)
        }
    }

    func webView(
        _ webView: WKWebView,
        didFail navigation: WKNavigation!,
        withError error: Error
    ) {
        print("SMOKE_LOAD_ERROR \(error.localizedDescription)")
        fflush(stdout)
        exit(1)
    }

    func webView(
        _ webView: WKWebView,
        didFailProvisionalNavigation navigation: WKNavigation!,
        withError error: Error
    ) {
        print("SMOKE_LOAD_ERROR \(error.localizedDescription)")
        fflush(stdout)
        exit(1)
    }
}

let application = NSApplication.shared
application.setActivationPolicy(.accessory)
let probe = Probe()
probe.start()
application.run()
