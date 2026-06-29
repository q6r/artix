import type { Metadata } from "next";
import OrgsClient from "@/components/orgs/OrgsClient";

export const metadata: Metadata = {
  title: "Organizações — ArtixCloud",
};

export default function OrganizationsPage() {
  return <OrgsClient />;
}
