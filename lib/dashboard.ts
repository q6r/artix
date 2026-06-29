export type ServerStatus = "online" | "rebooting" | "offline";

export type Server = {
  id: string;
  name: string;
  region: string;
  status: ServerStatus;
  plan: string;
  os: string;
  ip: string;
  created: string;
  specs: { vcpu: number; ram: number; disk: number };
  usage: { cpu: number; ram: number; disk: number };
  bandwidth: string;
};

export type InvoiceStatus = "paid" | "open" | "overdue";

export type InvoiceItem = { desc: string; qty: number; unit: number };

export type Invoice = {
  id: string;
  number: string;
  date: string;
  dueDate: string;
  period: string;
  status: InvoiceStatus;
  method: string;
  items: InvoiceItem[];
};

export const servers: Server[] = [
  {
    id: "web-prod-01",
    name: "web-prod-01",
    region: "São Paulo · BR",
    status: "online",
    plan: "Cloud 4",
    os: "Ubuntu 24.04 LTS",
    ip: "189.112.40.21",
    created: "12 mar 2026",
    specs: { vcpu: 4, ram: 8, disk: 100 },
    usage: { cpu: 38, ram: 52, disk: 41 },
    bandwidth: "420 GB / mês",
  },
  {
    id: "db-prod-01",
    name: "db-prod-01",
    region: "São Paulo · BR",
    status: "online",
    plan: "Cloud 8",
    os: "Debian 12",
    ip: "189.112.40.58",
    created: "12 mar 2026",
    specs: { vcpu: 8, ram: 16, disk: 200 },
    usage: { cpu: 61, ram: 73, disk: 66 },
    bandwidth: "880 GB / mês",
  },
  {
    id: "staging-01",
    name: "staging-01",
    region: "São Paulo · BR",
    status: "rebooting",
    plan: "Cloud 2",
    os: "AlmaLinux 9",
    ip: "189.112.41.10",
    created: "02 jun 2026",
    specs: { vcpu: 2, ram: 4, disk: 50 },
    usage: { cpu: 4, ram: 18, disk: 23 },
    bandwidth: "120 GB / mês",
  },
];

export const invoices: Invoice[] = [
  {
    id: "INV-2026-007",
    number: "INV-2026-007",
    date: "01 jul 2026",
    dueDate: "10 jul 2026",
    period: "Julho 2026",
    status: "open",
    method: "Pix",
    items: [
      { desc: "VPS Cloud 8 — db-prod-01", qty: 1, unit: 149 },
      { desc: "VPS Cloud 4 — web-prod-01", qty: 1, unit: 79 },
      { desc: "VPS Cloud 2 — staging-01", qty: 1, unit: 39 },
    ],
  },
  {
    id: "INV-2026-006",
    number: "INV-2026-006",
    date: "01 jun 2026",
    dueDate: "10 jun 2026",
    period: "Junho 2026",
    status: "paid",
    method: "Cartão •••• 4242",
    items: [
      { desc: "VPS Cloud 8 — db-prod-01", qty: 1, unit: 149 },
      { desc: "VPS Cloud 4 — web-prod-01", qty: 1, unit: 79 },
      { desc: "VPS Cloud 2 — staging-01", qty: 1, unit: 39 },
    ],
  },
  {
    id: "INV-2026-005",
    number: "INV-2026-005",
    date: "01 mai 2026",
    dueDate: "10 mai 2026",
    period: "Maio 2026",
    status: "paid",
    method: "Cartão •••• 4242",
    items: [
      { desc: "VPS Cloud 8 — db-prod-01", qty: 1, unit: 149 },
      { desc: "VPS Cloud 4 — web-prod-01", qty: 1, unit: 79 },
    ],
  },
  {
    id: "INV-2026-004",
    number: "INV-2026-004",
    date: "01 abr 2026",
    dueDate: "10 abr 2026",
    period: "Abril 2026",
    status: "paid",
    method: "Pix",
    items: [{ desc: "VPS Cloud 8 — db-prod-01", qty: 1, unit: 149 }],
  },
];

export function getServer(id: string) {
  return servers.find((s) => s.id === id);
}

export function getInvoice(id: string) {
  return invoices.find((i) => i.id === id);
}

export function invoiceTotal(inv: Invoice) {
  return inv.items.reduce((sum, it) => sum + it.qty * it.unit, 0);
}

export function formatBRL(n: number) {
  return `R$ ${n.toFixed(2).replace(".", ",")}`;
}

export const statusLabel: Record<ServerStatus, string> = {
  online: "Online",
  rebooting: "Reiniciando",
  offline: "Offline",
};

export const statusStyles: Record<ServerStatus, string> = {
  online: "bg-emerald-400/10 text-emerald-400",
  rebooting: "bg-amber-400/10 text-amber-400",
  offline: "bg-red-400/10 text-red-400",
};

export const invoiceStatusLabel: Record<InvoiceStatus, string> = {
  paid: "Paga",
  open: "Em aberto",
  overdue: "Vencida",
};

export const invoiceStatusStyles: Record<InvoiceStatus, string> = {
  paid: "bg-emerald-400/10 text-emerald-400",
  open: "bg-sky-400/10 text-sky-400",
  overdue: "bg-red-400/10 text-red-400",
};

/* ----------------------------- Organizations ----------------------------- */

export type OrgRole = "Dono" | "Admin" | "Membro" | "Somente leitura";

export type OrgMember = { name: string; email: string; role: OrgRole };

export type Organization = {
  id: string;
  name: string;
  plan: string;
  members: OrgMember[];
  serverIds: string[];
};

export const orgRoles: { role: OrgRole; desc: string }[] = [
  { role: "Dono", desc: "Acesso total, incluindo cobrança e exclusão." },
  { role: "Admin", desc: "Gerencia servidores, membros e configurações." },
  { role: "Membro", desc: "Cria e gerencia os próprios servidores." },
  { role: "Somente leitura", desc: "Apenas visualiza recursos e métricas." },
];

export const organizations: Organization[] = [
  {
    id: "acme",
    name: "Acme Inc",
    plan: "Cloud 8",
    serverIds: ["web-prod-01", "db-prod-01"],
    members: [
      { name: "Brunno Garcia", email: "brunno@artixcloud.com", role: "Dono" },
      { name: "Ana Souza", email: "ana@acme.com", role: "Admin" },
      { name: "Léo Martins", email: "leo@acme.com", role: "Membro" },
      { name: "Carla Dias", email: "carla@acme.com", role: "Somente leitura" },
    ],
  },
  {
    id: "pessoal",
    name: "Pessoal",
    plan: "Cloud 2",
    serverIds: ["staging-01"],
    members: [
      { name: "Brunno Garcia", email: "brunno@artixcloud.com", role: "Dono" },
    ],
  },
];

export function getOrg(id: string) {
  return organizations.find((o) => o.id === id);
}

export const orgRoleStyles: Record<OrgRole, string> = {
  Dono: "bg-amber-400/10 text-amber-400",
  Admin: "bg-sky-400/10 text-sky-400",
  Membro: "bg-emerald-400/10 text-emerald-400",
  "Somente leitura": "bg-white/10 text-white/60",
};

/* ------------------------------- Metrics --------------------------------- */

function clamp(n: number) {
  return Math.max(2, Math.min(100, Math.round(n)));
}

// Deterministic 24-point series around a base value (no randomness).
function series(base: number, amp: number) {
  return Array.from({ length: 24 }, (_, i) =>
    clamp(base + Math.sin(i / 2.5) * amp + Math.cos(i / 4) * amp * 0.5),
  );
}

export function serverMetrics(s: Server) {
  return {
    cpu: series(s.usage.cpu, 16),
    ram: series(s.usage.ram, 9),
    disk: series(s.usage.disk, 3),
    net: series(45, 28),
  };
}

/* -------------------------------- Files ---------------------------------- */

export type FileNode = {
  name: string;
  type: "dir" | "file";
  meta: string;
  src?: string;
};

export const fileTree: FileNode[] = [
  { name: "etc", type: "dir", meta: "32 itens" },
  { name: "home", type: "dir", meta: "4 itens" },
  { name: "var", type: "dir", meta: "18 itens" },
  { name: "opt", type: "dir", meta: "2 itens" },
  { name: "docker-compose.yml", type: "file", meta: "1.2 KB" },
  { name: ".env", type: "file", meta: "640 B" },
  { name: "nginx.conf", type: "file", meta: "3.1 KB" },
  { name: "app.log", type: "file", meta: "4.8 MB" },
  { name: "backup-2026-06-23.tar.gz", type: "file", meta: "812 MB" },
];
