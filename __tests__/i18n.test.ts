import { afterEach, describe, expect, it } from "vitest";
import { createI18n, resolveLocale } from "../lib/i18n";
import fa from "../lib/i18n/fa.json";

describe("interface translations", () => {
  afterEach(() => {
    delete process.env.DEFAULT_LOCALE;
  });

  it("falls back to Persian for absent or unsupported preferences", () => {
    for (const value of [undefined, null, "", "fr", "fa-AF", "../fa", "zh-TW"]) {
      expect(resolveLocale(value)).toBe("fa");
    }
    expect(resolveLocale("en")).toBe("en");
  });

  it("falls back to the instance's DEFAULT_LOCALE when the installer set one", () => {
    process.env.DEFAULT_LOCALE = "en";
    expect(resolveLocale(undefined)).toBe("en");
    expect(resolveLocale("fa")).toBe("fa");
  });

  it("ignores a DEFAULT_LOCALE that is not a supported language", () => {
    process.env.DEFAULT_LOCALE = "de";
    expect(resolveLocale(undefined)).toBe("fa");
  });

  it("renders Persian right-to-left and English left-to-right", () => {
    expect(createI18n("fa").dir).toBe("rtl");
    expect(createI18n("en").dir).toBe("ltr");
  });

  it("renders both interface languages from the same keys", () => {
    expect(createI18n("en").t("Campaigns")).toBe("Campaigns");
    expect(createI18n("fa").t("Campaigns")).toBe("کمپین‌ها");
  });

  it("allows sentence order to differ between languages", () => {
    const values = { count: 2 };
    expect(createI18n("en").t("{count} connected accounts", values)).toBe(
      "2 connected accounts",
    );
    expect(createI18n("fa").t("{count} connected accounts", values)).toBe(
      "۲ حساب متصل",
    );
  });

  it("preserves interpolation values verbatim, including user content and zero", () => {
    const { t } = createI18n("fa");
    expect(t("Hello, {name}!", { name: "{count} <b>Alex</b> $&" })).toBe(
      "سلام {count} <b>Alex</b> $&!",
    );
    expect(t("{count} campaigns", { count: 0 })).toBe("۰ کمپین");
    // Numbers render in Persian digits in Persian, but strings are left as given.
    expect(t("{count} campaigns", { count: "12" })).toBe("12 کمپین");
  });

  it("translates display labels without changing stored codes or unknown values", () => {
    const codes = ["SENT", "OWNER", "active", "CUSTOM_STATUS"];
    expect(codes.map(createI18n("fa").label)).toEqual([
      "ارسال‌شده",
      "مالک",
      "فعال",
      "CUSTOM_STATUS",
    ]);
    expect(codes).toEqual(["SENT", "OWNER", "active", "CUSTOM_STATUS"]);
    expect(createI18n("fa").label("toString")).toBe("toString");
    expect(createI18n("fa").label("__proto__")).toBe("__proto__");
  });

  it("has complete, plain-text translations with matching interpolation fields", () => {
    const placeholders = (text: string) =>
      [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
    for (const [source, translation] of Object.entries(fa)) {
      expect(translation.trim(), source).not.toBe("");
      expect(placeholders(translation), source).toEqual(placeholders(source));
      expect(source, source).not.toMatch(/&(?:[a-z]+|#\d+);/i);
    }
  });
});
