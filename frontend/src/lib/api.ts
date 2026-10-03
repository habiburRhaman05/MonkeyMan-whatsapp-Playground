/** API client — all backend requests go through here. */

export const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export class ApiError extends Error {
  constructor(
    public status: number,
    public detail: string,
  ) {
    super(detail);
  }
}

async function request<T = unknown>(path: string, opts: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      headers: { "Content-Type": "application/json", ...opts.headers },
      ...opts,
    });
  } catch {
    throw new ApiError(0, "Cannot reach the backend. Is it running on port 8000?");
  }
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail ?? body);
    } catch {}
    throw new ApiError(res.status, detail);
  }
  return res.json();
}

const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });

// ── Types ─────────────────────────────────────────
export type MsgStatus = "pending" | "sent" | "delivered" | "read" | "failed";
export type MsgType = "text" | "image" | "video" | "audio" | "document" | "sticker" | "other";

export interface Account {
  id: number;
  label: string;
  instance_name: string;
  phone_number: string | null;
  status: "connecting" | "connected" | "disconnected";
  created_at: string;
  unread_total: number;
}

export interface Chat {
  id: number;
  account_id: number;
  jid: string;
  name: string | null;
  is_group: boolean;
  last_message_at: string | null;
  last_message_preview: string | null;
  unread_count: number;
}

export interface Message {
  id: number;
  account_id: number;
  chat_id: number;
  wa_message_id: string;
  client_id: string | null;
  from_me: boolean;
  sender_name: string | null;
  type: MsgType;
  text: string | null;
  status: MsgStatus;
  timestamp: string;
}

export interface Contact {
  id: number;
  account_id: number;
  jid: string;
  name: string | null;
  is_group: boolean;
}

export interface QRResponse {
  status: string;
  qr_base64: string | null;
}

// ── Accounts ──────────────────────────────────────
export const listAccounts = () => request<Account[]>("/accounts");
export const createAccount = (label: string) => post<Account>("/accounts", { label });
export const getQR = (id: number) => request<QRResponse>(`/accounts/${id}/qr`);
export const disconnectAccount = (id: number) => post(`/accounts/${id}/disconnect`);
export const deleteAccount = (id: number) => request(`/accounts/${id}`, { method: "DELETE" });
export const syncAccount = (id: number) => post(`/accounts/${id}/sync`);

// ── Chats / messages ──────────────────────────────
export const listChats = (accountId: number) => request<Chat[]>(`/accounts/${accountId}/chats`);
export const listContacts = (accountId: number) => request<Contact[]>(`/accounts/${accountId}/contacts`);
export const openChat = (accountId: number, to: string) => post<Chat>(`/accounts/${accountId}/chats`, { to });

export const listMessages = (accountId: number, chatId: number, before?: number) =>
  request<{ messages: Message[]; has_more: boolean }>(
    `/accounts/${accountId}/chats/${chatId}/messages?limit=50${before ? `&before=${before}` : ""}`,
  );

export const markRead = (accountId: number, chatId: number) =>
  post(`/accounts/${accountId}/chats/${chatId}/read`);

export const sendText = (
  accountId: number,
  target: { chat_id?: number; to?: string },
  text: string,
  clientId: string,
) => post<{ message: Message; chat: Chat }>(`/accounts/${accountId}/send`, { ...target, text, client_id: clientId });

export const sendVoice = (
  accountId: number,
  target: { chat_id?: number; to?: string },
  audioBase64: string,
  clientId: string,
) =>
  post<{ message: Message; chat: Chat }>(`/accounts/${accountId}/send-voice`, {
    ...target,
    audio_base64: audioBase64,
    client_id: clientId,
  });

export const retryMessage = (accountId: number, messageId: number) =>
  post<{ message: Message }>(`/accounts/${accountId}/messages/${messageId}/retry`);

export const getMedia = (accountId: number, messageId: number) =>
  request<{ data_url: string }>(`/accounts/${accountId}/messages/${messageId}/media`);
