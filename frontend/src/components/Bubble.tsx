"use client";

import { useState } from "react";
import { getMedia, type Message } from "@/lib/api";
import { retry } from "@/lib/actions";
import { avatarColor, formatTime } from "@/lib/util";

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

/** Loads media from Evolution only when asked (keeps the list fast, avoids bulk downloads). */
function Media({ msg }: { msg: Message }) {
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
      <a href={url} download className="text-sky-600 underline text-sm">
        Download {label.toLowerCase()}
      </a>
    );
  }

  // Optimistic/pending rows have no server id yet
  const canLoad = msg.id > 0 && !msg.wa_message_id.startsWith("pending-") && msg.type !== "other";
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="italic text-muted">[{label}]</span>
      {canLoad && (
        <button
          onClick={load}
          disabled={state === "loading"}
          className="text-primary hover:underline disabled:opacity-60"
        >
          {state === "loading" ? "Loading…" : state === "error" ? "Unavailable – retry" : msg.type === "audio" ? "▶ Play" : "Open"}
        </button>
      )}
    </div>
  );
}

export default function Bubble({ msg, isGroup, showName }: { msg: Message; isGroup: boolean; showName: boolean }) {
  const mine = msg.from_me;
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"} px-3`}>
      <div
        className={`max-w-[82%] md:max-w-[65%] rounded-lg px-2.5 py-1.5 shadow-sm ${
          mine ? "bg-bubble-mine rounded-tr-none" : "bg-bubble-theirs rounded-tl-none"
        }`}
      >
        {isGroup && !mine && showName && msg.sender_name && (
          <div className="text-xs font-semibold mb-0.5" style={{ color: avatarColor(msg.sender_name) }}>
            {msg.sender_name}
          </div>
        )}

        {msg.type !== "text" && <Media msg={msg} />}
        {msg.text && <div className="whitespace-pre-wrap break-words text-[15px]">{msg.text}</div>}

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
          <span>{formatTime(msg.timestamp)}</span>
          {mine && <Ticks status={msg.status} />}
        </div>
      </div>
    </div>
  );
}
