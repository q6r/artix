import type { Metadata } from "next";
import TicketClient from "@/components/support/TicketClient";

export const metadata: Metadata = {
  title: "Chamado — ArtixCloud",
};

export default async function TicketPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <TicketClient id={id} />;
}
