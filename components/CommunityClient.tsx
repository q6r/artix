"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Hash, Loader2, MicOff, SendHorizontal, Volume2 } from "lucide-react";
import FadeIn from "@/components/FadeIn";
import { useLang } from "@/components/LanguageProvider";
import VoiceRoom from "@/components/VoiceRoom";
import { api } from "@/lib/api/client";
import type { ChatMessage, VoiceParticipant } from "@/lib/api/types";

const CHANNEL = "geral";

export default function CommunityClient() {
  const { t } = useLang();
  const [connected, setConnected] = useState(false);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <FadeIn>
        <h1 className="text-2xl font-semibold tracking-tight">{t("community.title")}</h1>
        <p className="mt-1 text-sm text-white/55">{t("community.subtitle")}</p>
      </FadeIn>

      <FadeIn
        delay={0.05}
        className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.02] md:flex md:min-h-[560px]"
      >
        <ChannelSidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-2 border-b border-white/10 px-5 py-3">
            <Hash className="h-4 w-4 text-white/40" />
            <span className="text-sm font-semibold">{t("community.general")}</span>
          </div>
          <div className="flex flex-1 flex-col gap-5 p-5 lg:flex-row">
            <VoiceSection connected={connected} onConnectedChange={setConnected} />
            <ChatSection />
          </div>
        </div>
      </FadeIn>
    </div>
  );
}

/** Discord-like left rail: one category + the single "Geral" voice channel (active). */
function ChannelSidebar() {
  const { t } = useLang();
  return (
    <aside className="shrink-0 border-b border-white/10 bg-black/20 p-3 md:w-52 md:border-b-0 md:border-r">
      <p className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-white/35">
        {t("community.category")}
      </p>
      <button
        className="mt-1 flex w-full items-center gap-2 rounded-lg bg-white/[0.06] px-2 py-1.5 text-left text-sm font-medium text-white"
        aria-current="true"
      >
        <Volume2 className="h-4 w-4 text-white/60" />
        {t("community.general")}
      </button>
    </aside>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "??";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Voice: polled presence (who's in the call, even before joining) + the live VoiceRoom. */
function VoiceSection({
  connected,
  onConnectedChange,
}: {
  connected: boolean;
  onConnectedChange: (v: boolean) => void;
}) {
  const { t } = useLang();
  const [participants, setParticipants] = useState<VoiceParticipant[]>([]);

  useEffect(() => {
    // Once connected, VoiceRoom's live tiles take over — stop polling presence.
    if (connected) return;
    let alive = true;
    const load = async () => {
      try {
        const res = await api<{ participants: VoiceParticipant[] }>("community/voice-state");
        if (alive) setParticipants(res.participants ?? []);
      } catch {
        /* transient — keep last snapshot */
      }
    };
    load();
    const id = setInterval(load, 4000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [connected]);

  return (
    <div className="flex flex-col rounded-2xl border border-white/10 bg-white/[0.02] p-4 lg:w-72 lg:shrink-0">
      <div className="flex items-center gap-2">
        <Volume2 className="h-4 w-4 text-white/50" />
        <p className="text-sm font-semibold">{t("community.voiceTitle")}</p>
      </div>

      {/* Presence shows before joining; once connected, VoiceRoom's live tiles take over. */}
      {!connected && (
        <div className="mt-3 space-y-1.5">
          {participants.length === 0 ? (
            <p className="text-xs text-white/40">{t("community.noOneInCall")}</p>
          ) : (
            participants.map((p) => (
              <div key={p.identity} className="flex items-center gap-2.5 rounded-lg px-1 py-1">
                <span className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-sky-400 to-blue-600 text-[11px] font-semibold">
                  {initials(p.name || p.identity)}
                  {p.muted && (
                    <span className="absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full border border-black bg-red-500">
                      <MicOff className="h-2.5 w-2.5 text-white" />
                    </span>
                  )}
                </span>
                <span className="min-w-0 truncate text-sm text-white/80">
                  {p.name || p.identity}
                </span>
              </div>
            ))
          )}
        </div>
      )}

      <div className="mt-3 border-t border-white/5 pt-2">
        <VoiceRoom onConnectedChange={onConnectedChange} />
      </div>
    </div>
  );
}

/** Polled text chat for #geral: message list (auto-scroll) + composer. */
function ChatSection() {
  const { t } = useLang();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const atBottomRef = useRef(true);

  const load = useCallback(async () => {
    try {
      const res = await api<ChatMessage[]>(`community/chat?channel=${CHANNEL}`);
      setMessages(res ?? []);
    } catch {
      /* transient */
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 3000);
    return () => clearInterval(id);
  }, [load]);

  // Auto-scroll to bottom when new messages arrive (unless the user scrolled up).
  useEffect(() => {
    const el = scrollRef.current;
    if (el && atBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };

  const send = async () => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      await api("community/chat", { method: "POST", json: { channel: CHANNEL, text: body } });
      setText("");
      atBottomRef.current = true;
      await load();
    } catch {
      /* keep the text so the user can retry */
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex min-h-[320px] flex-1 flex-col rounded-2xl border border-white/10 bg-white/[0.02]">
      <div className="flex items-center gap-2 border-b border-white/10 px-4 py-2.5">
        <Hash className="h-4 w-4 text-white/40" />
        <p className="text-sm font-semibold">{t("community.chatTitle")}</p>
      </div>

      <div ref={scrollRef} onScroll={onScroll} className="flex-1 space-y-3 overflow-y-auto p-4">
        {messages.length === 0 ? (
          <p className="text-sm text-white/40">{t("community.chatEmpty")}</p>
        ) : (
          messages.map((m) => (
            <div key={m.id} className="flex gap-2.5">
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-violet-400 to-indigo-600 text-[11px] font-semibold">
                {initials(m.name)}
              </span>
              <div className="min-w-0">
                <p className="flex items-baseline gap-2">
                  <span className="text-sm font-semibold">{m.name}</span>
                  <span className="text-[11px] text-white/35">{fmtTime(m.created_at)}</span>
                </p>
                <p className="whitespace-pre-wrap break-words text-sm text-white/75">{m.text}</p>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="flex items-center gap-2 border-t border-white/10 p-3">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          maxLength={500}
          placeholder={t("community.chatPlaceholder")}
          className="h-10 min-w-0 flex-1 rounded-xl border border-white/10 bg-white/[0.03] px-3 text-sm outline-none placeholder:text-white/30 focus:border-white/20"
        />
        <button
          onClick={send}
          disabled={sending || text.trim().length === 0}
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-500 text-white transition-colors hover:bg-violet-400 disabled:opacity-40"
          aria-label={t("community.send")}
        >
          {sending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <SendHorizontal className="h-4 w-4" />
          )}
        </button>
      </div>
    </div>
  );
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
