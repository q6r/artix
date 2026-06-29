import { common } from "./dict/common";
import { home } from "./dict/home";
import { auth } from "./dict/auth";
import { legal } from "./dict/legal";
import { blog } from "./dict/blog";
import { dashboard } from "./dict/dashboard";
import { billing } from "./dict/billing";
import { serversDict } from "./dict/servers";
import { orgsup } from "./dict/orgsup";
import { admin } from "./dict/admin";
import { wizard } from "./dict/wizard";

export const locales = ["pt", "en", "es"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "pt";

type Dict = Record<string, string>;

export const dictionaries: Record<Locale, Dict> = {
  pt: {
    ...common.pt,
    ...home.pt,
    ...auth.pt,
    ...legal.pt,
    ...blog.pt,
    ...dashboard.pt,
    ...billing.pt,
    ...serversDict.pt,
    ...orgsup.pt,
    ...admin.pt,
    ...wizard.pt,
  },
  en: {
    ...common.en,
    ...home.en,
    ...auth.en,
    ...legal.en,
    ...blog.en,
    ...dashboard.en,
    ...billing.en,
    ...serversDict.en,
    ...orgsup.en,
    ...admin.en,
    ...wizard.en,
  },
  es: {
    ...common.es,
    ...home.es,
    ...auth.es,
    ...legal.es,
    ...blog.es,
    ...dashboard.es,
    ...billing.es,
    ...serversDict.es,
    ...orgsup.es,
    ...admin.es,
    ...wizard.es,
  },
};
