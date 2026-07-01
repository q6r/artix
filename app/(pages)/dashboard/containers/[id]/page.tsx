import type { Metadata } from "next";
import ContainerDetailClient from "@/components/containers/ContainerDetailClient";

export const metadata: Metadata = {
  title: "Container — ArtixCloud",
};

export default async function ContainerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ContainerDetailClient id={id} />;
}
