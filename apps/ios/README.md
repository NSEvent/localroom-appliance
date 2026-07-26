# LocalRoom iOS

Native iPhone/iPad client inside the LocalRoom appliance monorepo. The app uses
native iOS camera/microphone permission handling and embeds the same LocalRoom
WebRTC participant surface as the browser build.

The hackathon endpoint remains the safe default:

`https://172.16.10.189:4174/?room=DELL-DEMO&autojoin=1`

For another appliance, override the `LOCALROOM_BASE_URL` build setting. It is
written into the generated Info.plist; URL construction and same-appliance
navigation policy are covered by unit tests.

## Local certificate

The app accepts the development certificate only for the configured appliance host.
Safari and browser clients still need Kevin's local `mkcert` CA installed:

1. AirDrop the `rootCA.pem` from `mkcert -CAROOT` to the iPhone.
2. Install the downloaded profile in Settings.
3. Enable it under Settings → General → About → Certificate Trust Settings.

The certificate itself is public. Never copy `rootCA-key.pem`.

## Build

```bash
make build
```

For device deployment, use Kevin's standard `ios-build` helper.

## License

Source-available under the [PolyForm Noncommercial License 1.0.0](LICENSE.md)—read,
build, and run it freely for noncommercial purposes.
