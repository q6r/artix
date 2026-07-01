import type { Metadata } from "next";
import ContainersClient from "@/components/containers/ContainersClient";

export const metadata: Metadata = {
  title: "Containers — ArtixCloud",
};

export default function ContainersPage() {
  return <ContainersClient />;
}
