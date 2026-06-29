"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useLang } from "@/components/LanguageProvider";
import { useAuth } from "@/components/AuthProvider";
import { ApiError } from "@/lib/api/client";

type Mode = "login" | "register";

const DiscordIcon = () => (
  <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden>
    <path
      fill="#5865F2"
      d="M20.317 4.369A19.79 19.79 0 0016.558 3a.07.07 0 00-.073.035c-.211.375-.444.864-.608 1.249a18.27 18.27 0 00-5.487 0 12.6 12.6 0 00-.617-1.249.07.07 0 00-.073-.035A19.736 19.736 0 003.677 4.37a.064.064 0 00-.03.027C.533 9.046-.32 13.58.099 18.057a.08.08 0 00.031.055 19.9 19.9 0 005.993 3.03.07.07 0 00.076-.027c.462-.63.873-1.295 1.226-1.994a.07.07 0 00-.038-.098 13.1 13.1 0 01-1.872-.892.07.07 0 01-.007-.117c.126-.094.252-.192.372-.291a.07.07 0 01.071-.01c3.928 1.793 8.18 1.793 12.062 0a.07.07 0 01.072.009c.12.099.246.198.373.292a.07.07 0 01-.006.117c-.598.35-1.22.645-1.873.891a.07.07 0 00-.037.099c.36.698.772 1.362 1.225 1.993a.07.07 0 00.076.028 19.84 19.84 0 006.002-3.03.07.07 0 00.032-.054c.5-5.177-.838-9.674-3.549-13.66a.06.06 0 00-.03-.028zM8.02 15.331c-1.182 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"
    />
  </svg>
);

const GithubIcon = () => (
  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden>
    <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0112 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222 0 1.606-.014 2.898-.014 3.293 0 .322.216.694.825.576C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
  </svg>
);

const transition = { duration: 0.25, ease: [0.22, 1, 0.36, 1] as const };

export default function AuthForm({
  mode,
  title,
  subtitle,
}: {
  mode: Mode;
  title: string;
  subtitle: string;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const { t } = useLang();
  const { requestCode, verifyCode, verifyBackupCode } = useAuth();

  const [step, setStep] = useState<"email" | "code" | "backup">("email");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState<string[]>(Array(6).fill(""));
  const [backupCode, setBackupCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputsRef = useRef<(HTMLInputElement | null)[]>([]);

  // Only honor same-site relative paths (block open-redirect via `//evil.com`).
  const nextParam = params.get("next") || "";
  const next = /^\/(?!\/)/.test(nextParam) ? nextParam : "/dashboard";

  const social =
    "h-10 flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 text-sm font-medium transition-colors hover:bg-white/10 disabled:opacity-50";

  const sendCode = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (busy || !email.trim()) return;
    setError(null);
    setBusy(true);
    try {
      await requestCode(
        email.trim(),
        mode === "register" ? name.trim() || undefined : undefined,
      );
      setStep("code");
      setTimeout(() => inputsRef.current[0]?.focus(), 50);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("auth.form.genericError"));
    } finally {
      setBusy(false);
    }
  };

  const submitBackup = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = backupCode.trim().toUpperCase();
    if (busy || clean.length < 8) return;
    setError(null);
    setBusy(true);
    try {
      await verifyBackupCode(email.trim(), clean);
      router.push(next);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("auth.form.genericError"));
      setBusy(false);
    }
  };

  const submitCode = async (full: string) => {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      await verifyCode(email.trim(), full);
      router.push(next);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("auth.form.genericError"));
      setBusy(false);
    }
  };

  const setDigit = (i: number, val: string) => {
    const v = val.replace(/\D/g, "").slice(-1);
    const nextCode = [...code];
    nextCode[i] = v;
    setCode(nextCode);
    if (v && i < 5) inputsRef.current[i + 1]?.focus();
    if (nextCode.every((d) => d !== "")) void submitCode(nextCode.join(""));
  };

  const handleKey = (i: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !code[i] && i > 0) inputsRef.current[i - 1]?.focus();
  };

  const onPaste = (e: React.ClipboardEvent) => {
    const digits = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (digits.length) {
      e.preventDefault();
      const arr = digits.split("");
      const filled = [...Array(6)].map((_, i) => arr[i] ?? "");
      setCode(filled);
      if (filled.every((d) => d !== "")) void submitCode(filled.join(""));
    }
  };

  const oauth = (provider: "discord" | "github") => {
    window.location.href = `/api/auth/oauth/${provider}`;
  };

  return (
    <AnimatePresence mode="wait" initial={false}>
      {step === "email" ? (
        <motion.div
          key="email"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={transition}
        >
          <div className="mb-6 text-center">
            <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
            <p className="mt-2 text-sm text-white/55">{subtitle}</p>
          </div>

          <form onSubmit={sendCode} className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3">
              <button type="button" onClick={() => oauth("discord")} disabled={busy} className={social}>
                <DiscordIcon />
                Discord
              </button>
              <button type="button" onClick={() => oauth("github")} disabled={busy} className={social}>
                <GithubIcon />
                GitHub
              </button>
            </div>

            <div className="flex items-center gap-3 text-xs text-white/30">
              <span className="h-px flex-1 bg-white/10" />
              {t("auth.form.divider")}
              <span className="h-px flex-1 bg-white/10" />
            </div>

            {mode === "register" && (
              <label className="flex flex-col gap-2">
                <span className="text-sm font-medium text-white/70">{t("auth.form.nameLabel")}</span>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t("auth.form.namePlaceholder")}
                  autoComplete="name"
                  className="h-11 rounded-xl border border-white/10 bg-white/[0.03] px-4 text-sm outline-none placeholder:text-white/35 focus:border-white/30"
                />
              </label>
            )}

            <label className="flex flex-col gap-2">
              <span className="text-sm font-medium text-white/70">{t("auth.form.emailLabel")}</span>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t("auth.form.emailPlaceholder")}
                autoComplete="email"
                className="h-11 rounded-xl border border-white/10 bg-white/[0.03] px-4 text-sm outline-none placeholder:text-white/35 focus:border-white/30"
              />
            </label>

            {error && (
              <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={busy}
              className="relative inline-flex h-10 w-full items-center justify-center rounded-xl border border-neutral-950 bg-neutral-900 px-3 text-sm font-medium text-white shadow-(--shadow-control-filled) transition-colors hover:bg-neutral-800 disabled:pointer-events-none disabled:opacity-50"
            >
              {busy ? t("auth.form.loading") : t("auth.form.sendCode")}
            </button>
          </form>
        </motion.div>
      ) : step === "code" ? (
        <motion.div
          key="code"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={transition}
          className="flex flex-col gap-5"
        >
          <div className="text-center">
            <p className="text-sm text-white/55">{t("auth.form.codeSentTo")}</p>
            <p className="mt-0.5 text-sm">
              <span className="font-medium text-white">{email}</span>{" "}
              <button
                type="button"
                onClick={() => {
                  setStep("email");
                  setCode(Array(6).fill(""));
                  setError(null);
                }}
                className="text-white/50 underline underline-offset-4 transition-colors hover:text-white"
              >
                {t("auth.form.edit")}
              </button>
            </p>
          </div>

          <div className="flex justify-center gap-2" onPaste={onPaste}>
            {code.map((d, i) => (
              <input
                key={i}
                ref={(el) => {
                  inputsRef.current[i] = el;
                }}
                value={d}
                onChange={(e) => setDigit(i, e.target.value)}
                onKeyDown={(e) => handleKey(i, e)}
                inputMode="numeric"
                maxLength={1}
                disabled={busy}
                className="h-12 w-11 rounded-xl border border-white/10 bg-white/[0.03] text-center text-lg font-semibold outline-none focus:border-white/30 disabled:opacity-60"
              />
            ))}
          </div>

          {error && (
            <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-center text-sm text-red-300">
              {error}
            </p>
          )}

          <p className="text-center text-xs text-white/40">
            {t("auth.form.notReceived")}{" "}
            <button
              type="button"
              onClick={() => void sendCode()}
              disabled={busy}
              className="font-medium text-white/70 underline-offset-4 hover:underline disabled:opacity-50"
            >
              {t("auth.form.resend")}
            </button>
          </p>

          <button
            type="button"
            onClick={() => {
              setStep("backup");
              setError(null);
            }}
            className="text-center text-xs font-medium text-white/55 underline-offset-4 transition-colors hover:text-white hover:underline"
          >
            {t("auth.form.tryAnotherWay")}
          </button>
        </motion.div>
      ) : (
        <motion.div
          key="backup"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={transition}
          className="flex flex-col gap-5"
        >
          <div className="text-center">
            <h2 className="text-lg font-semibold tracking-tight">{t("auth.form.backupTitle")}</h2>
            <p className="mt-1 text-sm text-white/55">{t("auth.form.backupSubtitle")}</p>
          </div>

          <form onSubmit={submitBackup} className="flex flex-col gap-4">
            <input
              value={backupCode}
              onChange={(e) => setBackupCode(e.target.value.toUpperCase())}
              placeholder={t("auth.form.backupPlaceholder")}
              autoComplete="one-time-code"
              maxLength={8}
              autoFocus
              className="h-12 rounded-xl border border-white/10 bg-white/[0.03] text-center text-lg font-semibold tracking-[0.3em] outline-none placeholder:tracking-normal placeholder:text-white/30 focus:border-white/30"
            />

            {error && (
              <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-center text-sm text-red-300">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={busy || backupCode.trim().length < 8}
              className="relative inline-flex h-10 w-full items-center justify-center rounded-xl border border-neutral-950 bg-neutral-900 px-3 text-sm font-medium text-white transition-colors hover:bg-neutral-800 disabled:pointer-events-none disabled:opacity-50"
            >
              {busy ? t("auth.form.loading") : t("auth.form.confirm")}
            </button>
          </form>

          <button
            type="button"
            onClick={() => {
              setStep("code");
              setBackupCode("");
              setError(null);
            }}
            className="text-center text-xs font-medium text-white/55 underline-offset-4 transition-colors hover:text-white hover:underline"
          >
            {t("auth.form.useEmailCode")}
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
