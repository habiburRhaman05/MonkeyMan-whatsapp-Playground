import type { Chat, Contact } from "./api";

export const phoneFromJid = (jid: string) => jid.split("@")[0].split(":")[0];

export function chatTitle(c: Pick<Chat, "name" | "jid" | "is_group">): string {
  if (c.name) return c.name;
  if (c.is_group) return "Group";
  return "+" + phoneFromJid(c.jid);
}

export function contactTitle(c: Contact): string {
  return c.name || (c.is_group ? "Group" : "+" + phoneFromJid(c.jid));
}

export function formatListTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  const yesterday = new Date(now.getTime() - 86400000);
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], { day: "2-digit", month: "short" });
}

export const formatTime = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export function formatDay(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return "Today";
  if (d.toDateString() === new Date(now.getTime() - 86400000).toDateString()) return "Yesterday";
  return d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

export const newClientId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `c${Date.now()}${Math.random().toString(16).slice(2)}`;

export const avatarColor = (s: string) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return `hsl(${h} 45% 45%)`;
};

let audioCtx: AudioContext | null = null;
/** Soft two-note chime, generated with Web Audio (no asset needed). */
export function playChime() {
  try {
    audioCtx = audioCtx ?? new (window.AudioContext || (window as any).webkitAudioContext)();
    const ctx = audioCtx;
    if (ctx.state === "suspended") ctx.resume();
    const now = ctx.currentTime;
    [660, 880].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, now + i * 0.12);
      gain.gain.exponentialRampToValueAtTime(0.12, now + i * 0.12 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.12 + 0.35);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + i * 0.12);
      osc.stop(now + i * 0.12 + 0.4);
    });
  } catch {}
}
