import { z } from "zod";
import { validateOutbound, type Card, type OutboundMessage } from "@/lib/messages/outbound";
import type { StoredResponse } from "@/lib/messages/stored";

const button = z.discriminatedUnion("type", [
  z.object({ type: z.literal("url"), title: z.string(), url: z.string() }),
  z.object({ type: z.literal("postback"), title: z.string(), payload: z.string() }),
]);
const quickReply = z.object({ title: z.string(), payload: z.string() });
export const cardSchema = z.object({
  title: z.string(),
  subtitle: z.string().optional(),
  imageUrl: z.string().optional(),
  buttons: z.array(button).optional(),
});

export const outboundSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string(), buttons: z.array(button).optional(), quickReplies: z.array(quickReply).optional() }),
  z.object({ type: z.literal("media"), mediaType: z.enum(["image", "video", "audio", "file"]), url: z.string() }),
  z.object({ type: z.literal("cards"), cards: z.array(cardSchema) }),
]);

export const responseSchema = z.union([
  outboundSchema,
  z.object({ type: z.literal("showcase"), showcaseId: z.string().min(1).max(40) }),
]);

export const MAX_RESPONSES = 10;

export const commandInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  instagramAccountId: z.string().min(1),
  isActive: z.boolean().default(true),
  matchMode: z.enum(["EXACT", "CONTAINS"]).default("EXACT"),
  keywords: z.array(z.string().trim().min(1).max(100)).max(50).default([]),
  storyScope: z.enum(["ALL", "ANY_STORY", "SPECIFIC"]).default("ALL"),
  storyIds: z.array(z.string().min(1)).max(20).default([]),
  onStoryMention: z.boolean().default(false),
  likeTrigger: z.boolean().default(false),
  responses: z.array(responseSchema).min(1).max(MAX_RESPONSES),
  sequenceId: z.string().min(1).max(40).nullable().default(null),
  formId: z.string().min(1).max(40).nullable().default(null),
});

export type CommandInput = z.infer<typeof commandInputSchema>;

/** Problems as translation keys with where they are, for the builder to show. */
export function commandProblems(input: CommandInput): { path: string; message: string }[] {
  const problems: { path: string; message: string }[] = [];
  // A command with no trigger of its own is a menu item: it runs only when a
  // button or quick reply of another command opens it (Directam users invent
  // keywords like «تهران10» for this). The builder labels it "menu only".
  if (input.storyScope === "SPECIFIC" && input.storyIds.length === 0) {
    problems.push({ path: "storyIds", message: "Choose at least one story." });
  }
  input.responses.forEach((response, i) => {
    // A showcase's cards are checked when the showcase is saved.
    if (response.type === "showcase") return;
    for (const p of validateOutbound(response as OutboundMessage)) problems.push({ path: `responses[${i}].${p.path}`, message: p.message });
  });
  return problems;
}

/** Every cmd:<id> a command's buttons and quick replies point at. */
export function referencedCommandIds(responses: StoredResponse[]): string[] {
  const ids = new Set<string>();
  const visit = (payload: string) => {
    const m = /^cmd:(.+)$/.exec(payload);
    if (m) ids.add(m[1]);
  };
  for (const r of responses) {
    if (r.type === "text") {
      r.buttons?.forEach((b) => b.type === "postback" && visit(b.payload));
      r.quickReplies?.forEach((q) => visit(q.payload));
    } else if (r.type === "cards") {
      cardCommandIds(r.cards).forEach((id) => ids.add(id));
    }
  }
  return [...ids];
}

/** Every cmd:<id> the buttons of these cards point at. */
export function cardCommandIds(cards: Card[]): string[] {
  const ids = new Set<string>();
  for (const c of cards) {
    for (const b of c.buttons ?? []) {
      const m = b.type === "postback" ? /^cmd:(.+)$/.exec(b.payload) : null;
      if (m) ids.add(m[1]);
    }
  }
  return [...ids];
}
