"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Room, RoomEvent, Track, type RemoteTrack, type Participant } from "livekit-client";
import { Mic, MicOff, PhoneOff, Phone, Loader2 } from "lucide-react";
import { api } from "@/lib/api/client";
import { useLang } from "@/components/LanguageProvider";

type Phase = "idle" | "connecting" | "connected" | "error";
type Speaker = { id: string; name: string; muted: boolean; speaking: boolean; you: boolean };

/** In-browser voice call (LiveKit) for the shared "community" room. */
export default function VoiceRoom({
  onConnectedChange,
}: {
  onConnectedChange?: (connected: boolean) => void;
} = {}) {
  const { t } = useLang();
  const [phase, setPhase] = useState<Phase>("idle");
  const [err, setErr] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [speakers, setSpeakers] = useState<Speaker[]>([]);
  const roomRef = useRef<Room | null>(null);
  const audioRef = useRef<HTMLDivElement | null>(null);

  const refresh = useCallback((room: Room) => {
    const active = new Set(room.activeSpeakers.map((p) => p.identity));
    const list: Speaker[] = [];
    const add = (p: Participant, you: boolean) =>
      list.push({
        id: p.identity,
        name: p.name || p.identity.slice(0, 6),
        muted: !p.isMicrophoneEnabled,
        speaking: active.has(p.identity),
        you,
      });
    add(room.localParticipant, true);
    room.remoteParticipants.forEach((p) => add(p, false));
    setSpeakers(list);
  }, []);

  const join = async () => {
    if (phase === "connecting" || phase === "connected") return;
    setPhase("connecting");
    setErr(null);
    try {
      const { token, url } = await api<{ token: string; url: string }>("community/voice-token", {
        method: "POST",
      });
      if (!url) throw new Error("voice não configurado");
      const room = new Room({ adaptiveStream: false, dynacast: false });
      roomRef.current = room;
      room
        .on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
          if (track.kind === Track.Kind.Audio && audioRef.current) {
            const el = track.attach();
            el.autoplay = true;
            audioRef.current.appendChild(el);
          }
        })
        .on(RoomEvent.TrackUnsubscribed, (track) => track.detach().forEach((el) => el.remove()))
        .on(RoomEvent.ParticipantConnected, () => refresh(room))
        .on(RoomEvent.ParticipantDisconnected, () => refresh(room))
        .on(RoomEvent.ActiveSpeakersChanged, () => refresh(room))
        .on(RoomEvent.TrackMuted, () => refresh(room))
        .on(RoomEvent.TrackUnmuted, () => refresh(room))
        .on(RoomEvent.Disconnected, () => {
          setPhase("idle");
          setSpeakers([]);
          roomRef.current = null;
        });
      await room.connect(url, token);
      await room.localParticipant.setMicrophoneEnabled(true);
      setMuted(false);
      setPhase("connected");
      refresh(room);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "erro ao conectar");
      setPhase("error");
      try {
        await roomRef.current?.disconnect();
      } catch {}
      roomRef.current = null;
    }
  };

  const leave = async () => {
    try {
      await roomRef.current?.disconnect();
    } catch {}
    roomRef.current = null;
    setPhase("idle");
    setSpeakers([]);
  };

  const toggleMute = async () => {
    const room = roomRef.current;
    if (!room) return;
    const next = !muted;
    await room.localParticipant.setMicrophoneEnabled(!next);
    setMuted(next);
    refresh(room);
  };

  useEffect(() => {
    onConnectedChange?.(phase === "connected");
  }, [phase, onConnectedChange]);

  useEffect(
    () => () => {
      roomRef.current?.disconnect();
    },
    [],
  );

  if (phase !== "connected") {
    return (
      <div className="flex flex-col items-center gap-3 py-4">
        <button
          onClick={join}
          disabled={phase === "connecting"}
          className="inline-flex h-11 items-center gap-2 rounded-xl bg-emerald-500 px-6 text-sm font-semibold text-black transition-colors hover:bg-emerald-400 disabled:opacity-60"
        >
          {phase === "connecting" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Phone className="h-4 w-4" />
          )}
          {phase === "connecting" ? t("community.connecting") : t("community.join")}
        </button>
        <p className="text-xs text-white/40">{t("community.joinHint")}</p>
        {phase === "error" && (
          <p className="text-xs text-red-300">
            {t("community.connectErr")}
            {err ? ` (${err})` : ""}
          </p>
        )}
        <div ref={audioRef} className="hidden" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="inline-flex items-center gap-2 text-sm font-medium text-emerald-300">
          <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
          {t("community.inCall")} · {speakers.length}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {speakers.map((s) => (
          <div
            key={s.id}
            className={`flex flex-col items-center gap-2 rounded-2xl border p-4 transition-colors ${
              s.speaking ? "border-emerald-400/60 bg-emerald-500/10" : "border-white/10 bg-white/[0.02]"
            }`}
          >
            <span
              className={`relative flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-sky-400 to-blue-600 text-sm font-semibold ${
                s.speaking ? "ring-2 ring-emerald-400 ring-offset-2 ring-offset-black" : ""
              }`}
            >
              {s.name.slice(0, 2).toUpperCase()}
              {s.muted && (
                <span className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full border border-black bg-red-500">
                  <MicOff className="h-3 w-3 text-white" />
                </span>
              )}
            </span>
            <span className="max-w-full truncate text-xs font-medium">
              {s.name}
              {s.you ? ` (${t("community.you")})` : ""}
            </span>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-center gap-2">
        <button
          onClick={toggleMute}
          className={`inline-flex h-11 items-center gap-2 rounded-xl px-5 text-sm font-medium transition-colors ${
            muted
              ? "bg-red-500/15 text-red-300 hover:bg-red-500/25"
              : "border border-white/10 bg-white/5 hover:bg-white/10"
          }`}
        >
          {muted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          {muted ? t("community.unmute") : t("community.mute")}
        </button>
        <button
          onClick={leave}
          className="inline-flex h-11 items-center gap-2 rounded-xl bg-red-500 px-5 text-sm font-semibold text-white transition-colors hover:bg-red-400"
        >
          <PhoneOff className="h-4 w-4" />
          {t("community.leave")}
        </button>
      </div>

      <div ref={audioRef} className="hidden" />
    </div>
  );
}
