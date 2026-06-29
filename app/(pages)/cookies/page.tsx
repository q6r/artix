import type { Metadata } from "next";
import LegalLayout from "@/components/LegalLayout";
import { getT } from "@/lib/i18n";

export const metadata: Metadata = {
  title: "Política de Cookies — ArtixCloud",
};

export default async function CookiesPage() {
  const t = await getT();
  return (
    <LegalLayout
      title={t("legal.cookies.title")}
      updated={t("legal.cookies.updated")}
      intro={t("legal.cookies.intro")}
      sections={[
        {
          heading: t("legal.cookies.s1.h"),
          body: t("legal.cookies.s1.b"),
        },
        {
          heading: t("legal.cookies.s2.h"),
          body: [
            t("legal.cookies.s2.b1"),
            t("legal.cookies.s2.b2"),
            t("legal.cookies.s2.b3"),
          ],
        },
        {
          heading: t("legal.cookies.s3.h"),
          body: t("legal.cookies.s3.b"),
        },
        {
          heading: t("legal.cookies.s4.h"),
          body: t("legal.cookies.s4.b"),
        },
        {
          heading: t("legal.cookies.s5.h"),
          body: t("legal.cookies.s5.b"),
        },
      ]}
    />
  );
}
