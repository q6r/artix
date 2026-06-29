import Image from "next/image";
import type { SVGProps } from "react";
import { getT } from "@/lib/i18n";

const XIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden {...props}>
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  </svg>
);

const DiscordIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden {...props}>
    <path d="M20.317 4.369A19.79 19.79 0 0016.558 3a.07.07 0 00-.073.035c-.211.375-.444.864-.608 1.249a18.27 18.27 0 00-5.487 0 12.6 12.6 0 00-.617-1.249.07.07 0 00-.073-.035A19.736 19.736 0 003.677 4.37a.064.064 0 00-.03.027C.533 9.046-.32 13.58.099 18.057a.08.08 0 00.031.055 19.9 19.9 0 005.993 3.03.07.07 0 00.076-.027c.462-.63.873-1.295 1.226-1.994a.07.07 0 00-.038-.098 13.1 13.1 0 01-1.872-.892.07.07 0 01-.007-.117c.126-.094.252-.192.372-.291a.07.07 0 01.071-.01c3.928 1.793 8.18 1.793 12.062 0a.07.07 0 01.072.009c.12.099.246.198.373.292a.07.07 0 01-.006.117c-.598.35-1.22.645-1.873.891a.07.07 0 00-.037.099c.36.698.772 1.362 1.225 1.993a.07.07 0 00.076.028 19.84 19.84 0 006.002-3.03.07.07 0 00.032-.054c.5-5.177-.838-9.674-3.549-13.66a.06.06 0 00-.03-.028zM8.02 15.331c-1.182 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
  </svg>
);

const GithubIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden {...props}>
    <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0112 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222 0 1.606-.014 2.898-.014 3.293 0 .322.216.694.825.576C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
  </svg>
);

const LinkedinIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden {...props}>
    <path d="M19 0h-14c-2.761 0-5 2.239-5 5v14c0 2.761 2.239 5 5 5h14c2.762 0 5-2.239 5-5v-14c0-2.761-2.238-5-5-5zm-11 19h-3v-11h3v11zm-1.5-12.268c-.966 0-1.75-.79-1.75-1.764s.784-1.764 1.75-1.764 1.75.79 1.75 1.764-.783 1.764-1.75 1.764zm13.5 12.268h-3v-5.604c0-3.368-4-3.113-4 0v5.604h-3v-11h3v1.765c1.396-2.586 7-2.777 7 2.476v6.759z" />
  </svg>
);

const columns = [
  {
    title: "footer.col.produto",
    links: [
      { label: "footer.recursos", href: "/#recursos" },
      { label: "footer.planos", href: "/#planos" },
      { label: "footer.depoimentos", href: "/#depoimentos" },
      { label: "footer.status", href: "/status" },
    ],
  },
  {
    title: "footer.col.empresa",
    links: [
      { label: "footer.sobre", href: "#" },
      { label: "footer.blog", href: "/blog" },
      { label: "footer.carreiras", href: "#" },
      { label: "footer.contato", href: "#" },
    ],
  },
  {
    title: "footer.col.suporte",
    links: [
      { label: "footer.ajuda", href: "#" },
      { label: "footer.docs", href: "#" },
      { label: "footer.faq", href: "/#faq" },
      { label: "footer.entrar", href: "/login" },
    ],
  },
  {
    title: "footer.col.legal",
    links: [
      { label: "footer.termos", href: "/terms" },
      { label: "footer.privacidade", href: "/privacidade" },
      { label: "footer.cookies", href: "/cookies" },
      { label: "footer.dmca", href: "/dmca" },
    ],
  },
];

const socials = [
  { label: "X", href: "#", icon: XIcon },
  { label: "Discord", href: "#", icon: DiscordIcon },
  { label: "GitHub", href: "#", icon: GithubIcon },
  { label: "LinkedIn", href: "#", icon: LinkedinIcon },
];

export default async function Footer() {
  const t = await getT();
  return (
    <footer className="relative mt-12 border-t border-white/10">
      {/* subtle top glow */}
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-0 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent" />

      <div className="mx-auto w-full max-w-6xl px-6 py-16">
        <div className="grid grid-cols-2 gap-10 md:grid-cols-6">
          {/* Brand */}
          <div className="col-span-2">
            <a href="#" className="flex items-center gap-2">
              <Image
                src="/logo.svg"
                alt="ArtixCloud"
                width={32}
                height={32}
                className="h-8 w-8"
              />
              <span className="font-logo text-xl tracking-tight">
                Artix<span className="text-white/45">Cloud</span>
              </span>
            </a>
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-white/55">
              {t("footer.tagline")}
            </p>

            <div className="mt-5 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white/60">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
              </span>
              {t("footer.systemStatus")}
            </div>

            <div className="mt-6 flex gap-2">
              {socials.map((s) => (
                <a
                  key={s.label}
                  href={s.href}
                  aria-label={s.label}
                  className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-white/70 transition-colors hover:border-white/20 hover:bg-white/10 hover:text-white"
                >
                  <s.icon className="h-4 w-4" strokeWidth={1.6} />
                </a>
              ))}
            </div>
          </div>

          {/* Link columns */}
          {columns.map((col) => (
            <div key={col.title}>
              <h3 className="text-sm font-medium text-white">{t(col.title)}</h3>
              <ul className="mt-4 flex flex-col gap-3 text-sm">
                {col.links.map((l) => (
                  <li key={l.label}>
                    <a
                      href={l.href}
                      className="text-white/55 transition-colors hover:text-white"
                    >
                      {t(l.label)}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Bottom bar */}
        <div className="mt-14 flex flex-col items-center justify-between gap-4 border-t border-white/10 pt-6 text-sm text-white/45 sm:flex-row">
          <span>
            © {new Date().getFullYear()} ArtixCloud. {t("footer.rights")}
          </span>
          <span className="flex items-center gap-1.5">
            {t("footer.made")}
            <span className="text-white/70">Brasil 💚</span>
          </span>
        </div>
      </div>
    </footer>
  );
}
