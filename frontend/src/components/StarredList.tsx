"use client";

import { useEffect, useState } from "react";
import { listStarred, type Chat, type Message } from "@/lib/api";
import { openChat } from "@/lib/actions";
import { useStore } from "@/lib/store";
import { chatTitle, formatListTime } from "@/lib/util";

type Item = { message: Message; chat: Chat };

/** Scroll to a message once its chat has loaded; it may be older than the loaded page. */
function jumpWhenReady(messageId: number) {
  setTimeout(() => {
    const el = document.getElementById(`msg-${messageId}`);
    if (!el) {
      useStore.getState().pushToast({ kind: "info", title: "Message is older than what is loaded", body: "Scroll up in the chat to find it." });
      return;
    }
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("bg-yellow-100/70");
    setTimeout(() => el.classList.remove("bg-yellow-100/70"), 1500);
  }, 150);
}

export default function StarredList({ accountId }: { accountId: number }) {
  const [items, setItems] = useState<Item[] | null>(null);
  // Re-fetch when a message is (un)starred while this tab is open
  const version = useStore((s) => Object.values(s.messages).reduce((n, list) => n + list.filter((m) => m.starred).length, 0));

  useEffect(() => {
    let alive = true;
    listStarred(accountId)
      .then((r) => alive && setItems(r))
      .catch(() => alive && setItems([]));
    return () => {
      alive = false;
    };
  }, [accountId, version]);

  if (items === null) return <p className="p-6 text-center text-muted text-sm animate-pulse">Loading…</p>;
  if (items.length === 0) {
    return <p className="p-6 text-center text-muted text-sm">No starred messages. Open a message&apos;s menu and choose Star.</p>;
  }
  return (
    <>
      {items.map(({ message, chat }) => (
        <button
          key={message.id}
          onClick={async () => {
            await openChat(accountId, chat.id);
            jumpWhenReady(message.id);
          }}
          className="w-full text-left px-3 py-2.5 border-b border-border/60 hover:bg-background"
        >
          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate font-medium text-sm">
              {chatTitle(chat)}
              {message.from_me ? " · You" : message.sender_name ? ` · ${message.sender_name}` : ""}
            </span>
            <span className="text-xs text-muted shrink-0">{formatListTime(message.timestamp)}</span>
          </div>
          <div className="truncate text-sm text-muted">
            <span className="text-yellow-500">★</span> {message.text || `[${message.type}]`}
          </div>
        </button>
      ))}
    </>
  );
}
