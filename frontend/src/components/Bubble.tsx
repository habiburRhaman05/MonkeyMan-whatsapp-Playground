"use client";

import { useState } from "react";
import { getMedia, type Message } from "@/lib/api";
import { retry, reactMessage, forwardMsg, deleteMsg, toggleStar } from "@/lib/actions";
import { useStore } from "@/lib/store";
import { avatarColor, chatTitle, formatTime } from "@/lib/util";
import { REACTION_EMOJIS } from "./EmojiPicker";

const LABELS: Record<string, string> = {
  image: "Image",
  video: "Video",
  audio: "Voice message",
  document: "Document",
  sticker: "Sticker",
  other: "Unsupported message",
};

function Ticks({ status }: { status: Message["status"] }) {
  if (status === "pending") return <span className="text-muted" title="Sending">◷</span>;
  if (status === "sent") return <span className="text-muted" title="Sent">✓</span>;
  if (status === "delivered") return <span className="text-muted" title="Delivered">✓✓</span>;
  if (status === "read") return <span className="text-sky-500" title="Read">✓✓</span>;
  return <span className="text-danger font-bold" title="Failed">!</span>;
}

export function Media({ msg }: { msg: Message }) {
  const [url, setUrl] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const label = LABELS[msg.type] ?? "Media";

  async function load() {
    setState("loading");
    try {
      const r = await getMedia(msg.account_id, msg.id);
      setUrl(r.data_url);
      setState("idle");
    } catch {
      setState("error");
    }
  }

  if (url) {
    if (msg.type === "audio") return <audio controls autoPlay src={url} className="w-60 max-w-full" />;
    if (msg.type === "image" || msg.type === "sticker")
      return <img src={url} alt={label} className="rounded-lg max-h-72 max-w-full" />;
    if (msg.type === "video") return <video controls src={url} className="rounded-lg max-h-72 max-w-full" />;
    return (
      <a href={url} download={msg.media_filename || label} className="text-sky-600 underline text-sm">
        Download {msg.media_filename || label.toLowerCase()}
      </a>
    );
  }

  const canLoad = msg.id > 0 && !msg.wa_message_id.startsWith("pending-") && msg.type !== "other";
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="italic text-muted">[{label}]{msg.media_filename ? ` ${msg.media_filename}` : ""}</span>
      {canLoad && (
        <button onClick={load} disabled={state === "loading"} className="text-primary hover:underline disabled:opacity-60">
          {state === "loading" ? "Loading…" : state === "error" ? "Unavailable – retry" : msg.type === "audio" ? "▶ Play" : "Open"}
        </button>
      )}
    </div>
  );
}

function quotedSenderLabel(sender: string): string {
  if (!sender.includes("@")) return sender; // already a name, or "You"
  const digits = sender.split("@")[0].split(":")[0];
  return /^\d+$/.test(digits) ? `+${digits}` : "Unknown";
}

/** Scroll to the replied-to message if it is loaded, and flash it. */
function jumpToQuoted(msg: Message) {
  const target = useStore.getState().messages[msg.chat_id]?.find((m) => m.wa_message_id === msg.quoted?.message_id);
  const el = target ? document.getElementById(`msg-${target.id}`) : null;
  if (!el) {
    useStore.getState().pushToast({ kind: "info", title: "Original message is not loaded", body: "Scroll up to load older messages." });
    return;
  }
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.classList.add("bg-yellow-100/70");
  setTimeout(() => el.classList.remove("bg-yellow-100/70"), 1500);
}

function QuotedMessage({ msg }: { msg: Message }) {
  const quoted = msg.quoted;
  if (!quoted) return null;
  const typeLabel = quoted.type && quoted.type !== "text" ? `[${LABELS[quoted.type] || quoted.type}] ` : "";
  const sender = quoted.sender ? quotedSenderLabel(quoted.sender) : null;
  return (
    <button
      type="button"
      onClick={() => jumpToQuoted(msg)}
      className="block w-full text-left border-l-4 border-primary/60 bg-black/5 hover:bg-black/10 rounded-r px-2 py-1 mb-1 text-xs"
    >
      {sender && (
        <div className="font-semibold truncate" style={{ color: sender === "You" ? "var(--primary)" : avatarColor(sender) }}>
          {sender}
        </div>
      )}
      <div className="text-muted line-clamp-2 break-words">{typeLabel}{quoted.text || (quoted.type ? "" : "Message")}</div>
    </button>
  );
}

function ContextMenu({ msg, accountId, onClose }: { msg: Message; accountId: number; onClose: () => void }) {
  const chats = useStore((s) => (s.activeAccountId ? s.chats[s.activeAccountId] : []));
  const [showForward, setShowForward] = useState(false);
  const [showReactions, setShowReactions] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const sent = msg.status !== "pending" && msg.status !== "failed";
  const [canEdit] = useState(
    () => msg.from_me && msg.type === "text" && sent && Date.now() - new Date(msg.timestamp).getTime() < 14 * 60 * 1000,
  );

  if (showDelete) {
    return (
      <div className="absolute z-50 bg-white rounded-lg shadow-lg border border-border py-1 w-44" style={{ bottom: "100%", right: 0 }}>
        <div className="text-xs font-medium text-muted px-3 py-1">Delete message?</div>
        {msg.from_me && sent && (
          <button
            onClick={() => { deleteMsg(msg, "everyone"); onClose(); }}
            className="w-full text-left px-3 py-1.5 text-sm hover:bg-gray-50 text-danger"
          >
            Delete for everyone
          </button>
        )}
        <button
          onClick={() => { deleteMsg(msg, "me"); onClose(); }}
          className="w-full text-left px-3 py-1.5 text-sm hover:bg-gray-50"
        >
          Delete for me
        </button>
        <p className="px-3 pb-1 text-[11px] text-muted">&quot;For me&quot; hides it here only; it stays on your phone.</p>
      </div>
    );
  }

  if (showForward) {
    return (
      <div className="absolute z-50 bg-white rounded-lg shadow-lg border border-border p-2 w-52 max-h-48 overflow-y-auto" style={{ bottom: "100%", right: 0 }}>
        <div className="text-xs font-medium text-muted mb-1 px-1">Forward to:</div>
        {(chats || []).map((c) => (
          <button
            key={c.id}
            onClick={() => {
              forwardMsg(accountId, msg.id, c.id);
              onClose();
            }}
            className="w-full text-left px-2 py-1.5 text-sm hover:bg-gray-50 rounded truncate"
          >
            {chatTitle(c)}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="absolute z-50 bg-white rounded-lg shadow-lg border border-border py-1 w-36" style={{ bottom: "100%", right: 0 }}>
      <button
        onClick={() => {
          useStore.getState().setReplyTo({
            id: msg.id,
            wa_message_id: msg.wa_message_id,
            sender_name: msg.sender_name,
            from_me: msg.from_me,
            text: msg.text,
            type: msg.type,
          });
          onClose();
        }}
        className="w-full text-left px-3 py-1.5 text-sm hover:bg-gray-50"
      >
        Reply
      </button>
      {canEdit && (
        <button
          onClick={() => { useStore.getState().setEditing(msg); onClose(); }}
          className="w-full text-left px-3 py-1.5 text-sm hover:bg-gray-50"
        >
          Edit
        </button>
      )}
      <button
        onClick={() => { toggleStar(msg); onClose(); }}
        className="w-full text-left px-3 py-1.5 text-sm hover:bg-gray-50"
      >
        {msg.starred ? "Unstar" : "Star"}
      </button>
      <button
        onClick={() => setShowReactions(!showReactions)}
        className="w-full text-left px-3 py-1.5 text-sm hover:bg-gray-50"
      >
        React
      </button>
      {showReactions && (
        <div className="flex gap-1 px-2 pb-1">
          {REACTION_EMOJIS.map((e) => (
            <button
              key={e}
              onClick={() => {
                reactMessage(msg, e);
                onClose();
              }}
              className="text-lg hover:scale-125 transition-transform"
            >
              {e}
            </button>
          ))}
        </div>
      )}
      {msg.type === "text" && msg.text && (
        <button
          onClick={() => setShowForward(true)}
          className="w-full text-left px-3 py-1.5 text-sm hover:bg-gray-50"
        >
          Forward
        </button>
      )}
      <button
        onClick={() => {
          if (msg.text) navigator.clipboard?.writeText(msg.text);
          onClose();
        }}
        className="w-full text-left px-3 py-1.5 text-sm hover:bg-gray-50"
      >
        Copy
      </button>
      <button onClick={() => setShowDelete(true)} className="w-full text-left px-3 py-1.5 text-sm hover:bg-gray-50 text-danger">
        Delete
      </button>
    </div>
  );
}

export default function Bubble({ msg, isGroup, showName, accountId }: { msg: Message; isGroup: boolean; showName: boolean; accountId: number }) {
  const mine = msg.from_me;
  const [showMenu, setShowMenu] = useState(false);

  if (msg.deleted) {
    return (
      <div className={`flex ${mine ? "justify-end" : "justify-start"} px-3`}>
        <div className={`rounded-lg px-2.5 py-1.5 shadow-sm text-sm italic text-muted ${mine ? "bg-bubble-mine" : "bg-bubble-theirs"}`}>
          🚫 {mine ? "You deleted this message" : "This message was deleted"}
          <span className="ml-2 text-[11px] not-italic">{formatTime(msg.timestamp)}</span>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"} px-3 group relative`}>
      <div
        className={`max-w-[82%] md:max-w-[65%] rounded-lg px-2.5 py-1.5 shadow-sm relative ${
          mine ? "bg-bubble-mine rounded-tr-none" : "bg-bubble-theirs rounded-tl-none"
        }`}
      >
        {isGroup && !mine && showName && msg.sender_name && (
          <div className="text-xs font-semibold mb-0.5" style={{ color: avatarColor(msg.sender_name) }}>
            {msg.sender_name}
          </div>
        )}

        <QuotedMessage msg={msg} />

        {msg.type !== "text" && <Media msg={msg} />}
        {msg.text && !(msg.type === "document" && msg.text === msg.media_filename) && (
          <div className="whitespace-pre-wrap break-words text-[15px]">{msg.text}</div>
        )}

        <div className="flex items-center justify-end gap-1.5 mt-0.5 text-[11px] text-muted">
          {msg.status === "failed" && mine && (
            <>
              {msg.type === "text" && msg.id > 0 ? (
                <button
                  onClick={() => retry(msg.account_id, msg.id, msg.chat_id)}
                  className="text-danger font-medium hover:underline"
                >
                  Retry
                </button>
              ) : (
                <span className="text-danger">Not sent</span>
              )}
            </>
          )}
          {msg.starred && <span className="text-yellow-500" title="Starred">★</span>}
          {msg.edited && <span className="italic">edited</span>}
          <span>{formatTime(msg.timestamp)}</span>
          {mine && <Ticks status={msg.status} />}
        </div>

        {!!msg.reactions?.length && (
          <div className={`flex flex-wrap gap-1 mt-1 ${mine ? "justify-end" : ""}`}>
            {msg.reactions.map((r) => (
              <button
                key={r.emoji}
                onClick={() => reactMessage(msg, r.emoji)}
                title={r.mine ? "Click to remove your reaction" : "React with this"}
                className={`text-xs px-1.5 py-0.5 rounded-full border ${r.mine ? "bg-primary/10 border-primary/40" : "bg-white border-border"}`}
              >
                {r.emoji}
                {r.count > 1 ? ` ${r.count}` : ""}
              </button>
            ))}
          </div>
        )}

        {/* Context menu trigger */}
        {msg.id > 0 && !msg.wa_message_id.startsWith("pending-") && (
          <button
            onClick={() => setShowMenu(!showMenu)}
            className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-black/5 transition-opacity"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" className="text-muted">
              <circle cx="12" cy="5" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="12" cy="19" r="1.5" />
            </svg>
          </button>
        )}
        {showMenu && <ContextMenu msg={msg} accountId={accountId} onClose={() => setShowMenu(false)} />}
      </div>
    </div>
  );
}
