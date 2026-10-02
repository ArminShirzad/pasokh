import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ commands: new Map<string, string>() }));
vi.mock("@/lib/db/client", () => ({
  prisma: {
    command: {
      count: async ({ where }: { where: { id: string; instagramAccountId: string } }) =>
        db.commands.get(where.id) === where.instagramAccountId ? 1 : 0,
    },
  },
}));

import { cleanPublicReplies, pickPublicReply, publicRepliesProblem } from "../lib/campaigns/public-replies";
import { campaignProblem } from "../lib/campaigns/validate";

const meta = { id: "acc1", provider: "META" };
const base = { publicReplyEnabled: false, publicReplyMessages: [], matchLive: false, commandId: null };

beforeEach(() => {
  db.commands = new Map([["menu0001", "acc1"], ["other001", "acc2"]]);
});

describe("public reply wordings", () => {
  it("refuses public replies with fewer than 3 wordings, which Instagram hides as spam", () => {
    expect(publicRepliesProblem(true, ["a", "b"])).toMatch(/at least 3/);
    expect(publicRepliesProblem(true, ["a", "b", "c"])).toBeNull();
    expect(publicRepliesProblem(false, [])).toBeNull();
  });

  it("does not count a repeated or blank wording as a different one", () => {
    expect(cleanPublicReplies([" ممنون ", "ممنون", "", "Thanks", "thanks"])).toEqual(["ممنون", "Thanks"]);
    expect(publicRepliesProblem(true, ["ممنون", "ممنون ", "  ", "مرسی"])).toMatch(/at least 3/);
  });

  it("never picks the wording posted last time while there is another", () => {
    for (const r of [0, 0.4, 0.99]) expect(pickPublicReply(["a", "b", "c"], "a", () => r)).not.toBe("a");
    expect(pickPublicReply(["a"], "a", () => 0)).toBe("a");
    expect(pickPublicReply(["a", "b"], null, () => 0)).toBe("a");
  });
});

describe("saving a campaign", () => {
  it("refuses a live campaign on a Zernio connection, which never receives live comments", async () => {
    expect(await campaignProblem({ ...base, matchLive: true }, { id: "acc1", provider: "ZERNIO" })).toMatch(/Meta connection/);
    expect(await campaignProblem({ ...base, matchLive: true }, meta)).toBeNull();
  });

  it("refuses handing off to another account's smart reply, which could never be sent from this one", async () => {
    expect(await campaignProblem({ ...base, commandId: "menu0001" }, meta)).toBeNull();
    expect(await campaignProblem({ ...base, commandId: "other001" }, meta)).toMatch(/does not exist on this Instagram account/);
  });
});
