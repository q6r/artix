import type { Metadata } from "next";
import ServersClient from "@/components/servers/ServersClient";

export const metadata: Metadata = {
  title: "Servidores — ArtixCloud",
};

export default function ServersPage() {
  return <ServersClient />;
}
