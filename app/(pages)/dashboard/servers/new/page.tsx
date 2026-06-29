import { redirect } from "next/navigation";

// Creating a VPS now goes through billing checkout (subscribe → pay PIX →
// provision), so this legacy route forwards there.
export default function NewServerPage() {
  redirect("/dashboard/billing/new");
}
