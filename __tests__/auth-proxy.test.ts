import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { config, proxy } from "../proxy";

function request(path: string, cookie?: string) {
  return new NextRequest(`http://localhost:3000${path}`, {
    headers: cookie ? { cookie } : {},
  });
}

describe("auth proxy", () => {
  it("sends a signed-out visitor from the dashboard to /login with a way back", () => {
    const response = proxy(request("/dashboard"));
    expect(response.headers.get("location")).toBe("http://localhost:3000/login?callbackUrl=%2Fdashboard");
  });

  it("does not bounce /login to the dashboard on a cookie it cannot validate, which looped forever", () => {
    // A session cookie signed with another secret (reinstall, another app on
    // localhost) still *exists*; only the server can tell it is unreadable.
    expect(config.matcher).not.toContain("/login");
    const response = proxy(request("/login", "authjs.session-token=from-another-secret"));
    expect(response.headers.get("location")).toBeNull();
  });

  it("lets a request with a session cookie through to the page, which checks the session itself", () => {
    const response = proxy(request("/dashboard", "__Secure-authjs.session-token=x"));
    expect(response.headers.get("location")).toBeNull();
  });
});
