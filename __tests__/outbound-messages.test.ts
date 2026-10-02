import { afterEach, describe, expect, it, vi } from "vitest";
import { isRich, toMetaMessage, toZernioBody, validateOutbound, type OutboundMessage } from "../lib/messages/outbound";
import { reactToMessage, sendOutboundMessage } from "../lib/instagram/send-messages";

const city: OutboundMessage = {
  type: "text",
  text: "شهرت رو انتخاب کن",
  quickReplies: [
    { title: "تهران", payload: "cmd:tehran" },
    { title: "کرج", payload: "cmd:karaj" },
  ],
};
const offer: OutboundMessage = {
  type: "text",
  text: "Here is your offer",
  buttons: [
    { type: "url", title: "Get offer", url: "https://shop.example/offer" },
    { type: "postback", title: "More info", payload: "cmd:info" },
  ],
};
const showcase: OutboundMessage = {
  type: "cards",
  cards: [
    { title: "Mug", subtitle: "Ceramic, 350 ml", imageUrl: "https://shop.example/mug.jpg", buttons: [{ type: "url", title: "Buy", url: "https://shop.example/mug" }] },
    { title: "Tee" },
  ],
};
const voice: OutboundMessage = { type: "media", mediaType: "audio", url: "https://pasokh.example/media/abc.m4a" };

describe("message limits", () => {
  it("accepts messages within Instagram's limits", () => {
    for (const m of [city, offer, showcase, voice]) expect(validateOutbound(m)).toEqual([]);
  });

  it("counts Persian and emoji labels by characters, not bytes", () => {
    // 20 Persian letters are 40 UTF-8 bytes; Instagram's limit is 20 characters.
    const label = "ا".repeat(20);
    expect(validateOutbound({ type: "text", text: "x", quickReplies: [{ title: label, payload: "p" }] })).toEqual([]);
    expect(validateOutbound({ type: "text", text: "x", quickReplies: [{ title: label + "ب", payload: "p" }] })[0].message)
      .toBe("Quick reply labels can be at most 20 characters.");
  });

  it("rejects buttons and quick replies together, which Instagram refuses as one message", () => {
    expect(validateOutbound({ ...offer, quickReplies: [{ title: "a", payload: "b" }] } as OutboundMessage).map((p) => p.message))
      .toContain("A message can have buttons or quick replies, not both.");
  });

  it("allows only 640 characters of text once a message has buttons", () => {
    expect(validateOutbound({ ...offer, text: "x".repeat(641) } as OutboundMessage)[0].message)
      .toBe("A message with buttons can be at most 640 characters.");
    expect(validateOutbound({ type: "text", text: "x".repeat(1000) })).toEqual([]);
  });

  it("rejects a fourth button, an 11th card and a link button without a web address", () => {
    const two = offer.type === "text" ? offer.buttons ?? [] : [];
    const four: OutboundMessage = { type: "text", text: "x", buttons: [...two, ...two] };
    expect(validateOutbound(four)[0].message).toBe("At most 3 buttons per message.");
    expect(validateOutbound({ type: "cards", cards: Array.from({ length: 11 }, () => ({ title: "x" })) })[0].message)
      .toBe("At most 10 cards per message.");
    expect(validateOutbound({ type: "text", text: "x", buttons: [{ type: "url", title: "Go", url: "shop.example" }] })[0].message)
      .toBe("A link button needs a full web address (https://...).");
  });

  it("knows which messages Instagram refuses in a private reply to a non-follower", () => {
    expect(isRich({ type: "text", text: "hi" })).toBe(false);
    for (const m of [city, offer, showcase, voice]) expect(isRich(m)).toBe(true);
  });
});

describe("provider request shapes", () => {
  it("builds Meta's quick replies, button template, generic template and attachment", () => {
    expect(toMetaMessage(city)).toEqual({
      text: "شهرت رو انتخاب کن",
      quick_replies: [
        { content_type: "text", title: "تهران", payload: "cmd:tehran" },
        { content_type: "text", title: "کرج", payload: "cmd:karaj" },
      ],
    });
    expect(toMetaMessage(offer)).toEqual({
      attachment: {
        type: "template",
        payload: {
          template_type: "button",
          text: "Here is your offer",
          buttons: [
            { type: "web_url", url: "https://shop.example/offer", title: "Get offer" },
            { type: "postback", title: "More info", payload: "cmd:info" },
          ],
        },
      },
    });
    expect(toMetaMessage(showcase)).toEqual({
      attachment: {
        type: "template",
        payload: {
          template_type: "generic",
          elements: [
            {
              title: "Mug",
              subtitle: "Ceramic, 350 ml",
              image_url: "https://shop.example/mug.jpg",
              buttons: [{ type: "web_url", url: "https://shop.example/mug", title: "Buy" }],
            },
            { title: "Tee" },
          ],
        },
      },
    });
    expect(toMetaMessage(voice)).toEqual({ attachment: { type: "audio", payload: { url: "https://pasokh.example/media/abc.m4a" } } });
  });

  it("builds Zernio's fields, with no imageAspectRatio (Instagram rejects it)", () => {
    expect(toZernioBody(city)).toEqual({
      message: "شهرت رو انتخاب کن",
      quickReplies: [
        { title: "تهران", payload: "cmd:tehran" },
        { title: "کرج", payload: "cmd:karaj" },
      ],
    });
    expect(toZernioBody(offer)).toEqual({
      message: "Here is your offer",
      buttons: [
        { type: "url", title: "Get offer", url: "https://shop.example/offer" },
        { type: "postback", title: "More info", payload: "cmd:info" },
      ],
    });
    expect(toZernioBody(showcase)).toEqual({
      template: {
        type: "generic",
        elements: [
          { title: "Mug", subtitle: "Ceramic, 350 ml", imageUrl: "https://shop.example/mug.jpg", buttons: [{ type: "url", title: "Buy", url: "https://shop.example/mug" }] },
          { title: "Tee" },
        ],
      },
    });
    expect(JSON.stringify(toZernioBody(showcase))).not.toContain("imageAspectRatio");
    expect(toZernioBody(voice)).toEqual({ attachmentUrl: "https://pasokh.example/media/abc.m4a", attachmentType: "audio" });
  });
});

describe("sending", () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubFetch(body: unknown) {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("sends cards to a person through Meta", async () => {
    const fetchMock = stubFetch({ recipient_id: "u1", message_id: "m1" });
    await sendOutboundMessage({ context: { provider: "META", accessToken: "tok" }, instagramAccountId: "ig1", recipient: { userId: "u1" }, message: showcase });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/graph\.instagram\.com\/v[\d.]+\/ig1\/messages$/);
    expect(JSON.parse(init.body)).toEqual({ recipient: { id: "u1" }, message: toMetaMessage(showcase) });
  });

  it("sends quick replies as a Zernio private reply", async () => {
    const fetchMock = stubFetch({ messageId: "z1" });
    await sendOutboundMessage({
      context: { provider: "ZERNIO", apiKey: "k", accountId: "acc", instagramId: "ig1" },
      instagramAccountId: "ig1",
      recipient: { commentId: "c1", postId: "p1" },
      message: city,
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://zernio.com/api/v1/inbox/comments/p1/c1/private-reply");
    expect(JSON.parse(init.body)).toEqual({ accountId: "acc", ...toZernioBody(city) });
  });

  it("refuses media or cards as a private reply before calling anyone, since neither API accepts them", async () => {
    const fetchMock = stubFetch({});
    await expect(
      sendOutboundMessage({ context: { provider: "META", accessToken: "t" }, instagramAccountId: "ig1", recipient: { commentId: "c1" }, message: voice }),
    ).rejects.toThrow("A private reply to a comment can only be text");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses an invalid message before calling anyone", async () => {
    const fetchMock = stubFetch({});
    await expect(
      sendOutboundMessage({ context: { provider: "META", accessToken: "t" }, instagramAccountId: "ig1", recipient: { userId: "u" }, message: { type: "text", text: " " } }),
    ).rejects.toThrow("The message text is empty.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reacts with Meta's only reaction, and with the same heart through Zernio", async () => {
    let fetchMock = stubFetch({ recipient_id: "u1" });
    await reactToMessage({ context: { provider: "META", accessToken: "t" }, instagramAccountId: "ig1", userId: "u1", messageId: "mid.1" });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      recipient: { id: "u1" },
      sender_action: "react",
      payload: { message_id: "mid.1", reaction: "love" },
    });
    fetchMock = stubFetch({ success: true });
    await reactToMessage({ context: { provider: "ZERNIO", apiKey: "k", accountId: "acc", instagramId: "ig1" }, instagramAccountId: "ig1", userId: "u1", messageId: "mid.1" });
    expect(fetchMock.mock.calls[0][0]).toBe("https://zernio.com/api/v1/inbox/conversations/u1/messages/mid.1/reactions");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ accountId: "acc", emoji: "❤️" });
  });
});
