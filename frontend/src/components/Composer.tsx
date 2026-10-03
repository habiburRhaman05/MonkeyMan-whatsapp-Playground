"use client";

import { useEffect, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { sendTextMessage, sendVoiceMessage, sendMediaMessage, emitTyping, editMsg } from "@/lib/actions";
import { newClientId } from "@/lib/util";
import EmojiPicker from "./EmojiPicker";
import QuickRepliesDialog from "./QuickRepliesDialog";

const MAX_RECORD_SECONDS = 180;
const MIME_CANDIDATES = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];

const blobToBase64 = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onloadend = () => resolve(String(r.result).split(",", 2)[1] ?? "");
    r.onerror = reject;
    r.readAsDataURL(blob);
  });

export default function Composer({ accountId, chatId, disabled }: { accountId: number; chatId: number; disabled: boolean }) {
  const [text, setText] = useState("");
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [showEmoji, setShowEmoji] = useState(false);
  const replyTo = useStore((s) => s.replyTo);
  const editing = useStore((s) => s.editing);
  const quickReplies = useStore((s) => s.quickReplies);
  const [showReplies, setShowReplies] = useState(false);
  const [qrIndex, setQrIndex] = useState(0);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const cancelRef = useRef(false);
  const ctxRef = useRef({ accountId, chatId });
  ctxRef.current = { accountId, chatId };

  const stopStream = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  useEffect(() => {
    setText("");
    cancelRef.current = true;
    if (recorderRef.current && recorderRef.current.state !== "inactive") recorderRef.current.stop();
    setRecording(false);
    setShowEmoji(false);
    useStore.getState().setReplyTo(null);
    areaRef.current?.focus();
  }, [chatId]);

  // Start editing: load the message text into the box
  useEffect(() => {
    if (!editing) return;
    setText(editing.text ?? "");
    areaRef.current?.focus();
  }, [editing]);
  useEffect(() => () => { cancelRef.current = true; recorderRef.current?.state !== "inactive" && recorderRef.current?.stop(); stopStream(); }, []);

  useEffect(() => {
    if (!recording) return;
    setSeconds(0);
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [recording]);
  useEffect(() => {
    if (recording && seconds >= MAX_RECORD_SECONDS) finishRecording(false);
  }, [seconds, recording]);

  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 140) + "px";
  }, [text]);

  function cancelEdit() {
    useStore.getState().setEditing(null);
    setText("");
  }

  async function send() {
    const t = text.trim();
    if (!t || disabled) return;
    const target = useStore.getState().editing;
    if (target) {
      if (t !== target.text && !(await editMsg(target, t))) return; // keep the text so the user can retry
      cancelEdit();
      return;
    }
    const reply = useStore.getState().replyTo;
    setText("");
    useStore.getState().setReplyTo(null);
    sendTextMessage(accountId, chatId, t, newClientId(), reply?.wa_message_id);
  }

  // "/thanks" at the start of the box (no spaces yet) suggests matching quick replies
  const slash = !editing && text.startsWith("/") && !/\s/.test(text) ? text.slice(1).toLowerCase() : null;
  const matches = slash === null ? [] : quickReplies.filter((r) => r.shortcut.startsWith(slash)).slice(0, 6);
  const activeMatch = Math.min(qrIndex, Math.max(matches.length - 1, 0));

  function pickReply(body: string) {
    setText(body);
    setQrIndex(0);
    areaRef.current?.focus();
  }

  function handleInput(value: string) {
    setQrIndex(0);
    setText(value);
    emitTyping(accountId, chatId);
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || disabled) return;
    e.target.value = "";
    if (file.size > 50 * 1024 * 1024) {
      useStore.getState().pushToast({ kind: "error", title: "File too large", body: "Maximum size is ~37 MB" });
      return;
    }
    const reply = useStore.getState().replyTo;
    useStore.getState().setReplyTo(null);
    sendMediaMessage(accountId, chatId, file, "", newClientId(), reply?.wa_message_id);
  }

  async function startRecording() {
    if (disabled || recording) return;
    const st = useStore.getState();
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      st.pushToast({ kind: "error", title: "Voice recording unavailable", body: "Open the dashboard on localhost or https." });
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mime = MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m));
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunksRef.current = [];
      cancelRef.current = false;
      const target = { ...ctxRef.current };
      rec.ondataavailable = (e) => e.data.size && chunksRef.current.push(e.data);
      rec.onstop = async () => {
        stopStream();
        const chunks = chunksRef.current;
        chunksRef.current = [];
        if (cancelRef.current || !chunks.length) return;
        const blob = new Blob(chunks, { type: rec.mimeType || "audio/webm" });
        if (blob.size < 1500) {
          useStore.getState().pushToast({ kind: "info", title: "Recording too short" });
          return;
        }
        try {
          const b64 = await blobToBase64(blob);
          sendVoiceMessage(target.accountId, target.chatId, b64, newClientId());
        } catch {
          useStore.getState().pushToast({ kind: "error", title: "Could not read the recording" });
        }
      };
      recorderRef.current = rec;
      rec.start();
      setRecording(true);
    } catch {
      stopStream();
      st.pushToast({ kind: "error", title: "Microphone unavailable", body: "Allow microphone access in your browser." });
    }
  }

  function finishRecording(cancel: boolean) {
    cancelRef.current = cancel;
    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") rec.stop();
    setRecording(false);
  }

  const mmss = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  const iconBtn = "p-2.5 rounded-full shrink-0 transition-colors";

  if (disabled) {
    return (
      <div className="px-4 py-3 bg-background border-t border-border text-sm text-muted text-center">
        This number is not connected. Reconnect it to send messages.
      </div>
    );
  }

  return (
    <div className="bg-background border-t border-border shrink-0">
      {showReplies && <QuickRepliesDialog onPick={pickReply} onClose={() => setShowReplies(false)} />}
      {editing && (
        <div className="px-4 py-2 flex items-center gap-2 border-b border-border bg-gray-50">
          <div className="flex-1 min-w-0 border-l-4 border-primary pl-2">
            <div className="text-xs font-semibold text-primary">Editing message</div>
            <div className="text-xs text-muted truncate">{editing.text}</div>
          </div>
          <button onClick={cancelEdit} className="p-1 text-muted hover:text-foreground" title="Cancel (Esc)">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Reply indicator */}
      {replyTo && (
        <div className="px-4 py-2 flex items-center gap-2 border-b border-border bg-gray-50">
          <div className="flex-1 min-w-0 border-l-4 border-primary pl-2">
            <div className="text-xs font-semibold text-primary truncate">
              {replyTo.from_me ? "You" : replyTo.sender_name || ""}
            </div>
            <div className="text-xs text-muted truncate">
              {replyTo.type !== "text" ? `[${replyTo.type}] ` : ""}{replyTo.text || ""}
            </div>
          </div>
          <button onClick={() => useStore.getState().setReplyTo(null)} className="p-1 text-muted hover:text-foreground">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      <div className="px-3 py-2 flex items-end gap-2">
        {recording ? (
          <>
            <button onClick={() => finishRecording(true)} title="Cancel" className={`${iconBtn} text-danger hover:bg-black/5`}>
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6" />
              </svg>
            </button>
            <div className="flex-1 flex items-center gap-2 px-3 py-2.5 rounded-3xl bg-surface text-sm">
              <span className="w-2.5 h-2.5 rounded-full bg-danger animate-pulse" />
              Recording… {mmss}
            </div>
            <button onClick={() => finishRecording(false)} title="Send voice message" className={`${iconBtn} bg-primary text-white hover:bg-primary-dark`}>
              <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M2 21l21-9L2 3v7l15 2-15 2z" /></svg>
            </button>
          </>
        ) : (
          <>
            {/* Emoji button */}
            <div className="relative">
              <button
                onClick={() => setShowEmoji(!showEmoji)}
                title="Emoji"
                className={`${iconBtn} ${showEmoji ? "text-primary" : "text-muted"} hover:bg-black/5`}
              >
                <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M8 14s1.5 2 4 2 4-2 4-2" />
                  <line x1="9" y1="9" x2="9.01" y2="9" />
                  <line x1="15" y1="9" x2="15.01" y2="9" />
                </svg>
              </button>
              {showEmoji && (
                <EmojiPicker
                  onSelect={(emoji) => {
                    setText((t) => t + emoji);
                    areaRef.current?.focus();
                  }}
                  onClose={() => setShowEmoji(false)}
                />
              )}
            </div>

            {/* Attachment button */}
            <button
              onClick={() => fileRef.current?.click()}
              title="Attach file"
              className={`${iconBtn} text-muted hover:bg-black/5`}
            >
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
              </svg>
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip,.rar"
              onChange={handleFile}
              className="hidden"
            />

            <button
              onClick={() => setShowReplies(true)}
              title="Quick replies"
              className={`${iconBtn} text-muted hover:bg-black/5`}
            >
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M13 2L3 14h8l-1 8 10-12h-8l1-8z" />
              </svg>
            </button>
            <div className="relative flex-1 min-w-0">
              {matches.length > 0 && (
                <div className="absolute bottom-full left-0 right-0 mb-2 bg-white rounded-xl shadow-lg border border-border overflow-hidden z-50">
                  {matches.map((r, i) => (
                    <button
                      key={r.id}
                      onMouseDown={(e) => { e.preventDefault(); pickReply(r.text); }}
                      className={`w-full text-left px-3 py-2 ${i === activeMatch ? "bg-background" : "hover:bg-background"}`}
                    >
                      <span className="text-sm font-medium text-primary">/{r.shortcut}</span>
                      <span className="ml-2 text-sm text-muted truncate">{r.text.slice(0, 80)}</span>
                    </button>
                  ))}
                </div>
              )}
            <textarea
              ref={areaRef}
              value={text}
              rows={1}
              placeholder="Type a message"
              onChange={(e) => handleInput(e.target.value)}
              onKeyDown={(e) => {
                if (matches.length > 0) {
                  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                    e.preventDefault();
                    setQrIndex((activeMatch + (e.key === "ArrowDown" ? 1 : matches.length - 1)) % matches.length);
                    return;
                  }
                  if ((e.key === "Enter" || e.key === "Tab") && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    pickReply(matches[activeMatch].text);
                    return;
                  }
                }
                if (e.key === "Escape" && useStore.getState().editing) {
                  cancelEdit();
                  return;
                }
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  send();
                }
              }}
              className="w-full resize-none px-4 py-2.5 rounded-3xl bg-surface focus:outline-none text-[15px] max-h-36"
            />
            </div>
            {text.trim() ? (
              <button onClick={send} title="Send" className={`${iconBtn} bg-primary text-white hover:bg-primary-dark`}>
                <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M2 21l21-9L2 3v7l15 2-15 2z" /></svg>
              </button>
            ) : (
              <button onClick={startRecording} title="Record voice message" className={`${iconBtn} bg-primary text-white hover:bg-primary-dark`}>
                <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="9" y="2" width="6" height="12" rx="3" />
                  <path d="M5 11a7 7 0 0014 0M12 18v4" />
                </svg>
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
