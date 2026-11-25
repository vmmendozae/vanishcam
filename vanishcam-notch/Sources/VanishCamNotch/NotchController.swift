import AppKit
import ServiceManagement
import SwiftUI

/// Owns the notch panel: hover to open, leave to close, and routes the
/// panel's buttons to the engine.
@MainActor
final class NotchController {
    let model = NotchModel()
    private lazy var engine = Engine(model: model)
    private let panel = NotchPanel()
    private var geometry = NotchGeometry.current()
    private var timer: Timer?
    private var collapseWork: DispatchWorkItem?

    func start() {
        let root = NotchRootView(model: model, actions: NotchActions(controller: self))
        panel.contentView = FirstMouseHostingView(rootView: root)
        layout(animated: false)
        panel.orderFrontRegardless()
        timer = Timer.scheduledTimer(withTimeInterval: 0.08, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.tick() }
        }
        NotificationCenter.default.addObserver(
            forName: NSApplication.didChangeScreenParametersNotification, object: nil, queue: .main
        ) { [weak self] _ in
            Task { @MainActor in
                guard let self else { return }
                self.geometry = NotchGeometry.current()
                self.layout(animated: false)
            }
        }
    }

    // MARK: hover

    private var collapsedSize: NSSize {
        let wings = model.isRunning ? NotchLayout.wing * 2 : 0
        return NSSize(width: geometry.width + wings, height: geometry.height)
    }

    private var expandedSize: NSSize {
        NSSize(width: NotchLayout.expandedWidth, height: geometry.height + NotchLayout.expandedHeight)
    }

    private func tick() {
        let mouse = NSEvent.mouseLocation
        if model.isExpanded {
            let area = geometry.rect(width: expandedSize.width, height: expandedSize.height).insetBy(dx: -24, dy: -24)
            if !area.contains(mouse) { setExpanded(false) }
        } else {
            let pill = geometry.rect(width: collapsedSize.width, height: geometry.height)
            let area = pill.insetBy(dx: -14, dy: -6).offsetBy(dx: 0, dy: 3)
            if area.contains(mouse) { setExpanded(true) }
            else if panel.frame.size != collapsedSize, collapseWork == nil { layout(animated: false) }
        }
    }

    func setExpanded(_ expanded: Bool) {
        guard expanded != model.isExpanded else { return }
        collapseWork?.cancel()
        collapseWork = nil
        if expanded {
            model.refreshCameras()
            model.obs = OBSStatus.check()
            panel.setFrame(geometry.rect(width: expandedSize.width, height: expandedSize.height), display: true)
            withAnimation(.spring(response: 0.32, dampingFraction: 0.82)) { model.isExpanded = true }
        } else {
            withAnimation(.spring(response: 0.28, dampingFraction: 0.9)) { model.isExpanded = false }
            // Shrink the window after the animation so the menu bar is clickable again.
            let work = DispatchWorkItem { [weak self] in
                guard let self, !self.model.isExpanded else { return }
                self.collapseWork = nil
                self.layout(animated: false)
            }
            collapseWork = work
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.32, execute: work)
        }
        engine.send(["cmd": "preview", "value": expanded])
    }

    private func layout(animated: Bool) {
        let size = model.isExpanded ? expandedSize : collapsedSize
        panel.setFrame(geometry.rect(width: size.width, height: size.height), display: true, animate: animated)
    }

    // MARK: actions from the panel

    func startEngine() { engine.start(); layout(animated: false) }
    func stopEngine() { engine.stop() }
    func send(_ command: String, _ value: Any? = nil) {
        var message: [String: Any] = ["cmd": command]
        if let value { message["value"] = value }
        engine.send(message)
    }

    func quit() {
        engine.stop()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { NSApp.terminate(nil) }
    }

    var opensAtLogin: Bool { SMAppService.mainApp.status == .enabled }

    func setOpensAtLogin(_ enabled: Bool) {
        do {
            if enabled { try SMAppService.mainApp.register() } else { try SMAppService.mainApp.unregister() }
        } catch {
            model.lastError = "No pude cambiar el inicio automático: \(error.localizedDescription)"
        }
        model.objectWillChange.send()
    }
}

/// What the SwiftUI view is allowed to do.
@MainActor
struct NotchActions {
    let controller: NotchController
    var model: NotchModel { controller.model }

    func start() { controller.startEngine() }
    func stop() { controller.stopEngine() }
    func quit() { controller.quit() }

    func setMode(_ mode: String) {
        model.mode = mode
        if model.isRunning { controller.send("mode", mode) }
    }

    func changeGokuDelay(by step: Double) {
        let halfSteps = ((model.gokuDelay + step) * 2).rounded() / 2
        let value = min(3.0, max(0.5, halfSteps))
        model.gokuDelay = value
        if model.isRunning { controller.send("goku_delay", value) }
    }

    func setAutoV(_ value: String) {
        model.autoV = value
        if model.isRunning { controller.send("auto_v", value) }
    }

    func command(_ name: String) { controller.send(name) }
    func fixOBS() { OBSStatus.fix(model.obs) }
    var opensAtLogin: Bool { controller.opensAtLogin }
    func setOpensAtLogin(_ on: Bool) { controller.setOpensAtLogin(on) }
}
