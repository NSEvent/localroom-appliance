import Foundation

enum LocalRoomEndpoint {
    static let defaultBaseURL = URL(string: "https://172.16.10.189:4174")!

    static var baseURL: URL {
        if let configured = Bundle.main.object(forInfoDictionaryKey: "LOCALROOM_BASE_URL") as? String,
           let url = URL(string: configured),
           ["http", "https"].contains(url.scheme?.lowercased()) {
            return url
        }
        return defaultBaseURL
    }

    static var meetingURL: URL {
        meetingURL(baseURL: baseURL, room: "DELL-DEMO", name: "LocalRoom iOS")
    }

    static var allowedHost: String {
        baseURL.host ?? defaultBaseURL.host!
    }

    static func meetingURL(baseURL: URL, room: String, name: String) -> URL {
        var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false)!
        components.path = "/"
        components.queryItems = [
            URLQueryItem(name: "room", value: room),
            URLQueryItem(name: "autojoin", value: "1"),
            URLQueryItem(name: "name", value: name),
        ]
        return components.url!
    }

    static func allowsNavigation(to url: URL?) -> Bool {
        guard let url else { return false }
        return url.host == allowedHost && ["http", "https"].contains(url.scheme?.lowercased())
    }
}
