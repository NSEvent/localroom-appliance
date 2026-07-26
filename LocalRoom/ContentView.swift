import AVFoundation
import SwiftUI

struct ContentView: View {
    @State private var permissionState: PermissionState = .checking
    @State private var webViewID = UUID()
    @State private var loadFailure: String?

    var body: some View {
        ZStack {
            Color(red: 0.035, green: 0.043, blue: 0.039)
                .ignoresSafeArea()

            switch permissionState {
            case .checking:
                ProgressView("Preparing private meeting…")
                    .tint(.lime)
            case .ready:
                MeetingWebView(url: LocalRoomEndpoint.meetingURL, loadFailure: $loadFailure)
                    .id(webViewID)
                    .ignoresSafeArea()
                    .safeAreaInset(edge: .top, spacing: 0) {
                        connectionBar
                    }
                if let loadFailure {
                    ConnectionFailureView(message: loadFailure) {
                        self.loadFailure = nil
                        webViewID = UUID()
                    }
                }
            case .denied:
                PermissionView {
                    openSettings()
                }
            }
        }
        .task {
            permissionState = await requestMediaPermissions()
        }
    }

    private var connectionBar: some View {
        HStack(spacing: 8) {
            Circle()
                .fill(Color.lime)
                .frame(width: 7, height: 7)
                .shadow(color: .lime, radius: 5)
            Text("DELL PRO · LOCAL")
                .font(.system(size: 10, weight: .semibold, design: .monospaced))
                .foregroundStyle(.secondary)
            Spacer()
            Button {
                webViewID = UUID()
            } label: {
                Image(systemName: "arrow.clockwise")
                    .font(.system(size: 13, weight: .semibold))
            }
            .foregroundStyle(.white)
            .accessibilityLabel("Reload meeting")
        }
        .padding(.horizontal, 14)
        .frame(height: 32)
        .background(.ultraThinMaterial)
    }

    private func requestMediaPermissions() async -> PermissionState {
        async let camera = AVCaptureDevice.requestAccess(for: .video)
        async let microphone = AVCaptureDevice.requestAccess(for: .audio)
        let cameraAllowed = await camera
        let microphoneAllowed = await microphone
        return cameraAllowed && microphoneAllowed ? .ready : .denied
    }

    private func openSettings() {
        guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
        UIApplication.shared.open(url)
    }
}

private struct ConnectionFailureView: View {
    let message: String
    let retry: () -> Void

    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "network.slash")
                .font(.system(size: 32))
                .foregroundStyle(Color.lime)
            Text("Dell Pro unavailable")
                .font(.title2.bold())
            Text(message)
                .font(.callout)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 340)
            Button("Try Again", action: retry)
                .buttonStyle(.borderedProminent)
                .tint(Color.lime)
                .foregroundStyle(.black)
        }
        .padding(30)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 20))
        .padding(24)
    }
}

private enum PermissionState {
    case checking
    case ready
    case denied
}

private extension Color {
    static let lime = Color(red: 0.72, green: 0.95, blue: 0.29)
}

private struct PermissionView: View {
    let openSettings: () -> Void

    var body: some View {
        VStack(spacing: 20) {
            ZStack {
                RoundedRectangle(cornerRadius: 20)
                    .fill(Color.lime.opacity(0.12))
                    .frame(width: 76, height: 76)
                Image(systemName: "video.fill")
                    .font(.system(size: 28))
                    .foregroundStyle(Color.lime)
            }
            Text("Camera and microphone needed")
                .font(.title2.bold())
            Text("LocalRoom sends your meeting media directly to participants and your isolated audio stream to the Dell Pro for local transcription.")
                .font(.callout)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 330)
            Button("Open Settings", action: openSettings)
                .buttonStyle(.borderedProminent)
                .tint(Color.lime)
                .foregroundStyle(.black)
        }
        .padding(30)
    }
}

#Preview {
    ContentView()
}
