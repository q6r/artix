import type { Metadata } from "next";
import AdminClient from "@/components/admin/AdminClient";

export const metadata: Metadata = {
  title: "Admin — ArtixCloud",
};

export default function AdminPage() {
  return <AdminClient />;
}
