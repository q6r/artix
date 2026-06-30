"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import {
  Folder,
  FileText,
  ArrowUp,
  RotateCw,
  Plus,
  FolderPlus,
  Trash2,
  Save,
  X,
  Pencil,
  Download,
  FolderInput,
  SquarePen,
} from "lucide-react";
import FadeIn from "@/components/FadeIn";
import RowMenu from "@/components/RowMenu";
import Sheet from "@/components/ui/Sheet";
import { useLang } from "@/components/LanguageProvider";
import { api, ApiError } from "@/lib/api/client";
import { useQuery, mutate } from "@/lib/api/query";

type Entry = { name: string; kind: string; size: number; mtime: number };
type Listing = { path: string; entries: Entry[] };
type DialogMode = "newFile" | "newFolder" | "rename" | "move";
type Dialog = { mode: DialogMode; value: string; entry?: Entry };

function joinPath(base: string, name: string) {
  return `${base.replace(/\/+$/, "")}/${name}`;
}
function parentOf(p: string) {
  if (p === "/" || !p.includes("/")) return "/";
  const up = p.replace(/\/+$/, "").replace(/\/[^/]*$/, "");
  return up === "" ? "/" : up;
}
function fmtSize(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
function crumbsOf(p: string): { name: string; path: string }[] {
  const out = [{ name: "/", path: "/" }];
  let acc = "";
  for (const seg of p.split("/").filter(Boolean)) {
    acc += `/${seg}`;
    out.push({ name: seg, path: acc });
  }
  return out;
}

const backdrop = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: 0.15 },
};
const card = {
  initial: { opacity: 0, scale: 0.96, y: 10 },
  animate: { opacity: 1, scale: 1, y: 0 },
  exit: { opacity: 0, scale: 0.96, y: 10 },
  transition: { duration: 0.18, ease: [0.22, 1, 0.36, 1] as const },
};

export default function VmFiles({ id }: { id: string }) {
  const { t, locale } = useLang();
  const [mounted, setMounted] = useState(false);
  const [path, setPath] = useState("/root");
  const key = `servers/${id}/files?path=${encodeURIComponent(path)}`;
  const { data, error, loading } = useQuery<Listing>(key);

  const [editing, setEditing] = useState<{ path: string; content: string } | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [confirmEntry, setConfirmEntry] = useState<Entry | null>(null);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!toast) return;
    const h = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(h);
  }, [toast]);

  const fail = (e: unknown) => setToast(e instanceof ApiError ? e.message : t("srv.files.error"));
  const refresh = () => mutate(key);

  const open = async (e: Entry) => {
    const full = joinPath(path, e.name);
    if (e.kind === "dir") return setPath(full);
    try {
      const r = await api<{ path: string; content: string }>(
        `servers/${id}/files/content?path=${encodeURIComponent(full)}`,
      );
      setEditing({ path: full, content: r.content });
    } catch (e) {
      fail(e);
    }
  };

  const download = async (e: Entry) => {
    try {
      const full = joinPath(path, e.name);
      const r = await api<{ content: string }>(
        `servers/${id}/files/content?path=${encodeURIComponent(full)}`,
      );
      const url = URL.createObjectURL(new Blob([r.content]));
      const a = document.createElement("a");
      a.href = url;
      a.download = e.name;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      fail(e);
    }
  };

  const move = async (from: string, to: string) => {
    if (from === to || to === joinPath(parentOf(from), from.split("/").pop() || "")) return;
    try {
      await api(`servers/${id}/files/move`, { method: "POST", json: { from, to } });
      refresh();
    } catch (e) {
      fail(e);
    }
  };

  const onDropInto = (destDir: string) => {
    if (!drag) return;
    const from = joinPath(path, drag);
    setDrag(null);
    setOver(null);
    if (from === destDir) return; // can't drop a folder into itself
    move(from, destDir);
  };

  const submitDialog = async () => {
    if (!dialog || busy) return;
    const name = dialog.value.trim();
    if (!name) return;
    setBusy(true);
    try {
      if (dialog.mode === "newFile" || dialog.mode === "newFolder") {
        await api(`servers/${id}/files`, {
          method: "POST",
          json: { path: joinPath(path, name), dir: dialog.mode === "newFolder" },
        });
      } else if (dialog.mode === "rename" && dialog.entry) {
        await api(`servers/${id}/files/move`, {
          method: "POST",
          json: { from: joinPath(path, dialog.entry.name), to: joinPath(path, name) },
        });
      } else if (dialog.mode === "move" && dialog.entry) {
        await api(`servers/${id}/files/move`, {
          method: "POST",
          json: { from: joinPath(path, dialog.entry.name), to: name },
        });
      }
      setDialog(null);
      refresh();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const doDelete = async () => {
    if (!confirmEntry || busy) return;
    setBusy(true);
    try {
      await api(`servers/${id}/files?path=${encodeURIComponent(joinPath(path, confirmEntry.name))}`, {
        method: "DELETE",
      });
      setConfirmEntry(null);
      refresh();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const saveEditor = async () => {
    if (!editing || busy) return;
    setBusy(true);
    try {
      await api(`servers/${id}/files/content`, {
        method: "POST",
        json: { path: editing.path, content: editing.content },
      });
      setEditing(null);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const crumbs = crumbsOf(path);

  return (
    <FadeIn className="space-y-3">
      {/* Toolbar + breadcrumb */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => setPath(parentOf(path))}
          disabled={path === "/"}
          className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/5 transition-colors hover:bg-white/10 disabled:opacity-40"
          aria-label="up"
        >
          <ArrowUp className="h-4 w-4" />
        </button>

        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto rounded-xl border border-white/10 bg-black/40 px-2 py-1.5 font-mono text-xs">
          {crumbs.map((c, i) => (
            <span key={c.path} className="flex items-center gap-1">
              {i > 0 && <span className="text-white/25">/</span>}
              <button
                onClick={() => setPath(c.path)}
                onDragOver={(ev) => {
                  if (drag) {
                    ev.preventDefault();
                    setOver(c.path);
                  }
                }}
                onDragLeave={() => setOver((o) => (o === c.path ? null : o))}
                onDrop={(ev) => {
                  ev.preventDefault();
                  onDropInto(c.path);
                }}
                className={`rounded px-1.5 py-0.5 transition-colors ${
                  over === c.path
                    ? "bg-sky-500/30 text-white"
                    : "text-white/60 hover:text-white"
                }`}
              >
                {c.name === "/" ? "root" : c.name}
              </button>
            </span>
          ))}
        </div>

        <button
          onClick={refresh}
          className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/5 transition-colors hover:bg-white/10"
          aria-label={t("srv.files.refresh")}
        >
          <RotateCw className="h-4 w-4" />
        </button>
        <button
          onClick={() => setDialog({ mode: "newFile", value: "" })}
          className="inline-flex h-9 items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 text-sm transition-colors hover:bg-white/10"
        >
          <Plus className="h-4 w-4" /> {t("srv.files.newFile")}
        </button>
        <button
          onClick={() => setDialog({ mode: "newFolder", value: "" })}
          className="inline-flex h-9 items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 text-sm transition-colors hover:bg-white/10"
        >
          <FolderPlus className="h-4 w-4" /> {t("srv.files.newFolder")}
        </button>
      </div>

      {/* List */}
      {loading ? (
        <div className="overflow-hidden rounded-2xl border border-white/10">
          {Array.from({ length: 7 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center gap-3 border-b border-white/5 px-4 py-3 last:border-0"
            >
              <div className="h-4 w-4 animate-pulse rounded bg-white/10" />
              <div
                className="h-3.5 animate-pulse rounded bg-white/10"
                style={{ width: `${110 + ((i * 37) % 160)}px` }}
              />
              <div className="ml-auto h-3 w-12 animate-pulse rounded bg-white/10" />
            </div>
          ))}
        </div>
      ) : error ? (
        <p className="text-sm text-red-300">{t("srv.files.error")}</p>
      ) : data ? (
        <div className="overflow-hidden rounded-2xl border border-white/10">
          {data.entries.length === 0 ? (
            <p className="bg-white/[0.02] p-6 text-center text-sm text-white/40">
              {t("srv.files.empty")}
            </p>
          ) : (
            data.entries.map((e) => {
              const isDir = e.kind === "dir";
              const target = joinPath(path, e.name);
              const items = [
                ...(isDir
                  ? []
                  : [
                      {
                        label: t("srv.files.edit"),
                        icon: <SquarePen className="h-4 w-4" />,
                        onClick: () => open(e),
                      },
                      {
                        label: t("srv.files.download"),
                        icon: <Download className="h-4 w-4" />,
                        onClick: () => download(e),
                      },
                    ]),
                {
                  label: t("srv.files.rename"),
                  icon: <Pencil className="h-4 w-4" />,
                  onClick: () => setDialog({ mode: "rename", value: e.name, entry: e }),
                },
                {
                  label: t("srv.files.move"),
                  icon: <FolderInput className="h-4 w-4" />,
                  onClick: () => setDialog({ mode: "move", value: path, entry: e }),
                },
                {
                  label: t("srv.files.delete"),
                  icon: <Trash2 className="h-4 w-4" />,
                  onClick: () => setConfirmEntry(e),
                  danger: true,
                },
              ];
              return (
                <div
                  key={e.name}
                  draggable
                  onDragStart={() => setDrag(e.name)}
                  onDragEnd={() => {
                    setDrag(null);
                    setOver(null);
                  }}
                  onDragOver={(ev) => {
                    if (isDir && drag && drag !== e.name) {
                      ev.preventDefault();
                      setOver(target);
                    }
                  }}
                  onDragLeave={() => setOver((o) => (o === target ? null : o))}
                  onDrop={(ev) => {
                    if (isDir) {
                      ev.preventDefault();
                      onDropInto(target);
                    }
                  }}
                  className={`flex cursor-grab items-center gap-3 border-b border-white/5 bg-white/[0.02] px-4 py-2.5 transition-colors last:border-0 active:cursor-grabbing ${
                    over === target ? "bg-sky-500/15 ring-1 ring-inset ring-sky-500/40" : "hover:bg-white/[0.04]"
                  } ${drag === e.name ? "opacity-50" : ""}`}
                >
                  <button
                    onClick={() => open(e)}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  >
                    {isDir ? (
                      <Folder className="h-4 w-4 shrink-0 text-sky-400" />
                    ) : (
                      <FileText className="h-4 w-4 shrink-0 text-white/45" />
                    )}
                    <span className="truncate text-sm">{e.name}</span>
                  </button>
                  <span className="shrink-0 text-xs text-white/35">
                    {isDir ? "" : fmtSize(e.size)}
                  </span>
                  <span className="hidden shrink-0 text-xs text-white/35 sm:block">
                    {e.mtime ? new Date(e.mtime * 1000).toLocaleDateString(locale) : ""}
                  </span>
                  <RowMenu items={items} />
                </div>
              );
            })
          )}
        </div>
      ) : null}

      {/* Overlays (portaled, animated) */}
      {mounted &&
        createPortal(
          <>
            <AnimatePresence>
              {editing && (
                <motion.div
                  key="editor"
                  {...backdrop}
                  className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4"
                  onClick={() => setEditing(null)}
                >
                  <motion.div
                    {...card}
                    onClick={(ev) => ev.stopPropagation()}
                    className="flex h-[80vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-neutral-950 shadow-2xl"
                  >
                    <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
                      <span className="truncate font-mono text-xs text-white/70">
                        {editing.path}
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={saveEditor}
                          disabled={busy}
                          className="inline-flex h-8 items-center gap-2 rounded-lg bg-white px-3 text-sm font-medium text-black transition-colors hover:bg-white/85 disabled:opacity-50"
                        >
                          <Save className="h-4 w-4" /> {t("srv.files.save")}
                        </button>
                        <button
                          onClick={() => setEditing(null)}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 text-white/60 hover:text-white"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                    <textarea
                      value={editing.content}
                      onChange={(ev) => setEditing({ ...editing, content: ev.target.value })}
                      spellCheck={false}
                      className="flex-1 resize-none bg-neutral-950 p-4 font-mono text-[13px] leading-relaxed text-white/90 outline-none"
                    />
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>

            <AnimatePresence>
              {toast && (
                <motion.div
                  key="toast"
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 16 }}
                  transition={{ duration: 0.18 }}
                  className="fixed bottom-6 left-1/2 z-[110] max-w-md -translate-x-1/2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200 shadow-2xl backdrop-blur"
                >
                  {toast}
                </motion.div>
              )}
            </AnimatePresence>
          </>,
          document.body,
        )}

      {/* New / rename dialog — bottom sheet on mobile */}
      <Sheet
        open={!!dialog}
        onClose={() => setDialog(null)}
        title={dialog ? t(`srv.files.${dialog.mode}`) : undefined}
      >
        {dialog && (
          <>
            <input
              autoFocus
              value={dialog.value}
              onChange={(ev) => setDialog({ ...dialog, value: ev.target.value })}
              onKeyDown={(ev) => ev.key === "Enter" && submitDialog()}
              spellCheck={false}
              className="h-11 w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 font-mono text-sm outline-none focus:border-white/30"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setDialog(null)}
                className="inline-flex h-9 items-center rounded-xl border border-white/10 px-4 text-sm text-white/70 transition-colors hover:bg-white/5"
              >
                {t("srv.files.cancel")}
              </button>
              <button
                onClick={submitDialog}
                disabled={busy || !dialog.value.trim()}
                className="inline-flex h-9 items-center rounded-xl bg-white px-4 text-sm font-medium text-black transition-colors hover:bg-white/85 disabled:opacity-50"
              >
                {t("srv.files.confirm")}
              </button>
            </div>
          </>
        )}
      </Sheet>

      {/* Delete confirmation — bottom sheet on mobile */}
      <Sheet
        open={!!confirmEntry}
        onClose={() => setConfirmEntry(null)}
        title={t("srv.files.delete")}
      >
        {confirmEntry && (
          <>
            <p className="text-sm text-white/60">
              {t("srv.files.confirmDelete")}{" "}
              <span className="font-mono text-white/80">{confirmEntry.name}</span>
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setConfirmEntry(null)}
                className="inline-flex h-9 items-center rounded-xl border border-white/10 px-4 text-sm text-white/70 transition-colors hover:bg-white/5"
              >
                {t("srv.files.cancel")}
              </button>
              <button
                onClick={doDelete}
                disabled={busy}
                className="inline-flex h-9 items-center gap-2 rounded-xl border border-red-500/40 bg-red-500/10 px-4 text-sm font-medium text-red-300 transition-colors hover:bg-red-500/20 disabled:opacity-50"
              >
                <Trash2 className="h-4 w-4" /> {t("srv.files.delete")}
              </button>
            </div>
          </>
        )}
      </Sheet>
    </FadeIn>
  );
}
