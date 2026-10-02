import { NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import type { FormQuestion } from "./answers";

const codePoints = (s: string) => [...s].length;

const questionSchema = z.object({
  id: z.string().min(1).max(40),
  text: z.string().trim().min(1).max(1000),
  kind: z.enum(["text", "phone", "email", "number", "choice"]),
  choices: z.array(z.string().trim().min(1)).max(13).optional(),
  saveTo: z.enum(["phone", "email", "name"]).optional(),
});

export const formInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  instagramAccountId: z.string().min(1),
  isActive: z.boolean().default(true),
  questions: z.array(questionSchema).min(1).max(20),
  cancelWord: z.string().trim().min(1).max(30),
  completionMessage: z.string().trim().min(1).max(1000),
  cancelMessage: z.string().trim().min(1).max(1000),
});

export type FormInput = z.infer<typeof formInputSchema>;

/** Problems a question can have that Instagram or the answer would trip on, by path. */
export function formProblems(input: FormInput): { path: string; message: string }[] {
  const problems: { path: string; message: string }[] = [];
  const ids = new Set<string>();
  input.questions.forEach((q, i) => {
    const at = `questions[${i}]`;
    if (ids.has(q.id)) problems.push({ path: at, message: "Two questions have the same id." });
    ids.add(q.id);
    if (q.kind === "choice") {
      if ((q.choices?.length ?? 0) < 2) problems.push({ path: at, message: "A choice question needs at least 2 options." });
      if (q.choices?.some((c) => codePoints(c) > 20)) problems.push({ path: at, message: "Options can be at most 20 characters, as Instagram's quick replies." });
    }
    // Saving a free-text answer as a phone number would fill the contact with junk.
    if (q.saveTo === "phone" && q.kind !== "phone") problems.push({ path: at, message: "Only a phone question can be saved as the contact's phone." });
    if (q.saveTo === "email" && q.kind !== "email") problems.push({ path: at, message: "Only an email question can be saved as the contact's email." });
  });
  return problems;
}

export async function readFormInput(
  request: Request,
  workspaceId: string,
): Promise<{ input: FormInput } | { response: NextResponse }> {
  const parsed = formInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return { response: NextResponse.json({ error: "Invalid form", issues: parsed.error.issues }, { status: 400 }) };
  }
  const input = parsed.data;
  const account = await prisma.instagramAccount.findFirst({ where: { id: input.instagramAccountId, workspaceId }, select: { id: true } });
  if (!account) return { response: NextResponse.json({ error: "Instagram account not found" }, { status: 404 }) };
  const problems = formProblems(input);
  if (problems.length) return { response: NextResponse.json({ error: "Invalid form", problems }, { status: 400 }) };
  return { input };
}

export function formData(input: FormInput) {
  return {
    name: input.name,
    instagramAccountId: input.instagramAccountId,
    isActive: input.isActive,
    questions: input.questions.map((q) => ({ ...q, ...(q.kind === "choice" ? {} : { choices: undefined }) })) as Prisma.InputJsonValue,
    cancelWord: input.cancelWord,
    completionMessage: input.completionMessage,
    cancelMessage: input.cancelMessage,
  };
}

export type ResultRow = {
  id: string;
  igsid: string;
  username: string | null;
  status: string;
  answers: Record<string, string>;
  startedAt: Date;
  completedAt: Date | null;
};

/**
 * Submissions, newest first. With `latestPerPerson`, someone who filled the
 * form several times counts once, with their most recent completed answers
 * (the duplicate filter).
 */
export async function formResults(formId: string, { latestPerPerson = false, status }: { latestPerPerson?: boolean; status?: string } = {}) {
  const rows = await prisma.formSubmission.findMany({
    where: { formId, ...(status ? { status } : {}) },
    orderBy: { startedAt: "desc" },
    take: 5000,
  });
  const seen = new Set<string>();
  const out: ResultRow[] = [];
  for (const r of rows) {
    if (latestPerPerson) {
      if (seen.has(r.igsid)) continue;
      seen.add(r.igsid);
    }
    out.push({ id: r.id, igsid: r.igsid, username: r.username, status: r.status, answers: (r.answers ?? {}) as Record<string, string>, startedAt: r.startedAt, completedAt: r.completedAt });
  }
  return out;
}

function csvCell(value: string): string {
  // A cell starting with = + - @ runs as a formula in Excel; quote it as text.
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/**
 * CSV that Excel opens with Persian intact: UTF-8 with a byte-order mark
 * (without it Excel reads the file as the system code page and shows «Ø§»).
 */
export function toCsv(header: string[], rows: string[][]): string {
  return "﻿" + [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export function resultsCsv(questions: FormQuestion[], rows: ResultRow[]): string {
  return toCsv(
    ["username", "igsid", "status", "started", "completed", ...questions.map((q) => q.text)],
    rows.map((r) => [
      r.username ?? "",
      r.igsid,
      r.status,
      r.startedAt.toISOString(),
      r.completedAt?.toISOString() ?? "",
      ...questions.map((q) => r.answers[q.id] ?? ""),
    ]),
  );
}
