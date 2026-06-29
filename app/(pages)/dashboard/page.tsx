import type { Metadata } from "next";
import OverviewClient from "@/components/dashboard/OverviewClient";

export const metadata: Metadata = {
  title: "Visão geral — ArtixCloud",
};

export default function DashboardOverview() {
  return <OverviewClient />;
}
