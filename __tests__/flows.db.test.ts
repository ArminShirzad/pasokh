/**
 * Whole campaign, smart-reply and welcome-question flows through the real
 * worker, against a real Postgres and the test lab's provider (which refuses
 * what Instagram refuses). Jobs the webhook and the worker queue are run in
 * order, as BullMQ would.
 *
 *   TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:55432/pasokh \
 *     npx vitest run __tests__/flows.db.test.ts
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
  SEQUENCE_JOB_NAME: "process-sequence-step",
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

import { ensureLab, labState, runLabAction } from "../lib/simulator/lab";
import { saveIceBreakers } from "../lib/ice-breakers/service";
import { createDMWorker } from "../lib/queue/dm-worker";

const schema = `flows_${randomBytes(4).toString("hex")}`;
let sql: Client;
let accountId: string;
let process_: (job: unknown) => Promise<void>;

/**
 * Runs queued jobs (and the jobs they queue) until none are left. Delayed jobs
 * run too, unless their name is in `hold`: those stay queued, so a test can
 * act before a delayed step comes due.
 */
async function drain(hold: string[] = []): Promise<void> {
  const held: QueuedJob[] = [];
  for (let guard = 0; state.jobs.length > 0 && guard < 50; guard++) {
    const job = state.jobs.shift() as QueuedJob;
    if (hold.includes(job.name)) {
      held.push(job);
      continue;
    }
    await process_({ id: job.id, name: job.name, data: job.data, attemptsMade: 0 });
  }
  state.jobs.push(...held);
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
    await state.db.iceBreaker.deleteMany();
    await state.db.command.deleteMany();
    await state.db.showcase.deleteMany();
    await state.db.sequence.deleteMany();
    await state.db.form.deleteMany();
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
  }, 30_000); // eight comments through the worker; slow when the whole suite runs at once
  async function showcase(cards: unknown[]) {
    return state.db.showcase.create({ data: { workspaceId: "ws", instagramAccountId: accountId, name: "پاییزه", cards: cards as never } });
  }

  async function keywordCommand(keyword: string, responses: unknown[]) {
    return state.db.command.create({
      data: { workspaceId: "ws", instagramAccountId: accountId, name: keyword, keywords: [keyword], responses: responses as never },
    });
  }

  it("sends a showcase as it is now, so editing it changes every smart reply that shows it", async () => {
    const shelf = await showcase([{ title: "کیف", subtitle: "۲۰۰ هزار تومان" }]);
    await keywordCommand("ویترین", [{ type: "text", text: "محصولات:" }, { type: "showcase", showcaseId: shelf.id }]);

    await act({ action: "dm", text: "ویترین" });
    await state.db.showcase.update({ where: { id: shelf.id }, data: { cards: [{ title: "کیف", subtitle: "۱۵۰ هزار تومان (حراج)" }] } });
    await act({ action: "dm", text: "ویترین" });

    const cards = (await sent()).filter((e) => (e.body as { type?: string }).type === "cards");
    expect(cards.map((e) => (e.body as { cards: { subtitle: string }[] }).cards[0].subtitle)).toEqual(["۲۰۰ هزار تومان", "۱۵۰ هزار تومان (حراج)"]);
  });

  it("fails a smart reply whose showcase was deleted, saying so, instead of sending the messages around it as if complete", async () => {
    const shelf = await showcase([{ title: "کیف" }]);
    const cmd = await keywordCommand("ویترین", [{ type: "showcase", showcaseId: shelf.id }, { type: "text", text: "بعدی" }]);
    await state.db.showcase.delete({ where: { id: shelf.id } });

    await act({ action: "dm", text: "ویترین" });
    expect(await sent()).toEqual([]);
    expect(await state.db.commandRun.findFirst({ where: { commandId: cmd.id } })).toMatchObject({ status: "FAILED", error: expect.stringMatching(/showcase was deleted/) });
  });

  it("does not send another account's showcase, even if a reply names it", async () => {
    const elsewhere = await state.db.instagramAccount.create({
      data: { workspaceId: "ws", instagramId: "other_ig", username: "other", accessToken: "", provider: "SIMULATOR" },
    });
    const foreign = await state.db.showcase.create({ data: { workspaceId: "ws", instagramAccountId: elsewhere.id, name: "x", cards: [{ title: "خارجی" }] } });
    await keywordCommand("ویترین", [{ type: "showcase", showcaseId: foreign.id }]);
    await act({ action: "dm", text: "ویترین" });
    expect(await sent()).toEqual([]);
    await state.db.showcase.delete({ where: { id: foreign.id } });
    await state.db.instagramAccount.delete({ where: { id: elsewhere.id } });
  });

  it("answers a tap on a welcome question with its smart reply, on a chat that had no messages before", async () => {
    const shipping = await command([{ type: "text", text: "ارسال رایگان است" }]);
    expect(await saveIceBreakers({ instagramAccountId: accountId, items: [{ question: "هزینهٔ ارسال؟", commandId: shipping.id }] })).toEqual({ pushed: true });

    const lab = await labState("ws");
    expect(lab.iceBreakers).toEqual([{ question: "هزینهٔ ارسال؟", payload: `cmd:${shipping.id}` }]);
    await act({ action: "tap", payload: lab.iceBreakers[0].payload, title: lab.iceBreakers[0].question });
    expect((await sent()).map((e) => e.body)).toEqual([{ type: "text", text: "ارسال رایگان است" }]);
  });

  it("refuses to delete a smart reply a welcome question opens, which would leave a question on Instagram answering nothing", async () => {
    const shipping = await command([{ type: "text", text: "x" }]);
    await saveIceBreakers({ instagramAccountId: accountId, items: [{ question: "؟", commandId: shipping.id }] });
    await expect(state.db.command.delete({ where: { id: shipping.id } })).rejects.toThrow();
  });
  async function withSequence(steps: { delayMinutes: number; text: string }[], stopOnReply = true) {
    const sequence = await state.db.sequence.create({
      data: {
        workspaceId: "ws",
        instagramAccountId: accountId,
        name: "پیگیری",
        stopOnReply,
        steps: steps.map((s) => ({ delayMinutes: s.delayMinutes, response: { type: "text", text: s.text } })),
      },
    });
    await state.db.command.create({
      data: { workspaceId: "ws", instagramAccountId: accountId, name: "قیمت", keywords: ["قیمت"], sequenceId: sequence.id, responses: [{ type: "text", text: "لیست قیمت" }] as never },
    });
    return sequence;
  }
  const texts = async () => (await sent()).map((e) => (e.body as { text?: string }).text);
  const STEP = "process-sequence-step";

  it("follows a smart reply with the sequence's steps, in order, then finishes", async () => {
    const sequence = await withSequence([{ delayMinutes: 10, text: "سؤالی داشتی؟" }, { delayMinutes: 60, text: "تخفیف امروز ۱۰٪" }]);
    await act({ action: "dm", text: "قیمت" });
    expect(await texts()).toEqual(["لیست قیمت", "سؤالی داشتی؟", "تخفیف امروز ۱۰٪"]);
    expect(await state.db.sequenceEnrollment.findFirst({ where: { sequenceId: sequence.id } })).toMatchObject({ status: "DONE", nextStep: 2 });
  });

  it("stops when they reply, if the sequence says so, instead of talking over the conversation", async () => {
    const sequence = await withSequence([{ delayMinutes: 30, text: "سؤالی داشتی؟" }]);
    await runLabAction("ws", { action: "dm", text: "قیمت" });
    await drain([STEP]);
    await runLabAction("ws", { action: "dm", text: "مرسی، خریدم" });
    await drain([STEP]); // their reply is handled; the step is still 30 minutes away
    await drain();
    expect(await texts()).toEqual(["لیست قیمت"]);
    expect(await state.db.sequenceEnrollment.findFirst({ where: { sequenceId: sequence.id } })).toMatchObject({ status: "STOPPED", stopReason: "They replied" });
  });

  it("does not try a step Instagram would refuse because 24 hours passed since their last message", async () => {
    const sequence = await withSequence([{ delayMinutes: 25 * 60, text: "فردا" }], false);
    await runLabAction("ws", { action: "dm", text: "قیمت" });
    await drain([STEP]);
    await state.db.contact.updateMany({ data: { lastInboundAt: new Date(Date.now() - 25 * 3600_000) } });
    await drain();
    expect(await texts()).toEqual(["لیست قیمت"]);
    expect(await state.db.sequenceEnrollment.findFirst({ where: { sequenceId: sequence.id } })).toMatchObject({ status: "STOPPED", stopReason: "24-hour messaging window closed" });
  });

  it("sends a step once when its job is delivered twice", async () => {
    await withSequence([{ delayMinutes: 5, text: "یک بار" }]);
    await runLabAction("ws", { action: "dm", text: "قیمت" });
    await drain([STEP]);
    const step = state.jobs.find((j) => j.name === STEP)!;
    state.jobs.push({ ...step });
    await drain();
    expect((await texts()).filter((t) => t === "یک بار")).toHaveLength(1);
  });

  it("does not restart the sequence for someone already part-way through it, which would repeat its early steps", async () => {
    const sequence = await withSequence([{ delayMinutes: 5, text: "مرحله ۱" }, { delayMinutes: 5, text: "مرحله ۲" }], false);
    await runLabAction("ws", { action: "dm", text: "قیمت" });
    await drain([STEP]);
    await runLabAction("ws", { action: "dm", text: "قیمت" });
    await drain([STEP]);
    expect(state.jobs.filter((j) => j.name === STEP)).toHaveLength(1);
    await drain();
    expect((await texts()).filter((t) => t?.startsWith("مرحله"))).toEqual(["مرحله ۱", "مرحله ۲"]);
    expect(await state.db.sequenceEnrollment.count({ where: { sequenceId: sequence.id } })).toBe(1);
  });
  async function withForm() {
    const form = await state.db.form.create({
      data: {
        workspaceId: "ws",
        instagramAccountId: accountId,
        name: "ثبت‌نام",
        cancelWord: "لغو",
        completionMessage: "ممنون {username}",
        cancelMessage: "لغو شد",
        questions: [
          { id: "phone", text: "شماره‌ات؟", kind: "phone", saveTo: "phone" },
          { id: "city", text: "کدام شهر؟", kind: "choice", choices: ["تهران", "کرج"] },
        ],
      },
    });
    await state.db.command.create({
      data: { workspaceId: "ws", instagramAccountId: accountId, name: "ثبت‌نام", keywords: ["ثبت نام"], formId: form.id, responses: [{ type: "text", text: "بیا ثبت‌نام کنیم" }] as never },
    });
    // Would answer «قیمت» if the form did not take the message first.
    await state.db.command.create({
      data: { workspaceId: "ws", instagramAccountId: accountId, name: "قیمت", keywords: ["قیمت"], responses: [{ type: "text", text: "لیست قیمت" }] as never },
    });
    return form;
  }
  const lastOut = async () => (await sent()).at(-1)?.body as { text?: string; quickReplies?: { title: string; payload: string }[] };

  it("asks a form's questions in order, re-asks an answer that does not fit, and saves the phone on the contact", async () => {
    const form = await withForm();
    await act({ action: "dm", text: "ثبت نام" });
    expect(await texts()).toEqual(["بیا ثبت‌نام کنیم", "شماره‌ات؟"]);

    await act({ action: "dm", text: "قیمت" });
    expect((await lastOut()).text).toMatch(/درست به نظر نمی‌رسد[\s\S]*شماره‌ات؟/);
    expect(await texts()).not.toContain("لیست قیمت");

    await act({ action: "dm", text: "۰۹۱۲ ۳۴۵ ۶۷۸۹" });
    const ask = await lastOut();
    expect(ask.text).toBe("کدام شهر؟");
    await act({ action: "tap", payload: ask.quickReplies![1].payload, title: "کرج", quickReply: true });

    expect((await lastOut()).text).toBe("ممنون \u2066@test.follower\u2069");
    const submission = await state.db.formSubmission.findFirst({ where: { formId: form.id } });
    expect(submission).toMatchObject({ status: "COMPLETED", answers: { phone: "09123456789", city: "کرج" } });
    expect((await state.db.contact.findFirst({ where: { instagramAccountId: accountId } }))?.phone).toBe("09123456789");
  });

  it("stops the form on the cancel word and answers keywords normally afterwards", async () => {
    const form = await withForm();
    await act({ action: "dm", text: "ثبت نام" });
    await act({ action: "dm", text: "لغو" });
    expect((await lastOut()).text).toBe("لغو شد");
    expect(await state.db.formSubmission.findFirst({ where: { formId: form.id } })).toMatchObject({ status: "CANCELLED" });
    await act({ action: "dm", text: "قیمت" });
    expect((await lastOut()).text).toBe("لیست قیمت");
  });

  it("takes an answer once when its webhook is delivered twice, so it does not also answer the next question", async () => {
    const form = await withForm();
    await act({ action: "dm", text: "ثبت نام" });
    await runLabAction("ws", { action: "dm", text: "09123456789" });
    const answer = state.jobs.find((j) => j.name === "process-message")!;
    state.jobs.push({ ...answer });
    await drain();
    // Exactly the next question: no second copy, and no "that does not fit" re-ask
    // from the duplicate being read as the answer to it.
    expect(await texts()).toEqual(["بیا ثبت‌نام کنیم", "شماره‌ات؟", "کدام شهر؟"]);
    expect(await state.db.formSubmission.findFirst({ where: { formId: form.id } })).toMatchObject({ step: 1, status: "IN_PROGRESS" });
  });
});
