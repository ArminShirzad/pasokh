/**
 * First-run setup against a real Postgres: the race only exists in the
 * database, so no mock can show it. Skipped without a database:
 *
 *   docker compose -f docker-compose.dev.yml up -d postgres
 *   TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:55432/pasokh \
 *     npx vitest run __tests__/first-run-setup.db.test.ts
 *
 * Builds the schema from prisma/migrations in a throwaway Postgres schema and
 * drops it afterwards.
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
vi.mock("@/lib/queue/client", () => ({
  getRedisConnection: () => ({ del: async () => 0, get: async () => null, multi: () => ({ incr() { return this; }, expire() { return this; }, exec: async () => [] }) }),
}));

import { AccountError, createFirstOwner, createInvitedUser, needsFirstRunSetup } from "../lib/users/accounts";

const schema = `first_run_${randomBytes(4).toString("hex")}`;
let sql: Client;

const owner = (email: string) => ({
  name: "Owner",
  email,
  password: "good password",
  confirm: "good password",
  workspaceName: "Shop",
});

describe.skipIf(!DATABASE_URL)("first-run setup on a real Postgres", () => {
  beforeAll(async () => {
    sql = new Client({ connectionString: DATABASE_URL });
    await sql.connect();
    await sql.query(`CREATE SCHEMA "${schema}"`);
    await sql.query(`SET search_path TO "${schema}"`);
    const dirs = readdirSync(MIGRATIONS_DIR, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
    for (const dir of dirs) await sql.query(readFileSync(path.join(MIGRATIONS_DIR, dir, "migration.sql"), "utf8"));
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
    await sql.query(`TRUNCATE "User" CASCADE`);
  });

  it("two setup forms submitted at the same moment create exactly one owner", async () => {
    const results = await Promise.allSettled([
      createFirstOwner(owner("first@shop.ir")),
      createFirstOwner(owner("second@shop.ir")),
      createFirstOwner(owner("third@shop.ir")),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    for (const r of results.filter((r) => r.status === "rejected")) {
      expect((r as PromiseRejectedResult).reason).toBeInstanceOf(AccountError);
      expect((r as PromiseRejectedResult).reason.message).toBe("Setup is already complete. Sign in instead.");
    }
    expect(await state.db.user.count()).toBe(1);
    expect(await state.db.workspace.count()).toBe(1);
    expect(await state.db.workspaceMember.findMany({ select: { role: true } })).toEqual([{ role: "OWNER" }]);
  });

  it("closes setup once an owner exists", async () => {
    expect(await needsFirstRunSetup()).toBe(true);
    await createFirstOwner(owner("owner@shop.ir"));
    expect(await needsFirstRunSetup()).toBe(false);
    await expect(createFirstOwner(owner("late@shop.ir"))).rejects.toThrow("Setup is already complete");
  });

  it("puts an invited teammate into the inviting workspace, not a new one of their own", async () => {
    const { userId } = await createFirstOwner(owner("owner@shop.ir"));
    const workspace = await state.db.workspace.findFirstOrThrow({ where: { ownerId: userId } });
    await state.db.workspaceInvitation.create({
      data: {
        workspaceId: workspace.id,
        email: "teammate@shop.ir",
        role: "MEMBER",
        token: "invite-token",
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });

    const { userId: teammateId } = await createInvitedUser({
      token: "invite-token",
      name: "Teammate",
      password: "teammate pass",
      confirm: "teammate pass",
    });

    expect(await state.db.workspace.count()).toBe(1);
    expect(await state.db.workspaceMember.findFirst({ where: { userId: teammateId }, select: { workspaceId: true, role: true } }))
      .toEqual({ workspaceId: workspace.id, role: "MEMBER" });
    expect((await state.db.workspaceInvitation.findUniqueOrThrow({ where: { token: "invite-token" } })).status).toBe("ACCEPTED");
  });

  it("does not let an invitation link reset the password of an existing account", async () => {
    const { userId } = await createFirstOwner(owner("owner@shop.ir"));
    const workspace = await state.db.workspace.findFirstOrThrow({ where: { ownerId: userId } });
    await state.db.workspaceInvitation.create({
      data: { workspaceId: workspace.id, email: "owner@shop.ir", role: "ADMIN", token: "self", expiresAt: new Date(Date.now() + 86_400_000) },
    });
    await expect(
      createInvitedUser({ token: "self", name: "x", password: "attacker pass", confirm: "attacker pass" }),
    ).rejects.toThrow("An account with this email already exists");
  });
});
