import { describe, expect, it } from "vitest";
import { matchScore, personalize, pickCommand, type CommandTriggerFields } from "../lib/commands/engine";
import { matchExact } from "../lib/utils/keyword-matcher";

let n = 0;
function cmd(fields: Partial<CommandTriggerFields>): CommandTriggerFields {
  n++;
  return {
    id: `c${n}`,
    matchMode: "EXACT",
    keywords: [],
    storyScope: "ALL",
    storyIds: [],
    onStoryMention: false,
    createdAt: new Date(2026, 9, 1, 0, n),
    ...fields,
  };
}

describe("exact keyword matching («برابر»)", () => {
  it("matches the whole message, ignoring case, punctuation, emoji and keyboard variants", () => {
    expect(matchExact("سلام", ["سلام"]).matched).toBe(true);
    expect(matchExact("  سلام!! 😍", ["سلام"]).matched).toBe(true);
    // Arabic yeh/kaf from an Arabic keyboard look identical to the Persian ones.
    expect(matchExact("كيك", ["کیک"]).matched).toBe(true);
    expect(matchExact("Price", ["price"]).matched).toBe(true);
    expect(matchExact("۱۰", ["10"]).matched).toBe(true);
  });

  it("does not match when the keyword is only part of the message", () => {
    expect(matchExact("سلام خوبی؟", ["سلام"]).matched).toBe(false);
  });
});

describe("which command answers", () => {
  it("answers a DM by exact keyword, or by contained word in CONTAINS mode", () => {
    const exact = cmd({ keywords: ["قیمت"] });
    const contains = cmd({ keywords: ["قیمت"], matchMode: "CONTAINS" });
    expect(matchScore(exact, { text: "قیمت" })).toBeGreaterThan(0);
    expect(matchScore(exact, { text: "قیمت چنده؟" })).toBe(0);
    expect(matchScore(contains, { text: "قیمت چنده؟" })).toBeGreaterThan(0);
  });

  it("prefers an exact match over a contains match for the same message", () => {
    const contains = cmd({ keywords: ["قیمت"], matchMode: "CONTAINS" });
    const exact = cmd({ keywords: ["قیمت"] });
    expect(pickCommand([contains, exact], { text: "قیمت" })?.id).toBe(exact.id);
  });

  it("prefers the command for this story over one for any story over a general one", () => {
    const general = cmd({ keywords: ["لینک"] });
    const anyStory = cmd({ keywords: ["لینک"], storyScope: "ANY_STORY" });
    const thisStory = cmd({ keywords: ["لینک"], storyScope: "SPECIFIC", storyIds: ["st1"] });
    expect(pickCommand([general, anyStory, thisStory], { text: "لینک", storyId: "st1" })?.id).toBe(thisStory.id);
    expect(pickCommand([general, anyStory, thisStory], { text: "لینک", storyId: "other" })?.id).toBe(anyStory.id);
    expect(pickCommand([general, anyStory, thisStory], { text: "لینک" })?.id).toBe(general.id);
  });

  it("keeps story-only commands out of plain DMs", () => {
    expect(matchScore(cmd({ keywords: ["لینک"], storyScope: "ANY_STORY" }), { text: "لینک" })).toBe(0);
    expect(matchScore(cmd({ keywords: ["لینک"], storyScope: "SPECIFIC", storyIds: ["st1"] }), { text: "لینک" })).toBe(0);
  });

  it("lets a story command with no keywords answer any reply to that story", () => {
    expect(matchScore(cmd({ storyScope: "SPECIFIC", storyIds: ["st1"] }), { text: "😍", storyId: "st1" })).toBeGreaterThan(0);
  });

  it("never lets a DM command with no keywords answer every message", () => {
    expect(matchScore(cmd({ keywords: [] }), { text: "anything" })).toBe(0);
  });

  it("answers a story mention only with a command that asked for mentions", () => {
    expect(matchScore(cmd({ keywords: ["x"] }), { text: "", isStoryMention: true })).toBe(0);
    expect(matchScore(cmd({ onStoryMention: true }), { text: "", isStoryMention: true })).toBeGreaterThan(0);
  });

  it("breaks ties by the older command, so adding a duplicate does not steal its traffic", () => {
    const first = cmd({ keywords: ["سلام"] });
    const second = cmd({ keywords: ["سلام"] });
    expect(pickCommand([second, first], { text: "سلام" })?.id).toBe(first.id);
  });
});

describe("personalisation", () => {
  it("fills {username} in text and card titles", () => {
    expect(personalize({ type: "text", text: "سلام {username}!" }, "ali")).toEqual({ type: "text", text: "سلام ali!" });
    expect(personalize({ type: "cards", cards: [{ title: "برای {username}" }] }, "ali")).toEqual({ type: "cards", cards: [{ title: "برای ali" }] });
    expect(personalize({ type: "text", text: "سلام {username}" }, null)).toEqual({ type: "text", text: "سلام " });
  });
});
