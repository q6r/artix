"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Headset, Send, UserPlus, X } from "lucide-react";
import { useLang } from "@/components/LanguageProvider";
import { useAuth } from "@/components/AuthProvider";
import { useToast } from "@/components/FeedbackProvider";
import { api, ApiError } from "@/lib/api/client";
import type { TicketThread, UserRef } from "@/lib/api/types";

export const statusStyles: Record<string, string> = {
  open: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  pending: "border-sky-500/30 bg-sky-500/10 text-sky-300",
  closed: "border-white/15 bg-white/5 text-white/55",
};

function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function Avatar({ user, size = 32 }: { user: UserRef; size?: number }) {
  if (user.avatar_url) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={user.avatar_url}
        alt=""
        style={{ width: size, height: size }}
        className="shrink-0 rounded-full object-cover"
      />
    );
  }
  return (
    <span
      style={{ width: size, height: size }}
      className="flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-sky-400 to-blue-600 text-[11px] font-semibold"
    >
      {initials(user.display_name)}
    </span>
  );
}

function StaffAvatar({ size = 32 }: { size?: number }) {
  return (
    <span
      style={{ width: size, height: size }}
      className="flex shrink-0 items-center justify-center rounded-full bg-sky-500/15 text-sky-300"
    >
      <Headset className="h-4 w-4" strokeWidth={1.7} />
    </span>
  );
}

// ----------------------------- Data hook -----------------------------

/**
 * Loads a ticket thread and exposes the actions, switching between the user
 * (`tickets/:id`) and staff (`admin/tickets/:id`) endpoints. `id` may be null
 * (e.g. nothing selected in the admin inbox) — then it sits idle.
 */
export function useTicket(
  id: string | null,
  admin: boolean,
  onAfterChange?: () => void,
) {
  const { user } = useAuth();
  const toast = useToast();
  const [thread, setThread] = useState<TicketThread | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">(
    id ? "loading" : "idle",
  );
  const [busy, setBusy] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);

  const basePath = id ? (admin ? `admin/tickets/${id}` : `tickets/${id}`) : null;

  const reload = useCallback(async () => {
    if (!basePath) return;
    const th = await api<TicketThread>(basePath);
    setThread(th);
    setStatus("ready");
  }, [basePath]);

  useEffect(() => {
    if (!basePath) {
      setThread(null);
      setStatus("idle");
      return;
    }
    let active = true;
    setStatus("loading");
    setThread(null);
    (async () => {
      try {
        const th = await api<TicketThread>(basePath);
        if (active) {
          setThread(th);
          setStatus("ready");
        }
      } catch {
        if (active) setStatus("error");
      }
    })();
    return () => {
      active = false;
    };
  }, [basePath]);

  const send = async (text: string) => {
    if (!id || !basePath || busy || !text.trim()) return;
    setBusy(true);
    try {
      await api(`${basePath}/messages`, {
        method: "POST",
        json: { body: text.trim() },
      });
      await reload();
      onAfterChange?.();
    } catch (err) {
      if (err instanceof ApiError) toast(err.message);
      throw err;
    } finally {
      setBusy(false);
    }
  };

  const runAction = async (fn: () => Promise<unknown>) => {
    setActionBusy(true);
    try {
      await fn();
      await reload();
      onAfterChange?.();
    } catch (err) {
      if (err instanceof ApiError) toast(err.message);
    } finally {
      setActionBusy(false);
    }
  };

  const assignSelf = () =>
    runAction(() => api(`tickets/${id}/assign`, { method: "POST" }));
  const unassign = () =>
    runAction(() => api(`tickets/${id}/assign`, { method: "DELETE" }));
  const close = () =>
    runAction(() =>
      admin
        ? api(`admin/tickets/${id}/status`, {
            method: "PATCH",
            json: { status: "closed" },
          })
        : api(`tickets/${id}/close`, { method: "POST" }),
    );
  const addMember = (email: string) =>
    runAction(() =>
      api(`tickets/${id}/members`, { method: "POST", json: { email } }),
    );
  const removeMember = (uid: string) =>
    runAction(() => api(`tickets/${id}/members/${uid}`, { method: "DELETE" }));

  return {
    user,
    thread,
    status,
    busy,
    actionBusy,
    reload,
    send,
    assignSelf,
    unassign,
    close,
    addMember,
    removeMember,
  };
}

// ----------------------------- Conversation -----------------------------

export function Conversation({
  thread,
  busy,
  onSend,
  className = "",
}: {
  thread: TicketThread;
  busy: boolean;
  onSend: (text: string) => Promise<void>;
  className?: string;
}) {
  const { t, locale } = useLang();
  const { user } = useAuth();
  const [reply, setReply] = useState("");
  const taRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const ticket = thread.ticket;
  const closed = ticket.status === "closed";

  // Reset the composer when switching tickets (admin inbox).
  useEffect(() => {
    setReply("");
    if (taRef.current) taRef.current.style.height = "auto";
  }, [ticket.id]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [thread.messages.length, ticket.id]);

  const authorName = (authorId: string, isStaffMsg: boolean) => {
    if (isStaffMsg) return ticket.assignee?.display_name ?? t("sup.staff");
    if (authorId === ticket.owner?.id) return ticket.owner.display_name;
    const m = ticket.members?.find((x) => x.id === authorId);
    return m?.display_name ?? t("sup.you");
  };

  const authorRef = (authorId: string, isStaffMsg: boolean): UserRef | null => {
    if (authorId === ticket.owner?.id) return ticket.owner;
    const m = ticket.members?.find((x) => x.id === authorId);
    if (m) return m;
    if (authorId === user?.id) return user;
    if (isStaffMsg) return ticket.assignee ?? null;
    return null;
  };

  const adjustHeight = () => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 128)}px`;
  };

  const submit = async () => {
    if (busy || !reply.trim()) return;
    try {
      await onSend(reply);
      setReply("");
      if (taRef.current) taRef.current.style.height = "auto";
    } catch {
      /* error surfaced by the caller */
    }
  };

  return (
    <div className={`flex min-w-0 flex-col overflow-hidden ${className}`}>
      <div className="flex-1 space-y-1 overflow-y-auto p-4 sm:p-5">
        {thread.messages.map((m, i) => {
          const mine = m.author_id === user?.id;
          const prev = thread.messages[i - 1];
          const next = thread.messages[i + 1];
          const startGroup =
            !prev ||
            prev.author_id !== m.author_id ||
            prev.is_staff !== m.is_staff;
          const endGroup =
            !next ||
            next.author_id !== m.author_id ||
            next.is_staff !== m.is_staff;
          const ref = authorRef(m.author_id, m.is_staff);
          return (
            <div
              key={m.id}
              className={`flex items-end gap-2 ${startGroup ? "mt-4 first:mt-0" : "mt-0.5"} ${
                mine ? "flex-row-reverse" : ""
              }`}
            >
              <div className="w-8 shrink-0">
                {endGroup &&
                  (ref ? (
                    <Avatar user={ref} size={32} />
                  ) : m.is_staff ? (
                    <StaffAvatar size={32} />
                  ) : null)}
              </div>
              <div
                className={`flex max-w-[78%] flex-col ${mine ? "items-end" : "items-start"}`}
              >
                {startGroup && (
                  <div className="mb-1 flex items-center gap-2 px-1 text-xs">
                    <span
                      className={
                        m.is_staff
                          ? "font-medium text-sky-300"
                          : "font-medium text-white/70"
                      }
                    >
                      {authorName(m.author_id, m.is_staff)}
                    </span>
                    {m.is_staff && (
                      <span className="rounded-full bg-sky-500/15 px-1.5 py-0.5 text-[10px] text-sky-300">
                        {t("sup.staff")}
                      </span>
                    )}
                  </div>
                )}
                <div
                  className={`px-3.5 py-2.5 text-sm leading-relaxed ${
                    mine
                      ? `rounded-2xl bg-white text-black ${endGroup ? "rounded-br-md" : ""}`
                      : m.is_staff
                        ? `rounded-2xl border border-sky-500/20 bg-sky-500/[0.08] text-white/85 ${endGroup ? "rounded-bl-md" : ""}`
                        : `rounded-2xl border border-white/10 bg-white/[0.04] text-white/85 ${endGroup ? "rounded-bl-md" : ""}`
                  }`}
                >
                  <p className="whitespace-pre-wrap break-words">{m.body}</p>
                </div>
                {endGroup && (
                  <span className="mt-1 px-1 text-[10px] text-white/35">
                    {new Date(m.created_at).toLocaleString(locale, {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                )}
              </div>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>

      {closed ? (
        <div className="border-t border-white/10 px-5 py-4 text-center text-sm text-white/45">
          {t("sup.status.closed")}
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="border-t border-white/10 p-3"
        >
          <div className="flex items-end gap-2 rounded-2xl border border-white/10 bg-white/[0.03] p-1.5 transition-colors focus-within:border-white/30">
            <textarea
              ref={taRef}
              value={reply}
              onChange={(e) => {
                setReply(e.target.value);
                adjustHeight();
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
              rows={1}
              placeholder={t("sup.replyPlaceholder")}
              className="max-h-32 min-h-[40px] flex-1 resize-none bg-transparent px-3 py-2 text-sm outline-none placeholder:text-white/35"
            />
            <button
              type="submit"
              disabled={busy || !reply.trim()}
              aria-label={t("sup.send2")}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-black transition-colors hover:bg-white/85 disabled:opacity-40"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

// ----------------------------- Attendance / members -----------------------------

export function AttendancePanel({
  thread,
  isStaff,
  isOwner,
  actionBusy,
  onAssignSelf,
  onUnassign,
  onClose,
  onAddMember,
  onRemoveMember,
  className = "",
}: {
  thread: TicketThread;
  isStaff: boolean;
  isOwner: boolean;
  actionBusy: boolean;
  onAssignSelf: () => void;
  onUnassign: () => void;
  onClose: () => void;
  onAddMember: (email: string) => void;
  onRemoveMember: (uid: string) => void;
  className?: string;
}) {
  const { t } = useLang();
  const { user } = useAuth();
  const [memberEmail, setMemberEmail] = useState("");

  const ticket = thread.ticket;
  const closed = ticket.status === "closed";
  const assignee = ticket.assignee;
  const assignedToMe = !!assignee && assignee.id === user?.id;

  const submitMember = (e: React.FormEvent) => {
    e.preventDefault();
    if (actionBusy || !memberEmail.trim()) return;
    onAddMember(memberEmail.trim());
    setMemberEmail("");
  };

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Attendance */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-medium">
          <Headset className="h-4 w-4 text-white/60" strokeWidth={1.6} />
          {t("sup.attendance")}
        </div>
        {assignee ? (
          <div className="flex items-center gap-3">
            <Avatar user={assignee} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">
                {assignee.display_name}
                {assignedToMe && (
                  <span className="ml-1 text-xs text-white/45">
                    ({t("sup.youTag")})
                  </span>
                )}
              </p>
              <p className="truncate text-xs text-white/45">{assignee.email}</p>
            </div>
          </div>
        ) : (
          <p className="text-sm text-white/45">{t("sup.noAssignee")}</p>
        )}

        {isStaff && !closed && (
          <button
            onClick={assignedToMe ? onUnassign : onAssignSelf}
            disabled={actionBusy}
            className="mt-3 h-9 w-full rounded-lg border border-white/15 bg-white/5 text-sm transition-colors hover:bg-white/10 disabled:opacity-50"
          >
            {assignedToMe ? t("sup.end") : t("sup.start")}
          </button>
        )}
      </div>

      {/* Members */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
        <div className="mb-3 text-sm font-medium">{t("sup.members")}</div>
        <div className="space-y-2">
          {ticket.owner && (
            <div className="flex items-center gap-3">
              <Avatar user={ticket.owner} size={28} />
              <span className="min-w-0 flex-1 truncate text-sm">
                {ticket.owner.display_name}
              </span>
              <span className="rounded-full bg-amber-400/10 px-2 py-0.5 text-[10px] font-medium text-amber-400">
                {t("sup.owner")}
              </span>
            </div>
          )}
          {ticket.members?.map((m) => (
            <div key={m.id} className="flex items-center gap-3">
              <Avatar user={m} size={28} />
              <span className="min-w-0 flex-1 truncate text-sm">
                {m.display_name}
              </span>
              {isOwner && (
                <button
                  onClick={() => onRemoveMember(m.id)}
                  disabled={actionBusy}
                  aria-label={t("sup.remove")}
                  className="text-white/40 transition-colors hover:text-red-400 disabled:opacity-50"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          ))}
        </div>

        {isOwner && (
          <form onSubmit={submitMember} className="mt-3 flex gap-2">
            <input
              value={memberEmail}
              onChange={(e) => setMemberEmail(e.target.value)}
              type="email"
              placeholder={t("sup.memberPlaceholder")}
              className="h-9 min-w-0 flex-1 rounded-lg border border-white/10 bg-white/[0.03] px-3 text-sm outline-none placeholder:text-white/35 focus:border-white/30"
            />
            <button
              type="submit"
              disabled={actionBusy}
              aria-label={t("sup.add")}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-black transition-colors hover:bg-white/85 disabled:opacity-50"
            >
              <UserPlus className="h-4 w-4" />
            </button>
          </form>
        )}
      </div>

      {/* Close */}
      {!closed && (isOwner || isStaff) && (
        <button
          onClick={onClose}
          disabled={actionBusy}
          className="h-9 w-full rounded-lg border border-white/10 text-sm text-white/55 transition-colors hover:bg-white/5 hover:text-white disabled:opacity-50"
        >
          {t("sup.close")}
        </button>
      )}
    </div>
  );
}
