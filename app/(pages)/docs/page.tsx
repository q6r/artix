import type { Metadata } from "next";
import SiteHeader from "@/components/SiteHeader";
import Footer from "@/components/Footer";
import DocsClient from "@/components/DocsClient";

export const metadata: Metadata = {
  title: "Documentação — ArtixCloud",
  description:
    "Documentação da Artix: VPS, containers, o arquivo .artix, o painel e a API — para usuários e desenvolvedores.",
};

export default function DocsPage() {
  return (
    <>
      <SiteHeader />
      <main className="min-h-screen">
        <DocsClient />
      </main>
      <Footer />
    </>
  );
}
