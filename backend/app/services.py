"""Shared persistence helpers for webhook, sync and send paths."""

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import Chat, Message
from app.normalize import ParsedMessage, preview_for


def get_or_create_chat(db: Session, account_id: int, jid: str, name: str | None = None) -> Chat:
    chat = db.query(Chat).filter_by(account_id=account_id, jid=jid).first()
    if chat:
        if not chat.name and name:
            chat.name = name
        return chat
    chat = Chat(account_id=account_id, jid=jid, is_group=jid.endswith("@g.us"), name=name, unread_count=0)
    db.add(chat)
    db.flush()
    return chat


def touch_chat(chat: Chat, p_time, msg_type: str, text: str | None) -> None:
    if chat.last_message_at is None or p_time >= chat.last_message_at:
        chat.last_message_at = p_time
        chat.last_message_preview = preview_for(msg_type, text)


def store_message(db: Session, account_id: int, p: ParsedMessage, bump_unread: bool) -> tuple[Chat, Message, bool]:
    """Idempotent on (account, wa_message_id). Returns (chat, message, created)."""
    chat = get_or_create_chat(db, account_id, p.jid, p.chat_name_hint)
    existing = db.query(Message).filter_by(account_id=account_id, wa_message_id=p.wa_id).first()
    if existing:
        db.commit()
        return chat, existing, False
    msg = Message(
        account_id=account_id,
        chat_id=chat.id,
        wa_message_id=p.wa_id,
        from_me=p.from_me,
        sender_name=p.sender_name,
        type=p.type,
        text=p.text,
        status=p.status,
        timestamp=p.timestamp,
    )
    db.add(msg)
    touch_chat(chat, p.timestamp, p.type, p.text)
    if bump_unread and not p.from_me:
        chat.unread_count = (chat.unread_count or 0) + 1
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        existing = db.query(Message).filter_by(account_id=account_id, wa_message_id=p.wa_id).first()
        chat = db.get(Chat, chat.id)
        return chat, existing, False
    db.refresh(msg)
    db.refresh(chat)
    return chat, msg, True
