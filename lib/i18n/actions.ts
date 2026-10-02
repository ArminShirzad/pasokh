"use server";

import { cookies } from "next/headers";
import { getBaseUrl } from "@/lib/env";
import { isLocale, LOCALE_COOKIE } from "./index";

export async function setLocale(value: string) {
  if (!isLocale(value)) throw new Error("Unsupported locale");
  const cookieStore = await cookies();
  cookieStore.set(LOCALE_COOKIE, value, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
    httpOnly: true,
    // Secure follows the instance's public URL, not NODE_ENV: a production
    // container opened over plain http://<server-ip>:3000 would otherwise get
    // a cookie the browser refuses to store, and the switch silently fails.
    secure: getBaseUrl().startsWith("https://"),
  });
}
