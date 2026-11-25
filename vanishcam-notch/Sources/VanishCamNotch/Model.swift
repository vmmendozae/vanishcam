import AppKit
import AVFoundation
import Combine

/// Everything the notch shows. The engine (Python, headless) pushes status
/// and preview frames; the notch sends commands back through `Engine`.
@MainActor
final class NotchModel: ObservableObject {
    enum EngineState { case stopped, starting, running }

    struct Camera: Identifiable, Hashable {
        let id: Int        // OpenCV index (order of AVCaptureDevice video devices)
        let name: String
    }

    static let modes: [(id: String, name: String)] = [
        ("auto", "Auto"), ("goku", "Goku"), ("naruto", "Naruto"),
        ("particles", "Partículas"), ("normal", "Normal"), ("itachi", "Itachi"),
    ]

    @Published var engineState: EngineState = .stopped
    @Published var isExpanded = false

    // Engine status
    @Published var phase = "stopped"
    @Published var title = ""
    @Published var detail = ""
    @Published var color = "gray"
    @Published var effect: String?
    @Published var virtualOK: Bool?
    @Published var count: Int?
    @Published var personShare: Double?
    @Published var gokuLeft: Double?
    @Published var canCancelBackground = false
    @Published var preview: NSImage?
    @Published var backgroundPreview: NSImage?
    @Published var lastError: String?

    // Settings (persisted)
    @Published var mode: String { didSet { defaults.set(mode, forKey: "mode") } }
    @Published var cameraIndex: Int { didSet { defaults.set(cameraIndex, forKey: "camera") } }
    @Published var gokuDelay: Double { didSet { defaults.set(gokuDelay, forKey: "gokuDelay") } }
    @Published var autoV: String { didSet { defaults.set(autoV, forKey: "autoV") } }

    @Published var cameras: [Camera] = []
    @Published var obs: OBSStatus.State = .ready

    private let defaults = UserDefaults.standard

    init() {
        mode = defaults.string(forKey: "mode") ?? "auto"
        cameraIndex = defaults.object(forKey: "camera") as? Int ?? 0
        gokuDelay = defaults.object(forKey: "gokuDelay") as? Double ?? 1.0
        autoV = defaults.string(forKey: "autoV") ?? "normal"
        refreshCameras()
        obs = OBSStatus.check()
    }

    /// Same order OpenCV's AVFoundation backend uses for camera indexes.
    func refreshCameras() {
        let devices = AVCaptureDevice.devices(for: .video) + AVCaptureDevice.devices(for: .muxed)
        cameras = devices.enumerated().map { Camera(id: $0.offset, name: $0.element.localizedName) }
            .filter { !$0.name.localizedCaseInsensitiveContains("OBS Virtual") }
        if !cameras.contains(where: { $0.id == cameraIndex }), let first = cameras.first {
            cameraIndex = first.id
        }
    }

    var isRunning: Bool { engineState != .stopped }
    var inBackgroundFlow: Bool { phase.hasPrefix("bg_") }

    /// Short label shown in the collapsed pill.
    var pillLabel: String {
        switch phase {
        case "ready": return Self.modes.first { $0.id == mode }?.name ?? "Listo"
        case "vanished": return "Oculto"
        case "effect": return "Efecto"
        case "loading": return "Cargando"
        case "bg_leave": return count.map { "Sal \($0)" } ?? "Sal"
        case "bg_capturing": return "Fondo"
        case "bg_framing", "bg_review": return "Fondo"
        case "error": return "Error"
        default: return "VanishCam"
        }
    }

    var statusColor: NSColor {
        switch color {
        case "green": return .systemGreen
        case "red": return .systemRed
        case "amber": return .systemOrange
        case "blue": return .systemBlue
        default: return .systemGray
        }
    }

    /// Friendlier Spanish text than the engine's (OpenCV had no accents).
    var displayTitle: String {
        switch phase {
        case "ready":
            if let left = gokuLeft { return "Teletransporte en \(String(format: "%.1f", left)) s" }
            return "Listo"
        case "vanished": return "Desaparecido"
        case "effect": return "Efecto en curso"
        case "loading": return "Cargando…"
        case "calibrating": return "Capturando el fondo"
        case "stopped": return "Cámara apagada"
        default: return title
        }
    }

    var displayDetail: String {
        switch phase {
        case "ready":
            if gokuLeft != nil { return "Mantén el gesto" }
            return Self.hint(for: mode, gokuDelay: gokuDelay, autoV: autoV)
        case "vanished":
            return (effect == "goku" || effect == "itachi")
                ? "Repite el gesto o pulsa Reaparecer" : "Pulsa Reaparecer para volver"
        case "stopped": return "Pulsa Iniciar para usar los efectos"
        default: return detail
        }
    }

    static func hint(for mode: String, gokuDelay: Double, autoV: String) -> String {
        let delay = String(format: "%g", gokuDelay)
        switch mode {
        case "auto": return "Goku: 2 dedos en la frente · Naruto: palmas juntas · \(autoV == "normal" ? "Normal" : "Partículas"): V"
        case "goku": return "Dos dedos juntos en la frente \(delay) s"
        case "naruto": return "Junta las palmas frente a la cámara"
        case "itachi": return "Junta las manos frente al pecho"
        default: return "Haz la V con índice y medio"
        }
    }
}
