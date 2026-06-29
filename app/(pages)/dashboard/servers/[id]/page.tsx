import type { Metadata } from "next";
import ServerDetailClient from "@/components/servers/ServerDetailClient";

export const metadata: Metadata = {
  title: "Servidor — ArtixCloud",
};

export default async function ServerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ServerDetailClient id={id} />;
}
