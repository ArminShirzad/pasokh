import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ accounts: ["acc1"], commandsOnAccount: new Map<string, string>() }));
vi.mock("@/lib/db/client", () => ({
  prisma: {
    instagramAccount: {
      findFirst: async ({ where }: { where: { id: string } }) => (db.accounts.includes(where.id) ? { id: where.id } : null),
    },
    command: {
      count: async ({ where }: { where: { id: { in: string[] }; instagramAccountId: string } }) =>
        where.id.in.filter((id) => db.commandsOnAccount.get(id) === where.instagramAccountId).length,
    },
  },
}));

import { readCommandInput } from "../lib/commands/api";
import { referencedCommandIds } from "../lib/commands/schema";

const base = {
  name: "شرایط",
  instagramAccountId: "acc1",
  keywords: ["شرایط"],
  responses: [{ type: "text", text: "شهرت رو انتخاب کن" }],
};
const req = (body: unknown) => new Request("http://x", { method: "POST", body: JSON.stringify(body) });

beforeEach(() => {
  db.commandsOnAccount = new Map([["tehran0001", "acc1"], ["elsewhere01", "acc2"]]);
});

describe("saving a command", () => {
  it("accepts a valid command with defaults filled in", async () => {
    const result = await readCommandInput(req(base), "ws");
    expect("input" in result && result.input).toMatchObject({ matchMode: "EXACT", storyScope: "ALL", isActive: true, likeTrigger: false });
  });

  it("accepts a command with no keywords as a menu item, opened only by other commands' buttons", async () => {
    const result = await readCommandInput(req({ ...base, keywords: [] }), "ws");
    expect("input" in result).toBe(true);
  });

  it("refuses a message Instagram would reject, pointing at the response", async () => {
    const result = await readCommandInput(req({ ...base, responses: [{ type: "text", text: "x", buttons: [{ type: "url", title: "Go", url: "nope" }] }] }), "ws");
    expect("response" in result && (await result.response.json()).problems[0].path).toBe("responses[0].buttons[0]");
  });

  it("refuses a menu button that opens another account's command, which would do nothing when tapped", async () => {
    const quick = (payload: string) => ({ ...base, responses: [{ type: "text", text: "شهر؟", quickReplies: [{ title: "تهران", payload }] }] });
    expect("input" in (await readCommandInput(req(quick("cmd:tehran0001")), "ws"))).toBe(true);
    const bad = await readCommandInput(req(quick("cmd:elsewhere01")), "ws");
    expect("response" in bad && (await bad.response.json()).problems[0].message).toBe("A button points to a command that no longer exists.");
  });

  it("refuses an Instagram account outside the workspace", async () => {
    const result = await readCommandInput(req({ ...base, instagramAccountId: "someone-elses" }), "ws");
    expect("response" in result && result.response.status).toBe(404);
  });

  it("finds menu targets in quick replies, buttons and card buttons", () => {
    expect(
      referencedCommandIds([
        { type: "text", text: "a", quickReplies: [{ title: "x", payload: "cmd:one" }] },
        { type: "text", text: "b", buttons: [{ type: "postback", title: "y", payload: "cmd:two" }, { type: "url", title: "z", url: "https://x.y" }] },
        { type: "cards", cards: [{ title: "c", buttons: [{ type: "postback", title: "w", payload: "cmd:three" }] }] },
      ]).sort()
    ).toEqual(["one", "three", "two"]);
  });
});
