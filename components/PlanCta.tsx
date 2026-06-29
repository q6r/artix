"use client";

import ActionButton from "@/components/ActionButton";
import { useAuth } from "@/components/AuthProvider";
import { useLang } from "@/components/LanguageProvider";

/**
 * Pricing "Contratar" button. Sends visitors to /login; logged-in users go
 * straight to the create-server flow.
 */
export default function PlanCta({ highlight = false }: { highlight?: boolean }) {
  const { user } = useAuth();
  const { t } = useLang();
  return (
    <ActionButton
      href={user ? "/dashboard/servers/new" : "/login"}
      variant={highlight ? "primary" : "secondary"}
      className="mt-8 h-11 w-full text-sm"
    >
      <a className="mt-0.5">{t("home.pricing.cta")}</a>
    </ActionButton>
  );
}
