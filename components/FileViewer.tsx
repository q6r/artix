"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  Code2,
  Download,
  Eye,
  History,
  Save,
  SplitSquareHorizontal,
  X,
} from "lucide-react";
import { CodeComparison } from "@/components/ui/code-comparison";
import { useLang } from "@/components/LanguageProvider";
import type { FileNode } from "@/lib/dashboard";

type Kind = "image" | "video" | "text";

function kindOf(name: string): Kind {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (["png", "jpg", "jpeg", "gif", "webp", "svg", "avif"].includes(ext))
    return "image";
  if (["mp4", "webm", "mov", "m4v", "ogg"].includes(ext)) return "video";
  return "text";
}

function langFor(name: string) {
  const ext = name.split(".").pop()?.toLowerCase();
  const map: Record<string, string> = {
    yml: "yaml",
    yaml: "yaml",
    conf: "ini",
    env: "bash",
    sh: "bash",
    html: "html",
    json: "json",
    js: "javascript",
    ts: "typescript",
    css: "css",
    log: "text",
  };
  return map[ext ?? ""] ?? "text";
}

function mockContent(name: string) {
  const ext = name.split(".").pop()?.toLowerCase();
  if (ext === "yml" || ext === "yaml")
    return `services:\n  web:\n    image: nginx:latest\n    ports:\n      - "80:80"\n    restart: always\n  db:\n    image: postgres:16\n    environment:\n      POSTGRES_PASSWORD: secret\n`;
  if (ext === "conf")
    return `server {\n  listen 80;\n  server_name artixcloud.com;\n  location / {\n    proxy_pass http://127.0.0.1:3000;\n  }\n}\n`;
  if (ext === "env")
    return `NODE_ENV=production\nPORT=3000\nDATABASE_URL=postgres://user:pass@localhost:5432/app\n`;
  if (ext === "html")
    return `<!doctype html>\n<html>\n  <head><title>ArtixCloud</title></head>\n  <body>\n    <h1>Olá da VPS 🚀</h1>\n    <p>Servido pela ArtixCloud.</p>\n  </body>\n</html>\n`;
  if (ext === "json")
    return `{\n  "name": "app",\n  "version": "1.0.0",\n  "scripts": { "start": "node server.js" }\n}\n`;
  if (ext === "log")
    return `[12:01:22] INFO  server iniciado na porta 3000\n[12:03:10] INFO  GET / 200 12ms\n[12:05:41] WARN  uso de memória em 78%\n[12:08:03] INFO  GET /api 200 8ms\n`;
  return `# ${name}\n\nConteúdo do arquivo.\n`;
}

const history = [
  { id: "v4", timeKey: "dash.fileViewer.time.2h", author: "Brunno", msgKey: "dash.fileViewer.history.v4" },
  { id: "v3", timeKey: "dash.fileViewer.time.yesterday", author: "Ana Souza", msgKey: "dash.fileViewer.history.v3" },
  { id: "v2", timeKey: "dash.fileViewer.time.3days", author: "Brunno", msgKey: "dash.fileViewer.history.v2" },
  { id: "v1", timeKey: "dash.fileViewer.time.12days", author: "Brunno", msgKey: "dash.fileViewer.history.v1" },
];

const textTabs = [
  { id: "editor", labelKey: "dash.fileViewer.tab.editor", icon: Code2 },
  { id: "preview", labelKey: "dash.fileViewer.tab.preview", icon: Eye },
  { id: "diff", labelKey: "dash.fileViewer.tab.diff", icon: SplitSquareHorizontal },
  { id: "history", labelKey: "dash.fileViewer.tab.history", icon: History },
] as const;

const mediaTabs = [
  { id: "preview", labelKey: "dash.fileViewer.tab.preview", icon: Eye },
  { id: "history", labelKey: "dash.fileViewer.tab.history", icon: History },
] as const;

export default function FileViewer({
  file,
  onClose,
}: {
  file: FileNode;
  onClose: () => void;
}) {
  const { t } = useLang();
  const kind = kindOf(file.name);
  const isMedia = kind !== "text";
  const src = file.src ?? `/${file.name}`;

  const tabs = isMedia ? mediaTabs : textTabs;
  const [tab, setTab] = useState<string>(isMedia ? "preview" : "editor");

  const base = isMedia ? "" : mockContent(file.name);
  const [original, setOriginal] = useState(base);
  const [content, setContent] = useState(base);
  const lang = langFor(file.name);
  const dirty = content !== original;

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4"
        onClick={onClose}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
      >
        <motion.div
          onClick={(e) => e.stopPropagation()}
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.96 }}
          transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          className="flex h-[min(88vh,760px)] w-[min(96vw,1100px)] flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#0a0a0a]"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
            <div className="flex items-center gap-2 font-mono text-sm">
              <Code2 className="h-4 w-4 text-white/50" />
              {file.name}
              {dirty && <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />}
            </div>
            <div className="flex items-center gap-2">
              {isMedia ? (
                <a
                  href={src}
                  download={file.name}
                  className="flex h-8 items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 text-sm transition-colors hover:bg-white/10"
                >
                  <Download className="h-4 w-4" /> {t("dash.fileViewer.download")}
                </a>
              ) : (
                <button
                  onClick={() => setOriginal(content)}
                  disabled={!dirty}
                  className="flex h-8 items-center gap-2 rounded-lg bg-white px-3 text-sm font-medium text-black transition-colors hover:bg-white/85 disabled:opacity-40"
                >
                  <Save className="h-4 w-4" /> {t("dash.fileViewer.save")}
                </button>
              )}
              <button
                onClick={onClose}
                aria-label={t("dash.fileViewer.close")}
                className="rounded-md p-1.5 text-white/50 transition-colors hover:bg-white/10 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 border-b border-white/10 px-2">
            {tabs.map((tb) => (
              <button
                key={tb.id}
                onClick={() => setTab(tb.id)}
                className={`relative flex items-center gap-2 px-3 py-2.5 text-sm font-medium transition-colors ${
                  tab === tb.id ? "text-white" : "text-white/50 hover:text-white"
                }`}
              >
                <tb.icon className="h-4 w-4" strokeWidth={1.7} />
                {t(tb.labelKey)}
                {tab === tb.id && (
                  <motion.span
                    layoutId="file-tab"
                    className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-white"
                  />
                )}
              </button>
            ))}
          </div>

          {/* Content */}
          <div className="min-h-0 flex-1 overflow-auto">
            {tab === "preview" && kind === "image" && (
              <div className="flex h-full items-center justify-center bg-[radial-gradient(circle,rgba(255,255,255,0.04),transparent)] p-6">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={src}
                  alt={file.name}
                  className="max-h-full max-w-full rounded-lg object-contain"
                />
              </div>
            )}

            {tab === "preview" && kind === "video" && (
              <div className="flex h-full items-center justify-center bg-black p-6">
                <video
                  src={src}
                  controls
                  className="max-h-full max-w-full rounded-lg"
                />
              </div>
            )}

            {tab === "preview" &&
              kind === "text" &&
              (langFor(file.name) === "html" ? (
                <iframe
                  title="preview"
                  sandbox=""
                  srcDoc={content}
                  className="h-full w-full bg-white"
                />
              ) : (
                <pre className="h-full w-full overflow-auto p-4 font-mono text-xs leading-relaxed text-white/80">
                  {content}
                </pre>
              ))}

            {tab === "editor" && (
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                spellCheck={false}
                className="h-full w-full resize-none bg-[#0a0a0a] p-4 font-mono text-xs leading-relaxed text-white/90 outline-none"
              />
            )}

            {tab === "diff" && (
              <div className="p-4">
                <CodeComparison
                  beforeCode={original}
                  afterCode={content}
                  language={lang}
                  filename={file.name}
                  lightTheme="github-dark"
                  darkTheme="github-dark"
                />
                {!dirty && (
                  <p className="mt-3 text-center text-xs text-white/40">
                    {t("dash.fileViewer.diffHint")}
                  </p>
                )}
              </div>
            )}

            {tab === "history" && (
              <div className="p-6">
                <ol className="relative ml-2 border-l border-white/10">
                  {history.map((h, i) => (
                    <li key={h.id} className="mb-6 ml-6 last:mb-0">
                      <span className="absolute -left-[7px] mt-1 h-3 w-3 rounded-full border-2 border-[#0a0a0a] bg-white" />
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-medium">{t(h.msgKey)}</p>
                        {i !== 0 && (
                          <button className="rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-xs text-white/60 transition-colors hover:bg-white/10">
                            {t("dash.fileViewer.restore")}
                          </button>
                        )}
                      </div>
                      <p className="mt-0.5 text-xs text-white/45">
                        {h.author} · {t(h.timeKey)} · {h.id}
                      </p>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
