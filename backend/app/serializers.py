"""Dict serializers shared by REST responses and WebSocket events."""

from datetime import datetime, timezone

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models import Account, Chat, Contact, Message


def iso(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    if dt.tzinfo is not None:
        dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt.isoformat() + "Z"


def unread_total(db: Session, account_id: int) -> int:
    return int(db.query(func.coalesce(func.sum(Chat.unread_count), 0)).filter(Chat.account_id == account_id).scalar() or 0)


def account_out(db: Session, a: Account) -> dict:
    return {
        "id": a.id,
        "label": a.label,
        "instance_name": a.instance_name,
        "phone_number": a.phone_number,
        "status": a.status,
        "created_at": iso(a.created_at),
        "unread_total": unread_total(db, a.id),
    }


def chat_out(c: Chat) -> dict:
    return {
        "id": c.id,
        "account_id": c.account_id,
        "jid": c.jid,
        "name": c.name,
        "is_group": c.is_group,
        "last_message_at": iso(c.last_message_at),
        "last_message_preview": c.last_message_preview,
        "unread_count": c.unread_count,
    }


def message_out(m: Message) -> dict:
    return {
        "id": m.id,
        "account_id": m.account_id,
        "chat_id": m.chat_id,
        "wa_message_id": m.wa_message_id,
        "client_id": m.client_id,
        "from_me": m.from_me,
        "sender_name": m.sender_name,
        "type": m.type,
        "text": m.text,
        "status": m.status,
        "timestamp": iso(m.timestamp),
    }


def contact_out(c: Contact) -> dict:
    return {"id": c.id, "account_id": c.account_id, "jid": c.jid, "name": c.name, "is_group": c.is_group}
