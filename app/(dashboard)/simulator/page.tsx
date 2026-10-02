"use client";

/**
 * Test lab: try campaigns without a real Instagram account. The left side is
 * the test account's posts, where the simulated person comments; the right is
 * that person's phone, showing what Pasokh sends back. Replies come from the
 * real worker through the SIMULATOR provider, which applies Instagram's rules
 * (one private reply per comment, no buttons to non-followers in a comment
 * reply, the 24-hour window), so what works here works on Instagram.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n/provider";
import type { OutboundMessage, MessageButton } from "@/lib/messages/outbound";

type LabEvent = {
  id: string;
  direction: "in" | "out";
  kind: string;
  postId: string | null;
  commentId: string | null;
  body: Record<string, unknown>;
  createdAt: string;
};
type LabState = {
  account: { id: string; username: string };
  fan: { username: string; follows: boolean };
  posts: { id: string; caption: string; type: string }[];
  events: LabEvent[];
};

const POLL_MS = 1500;

export default function SimulatorPage() {
  const { t } = useI18n();
  const [state, setState] = useState<LabState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dm, setDm] = useState("");
  const [comments, setComments] = useState<Record<string, string>>({});
  const chatEnd = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const response = await fetch("/api/simulator", { cache: "no-store" });
    if (!response.ok) {
      setError(t("Could not load the test lab."));
      return;
    }
    setError(null);
    setState(await response.json());
  }, [t]);

  const act = useCallback(
    async (body: Record<string, unknown>) => {
      setBusy(true);
      try {
        const response = await fetch("/api/simulator", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!response.ok) setError(t("That action failed."));
        else setState(await response.json());
      } finally {
        setBusy(false);
      }
    },
    [t]
  );

  useEffect(() => {
    // Polling: the state update happens after the fetch resolves, not during
    // the effect itself.
    /* eslint-disable-next-line react-hooks/set-state-in-effect */
    void load();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  const chatEvents = state?.events.filter((e) => e.kind !== "comment" && e.kind !== "comment_reply") ?? [];
  const chatLength = chatEvents.length;
  useEffect(() => {
    chatEnd.current?.scrollIntoView({ block: "end" });
  }, [chatLength]);

  if (!state) {
    return <p className="text-sm text-muted">{error ?? t("Loading…")}</p>;
  }

  const lastOut = [...chatEvents].reverse().find((e) => e.direction === "out" && (e.kind === "dm" || e.kind === "private_reply"));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">{t("Test lab")}</h1>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted">
          {t("Try your campaigns without Instagram. Create a campaign for the account @{username}, then comment or send a DM here as a test follower. Nothing is sent to Instagram.", { username: state.account.username })}
        </p>
        {error && <p className="mt-2 text-sm text-error">{error}</p>}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="space-y-4">
          <h2 className="text-sm font-semibold text-foreground">{t("Posts")}</h2>
          {state.posts.map((post) => {
            const thread = state.events.filter((e) => e.postId === post.id && (e.kind === "comment" || e.kind === "comment_reply"));
            return (
              <div key={post.id} className="rounded-lg border border-border bg-surface p-4">
                <p className="text-sm text-foreground">{post.caption}</p>
                <div className="mt-3 space-y-2">
                  {thread.map((e) => (
                    <p key={e.id} className={`text-sm ${e.kind === "comment_reply" ? "ms-6 text-accent" : "text-foreground"}`}>
                      <span className="font-semibold">
                        {e.kind === "comment_reply" ? `@${state.account.username}` : `@${state.fan.username}`}
                      </span>{" "}
                      {String(e.body.text ?? "")}
                    </p>
                  ))}
                </div>
                <form
                  className="mt-3 flex gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const text = comments[post.id]?.trim();
                    if (!text) return;
                    setComments({ ...comments, [post.id]: "" });
                    void act({ action: "comment", postId: post.id, text });
                  }}
                >
                  <input
                    value={comments[post.id] ?? ""}
                    onChange={(e) => setComments({ ...comments, [post.id]: e.target.value })}
                    placeholder={t("Write a comment…")}
                    className="min-w-0 flex-1 rounded border border-border bg-background px-3 py-2 text-sm"
                  />
                  <button disabled={busy} className="rounded bg-accent px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">
                    {t("Comment")}
                  </button>
                </form>
              </div>
            );
          })}
        </section>

        <section className="flex min-h-[32rem] flex-col rounded-2xl border border-border bg-background">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-foreground">@{state.account.username}</p>
              <p className="text-xs text-muted">{t("As seen by @{username}", { username: state.fan.username })}</p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-xs text-foreground">
                <input
                  type="checkbox"
                  checked={state.fan.follows}
                  onChange={(e) => void act({ action: "follow", follows: e.target.checked })}
                />
                {t("Follows the page")}
              </label>
              <button
                type="button"
                onClick={() => {
                  if (confirm(t("Start over with a new test follower? The conversation is cleared."))) void act({ action: "reset" });
                }}
                className="text-xs text-muted underline-offset-4 hover:text-foreground hover:underline"
              >
                {t("Start over")}
              </button>
            </div>
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto p-4">
            {chatEvents.length === 0 && <p className="text-center text-sm text-muted">{t("No messages yet. Comment on a post or send a DM.")}</p>}
            {chatEvents.map((e) => (
              <ChatLine key={e.id} event={e} interactive={e.id === lastOut?.id} onTap={(payload, title, quickReply) => void act({ action: "tap", payload, title, quickReply })} />
            ))}
            <div ref={chatEnd} />
          </div>

          <div className="space-y-2 border-t border-border p-3">
            <form
              className="flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                const text = dm.trim();
                if (!text) return;
                setDm("");
                void act({ action: "dm", text });
              }}
            >
              <input
                value={dm}
                onChange={(e) => setDm(e.target.value)}
                placeholder={t("Message…")}
                className="min-w-0 flex-1 rounded-full border border-border bg-surface px-4 py-2 text-sm"
              />
              <button disabled={busy} className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                {t("Send")}
              </button>
            </form>
            <div className="flex flex-wrap gap-3 text-xs">
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  const text = dm.trim() || t("Hi!");
                  setDm("");
                  void act({ action: "story_reply", text });
                }}
                className="text-muted underline-offset-4 hover:text-foreground hover:underline"
              >
                {t("Send as a story reply")}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void act({ action: "story_mention" })}
                className="text-muted underline-offset-4 hover:text-foreground hover:underline"
              >
                {t("Mention the page in a story")}
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function ChatLine({
  event,
  interactive,
  onTap,
}: {
  event: LabEvent;
  interactive: boolean;
  onTap: (payload: string, title: string, quickReply: boolean) => void;
}) {
  const { t } = useI18n();
  const mine = event.direction === "in";
  const body = event.body;

  if (event.kind === "private_reply_refused") {
    return (
      <p className="rounded border border-error/30 bg-error/5 px-3 py-2 text-xs text-error">
        {t("Instagram refused a private reply with buttons, cards or attachments because this person does not follow the page. The comment's only private reply is used up.")}
      </p>
    );
  }
  if (event.kind === "reaction") {
    return <p className="text-xs text-muted">{t("The page reacted ❤️ to a message")}</p>;
  }

  let content: React.ReactNode;
  if (event.kind === "tap") content = String(body.title ?? "");
  else if (event.kind === "story_mention") content = <em>{t("Mentioned you in their story")}</em>;
  else if (event.kind === "story_reply") content = <><em className="block text-xs opacity-75">{t("Replied to your story")}</em>{String(body.text ?? "")}</>;
  else content = <OutboundContent message={body as unknown as OutboundMessage} interactive={interactive} onTap={onTap} />;

  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[85%] space-y-1 ${mine ? "items-end" : "items-start"}`}>
        {event.kind === "private_reply" && <p className="text-[11px] text-muted">{t("Private reply to a comment")}</p>}
        <div
          className={`whitespace-pre-wrap break-words rounded-2xl px-4 py-2 text-sm ${
            mine ? "rounded-ee-md bg-accent text-white" : "rounded-es-md bg-surface text-foreground"
          }`}
        >
          {content}
        </div>
      </div>
    </div>
  );
}

function OutboundContent({
  message,
  interactive,
  onTap,
}: {
  message: OutboundMessage;
  interactive: boolean;
  onTap: (payload: string, title: string, quickReply: boolean) => void;
}) {
  const { t } = useI18n();
  const button = (b: MessageButton, i: number) =>
    b.type === "url" ? (
      <a key={i} href={b.url} target="_blank" rel="noreferrer" className="block rounded-lg border border-border bg-background px-3 py-2 text-center text-xs font-semibold text-accent">
        {b.title} ↗
      </a>
    ) : (
      <button key={i} type="button" onClick={() => onTap(b.payload, b.title, false)} className="block w-full rounded-lg border border-border bg-background px-3 py-2 text-center text-xs font-semibold text-accent">
        {b.title}
      </button>
    );

  if (message.type === "media") {
    // Attachments can live on any host; next/image would need each one allow-listed.
    // eslint-disable-next-line @next/next/no-img-element
    if (message.mediaType === "image") return <img src={message.url} alt="" className="max-h-64 rounded-lg" />;
    if (message.mediaType === "video") return <video src={message.url} controls className="max-h-64 rounded-lg" />;
    if (message.mediaType === "audio") return <audio src={message.url} controls />;
    return <a href={message.url} target="_blank" rel="noreferrer" className="underline">{t("File")}</a>;
  }
  if (message.type === "cards") {
    return (
      <div className="flex gap-2 overflow-x-auto pb-1">
        {message.cards.map((card, i) => (
          <div key={i} className="w-48 shrink-0 overflow-hidden rounded-lg border border-border bg-background">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {card.imageUrl && <img src={card.imageUrl} alt="" className="h-28 w-full object-cover" />}
            <div className="space-y-1 p-2">
              <p className="text-xs font-semibold">{card.title}</p>
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
      <span>{message.text}</span>
      {message.buttons?.length ? <div className="space-y-1 pt-1">{message.buttons.map(button)}</div> : null}
      {message.quickReplies?.length && interactive ? (
        <div className="flex flex-wrap gap-1 pt-1">
          {message.quickReplies.map((r, i) => (
            <button key={i} type="button" onClick={() => onTap(r.payload, r.title, true)} className="rounded-full border border-accent px-3 py-1 text-xs text-accent">
              {r.title}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
