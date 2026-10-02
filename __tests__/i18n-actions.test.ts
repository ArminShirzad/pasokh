import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => store }));

import { setLocale } from "../lib/i18n/actions";
import { getI18n } from "../lib/i18n/server";
import { LOCALE_COOKIE } from "../lib/i18n";

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllEnvs());

describe("language preference", () => {
  it("renders a saved language on the server before hydration", async () => {
    store.get.mockReturnValue({ value: "en" });
    const { locale, dir, t } = await getI18n();
    expect(store.get).toHaveBeenCalledWith(LOCALE_COOKIE);
    expect(locale).toBe("en");
    expect(dir).toBe("ltr");
    expect(t("Settings")).toBe("Settings");
  });

  it("renders Persian right-to-left from the cookie", async () => {
    store.get.mockReturnValue({ value: "fa" });
    const { dir, t } = await getI18n();
    expect(dir).toBe("rtl");
    expect(t("Settings")).toBe("تنظیمات");
  });

  it("falls back to the instance default for an invalid cookie", async () => {
    store.get.mockReturnValue({ value: "unsupported" });
    expect((await getI18n()).locale).toBe("fa");
  });

  it("persists only the language cookie, across routes and browser restarts", async () => {
    vi.stubEnv("NEXTAUTH_URL", "https://pasokh.example.com");
    await setLocale("fa");
    expect(store.set).toHaveBeenCalledExactlyOnceWith(LOCALE_COOKIE, "fa", {
      path: "/",
      maxAge: 31_536_000,
      sameSite: "lax",
      httpOnly: true,
      secure: true,
    });
  });

  it("still saves the language on a production instance served over plain http", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXTAUTH_URL", "http://203.0.113.7:3000");
    await setLocale("en");
    expect(store.set).toHaveBeenCalledWith(
      LOCALE_COOKIE,
      "en",
      expect.objectContaining({ secure: false }),
    );
  });

  it("rejects an unsupported locale without writing cookies", async () => {
    await expect(setLocale("en; path=/")).rejects.toThrow("Unsupported locale");
    expect(store.set).not.toHaveBeenCalled();
  });
});
