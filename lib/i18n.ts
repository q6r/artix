import { cookies } from "next/headers";
import {
  dictionaries,
  defaultLocale,
  locales,
  type Locale,
} from "@/lib/dictionaries";

export async function getLocale(): Promise<Locale> {
  const store = await cookies();
  const value = store.get("locale")?.value as Locale | undefined;
  return value && locales.includes(value) ? value : defaultLocale;
}

export async function getT() {
  const locale = await getLocale();
  return (key: string) =>
    dictionaries[locale][key] ?? dictionaries[defaultLocale][key] ?? key;
}
