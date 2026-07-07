import type { Metadata } from "next";
import CreateContainerClient from "@/components/containers/CreateContainerClient";

export const metadata: Metadata = {
  title: "Novo container — ArtixCloud",
};

export default function NewContainerPage() {
  return <CreateContainerClient />;
}
