from __future__ import annotations

import json
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles


BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
ASSETS_DIR = BASE_DIR / "assets"
VENDOR_DIR = BASE_DIR / "node_modules"
SWING_PACKET_SIZE_BYTES = 16
SWING_PACKET_VERSION = 1
SWING_PACKET_KIND = 1


class ConnectionHub:
    def __init__(self) -> None:
        self.viewers: set[WebSocket] = set()
        self.players: set[WebSocket] = set()

    async def register(self, websocket: WebSocket, role: str) -> None:
        await websocket.accept()
        if role == "player":
            self.players.add(websocket)
            await self.broadcast_status()
            return

        self.viewers.add(websocket)
        await self.send_status(websocket)

    async def unregister(self, websocket: WebSocket) -> None:
        removed_player = websocket in self.players
        self.players.discard(websocket)
        self.viewers.discard(websocket)
        if removed_player:
            await self.broadcast_status()

    async def forward_orientation(self, payload: bytes) -> None:
        stale_viewers: list[WebSocket] = []
        for viewer in self.viewers:
            try:
                await viewer.send_bytes(payload)
            except Exception:
                stale_viewers.append(viewer)

        for viewer in stale_viewers:
            self.viewers.discard(viewer)

    async def send_status(self, websocket: WebSocket) -> None:
        payload = json.dumps(
            {
                "type": "status",
                "playerConnected": bool(self.players),
                "viewerCount": len(self.viewers),
            }
        )
        await websocket.send_text(payload)

    async def broadcast_status(self) -> None:
        stale_viewers: list[WebSocket] = []
        for viewer in self.viewers:
            try:
                await self.send_status(viewer)
            except Exception:
                stale_viewers.append(viewer)

        for viewer in stale_viewers:
            self.viewers.discard(viewer)


class ControlHub:
    def __init__(self) -> None:
        self.viewers: set[WebSocket] = set()
        self.players: set[WebSocket] = set()

    async def register(self, websocket: WebSocket, role: str) -> None:
        await websocket.accept()
        if role == "player":
            self.players.add(websocket)
            return

        self.viewers.add(websocket)

    async def unregister(self, websocket: WebSocket) -> None:
        self.players.discard(websocket)
        self.viewers.discard(websocket)

    async def forward_control(self, payload: str) -> None:
        stale_viewers: list[WebSocket] = []
        for viewer in self.viewers:
            try:
                await viewer.send_text(payload)
            except Exception:
                stale_viewers.append(viewer)

        for viewer in stale_viewers:
            self.viewers.discard(viewer)


app = FastAPI(title="Golf Club Orientation Visualizer")
hub = ConnectionHub()
control_hub = ControlHub()

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
app.mount("/assets", StaticFiles(directory=ASSETS_DIR), name="assets")
app.mount("/vendor", StaticFiles(directory=VENDOR_DIR), name="vendor")


@app.get("/")
async def root() -> RedirectResponse:
    return RedirectResponse(url="/game")


@app.get("/game")
async def game_page() -> FileResponse:
    return FileResponse(STATIC_DIR / "game.html")


@app.get("/golf_club")
async def golf_club_page() -> FileResponse:
    return FileResponse(STATIC_DIR / "golf_club.html")


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket, role: str = "viewer") -> None:
    await hub.register(websocket, role)
    try:
        while True:
            message = await websocket.receive()

            if message.get("type") == "websocket.disconnect":
                break

            if role != "player":
                continue

            payload = message.get("bytes")
            if (
                payload
                and len(payload) == SWING_PACKET_SIZE_BYTES
                and payload[0] == SWING_PACKET_VERSION
                and payload[1] == SWING_PACKET_KIND
            ):
                await hub.forward_orientation(payload)
    except WebSocketDisconnect:
        pass
    finally:
        await hub.unregister(websocket)


@app.websocket("/ws/control")
async def control_websocket_endpoint(websocket: WebSocket, role: str = "viewer") -> None:
    await control_hub.register(websocket, role)
    try:
        while True:
            message = await websocket.receive()

            if message.get("type") == "websocket.disconnect":
                break

            if role != "player":
                continue

            payload = message.get("text")
            if payload:
                await control_hub.forward_control(payload)
    except WebSocketDisconnect:
        pass
    finally:
        await control_hub.unregister(websocket)