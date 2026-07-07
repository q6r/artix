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
  discord_linked?: boolean;
  github_linked?: boolean;
  github_username?: string | null;
};

export type GithubRepo = {
  full_name: string;
  default_branch: string;
  private: boolean;
  updated_at?: string | null;
};

/** A developer API key (secret shown only once, at creation). */
export type ApiKey = {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  created_at: string;
  last_used_at: string | null;
  expires_at: string | null;
  revoked: boolean;
};

export type CreateKeyResponse = ApiKey & { key: string };

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

export type ContainerPlan = {
  id: string; // "c-free" | "c-starter" | ...
  name: string;
  ram_mb: number;
  price_cents: number; // 0 = free tier
  currency: string;
};

export type PlansResponse = {
  plans: Plan[];
  custom: CustomRates;
  currency: string;
  container_plans: ContainerPlan[];
};

/** The account's container RAM pool. */
export type RamBalance = {
  total_mb: number;
  used_mb: number;
  available_mb: number;
  free_grant_mb: number;
  free_claimed: boolean;
  bot_min_mb: number;
  site_min_mb: number;
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

export type Notification = {
  id: string;
  kind: string;
  title: string;
  body: string;
  read: boolean;
  link?: string | null;
  created_at: string;
};

export type NotificationsResponse = {
  items: Notification[];
  unread: number;
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
  /** 0 = VPS, 1 = Container. Absent on legacy payloads (treat as 0). */
  type?: 0 | 1;
  container?: ContainerInfo;
  expires_at?: string | null;
  created_at: string;
};

/** Container metadata (present only when `type === 1`). */
export type ContainerInfo = {
  container_type: string; // "discord_bot" | "site"
  app_id: string;
  runtime?: string | null;
  version?: string | null;
  ram_mb?: number | null;
  port?: number | null;
  status?: string | null; // "created" | "running" | "stopped" | "exited" | ...
  subdomain?: string | null;
  deployed: boolean;
  /** Auto-redeploy on GitHub push is active (secret/hook id never exposed). */
  auto_deploy?: boolean;
  github_repo?: string | null;
  github_ref?: string | null;
  custom_domain?: string | null;
  custom_domain_verified?: boolean;
  // Minecraft (container_type === "minecraft")
  edition?: string | null; // "java" | "bedrock"
  software?: string | null; // VANILLA | PAPER | PURPUR | FABRIC | FORGE
  mc_relay_host?: string | null;
  mc_port?: number | null;
  max_players?: number | null;
  // Voice (container_type === "voice", Mumble)
  admin_password?: string | null;
  voice_password?: string | null;
};

/** A site container's custom-domain status. */
export type DomainStatus = {
  domain: string | null;
  verified: boolean;
  /** Relay IP the customer points their domain's A record at. */
  target_ip: string | null;
};

/** A file/dir entry from the container file browser. */
export type FileEntry = {
  name: string;
  type: "dir" | "file";
  size: number;
  heavy?: boolean; // node_modules/.git/… — not auto-expanded
};

export type FilesResult = { path: string; entries: FileEntry[] };
export type FileContent = { path: string; content: string; size: number };

/** One entry in a container's deploy history. */
export type DeployItem = {
  id: string;
  user_name: string;
  source: string; // "zip" | "github" | "auto"
  repo?: string | null;
  git_ref?: string | null;
  commit?: string | null;
  status: string; // "success" | "failed"
  error?: string | null;
  created_at: string; // ISO 8601
};

export type DeployResult = {
  ok: boolean;
  runtime?: string | null;
  image?: string | null;
  ram?: number | null;
  port?: number | null;
  buildLog?: string | null;
};

export type ContainerStats = {
  cpu: string | null;
  mem: string | null;
  memPerc: string | null;
};

export type ContainerStatus = {
  exists: boolean;
  status: string | null;
  running: boolean;
  exitCode?: number | null;
  startedAt?: string | null;
  oomKilled: boolean;
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

export type AdminStorage = {
  name: string;
  type: string;
  total_gb: number;
  used_gb: number;
  committed_gb: number;
  reserved_gb: number;
  sellable_gb: number;
  free_to_sell_gb: number;
  vps_count: number;
  pct_committed: number;
  sellable: boolean;
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
  /** Admin-granted container RAM in MB (0 when none). */
  bonus_ram_mb: number;
  /** When the grant expires (ISO); null = lifetime. */
  bonus_ram_expires_at: string | null;
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

// ----------------------------- Community -----------------------------

/** A participant currently connected to the community voice room. */
export type VoiceParticipant = {
  identity: string;
  name: string;
  muted: boolean;
};

/** A message in a community text channel. */
export type ChatMessage = {
  id: string;
  name: string;
  text: string;
  user_id: string;
  created_at: string;
};

/** Format integer cents into a localized money string. */
export function formatMoney(cents: number, currency = "BRL"): string {
  const value = cents / 100;
  if (currency === "BRL") {
    return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }
  return `${currency} ${value.toFixed(2)}`;
}
