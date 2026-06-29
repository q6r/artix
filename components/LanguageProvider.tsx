"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  dictionaries,
  defaultLocale,
  type Locale,
} from "@/lib/dictionaries";

type LangContext = {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: string) => string;
};

const Ctx = createContext<LangContext>({
  locale: defaultLocale,
  setLocale: () => {},
  t: (k) => k,
});

export function LanguageProvider({
  initialLocale,
  children,
}: {
  initialLocale: Locale;
  children: ReactNode;
}) {
  const router = useRouter();
  const [locale, setLocaleState] = useState<Locale>(initialLocale);

  const setLocale = (l: Locale) => {
    document.cookie = `locale=${l}; path=/; max-age=31536000`;
    setLocaleState(l);
    router.refresh();
  };

  const t = (key: string) =>
    dictionaries[locale][key] ?? dictionaries[defaultLocale][key] ?? key;

  return (
    <Ctx.Provider value={{ locale, setLocale, t }}>{children}</Ctx.Provider>
  );
}

export function useLang() {
  return useContext(Ctx);
}
