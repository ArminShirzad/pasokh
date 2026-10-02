/**
 * Running commands against a real Postgres, delivered through the test-lab
 * provider (which applies Instagram's rules).
 *
 *   TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:55432/pasokh \
 *     npx vitest run __tests__/command-run.db.test.ts
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
  getDMQueue: () => ({ add: async () => undefined }),
  POSTBACK_JOB_NAME: "process-postback",
  MESSAGE_JOB_NAME: "process-message",
}));

import { ensureLab, runLabAction } from "../lib/simulator/lab";
import { activeCommandsFor, commandFromPayload, commandPayload, pickCommand, runCommand } from "../lib/commands/engine";

const schema = `command_run_${randomBytes(4).toString("hex")}`;
let sql: Client;

async function outbound() {
  return (await state.db.simulatorEvent.findMany({ where: { direction: "out" }, orderBy: { createdAt: "asc" } })).map(
    (e) => ({ kind: e.kind, body: e.body as Record<string, unknown> })
  );
}

describe.skipIf(!DATABASE_URL)("running commands on a real Postgres", () => {
  let accountId: string;
  let instagramId: string;
  let fanIgsid: string;

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
    await state.db.command.deleteMany();
    await runLabAction("ws", { action: "reset" });
    const { account, fan } = await ensureLab("ws");
    accountId = account.id;
    instagramId = account.instagramId;
    fanIgsid = fan.igsid;
    // They message first, which opens the 24-hour window.
    await runLabAction("ws", { action: "dm", text: "شرایط" });
  });

  async function makeCommand(data: Record<string, unknown>) {
    return state.db.command.create({
      data: { workspaceId: "ws", instagramAccountId: accountId, name: "c", responses: [], ...data } as never,
    });
  }

  it("sends every response in order, personalised", async () => {
    await makeCommand({
      keywords: ["شرایط"],
      responses: [
        { type: "text", text: "سلام {username}" },
        { type: "cards", cards: [{ title: "اکران تهران", subtitle: "جمعه ساعت ۱۲" }] },
      ],
    });
    const command = pickCommand(await activeCommandsFor(instagramId), { text: "شرایط" });
    expect(await runCommand({ command: command!, igsid: fanIgsid, triggerMessageId: "m1", triggerText: "شرایط", username: "fan" })).toBe("DONE");
    expect(await outbound()).toEqual([
      { kind: "dm", body: { type: "text", text: "سلام fan" } },
      { kind: "dm", body: { type: "cards", cards: [{ title: "اکران تهران", subtitle: "جمعه ساعت ۱۲" }] } },
    ]);
  });

  it("runs once per trigger message, however often the webhook is delivered", async () => {
    const c = await makeCommand({ keywords: ["شرایط"], responses: [{ type: "text", text: "یکبار" }] });
    const command = (await activeCommandsFor(instagramId)).find((x) => x.id === c.id)!;
    await runCommand({ command, igsid: fanIgsid, triggerMessageId: "m1", triggerText: "x" });
    expect(await runCommand({ command, igsid: fanIgsid, triggerMessageId: "m1", triggerText: "x" })).toBe("SKIPPED");
    expect(await outbound()).toHaveLength(1);
  });

  it("continues from the first unsent response after an interrupted run, without repeating", async () => {
    const c = await makeCommand({ keywords: ["x"], responses: [{ type: "text", text: "one" }, { type: "text", text: "two" }] });
    await state.db.commandRun.create({ data: { commandId: c.id, contactIgsid: fanIgsid, triggerMessageId: "m2", triggerText: "x", sent: 1 } });
    const command = (await activeCommandsFor(instagramId)).find((x) => x.id === c.id)!;
    await runCommand({ command, igsid: fanIgsid, triggerMessageId: "m2", triggerText: "x" });
    expect((await outbound()).map((e) => e.body.text)).toEqual(["two"]);
  });

  it("chains a menu: a quick reply's cmd: payload resolves to a command of the same account only", async () => {
    const tehran = await makeCommand({ keywords: [], storyScope: "SPECIFIC", responses: [{ type: "text", text: "تهران: جمعه" }] });
    await makeCommand({
      keywords: ["شرایط"],
      responses: [{ type: "text", text: "شهرت رو انتخاب کن", quickReplies: [{ title: "تهران", payload: commandPayload(tehran.id) }] }],
    });
    expect((await commandFromPayload(commandPayload(tehran.id), instagramId))?.id).toBe(tehran.id);
    expect(await commandFromPayload(commandPayload(tehran.id), "someone_else")).toBeNull();
  });

  it("stops as FAILED, without retrying, when Instagram refuses because the window closed", async () => {
    await sql.query(`UPDATE "SimulatorEvent" SET "createdAt" = now() - interval '2 days'`);
    const c = await makeCommand({ keywords: ["x"], responses: [{ type: "text", text: "late" }] });
    const command = (await activeCommandsFor(instagramId)).find((x) => x.id === c.id)!;
    expect(await runCommand({ command, igsid: fanIgsid, triggerMessageId: "m3", triggerText: "x" })).toBe("FAILED");
    const run = await state.db.commandRun.findFirstOrThrow({ where: { commandId: c.id } });
    expect(run.error).toContain("outside of allowed window");
  });

  it("hearts the message that triggered it when asked, and not a button tap", async () => {
    const c = await makeCommand({ keywords: ["x"], likeTrigger: true, responses: [{ type: "text", text: "hi" }] });
    const command = (await activeCommandsFor(instagramId)).find((x) => x.id === c.id)!;
    await runCommand({ command, igsid: fanIgsid, triggerMessageId: "m4", triggerText: "x" });
    await runCommand({ command, igsid: fanIgsid, triggerMessageId: "tap:m5", triggerText: "x" });
    expect((await outbound()).filter((e) => e.kind === "reaction")).toHaveLength(1);
  });

  it("ignores inactive commands", async () => {
    await makeCommand({ keywords: ["شرایط"], isActive: false, responses: [{ type: "text", text: "off" }] });
    expect(pickCommand(await activeCommandsFor(instagramId), { text: "شرایط" })).toBeNull();
  });
});
