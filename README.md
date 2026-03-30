# Golf Club Orientation Visualizer

This prototype hosts two browser pages from a FastAPI server on the local network:

- `/game` renders a Three.js scene with the golf club model.
- `/golf_club` runs on a phone, reads `DeviceOrientationEvent`, applies neutral calibration, and streams binary quaternion packets over WebSocket.

## Run

1. Create a Python environment.
2. Install Python dependencies with `pip install -r requirements.txt`.
3. Install the local browser dependency with `npm install`.
4. For plain HTTP, start the server with `uvicorn main:app --host 0.0.0.0 --port 8000`.
5. Open `http://PC_IP:8000/game` on the server PC.
6. Open `http://PC_IP:8000/golf_club` on the phone.

Phone note: some mobile browsers, especially on iPhone, require `https://` or `localhost` before `DeviceOrientationEvent` is exposed. If the player page says motion sensors are unavailable, try Safari/Chrome on a supported device or serve the player page over HTTPS.

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

- Orientation packets are binary and 8 bytes long.
- Each packet contains little-endian signed `int16` values for quaternion `(x, y, z, w)`.
- Each component is decoded from `[-32767, 32767]` into `[-1, 1]` and renormalized before use.