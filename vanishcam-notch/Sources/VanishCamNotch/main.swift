import AppKit

// VanishCam lives in the notch: no Dock icon, no menu bar item (LSUIElement).
// --snapshot <dir> renders the notch states to PNG files (layout check, no camera).
@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    private var controller: NotchController?

    func applicationDidFinishLaunching(_ notification: Notification) {
        let args = CommandLine.arguments
        if let index = args.firstIndex(of: "--snapshot"), index + 1 < args.count {
            Snapshot.render(to: URL(fileURLWithPath: args[index + 1]))
            NSApp.terminate(nil)
            return
        }
        let controller = NotchController()
        controller.start()
        self.controller = controller
    }

    func applicationWillTerminate(_ notification: Notification) {
        controller?.stopEngine()
    }
}

MainActor.assumeIsolated {
    let app = NSApplication.shared
    let delegate = AppDelegate()
    app.delegate = delegate
    app.setActivationPolicy(.accessory)
    app.run()
}
