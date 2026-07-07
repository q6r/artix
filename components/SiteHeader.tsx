import Link from "next/link";
import Logo from "@/components/Logo";
import SiteHeaderMobile from "@/components/SiteHeaderMobile";
import SiteHeaderActions from "@/components/SiteHeaderActions";
import { getT } from "@/lib/i18n";

const links = [
  { key: "nav.recursos", href: "/#recursos" },
  { key: "nav.planos", href: "/#planos" },
  { key: "nav.status", href: "/status" },
  { key: "nav.blog", href: "/blog" },
];

export default async function SiteHeader() {
  const t = await getT();
  return (
    <header className="sticky top-0 z-50 border-b border-white/10 bg-black/60 backdrop-blur-xl">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-6">
        <Logo />

        <nav className="hidden items-center gap-7 text-sm text-white/70 md:flex">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="transition-colors hover:text-white"
            >
              {t(l.key)}
            </Link>
          ))}
        </nav>

        {/* Desktop actions */}
        <div className="hidden items-center gap-3 md:flex">
          <SiteHeaderActions
            dashboardLabel={t("nav.painel")}
            loginLabel={t("nav.entrar")}
            registerLabel={t("nav.criarConta")}
          />
        </div>

        {/* Mobile menu */}
        <SiteHeaderMobile
          links={links.map((l) => ({ label: t(l.key), href: l.href }))}
          loginLabel={t("nav.entrar")}
          registerLabel={t("nav.criarConta")}
          dashboardLabel={t("nav.painel")}
        />
      </div>
    </header>
  );
}
