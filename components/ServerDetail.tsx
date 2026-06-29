"use client";

import { useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowLeft,
  Building2,
  ChevronRight,
  Cpu,
  Download,
  File as FileIcon,
  FilePlus,
  Folder,
  FolderInput,
  FolderPlus,
  Globe,
  HardDrive,
  KeyRound,
  MemoryStick,
  Network,
  Pencil,
  Power,
  RotateCw,
  Save,
  TerminalSquare,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import UsageChart from "@/components/UsageChart";
import RowMenu from "@/components/RowMenu";
import FileViewer from "@/components/FileViewer";
import { useLang } from "@/components/LanguageProvider";
import {
  type Server,
  type FileNode,
  organizations,
  serverMetrics,
  statusStyles,
} from "@/lib/dashboard";

const tabs = [
  { id: "overview", labelKey: "dash.serverDetail.tab.overview" },
  { id: "metrics", labelKey: "dash.serverDetail.tab.metrics" },
  { id: "console", labelKey: "dash.serverDetail.tab.console" },
  { id: "files", labelKey: "dash.serverDetail.tab.files" },
  { id: "settings", labelKey: "dash.serverDetail.tab.settings" },
] as const;

type TabId = (typeof tabs)[number]["id"];

const metricMeta = [
  { key: "cpu", labelKey: "dash.serverDetail.metric.cpu", color: "#38bdf8", icon: Cpu, unit: "%" },
  { key: "ram", labelKey: "dash.serverDetail.metric.memory", color: "#a78bfa", icon: MemoryStick, unit: "%" },
  { key: "disk", labelKey: "dash.serverDetail.metric.disk", color: "#34d399", icon: HardDrive, unit: "%" },
  { key: "net", labelKey: "dash.serverDetail.metric.network", color: "#fbbf24", icon: Network, unit: "Mbps" },
] as const;

export default function ServerDetail({ server }: { server: Server }) {
  const { t } = useLang();
  const [tab, setTab] = useState<TabId>("overview");
  const [name, setName] = useState(server.name);
  const m = serverMetrics(server);
  const org = organizations.find((o) => o.serverIds.includes(server.id));

  return (
    <div className="space-y-6">
      <Link
        href="/dashboard/servers"
        className="inline-flex items-center gap-1.5 text-sm text-white/55 transition-colors hover:text-white"
      >
        <ArrowLeft className="h-4 w-4" />
        {t("dash.serverDetail.back")}
      </Link>

      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/10 bg-white/5">
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
          </span>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold tracking-tight">{name}</h1>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusStyles[server.status]}`}
              >
                {t(`dash.status.${server.status}`)}
              </span>
            </div>
            <p className="text-xs text-white/45">
              {server.ip} · {server.region}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="flex h-9 items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 text-sm transition-colors hover:bg-white/10">
            <RotateCw className="h-4 w-4" strokeWidth={1.6} /> {t("dash.serverDetail.reboot")}
          </button>
          <button className="flex h-9 items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 text-sm transition-colors hover:bg-white/10">
            <Power className="h-4 w-4" strokeWidth={1.6} /> {t("dash.serverDetail.shutdown")}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="no-scrollbar flex gap-1 overflow-x-auto border-b border-white/10">
        {tabs.map((tb) => (
          <button
            key={tb.id}
            onClick={() => setTab(tb.id)}
            className={`relative whitespace-nowrap px-3 py-2.5 text-sm font-medium transition-colors ${
              tab === tb.id ? "text-white" : "text-white/50 hover:text-white"
            }`}
          >
            {t(tb.labelKey)}
            {tab === tb.id && (
              <motion.span
                layoutId="server-tab"
                className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-white"
              />
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      <AnimatePresence mode="wait">
        <motion.div
          key={tab}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.18 }}
        >
          {tab === "overview" && <Overview server={server} org={org} />}
          {tab === "metrics" && <Metrics m={m} />}
          {tab === "console" && <Console name={name} />}
          {tab === "files" && <Files />}
          {tab === "settings" && (
            <SettingsTab name={name} setName={setName} server={server} />
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

/* ------------------------------- Overview -------------------------------- */

function Overview({
  server,
  org,
}: {
  server: Server;
  org?: (typeof organizations)[number];
}) {
  const { t } = useLang();
  const specs = [
    { label: t("dash.serverDetail.spec.vcpu"), value: `${server.specs.vcpu} ${t("dash.serverDetail.spec.cores")}`, icon: Cpu },
    { label: t("dash.serverDetail.spec.memory"), value: `${server.specs.ram} GB`, icon: MemoryStick },
    { label: t("dash.serverDetail.spec.disk"), value: `${server.specs.disk} GB`, icon: HardDrive },
    { label: t("dash.serverDetail.spec.network"), value: server.bandwidth, icon: Globe },
  ];
  const usage = [
    { label: t("dash.serverDetail.usage.cpu"), value: server.usage.cpu },
    { label: t("dash.serverDetail.usage.memory"), value: server.usage.ram },
    { label: t("dash.serverDetail.usage.disk"), value: server.usage.disk },
  ];
  const info = [
    { label: t("dash.serverDetail.info.ip"), value: server.ip },
    { label: t("dash.serverDetail.info.system"), value: server.os },
    { label: t("dash.serverDetail.info.region"), value: server.region },
    { label: t("dash.serverDetail.info.plan"), value: server.plan },
    { label: t("dash.serverDetail.info.created"), value: server.created },
  ];
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {specs.map((s) => (
          <div
            key={s.label}
            className="rounded-2xl border border-white/10 bg-white/[0.02] p-5"
          >
            <div className="flex items-center justify-between text-white/50">
              <span className="text-xs">{s.label}</span>
              <s.icon className="h-4 w-4" strokeWidth={1.6} />
            </div>
            <p className="mt-3 text-lg font-semibold tracking-tight">
              {s.value}
            </p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-5 rounded-2xl border border-white/10 bg-white/[0.02] p-6">
          <h2 className="font-semibold tracking-tight">{t("dash.serverDetail.currentUsage")}</h2>
          {usage.map((u) => (
            <div key={u.label}>
              <div className="mb-2 flex justify-between text-sm">
                <span className="text-white/60">{u.label}</span>
                <span className="font-medium">{u.value}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-white"
                  style={{ width: `${u.value}%` }}
                />
              </div>
            </div>
          ))}
        </div>

        <div className="space-y-4">
          <dl className="overflow-hidden rounded-2xl border border-white/10 divide-y divide-white/10">
            {info.map((i) => (
              <div
                key={i.label}
                className="flex items-center justify-between bg-white/[0.02] px-4 py-3 text-sm"
              >
                <dt className="text-white/50">{i.label}</dt>
                <dd className="font-medium">{i.value}</dd>
              </div>
            ))}
          </dl>
          {org && (
            <Link
              href={`/dashboard/organizations/${org.id}`}
              className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.02] p-4 transition-colors hover:bg-white/[0.04]"
            >
              <Building2 className="h-5 w-5 text-white/60" strokeWidth={1.6} />
              <div className="min-w-0 flex-1">
                <p className="text-xs text-white/45">{t("dash.serverDetail.organization")}</p>
                <p className="truncate text-sm font-medium">{org.name}</p>
              </div>
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

/* -------------------------------- Metrics -------------------------------- */

function Metrics({ m }: { m: ReturnType<typeof serverMetrics> }) {
  const { t } = useLang();
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {metricMeta.map((meta) => {
        const data = m[meta.key];
        const current = data[data.length - 1];
        return (
          <div
            key={meta.key}
            className="rounded-2xl border border-white/10 bg-white/[0.02] p-5"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-white/60">
                <meta.icon className="h-4 w-4" strokeWidth={1.6} />
                <span className="text-sm">{t(meta.labelKey)}</span>
              </div>
              <span className="text-lg font-semibold tracking-tight">
                {current}
                <span className="ml-0.5 text-xs font-normal text-white/45">
                  {meta.unit}
                </span>
              </span>
            </div>
            <div className="mt-4">
              <UsageChart data={data} color={meta.color} id={meta.key} />
            </div>
            <p className="mt-2 text-xs text-white/35">{t("dash.serverDetail.last24h")}</p>
          </div>
        );
      })}
    </div>
  );
}

/* -------------------------------- Console -------------------------------- */

function fakeRun(cmd: string, t: (key: string) => string): string[] {
  const c = cmd.trim().toLowerCase();
  if (c === "help")
    return [t("dash.serverDetail.console.commands")];
  if (c === "ls") return ["etc  home  var  opt  docker-compose.yml  app.log"];
  if (c === "uptime") return ["up 14 days, 3:21, load average: 0.42, 0.38, 0.31"];
  if (c === "free")
    return ["              total        used        free", "Mem:           16Gi        6.2Gi       9.8Gi"];
  if (c === "whoami") return ["root"];
  return [`bash: ${cmd}: ${t("dash.serverDetail.console.notFound")}`];
}

function Console({ name }: { name: string }) {
  const { t } = useLang();
  const [lines, setLines] = useState<string[]>([
    `${t("dash.serverDetail.console.connected")} ${name} ${t("dash.serverDetail.console.connectedSuffix")}`,
    t("dash.serverDetail.console.help"),
  ]);
  const [cmd, setCmd] = useState("");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!cmd.trim()) return;
    if (cmd.trim().toLowerCase() === "clear") {
      setLines([]);
    } else {
      setLines((l) => [...l, `$ ${cmd}`, ...fakeRun(cmd, t)]);
    }
    setCmd("");
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-black">
      <div className="flex items-center gap-2 border-b border-white/10 px-4 py-2.5">
        <TerminalSquare className="h-4 w-4 text-white/50" strokeWidth={1.6} />
        <span className="text-xs text-white/50">{t("dash.serverDetail.console.title")} — {name}</span>
      </div>
      <div className="h-80 overflow-y-auto p-4 font-mono text-xs leading-relaxed">
        {lines.map((l, i) => (
          <div
            key={i}
            className={l.startsWith("$") ? "text-white" : "text-white/55"}
          >
            {l}
          </div>
        ))}
        <form onSubmit={submit} className="mt-1 flex items-center gap-2">
          <span className="text-emerald-400">$</span>
          <input
            autoFocus
            value={cmd}
            onChange={(e) => setCmd(e.target.value)}
            className="flex-1 bg-transparent text-white outline-none"
            placeholder={t("dash.serverDetail.console.placeholder")}
          />
        </form>
      </div>
    </div>
  );
}

/* --------------------------------- Files --------------------------------- */

const initialFs: Record<string, FileNode[]> = {
  "/": [
    { name: "etc", type: "dir", meta: "—" },
    { name: "home", type: "dir", meta: "—" },
    { name: "var", type: "dir", meta: "—" },
    { name: "uploads", type: "dir", meta: "4 itens" },
    { name: "docker-compose.yml", type: "file", meta: "1.2 KB" },
    { name: ".env", type: "file", meta: "640 B" },
    { name: "app.log", type: "file", meta: "4.8 MB" },
  ],
  "/uploads": [
    { name: "logo.svg", type: "file", meta: "4 KB", src: "/logo.svg" },
    {
      name: "auth-background.png",
      type: "file",
      meta: "1.2 MB",
      src: "/auth-background.png",
    },
    {
      name: "screen_loading.gif",
      type: "file",
      meta: "2.3 MB",
      src: "/screen_loading.gif",
    },
    { name: "demo.mp4", type: "file", meta: "5.1 MB", src: "/p.mp4" },
  ],
  "/etc": [
    { name: "nginx", type: "dir", meta: "—" },
    { name: "hosts", type: "file", meta: "312 B" },
    { name: "passwd", type: "file", meta: "1.1 KB" },
  ],
  "/etc/nginx": [
    { name: "sites-enabled", type: "dir", meta: "—" },
    { name: "nginx.conf", type: "file", meta: "3.1 KB" },
  ],
  "/home": [{ name: "deploy", type: "dir", meta: "—" }],
  "/var": [
    { name: "log", type: "dir", meta: "—" },
    { name: "www", type: "dir", meta: "—" },
  ],
  "/var/www": [{ name: "index.html", type: "file", meta: "2.4 KB" }],
};

function Files() {
  const { t } = useLang();
  const [fs, setFs] = useState<Record<string, FileNode[]>>(initialFs);
  const [path, setPath] = useState("/");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [moving, setMoving] = useState<FileNode | null>(null);
  const [viewing, setViewing] = useState<FileNode | null>(null);
  const [dragName, setDragName] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [dragCrumb, setDragCrumb] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const entries = fs[path] ?? [];
  const join = (p: string, n: string) => (p === "/" ? `/${n}` : `${p}/${n}`);
  const segments = path === "/" ? [] : path.slice(1).split("/");

  const del = (name: string) =>
    setFs((f) => ({
      ...f,
      [path]: (f[path] ?? []).filter((e) => e.name !== name),
    }));

  const startRename = (name: string) => {
    setRenaming(name);
    setDraft(name);
  };
  const commitRename = () => {
    if (!renaming) return;
    setFs((f) => ({
      ...f,
      [path]: (f[path] ?? []).map((e) =>
        e.name === renaming ? { ...e, name: draft.trim() || e.name } : e,
      ),
    }));
    setRenaming(null);
  };

  const doMove = (item: FileNode, dest: string) => {
    setFs((f) => {
      const next = { ...f };
      next[path] = (next[path] ?? []).filter((e) => e.name !== item.name);
      next[dest] = [...(next[dest] ?? []), item];
      return next;
    });
    setMoving(null);
  };

  const destinations = (item: FileNode) => {
    const own = join(path, item.name);
    return Object.keys(fs).filter(
      (p) =>
        p !== path &&
        !(item.type === "dir" && (p === own || p.startsWith(own + "/"))),
    );
  };

  const createItem = (type: "dir" | "file") => {
    const baseName = type === "dir" ? "nova-pasta" : "novo-arquivo.txt";
    const names = new Set(entries.map((e) => e.name));
    let name = baseName;
    let i = 2;
    while (names.has(name)) {
      name = type === "dir" ? `nova-pasta-${i}` : `novo-arquivo-${i}.txt`;
      i++;
    }
    setFs((f) => {
      const next: Record<string, FileNode[]> = {
        ...f,
        [path]: [
          { name, type, meta: type === "dir" ? "—" : "0 B" },
          ...(f[path] ?? []),
        ],
      };
      if (type === "dir") next[join(path, name)] = [];
      return next;
    });
    startRename(name);
  };

  const uploadFiles = (files: FileList) => {
    const added: FileNode[] = Array.from(files).map((file) => ({
      name: file.name,
      type: "file",
      meta: `${Math.max(1, Math.round(file.size / 1024))} KB`,
      src: URL.createObjectURL(file),
    }));
    if (added.length)
      setFs((f) => ({ ...f, [path]: [...(f[path] ?? []), ...added] }));
  };

  const onRowDrop = (folder: FileNode) => {
    if (dragName && dragName !== folder.name) {
      const item = entries.find((e) => e.name === dragName);
      if (item) doMove(item, join(path, folder.name));
    }
    setDragName(null);
    setDragOver(null);
  };

  const dropToCrumb = (dest: string) => {
    if (dragName && dest !== path) {
      const item = entries.find((e) => e.name === dragName);
      if (item) doMove(item, dest);
    }
    setDragName(null);
    setDragCrumb(null);
  };

  const crumbProps = (dest: string) => ({
    onDragOver: (e: React.DragEvent) => {
      if (dragName && dest !== path) {
        e.preventDefault();
        setDragCrumb(dest);
      }
    },
    onDragLeave: () => setDragCrumb(null),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      dropToCrumb(dest);
    },
    className: `rounded-md px-1.5 font-mono transition-colors ${
      dragCrumb === dest
        ? "bg-sky-400/20 text-white ring-1 ring-sky-400/50"
        : "text-white/60 hover:text-white"
    }`,
  });

  return (
    <div className="space-y-4">
      {/* Breadcrumb + actions */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-1 text-sm">
          <button onClick={() => setPath("/")} {...crumbProps("/")}>
            /
          </button>
          {segments.map((seg, i) => {
            const dest = "/" + segments.slice(0, i + 1).join("/");
            return (
              <span key={i} className="flex min-w-0 items-center gap-1">
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-white/30" />
                <button onClick={() => setPath(dest)} {...crumbProps(dest)}>
                  {seg}
                </button>
              </span>
            );
          })}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            onClick={() => createItem("dir")}
            className="flex h-9 items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 text-sm transition-colors hover:bg-white/10"
          >
            <FolderPlus className="h-4 w-4" strokeWidth={1.6} /> {t("dash.serverDetail.files.folder")}
          </button>
          <button
            onClick={() => createItem("file")}
            className="flex h-9 items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 text-sm transition-colors hover:bg-white/10"
          >
            <FilePlus className="h-4 w-4" strokeWidth={1.6} /> {t("dash.serverDetail.files.file")}
          </button>
          <label className="flex h-9 cursor-pointer items-center gap-2 rounded-lg bg-white px-3 text-sm font-medium text-black transition-colors hover:bg-white/85">
            <Upload className="h-4 w-4" strokeWidth={1.6} /> {t("dash.serverDetail.files.upload")}
            <input
              type="file"
              multiple
              className="hidden"
              onChange={(e) => e.target.files && uploadFiles(e.target.files)}
            />
          </label>
        </div>
      </div>

      {/* List */}
      <div
        onDragOver={(e) => {
          if (Array.from(e.dataTransfer.types).includes("Files")) {
            e.preventDefault();
            setUploading(true);
          }
        }}
        onDragLeave={() => setUploading(false)}
        onDrop={(e) => {
          if (e.dataTransfer.files.length) {
            e.preventDefault();
            uploadFiles(e.dataTransfer.files);
          }
          setUploading(false);
        }}
        className={`divide-y divide-white/10 overflow-hidden rounded-2xl border transition-colors ${
          uploading ? "border-white/40 bg-white/[0.04]" : "border-white/10"
        }`}
      >
        {entries.length === 0 && (
          <p className="px-4 py-10 text-center text-sm text-white/40">
            {uploading
              ? t("dash.serverDetail.files.dropToUpload")
              : t("dash.serverDetail.files.emptyFolder")}
          </p>
        )}
        <AnimatePresence initial={false}>
        {entries.map((f) => {
          const isFolder = f.type === "dir";
          const over = isFolder && dragOver === f.name && dragName !== f.name;
          return (
            <motion.div
              key={f.name}
              layout
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, x: -12 }}
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            >
            <div
              draggable={renaming !== f.name}
              onDragStart={(e) => {
                e.dataTransfer.setData("text/plain", f.name);
                e.dataTransfer.effectAllowed = "move";
                setDragName(f.name);
              }}
              onDragEnd={() => {
                setDragName(null);
                setDragOver(null);
              }}
              onDragOver={
                isFolder
                  ? (e) => {
                      if (dragName && dragName !== f.name) {
                        e.preventDefault();
                        setDragOver(f.name);
                      }
                    }
                  : undefined
              }
              onDragLeave={isFolder ? () => setDragOver(null) : undefined}
              onDrop={
                isFolder
                  ? (e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onRowDrop(f);
                    }
                  : undefined
              }
              className={`group flex cursor-grab items-center gap-3 px-4 py-3 transition-colors active:cursor-grabbing ${
                over
                  ? "bg-sky-400/10 ring-1 ring-inset ring-sky-400/40"
                  : "bg-white/[0.02] hover:bg-white/[0.04]"
              } ${dragName === f.name ? "opacity-50" : ""}`}
            >
              {isFolder ? (
                <Folder className="h-4 w-4 shrink-0 text-sky-400" strokeWidth={1.6} />
              ) : (
                <FileIcon className="h-4 w-4 shrink-0 text-white/50" strokeWidth={1.6} />
              )}

              {renaming === f.name ? (
                <input
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename();
                    if (e.key === "Escape") setRenaming(null);
                  }}
                  className="flex-1 rounded-md border border-white/20 bg-white/[0.05] px-2 py-1 font-mono text-sm outline-none"
                />
              ) : (
                <button
                  onClick={() =>
                    isFolder ? setPath(join(path, f.name)) : setViewing(f)
                  }
                  className="flex-1 truncate text-left font-mono text-sm hover:underline"
                >
                  {f.name}
                </button>
              )}

              <span className="shrink-0 text-xs text-white/40">{f.meta}</span>
              <RowMenu
                items={[
                  ...(isFolder
                    ? []
                    : [
                        {
                          label: t("dash.serverDetail.files.open"),
                          icon: <Pencil className="h-4 w-4" />,
                          onClick: () => setViewing(f),
                        },
                        {
                          label: t("dash.serverDetail.files.download"),
                          icon: <Download className="h-4 w-4" />,
                          onClick: () => {},
                        },
                      ]),
                  {
                    label: t("dash.serverDetail.files.rename"),
                    icon: <Pencil className="h-4 w-4" />,
                    onClick: () => startRename(f.name),
                  },
                  {
                    label: t("dash.serverDetail.files.move"),
                    icon: <FolderInput className="h-4 w-4" />,
                    onClick: () => setMoving(f),
                  },
                  {
                    label: t("dash.serverDetail.files.delete"),
                    icon: <Trash2 className="h-4 w-4" />,
                    onClick: () => del(f.name),
                    danger: true,
                  },
                ]}
              />
            </div>
            </motion.div>
          );
        })}
        </AnimatePresence>
      </div>

      {/* Move modal */}
      <AnimatePresence>
        {moving && (
          <motion.div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4"
            onClick={() => setMoving(null)}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
          >
            <motion.div
              onClick={(e) => e.stopPropagation()}
              initial={{ opacity: 0, scale: 0.92 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.94 }}
              transition={{ duration: 0.2 }}
              className="relative w-full max-w-sm rounded-2xl border border-white/10 bg-[#0a0a0a] p-6"
            >
              <button
                onClick={() => setMoving(null)}
                aria-label={t("dash.serverDetail.files.close")}
                className="absolute right-4 top-4 rounded-md p-1 text-white/50 hover:bg-white/10 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
              <h2 className="text-lg font-semibold tracking-tight">
                {t("dash.serverDetail.files.moveTitle")} “{moving.name}”
              </h2>
              <p className="mt-1 text-sm text-white/50">
                {t("dash.serverDetail.files.moveDesc")}
              </p>
              <div className="mt-4 flex max-h-72 flex-col gap-1 overflow-auto">
                {destinations(moving).map((dest) => (
                  <button
                    key={dest}
                    onClick={() => doMove(moving, dest)}
                    className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 text-left font-mono text-sm transition-colors hover:bg-white/[0.05]"
                  >
                    <Folder className="h-4 w-4 shrink-0 text-sky-400" strokeWidth={1.6} />
                    <span className="truncate">{dest}</span>
                  </button>
                ))}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {viewing && (
        <FileViewer file={viewing} onClose={() => setViewing(null)} />
      )}
    </div>
  );
}

/* ------------------------------- Settings -------------------------------- */

function SettingsTab({
  name,
  setName,
  server,
}: {
  name: string;
  setName: (v: string) => void;
  server: Server;
}) {
  const { t } = useLang();
  const [draft, setDraft] = useState(name);
  const [pwd, setPwd] = useState("");

  const genPwd = () =>
    setPwd(
      Array.from({ length: 16 }, (_, i) =>
        "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789".charAt(
          (i * 7 + 13) % 54,
        ),
      ).join(""),
    );

  return (
    <div className="max-w-2xl space-y-6">
      {/* Rename */}
      <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-6">
        <h3 className="font-semibold tracking-tight">{t("dash.serverDetail.settings.serverName")}</h3>
        <p className="mt-1 text-sm text-white/50">
          {t("dash.serverDetail.settings.serverNameDesc")}
        </p>
        <div className="mt-4 flex gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="h-10 flex-1 rounded-xl border border-white/10 bg-white/[0.03] px-3 text-sm outline-none focus:border-white/30"
          />
          <button
            onClick={() => setName(draft)}
            className="flex h-10 items-center gap-2 rounded-xl bg-white px-4 text-sm font-medium text-black transition-colors hover:bg-white/85"
          >
            <Save className="h-4 w-4" /> {t("dash.serverDetail.settings.save")}
          </button>
        </div>
      </section>

      {/* Root password */}
      <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-6">
        <h3 className="font-semibold tracking-tight">{t("dash.serverDetail.settings.rootPassword")}</h3>
        <p className="mt-1 text-sm text-white/50">
          {t("dash.serverDetail.settings.rootPasswordDesc")}
        </p>
        <div className="mt-4 flex gap-2">
          <div className="relative flex-1">
            <KeyRound className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
            <input
              value={pwd}
              onChange={(e) => setPwd(e.target.value)}
              placeholder={t("dash.serverDetail.settings.newPassword")}
              className="h-10 w-full rounded-xl border border-white/10 bg-white/[0.03] pl-9 pr-3 text-sm font-mono outline-none focus:border-white/30"
            />
          </div>
          <button
            onClick={genPwd}
            className="h-10 rounded-xl border border-white/15 bg-white/5 px-4 text-sm transition-colors hover:bg-white/10"
          >
            {t("dash.serverDetail.settings.generate")}
          </button>
          <button className="h-10 rounded-xl bg-white px-4 text-sm font-medium text-black transition-colors hover:bg-white/85">
            {t("dash.serverDetail.settings.apply")}
          </button>
        </div>
      </section>

      {/* Info */}
      <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-6">
        <h3 className="font-semibold tracking-tight">{t("dash.serverDetail.settings.system")}</h3>
        <dl className="mt-4 grid grid-cols-2 gap-4 text-sm">
          <div>
            <dt className="text-white/45">{t("dash.serverDetail.settings.os")}</dt>
            <dd className="mt-0.5 font-medium">{server.os}</dd>
          </div>
          <div>
            <dt className="text-white/45">{t("dash.serverDetail.settings.region")}</dt>
            <dd className="mt-0.5 font-medium">{server.region}</dd>
          </div>
        </dl>
      </section>

      {/* Danger */}
      <section className="rounded-2xl border border-red-400/20 bg-red-400/[0.04] p-6">
        <h3 className="font-semibold tracking-tight text-red-300">
          {t("dash.serverDetail.settings.dangerZone")}
        </h3>
        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-white/55">
            {t("dash.serverDetail.settings.dangerDesc")}
          </p>
          <button className="flex h-9 items-center justify-center gap-2 rounded-lg border border-red-400/30 bg-red-400/10 px-4 text-sm font-medium text-red-300 transition-colors hover:bg-red-400/20">
            <Trash2 className="h-4 w-4" strokeWidth={1.6} /> {t("dash.serverDetail.settings.destroy")}
          </button>
        </div>
      </section>
    </div>
  );
}
