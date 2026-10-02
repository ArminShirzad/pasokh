/**
 * The test lab's provider against a real Postgres. It must refuse what
 * Instagram refuses, or the lab would pass flows that fail for real.
 *
 *   TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:55432/pasokh \
 *     npx vitest run __tests__/simulator.db.test.ts
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
  jobs: [] as Array<{ name: string; data: Record<string, unknown> }>,
}));
vi.mock("@/lib/db/client", () => ({
  get prisma() {
    return state.db;
  },
}));
vi.mock("@/lib/queue/client", () => ({
  getDMQueue: () => ({ add: async (name: string, data: Record<string, unknown>) => state.jobs.push({ name, data }) }),
  POSTBACK_JOB_NAME: "process-postback",
  MESSAGE_JOB_NAME: "process-message",
  SEQUENCE_JOB_NAME: "process-sequence-step",
  SMS_JOB_NAME: "process-sms-batch",
}));

import { ensureLab, runLabAction } from "../lib/simulator/lab";
import { simulatorFollowStatus, simulatorSend, type SimulatorContext } from "../lib/simulator/provider";

const schema = `simulator_${randomBytes(4).toString("hex")}`;
let sql: Client;
let context: SimulatorContext;
let fanIgsid: string;

const text = (t: string) => ({ type: "text" as const, text: t });
const withButton = { type: "text" as const, text: "Get it", buttons: [{ type: "postback" as const, title: "Go", payload: "reveal:x" }] };

describe.skipIf(!DATABASE_URL)("test lab provider on a real Postgres", () => {
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
    await runLabAction("ws", { action: "reset" });
    const { account, fan } = await ensureLab("ws");
    context = { provider: "SIMULATOR", connectionId: account.id, instagramId: account.instagramId };
    fanIgsid = fan.igsid;
  });

  async function comment(textValue = "LINK") {
    await runLabAction("ws", { action: "comment", postId: "sim_post_1", text: textValue });
    const job = state.jobs.find((j) => j.name === "process-comment");
    return job!.data.commentId as string;
  }

  it("turns a test comment into the same comment job a real webhook produces", async () => {
    await runLabAction("ws", { action: "comment", postId: "sim_post_1", text: "LINK" });
    expect(state.jobs).toEqual([
      expect.objectContaining({
        name: "process-comment",
        data: expect.objectContaining({ instagramAccountId: context.instagramId, commentText: "LINK", commenterId: fanIgsid, mediaId: "sim_post_1" }),
      }),
    ]);
  });

  it("allows one private reply per comment, like Instagram", async () => {
    const commentId = await comment();
    await simulatorSend({ context, recipient: { commentId }, message: text("hi") });
    await expect(simulatorSend({ context, recipient: { commentId }, message: text("again") })).rejects.toThrow("invalid for a private reply");
  });

  it("refuses buttons in a private reply to a non-follower, and the refusal uses up the reply", async () => {
    const commentId = await comment();
    await expect(simulatorSend({ context, recipient: { commentId }, message: withButton })).rejects.toMatchObject({ code: 2, subcode: 1545133 });
    await expect(simulatorSend({ context, recipient: { commentId }, message: text("plain") })).rejects.toThrow("invalid for a private reply");
  });

  it("accepts buttons in a private reply once the person follows", async () => {
    await runLabAction("ws", { action: "follow", follows: true });
    const commentId = await comment();
    await expect(simulatorSend({ context, recipient: { commentId }, message: withButton })).resolves.toHaveProperty("message_id");
  });

  it("refuses a DM to someone who has never messaged the page, and allows it after they do", async () => {
    await expect(simulatorSend({ context, recipient: { userId: fanIgsid }, message: text("hello") })).rejects.toThrow("outside of allowed window");
    await runLabAction("ws", { action: "dm", text: "hi" });
    await expect(simulatorSend({ context, recipient: { userId: fanIgsid }, message: withButton })).resolves.toHaveProperty("message_id");
  });

  it("closes the window 24 hours after their last message", async () => {
    await runLabAction("ws", { action: "dm", text: "hi" });
    await sql.query(`UPDATE "SimulatorEvent" SET "createdAt" = now() - interval '25 hours'`);
    await expect(simulatorSend({ context, recipient: { userId: fanIgsid }, message: text("late") })).rejects.toThrow("outside of allowed window");
  });

  it("reports follow status as unknown until the person has messaged the page", async () => {
    await runLabAction("ws", { action: "follow", follows: true });
    expect(await simulatorFollowStatus(context, fanIgsid)).toBeNull();
    await runLabAction("ws", { action: "dm", text: "hi" });
    expect(await simulatorFollowStatus(context, fanIgsid)).toBe(true);
  });

  it("starts over as a new person: history, sessions and follow cleared", async () => {
    await runLabAction("ws", { action: "follow", follows: true });
    await runLabAction("ws", { action: "dm", text: "hi" });
    await runLabAction("ws", { action: "reset" });
    const { fan } = await ensureLab("ws");
    expect(fan.igsid).not.toBe(fanIgsid);
    expect(fan.follows).toBe(false);
    expect(await state.db.simulatorEvent.count()).toBe(0);
  });
});
