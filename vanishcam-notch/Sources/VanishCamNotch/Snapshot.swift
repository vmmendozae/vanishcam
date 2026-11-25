import AppKit
import SwiftUI

/// Renders the notch in several states to PNG files, to check the layout
/// without a camera or screen-recording permission.
@MainActor
enum Snapshot {
    static func render(to folder: URL) {
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let controller = NotchController()
        let model = controller.model
        let actions = NotchActions(controller: controller)
        let sample = sampleImage()

        let states: [(String, () -> Void)] = [
            ("1-cerrado-apagado", { model.engineState = .stopped; model.phase = "stopped"; model.isExpanded = false }),
            ("2-abierto-apagado", { model.isExpanded = true }),
            ("3-cerrado-listo", {
                model.engineState = .running; model.phase = "ready"; model.color = "green"
                model.isExpanded = false; model.mode = "auto"; model.preview = sample
            }),
            ("4-abierto-fondo-cuenta", {
                model.isExpanded = true; model.phase = "bg_leave"; model.count = 2; model.color = "amber"
                model.title = "Sal del encuadre: 2"; model.detail = "Escucha los pitidos"
            }),
            ("5-abierto-revision", {
                model.phase = "bg_review"; model.color = "green"; model.backgroundPreview = sample
                model.title = "Revisa el fondo"; model.detail = "Fondo limpio, ya puedes volver"
            }),
            ("6-abierto-listo", { model.phase = "ready"; model.color = "green"; model.virtualOK = true }),
            ("7-abierto-goku", { model.phase = "ready"; model.gokuLeft = 0.4; model.color = "amber" }),
            ("8-cerrado-oculto", { model.gokuLeft = nil; model.phase = "vanished"; model.color = "blue"; model.effect = "goku"; model.isExpanded = false }),
        ]
        for (name, apply) in states {
            apply()
            let view = NotchRootView(model: model, actions: actions)
                .frame(width: NotchLayout.expandedWidth + 40, height: 360)
                .background(Color(white: 0.82))
            let renderer = ImageRenderer(content: view)
            renderer.scale = 2
            if let image = renderer.nsImage, let tiff = image.tiffRepresentation,
               let png = NSBitmapImageRep(data: tiff)?.representation(using: .png, properties: [:]) {
                try? png.write(to: folder.appendingPathComponent("\(name).png"))
            }
        }
    }

    private static func sampleImage() -> NSImage {
        let image = NSImage(size: NSSize(width: 320, height: 180))
        image.lockFocus()
        NSColor(calibratedRed: 0.73, green: 0.67, blue: 0.58, alpha: 1).setFill()
        NSRect(x: 0, y: 0, width: 320, height: 180).fill()
        NSColor(calibratedRed: 0.55, green: 0.43, blue: 0.35, alpha: 1).setFill()
        NSRect(x: 0, y: 0, width: 320, height: 70).fill()
        NSColor(calibratedRed: 0.24, green: 0.35, blue: 0.24, alpha: 1).setFill()
        NSRect(x: 210, y: 95, width: 65, height: 55).fill()
        image.unlockFocus()
        return image
    }
}
