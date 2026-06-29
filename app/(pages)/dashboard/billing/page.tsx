import type { Metadata } from "next";
import BillingClient from "@/components/billing/BillingClient";

export const metadata: Metadata = {
  title: "Faturamento — ArtixCloud",
};

export default function BillingPage() {
  return <BillingClient />;
}
