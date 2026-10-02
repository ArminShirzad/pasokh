import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/client", () => ({ prisma: {} }));

import { pushIceBreakers } from "../lib/instagram/ice-breakers";
import { iceBreakersInputSchema } from "../lib/ice-breakers/service";

const calls: { url: string; method: string; body: unknown }[] = [];
function stubFetch(response: unknown = { success: true }) {
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    calls.push({ url, method: init.method ?? "GET", body: init.body ? JSON.parse(String(init.body)) : undefined });
    return new Response(JSON.stringify(response), { status: 200, headers: { "Content-Type": "application/json" } });
  });
}

afterEach(() => {
  calls.length = 0;
  vi.unstubAllGlobals();
});

const items = [{ question: "هزینهٔ ارسال؟", payload: "cmd:abc12345" }];

describe("sending welcome questions to Instagram", () => {
  it("sends Meta the questions under call_to_actions with the instagram platform, as its messenger_profile expects", async () => {
    stubFetch();
    await pushIceBreakers({ provider: "META", accessToken: "t" }, items);
    expect(calls[0].url).toMatch(/graph\.instagram\.com\/v[\d.]+\/me\/messenger_profile$/);
    expect(calls[0]).toMatchObject({
      method: "POST",
      body: { platform: "instagram", ice_breakers: [{ call_to_actions: items, locale: "default" }] },
    });
  });

  it("removes them on Meta with a DELETE of the ice_breakers field, since an empty list is not accepted", async () => {
    stubFetch();
    await pushIceBreakers({ provider: "META", accessToken: "t" }, []);
    expect(calls[0]).toMatchObject({ method: "DELETE", body: { fields: ["ice_breakers"] } });
  });

  it("sends Zernio a flat list, and clears with DELETE because its PUT needs at least one", async () => {
    stubFetch();
    const zernio = { provider: "ZERNIO" as const, apiKey: "k", accountId: "acc_1", instagramId: "ig" };
    await pushIceBreakers(zernio, items);
    await pushIceBreakers(zernio, []);
    expect(calls.map((c) => [c.method, c.url, c.body])).toEqual([
      ["PUT", "https://zernio.com/api/v1/accounts/acc_1/instagram-ice-breakers", { ice_breakers: items }],
      ["DELETE", "https://zernio.com/api/v1/accounts/acc_1/instagram-ice-breakers", undefined],
    ]);
  });

  it("calls nothing for the test lab, which reads the questions from the database", async () => {
    stubFetch();
    await pushIceBreakers({ provider: "SIMULATOR", connectionId: "c", instagramId: "i" }, items);
    expect(calls).toEqual([]);
  });
});

describe("saving welcome questions", () => {
  const parse = (questions: string[]) =>
    iceBreakersInputSchema.safeParse({ instagramAccountId: "a", items: questions.map((question) => ({ question, commandId: "c" })) });

  it("refuses a fifth question, which Instagram would reject", () => {
    expect(parse(["۱", "۲", "۳", "۴"]).success).toBe(true);
    expect(parse(["۱", "۲", "۳", "۴", "۵"]).success).toBe(false);
  });

  it("counts an 80-character limit in characters, so a Persian question with emoji is not cut short by byte or UTF-16 length", () => {
    expect(parse(["😀".repeat(80)]).success).toBe(true);
    expect(parse(["😀".repeat(81)]).success).toBe(false);
  });
});
