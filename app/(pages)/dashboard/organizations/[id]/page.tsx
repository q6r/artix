import type { Metadata } from "next";
import OrgDetailClient from "@/components/orgs/OrgDetailClient";

export const metadata: Metadata = {
  title: "Organização — ArtixCloud",
};

export default async function OrgPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <OrgDetailClient id={id} />;
}
