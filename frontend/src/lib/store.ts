"use client";

import { create } from "zustand";
import type { Account, Chat, Contact, Message, MsgStatus } from "./api";

export interface Toast {
  id: number;
  kind: "message" | "info" | "error";
  title: string;
  body?: string;
  accountId?: number;
  chatId?: number;
}

interface State {
  accounts: Account[];
  accountsLoaded: boolean;
  activeAccountId: number | null;
  activeChatId: number | null;
  chats: Record<number, Chat[]>; // by account id, sorted newest first
  contacts: Record<number, Contact[]>; // by account id
  messages: Record<number, Message[]>; // by chat id, oldest first
  hasMore: Record<number, boolean>;
  qr: Record<number, string>; // latest QR per account id
  toasts: Toast[];
  muted: boolean;
  wsUp: boolean;

  setAccounts: (a: Account[]) => void;
  patchAccount: (id: number, patch: Partial<Account>) => void;
  removeAccount: (id: number) => void;
  setActive: (accountId: number | null, chatId: number | null) => void;
  setChats: (accountId: number, chats: Chat[]) => void;
  upsertChat: (chat: Chat) => void;
  setContacts: (accountId: number, c: Contact[]) => void;
  setMessages: (chatId: number, msgs: Message[], hasMore: boolean) => void;
  prependMessages: (chatId: number, msgs: Message[], hasMore: boolean) => void;
  upsertMessage: (msg: Message) => void;
  patchMessageStatus: (chatId: number, messageId: number, status: MsgStatus) => void;
  setQr: (accountId: number, qr: string) => void;
  pushToast: (t: Omit<Toast, "id">) => void;
  dismissToast: (id: number) => void;
  setMuted: (m: boolean) => void;
  setWsUp: (up: boolean) => void;
}

const STATUS_RANK: Record<MsgStatus, number> = { pending: 0, failed: 1, sent: 2, delivered: 3, read: 4 };

const byTimeThenId =(a: Message, b: Message) =>
  a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : a.id - b.id;

const sortChats = (list: Chat[]) =>
  [...list].sort((a, b) => {
    if (!a.last_message_at && !b.last_message_at) return b.id - a.id;
    if (!a.last_message_at) return 1;
    if (!b.last_message_at) return -1;
    return a.last_message_at < b.last_message_at ? 1 : a.last_message_at > b.last_message_at ? -1 : 0;
  });

let toastSeq = 1;

export const useStore = create<State>((set) => ({
  accounts: [],
  accountsLoaded: false,
  activeAccountId: null,
  activeChatId: null,
  chats: {},
  contacts: {},
  messages: {},
  hasMore: {},
  qr: {},
  toasts: [],
  muted: false,
  wsUp: false,

  setAccounts: (accounts) => set({ accounts, accountsLoaded: true }),
  patchAccount: (id, patch) =>
    set((s) => ({ accounts: s.accounts.map((a) => (a.id === id ? { ...a, ...patch } : a)) })),
  removeAccount: (id) => set((s) => ({ accounts: s.accounts.filter((a) => a.id !== id) })),
  setActive: (activeAccountId, activeChatId) => set({ activeAccountId, activeChatId }),

  setChats: (accountId, chats) => set((s) => ({ chats: { ...s.chats, [accountId]: sortChats(chats) } })),
  upsertChat: (chat) =>
    set((s) => {
      const list = s.chats[chat.account_id];
      if (!list) return s; // not loaded yet; will be fetched when the account is opened
      const next = list.some((c) => c.id === chat.id) ? list.map((c) => (c.id === chat.id ? chat : c)) : [...list, chat];
      return { chats: { ...s.chats, [chat.account_id]: sortChats(next) } };
    }),
  setContacts: (accountId, c) => set((s) => ({ contacts: { ...s.contacts, [accountId]: c } })),

  setMessages: (chatId, msgs, hasMore) =>
    set((s) => ({
      messages: { ...s.messages, [chatId]: msgs },
      hasMore: { ...s.hasMore, [chatId]: hasMore },
    })),
  prependMessages: (chatId, older, hasMore) =>
    set((s) => {
      const cur = s.messages[chatId] ?? [];
      const ids = new Set(cur.map((m) => m.id));
      return {
        messages: { ...s.messages, [chatId]: [...older.filter((m) => !ids.has(m.id)), ...cur] },
        hasMore: { ...s.hasMore, [chatId]: hasMore },
      };
    }),
  upsertMessage: (msg) =>
    set((s) => {
      const cur = s.messages[msg.chat_id];
      if (!cur) return s; // chat not opened yet; loaded from the DB when it is
      const same = (m: Message) => m.id === msg.id || (!!msg.client_id && m.client_id === msg.client_id);
      // A slow HTTP reply can carry an older snapshot than a WebSocket update that already landed: never downgrade.
      const prev = cur.find(same);
      const next = prev && STATUS_RANK[prev.status] > STATUS_RANK[msg.status] ? { ...msg, status: prev.status } : msg;
      const rest = cur.filter((m) => !same(m));
      return { messages: { ...s.messages, [msg.chat_id]: [...rest, next].sort(byTimeThenId) } };
    }),
  patchMessageStatus: (chatId, messageId, status) =>
    set((s) => {
      const cur = s.messages[chatId];
      if (!cur) return s;
      return { messages: { ...s.messages, [chatId]: cur.map((m) => (m.id === messageId ? { ...m, status } : m)) } };
    }),

  setQr: (accountId, qr) => set((s) => ({ qr: { ...s.qr, [accountId]: qr } })),

  pushToast: (t) =>
    set((s) => ({ toasts: [...s.toasts, { ...t, id: toastSeq++ }].slice(-3) })),
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  setMuted: (muted) => set({ muted }),
  setWsUp: (wsUp) => set({ wsUp }),
}));

export const totalUnread = (accounts: Account[]) => accounts.reduce((n, a) => n + (a.unread_total || 0), 0);
