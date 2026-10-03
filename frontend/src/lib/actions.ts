"use client";

import * as api from "./api";
import { useStore } from "./store";

const st = () => useStore.getState();
const errText = (e: unknown) => (e instanceof api.ApiError ? e.detail : "Something went wrong");

export function syncUrl() {
  try {
    const { activeAccountId: a, activeChatId: c } = st();
    const q = a ? `?account=${a}${c ? `&chat=${c}` : ""}` : "";
    window.history.replaceState(null, "", `/${q}`);
  } catch {}
}

export async function refreshAccounts() {
  try {
    st().setAccounts(await api.listAccounts());
  } catch (e) {
    if (!st().accountsLoaded) st().setAccounts([]);
    st().pushToast({ kind: "error", title: "Cannot load numbers", body: errText(e) });
  }
}

export async function loadChats(accountId: number) {
  try {
    st().setChats(accountId, await api.listChats(accountId));
  } catch (e) {
    st().pushToast({ kind: "error", title: "Cannot load chats", body: errText(e) });
  }
}

export async function loadContacts(accountId: number) {
  try {
    st().setContacts(accountId, await api.listContacts(accountId));
  } catch {}
}

export async function loadMessages(accountId: number, chatId: number) {
  try {
    const r = await api.listMessages(accountId, chatId);
    st().setMessages(chatId, r.messages, r.has_more);
  } catch (e) {
    st().pushToast({ kind: "error", title: "Cannot load messages", body: errText(e) });
  }
}

export async function loadOlder(accountId: number, chatId: number) {
  const cur = st().messages[chatId];
  if (!cur?.length) return;
  try {
    const r = await api.listMessages(accountId, chatId, cur[0].id);
    st().prependMessages(chatId, r.messages, r.has_more);
  } catch {}
}

/** Mark a chat read: local first (instant badge), then the server. */
export function markChatRead(accountId: number, chatId: number) {
  const chat = st().chats[accountId]?.find((c) => c.id === chatId);
  if (chat && chat.unread_count > 0) {
    st().upsertChat({ ...chat, unread_count: 0 });
    const acc = st().accounts.find((a) => a.id === accountId);
    if (acc) st().patchAccount(accountId, { unread_total: Math.max(0, acc.unread_total - chat.unread_count) });
  }
  api.markRead(accountId, chatId).catch(() => {});
}

export async function switchAccount(accountId: number) {
  st().setActive(accountId, null);
  syncUrl();
  await Promise.all([loadChats(accountId), loadContacts(accountId)]);
}

export async function openChat(accountId: number, chatId: number) {
  if (st().activeAccountId !== accountId) {
    st().setActive(accountId, chatId);
    await Promise.all([loadChats(accountId), loadContacts(accountId)]);
  }
  st().setActive(accountId, chatId);
  syncUrl();
  await loadMessages(accountId, chatId);
  markChatRead(accountId, chatId);
}

export function closeChat() {
  st().setActive(st().activeAccountId, null);
  syncUrl();
}

/** Get-or-create a chat for a phone number / jid and open it. Returns the chat id. */
export async function openChatWith(accountId: number, to: string): Promise<number | null> {
  try {
    const chat = await api.openChat(accountId, to);
    if (!st().chats[accountId]) await loadChats(accountId);
    st().upsertChat(chat);
    await openChat(accountId, chat.id);
    return chat.id;
  } catch (e) {
    st().pushToast({ kind: "error", title: "Cannot open chat", body: errText(e) });
    return null;
  }
}

export async function runSync(accountId: number) {
  try {
    await api.syncAccount(accountId);
    st().pushToast({ kind: "info", title: "Syncing chats…" });
  } catch (e) {
    st().pushToast({ kind: "error", title: "Sync failed", body: errText(e) });
  }
}

/** Instant local bubble (negative id). The server message with the same client_id replaces it. */
function optimistic(accountId: number, chatId: number, type: api.MsgType, text: string | null, clientId: string) {
  const temp: api.Message = {
    id: -Date.now(),
    account_id: accountId,
    chat_id: chatId,
    wa_message_id: `temp-${clientId}`,
    client_id: clientId,
    from_me: true,
    sender_name: null,
    type,
    text,
    status: "pending",
    timestamp: new Date().toISOString(),
  };
  st().upsertMessage(temp);
  return temp;
}

export async function sendTextMessage(accountId: number, chatId: number, text: string, clientId: string, quotedWaId?: string) {
  const temp = optimistic(accountId, chatId, "text", text, clientId);
  try {
    const r = await api.sendText(accountId, { chat_id: chatId }, text, clientId, quotedWaId);
    st().upsertMessage(r.message);
    st().upsertChat(r.chat);
  } catch (e) {
    st().patchMessageStatus(chatId, temp.id, "failed");
    st().pushToast({ kind: "error", title: "Send failed", body: errText(e) });
  }
}

export async function sendVoiceMessage(accountId: number, chatId: number, base64: string, clientId: string) {
  const temp = optimistic(accountId, chatId, "audio", null, clientId);
  try {
    const r = await api.sendVoice(accountId, { chat_id: chatId }, base64, clientId);
    st().upsertMessage(r.message);
    st().upsertChat(r.chat);
  } catch (e) {
    st().patchMessageStatus(chatId, temp.id, "failed");
    st().pushToast({ kind: "error", title: "Voice message failed", body: errText(e) });
  }
}

export async function retry(accountId: number, messageId: number, chatId: number) {
  try {
    await api.retryMessage(accountId, messageId);
    st().patchMessageStatus(chatId, messageId, "pending");
  } catch (e) {
    st().pushToast({ kind: "error", title: "Retry failed", body: errText(e) });
  }
}

export async function sendMediaMessage(
  accountId: number,
  chatId: number,
  file: File,
  caption: string,
  clientId: string,
) {
  const mediaType: "image" | "video" | "document" = file.type.startsWith("image/")
    ? "image"
    : file.type.startsWith("video/")
      ? "video"
      : "document";
  const temp = optimistic(accountId, chatId, mediaType, caption || `[${mediaType}]`, clientId);
  try {
    const b64 = await fileToBase64(file);
    const r = await api.sendMedia(accountId, { chat_id: chatId }, b64, mediaType, file.type, clientId, file.name, caption || undefined);
    st().upsertMessage(r.message);
    st().upsertChat(r.chat);
  } catch (e) {
    st().patchMessageStatus(chatId, temp.id, "failed");
    st().pushToast({ kind: "error", title: "Send failed", body: errText(e) });
  }
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = String(reader.result);
      resolve(result.split(",", 2)[1] ?? "");
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/** Pass the same emoji you already reacted with to remove it (like WhatsApp). */
export async function reactMessage(msg: api.Message, emoji: string) {
  const mine = msg.reactions?.find((r) => r.mine)?.emoji;
  try {
    const r = await api.reactToMessage(msg.account_id, msg.id, mine === emoji ? "" : emoji);
    st().upsertMessage(r.message);
  } catch (e) {
    st().pushToast({ kind: "error", title: "Reaction failed", body: errText(e) });
  }
}

export async function deleteMsg(msg: api.Message, scope: "me" | "everyone") {
  try {
    const r = await api.deleteMessage(msg.account_id, msg.id, scope);
    if (scope === "me") st().removeMessage(msg.chat_id, msg.id);
    else if (r.message) st().upsertMessage(r.message);
  } catch (e) {
    st().pushToast({ kind: "error", title: "Delete failed", body: errText(e) });
  }
}

export async function forwardMsg(accountId: number, messageId: number, toChatId: number) {
  try {
    const r = await api.forwardMessage(accountId, messageId, { to_chat_id: toChatId });
    st().upsertMessage(r.message);
    st().upsertChat(r.chat);
    st().pushToast({ kind: "info", title: "Message forwarded" });
  } catch (e) {
    st().pushToast({ kind: "error", title: "Forward failed", body: errText(e) });
  }
}

export async function searchInChat(accountId: number, chatId: number, q: string) {
  try {
    const r = await api.searchMessages(accountId, chatId, q);
    return r.messages;
  } catch (e) {
    st().pushToast({ kind: "error", title: "Search failed", body: errText(e) });
    return [];
  }
}

let typingTimer: ReturnType<typeof setTimeout> | null = null;
export function emitTyping(accountId: number, chatId: number) {
  if (typingTimer) return;
  api.sendTyping(accountId, chatId).catch(() => {});
  typingTimer = setTimeout(() => { typingTimer = null; }, 5000);
}
