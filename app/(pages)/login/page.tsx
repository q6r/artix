import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import Logo from "@/components/Logo";
import AuthForm from "@/components/AuthForm";
import FadeIn from "@/components/FadeIn";
import { getT } from "@/lib/i18n";

export const metadata: Metadata = {
  title: "Entrar — ArtixCloud",
};

export default async function LoginPage() {
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
              mode="login"
              title={t("auth.login.title")}
              subtitle={t("auth.login.subtitle")}
            />
          </Suspense>
        </div>

        <p className="mt-6 text-center text-sm text-white/55">
          {t("auth.login.noAccount")}{" "}
          <Link
            href="/register"
            className="font-medium text-white underline-offset-4 hover:underline"
          >
            {t("auth.login.createAccount")}
          </Link>
        </p>
      </FadeIn>
    </main>
  );
}
