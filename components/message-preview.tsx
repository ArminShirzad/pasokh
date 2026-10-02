"use client";

/**
 * How an OutboundMessage looks in an Instagram DM: text with its buttons or
 * quick replies, media, or a swipeable row of cards. Shared by the command
 * builder's phone preview and the test lab, so both show exactly what the
 * follower will see.
 */

import { useI18n } from "@/lib/i18n/provider";
import type { MessageButton, OutboundMessage } from "@/lib/messages/outbound";

export type TapHandler = (payload: string, title: string, quickReply: boolean) => void;

export default function MessagePreview({
  message,
  interactive = false,
  onTap,
  describeTarget,
}: {
  message: OutboundMessage;
  /** Quick replies are shown (and tappable) only on the latest message, as on Instagram. */
  interactive?: boolean;
  onTap?: TapHandler;
  /** Optional label for where a postback goes, shown under the button in the builder. */
  describeTarget?: (payload: string) => string | null;
}) {
  const { t } = useI18n();
  const button = (b: MessageButton, i: number) =>
    b.type === "url" ? (
      <a
        key={i}
        href={b.url}
        target="_blank"
        rel="noreferrer"
        className="block rounded-lg border border-border bg-background px-3 py-2 text-center text-xs font-semibold text-accent"
      >
        {b.title || "…"} ↗
      </a>
    ) : (
      <button
        key={i}
        type="button"
        disabled={!onTap}
        onClick={() => onTap?.(b.payload, b.title, false)}
        className="block w-full rounded-lg border border-border bg-background px-3 py-2 text-center text-xs font-semibold text-accent disabled:cursor-default"
      >
        {b.title || "…"}
        {describeTarget?.(b.payload) && <span className="block text-[10px] font-normal text-muted">{describeTarget(b.payload)}</span>}
      </button>
    );

  if (message.type === "media") {
    if (!message.url) return <span className="text-xs text-muted">{t("No file yet")}</span>;
    // Attachments can live on any host; next/image would need each one allow-listed.
    // eslint-disable-next-line @next/next/no-img-element
    if (message.mediaType === "image") return <img src={message.url} alt="" className="max-h-64 rounded-lg" />;
    if (message.mediaType === "video") return <video src={message.url} controls className="max-h-64 rounded-lg" />;
    if (message.mediaType === "audio") return <audio src={message.url} controls className="max-w-full" />;
    return (
      <a href={message.url} target="_blank" rel="noreferrer" className="underline">
        {t("File")}
      </a>
    );
  }
  if (message.type === "cards") {
    return (
      <div className="flex gap-2 overflow-x-auto pb-1">
        {message.cards.map((card, i) => (
          <div key={i} className="w-48 shrink-0 overflow-hidden rounded-lg border border-border bg-background text-foreground">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {card.imageUrl && <img src={card.imageUrl} alt="" className="h-28 w-full object-cover" />}
            <div className="space-y-1 p-2">
              <p className="text-xs font-semibold">{card.title || "…"}</p>
              {card.subtitle && <p className="text-[11px] text-muted">{card.subtitle}</p>}
              <div className="space-y-1 pt-1">{card.buttons?.map(button)}</div>
            </div>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <span className="whitespace-pre-wrap">{message.text || "…"}</span>
      {message.buttons?.length ? <div className="space-y-1 pt-1">{message.buttons.map(button)}</div> : null}
      {message.quickReplies?.length && interactive ? (
        <div className="flex flex-wrap gap-1 pt-1">
          {message.quickReplies.map((r, i) => (
            <button
              key={i}
              type="button"
              disabled={!onTap}
              onClick={() => onTap?.(r.payload, r.title, true)}
              className="rounded-full border border-accent bg-background px-3 py-1 text-xs text-accent disabled:cursor-default"
            >
              {r.title || "…"}
              {describeTarget?.(r.payload) && <span className="block text-[10px] text-muted">{describeTarget(r.payload)}</span>}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
