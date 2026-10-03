"""FastAPI application entry point."""

import logging

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.db import Base, engine
from app.routers import accounts, chats, webhook
from app.ws import manager

logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(name)s  %(message)s")
logger = logging.getLogger(__name__)

# Create tables on startup
Base.metadata.create_all(bind=engine)

app = FastAPI(title="WhatsApp Dashboard", version="0.1.0")

# CORS — allow only the frontend origin
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_origin],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routers
app.include_router(accounts.router)
app.include_router(chats.router)
app.include_router(webhook.router)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await manager.connect(ws)
    try:
        while True:
            # Keep alive — we only send events, but read to detect disconnects
            await ws.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(ws)
