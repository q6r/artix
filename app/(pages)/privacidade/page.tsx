import type { Metadata } from "next";
import LegalLayout from "@/components/LegalLayout";
import { getT } from "@/lib/i18n";

export const metadata: Metadata = {
  title: "Política de Privacidade — ArtixCloud",
};

export default async function PrivacidadePage() {
  const t = await getT();
  return (
    <LegalLayout
      title={t("legal.privacy.title")}
      updated={t("legal.privacy.updated")}
      intro={t("legal.privacy.intro")}
      sections={[
        {
          heading: t("legal.privacy.s1.h"),
          body: [t("legal.privacy.s1.b1"), t("legal.privacy.s1.b2")],
        },
        {
          heading: t("legal.privacy.s2.h"),
          body: t("legal.privacy.s2.b"),
        },
        {
          heading: t("legal.privacy.s3.h"),
          body: t("legal.privacy.s3.b"),
        },
        {
          heading: t("legal.privacy.s4.h"),
          body: t("legal.privacy.s4.b"),
        },
        {
          heading: t("legal.privacy.s5.h"),
          body: t("legal.privacy.s5.b"),
        },
        {
          heading: t("legal.privacy.s6.h"),
          body: t("legal.privacy.s6.b"),
        },
        {
          heading: t("legal.privacy.s7.h"),
          body: t("legal.privacy.s7.b"),
        },
      ]}
    />
  );
}
