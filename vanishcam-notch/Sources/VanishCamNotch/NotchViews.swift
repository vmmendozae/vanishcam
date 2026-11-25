import AppKit
import SwiftUI

/// Black shape that grows out of the notch: straight top, rounded bottom.
struct NotchShape: Shape {
    var bottomRadius: CGFloat
    var animatableData: CGFloat {
        get { bottomRadius }
        set { bottomRadius = newValue }
    }

    func path(in rect: CGRect) -> Path {
        UnevenRoundedRectangle(bottomLeadingRadius: bottomRadius, bottomTrailingRadius: bottomRadius)
            .path(in: rect)
    }
}

struct NotchRootView: View {
    @ObservedObject var model: NotchModel
    let actions: NotchActions
    private let geometry = NotchGeometry.current()

    var body: some View {
        let expanded = model.isExpanded
        let width = expanded ? NotchLayout.expandedWidth
            : geometry.width + (model.isRunning ? NotchLayout.wing * 2 : 0)
        let height = expanded ? geometry.height + NotchLayout.expandedHeight : geometry.height
        VStack(spacing: 0) {
            ZStack(alignment: .top) {
                NotchShape(bottomRadius: expanded ? 26 : 12)
                    .fill(Color.black)
                    .shadow(color: .black.opacity(expanded ? 0.45 : 0), radius: 16, y: 6)
                if expanded {
                    ExpandedView(model: model, actions: actions, notch: geometry)
                        .transition(.opacity.combined(with: .scale(scale: 0.96, anchor: .top)))
                } else if model.isRunning {
                    CollapsedView(model: model, notch: geometry)
                        .transition(.opacity)
                }
            }
            .frame(width: width, height: height)
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .environment(\.colorScheme, .dark)
    }
}

// MARK: - collapsed pill

struct CollapsedView: View {
    @ObservedObject var model: NotchModel
    let notch: NotchGeometry

    var body: some View {
        HStack(spacing: 0) {
            HStack(spacing: 6) {
                Circle().fill(Color(model.statusColor)).frame(width: 8, height: 8)
                    .shadow(color: Color(model.statusColor), radius: 4)
                Text("VC").font(.system(size: 11, weight: .heavy, design: .rounded))
                    .foregroundStyle(.white.opacity(0.85))
            }
            .frame(width: NotchLayout.wing, alignment: .center)
            Spacer(minLength: notch.width)
            Text(model.pillLabel)
                .font(.system(size: 11, weight: .semibold, design: .rounded))
                .foregroundStyle(Color(model.statusColor))
                .lineLimit(1).minimumScaleFactor(0.7)
                .frame(width: NotchLayout.wing, alignment: .center)
        }
        .frame(height: notch.height)
    }
}

// MARK: - expanded panel

struct ExpandedView: View {
    @ObservedObject var model: NotchModel
    let actions: NotchActions
    let notch: NotchGeometry

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            header
            HStack(alignment: .top, spacing: 14) {
                VStack(alignment: .leading, spacing: 8) {
                    PreviewBox(model: model)
                    obsRow
                }
                .frame(width: 228)
                VStack(alignment: .leading, spacing: 9) {
                    status
                    controls
                    Spacer(minLength: 0)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            if let error = model.lastError {
                Label(error, systemImage: "exclamationmark.triangle.fill")
                    .font(.system(size: 11)).foregroundStyle(.orange).lineLimit(2)
            }
        }
        .padding(.horizontal, 18)
        .padding(.bottom, 14)
        .foregroundStyle(.white)
    }

    // Header lives beside the notch: title on the left, power on the right.
    private var header: some View {
        HStack {
            HStack(spacing: 6) {
                Image(systemName: "sparkles").font(.system(size: 12, weight: .bold))
                Text("VanishCam").font(.system(size: 13, weight: .bold, design: .rounded))
            }
            .frame(width: (NotchLayout.expandedWidth - notch.width) / 2 - 24, alignment: .leading)
            Spacer(minLength: notch.width)
            HStack(spacing: 4) {
                if model.isRunning {
                    IconButton(symbol: "stop.fill", help: "Apagar la cámara") { actions.stop() }
                }
                IconButton(symbol: "power", help: "Salir de VanishCam", tint: .red) { actions.quit() }
            }
            .frame(width: (NotchLayout.expandedWidth - notch.width) / 2 - 24, alignment: .trailing)
        }
        .frame(height: notch.height)
    }

    private var status: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: 7) {
                Circle().fill(Color(model.statusColor)).frame(width: 9, height: 9)
                Text(model.displayTitle).font(.system(size: 15, weight: .bold, design: .rounded))
                    .lineLimit(1)
            }
            Text(model.displayDetail).font(.system(size: 11)).foregroundStyle(.white.opacity(0.65))
                .lineLimit(2).fixedSize(horizontal: false, vertical: true)
        }
    }

    @ViewBuilder private var controls: some View {
        switch model.phase {
        case "stopped": stoppedControls
        case "loading": ProgressView().controlSize(.small).padding(.top, 4)
        case "bg_framing":
            HStack {
                PillButton(title: "Capturar fondo", symbol: "camera.aperture", style: .primary) { actions.command("bg_capture") }
                if model.canCancelBackground { PillButton(title: "Cancelar") { actions.command("bg_cancel") } }
            }
            Text("Tendrás 3 segundos para salir del encuadre. Suena al terminar.")
                .font(.system(size: 11)).foregroundStyle(.white.opacity(0.55))
        case "bg_leave", "bg_capturing":
            EmptyView()
        case "bg_review":
            HStack {
                PillButton(title: "Repetir", symbol: "arrow.counterclockwise") { actions.command("bg_retry") }
                PillButton(title: "Listo, empezar", symbol: "checkmark", style: .primary) { actions.command("bg_accept") }
            }
        default: runningControls
        }
    }

    private var stoppedControls: some View {
        VStack(alignment: .leading, spacing: 9) {
            if model.cameras.count > 1 {
                ChipRow(items: model.cameras.map { ($0.id.description, $0.name) },
                        selected: model.cameraIndex.description) { model.cameraIndex = Int($0) ?? 0 }
            }
            ModeGrid(model: model, actions: actions)
            HStack {
                PillButton(title: "Iniciar", symbol: "play.fill", style: .primary) { actions.start() }
                Spacer()
                Toggle("Abrir al iniciar sesión", isOn: Binding(
                    get: { actions.opensAtLogin }, set: { actions.setOpensAtLogin($0) }))
                    .toggleStyle(.checkbox).font(.system(size: 11))
            }
        }
    }

    private var runningControls: some View {
        VStack(alignment: .leading, spacing: 9) {
            ModeGrid(model: model, actions: actions)
            HStack(spacing: 6) {
                PillButton(title: "Desaparecer") { actions.command("vanish") }
                    .disabled(model.phase != "ready")
                PillButton(title: "Reaparecer") { actions.command("appear") }
                    .disabled(model.phase != "vanished")
                PillButton(title: "Nuevo fondo") { actions.command("background") }
            }
            HStack(spacing: 10) {
                HStack(spacing: 4) {
                    Text("Goku").font(.system(size: 11)).foregroundStyle(.white.opacity(0.6))
                    IconButton(symbol: "minus", help: "Menos tiempo") { actions.changeGokuDelay(by: -0.5) }
                    Text(String(format: "%.1f s", model.gokuDelay)).font(.system(size: 11, weight: .semibold).monospacedDigit())
                    IconButton(symbol: "plus", help: "Más tiempo") { actions.changeGokuDelay(by: 0.5) }
                }
                HStack(spacing: 4) {
                    Text("V").font(.system(size: 11)).foregroundStyle(.white.opacity(0.6))
                    ChipRow(items: [("normal", "Normal"), ("particles", "Partículas")],
                            selected: model.autoV, compact: true) { actions.setAutoV($0) }
                }
            }
        }
    }

    private var obsRow: some View {
        HStack(spacing: 6) {
            Image(systemName: model.obs == .ready ? "checkmark.circle.fill" : "exclamationmark.circle.fill")
                .foregroundStyle(model.obs == .ready ? .green : .orange)
            Text(model.virtualOK == false && model.obs == .ready
                 ? "OBS ocupado: detén su cámara virtual" : OBSStatus.text(model.obs))
                .font(.system(size: 10)).foregroundStyle(.white.opacity(0.7)).lineLimit(2)
            Spacer(minLength: 0)
            if let fix = OBSStatus.fixTitle(model.obs) {
                Button(fix) { actions.fixOBS() }.buttonStyle(.plain)
                    .font(.system(size: 10, weight: .semibold)).foregroundStyle(.blue)
            }
        }
    }
}

// MARK: - pieces

struct PreviewBox: View {
    @ObservedObject var model: NotchModel

    var body: some View {
        let image = model.phase == "bg_review" ? model.backgroundPreview : model.preview
        ZStack {
            RoundedRectangle(cornerRadius: 12).fill(Color.white.opacity(0.06))
            if let image, model.isRunning {
                Image(nsImage: image).resizable().aspectRatio(contentMode: .fill)
            } else {
                VStack(spacing: 6) {
                    Image(systemName: model.isRunning ? "camera" : "video.slash")
                        .font(.system(size: 22)).foregroundStyle(.white.opacity(0.35))
                    Text(model.isRunning ? "Abriendo la cámara…" : "Cámara apagada")
                        .font(.system(size: 11)).foregroundStyle(.white.opacity(0.45))
                }
            }
            if model.phase == "bg_leave", let count = model.count {
                Text("\(count)").font(.system(size: 54, weight: .heavy, design: .rounded))
                    .foregroundStyle(.white).shadow(radius: 8)
            } else if model.phase == "bg_capturing" {
                Text("Capturando…").font(.system(size: 15, weight: .bold, design: .rounded))
                    .padding(.horizontal, 10).padding(.vertical, 5)
                    .background(Capsule().fill(Color.red.opacity(0.85)))
            }
        }
        .frame(width: 228, height: 128)
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Color(model.statusColor).opacity(0.7), lineWidth: 1.5))
    }
}

struct ModeGrid: View {
    @ObservedObject var model: NotchModel
    let actions: NotchActions

    var body: some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 5), count: 3), spacing: 5) {
            ForEach(NotchModel.modes, id: \.id) { mode in
                let selected = model.mode == mode.id
                Button { actions.setMode(mode.id) } label: {
                    Text(mode.name).font(.system(size: 11, weight: selected ? .bold : .medium))
                        .frame(maxWidth: .infinity).padding(.vertical, 5)
                        .background(RoundedRectangle(cornerRadius: 7)
                            .fill(selected ? Color.white : Color.white.opacity(0.08)))
                        .foregroundStyle(selected ? Color.black : Color.white)
                }
                .buttonStyle(.plain)
            }
        }
    }
}

struct ChipRow: View {
    let items: [(String, String)]
    let selected: String
    var compact = false
    let onSelect: (String) -> Void

    var body: some View {
        HStack(spacing: 4) {
            ForEach(items, id: \.0) { item in
                let on = item.0 == selected
                Button { onSelect(item.0) } label: {
                    Text(item.1).font(.system(size: compact ? 10 : 11, weight: on ? .bold : .medium))
                        .lineLimit(1)
                        .padding(.horizontal, compact ? 6 : 8).padding(.vertical, compact ? 3 : 4)
                        .background(Capsule().fill(on ? Color.white : Color.white.opacity(0.08)))
                        .foregroundStyle(on ? Color.black : Color.white)
                }
                .buttonStyle(.plain)
            }
        }
    }
}

struct PillButton: View {
    enum Style { case normal, primary }
    let title: String
    var symbol: String? = nil
    var style: Style = .normal
    let action: () -> Void
    @Environment(\.isEnabled) private var enabled

    var body: some View {
        Button(action: action) {
            HStack(spacing: 5) {
                if let symbol { Image(systemName: symbol).font(.system(size: 10, weight: .bold)) }
                Text(title).font(.system(size: 11, weight: .semibold)).lineLimit(1)
            }
            .padding(.horizontal, 10).padding(.vertical, 6)
            .background(Capsule().fill(style == .primary ? Color.green : Color.white.opacity(0.12)))
            .foregroundStyle(style == .primary ? Color.black : Color.white)
            .opacity(enabled ? 1 : 0.35)
        }
        .buttonStyle(.plain)
    }
}

struct IconButton: View {
    let symbol: String
    let help: String
    var tint: Color = .white
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: symbol).font(.system(size: 10, weight: .bold))
                .frame(width: 22, height: 22)
                .background(Circle().fill(Color.white.opacity(0.1)))
                .foregroundStyle(tint)
        }
        .buttonStyle(.plain)
        .help(help)
    }
}
