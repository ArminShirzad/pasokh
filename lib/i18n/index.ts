import fa from "./fa.json";

export const LOCALE_COOKIE = "pasokh-locale";
export const LOCALES = ["fa", "en"] as const;
export type Locale = (typeof LOCALES)[number];
// English is the source language: keys are the English copy, fa.json maps
// each one to Persian.
export type MessageKey = keyof typeof fa;

export function isLocale(value: unknown): value is Locale {
  return LOCALES.includes(value as Locale);
}

/**
 * The instance default, set by the installer (DEFAULT_LOCALE). Persian unless
 * configured otherwise: Pasokh is built for Persian-speaking businesses first.
 */
export function defaultLocale(): Locale {
  const configured = process.env.DEFAULT_LOCALE;
  return isLocale(configured) ? configured : "fa";
}

export function resolveLocale(value: unknown): Locale {
  return isLocale(value) ? value : defaultLocale();
}

export function localeDirection(locale: Locale): "rtl" | "ltr" {
  return locale === "fa" ? "rtl" : "ltr";
}

type Placeholders<S extends string> =
  S extends `${string}{${infer Name}}${infer Rest}`
    ? Name | Placeholders<Rest>
    : never;
export type StaticMessageKey = {
  [K in MessageKey]: [Placeholders<K>] extends [never] ? K : never;
}[MessageKey];
type MessageArgs<K extends MessageKey> = [Placeholders<K>] extends [never]
  ? []
  : [values: Record<Placeholders<K>, string | number>];

// English is the source language. Only application-owned copy belongs here;
// campaign messages, account names and API values are never translation keys.
const labels: Record<string, StaticMessageKey> = {
  ALL: "All",
  SENT: "Sent",
  FAILED: "Failed",
  PENDING: "Pending",
  SKIPPED_RATE_LIMIT: "Rate limited",
  SKIPPED_PLAN_LIMIT: "Plan limit",
  SKIPPED_DEDUP: "Dedup",
  OWNER: "Owner",
  ADMIN: "Admin",
  MEMBER: "Member",
  all: "All",
  active: "Active",
  paused: "Paused",
  waiting: "Waiting",
  delayed: "Delayed",
  failed: "Failed",
  Mon: "Mon",
  Tue: "Tue",
  Wed: "Wed",
  Thu: "Thu",
  Fri: "Fri",
  Sat: "Sat",
  Sun: "Sun",
};

export function createI18n(locale: Locale) {
  function t<K extends MessageKey>(key: K, ...args: MessageArgs<K>): string {
    // A key missing from fa.json renders in English rather than throwing.
    const message = (locale === "fa" ? (fa as Record<string, string>)[key] : undefined) ?? key;
    const values = args[0] as Record<string, string | number> | undefined;
    return message.replace(/\{(\w+)\}/g, (placeholder, name: string) =>
      values?.[name] === undefined
        ? placeholder
        : // Numbers follow the interface language: «۳ کمپین», "3 campaigns".
          typeof values[name] === "number"
          ? (values[name] as number).toLocaleString(locale === "fa" ? "fa" : "en")
          : String(values[name]),
    );
  }

  return {
    locale,
    dir: localeDirection(locale),
    t,
    label: (value: string) =>
      Object.hasOwn(labels, value) ? t(labels[value]) : value,
  };
}

export type I18n = ReturnType<typeof createI18n>;
