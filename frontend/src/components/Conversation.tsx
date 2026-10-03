"use client";

import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { closeChat, loadOlder, markChatRead } from "@/lib/actions";
import { chatTitle, formatDay, phoneFromJid } from "@/lib/util";
import Bubble from "./Bubble";
import Composer from "./Composer";
import { Avatar } from "./ChatList";

export default function Conversation() {
  const accountId = useStore((s) => s.activeAccountId);
  const chatId = useStore((s) => s.activeChatId);
  const account = useStore((s) => s.accounts.find((a) => a.id === s.activeAccountId));
  const chat = useStore((s) => (s.activeAccountId && s.activeChatId ? s.chats[s.activeAccountId]?.find((c) => c.id === s.activeChatId) : undefined));
  const msgs = useStore((s) => (s.activeChatId ? s.messages[s.activeChatId] : undefined));
  const hasMore = useStore((s) => (s.activeChatId ? s.hasMore[s.activeChatId] : false));

  const boxRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const loadingOlderRef = useRef(false);
  const prevRef = useRef<{ chatId: number | null; firstId: number | null; lastId: number | null; height: number }>({
    chatId: null,
    firstId: null,
    lastId: null,
    height: 0,
  });
  const [, force] = useState(0);

  // Scroll: bottom on open / new message (if already near bottom), keep position when older messages load.
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el || !msgs) return;
    const first = msgs[0]?.id ?? null;
    const last = msgs[msgs.length - 1]?.id ?? null;
    const prev = prevRef.current;
    if (prev.chatId !== chatId) {
      el.scrollTop = el.scrollHeight;
      stickRef.current = true;
    } else if (first !== prev.firstId && last === prev.lastId) {
      el.scrollTop = el.scrollHeight - prev.height + el.scrollTop;
    } else if (last !== prev.lastId) {
      const mine = msgs[msgs.length - 1]?.from_me;
      if (stickRef.current || mine) el.scrollTop = el.scrollHeight;
    }
    prevRef.current = { chatId, firstId: first, lastId: last, height: el.scrollHeight };
  }, [msgs, chatId]);

  // Mark read again when the user comes back to the tab with this chat open
  useEffect(() => {
    if (!accountId || !chatId) return;
    const onFocus = () => {
      if (document.visibilityState === "visible") markChatRead(accountId, chatId);
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [accountId, chatId]);

  if (!accountId || !chatId || !account) {
    return (
      <div className="flex-1 hidden md:flex flex-col items-center justify-center text-muted bg-background gap-2">
        <div className="text-5xl">💬</div>
        <p>Select a chat to start messaging</p>
      </div>
    );
  }

  const title = chat ? chatTitle(chat) : "Chat";

  async function onScroll() {
    const el = boxRef.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (el.scrollTop < 100 && hasMore && !loadingOlderRef.current && accountId && chatId) {
      loadingOlderRef.current = true;
      force((n) => n + 1);
      await loadOlder(accountId, chatId);
      loadingOlderRef.current = false;
      force((n) => n + 1);
    }
  }

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0 bg-[#efeae2]">
      <div className="flex items-center gap-3 px-3 py-2 bg-sidebar-bg border-b border-border shrink-0">
        <button onClick={closeChat} className="md:hidden p-2 -ml-1 rounded-full hover:bg-background" aria-label="Back">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <Avatar name={title} size={40} />
        <div className="min-w-0">
          <div className="font-semibold truncate">{title}</div>
          <div className="text-xs text-muted truncate">
            {chat?.is_group ? "Group" : chat ? "+" + phoneFromJid(chat.jid) : ""} · {account.label}
          </div>
        </div>
      </div>

      <div ref={boxRef} onScroll={onScroll} className="flex-1 overflow-y-auto min-h-0 py-3" style={{ overflowAnchor: "none" }}>
        {msgs === undefined ? (
          <p className="text-center text-muted text-sm animate-pulse py-8">Loading messages…</p>
        ) : (
          <>
            {hasMore && <p className="text-center text-muted text-xs py-2">Loading older messages…</p>}
            {msgs.length === 0 && <p className="text-center text-muted text-sm py-8">No messages yet. Say hello!</p>}
            {msgs.map((m, i) => {
              const prev = msgs[i - 1];
              const newDay = !prev || new Date(prev.timestamp).toDateString() !== new Date(m.timestamp).toDateString();
              const showName = !prev || prev.from_me || prev.sender_name !== m.sender_name || newDay;
              return (
                <Fragment key={m.client_id ?? m.id}>
                  {newDay && (
                    <div className="flex justify-center my-2">
                      <span className="text-xs bg-white/90 text-muted px-3 py-1 rounded-lg shadow-sm">{formatDay(m.timestamp)}</span>
                    </div>
                  )}
                  <div className={showName ? "mt-2" : "mt-0.5"}>
                    <Bubble msg={m} isGroup={!!chat?.is_group} showName={showName} />
                  </div>
                </Fragment>
              );
            })}
          </>
        )}
      </div>

      <Composer accountId={accountId} chatId={chatId} disabled={account.status !== "connected"} />
    </div>
  );
}
