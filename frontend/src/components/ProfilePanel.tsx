"use client";

import { useStore } from "@/lib/store";
import { chatTitle, phoneFromJid } from "@/lib/util";
import { ProfileAvatar } from "./ChatList";

export default function ProfilePanel({ onClose }: { onClose: () => void }) {
  const chat = useStore((s) =>
    s.activeAccountId && s.activeChatId
      ? s.chats[s.activeAccountId]?.find((c) => c.id === s.activeChatId)
      : undefined,
  );
  const contacts = useStore((s) => (s.activeAccountId ? s.contacts[s.activeAccountId] : undefined));
  const account = useStore((s) => s.accounts.find((a) => a.id === s.activeAccountId));

  if (!chat) return null;

  const title = chatTitle(chat);
  const phone = chat.is_group ? null : phoneFromJid(chat.jid);
  const contact = contacts?.find((c) => c.jid === chat.jid);

  return (
    <div className="w-80 border-l border-border bg-sidebar-bg flex flex-col h-full shrink-0">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <span className="font-semibold text-sm">Contact info</span>
        <button onClick={onClose} className="p-1 rounded-full hover:bg-background" aria-label="Close">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="flex flex-col items-center py-6 gap-3 border-b border-border">
        <ProfileAvatar name={title} url={chat.profile_pic_url} size={96} />
        <div className="text-center px-4">
          <div className="font-semibold text-lg">{title}</div>
          {phone && <div className="text-sm text-muted">+{phone}</div>}
          {chat.is_group && <div className="text-sm text-muted">Group</div>}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {account && (
          <div>
            <div className="text-xs text-muted uppercase tracking-wider mb-1">Account</div>
            <div className="text-sm">{account.label}</div>
            {account.phone_number && <div className="text-xs text-muted">+{account.phone_number}</div>}
          </div>
        )}

        <div>
          <div className="text-xs text-muted uppercase tracking-wider mb-1">JID</div>
          <div className="text-xs text-muted break-all">{chat.jid}</div>
        </div>

        {contact?.profile_pic_url && (
          <div>
            <div className="text-xs text-muted uppercase tracking-wider mb-1">Profile photo</div>
            <img
              src={contact.profile_pic_url}
              alt={title}
              className="w-full rounded-lg"
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
