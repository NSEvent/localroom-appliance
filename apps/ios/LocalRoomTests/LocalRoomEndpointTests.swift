import XCTest
@testable import LocalRoom

final class LocalRoomEndpointTests: XCTestCase {
    func testMeetingURLKeepsRoomAndParticipantNameAsSeparateQueryItems() throws {
        let url = LocalRoomEndpoint.meetingURL(
            baseURL: try XCTUnwrap(URL(string: "https://192.168.1.4:4174")),
            room: "DELL DEMO",
            name: "Maya & Jordan"
        )
        let components = try XCTUnwrap(URLComponents(url: url, resolvingAgainstBaseURL: false))
        let items = Dictionary(uniqueKeysWithValues: try XCTUnwrap(components.queryItems).map {
            ($0.name, $0.value)
        })

        XCTAssertEqual(components.host, "192.168.1.4")
        XCTAssertEqual(items["room"], "DELL DEMO")
        XCTAssertEqual(items["name"], "Maya & Jordan")
        XCTAssertEqual(items["autojoin"], "1")
    }

    func testNavigationPolicyRejectsExternalAndNonHTTPDestinations() throws {
        XCTAssertFalse(LocalRoomEndpoint.allowsNavigation(to: URL(string: "https://example.com")))
        XCTAssertFalse(LocalRoomEndpoint.allowsNavigation(to: URL(string: "file:///tmp/demo")))
        XCTAssertTrue(LocalRoomEndpoint.allowsNavigation(to: LocalRoomEndpoint.meetingURL))
    }
}
