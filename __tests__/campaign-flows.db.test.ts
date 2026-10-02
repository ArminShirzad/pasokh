/**
 * Whole campaign flows through the real worker, against a real Postgres and
 * the test lab's provider (which refuses what Instagram refuses). Jobs the
 * webhook and the worker queue are run in order, as BullMQ would.
 *
 *   TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:55432/pasokh \
 *     npx vitest run __tests__/campaign-flows.db.test.ts
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

type QueuedJob = { id: string; name: string; data: Record<string, unknown>; opts?: { delay?: number } };
const state = vi.hoisted(() => ({
  db: undefined as unknown as import("../app/generated/prisma/client").PrismaClient,
  jobs: [] as Array<{ id: string; name: string; data: Record<string, unknown>; opts?: { delay?: number } }>,
  redis: new Map<string, string>(),
}));
vi.mock("@/lib/db/client", () => ({
  get prisma() {
    return state.db;
  },
}));
vi.mock("@/lib/queue/client", () => ({
  getDMQueue: () => ({
    add: async (name: string, data: Record<string, unknown>, opts?: { jobId?: string; delay?: number }) =>
      state.jobs.push({ id: opts?.jobId ?? `${name}_${state.jobs.length}`, name, data, opts }),
  }),
  getRedisConnection: () => ({
    get: async (key: string) => state.redis.get(key) ?? null,
    set: async (key: string, value: string, ...args: unknown[]) => {
      if (args.includes("NX") && state.redis.has(key)) return null;
      state.redis.set(key, value);
      return "OK";
    },
  }),
  POSTBACK_JOB_NAME: "process-postback",
  FOLLOWUP_JOB_NAME: "process-followup",
  MESSAGE_JOB_NAME: "process-message",
}));
vi.mock("@/lib/utils/rate-limiter", () => ({
  reserveDMSlot: async () => ({ allowed: true, reserved: false }),
  releaseDMSlot: async () => {},
}));
vi.mock("@/lib/ops/worker-health", () => ({ recordWorkerAlert: vi.fn() }));
vi.mock("bullmq", () => ({
  Worker: function MockWorker(_name: string, processor: unknown) {
    (globalThis as Record<string, unknown>).__campaignFlowProcessor = processor;
    return { on: () => {}, close: async () => {} };
  },
  UnrecoverableError: class UnrecoverableError extends Error {},
}));

import { ensureLab, runLabAction } from "../lib/simulator/lab";
import { createDMWorker } from "../lib/queue/dm-worker";

const schema = `flows_${randomBytes(4).toString("hex")}`;
let sql: Client;
let accountId: string;
let process_: (job: unknown) => Promise<void>;

/** Runs queued jobs (and the jobs they queue) until none are left. Delayed jobs run too. */
async function drain(): Promise<void> {
  for (let guard = 0; state.jobs.length > 0 && guard < 50; guard++) {
    const job = state.jobs.shift() as QueuedJob;
    await process_({ id: job.id, name: job.name, data: job.data, attemptsMade: 0 });
  }
}

async function act(input: Parameters<typeof runLabAction>[1]) {
  await runLabAction("ws", input);
  await drain();
}

async function sent() {
  return state.db.simulatorEvent.findMany({
    where: { direction: "out" },
    orderBy: { createdAt: "asc" },
    select: { kind: true, body: true },
  });
}

async function command(responses: unknown[], isActive = true) {
  return state.db.command.create({
    data: { workspaceId: "ws", instagramAccountId: accountId, name: "منوی شهرها", isActive, keywords: [], responses: responses as never },
  });
}

async function campaign(data: Record<string, unknown>) {
  return state.db.automation.create({
    data: {
      workspaceId: "ws",
      instagramAccountId: accountId,
      name: "Campaign",
      dmMessage: "سلام {username}",
      matchAnyWord: true,
      ...data,
    },
  });
}

const cards = {
  type: "cards",
  cards: [{ title: "کرج", subtitle: "سانس ۲۰", buttons: [{ type: "url", title: "خرید", url: "https://example.com/karaj" }] }],
};

describe.skipIf(!DATABASE_URL)("campaign flows through the worker on a real Postgres", () => {
  beforeAll(async () => {
    sql = new Client({ connectionString: DATABASE_URL });
    await sql.connect();
    await sql.query(`CREATE SCHEMA "${schema}"`);
    await sql.query(`SET search_path TO "${schema}"`);
    const dirs = readdirSync(MIGRATIONS_DIR, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
    for (const dir of dirs) await sql.query(readFileSync(path.join(MIGRATIONS_DIR, dir, "migration.sql"), "utf8"));
    await sql.query(`
      INSERT INTO "User" ("id", "email", "updatedAt") VALUES ('u', 'u@test.dev', now());
      INSERT INTO "Workspace" ("id", "name", "ownerId", "updatedAt") VALUES ('ws', 'W', 'u', now());
    `);
    state.db = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL }, { schema }) });
    createDMWorker();
    process_ = (globalThis as Record<string, unknown>).__campaignFlowProcessor as typeof process_;
  }, 60_000);

  afterAll(async () => {
    await state.db?.$disconnect();
    if (sql) {
      await sql.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await sql.end();
    }
  });

  beforeEach(async () => {
    state.jobs = [];
    state.redis.clear();
    await state.db.automation.deleteMany();
    await state.db.command.deleteMany();
    await runLabAction("ws", { action: "reset" });
    accountId = (await ensureLab("ws")).account.id;
  });

  it("hands a non-follower's comment to the smart reply only after they answer, so its cards are not refused and the reply is not burned", async () => {
    const menu = await command([{ type: "text", text: "شهرت کجاست؟" }, cards]);
    await campaign({ matchAnyPost: true, commandId: menu.id });

    await act({ action: "comment", postId: "sim_post_1", text: "بلیت" });
    let out = await sent();
    expect(out.map((e) => e.kind)).toEqual(["private_reply"]);
    expect(JSON.stringify(out[0].body)).not.toContain("buttons");

    await act({ action: "dm", text: "اوکی" });
    out = await sent();
    expect(out.map((e) => e.kind)).toEqual(["private_reply", "dm", "dm"]);
    expect(out[2].body).toMatchObject({ type: "cards" });
    expect(await state.db.dmLog.findMany({ where: { status: "SENT" } })).toHaveLength(2);
  });

  it("runs the smart reply once, however often the answer's webhook is delivered", async () => {
    const menu = await command([{ type: "text", text: "یک" }]);
    await campaign({ matchAnyPost: true, commandId: menu.id });
    await act({ action: "comment", postId: "sim_post_1", text: "x" });
    await runLabAction("ws", { action: "dm", text: "اوکی" });
    const answer = state.jobs.find((j) => j.name === "process-message")!;
    state.jobs.push({ ...answer }); // the same webhook delivered twice
    await drain();
    expect((await sent()).filter((e) => e.kind === "dm")).toHaveLength(1);
  });

  it("logs a campaign whose smart reply was turned off as failed with the reason, instead of answering with nothing", async () => {
    const menu = await command([{ type: "text", text: "یک" }], false);
    await campaign({ matchAnyPost: true, commandId: menu.id });
    await act({ action: "comment", postId: "sim_post_1", text: "x" });
    await act({ action: "dm", text: "اوکی" });
    expect((await sent()).filter((e) => e.kind === "dm")).toHaveLength(0);
    const failed = await state.db.dmLog.findFirst({ where: { status: "FAILED" } });
    expect(failed?.errorMessage).toMatch(/smart reply was deleted or turned off/);
  });

  it("sends a live-video comment only to live campaigns, with no public reply (Instagram has none on lives)", async () => {
    const replies = { publicReplyEnabled: true, publicReplyMessages: ["الف", "ب", "پ"] };
    const post = await campaign({ name: "post", matchAnyPost: true, ...replies });
    const live = await campaign({ name: "live", matchLive: true, dmMessage: "از لایو اومدی", ...replies });

    await act({ action: "live_comment", text: "سلام" });
    const out = await sent();
    expect(out.map((e) => e.kind)).toEqual(["private_reply"]);
    expect(JSON.stringify(out[0].body)).toContain("از لایو اومدی");
    expect(await state.db.dmLog.count({ where: { automationId: post.id } })).toBe(0);
    expect(await state.db.dmLog.findFirst({ where: { automationId: live.id } })).toMatchObject({ status: "SENT", publicReplySentAt: null });
  });

  it("does not fire a live-only campaign on an ordinary post's comment", async () => {
    await campaign({ matchLive: true });
    await act({ action: "comment", postId: "sim_post_1", text: "سلام" });
    expect(await sent()).toEqual([]);
  });

  it("never posts the same public wording twice in a row under a post", async () => {
    await campaign({ matchAnyPost: true, publicReplyEnabled: true, publicReplyMessages: ["الف", "ب", "پ"] });
    const posted: string[] = [];
    for (let i = 0; i < 8; i++) {
      await runLabAction("ws", { action: "reset" });
      await act({ action: "comment", postId: "sim_post_1", text: `c${i}` });
      const reply = (await state.db.simulatorEvent.findFirst({ where: { kind: "comment_reply" } }))!;
      posted.push((reply.body as { text: string }).text);
    }
    for (let i = 1; i < posted.length; i++) expect(posted[i]).not.toBe(posted[i - 1]);
  });
});
