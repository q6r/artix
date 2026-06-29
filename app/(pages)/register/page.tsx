import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import Logo from "@/components/Logo";
import AuthForm from "@/components/AuthForm";
import FadeIn from "@/components/FadeIn";
import { getT } from "@/lib/i18n";

export const metadata: Metadata = {
  title: "Criar conta — ArtixCloud",
};

export default async function RegisterPage() {
  const t = await getT();
  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-6 py-16">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[url('/auth-background.png')] bg-cover bg-center opacity-[0.18] mix-blend-screen [mask-image:radial-gradient(ellipse_at_center,#000_0%,rgba(0,0,0,0.4)_45%,transparent_80%)]"
      ></div>
      <FadeIn className="relative z-10 w-full max-w-sm rounded-2xl border border-white/10 bg-black p-8">
        <div className="flex justify-center">
          <Logo />
        </div>

        <div className="mt-6">
          <Suspense>
            <AuthForm
              mode="register"
              title={t("auth.register.title")}
              subtitle={t("auth.register.subtitle")}
            />
          </Suspense>
        </div>

        <p className="mt-6 text-center text-sm text-white/55">
          {t("auth.register.hasAccount")}{" "}
          <Link
            href="/login"
            className="font-medium text-white underline-offset-4 hover:underline"
          >
            {t("auth.register.signIn")}
          </Link>
        </p>

        <p className="mt-4 text-center text-xs text-white/35">
          {t("auth.register.termsPrefix")}{" "}
          <Link href="/terms" className="underline underline-offset-4">
            {t("auth.register.terms")}
          </Link>{" "}
          {t("auth.register.termsAnd")}{" "}
          <Link href="/privacidade" className="underline underline-offset-4">
            {t("auth.register.privacy")}
          </Link>
          .
        </p>
      </FadeIn>
    </main>
  );
}
