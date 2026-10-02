/**
 * Conversation sessions against a real Postgres. Skipped without a database:
 *
 *   TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:55432/pasokh \
 *     npx vitest run __tests__/conversation-session.db.test.ts
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { Client } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "../app/generated/prisma/client";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const MIGRATIONS_DIR = path.join(__dirname, "..", "prisma", "migrations");

const state = vi.hoisted(() => ({
  db: undefined as unknown as import("../app/generated/prisma/client").PrismaClient,
}));
vi.mock("@/lib/db/client", () => ({
  get prisma() {
    return state.db;
  },
}));

import { claimCommentAnswer, expectCommentAnswer } from "../lib/conversations/sessions";

const schema = `conv_session_${randomBytes(4).toString("hex")}`;
let sql: Client;

const shop = { connection: "acct_shop", instagramId: "ig_shop" };
const other = { connection: "acct_other", instagramId: "ig_other" };

describe.skipIf(!DATABASE_URL)("conversation sessions on a real Postgres", () => {
  beforeAll(async () => {
    sql = new Client({ connectionString: DATABASE_URL });
    await sql.connect();
    await sql.query(`CREATE SCHEMA "${schema}"`);
    await sql.query(`SET search_path TO "${schema}"`);
    const dirs = readdirSync(MIGRATIONS_DIR, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
    for (const dir of dirs) await sql.query(readFileSync(path.join(MIGRATIONS_DIR, dir, "migration.sql"), "utf8"));
    await sql.query(`
      INSERT INTO "User" ("id", "email", "updatedAt") VALUES ('u', 'u@test.dev', now());
      INSERT INTO "Workspace" ("id", "name", "ownerId", "updatedAt") VALUES ('w', 'W', 'u', now());
      INSERT INTO "InstagramAccount" ("id", "workspaceId", "instagramId", "username", "accessToken", "updatedAt") VALUES
        ('${shop.connection}', 'w', '${shop.instagramId}', 'shop', 't', now()),
        ('${other.connection}', 'w', '${other.instagramId}', 'other', 't', now());
    `);
    state.db = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL, max: 10 }, { schema }) });
  }, 60_000);

  afterAll(async () => {
    await state.db?.$disconnect();
    if (sql) {
      await sql.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await sql.end();
    }
  });

  beforeEach(async () => {
    await sql.query(`TRUNCATE "ConversationSession"`);
  });

  const arm = (account = shop, automationId = "auto_1", payload = "reveal:auto_1:open") =>
    expectCommentAnswer({ instagramAccountId: account.connection, contactId: "fan", automationId, payload });
  const claim = (account = shop) =>
    claimCommentAnswer({ instagramId: account.instagramId, accountConnectionId: account.connection, contactId: "fan" });

  it("hands an answer to the comment reply that asked for it, once", async () => {
    await arm();
    expect((await claim())?.payload).toBe("reveal:auto_1:open");
    expect(await claim()).toBeNull();
  });

  it("lets only one of two simultaneous answers resume the flow", async () => {
    await arm();
    const results = await Promise.all([claim(), claim(), claim()]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("does not resume a reply that has expired", async () => {
    await arm();
    await sql.query(`UPDATE "ConversationSession" SET "expiresAt" = now() - interval '1 minute'`);
    expect(await claim()).toBeNull();
  });

  it("does not let a DM to one connected account resume another account's campaign", async () => {
    await arm(other);
    expect(await claim(shop)).toBeNull();
    expect(await claim(other)).not.toBeNull();
  });

  it("re-arms when the same person comments on the same campaign again after answering", async () => {
    await arm();
    await claim();
    await arm();
    expect(await claim()).not.toBeNull();
    expect(Number((await sql.query(`SELECT count(*) FROM "ConversationSession"`)).rows[0].count)).toBe(1);
  });

  it("answers the most recent campaign when the person commented on two", async () => {
    await arm(shop, "auto_old", "reveal:auto_old:open");
    await new Promise((r) => setTimeout(r, 20));
    await arm(shop, "auto_new", "reveal:auto_new:open");
    expect((await claim())?.payload).toBe("reveal:auto_new:open");
    expect((await claim())?.payload).toBe("reveal:auto_old:open");
  });
});
