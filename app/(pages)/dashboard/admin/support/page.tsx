import type { Metadata } from "next";
import AdminSupportInbox from "@/components/admin/AdminSupportInbox";

export const metadata: Metadata = {
  title: "Chamados da equipe — ArtixCloud",
};

export default function AdminSupportPage() {
  return <AdminSupportInbox />;
}
