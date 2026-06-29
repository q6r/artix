import type { Metadata } from "next";
import LegalLayout from "@/components/LegalLayout";
import { getT } from "@/lib/i18n";

export const metadata: Metadata = {
  title: "Política de DMCA — ArtixCloud",
};

export default async function DmcaPage() {
  const t = await getT();
  return (
    <LegalLayout
      title={t("legal.dmca.title")}
      updated={t("legal.dmca.updated")}
      intro={t("legal.dmca.intro")}
      sections={[
        {
          heading: t("legal.dmca.s1.h"),
          body: t("legal.dmca.s1.b"),
        },
        {
          heading: t("legal.dmca.s2.h"),
          body: [
            t("legal.dmca.s2.b1"),
            t("legal.dmca.s2.b2"),
            t("legal.dmca.s2.b3"),
            t("legal.dmca.s2.b4"),
            t("legal.dmca.s2.b5"),
          ],
        },
        {
          heading: t("legal.dmca.s3.h"),
          body: t("legal.dmca.s3.b"),
        },
        {
          heading: t("legal.dmca.s4.h"),
          body: t("legal.dmca.s4.b"),
        },
        {
          heading: t("legal.dmca.s5.h"),
          body: t("legal.dmca.s5.b"),
        },
        {
          heading: t("legal.dmca.s6.h"),
          body: t("legal.dmca.s6.b"),
        },
      ]}
    />
  );
}
