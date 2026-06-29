import SiteHeader from "@/components/SiteHeader";
import Footer from "@/components/Footer";
import { getT } from "@/lib/i18n";

export type LegalSection = {
  heading: string;
  body: string | string[];
};

type LegalLayoutProps = {
  title: string;
  updated: string;
  intro?: string;
  sections: LegalSection[];
};

export default async function LegalLayout({
  title,
  updated,
  intro,
  sections,
}: LegalLayoutProps) {
  const t = await getT();
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl px-6 py-16 sm:py-24">
        <p className="text-sm font-medium text-white/40">{t("legal.label")}</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
          {title}
        </h1>
        <p className="mt-3 text-sm text-white/45">
          {t("legal.updatedLabel")} {updated}
        </p>

        {intro && (
          <p className="mt-8 text-pretty leading-relaxed text-white/65">
            {intro}
          </p>
        )}

        <div className="mt-10 space-y-10">
          {sections.map((s, i) => (
            <section key={i}>
              <h2 className="text-lg font-semibold tracking-tight">
                {s.heading}
              </h2>
              {(Array.isArray(s.body) ? s.body : [s.body]).map((p, j) => (
                <p
                  key={j}
                  className="mt-3 text-sm leading-relaxed text-white/60"
                >
                  {p}
                </p>
              ))}
            </section>
          ))}
        </div>

        <div className="mt-14 rounded-2xl border border-white/10 bg-white/[0.02] p-6 text-sm text-white/60">
          {t("legal.contact.b1")}{" "}
          <a
            href="mailto:legal@artixcloud.com"
            className="text-white underline-offset-4 hover:underline"
          >
            legal@artixcloud.com
          </a>
          .
        </div>
      </main>
      <Footer />
    </>
  );
}
