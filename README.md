# WhatsApp Dashboard

A web dashboard to connect several WhatsApp numbers, switch between them, read chats live, send text and voice messages, and get notifications — powered by [Evolution API](https://github.com/evolution-foundation/evolution-api).

> ⚠️ **Risk:** Evolution API is an unofficial WhatsApp Web integration. Numbers can be banned. Use a spare number first. No bulk sending. Running from a VPS/data-center IP raises the risk a little.

> 🔓 **There is no login.** Anyone who can reach the backend can control your numbers. Keep it on `localhost` or behind an SSH tunnel / VPN. Never open ports 8000, 3001 or 8080 to the internet.

## Features

- Connect multiple numbers (QR scan), see live status, disconnect / reconnect / remove
- Switch between numbers; each shows only its own chats
- Chat list (sorted by latest) and a Contacts tab, with a filter box
- **Profile photos** from WhatsApp on chats, contacts and the conversation header
- **Contact names** correctly resolved (handles WhatsApp's newer @lid IDs)
- Live messages with no refresh (WebSocket); history kept in SQLite
- Send text (Enter = send, Shift+Enter = new line) with ✓ sent / ✓✓ delivered / blue ✓✓ read ticks, failed → Retry
- **Send images, videos and documents** (paperclip button)
- Record and send **voice notes** (microphone button); play received voice notes and images on demand
- **Emoji picker** (smiley button next to the text box)
- **Reply / quote messages** (right-click or tap the ⋮ menu on any bubble)
- **React to messages** with quick emoji reactions
- **Forward messages** to other chats
- **Search in chat** (magnifying glass in the conversation header)
- **Profile view panel** (click the name/avatar in the conversation header)
- **Typing indicators** (dots appear when the other person is typing)
- New chat by phone number
- Unread badges per chat and per number, tab title `(3) WhatsApp Dashboard`
- Notifications: in-app toasts (click to jump to the chat), sound with mute toggle, and **browser desktop notifications** when the tab is in the background
- Mobile layout: list → conversation → back

## Prerequisites

- **Docker** with Compose (Docker Desktop on Windows/Mac, or `docker` + compose plugin on Linux/VPS)
- **Python 3.11+**
- **Node.js 20+**

## Setup

### 1. Configure

```bash
cp .env.example .env
```

Edit `.env` and set real random values for `EVOLUTION_API_KEY`, `WEBHOOK_SECRET` and `POSTGRES_PASSWORD`.

### 2. Start Evolution API (Docker)

```bash
docker compose up -d
docker compose ps
```

`evolution_api`, `evolution_postgres` and `evolution_redis` should all be running.

### 3. Start the backend

The backend must listen on `0.0.0.0` so the Evolution container can deliver webhooks to it. If you do this, make sure port 8000 is not reachable from the internet (see "Server / VPS" below).

**Windows (PowerShell):**
```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

**Mac / Linux:**
```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

On Docker Desktop (Windows/Mac) `127.0.0.1` also works for the backend; `0.0.0.0` is needed on Linux.

### 4. Start the frontend

```bash
cd frontend
npm install
npm run dev          # development, http://localhost:3001
```

For a server: `npm run build && npm start -- --port 3001`.

The browser only talks to port 3001: the frontend forwards `/api/*` (including the live WebSocket) to the backend on `localhost:8000` (see `frontend/next.config.ts`). You do not need a `frontend/.env` file. If the backend runs elsewhere, set `BACKEND_URL` before starting the frontend.

**GitHub Codespaces:** if `docker compose up` shows `P1001 Can't reach database server`, container networking is blocked there; use `docker compose -f docker-compose.host.yml up -d` and set `WEBHOOK_BASE_URL=http://localhost:8000` in `.env`.

### 5. Use it

Open **http://localhost:3001**.

1. Click **Manage numbers → + Connect a number**, enter a label, scan the QR with WhatsApp (Settings → Linked Devices → Link a Device).
2. When the status turns **connected**, chats and contacts are imported automatically (about 10 s). Use the ↻ button to sync again.
3. Click a chat and send a message. Click the 🔔 **Enable desktop alerts** button once to allow browser notifications.

## Server / VPS

Run all steps above on the server, then reach the dashboard from your PC through an SSH tunnel (no ports opened):

```bash
ssh -L 3001:localhost:3001 -L 8000:localhost:8000 user@YOUR_SERVER
```

Then open http://localhost:3001 on your PC (`localhost` also counts as a secure context, which the microphone needs).

Firewall: allow only SSH, plus Docker's internal network to reach the backend for webhooks:

```bash
sudo ufw allow OpenSSH
sudo ufw allow from 172.16.0.0/12 to any port 8000
sudo ufw enable
```

Use `tmux` or `pm2` to keep the backend and frontend running after you disconnect.

## Project structure

```
├─ docker-compose.yml        Evolution API + Postgres + Redis (pinned versions, localhost only)
├─ backend/app/              FastAPI
│  ├─ main.py                app, CORS, /health, /ws
│  ├─ evolution.py           Evolution API client (all calls live here)
│  ├─ normalize.py           webhook/message payload → plain messages
│  ├─ services.py, sync.py   storing messages, importing history
│  └─ routers/               accounts, chats (messages/send/voice/media), webhook
├─ frontend/src/
│  ├─ app/                   / (chats) and /accounts
│  ├─ components/            TopBar, ChatList, Conversation, Bubble, Composer, Realtime, Toasts
│  └─ lib/                   api, zustand store, WebSocket hook, actions
└─ docs/payloads/            first real webhook payload of each event type (API key redacted)
```

## Ports

| Service | Port | Bound to |
|---|---|---|
| Frontend | 3001 | all interfaces (dev server) |
| Backend | 8000 | see above |
| Evolution API | 8080 | 127.0.0.1 |
| Postgres / Redis | 5432 / 6379 | 127.0.0.1 |

## Known limits

- Incoming images/video/documents/voice load on demand (click Open / Play).
- No calling and no SMS.
- Opening a chat marks it read **in the dashboard only**; no read receipt is sent to the contact, and the phone's own unread count is unchanged.
- A failed voice note cannot be retried; record it again.
- Voice recording needs `localhost` or https (browser rule) and microphone permission.
- Messages that arrive while the backend is stopped are not delivered live; press ↻ sync to import recent history.
- No login / single user.

## Troubleshooting

**Webhooks never arrive (status never changes, no live messages):**
- The backend must run and listen on `0.0.0.0` (Linux) before connecting a number.
- Check `docker logs evolution_api --tail 50`.
- `WEBHOOK_BASE_URL` in `.env` must be reachable from the container (`http://host.docker.internal:8000` by default).
- On a server with `ufw`, the rule `ufw allow from 172.16.0.0/12 to any port 8000` is needed.

**QR expired:** click **Show QR** / **Reconnect** for a fresh one.

**"Cannot reach the backend":** the backend must be running on port 8000; `FRONTEND_ORIGIN` in `.env` must exactly match the frontend URL.

**No chats after connecting:** wait ~15 s, then press the ↻ button.

**Desktop alerts blocked:** allow notifications for the site in your browser's site settings.
