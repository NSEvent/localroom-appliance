# LocalRoom iOS

Native iPhone/iPad client for the Dell × NVIDIA hackathon meeting demo. The app
uses native iOS camera/microphone permission handling and embeds the same
LocalRoom WebRTC client as the browser build.

The server and browser client live in a separate repository:
**[localroom](https://github.com/NSEvent/localroom)**.

The hackathon endpoint is intentionally hardcoded:

`https://172.16.10.189:4174/?room=DELL-DEMO&autojoin=1`

## Local certificate

The app accepts the development certificate only for the hardcoded Dell host.
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
