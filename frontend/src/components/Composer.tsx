"use client";

import { useEffect, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { sendTextMessage, sendVoiceMessage } from "@/lib/actions";
import { newClientId } from "@/lib/util";

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
  const areaRef = useRef<HTMLTextAreaElement>(null);
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

  // Reset when switching chats; release the microphone on unmount
  useEffect(() => {
    setText("");
    cancelRef.current = true;
    if (recorderRef.current && recorderRef.current.state !== "inactive") recorderRef.current.stop();
    setRecording(false);
    areaRef.current?.focus();
  }, [chatId]);
  useEffect(() => () => { cancelRef.current = true; recorderRef.current?.state !== "inactive" && recorderRef.current?.stop(); stopStream(); }, []);

  // Recording timer + auto-stop
  useEffect(() => {
    if (!recording) return;
    setSeconds(0);
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [recording]);
  useEffect(() => {
    if (recording && seconds >= MAX_RECORD_SECONDS) finishRecording(false);
  }, [seconds, recording]);

  // Auto-grow textarea
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 140) + "px";
  }, [text]);

  function send() {
    const t = text.trim();
    if (!t || disabled) return;
    setText("");
    sendTextMessage(accountId, chatId, t, newClientId());
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
    <div className="px-3 py-2 bg-background border-t border-border flex items-end gap-2">
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
          <textarea
            ref={areaRef}
            value={text}
            rows={1}
            placeholder="Type a message"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send();
              }
            }}
            className="flex-1 resize-none px-4 py-2.5 rounded-3xl bg-surface focus:outline-none text-[15px] max-h-36"
          />
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
  );
}
