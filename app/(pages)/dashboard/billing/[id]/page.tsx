import type { Metadata } from "next";
import InvoiceClient from "@/components/billing/InvoiceClient";

export const metadata: Metadata = {
  title: "Fatura — ArtixCloud",
};

export default async function InvoiceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <InvoiceClient id={id} />;
}
