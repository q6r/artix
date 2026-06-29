import type { Metadata } from "next";
import CheckoutClient from "@/components/billing/CheckoutClient";

export const metadata: Metadata = {
  title: "Assinar plano — ArtixCloud",
};

export default function NewSubscriptionPage() {
  return <CheckoutClient />;
}
