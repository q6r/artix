// Shapes returned by the Rust backend (mirrors its `*Public` DTOs).

export type UserStatus = "active" | "unverified" | "suspended" | "banned";

export type User = {
  id: string;
  email: string;
  email_verified: boolean;
  display_name: string;
  avatar_url?: string | null;
  status: UserStatus;
  permissions: string[];
};

export type Plan = {
  id: string;
  name: string;
  vcpu: number;
  ram_gb: number;
  disk_gb: number;
  price_cents: number;
  currency: string;
};

export type AdminPlan = {
  id: string;
  slug: string;
  name: string;
  vcpu: number;
  ram_gb: number;
  disk_gb: number;
  price_cents: number;
  active: boolean;
  sort: number;
};

export type CustomRates = {
  vcpu_cents: number;
  ram_cents: number;
  disk_cents: number;
  vcpu_min: number;
  vcpu_max: number;
  ram_min: number;
  ram_max: number;
  disk_min: number;
  disk_max: number;
};

export type PlansResponse = {
  plans: Plan[];
  custom: CustomRates;
  currency: string;
};

export type SubscriptionStatus =
  | "pending_payment"
  | "active"
  | "past_due"
  | "suspended"
  | "cancelled";

export type Subscription = {
  id: string;
  server_id: string | null;
  plan: string;
  status: SubscriptionStatus;
  price_cents: number;
  currency: string;
  interval: string;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  created_at: string;
};

export type InvoiceStatus = "open" | "paid" | "void" | "expired" | "uncollectible";

export type Invoice = {
  id: string;
  subscription_id: string;
  number: string;
  amount_cents: number;
  currency: string;
  status: InvoiceStatus;
  period_start: string;
  period_end: string;
  due_date: string;
  pix_code: string | null;
  pix_qr_image: string | null;
  provider?: string | null;
  crypto_address?: string | null;
  crypto_amount_ltc?: number | null;
  crypto_expires_at?: string | null;
  stripe_url?: string | null;
  paid_at: string | null;
  created_at: string;
};

export type Checkout = {
  subscription: Subscription;
  invoice: Invoice;
};

export type ServerState =
  | "pending_payment"
  | "provisioning"
  | "running"
  | "stopped"
  | "suspended"
  | "error"
  | "deleting";

export type ServerSpecs = { vcpu: number; ram_gb: number; disk_gb: number };

export type Server = {
  id: string;
  name: string;
  state: ServerState;
  plan: string;
  os: string;
  ip: string | null;
  vmid: number | null;
  org_id: string | null;
  root_user?: string | null;
  root_password?: string | null;
  ssh_host?: string | null;
  ssh_port?: number | null;
  specs: ServerSpecs;
  expires_at?: string | null;
  created_at: string;
};

/** A server as seen in the admin panel: the public shape plus node + owner. */
export type AdminServer = Server & {
  node: string;
  owner: UserRef | null;
};

/** A configured frp relay as seen in the admin panel. */
export type DedicatedIpStatus =
  | "pending_payment"
  | "pending_assignment"
  | "active"
  | "cancelled";

export type DedicatedIp = {
  id: string;
  server_id: string;
  status: DedicatedIpStatus;
  ip_address?: string | null;
  price_cents: number;
};

export type AdminDedicatedIp = DedicatedIp & {
  owner: UserRef | null;
  server_name?: string | null;
};

export type AdminRelay = {
  name: string;
  host: string;
  server_port: number;
  port_min: number;
  port_max: number;
  used_ports: number;
  capacity: number;
  enabled: boolean;
};

export type MetricPoint = {
  time: number;
  cpu: number;
  mem: number;
  maxmem: number;
  netin: number;
  netout: number;
  diskread: number;
  diskwrite: number;
};

/** Live status pushed over the gateway socket (`server:<id>` "stat" event). */
export type ServerStat = {
  state: ServerState;
  status?: string;
  mem?: number;
  max_mem?: number;
  cpus?: number;
  uptime?: number;
};

// ----------------------------- Organizations -----------------------------

export type OrgRole = "owner" | "admin" | "member";

export const SERVER_PERMS = ["view", "power", "console", "metrics", "delete", "manage"] as const;
export type ServerPerm = (typeof SERVER_PERMS)[number];

export type Org = {
  id: string;
  name: string;
  owner_id: string;
  role: OrgRole;
  member_count: number;
  server_count: number;
  created_at: string;
};

export type OrgMember = {
  user_id: string;
  email: string;
  display_name: string;
  role: OrgRole;
  /** server_id -> granted perms (empty for owner/admin). */
  grants: Record<string, string[]>;
};

export type OrgDetail = {
  id: string;
  name: string;
  owner_id: string;
  role: OrgRole;
  members: OrgMember[];
  servers: Server[];
};

// ----------------------------- Support -----------------------------

export type TicketStatus = "open" | "pending" | "closed";

export type UserRef = {
  id: string;
  display_name: string;
  email: string;
  avatar_url?: string | null;
};

export type Ticket = {
  id: string;
  subject: string;
  status: TicketStatus;
  category?: string | null;
  owner?: UserRef | null;
  assignee?: UserRef | null;
  members?: UserRef[];
  created_at: string;
  updated_at: string;
};

/** Admin-managed ticket type (mirrors `TicketCategoryPublic`). */
export type TicketCategory = {
  id: string;
  slug: string;
  name: string;
  color?: string | null;
};

// ----------------------------- Announcements -----------------------------

export type AnnouncementKind = "banner" | "modal";
export type AnnouncementScope = "global" | "dashboard" | "pages";
export type ButtonColor = "blue" | "red" | "gray" | "green";

export type AnnouncementButton = { label: string; url: string; color: ButtonColor };

export type Announcement = {
  id: string;
  kind: AnnouncementKind;
  scope: AnnouncementScope;
  pages: string[];
  title: string;
  description: string;
  buttons: AnnouncementButton[];
  active: boolean;
  updated_at: string;
};

/** A role: bundles a set of permission strings (mirrors `Role`). */
export type Role = {
  id: string;
  name: string;
  description: string;
  permissions: string[];
  /** Built-in roles cannot be edited or deleted. */
  system: boolean;
};

/** Base permission catalog returned by `admin/permissions`. */
export type PermissionsCatalog = {
  permissions: string[];
  wildcard: string;
};

/** A user as seen in the admin panel (mirrors `UserAdminView`). */
export type AdminUser = {
  id: string;
  email: string;
  email_verified: boolean;
  display_name: string;
  status: UserStatus;
  role_ids: string[];
  created_at: string;
};

export type TicketMessage = {
  id: string;
  author_id: string;
  body: string;
  is_staff: boolean;
  created_at: string;
};

export type TicketThread = {
  ticket: Ticket;
  messages: TicketMessage[];
};

/** Format integer cents into a localized money string. */
export function formatMoney(cents: number, currency = "BRL"): string {
  const value = cents / 100;
  if (currency === "BRL") {
    return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }
  return `${currency} ${value.toFixed(2)}`;
}
