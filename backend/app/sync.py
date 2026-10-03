"""Import existing chats, contacts and recent messages from Evolution into SQLite."""

import logging

from app import evolution
from app.db import SessionLocal
from app.models import Account, Chat, Contact
from app.normalize import STATUS_RANK, map_status, parse_message, parse_ts, phone_from_jid, skip_jid
from app.serializers import unread_total
from app.services import get_or_create_chat, store_message, touch_chat
from app.ws import manager

logger = logging.getLogger(__name__)
_running: set[int] = set()


def _best_status(record: dict) -> str | None:
    updates = record.get("MessageUpdate")
    if not isinstance(updates, list):
        return None
    ranked = [u.get("status") for u in updates if isinstance(u, dict) and u.get("status")]
    if not ranked:
        return None
    return max(ranked, key=lambda s: STATUS_RANK.get(map_status(s, True), 1))


async def sync_account(account_id: int, chat_limit: int = 30, msg_limit: int = 30) -> None:
    if account_id in _running:
        return
    _running.add(account_id)
    db = SessionLocal()
    try:
        acc = db.get(Account, account_id)
        if not acc:
            return
        name = acc.instance_name

        # 1. Chats
        raw_chats = await evolution.find_chats(name)
        jids: list[str] = []
        for raw in raw_chats:
            jid = raw.get("remoteJid")
            if skip_jid(jid):
                continue
            last = raw.get("lastMessage") if isinstance(raw.get("lastMessage"), dict) else None
            last_from_me = bool(((last or {}).get("key") or {}).get("fromMe"))
            is_group = jid.endswith("@g.us")
            push = raw.get("pushName") if isinstance(raw.get("pushName"), str) else None
            chat_name_field = raw.get("name") if isinstance(raw.get("name"), str) else None
            chat_name = chat_name_field or (push if (is_group or raw.get("id") or not last_from_me) else None)
            pic = raw.get("profilePicUrl") if isinstance(raw.get("profilePicUrl"), str) else None
            is_new = db.query(Chat).filter_by(account_id=account_id, jid=jid).first() is None
            chat = get_or_create_chat(db, account_id, jid, chat_name)
            if pic and not chat.profile_pic_url:
                chat.profile_pic_url = pic
            if is_new and isinstance(raw.get("unreadCount"), int):
                chat.unread_count = max(raw["unreadCount"], 0)
            if last:
                p = parse_message(last)
                if p:
                    touch_chat(chat, p.timestamp, p.type, p.text)
            elif raw.get("updatedAt") and chat.last_message_at is None:
                chat.last_message_at = parse_ts(None)
            db.commit()
            jids.append(jid)

        # 2. Recent messages for the most recently active chats
        recent = (
            db.query(Chat)
            .filter(Chat.account_id == account_id)
            .order_by(Chat.last_message_at.desc())
            .limit(chat_limit)
            .all()
        )
        for chat in recent:
            try:
                records = await evolution.find_messages(name, chat.jid, msg_limit)
            except evolution.EvolutionError as exc:
                logger.warning("findMessages failed for chat %s: %s", chat.id, exc.status_code)
                continue
            for rec in records:
                if not isinstance(rec, dict):
                    continue
                best = _best_status(rec)
                if best and "status" not in rec:
                    rec = {**rec, "status": best}
                p = parse_message(rec)
                if p:
                    store_message(db, account_id, p, bump_unread=False)

        # 3. Contacts
        contacts = await evolution.find_contacts(name)
        known = {c.jid: c for c in db.query(Contact).filter_by(account_id=account_id).all()}
        for raw in contacts:
            jid = raw.get("remoteJid")
            if skip_jid(jid):
                continue
            push = raw.get("pushName") if isinstance(raw.get("pushName"), str) else None
            pic = raw.get("profilePicUrl") if isinstance(raw.get("profilePicUrl"), str) else None
            existing = known.get(jid)
            if existing:
                if push and existing.name != push:
                    existing.name = push
                if pic:
                    existing.profile_pic_url = pic
            else:
                db.add(Contact(account_id=account_id, jid=jid, name=push, profile_pic_url=pic, is_group=jid.endswith("@g.us")))
        db.commit()

        # 4. Fill chat names and profile pics from contacts
        # Build maps by JID and by phone number (handles @lid mismatch)
        contact_by_jid: dict[str, Contact] = {}
        contact_by_phone: dict[str, Contact] = {}
        for c in db.query(Contact).filter_by(account_id=account_id).all():
            contact_by_jid[c.jid] = c
            phone = phone_from_jid(c.jid)
            if phone and not c.jid.endswith("@g.us"):
                contact_by_phone[phone] = c

        for chat in db.query(Chat).filter(Chat.account_id == account_id).all():
            contact = contact_by_jid.get(chat.jid)
            if not contact:
                phone = phone_from_jid(chat.jid)
                if phone:
                    contact = contact_by_phone.get(phone)
            if contact:
                if not chat.name and contact.name:
                    chat.name = contact.name
                if not chat.profile_pic_url and contact.profile_pic_url:
                    chat.profile_pic_url = contact.profile_pic_url
        db.commit()

        await manager.broadcast(
            "sync.done", {"account_id": account_id, "data": {"unread_total": unread_total(db, account_id)}}
        )
    except Exception:
        logger.exception("Sync failed for account %s", account_id)
        await manager.broadcast("sync.done", {"account_id": account_id, "data": {"error": True}})
    finally:
        _running.discard(account_id)
        db.close()
