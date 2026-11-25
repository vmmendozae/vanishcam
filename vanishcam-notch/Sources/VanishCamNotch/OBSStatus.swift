import AppKit
import Foundation

/// Whether the OBS virtual camera (what Meet/Zoom select) is usable.
enum OBSStatus {
    enum State { case ready, approval, missing, noOBS }

    static func check() -> State {
        guard FileManager.default.fileExists(atPath: "/Applications/OBS.app") else { return .noOBS }
        let task = Process()
        task.executableURL = URL(fileURLWithPath: "/usr/bin/systemextensionsctl")
        task.arguments = ["list"]
        let pipe = Pipe()
        task.standardOutput = pipe
        task.standardError = FileHandle.nullDevice
        do { try task.run() } catch { return .missing }
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        task.waitUntilExit()
        let lines = String(decoding: data, as: UTF8.self)
            .split(separator: "\n").filter { $0.contains("OBS Virtual Camera") }
        if lines.contains(where: { $0.contains("[activated enabled]") }) { return .ready }
        return lines.isEmpty ? .missing : .approval
    }

    static func text(_ state: State) -> String {
        switch state {
        case .ready: return "Meet verá el efecto (OBS Virtual Camera)"
        case .approval: return "Falta aprobar la cámara virtual de OBS"
        case .missing: return "Activa la cámara virtual en OBS una vez"
        case .noOBS: return "Instala OBS para usarlo en Meet"
        }
    }

    static func fixTitle(_ state: State) -> String? {
        switch state {
        case .ready: return nil
        case .approval: return "Abrir Ajustes"
        case .missing: return "Abrir OBS"
        case .noOBS: return "Descargar OBS"
        }
    }

    static func fix(_ state: State) {
        switch state {
        case .ready: break
        case .approval:
            NSWorkspace.shared.open(URL(string: "x-apple.systempreferences:com.apple.LoginItems-Settings.extension")!)
        case .missing:
            NSWorkspace.shared.open(URL(fileURLWithPath: "/Applications/OBS.app"))
        case .noOBS:
            NSWorkspace.shared.open(URL(string: "https://obsproject.com/download")!)
        }
    }
}
