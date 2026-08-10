import AVKit
import SwiftUI
import UIKit

/// The system AirPlay button.
///
/// `AVRoutePickerView` rather than anything hand-rolled: the picker is a
/// system sheet, and only the system can actually move an in-flight media
/// session to another device. A custom route list would look right and change
/// nothing — §4.3 lists AirPlay in the toolbar, and this is the only way to
/// provide it honestly.
struct AirPlayButton: UIViewRepresentable {

    func makeUIView(context: UIViewRepresentableContext<AirPlayButton>) -> AVRoutePickerView {
        let view = AVRoutePickerView()
        // The app is a browser whose audio is nearly always video, so video
        // routes (Apple TV) should sort above audio-only ones.
        view.prioritizesVideoDevices = true
        return view
    }

    func updateUIView(
        _ uiView: AVRoutePickerView,
        context: UIViewRepresentableContext<AirPlayButton>
    ) {
        // Nothing to update: the system owns this control's state entirely.
    }
}
