# LocalRoom iOS

Native iPhone/iPad client for the Dell × NVIDIA hackathon meeting demo. The app
uses native iOS camera/microphone permission handling and embeds the same
LocalRoom WebRTC client as the browser build.

The hackathon endpoint is intentionally hardcoded:

`https://172.16.10.189:4174/?room=DELL-DEMO`

## Local certificate

The Dell endpoint uses Kevin's local `mkcert` CA. Before running on a physical
iPhone, install that CA certificate on the device and enable full trust:

1. AirDrop the `rootCA.pem` from `mkcert -CAROOT` to the iPhone.
2. Install the downloaded profile in Settings.
3. Enable it under Settings → General → About → Certificate Trust Settings.

The certificate itself is public. Never copy `rootCA-key.pem`.

## Build

```bash
make build
```

For device deployment, use Kevin's standard `ios-build` helper.
