"use client";

import { useEffect, useMemo, useState } from "react";
import { Search, Copy, Check, Menu, X, Terminal } from "lucide-react";
import { useLang } from "@/components/LanguageProvider";

type Lang = "pt" | "en";
type Bi = { pt: string; en: string };
type Item = { id: string; title: Bi; kw?: string };
type Group = { label: Bi; items: Item[] };

const NAV: Group[] = [
  {
    label: { pt: "Guia", en: "Guide" },
    items: [
      { id: "intro", title: { pt: "Introdução à Artix", en: "Introduction to Artix" }, kw: "o que é vps container what is" },
      { id: "comecando", title: { pt: "Começando", en: "Getting started" }, kw: "como funciona conceitos concepts" },
      { id: "conta", title: { pt: "Criar uma conta", en: "Creating an account" }, kw: "cadastro registro login discord github signup" },
      { id: "planos", title: { pt: "Planos e RAM", en: "Plans & RAM" }, kw: "preço ram vps pacote free grátis price" },
      { id: "servicos", title: { pt: "VPS e Containers", en: "VPS & Containers" }, kw: "diferença tipos types" },
      { id: "dominio", title: { pt: "Domínio .artix", en: ".artix domain" }, kw: "subdomínio site url subdomain" },
      { id: "artix-file", title: { pt: "O arquivo .artix", en: "The .artix file" }, kw: "config deploy squarecloud discloud" },
      { id: "gerenciar", title: { pt: "Gerenciar serviços", en: "Managing services" }, kw: "painel deploy logs console variáveis manage" },
    ],
  },
  {
    label: { pt: "Desenvolvedores", en: "Developers" },
    items: [
      { id: "dev-panel", title: { pt: "Painel de desenvolvedor", en: "Developer panel" }, kw: "settings api" },
      { id: "api-keys", title: { pt: "Gerar API Keys", en: "Generating API Keys" }, kw: "chave token criar revogar key" },
      { id: "auth", title: { pt: "Autenticação", en: "Authentication" }, kw: "bearer header base url" },
      { id: "permissoes", title: { pt: "Permissões", en: "Permissions" }, kw: "escopos scopes" },
      { id: "endpoints", title: { pt: "Referência de endpoints", en: "Endpoint reference" }, kw: "rotas routes params parâmetros" },
      { id: "actions", title: { pt: "Ações e validação", en: "Actions & validation" }, kw: "invalid_action start stop restart" },
      { id: "realtime", title: { pt: "Eventos em tempo real", en: "Realtime events" }, kw: "sse websocket stream polling" },
      { id: "erros", title: { pt: "Códigos de erro", en: "Error codes" }, kw: "400 401 403 404 status" },
      { id: "boas-praticas", title: { pt: "Boas práticas", en: "Best practices" }, kw: "segurança rotacionar security" },
      { id: "faq", title: { pt: "FAQ", en: "FAQ" }, kw: "perguntas frequentes questions" },
    ],
  },
];

function CodeBlock({ code, lang = "bash", copyLabel, copiedLabel }: { code: string; lang?: string; copyLabel: string; copiedLabel: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="my-4 overflow-hidden rounded-xl border border-white/10 bg-[#0a0a0c]">
      <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-2">
        <span className="font-mono text-[11px] uppercase tracking-wider text-white/35">{lang}</span>
        <button
          onClick={copy}
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium text-white/50 transition-colors hover:bg-white/5 hover:text-white"
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? copiedLabel : copyLabel}
        </button>
      </div>
      <pre className="overflow-x-auto p-4 text-[13px] leading-relaxed">
        <code className="font-mono text-white/80">{code}</code>
      </pre>
    </div>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 border-b border-white/[0.06] py-10 first:pt-2">
      <h2 className="text-2xl font-semibold tracking-tight text-white">{title}</h2>
      <div className="mt-4 space-y-4 text-[15px] leading-relaxed text-white/65">{children}</div>
    </section>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return <p>{children}</p>;
}
function B({ children }: { children: React.ReactNode }) {
  return <strong className="font-semibold text-white/90">{children}</strong>;
}
function C({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded-md border border-white/10 bg-white/[0.04] px-1.5 py-0.5 font-mono text-[13px] text-sky-200/90">
      {children}
    </code>
  );
}
function UL({ children }: { children: React.ReactNode }) {
  return <ul className="ml-1 list-none space-y-2">{children}</ul>;
}
function LI({ children }: { children: React.ReactNode }) {
  return (
    <li className="relative pl-5 before:absolute before:left-0 before:top-[0.62em] before:h-1.5 before:w-1.5 before:rounded-full before:bg-white/25">
      {children}
    </li>
  );
}
function Table({ head, rows }: { head: React.ReactNode[]; rows: React.ReactNode[][] }) {
  return (
    <div className="my-4 overflow-x-auto rounded-xl border border-white/10">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="bg-white/[0.03]">
            {head.map((h, i) => (
              <th key={i} className="whitespace-nowrap border-b border-white/10 px-4 py-2.5 text-left font-medium text-white/70">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-white/[0.06] last:border-0">
              {r.map((cell, j) => (
                <td key={j} className="px-4 py-2.5 align-top text-white/60">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function Callout({ children }: { children: React.ReactNode }) {
  return (
    <div className="my-4 flex gap-3 rounded-xl border border-sky-400/20 bg-sky-400/[0.06] p-4 text-sm text-sky-100/80">
      <Terminal className="mt-0.5 h-4 w-4 shrink-0 text-sky-300" />
      <div className="space-y-1">{children}</div>
    </div>
  );
}
const LOCALES = [
  { id: "pt", label: "PT" },
  { id: "en", label: "EN" },
  { id: "es", label: "ES" },
] as const;

export default function DocsClient() {
  const { locale, setLocale } = useLang();
  const lang: Lang = locale === "pt" ? "pt" : "en";
  const L = (m: Bi) => m[lang];
  const tt = {
    docs: L({ pt: "Documentação", en: "Documentation" }),
    heroTitle: L({ pt: "Central de ajuda da Artix", en: "Artix help center" }),
    heroSub: L({
      pt: "Tudo sobre VPS, containers, o arquivo .artix, o painel e a API — para usuários e desenvolvedores.",
      en: "Everything about VPS, containers, the .artix file, the panel and the API — for users and developers.",
    }),
    search: L({ pt: "Buscar na documentação…", en: "Search the docs…" }),
    none: L({ pt: "Nada encontrado.", en: "No results." }),
    nav: L({ pt: "Navegação", en: "Navigation" }),
    copy: L({ pt: "Copiar", en: "Copy" }),
    copied: L({ pt: "Copiado", en: "Copied" }),
  };
  const [query, setQuery] = useState("");
  const [active, setActive] = useState("intro");
  const [navOpen, setNavOpen] = useState(false);
  const CB = (p: { code: string; lang?: string }) => (
    <CodeBlock {...p} copyLabel={tt.copy} copiedLabel={tt.copied} />
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return NAV;
    return NAV.map((g) => ({
      ...g,
      items: g.items.filter(
        (it) => L(it.title).toLowerCase().includes(q) || (it.kw ?? "").includes(q),
      ),
    })).filter((g) => g.items.length > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, lang]);

  useEffect(() => {
    const ids = NAV.flatMap((g) => g.items.map((i) => i.id));
    const obs = new IntersectionObserver(
      (entries) => {
        const vis = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (vis[0]) setActive(vis[0].target.id);
      },
      { rootMargin: "-80px 0px -70% 0px", threshold: 0 },
    );
    ids.forEach((id) => {
      const el = document.getElementById(id);
      if (el) obs.observe(el);
    });
    return () => obs.disconnect();
  }, []);

  const go = (id: string) => {
    setNavOpen(false);
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const Sidebar = (
    <nav className="space-y-6">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={tt.search}
          className="h-10 w-full rounded-xl border border-white/10 bg-white/[0.03] pl-9 pr-3 text-sm outline-none placeholder:text-white/35 focus:border-white/30"
        />
      </div>
      {filtered.length === 0 && <p className="px-1 text-sm text-white/40">{tt.none}</p>}
      {filtered.map((g) => (
        <div key={g.label.en}>
          <p className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wider text-white/35">{L(g.label)}</p>
          <ul className="space-y-0.5">
            {g.items.map((it) => (
              <li key={it.id}>
                <button
                  onClick={() => go(it.id)}
                  className={`block w-full rounded-lg px-3 py-1.5 text-left text-sm transition-colors ${
                    active === it.id
                      ? "bg-white/[0.07] font-medium text-white"
                      : "text-white/55 hover:bg-white/[0.03] hover:text-white/85"
                  }`}
                >
                  {L(it.title)}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-10 sm:py-14">
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <p className="text-[13px] font-semibold uppercase tracking-wider text-white/35">{tt.docs}</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white sm:text-4xl">{tt.heroTitle}</h1>
          <p className="mt-2 max-w-2xl text-white/55">{tt.heroSub}</p>
        </div>
        <div className="inline-flex shrink-0 rounded-lg border border-white/10 bg-white/[0.03] p-0.5">
          {LOCALES.map((l) => (
            <button
              key={l.id}
              onClick={() => setLocale(l.id)}
              aria-pressed={locale === l.id}
              className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors ${
                locale === l.id ? "bg-white text-black" : "text-white/55 hover:text-white"
              }`}
            >
              {l.label}
            </button>
          ))}
        </div>
      </div>

      <button
        onClick={() => setNavOpen((v) => !v)}
        className="mb-4 inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm lg:hidden"
      >
        {navOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />} {tt.nav}
      </button>

      <div className="lg:grid lg:grid-cols-[240px_1fr] lg:gap-10">
        <aside className={`${navOpen ? "block" : "hidden"} mb-8 lg:mb-0 lg:block`}>
          <div className="lg:sticky lg:top-24 lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto lg:pr-2">{Sidebar}</div>
        </aside>

        <div className="min-w-0 max-w-3xl">
          <Section id="intro" title={L({ pt: "Introdução à Artix", en: "Introduction to Artix" })}>
            <P>{L({ pt: "A Artix é uma plataforma de hospedagem que reúne dois produtos em um só painel:", en: "Artix is a hosting platform that brings two products together in one panel:" })}</P>
            <UL>
              <LI><B>VPS</B> — {L({ pt: "servidores virtuais completos (Linux), com acesso root, IP e portas. Para APIs, bancos e sistemas maiores.", en: "full virtual servers (Linux), with root access, IP and ports. For APIs, databases and larger systems." })}</LI>
              <LI><B>Containers</B> — {L({ pt: "ambientes gerenciados para bots de Discord e sites. Você envia o código, a Artix builda e roda.", en: "managed environments for Discord bots and websites. You send the code, Artix builds and runs it." })}</LI>
            </UL>
            <P>{L({ pt: "Você gerencia tudo em ", en: "You manage everything at " })}<C>artix.cloud/dashboard</C>{L({ pt: ", e desenvolvedores automatizam via API com API Keys.", en: ", and developers automate via the API with API Keys." })}</P>
          </Section>

          <Section id="comecando" title={L({ pt: "Começando", en: "Getting started" })}>
            <P>{L({ pt: "O fluxo da plataforma, em resumo:", en: "The platform flow, in short:" })}</P>
            <UL>
              <LI><B>1.</B> {L({ pt: "Crie uma conta e faça login (e-mail, Discord ou GitHub).", en: "Create an account and sign in (email, Discord or GitHub)." })}</LI>
              <LI><B>2.</B> {L({ pt: "Escolha o serviço: um VPS (por plano) ou um container (usando a RAM da conta).", en: "Choose a service: a VPS (by plan) or a container (using your account's RAM)." })}</LI>
              <LI><B>3.</B> {L({ pt: "Faça o deploy: VPS via SSH; container enviando um .zip (ou GitHub) com um .artix na raiz.", en: "Deploy: VPS via SSH; container by uploading a .zip (or GitHub) with a .artix in the root." })}</LI>
              <LI><B>4.</B> {L({ pt: "Gerencie pelo painel: logs, console, variáveis, reiniciar, métricas.", en: "Manage from the panel: logs, console, variables, restart, metrics." })}</LI>
            </UL>
            <P><B>{L({ pt: "Conceitos principais:", en: "Key concepts:" })}</B></P>
            <UL>
              <LI><B>{L({ pt: "Pool de RAM", en: "RAM pool" })}</B> — {L({ pt: "containers não são comprados individualmente; você tem RAM na conta e distribui entre quantos quiser.", en: "containers aren't bought individually; you hold RAM on the account and split it across as many as you like." })}</LI>
              <LI><B>{L({ pt: "Arquivo .artix", en: ".artix file" })}</B> — {L({ pt: "define como sua aplicação roda (tipo, RAM, comando de start).", en: "defines how your app runs (type, RAM, start command)." })}</LI>
              <LI><B>{L({ pt: "Subdomínio", en: "Subdomain" })}</B> — {L({ pt: "sites recebem um endereço ", en: "sites get a " })}<C>seusite.artix.cloud</C> {L({ pt: "automaticamente.", en: "address automatically." })}</LI>
            </UL>
          </Section>

          <Section id="conta" title={L({ pt: "Como criar uma conta", en: "Creating an account" })}>
            <P>{L({ pt: "Acesse ", en: "Go to " })}<C>artix.cloud/register</C>{L({ pt: " e crie sua conta:", en: " and create your account:" })}</P>
            <UL>
              <LI><B>E-mail</B> — {L({ pt: "você recebe um código de acesso por e-mail (login sem senha por padrão).", en: "you receive an access code by email (passwordless login by default)." })}</LI>
              <LI><B>Discord</B> / <B>GitHub</B> — {L({ pt: "login com um clique. Vincular o GitHub libera deploy direto de repositórios.", en: "one-click login. Linking GitHub enables deploying straight from repositories." })}</LI>
            </UL>
          </Section>

          <Section id="planos" title={L({ pt: "Planos e RAM", en: "Plans & RAM" })}>
            <P><B>VPS</B> — {L({ pt: "planos fixos por mês (2 a 32 GB de RAM) ou um plano personalizado (você define vCPU, RAM e disco). Cobrança mensal.", en: "fixed monthly plans (2 to 32 GB RAM) or a custom plan (you set vCPU, RAM and disk). Billed monthly." })}</P>
            <P><B>Containers</B> — {L({ pt: "funcionam por quantidade de RAM na conta:", en: "work by the amount of RAM on the account:" })}</P>
            <UL>
              <LI><B>{L({ pt: "Grátis", en: "Free" })}</B> — {L({ pt: "cada conta resgata 256 MB uma vez.", en: "each account claims 256 MB once." })}</LI>
              <LI><B>{L({ pt: "Pacotes de RAM", en: "RAM packs" })}</B> — {L({ pt: "1 GB (R$ 5,99), 2 GB (R$ 10,99), 4 GB (R$ 24,99) por mês.", en: "1 GB (R$ 5.99), 2 GB (R$ 10.99), 4 GB (R$ 24.99) per month." })}</LI>
            </UL>
            <P>{L({ pt: "Pagamentos: PIX, cripto ou cartão.", en: "Payments: PIX, crypto or card." })}</P>
          </Section>

          <Section id="servicos" title={L({ pt: "VPS e Containers", en: "VPS & Containers" })}>
            <Table
              head={["", "VPS", "Container"]}
              rows={[
                [L({ pt: "Acesso", en: "Access" }), L({ pt: "Root + SSH + IP", en: "Root + SSH + IP" }), L({ pt: "Painel gerenciado", en: "Managed panel" })],
                [L({ pt: "Ideal para", en: "Best for" }), L({ pt: "APIs, bancos, sistemas", en: "APIs, databases, systems" }), L({ pt: "Bots e sites", en: "Bots and sites" })],
                [L({ pt: "Cobrança", en: "Billing" }), L({ pt: "Plano por mês", en: "Monthly plan" }), L({ pt: "Pool de RAM", en: "RAM pool" })],
                ["Deploy", L({ pt: "Você instala tudo", en: "You install it all" }), ".zip / GitHub + .artix"],
              ]}
            />
            <P><B>{L({ pt: "RAM mínima por tipo de container:", en: "Minimum RAM per container type:" })}</B></P>
            <UL>
              <LI><B>{L({ pt: "Bot de Discord", en: "Discord bot" })}</B> — {L({ pt: "mínimo 256 MB.", en: "minimum 256 MB." })}</LI>
              <LI><B>Site</B> — {L({ pt: "mínimo 512 MB.", en: "minimum 512 MB." })}</LI>
            </UL>
            <P>{L({ pt: "Ex.: com 1 GB você roda 4 bots (256 MB), 2 sites (512 MB), ou 1 site + 2 bots. O painel valida e bloqueia se faltar RAM.", en: "E.g. with 1 GB you run 4 bots (256 MB), 2 sites (512 MB), or 1 site + 2 bots. The panel validates and blocks if RAM runs short." })}</P>
          </Section>

          <Section id="dominio" title={L({ pt: "Domínio .artix", en: ".artix domain" })}>
            <P>{L({ pt: "Todo container do tipo site recebe um subdomínio público em ", en: "Every site-type container gets a public subdomain at " })}<C>&lt;sub&gt;.artix.cloud</C>{L({ pt: " — com HTTPS automático.", en: " — with automatic HTTPS." })}</P>
            <UL>
              <LI>{L({ pt: "Você escolhe o subdomínio na criação do site.", en: "You pick the subdomain when creating the site." })}</LI>
              <LI>{L({ pt: "Em branco = endereço automático. Alguns nomes são reservados.", en: "Blank = automatic address. Some names are reserved." })}</LI>
              <LI>{L({ pt: "O tráfego chega no seu container na porta do campo PORT do .artix.", en: "Traffic reaches your container on the PORT defined in the .artix." })}</LI>
            </UL>
          </Section>

          <Section id="artix-file" title={L({ pt: "O arquivo .artix", en: "The .artix file" })}>
            <P>{L({ pt: "Fica na raiz do projeto e descreve como a aplicação roda (como no SquareCloud/Discloud):", en: "Lives in the project root and describes how the app runs (like SquareCloud/Discloud):" })}</P>
            <Table
              head={[L({ pt: "Campo", en: "Field" }), L({ pt: "Descrição", en: "Description" })]}
              rows={[
                [<C key="1">NAME</C>, L({ pt: "Nome da aplicação", en: "App name" })],
                [<C key="2">TYPE</C>, "discord_bot / site"],
                [<C key="3">RUNTIME</C>, "node / python"],
                [<C key="4">VERSION</C>, L({ pt: "Versão do runtime (ex.: 20)", en: "Runtime version (e.g. 20)" })],
                [<C key="5">RAM</C>, L({ pt: "RAM em MB (respeita o mínimo do tipo)", en: "RAM in MB (respects the type minimum)" })],
                [<C key="6">BUILD</C>, L({ pt: "Comando de build", en: "Build command" })],
                [<C key="7">START</C>, L({ pt: "Comando para iniciar", en: "Start command" })],
                [<C key="8">PORT</C>, L({ pt: "Porta HTTP (só para site)", en: "HTTP port (site only)" })],
              ]}
            />
            <CB
              lang=".artix"
              code={`NAME=meusite
TYPE=site
RUNTIME=node
VERSION=20
RAM=512
BUILD=npm install && npm run build
START=npm start
PORT=3000`}
            />
          </Section>

          <Section id="gerenciar" title={L({ pt: "Como gerenciar serviços", en: "Managing services" })}>
            <P>{L({ pt: "Cada container tem abas:", en: "Each container has tabs:" })}</P>
            <UL>
              <LI><B>{L({ pt: "Visão geral", en: "Overview" })}</B> — {L({ pt: "status, CPU/RAM, iniciar/parar/reiniciar, URL do site.", en: "status, CPU/RAM, start/stop/restart, site URL." })}</LI>
              <LI><B>Deploy</B> — {L({ pt: "envie um .zip ou faça deploy do GitHub, com etapas e log de build.", en: "upload a .zip or deploy from GitHub, with stages and build log." })}</LI>
              <LI><B>{L({ pt: "Arquivos", en: "Files" })}</B> — {L({ pt: "navegue e edite os arquivos (só leitura quando vem do GitHub).", en: "browse and edit files (read-only when from GitHub)." })}</LI>
              <LI><B>{L({ pt: "Histórico", en: "History" })}</B> — {L({ pt: "todos os deploys, com data, autor, commit e status.", en: "every deploy, with date, author, commit and status." })}</LI>
              <LI><B>Console</B> — {L({ pt: "logs em tempo real.", en: "realtime logs." })}</LI>
              <LI><B>{L({ pt: "Variáveis", en: "Variables" })}</B> — {L({ pt: "variáveis de ambiente.", en: "environment variables." })}</LI>
            </UL>
            <Callout>
              <P><B>Auto-redeploy:</B> {L({ pt: "ao fazer deploy pelo GitHub, todo push na branch monitorada dispara um novo deploy.", en: "when deploying from GitHub, every push to the tracked branch triggers a new deploy." })}</P>
            </Callout>
          </Section>

          <Section id="dev-panel" title={L({ pt: "Painel de desenvolvedor", en: "Developer panel" })}>
            <P>{L({ pt: "Abra Configurações → Desenvolvedor no painel. Ali você gera, vê e revoga API Keys para usar a API da Artix.", en: "Open Settings → Developer in the panel. There you generate, view and revoke API Keys to use the Artix API." })}</P>
            <P>{L({ pt: "Cada key mostra: nome, prefixo, data de criação, último uso, status e permissões.", en: "Each key shows: name, prefix, created date, last used, status and permissions." })}</P>
          </Section>

          <Section id="api-keys" title={L({ pt: "Como gerar e configurar API Keys", en: "Generating & configuring API Keys" })}>
            <UL>
              <LI>{L({ pt: "Em Configurações → Desenvolvedor, clique em Nova API Key.", en: "In Settings → Developer, click New API Key." })}</LI>
              <LI>{L({ pt: "Dê um nome e marque as permissões desejadas.", en: "Give it a name and check the permissions you want." })}</LI>
              <LI>{L({ pt: "O segredo (ak_…) aparece uma única vez — copie e guarde com segurança.", en: "The secret (ak_…) is shown only once — copy and store it securely." })}</LI>
              <LI>{L({ pt: "Para desativar, clique em Revogar — a chave para de funcionar na hora.", en: "To disable it, click Revoke — the key stops working immediately." })}</LI>
            </UL>
          </Section>

          <Section id="auth" title={L({ pt: "Autenticação", en: "Authentication" })}>
            <P>{L({ pt: "A API base fica em ", en: "The API base is at " })}<C>https://artix.cloud/api</C>. {L({ pt: "Autentique com sua key no cabeçalho ", en: "Authenticate with your key in the " })}<C>Authorization</C> {L({ pt: "header:", en: "header:" })}</P>
            <CB code={`curl https://artix.cloud/api/containers \\
  -H "Authorization: Bearer ak_sua_chave_aqui"`} />
            <P>{L({ pt: "Todas as respostas são JSON. Requisições com corpo usam ", en: "All responses are JSON. Requests with a body use " })}<C>Content-Type: application/json</C>.</P>
          </Section>

          <Section id="permissoes" title={L({ pt: "Permissões", en: "Permissions" })}>
            <P>{L({ pt: "Cada key só acessa o que foi autorizado. A validação roda no backend em cada requisição — sem o escopo, a resposta é ", en: "Each key only accesses what it was granted. Validation runs in the backend on every request — without the scope, the response is " })}<C>403</C>.</P>
            <Table
              head={[L({ pt: "Permissão", en: "Permission" }), L({ pt: "Escopo", en: "Scope" }), L({ pt: "O que libera", en: "What it allows" })]}
              rows={[
                [L({ pt: "Ver serviços", en: "View services" }), <C key="1">services.read</C>, L({ pt: "Listar/ver VPS e containers", en: "List/view VPS & containers" })],
                [L({ pt: "Criar serviços", en: "Create services" }), <C key="2">services.create</C>, L({ pt: "Criar, deploy, variáveis, arquivos", en: "Create, deploy, variables, files" })],
                [L({ pt: "Reiniciar", en: "Restart" }), <C key="3">services.restart</C>, L({ pt: "Iniciar, parar, reiniciar", en: "Start, stop, restart" })],
                [L({ pt: "Deletar", en: "Delete" }), <C key="4">services.delete</C>, L({ pt: "Excluir serviços", en: "Delete services" })],
                [L({ pt: "Métricas", en: "Metrics" }), <C key="5">metrics.read</C>, L({ pt: "CPU/RAM e status", en: "CPU/RAM and status" })],
                ["Logs", <C key="6">logs.read</C>, L({ pt: "Ler logs do app", en: "Read app logs" })],
                ["Console", <C key="7">console</C>, L({ pt: "Abrir console (VPS)", en: "Open console (VPS)" })],
                [L({ pt: "Histórico", en: "History" }), <C key="8">history.read</C>, L({ pt: "Histórico de deploys/ações", en: "Deploy/action history" })],
                [L({ pt: "Eventos", en: "Events" }), <C key="9">events</C>, L({ pt: "Stream de eventos em tempo real", en: "Realtime event stream" })],
                ["Billing", <C key="10">billing</C>, L({ pt: "Assinaturas e faturas", en: "Subscriptions & invoices" })],
                ["Admin", <C key="11">admin</C>, L({ pt: "Rotas de admin (requer conta admin)", en: "Admin routes (requires admin account)" })],
              ]}
            />
          </Section>

          <Section id="endpoints" title={L({ pt: "Referência de endpoints", en: "Endpoint reference" })}>
            <P>{L({ pt: "Principais endpoints de containers (base ", en: "Main container endpoints (base " })}<C>https://artix.cloud/api</C>):</P>
            <Table
              head={[L({ pt: "Método", en: "Method" }), "Endpoint", L({ pt: "Escopo", en: "Scope" }), L({ pt: "Descrição", en: "Description" })]}
              rows={[
                [<C key="a">GET</C>, <C key="b">/containers</C>, <C key="c">services.read</C>, L({ pt: "Lista seus containers", en: "List your containers" })],
                [<C key="d">GET</C>, <C key="e">/containers/:id</C>, <C key="f">services.read</C>, L({ pt: "Detalhes de um container", en: "One container's details" })],
                [<C key="g">POST</C>, <C key="h">/containers</C>, <C key="i">services.create</C>, L({ pt: "Cria (name, container_type, ram_mb, subdomain)", en: "Create (name, container_type, ram_mb, subdomain)" })],
                [<C key="j">DELETE</C>, <C key="k">/containers/:id</C>, <C key="l">services.delete</C>, L({ pt: "Exclui o container", en: "Delete the container" })],
                [<C key="m">POST</C>, <C key="n">/containers/:id/action</C>, <C key="o">services.restart</C>, L({ pt: "start/stop/restart (body: action)", en: "start/stop/restart (body: action)" })],
                [<C key="p">GET</C>, <C key="q">/containers/:id/stats</C>, <C key="r">metrics.read</C>, "CPU/RAM"],
                [<C key="s">GET</C>, <C key="t">/containers/:id/logs</C>, <C key="u">logs.read</C>, L({ pt: "Logs (query: tail)", en: "Logs (query: tail)" })],
                [<C key="v">GET</C>, <C key="w">/containers/:id/deploys</C>, <C key="x">history.read</C>, L({ pt: "Histórico de deploys", en: "Deploy history" })],
                [<C key="y">GET</C>, <C key="z">/containers/:id/env</C>, <C key="a2">services.read</C>, L({ pt: "Variáveis de ambiente", en: "Environment variables" })],
                [<C key="b2">PUT</C>, <C key="c2">/containers/:id/env</C>, <C key="d2">services.create</C>, L({ pt: "Define variáveis (body: env)", en: "Set variables (body: env)" })],
                [<C key="e2">POST</C>, <C key="f2">/containers/:id/deploy-github</C>, <C key="g2">services.create</C>, L({ pt: "Deploy de um repo (body: repo, ref)", en: "Deploy from a repo (body: repo, ref)" })],
                [<C key="h2">GET</C>, <C key="i2">/containers/ram</C>, <C key="j2">services.read</C>, L({ pt: "Saldo de RAM da conta", en: "Account RAM balance" })],
                [<C key="k2">GET</C>, <C key="l2">/events</C>, <C key="m2">events</C>, L({ pt: "Stream SSE de eventos", en: "SSE event stream" })],
                [<C key="n2">GET</C>, <C key="o2">/billing/invoices</C>, <C key="p2">billing</C>, L({ pt: "Suas faturas", en: "Your invoices" })],
              ]}
            />
            <P><B>{L({ pt: "Exemplo — listar containers:", en: "Example — list containers:" })}</B></P>
            <CB code={`curl https://artix.cloud/api/containers -H "Authorization: Bearer ak_..."`} />
            <CB
              lang="json"
              code={`[
  {
    "id": "6a45d5aab904b05664a7ac5e",
    "name": "meusite",
    "type": 1,
    "container": { "container_type": "site", "status": "running", "ram_mb": 512, "subdomain": "meusite" }
  }
]`}
            />
          </Section>

          <Section id="actions" title={L({ pt: "Ações e validação", en: "Actions & validation" })}>
            <P>{L({ pt: "Para iniciar/parar/reiniciar, envie a ação no corpo. Ações válidas: ", en: "To start/stop/restart, send the action in the body. Valid actions: " })}<C>start</C>, <C>stop</C>, <C>restart</C>.</P>
            <CB code={`curl -X POST https://artix.cloud/api/containers/<id>/action \\
  -H "Authorization: Bearer ak_..." \\
  -H "Content-Type: application/json" \\
  -d '{"action":"restart"}'`} />
            <P>{L({ pt: "Se a ação for inválida, a API não retorna um erro genérico — ela nomeia o erro e lista as ações aceitas:", en: "If the action is invalid, the API doesn't return a generic error — it names the mistake and lists the accepted actions:" })}</P>
            <CB
              lang="json"
              code={`{
  "error": "invalid_action",
  "message": "The action 'restartt' is invalid.",
  "allowed_actions": ["start", "stop", "restart"]
}`}
            />
            <P>{L({ pt: "Assim a integração fica autoexplicativa, sem tentativa e erro.", en: "This keeps integration self-documenting, without trial and error." })}</P>
          </Section>

          <Section id="realtime" title={L({ pt: "Eventos em tempo real", en: "Realtime events" })}>
            <P>{L({ pt: "Para evitar polling, conecte no gateway de eventos (SSE) e receba ações, deploys e status ao vivo. Requer o escopo ", en: "To avoid polling, connect to the events gateway (SSE) and receive actions, deploys and status live. Requires the " })}<C>events</C> {L({ pt: "e o header de autenticação:", en: "scope and the auth header:" })}</P>
            <CB code={`curl -N https://artix.cloud/events \\
  -H "Authorization: Bearer ak_..."`} />
            <P>{L({ pt: "Cada evento chega no formato SSE:", en: "Each event arrives in SSE format:" })}</P>
            <CB
              lang="text"
              code={`event: container.action
data: {"id":"6a45d5aa...","action":"restart","status":"running"}

event: container.deploy
data: {"id":"6a45d5aa...","source":"github","status":"success"}`}
            />
            <Callout>
              <P>{L({ pt: "A conexão fica aberta; um keep-alive é enviado periodicamente. Reconecte se cair. Também há um WebSocket para o painel (via ticket).", en: "The connection stays open; a keep-alive is sent periodically. Reconnect if it drops. There's also a WebSocket for the panel (via ticket)." })}</P>
            </Callout>
          </Section>

          <Section id="erros" title={L({ pt: "Códigos de erro", en: "Error codes" })}>
            <P>{L({ pt: "Erros de validação/negócio vêm como ", en: "Validation/business errors come as " })}<C>{`{ "error": { "code", "message" } }`}</C>{L({ pt: " (o erro de ação inválida é o caso especial acima). Status usados:", en: " (the invalid-action error is the special case above). Statuses used:" })}</P>
            <Table
              head={["Status", L({ pt: "Significado", en: "Meaning" })]}
              rows={[
                [<C key="1">400</C>, L({ pt: "Dados inválidos (ex.: RAM abaixo do mínimo)", en: "Invalid data (e.g. RAM below the minimum)" })],
                [<C key="2">401</C>, L({ pt: "Não autenticado (key ausente/inválida/revogada)", en: "Not authenticated (key missing/invalid/revoked)" })],
                [<C key="3">403</C>, L({ pt: "Sem permissão — a key não tem o escopo", en: "No permission — the key lacks the scope" })],
                [<C key="4">404</C>, L({ pt: "Não encontrado (ou não é seu)", en: "Not found (or not yours)" })],
                [<C key="5">409</C>, L({ pt: "Conflito (RAM insuficiente, subdomínio em uso)", en: "Conflict (insufficient RAM, subdomain taken)" })],
                [<C key="6">429</C>, L({ pt: "Muitas requisições", en: "Too many requests" })],
                [<C key="7">503</C>, L({ pt: "Indisponível no momento", en: "Temporarily unavailable" })],
              ]}
            />
          </Section>

          <Section id="boas-praticas" title={L({ pt: "Boas práticas de segurança", en: "Security best practices" })}>
            <UL>
              <LI><B>{L({ pt: "Menor privilégio", en: "Least privilege" })}</B> — {L({ pt: "dê a cada key só os escopos necessários.", en: "give each key only the scopes it needs." })}</LI>
              <LI><B>{L({ pt: "Nunca versione", en: "Never commit" })}</B> — {L({ pt: "keys no Git. Use variáveis de ambiente.", en: "keys to Git. Use environment variables." })}</LI>
              <LI><B>{L({ pt: "Uma key por uso", en: "One key per use" })}</B> — {L({ pt: "revogue uma sem afetar as outras.", en: "revoke one without affecting the rest." })}</LI>
              <LI><B>{L({ pt: "Rotacione", en: "Rotate" })}</B> — {L({ pt: "e revogue as que não usa.", en: "and revoke unused ones." })}</LI>
              <LI><B>{L({ pt: "Sempre HTTPS", en: "Always HTTPS" })}</B>.</LI>
            </UL>
          </Section>

          <Section id="faq" title={L({ pt: "Perguntas frequentes", en: "FAQ" })}>
            <P><B>{L({ pt: "Preciso de senha para a API?", en: "Do I need a password for the API?" })}</B> {L({ pt: "Não — a API usa API Keys. Login/senha é só para o painel.", en: "No — the API uses API Keys. Login/password is only for the panel." })}</P>
            <P><B>{L({ pt: "Perdi minha API Key.", en: "I lost my API Key." })}</B> {L({ pt: "Não dá pra recuperar o segredo. Revogue e gere outra.", en: "The secret can't be recovered. Revoke it and generate a new one." })}</P>
            <P><B>{L({ pt: "Como evito polling?", en: "How do I avoid polling?" })}</B> {L({ pt: "Use o stream de eventos (SSE) em ", en: "Use the event stream (SSE) at " })}<C>/events</C>.</P>
            <P><B>{L({ pt: "Uma ação inválida retorna o quê?", en: "What does an invalid action return?" })}</B> {L({ pt: "Um erro ", en: "An " })}<C>invalid_action</C> {L({ pt: "com a lista de ações aceitas.", en: "error with the list of accepted actions." })}</P>
          </Section>
        </div>
      </div>
    </div>
  );
}
