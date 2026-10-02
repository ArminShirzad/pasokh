/**
 * One outbound DM, independent of provider. Everything Pasokh sends — campaign
 * replies, commands, sequences, forms — is a list of these. validateOutbound()
 * enforces Instagram's limits in one place, so a message that would be
 * rejected is caught when it is saved, not when a follower is waiting.
 *
 * Limits are Instagram's (Meta Messenger Platform for Instagram, mirrored by
 * Zernio's API schema, read 2026-10-02): text 1000 chars, 3 buttons with
 * 20-char titles, 13 quick replies with 20-char titles, 10 cards with
 * 80-char titles and subtitles, button-template text 640 chars.
 */

export type MessageButton =
  | { type: "url"; title: string; url: string }
  | { type: "postback"; title: string; payload: string };

export type QuickReply = { title: string; payload: string };

export type Card = {
  title: string;
  subtitle?: string;
  imageUrl?: string;
  buttons?: MessageButton[];
};

export type MediaType = "image" | "video" | "audio" | "file";

export type OutboundMessage =
  | { type: "text"; text: string; buttons?: MessageButton[]; quickReplies?: QuickReply[] }
  | { type: "media"; mediaType: MediaType; url: string }
  | { type: "cards"; cards: Card[] };

export const LIMITS = {
  text: 1000,
  buttonText: 640,
  buttons: 3,
  buttonTitle: 20,
  quickReplies: 13,
  quickReplyTitle: 20,
  payload: 1000,
  cards: 10,
  cardTitle: 80,
  cardSubtitle: 80,
} as const;

/** A problem with a message, as an English sentence that is also a translation key. */
export type OutboundProblem = { path: string; message: string };

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function checkButtons(buttons: MessageButton[], path: string, problems: OutboundProblem[]) {
  if (buttons.length > LIMITS.buttons) problems.push({ path, message: "At most 3 buttons per message." });
  buttons.forEach((button, i) => {
    const at = `${path}[${i}]`;
    if (!button.title.trim()) problems.push({ path: at, message: "Every button needs a label." });
    if ([...button.title].length > LIMITS.buttonTitle) problems.push({ path: at, message: "Button labels can be at most 20 characters." });
    if (button.type === "url" && !isHttpUrl(button.url)) problems.push({ path: at, message: "A link button needs a full web address (https://...)." });
    if (button.type === "postback" && (!button.payload || button.payload.length > LIMITS.payload)) {
      problems.push({ path: at, message: "This button has no action." });
    }
  });
}

/** Character counts use code points, so Persian text and emoji count as people see them. */
function length(text: string): number {
  return [...text].length;
}

export function validateOutbound(message: OutboundMessage): OutboundProblem[] {
  const problems: OutboundProblem[] = [];
  switch (message.type) {
    case "text": {
      const hasButtons = Boolean(message.buttons?.length);
      const hasQuickReplies = Boolean(message.quickReplies?.length);
      if (!message.text.trim()) problems.push({ path: "text", message: "The message text is empty." });
      const max = hasButtons ? LIMITS.buttonText : LIMITS.text;
      if (length(message.text) > max) {
        problems.push({
          path: "text",
          message: hasButtons
            ? "A message with buttons can be at most 640 characters."
            : "A message can be at most 1000 characters.",
        });
      }
      if (hasButtons && hasQuickReplies) {
        problems.push({ path: "quickReplies", message: "A message can have buttons or quick replies, not both." });
      }
      if (message.buttons) checkButtons(message.buttons, "buttons", problems);
      if (message.quickReplies) {
        if (message.quickReplies.length > LIMITS.quickReplies) {
          problems.push({ path: "quickReplies", message: "At most 13 quick replies per message." });
        }
        message.quickReplies.forEach((reply, i) => {
          const at = `quickReplies[${i}]`;
          if (!reply.title.trim()) problems.push({ path: at, message: "Every quick reply needs a label." });
          if (length(reply.title) > LIMITS.quickReplyTitle) problems.push({ path: at, message: "Quick reply labels can be at most 20 characters." });
          if (!reply.payload || reply.payload.length > LIMITS.payload) problems.push({ path: at, message: "This quick reply has no action." });
        });
      }
      break;
    }
    case "media":
      if (!isHttpUrl(message.url)) problems.push({ path: "url", message: "The file needs a public web address." });
      break;
    case "cards":
      if (message.cards.length === 0) problems.push({ path: "cards", message: "Add at least one card." });
      if (message.cards.length > LIMITS.cards) problems.push({ path: "cards", message: "At most 10 cards per message." });
      message.cards.forEach((card, i) => {
        const at = `cards[${i}]`;
        if (!card.title.trim()) problems.push({ path: at, message: "Every card needs a title." });
        if (length(card.title) > LIMITS.cardTitle) problems.push({ path: at, message: "Card titles can be at most 80 characters." });
        if (card.subtitle && length(card.subtitle) > LIMITS.cardSubtitle) problems.push({ path: at, message: "Card descriptions can be at most 80 characters." });
        if (card.imageUrl && !isHttpUrl(card.imageUrl)) problems.push({ path: at, message: "The card image needs a public web address." });
        if (card.buttons) checkButtons(card.buttons, `${at}.buttons`, problems);
      });
      break;
  }
  return problems;
}

/** True when Instagram refuses this message in a private reply to a non-follower. */
export function isRich(message: OutboundMessage): boolean {
  return message.type !== "text" || Boolean(message.buttons?.length || message.quickReplies?.length);
}

// ── Provider request shapes ──────────────────────────────────────────────────

function metaButton(button: MessageButton) {
  return button.type === "url"
    ? { type: "web_url", url: button.url, title: button.title }
    : { type: "postback", title: button.title, payload: button.payload };
}

/** The `message` object of Meta's POST /{ig-id}/messages. */
export function toMetaMessage(message: OutboundMessage): Record<string, unknown> {
  switch (message.type) {
    case "text":
      if (message.buttons?.length) {
        return {
          attachment: {
            type: "template",
            payload: { template_type: "button", text: message.text, buttons: message.buttons.map(metaButton) },
          },
        };
      }
      if (message.quickReplies?.length) {
        return {
          text: message.text,
          quick_replies: message.quickReplies.map((r) => ({ content_type: "text", title: r.title, payload: r.payload })),
        };
      }
      return { text: message.text };
    case "media":
      return { attachment: { type: message.mediaType, payload: { url: message.url } } };
    case "cards":
      return {
        attachment: {
          type: "template",
          payload: {
            template_type: "generic",
            elements: message.cards.map((card) => ({
              title: card.title,
              ...(card.subtitle ? { subtitle: card.subtitle } : {}),
              ...(card.imageUrl ? { image_url: card.imageUrl } : {}),
              ...(card.buttons?.length ? { buttons: card.buttons.map(metaButton) } : {}),
            })),
          },
        },
      };
  }
}

function zernioButton(button: MessageButton) {
  return button.type === "url"
    ? { type: "url", title: button.title, url: button.url }
    : { type: "postback", title: button.title, payload: button.payload };
}

/** The body fields (besides accountId) of Zernio's send-message and private-reply calls. */
export function toZernioBody(message: OutboundMessage): Record<string, unknown> {
  switch (message.type) {
    case "text":
      return {
        message: message.text,
        ...(message.buttons?.length ? { buttons: message.buttons.map(zernioButton) } : {}),
        ...(message.quickReplies?.length
          ? { quickReplies: message.quickReplies.map((r) => ({ title: r.title, payload: r.payload })) }
          : {}),
      };
    case "media":
      return { attachmentUrl: message.url, attachmentType: message.mediaType };
    case "cards":
      return {
        template: {
          type: "generic",
          elements: message.cards.map((card) => ({
            title: card.title,
            ...(card.subtitle ? { subtitle: card.subtitle } : {}),
            ...(card.imageUrl ? { imageUrl: card.imageUrl } : {}),
            ...(card.buttons?.length ? { buttons: card.buttons.map(zernioButton) } : {}),
          })),
        },
      };
  }
}
