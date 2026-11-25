import AppKit
import Foundation

/// Runs the Python engine (`VanishCamEngine --headless`) as a child process and
/// talks JSON lines with it: commands on stdin, status/preview on stdout.
@MainActor
final class Engine {
    private let model: NotchModel
    private var process: Process?
    private var input: FileHandle?
    private var buffer = Data()

    init(model: NotchModel) { self.model = model }

    static let logURL = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent("Library/Logs/VanishCam.log")

    /// Bundled engine, or VANISHCAM_ENGINE (a command line) for development.
    private func command() -> (URL, [String])? {
        if let dev = ProcessInfo.processInfo.environment["VANISHCAM_ENGINE"], !dev.isEmpty {
            let parts = dev.split(separator: " ").map(String.init)
            return (URL(fileURLWithPath: parts[0]), Array(parts.dropFirst()))
        }
        guard let resources = Bundle.main.resourceURL else { return nil }
        let binary = resources.appendingPathComponent("engine/VanishCamEngine/VanishCamEngine")
        return FileManager.default.isExecutableFile(atPath: binary.path) ? (binary, []) : nil
    }

    func start() {
        guard process == nil else { return }
        guard let (executable, prefix) = command() else {
            model.lastError = "No encuentro el motor de VanishCam dentro de la app."
            return
        }
        let process = Process()
        process.executableURL = executable
        process.arguments = prefix + [
            "--headless", "--mode", model.mode, "--camera", String(model.cameraIndex),
            "--auto-v", model.autoV,
        ]
        let stdin = Pipe(), stdout = Pipe()
        process.standardInput = stdin
        process.standardOutput = stdout
        process.standardError = Self.logHandle()
        stdout.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            Task { @MainActor in self?.receive(data) }
        }
        process.terminationHandler = { [weak self] finished in
            let status = finished.terminationStatus
            Task { @MainActor in self?.finished(status: status) }
        }
        do {
            try process.run()
        } catch {
            model.lastError = "No pude iniciar el motor: \(error.localizedDescription)"
            return
        }
        self.process = process
        input = stdin.fileHandleForWriting
        buffer.removeAll()
        model.lastError = nil
        model.engineState = .starting
        model.phase = "loading"
        model.preview = nil
        send(["cmd": "goku_delay", "value": model.gokuDelay])
        send(["cmd": "preview", "value": model.isExpanded])
    }

    func stop() {
        send(["cmd": "quit"])
        let running = process
        DispatchQueue.main.asyncAfter(deadline: .now() + 4) {
            if running?.isRunning == true { running?.terminate() }
        }
    }

    func send(_ message: [String: Any]) {
        guard let input, let data = try? JSONSerialization.data(withJSONObject: message) else { return }
        var line = data
        line.append(0x0A)
        try? input.write(contentsOf: line)
    }

    private static func logHandle() -> FileHandle {
        let url = logURL
        try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(),
                                                 withIntermediateDirectories: true)
        if !FileManager.default.fileExists(atPath: url.path) {
            FileManager.default.createFile(atPath: url.path, contents: nil)
        }
        let handle = (try? FileHandle(forWritingTo: url)) ?? FileHandle.nullDevice
        _ = try? handle.seekToEnd()
        return handle
    }

    private func receive(_ data: Data) {
        guard !data.isEmpty else { return }
        buffer.append(data)
        while let newline = buffer.firstIndex(of: 0x0A) {
            let line = buffer[buffer.startIndex..<newline]
            buffer.removeSubrange(buffer.startIndex...newline)
            guard let object = try? JSONSerialization.jsonObject(with: line),
                  let message = object as? [String: Any] else { continue }
            handle(message)
        }
    }

    private func handle(_ message: [String: Any]) {
        switch message["type"] as? String {
        case "status":
            model.engineState = .running
            model.phase = message["phase"] as? String ?? model.phase
            model.title = message["title"] as? String ?? ""
            model.detail = message["detail"] as? String ?? ""
            model.color = message["color"] as? String ?? "gray"
            model.effect = message["effect"] as? String
            model.virtualOK = message["virtual"] as? Bool
            model.count = message["count"] as? Int
            model.personShare = message["person_share"] as? Double
            model.gokuLeft = message["goku_left"] as? Double
            model.canCancelBackground = message["can_cancel"] as? Bool ?? false
            if let mode = message["mode"] as? String, NotchModel.modes.contains(where: { $0.id == mode }) {
                if model.mode != mode { model.mode = mode }
            }
        case "preview":
            guard let base64 = message["jpeg"] as? String, let data = Data(base64Encoded: base64),
                  let image = NSImage(data: data) else { return }
            if message["kind"] as? String == "background" { model.backgroundPreview = image }
            else { model.preview = image }
        case "error":
            model.lastError = message["message"] as? String
        default:
            break
        }
    }

    private func finished(status: Int32) {
        process = nil
        input = nil
        model.engineState = .stopped
        model.phase = "stopped"
        model.preview = nil
        model.backgroundPreview = nil
        model.gokuLeft = nil
        if status != 0 && model.lastError == nil {
            model.lastError = "El motor se detuvo (código \(status)). Detalles en ~/Library/Logs/VanishCam.log"
        }
    }
}
