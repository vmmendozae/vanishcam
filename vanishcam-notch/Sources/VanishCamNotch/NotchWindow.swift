import AppKit
import SwiftUI

/// Size and position of the hardware notch (or a notch-sized area at the top
/// centre of screens without one).
struct NotchGeometry {
    let screen: NSScreen
    let width: CGFloat
    let height: CGFloat

    static func current() -> NotchGeometry {
        let screens = NSScreen.screens
        let screen = screens.first { $0.safeAreaInsets.top > 0 } ?? NSScreen.main ?? screens[0]
        let height = screen.safeAreaInsets.top > 0 ? screen.safeAreaInsets.top : 32
        var width: CGFloat = 190
        if let left = screen.auxiliaryTopLeftArea, let right = screen.auxiliaryTopRightArea {
            let derived = screen.frame.width - left.width - right.width
            if derived > 40 { width = derived }
        }
        return NotchGeometry(screen: screen, width: width, height: height)
    }

    /// A rectangle hanging from the top centre of the screen.
    func rect(width w: CGFloat, height h: CGFloat) -> NSRect {
        let frame = screen.frame
        return NSRect(x: frame.midX - w / 2, y: frame.maxY - h, width: w, height: h)
    }
}

enum NotchLayout {
    static let wing: CGFloat = 78            // collapsed pill: extra width on each side
    static let expandedWidth: CGFloat = 560
    static let expandedHeight: CGFloat = 212 // below the notch
}

/// Borderless panel above the menu bar that never takes focus away from Meet.
final class NotchPanel: NSPanel {
    init() {
        super.init(contentRect: .zero, styleMask: [.borderless, .nonactivatingPanel],
                   backing: .buffered, defer: false)
        isOpaque = false
        backgroundColor = .clear
        hasShadow = false
        level = NSWindow.Level(rawValue: NSWindow.Level.mainMenu.rawValue + 3)
        collectionBehavior = [.canJoinAllSpaces, .stationary, .fullScreenAuxiliary, .ignoresCycle]
        isMovable = false
        hidesOnDeactivate = false
        becomesKeyOnlyIfNeeded = true
    }

    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
}

/// Lets the first click on a button work even though the panel is not key.
final class FirstMouseHostingView<Content: View>: NSHostingView<Content> {
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
}
