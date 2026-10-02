import { beforeEach, describe, expect, it, vi } from "vitest";

const redis = vi.hoisted(() => {
  const store = new Map<string, number>();
  const multi = () => {
    const ops: Array<() => void> = [];
    const chain = {
      incr(key: string) {
        ops.push(() => store.set(key, (store.get(key) ?? 0) + 1));
        return chain;
      },
      expire() {
        return chain;
      },
      async exec() {
        ops.forEach((op) => op());
        return [];
      },
    };
    return chain;
  };
  return {
    store,
    client: {
      get: async (key: string) => (store.has(key) ? String(store.get(key)) : null),
      del: async (key: string) => store.delete(key),
      multi,
    },
  };
});
vi.mock("@/lib/queue/client", () => ({ getRedisConnection: () => redis.client }));

const db = vi.hoisted(() => ({ users: new Map<string, { id: string; email: string; name: string | null; passwordHash: string | null }>() }));
vi.mock("@/lib/db/client", () => ({
  prisma: {
    user: {
      findUnique: async ({ where }: { where: { email: string } }) => db.users.get(where.email) ?? null,
    },
  },
}));
vi.mock("@/lib/workspace", () => ({ ensureWorkspaceForUser: vi.fn() }));

import { hashPassword, passwordProblem, verifyPassword } from "../lib/users/password";
import { accountErrorFromQuery, checkCredentials } from "../lib/users/accounts";
import { safeCallbackUrl } from "../lib/users/redirect";

describe("password hashing", () => {
  it("accepts the right password and rejects a wrong one", async () => {
    const stored = await hashPassword("correct horse");
    expect(stored.startsWith("scrypt$32768$8$1$")).toBe(true);
    expect(await verifyPassword("correct horse", stored)).toBe(true);
    expect(await verifyPassword("correct horsf", stored)).toBe(false);
  });

  it("salts every hash, so equal passwords do not produce equal hashes", async () => {
    expect(await hashPassword("same")).not.toBe(await hashPassword("same"));
  });

  it("treats Persian text typed with different Unicode forms as the same password", async () => {
    // U+06CC (Persian yeh) is what a Persian keyboard types; NFKC keeps it,
    // but composed vs decomposed forms of the same character must match.
    const stored = await hashPassword("café-رمز");
    expect(await verifyPassword("café-رمز", stored)).toBe(true);
  });

  it("never throws on a missing or malformed stored hash, it just fails", async () => {
    for (const stored of [null, undefined, "", "plain", "bcrypt$x", "scrypt$a$b$c$d$e", "scrypt$32768$8$1$AAAA$"]) {
      expect(await verifyPassword("x", stored)).toBe(false);
    }
  });

  it("requires at least 8 characters", () => {
    expect(passwordProblem("1234567")).toBe("Password must be at least 8 characters.");
    expect(passwordProblem("12345678")).toBeNull();
    expect(passwordProblem("x".repeat(257))).toBe("Password is too long.");
  });
});

describe("credential checks", () => {
  beforeEach(async () => {
    redis.store.clear();
    db.users.clear();
    db.users.set("owner@shop.ir", {
      id: "u1",
      email: "owner@shop.ir",
      name: "Owner",
      passwordHash: await hashPassword("good password"),
    });
  });

  it("signs in regardless of email case or surrounding spaces", async () => {
    const result = await checkCredentials("  Owner@Shop.IR ", "good password", "1.2.3.4");
    expect(result).toEqual({ ok: true, user: { id: "u1", email: "owner@shop.ir", name: "Owner" } });
  });

  it("gives the same answer for an unknown email as for a wrong password", async () => {
    expect(await checkCredentials("nobody@shop.ir", "good password", null)).toEqual({ ok: false, reason: "invalid" });
    expect(await checkCredentials("owner@shop.ir", "bad password", null)).toEqual({ ok: false, reason: "invalid" });
  });

  it("refuses a magic-link-only account that has no password set", async () => {
    db.users.set("magic@shop.ir", { id: "u2", email: "magic@shop.ir", name: null, passwordHash: null });
    expect(await checkCredentials("magic@shop.ir", "", null)).toEqual({ ok: false, reason: "invalid" });
  });

  it("locks an email after 5 failures, even with the right password, until the window passes", async () => {
    for (let i = 0; i < 5; i++) await checkCredentials("owner@shop.ir", "wrong", `10.0.0.${i}`);
    expect(await checkCredentials("owner@shop.ir", "good password", "10.0.0.99")).toEqual({ ok: false, reason: "throttled" });
  });

  it("locks an address that sprays many accounts", async () => {
    for (let i = 0; i < 20; i++) await checkCredentials(`user${i}@shop.ir`, "wrong", "6.6.6.6");
    expect(await checkCredentials("owner@shop.ir", "good password", "6.6.6.6")).toEqual({ ok: false, reason: "throttled" });
    expect((await checkCredentials("owner@shop.ir", "good password", "7.7.7.7")).ok).toBe(true);
  });

  it("clears the email's failure count after a successful sign-in", async () => {
    for (let i = 0; i < 4; i++) await checkCredentials("owner@shop.ir", "wrong", null);
    expect((await checkCredentials("owner@shop.ir", "good password", null)).ok).toBe(true);
    for (let i = 0; i < 4; i++) await checkCredentials("owner@shop.ir", "wrong", null);
    expect((await checkCredentials("owner@shop.ir", "good password", null)).ok).toBe(true);
  });
});

describe("sign-in redirects", () => {
  it("keeps same-site paths", () => {
    expect(safeCallbackUrl("/campaigns/new?template=x")).toBe("/campaigns/new?template=x");
  });

  it("refuses absolute and protocol-relative URLs, which would be open redirects", () => {
    for (const value of ["https://evil.example", "//evil.example", "/\\evil.example", "javascript:alert(1)", "", undefined]) {
      expect(safeCallbackUrl(value)).toBeNull();
    }
  });
});

describe("form errors carried in the URL", () => {
  it("only shows known messages, so an edited ?error= cannot inject text", () => {
    expect(accountErrorFromQuery("Passwords do not match.")).toBe("Passwords do not match.");
    expect(accountErrorFromQuery("Your account was hacked, call 0912...")).toBeNull();
    expect(accountErrorFromQuery(undefined)).toBeNull();
  });
});
