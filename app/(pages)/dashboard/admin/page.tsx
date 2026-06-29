import type { Metadata } from "next";
import { notFound } from "next/navigation";
import AdminClient from "@/components/admin/AdminClient";
import SessionRefresh from "@/components/SessionRefresh";
import { getMe } from "@/lib/api/server";
import { hasAdminAccess } from "@/lib/permissions";

export const metadata: Metadata = {
  title: "Admin — ArtixCloud",
};

// Hard server-side gate: the admin panel (even its empty shell) is never sent
// to the client without an admin permission. Every /admin API call is also
// permission-checked on the backend; this additionally stops the UI from
// rendering at all for unauthorized users (no visual access, nothing to
// intercept).
export default async function AdminPage() {
  const { user, expired } = await getMe();
  if (expired) return <SessionRefresh />;
  if (!user || !hasAdminAccess(user.permissions)) notFound();
  return <AdminClient />;
}
