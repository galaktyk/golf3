# Golf Club Orientation Visualizer

This prototype hosts two browser pages from a FastAPI server on the local network:

- `/game` renders a Three.js scene with the golf club model.
- `/golf_club` runs on a phone, reads `DeviceOrientationEvent` and `DeviceMotionEvent`, applies neutral calibration, derives swing speed from gyroscope motion, and streams binary swing-state packets over WebSocket.

## GitHub Pages

The static viewer and controller pages can also be published on GitHub Pages under the repository path:

- `https://galaktyk.github.io/golf3_web/game/`
- `https://galaktyk.github.io/golf3_web/golf_club.html`

The published pages now resolve CSS, JavaScript, fonts, models, and audio relative to the repository path instead of assuming `https://galaktyk.github.io/` is the site root. Three.js is loaded from jsDelivr so GitHub Pages does not need the local `/vendor` mount used by FastAPI.

## Run

1. Create a Python environment.
2. Install Python dependencies with `pip install -r requirements.txt`.
3. Install the local browser dependency with `npm install`.
4. For plain HTTP, start the server with `uvicorn main:app --host 0.0.0.0 --port 8000`.
5. Open `http://PC_IP:8000/game` on the server PC.
6. Open `http://PC_IP:8000/golf_club` on the phone.

Phone note: some mobile browsers, especially on iPhone, require `https://` or `localhost` before `DeviceOrientationEvent` and `DeviceMotionEvent` are exposed. If the player page says motion sensors are unavailable, try Safari/Chrome on a supported device or serve the player page over HTTPS.

## Local HTTPS

This repo includes a local HTTPS workflow for phone testing on the LAN.

1. Install `mkcert` on the PC.
2. Run `powershell -ExecutionPolicy Bypass -File .\scripts\setup_https.ps1`.
3. Trust the generated `mkcert` root CA on the phone if your browser requires it.
4. Start the HTTPS server with `python .\run_https.py`.
5. Open `https://PC_IP:8443/game` on the server PC.
6. Open `https://PC_IP:8443/golf_club` on the phone.

What the setup script does:

- creates `.certs/dev-cert.pem` and `.certs/dev-key.pem`
- includes `localhost`, the PC hostname, and detected local IPv4 addresses in the certificate SAN list
- installs the local `mkcert` root CA on the PC if needed

Important note for phones:

- A self-signed certificate is usually not enough. The phone browser may still block motion sensors unless the `mkcert` root CA is trusted on that phone.

## Protocol

- Swing-state packets are binary and 16 bytes long.
- Byte `0` is packet version `1`; byte `1` is packet kind `1`; bytes `2-3` carry a little-endian sequence number.
- Bytes `4-11` store quaternion `(x, y, z, w)` as little-endian signed `int16` values.
- Bytes `12-13` store phone-reported swing speed in hundredths of meters per second.
- Bytes `14-15` store motion sample age in milliseconds so the viewer can reject stale speed data.
- Quaternion components are decoded from `[-32767, 32767]` into `[-1, 1]` and renormalized before use.