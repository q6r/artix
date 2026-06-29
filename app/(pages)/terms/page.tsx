import type { Metadata } from "next";
import LegalLayout from "@/components/LegalLayout";
import { getT } from "@/lib/i18n";

export const metadata: Metadata = {
  title: "Termos de Uso — ArtixCloud",
};

export default async function TermosPage() {
  const t = await getT();
  return (
    <LegalLayout
      title={t("legal.terms.title")}
      updated={t("legal.terms.updated")}
      intro={t("legal.terms.intro")}
      sections={[
        {
          heading: t("legal.terms.s1.h"),
          body: t("legal.terms.s1.b"),
        },
        {
          heading: t("legal.terms.s2.h"),
          body: t("legal.terms.s2.b"),
        },
        {
          heading: t("legal.terms.s3.h"),
          body: [t("legal.terms.s3.b1"), t("legal.terms.s3.b2")],
        },
        {
          heading: t("legal.terms.s4.h"),
          body: t("legal.terms.s4.b"),
        },
        {
          heading: t("legal.terms.s5.h"),
          body: t("legal.terms.s5.b"),
        },
        {
          heading: t("legal.terms.s6.h"),
          body: t("legal.terms.s6.b"),
        },
        {
          heading: t("legal.terms.s7.h"),
          body: t("legal.terms.s7.b"),
        },
      ]}
    />
  );
}
