import type { Metadata } from "next";
import SupportClient from "@/components/support/SupportClient";

export const metadata: Metadata = {
  title: "Suporte — ArtixCloud",
};

export default function SupportPage() {
  return <SupportClient />;
}
