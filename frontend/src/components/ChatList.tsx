"use client";

import { useMemo, useState, useCallback } from "react";
import { useStore } from "@/lib/store";
import { openChat, openChatWith, runSync } from "@/lib/actions";
import { avatarColor, chatTitle, contactTitle, formatListTime, phoneFromJid } from "@/lib/util";
import { Badge } from "./TopBar";
import NewChatDialog from "./NewChatDialog";

export function Avatar({ name, size = 44 }: { name: string; size?: number }) {
  const initial = (name.replace(/^\+/, "").trim()[0] || "?").toUpperCase();
  return (
    <div
      className="rounded-full flex items-center justify-center text-white font-semibold shrink-0"
      style={{ width: size, height: size, background: avatarColor(name), fontSize: size * 0.42 }}
    >
      {initial}
    </div>
  );
}

export function ProfileAvatar({ name, url, size = 44 }: { name: string; url?: string | null; size?: number }) {
  const [failed, setFailed] = useState(false);
  const onError = useCallback(() => setFailed(true), []);

  if (url && !failed) {
    return (
      <img
        src={url}
        alt={name}
        className="rounded-full object-cover shrink-0"
        style={{ width: size, height: size }}
        onError={onError}
      />
    );
  }
  return <Avatar name={name} size={size} />;
}

export default function ChatList() {
  const accountId = useStore((s) => s.activeAccountId);
  const account = useStore((s) => s.accounts.find((a) => a.id === s.activeAccountId));
  const chats = useStore((s) => (s.activeAccountId ? s.chats[s.activeAccountId] : undefined));
  const contacts = useStore((s) => (s.activeAccountId ? s.contacts[s.activeAccountId] : undefined));
  const activeChatId = useStore((s) => s.activeChatId);

  const [tab, setTab] = useState<"chats" | "contacts">("chats");
  const [query, setQuery] = useState("");
  const [showNew, setShowNew] = useState(false);

  const q = query.trim().toLowerCase();
  const filteredChats = useMemo(
    () => (chats ?? []).filter((c) => !q || chatTitle(c).toLowerCase().includes(q) || c.jid.includes(q)),
    [chats, q],
  );
  const filteredContacts = useMemo(
    () => (contacts ?? []).filter((c) => !q || contactTitle(c).toLowerCase().includes(q) || c.jid.includes(q)),
    [contacts, q],
  );

  if (!accountId || !account) {
    return <div className="flex-1 flex items-center justify-center text-muted p-6 text-center">Select a number above.</div>;
  }

  const tabBtn = (id: "chats" | "contacts", label: string, count?: number) => (
    <button
      onClick={() => setTab(id)}
      className={`flex-1 py-2.5 text-sm font-medium border-b-2 transition-colors ${
        tab === id ? "border-primary text-primary" : "border-transparent text-muted hover:text-foreground"
      }`}
    >
      {label}
      {count ? <span className="ml-1.5 text-xs opacity-70">{count}</span> : null}
    </button>
  );

  return (
    <div className="flex flex-col h-full min-h-0 bg-sidebar-bg">
      <div className="px-3 pt-3 pb-2 flex items-center gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={tab === "chats" ? "Filter chats" : "Filter contacts"}
          className="flex-1 min-w-0 px-3 py-2 text-sm rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary"
        />
        <button
          onClick={() => runSync(account.id)}
          disabled={account.status !== "connected"}
          title="Sync chats and contacts from WhatsApp"
          className="p-2 rounded-lg hover:bg-background disabled:opacity-40 text-muted"
        >
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 12a9 9 0 11-3-6.7M21 4v5h-5" />
          </svg>
        </button>
        <button
          onClick={() => setShowNew(true)}
          disabled={account.status !== "connected"}
          title="New chat"
          className="p-2 rounded-lg bg-primary text-white hover:bg-primary-dark disabled:opacity-40"
        >
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      </div>

      <div className="flex border-b border-border">
        {tabBtn("chats", "Chats", chats?.length)}
        {tabBtn("contacts", "Contacts", contacts?.length)}
      </div>

      {account.status !== "connected" && (
        <div className="px-3 py-2 text-xs bg-warning/10 text-yellow-800 border-b border-warning/30">
          {account.label} is {account.status}. Showing saved history only.
        </div>
      )}

      <div className="flex-1 overflow-y-auto min-h-0">
        {tab === "chats" ? (
          chats === undefined ? (
            <p className="p-6 text-center text-muted text-sm animate-pulse">Loading chats…</p>
          ) : filteredChats.length === 0 ? (
            <p className="p-6 text-center text-muted text-sm">
              {q ? "No matching chats." : "No chats yet. Press sync, or start a new chat."}
            </p>
          ) : (
            filteredChats.map((c) => (
              <button
                key={c.id}
                onClick={() => openChat(account.id, c.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 text-left border-b border-border/60 hover:bg-background ${
                  c.id === activeChatId ? "bg-background" : ""
                }`}
              >
                <ProfileAvatar name={chatTitle(c)} url={c.profile_pic_url} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className={`truncate ${c.unread_count ? "font-semibold" : "font-medium"}`}>{chatTitle(c)}</span>
                    <span className={`text-xs shrink-0 ${c.unread_count ? "text-primary font-medium" : "text-muted"}`}>
                      {formatListTime(c.last_message_at)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className={`truncate text-sm ${c.unread_count ? "text-foreground" : "text-muted"}`}>
                      {c.last_message_preview || "No messages"}
                    </span>
                    <Badge n={c.unread_count} className="bg-primary text-white shrink-0" />
                  </div>
                </div>
              </button>
            ))
          )
        ) : contacts === undefined ? (
          <p className="p-6 text-center text-muted text-sm animate-pulse">Loading contacts…</p>
        ) : filteredContacts.length === 0 ? (
          <p className="p-6 text-center text-muted text-sm">
            {q ? "No matching contacts." : "No contacts yet. Press sync once the number is connected."}
          </p>
        ) : (
          filteredContacts.map((c) => (
            <button
              key={c.id}
              onClick={() => {
                setTab("chats");
                openChatWith(account.id, c.jid);
              }}
              className="w-full flex items-center gap-3 px-3 py-2.5 text-left border-b border-border/60 hover:bg-background"
            >
              <ProfileAvatar name={contactTitle(c)} url={c.profile_pic_url} size={40} />
              <div className="min-w-0">
                <div className="truncate font-medium">{contactTitle(c)}</div>
                <div className="truncate text-xs text-muted">
                  {c.is_group ? "Group" : "+" + phoneFromJid(c.jid)}
                </div>
              </div>
            </button>
          ))
        )}
      </div>

      {showNew && <NewChatDialog accountId={account.id} onClose={() => setShowNew(false)} />}
    </div>
  );
}
