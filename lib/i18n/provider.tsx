"use client";

import { createContext, useContext, useEffect, useMemo } from "react";
import { createI18n, type Locale } from "./index";

// Every page sits under a provider; this default only covers a component
// rendered outside one (tests, error boundaries), and English is the source.
const I18nContext = createContext(createI18n("en"));

export function I18nProvider({
  locale,
  children,
}: {
  locale: Locale;
  children: React.ReactNode;
}) {
  const value = useMemo(() => createI18n(locale), [locale]);

  // The root layout sets lang and dir on the server; this keeps them right
  // after a client-side language switch without a full reload.
  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = value.dir;
  }, [locale, value.dir]);

  return (
    <I18nContext.Provider value={value}>
      <div lang={locale} dir={value.dir} className="contents">
        {children}
      </div>
    </I18nContext.Provider>
  );
}

export function useI18n() {
  return useContext(I18nContext);
}
