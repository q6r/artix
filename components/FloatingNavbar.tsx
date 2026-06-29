"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { RippleButton } from "@/components/animate-ui/components/buttons/ripple";
import { useLang } from "@/components/LanguageProvider";
import { useAuth } from "@/components/AuthProvider";
import AuthMenu from "@/components/AuthMenu";

const links = [
  { key: "nav.recursos", href: "#recursos" },
  { key: "nav.planos", href: "#planos" },
  { key: "nav.faq", href: "#faq" },
];

export default function FloatingNavbar() {
  const { t } = useLang();
  const { user } = useAuth();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div
      className={`fixed inset-x-0 z-50 flex justify-center transition-all duration-300 ${
        scrolled ? "top-2" : "top-5"
      }`}
    >
      <nav
        className={`flex items-center justify-between gap-4 rounded-[20px] border border-white/10 backdrop-blur-xl transition-all duration-300 ${
          scrolled
            ? "h-12 w-[min(680px,92vw)] bg-black/70 px-3 shadow-lg shadow-black/40"
            : "h-16 w-[min(880px,94vw)] bg-black/40 px-5"
        }`}
      >
        {/* Logo */}
        <a href="#" className="flex items-center gap-2">
          <Image
            src="/logo.svg"
            alt="ArtixCloud"
            width={40}
            height={40}
            priority
            className={`transition-all duration-300 ${
              scrolled ? "h-9 w-9" : "h-10 w-10"
            }`}
          />
          <span
            className={`font-logo mt-2 tracking-tight transition-all duration-300 ${
              scrolled ? "text-lg" : "text-xl"
            }`}
          >
            Artix<span className="text-white/45">Cloud</span>
          </span>
        </a>

        {/* Links */}
        <div className="hidden items-center mt-0.5 gap-7 text-sm text-white/70 md:flex">
          {links.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="relative transition-colors hover:text-white after:absolute after:-bottom-1 after:left-0 after:h-px after:w-full after:origin-left after:scale-x-0 after:bg-white after:transition-transform after:duration-300 hover:after:scale-x-100"
            >
              {t(l.key)}
            </a>
          ))}
        </div>

        {/* CTA */}
        {user ? (
          <AuthMenu compact={scrolled} />
        ) : (
          <RippleButton
            onClick={() =>
              document
                .querySelector("#planos")
                ?.scrollIntoView({ behavior: "smooth" })
            }
            className={`rounded-full bg-white font-medium text-black transition-all duration-300 hover:bg-white/85 ${
              scrolled ? "h-8 px-4 text-xs" : "h-10 px-5 text-sm"
            }`}
          >
            <a className="mt-0.5">{t("nav.comecar")}</a>
          </RippleButton>
        )}
      </nav>
    </div>
  );
}
