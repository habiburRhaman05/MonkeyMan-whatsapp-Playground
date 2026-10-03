"""Turn Evolution message payloads (webhook or findMessages records) into plain dicts.

Shapes follow Evolution API v2.3.7 source (Baileys WAMessage):
  { key: {id, fromMe, remoteJid, participant?, remoteJidAlt?}, pushName,
    message: {conversation | extendedTextMessage | imageMessage | audioMessage ...},
    messageType, messageTimestamp, status? }
Unknown shapes are skipped (None) rather than guessed.
"""

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

PLACEHOLDERS = {
    "image": "[Image]",
    "video": "[Video]",
    "audio": "[Voice message]",
    "document": "[Document]",
    "sticker": "[Sticker]",
    "other": "[Unsupported message]",
}

STATUS_RANK = {"pending": 0, "sent": 1, "delivered": 2, "read": 3}

_WRAPPERS = (
    "ephemeralMessage",
    "viewOnceMessage",
    "viewOnceMessageV2",
    "viewOnceMessageV2Extension",
    "documentWithCaptionMessage",
    "editedMessage",
)
_IGNORED = {"reactionMessage", "protocolMessage", "senderKeyDistributionMessage", "pollUpdateMessage"}


@dataclass
class ParsedMessage:
    jid: str
    wa_id: str
    from_me: bool
    sender_name: str | None
    type: str
    text: str | None
    timestamp: datetime
    status: str
    chat_name_hint: str | None


def preview_for(msg_type: str, text: str | None) -> str:
    if msg_type == "text":
        return (text or "")[:200]
    label = PLACEHOLDERS.get(msg_type, PLACEHOLDERS["other"])
    return f"{label} {text}"[:200] if text else label


def map_status(raw: Any, from_me: bool) -> str:
    if not from_me:
        return "delivered"
    s = str(raw or "").upper()
    if s in ("ERROR", "FAILED"):
        return "failed"
    if s == "PENDING":
        return "pending"
    if s in ("DELIVERY_ACK", "DELIVERED"):
        return "delivered"
    if s in ("READ", "PLAYED", "PLAY"):
        return "read"
    return "sent"


def better_status(old: str, new: str) -> bool:
    """True if `new` should replace `old` (never downgrade)."""
    if new == "failed":
        return old == "pending"
    return STATUS_RANK.get(new, 1) > STATUS_RANK.get(old, 1)


def parse_ts(value: Any) -> datetime:
    if isinstance(value, dict):
        value = value.get("low")
    try:
        n = int(value)
    except (TypeError, ValueError):
        n = 0
    if n > 10**12:
        n //= 1000
    if n <= 0:
        return datetime.now(timezone.utc).replace(tzinfo=None)
    return datetime.fromtimestamp(n, tz=timezone.utc).replace(tzinfo=None)


def _classify(message: Any) -> tuple[str, str | None] | None:
    m = message if isinstance(message, dict) else {}
    for _ in range(3):
        for w in _WRAPPERS:
            inner = m.get(w)
            if isinstance(inner, dict) and isinstance(inner.get("message"), dict):
                m = inner["message"]
                break
        else:
            break
    if not m:
        return None
    if isinstance(m.get("conversation"), str):
        return "text", m["conversation"]
    ext = m.get("extendedTextMessage")
    if isinstance(ext, dict):
        return "text", ext.get("text") or ""
    for key, kind in (("imageMessage", "image"), ("videoMessage", "video"), ("ptvMessage", "video")):
        if isinstance(m.get(key), dict):
            return kind, m[key].get("caption") or None
    if isinstance(m.get("audioMessage"), dict):
        return "audio", None
    doc = m.get("documentMessage")
    if isinstance(doc, dict):
        return "document", doc.get("caption") or doc.get("fileName") or None
    if isinstance(m.get("stickerMessage"), dict):
        return "sticker", None
    if any(k in _IGNORED for k in m):
        return None
    keys = [k for k in m if k != "messageContextInfo"]
    return ("other", None) if keys else None


def skip_jid(jid: str | None) -> bool:
    return (not jid) or jid == "status@broadcast" or jid.endswith("@broadcast") or jid.endswith("@newsletter")


def parse_message(data: dict[str, Any]) -> ParsedMessage | None:
    if not isinstance(data, dict):
        return None
    key = data.get("key") or {}
    jid = key.get("remoteJid")
    if isinstance(jid, str) and jid.endswith("@lid") and key.get("remoteJidAlt"):
        jid = key["remoteJidAlt"]
    wa_id = key.get("id")
    if skip_jid(jid) or not wa_id:
        return None
    classified = _classify(data.get("message"))
    if classified is None:
        return None
    msg_type, text = classified
    from_me = bool(key.get("fromMe"))
    push = data.get("pushName") if isinstance(data.get("pushName"), str) else None
    is_group = jid.endswith("@g.us")
    return ParsedMessage(
        jid=jid,
        wa_id=str(wa_id),
        from_me=from_me,
        sender_name=None if from_me else push,
        type=msg_type,
        text=text,
        timestamp=parse_ts(data.get("messageTimestamp")),
        status=map_status(data.get("status"), from_me),
        chat_name_hint=push if (not from_me and not is_group) else None,
    )
