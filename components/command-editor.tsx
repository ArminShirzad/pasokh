"use client";

/**
 * Smart-reply builder: triggers on the left, the responses below them, and a
 * phone preview of exactly what the follower receives. Validation happens on
 * save (the server applies Instagram's limits) and problems are shown next to
 * the response they belong to.
 */

import { handle } from "@/lib/text/handle";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import KeywordInput from "@/components/keyword-input";
import MessagePreview from "@/components/message-preview";
import { useI18n } from "@/lib/i18n/provider";
import type { StaticMessageKey } from "@/lib/i18n";
import type { Card, MediaType, MessageButton, OutboundMessage, QuickReply } from "@/lib/messages/outbound";
import type { StoredResponse } from "@/lib/messages/stored";
import Link from "next/link";

export type CommandDraft = {
  id?: string;
  name: string;
  instagramAccountId: string;
  isActive: boolean;
  matchMode: "EXACT" | "CONTAINS";
  keywords: string[];
  storyScope: "ALL" | "ANY_STORY" | "SPECIFIC";
  storyIds: string[];
  onStoryMention: boolean;
  likeTrigger: boolean;
  responses: StoredResponse[];
};

export type CommandSummary = { id: string; name: string };
export type ShowcaseSummary = { id: string; name: string; cards: Card[] };
type Story = { id: string; media_url?: string; thumbnail_url?: string; timestamp?: string };
type Problem = { path: string; message: string };

const field =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-zinc-400 focus:border-accent/40 focus:outline-none";
const smallButton = "rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-surface-hover";

export default function CommandEditor({
  initial,
  accounts,
}: {
  initial: CommandDraft;
  accounts: { id: string; username: string }[];
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [draft, setDraft] = useState<CommandDraft>(initial);
  const [commands, setCommands] = useState<CommandSummary[]>([]);
  const [showcases, setShowcases] = useState<ShowcaseSummary[] | null>(null);
  const [stories, setStories] = useState<Story[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [problems, setProblems] = useState<Problem[]>([]);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof CommandDraft>(key: K, value: CommandDraft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/commands?accountId=${encodeURIComponent(draft.instagramAccountId)}`)
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setCommands((data.commands ?? []).filter((c: CommandSummary) => c.id !== draft.id));
      });
    return () => {
      cancelled = true;
    };
  }, [draft.instagramAccountId, draft.id]);

  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/showcases?accountId=${encodeURIComponent(draft.instagramAccountId)}`)
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setShowcases(data.showcases ?? []);
      });
    return () => {
      cancelled = true;
    };
  }, [draft.instagramAccountId]);

  useEffect(() => {
    if (draft.storyScope !== "SPECIFIC") return;
    let cancelled = false;
    void fetch(`/api/instagram/stories?instagramAccountId=${encodeURIComponent(draft.instagramAccountId)}`)
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setStories(data.success ? data.data : []);
      });
    return () => {
      cancelled = true;
    };
  }, [draft.storyScope, draft.instagramAccountId]);

  const commandName = useMemo(() => new Map(commands.map((c) => [`cmd:${c.id}`, c.name])), [commands]);
  const describeTarget = (payload: string) => {
    const name = commandName.get(payload);
    return name ? `→ ${name}` : null;
  };

  // What the follower receives for a stored response: a showcase as its cards.
  const asSent = (r: StoredResponse): OutboundMessage | null => {
    if (r.type !== "showcase") return r;
    const showcase = showcases?.find((s) => s.id === r.showcaseId);
    return showcase ? { type: "cards", cards: showcase.cards } : null;
  };

  function updateResponse(index: number, next: StoredResponse) {
    set("responses", draft.responses.map((r, i) => (i === index ? next : r)));
  }
  function moveResponse(index: number, by: -1 | 1) {
    const next = [...draft.responses];
    const [item] = next.splice(index, 1);
    next.splice(index + by, 0, item);
    set("responses", next);
  }

  async function save() {
    setSaving(true);
    setProblems([]);
    setError(null);
    try {
      const response = await fetch(draft.id ? `/api/commands/${draft.id}` : "/api/commands", {
        method: draft.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...draft, id: undefined }),
      });
      const data = await response.json();
      if (!response.ok) {
        setProblems(data.problems ?? []);
        setError(data.problems?.length ? t("Fix the highlighted problems and save again.") : t("Could not save the command."));
        return;
      }
      router.push("/commands");
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  const problemsAt = (prefix: string) => problems.filter((p) => p.path === prefix || p.path.startsWith(`${prefix}.`) || p.path.startsWith(`${prefix}[`));

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="space-y-6">
        <section className="space-y-3 rounded-xl border border-border bg-surface p-5">
          <label className="block space-y-1">
            <span className="text-sm font-medium">{t("Command name")}</span>
            <input className={field} value={draft.name} onChange={(e) => set("name", e.target.value)} placeholder={t("e.g. Prices")} />
            <span className="text-xs text-muted">{t("Only you see this name.")}</span>
          </label>
          {accounts.length > 1 && (
            <label className="block space-y-1">
              <span className="text-sm font-medium">{t("Instagram account")}</span>
              <select className={field} value={draft.instagramAccountId} onChange={(e) => set("instagramAccountId", e.target.value)} disabled={Boolean(draft.id)}>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>{handle(a.username)}</option>
                ))}
              </select>
            </label>
          )}
        </section>

        <section className="space-y-4 rounded-xl border border-border bg-surface p-5">
          <h2 className="font-semibold">{t("When someone sends")}</h2>
          <div className="flex flex-wrap gap-2">
            {(["EXACT", "CONTAINS"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => set("matchMode", mode)}
                className={`rounded-full border px-3 py-1 text-xs ${draft.matchMode === mode ? "border-accent bg-accent text-white" : "border-border text-foreground"}`}
              >
                {mode === "EXACT" ? t("Exactly this") : t("A message containing this")}
              </button>
            ))}
          </div>
          <KeywordInput keywords={draft.keywords} onChange={(k) => set("keywords", k)} max={50} />
          <p className="text-xs text-muted">
            {draft.matchMode === "EXACT"
              ? t("The whole message must be one of these words. Arabic and Persian keyboard letters, case and emoji do not matter.")
              : t("Answers any message that contains one of these words.")}
          </p>
          {isMenuOnly(draft) && (
            <p className="rounded-lg bg-accent/10 px-3 py-2 text-xs text-accent">
              {t("No keywords: this command only runs when a button or quick reply of another command opens it.")}
            </p>
          )}
          {problemsAt("keywords").map((p, i) => (
            <p key={i} className="text-xs text-error">{t(p.message as StaticMessageKey)}</p>
          ))}

          <div className="space-y-2 border-t border-border pt-4">
            <p className="text-sm font-medium">{t("Where")}</p>
            {(
              [
                ["ALL", "In DMs and replies to any story"],
                ["ANY_STORY", "Only in replies to my stories"],
                ["SPECIFIC", "Only in replies to specific stories"],
              ] as const
            ).map(([value, label]) => (
              <label key={value} className="flex items-center gap-2 text-sm">
                <input type="radio" checked={draft.storyScope === value} onChange={() => set("storyScope", value)} />
                {t(label)}
              </label>
            ))}
            {draft.storyScope === "SPECIFIC" && (
              <div className="space-y-2 ps-6">
                {stories === null ? (
                  <p className="text-xs text-muted">{t("Loading…")}</p>
                ) : stories.length === 0 ? (
                  <p className="text-xs text-muted">{t("No live stories. Stories show here for the 24 hours they are up.")}</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {stories.map((story) => {
                      const selected = draft.storyIds.includes(story.id);
                      return (
                        <button
                          key={story.id}
                          type="button"
                          onClick={() => set("storyIds", selected ? draft.storyIds.filter((s) => s !== story.id) : [...draft.storyIds, story.id])}
                          className={`h-28 w-16 overflow-hidden rounded-lg border-2 bg-background text-[10px] ${selected ? "border-accent" : "border-border"}`}
                        >
                          {story.thumbnail_url || story.media_url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={story.thumbnail_url ?? story.media_url} alt="" className="h-full w-full object-cover" />
                          ) : (
                            story.id.slice(-6)
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
                {draft.storyScope === "SPECIFIC" && draft.keywords.length === 0 && (
                  <p className="text-xs text-muted">{t("With no keywords, any reply to these stories gets this answer.")}</p>
                )}
                {problemsAt("storyIds").map((p, i) => (
                  <p key={i} className="text-xs text-error">{t(p.message as StaticMessageKey)}</p>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-2 border-t border-border pt-4">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={draft.onStoryMention} onChange={(e) => set("onStoryMention", e.target.checked)} />
              {t("Also answer when someone mentions me in their story")}
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={draft.likeTrigger} onChange={(e) => set("likeTrigger", e.target.checked)} />
              {t("Like their message ❤️")}
            </label>
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="font-semibold">{t("Reply with")}</h2>
          {draft.responses.map((response, index) => (
            <ResponseEditor
              key={index}
              value={response}
              onChange={(next) => updateResponse(index, next)}
              onRemove={draft.responses.length > 1 ? () => set("responses", draft.responses.filter((_, i) => i !== index)) : undefined}
              onMove={(by) => moveResponse(index, by)}
              canMoveUp={index > 0}
              canMoveDown={index < draft.responses.length - 1}
              commands={commands}
              showcases={showcases}
              problems={problemsAt(`responses[${index}]`)}
            />
          ))}
          {draft.responses.length < 10 && (
            <div className="flex flex-wrap gap-2">
              <button type="button" className={smallButton} onClick={() => set("responses", [...draft.responses, { type: "text", text: "" }])}>
                + {t("Text")}
              </button>
              {(["image", "video", "audio", "file"] as const).map((mediaType) => (
                <button
                  key={mediaType}
                  type="button"
                  className={smallButton}
                  onClick={() => set("responses", [...draft.responses, { type: "media", mediaType, url: "" }])}
                >
                  + {t(MEDIA_LABEL[mediaType])}
                </button>
              ))}
              <button type="button" className={smallButton} onClick={() => set("responses", [...draft.responses, { type: "cards", cards: [{ title: "" }] }])}>
                + {t("Cards")}
              </button>
              <button type="button" className={smallButton} onClick={() => set("responses", [...draft.responses, { type: "showcase", showcaseId: "" }])}>
                + {t("Showcase")}
              </button>
            </div>
          )}
        </section>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={saving}
            onClick={() => void save()}
            className="rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
          >
            {saving ? t("Saving…") : t("Save command")}
          </button>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={draft.isActive} onChange={(e) => set("isActive", e.target.checked)} />
            {t("Active")}
          </label>
          {error && <p className="text-sm text-error">{error}</p>}
        </div>
      </div>

      <aside className="xl:sticky xl:top-4 xl:self-start">
        <div className="rounded-[2rem] border-4 border-zinc-800 bg-background p-3 shadow-lg">
          <p className="mb-3 text-center text-xs text-muted">{t("Preview")}</p>
          <div className="space-y-3">
            {draft.keywords[0] && (
              <div className="flex justify-end">
                <div className="rounded-2xl rounded-ee-md bg-accent px-4 py-2 text-sm text-white">{draft.keywords[0]}</div>
              </div>
            )}
            {draft.responses.map((r, i) => {
              const message = asSent(r);
              return (
                <div key={i} className="flex justify-start">
                  <div className="max-w-[90%] rounded-2xl rounded-es-md bg-surface px-4 py-2 text-sm text-foreground">
                    {message ? (
                      <MessagePreview message={message} interactive={i === draft.responses.length - 1} describeTarget={describeTarget} />
                    ) : (
                      <span className="text-xs text-muted">{t("Choose a showcase")}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </aside>
    </div>
  );
}

export function isMenuOnly(c: { keywords: string[]; storyScope: string; onStoryMention: boolean }): boolean {
  return c.keywords.length === 0 && c.storyScope === "ALL" && !c.onStoryMention;
}

const MEDIA_LABEL: Record<MediaType, "Image" | "Video" | "Voice" | "File"> = {
  image: "Image",
  video: "Video",
  audio: "Voice",
  file: "File",
};
const MEDIA_ACCEPT: Record<MediaType, string> = {
  image: "image/jpeg,image/png,image/gif",
  video: "video/mp4,video/quicktime",
  audio: "audio/mp4,audio/x-m4a,audio/wav,audio/aac",
  file: "application/pdf",
};

async function uploadFile(file: File): Promise<{ url: string } | { error: string }> {
  const form = new FormData();
  form.append("file", file);
  const response = await fetch("/api/media", { method: "POST", body: form });
  const data = await response.json();
  return response.ok ? { url: data.asset.url } : { error: data.error ?? "Upload failed" };
}

/** A file input whose button speaks the interface language (the browser's own says "Choose File"). */
function FilePicker({ label, accept, disabled, onPick }: { label: string; accept: string; disabled?: boolean; onPick: (file: File | undefined) => void }) {
  return (
    <label className={`${smallButton} inline-block cursor-pointer ${disabled ? "pointer-events-none opacity-50" : ""}`}>
      {label}
      <input
        type="file"
        accept={accept}
        disabled={disabled}
        className="sr-only"
        onChange={(e) => {
          onPick(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
    </label>
  );
}

/** Upload state shared by the media and card editors. */
function useUpload() {
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  async function upload(file: File | undefined, apply: (url: string) => void) {
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    const result = await uploadFile(file);
    setUploading(false);
    if ("url" in result) apply(result.url);
    else setUploadError(result.error);
  }
  return { uploading, uploadError, upload };
}

function ResponseEditor({
  value,
  onChange,
  onRemove,
  onMove,
  canMoveUp,
  canMoveDown,
  commands,
  showcases,
  problems,
}: {
  value: StoredResponse;
  onChange: (next: StoredResponse) => void;
  onRemove?: () => void;
  onMove: (by: -1 | 1) => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  commands: CommandSummary[];
  showcases: ShowcaseSummary[] | null;
  problems: Problem[];
}) {
  const { t } = useI18n();
  const { uploading, uploadError, upload } = useUpload();

  const title =
    value.type === "text"
      ? t("Text")
      : value.type === "cards"
        ? t("Cards")
        : value.type === "showcase"
          ? t("Showcase")
          : t(MEDIA_LABEL[value.mediaType]);

  return (
    <div className={`space-y-3 rounded-xl border bg-surface p-4 ${problems.length ? "border-error/50" : "border-border"}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold">{title}</p>
        <div className="flex gap-1 text-xs">
          <button type="button" disabled={!canMoveUp} onClick={() => onMove(-1)} className="rounded px-2 py-1 text-muted hover:text-foreground disabled:opacity-30" aria-label={t("Move up")}>↑</button>
          <button type="button" disabled={!canMoveDown} onClick={() => onMove(1)} className="rounded px-2 py-1 text-muted hover:text-foreground disabled:opacity-30" aria-label={t("Move down")}>↓</button>
          {onRemove && (
            <button type="button" onClick={onRemove} className="rounded px-2 py-1 text-error">{t("Remove")}</button>
          )}
        </div>
      </div>

      {value.type === "text" && <TextEditor value={value} onChange={onChange} commands={commands} />}

      {value.type === "media" && (
        <div className="space-y-2">
          {value.url && <MessagePreview message={value} />}
          <FilePicker
            label={value.url ? t("Replace file") : t("Choose file")}
            accept={MEDIA_ACCEPT[value.mediaType]}
            disabled={uploading}
            onPick={(file) => void upload(file, (url) => onChange({ ...value, url }))}
          />
          {uploading && <p className="text-xs text-muted">{t("Uploading…")}</p>}
        </div>
      )}

      {value.type === "cards" && (
        <CardsEditor cards={value.cards} commands={commands} onChange={(cards) => onChange({ ...value, cards })} />
      )}

      {value.type === "showcase" && (
        <div className="space-y-2">
          {showcases && showcases.length === 0 ? (
            <p className="text-xs text-muted">
              {t("This account has no showcases yet.")}{" "}
              <Link href="/showcases/new" className="text-accent underline">{t("New showcase")}</Link>
            </p>
          ) : (
            <select className={field} value={value.showcaseId} onChange={(e) => onChange({ type: "showcase", showcaseId: e.target.value })}>
              <option value="">{t("Choose a showcase")}</option>
              {(showcases ?? []).map((sc) => (
                <option key={sc.id} value={sc.id}>{sc.name}</option>
              ))}
            </select>
          )}
          <p className="text-xs text-muted">{t("Sends the showcase as it is when the reply goes out, so editing the showcase updates every reply that shows it.")}</p>
        </div>
      )}

      {uploadError && <p className="text-xs text-error">{t(uploadError as StaticMessageKey)}</p>}
      {problems.map((p, i) => (
        <p key={i} className="text-xs text-error">{t(p.message as StaticMessageKey)}</p>
      ))}
    </div>
  );
}

/** Up to 10 cards with images and buttons; shared by smart replies and showcases. */
export function CardsEditor({
  cards,
  commands,
  onChange,
  problemsFor,
}: {
  cards: Card[];
  commands: CommandSummary[];
  onChange: (cards: Card[]) => void;
  problemsFor?: (index: number) => Problem[];
}) {
  const { t } = useI18n();
  const { uploading, uploadError, upload } = useUpload();
  return (
    <div className="space-y-3">
      {cards.map((card, ci) => (
        <div key={ci} className={`space-y-2 rounded-lg border bg-background p-3 ${problemsFor?.(ci).length ? "border-error/50" : "border-border"}`}>
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold">{t("Card {number}", { number: ci + 1 })}</p>
            {cards.length > 1 && (
              <button type="button" className="text-xs text-error" onClick={() => onChange(cards.filter((_, i) => i !== ci))}>
                {t("Remove")}
              </button>
            )}
          </div>
          <CardEditor
            card={card}
            commands={commands}
            onChange={(next) => onChange(cards.map((c, i) => (i === ci ? next : c)))}
            onUpload={(file, apply) => void upload(file, apply)}
          />
          {problemsFor?.(ci).map((p, i) => (
            <p key={i} className="text-xs text-error">{t(p.message as StaticMessageKey)}</p>
          ))}
        </div>
      ))}
      {uploading && <p className="text-xs text-muted">{t("Uploading…")}</p>}
      {uploadError && <p className="text-xs text-error">{t(uploadError as StaticMessageKey)}</p>}
      {cards.length < 10 && (
        <button type="button" className={smallButton} onClick={() => onChange([...cards, { title: "" }])}>
          + {t("Add card")}
        </button>
      )}
    </div>
  );
}

function TextEditor({
  value,
  onChange,
  commands,
}: {
  value: Extract<OutboundMessage, { type: "text" }>;
  onChange: (next: OutboundMessage) => void;
  commands: CommandSummary[];
}) {
  const { t } = useI18n();
  const mode = value.quickReplies?.length ? "quick" : value.buttons?.length ? "buttons" : "none";
  return (
    <div className="space-y-3">
      <textarea
        className={`${field} min-h-24`}
        value={value.text}
        onChange={(e) => onChange({ ...value, text: e.target.value })}
        placeholder={t("Write a message")}
      />
      <p className="text-xs text-muted">{t("{username} becomes their Instagram username.", { username: "{username}" })}</p>
      <div className="flex flex-wrap gap-2 text-xs">
        {(
          [
            ["none", "No buttons"],
            ["buttons", "Buttons"],
            ["quick", "Quick replies"],
          ] as const
        ).map(([m, label]) => (
          <button
            key={m}
            type="button"
            onClick={() =>
              onChange({
                type: "text",
                text: value.text,
                ...(m === "buttons" ? { buttons: value.buttons?.length ? value.buttons : [{ type: "url", title: "", url: "" }] } : {}),
                ...(m === "quick" ? { quickReplies: value.quickReplies?.length ? value.quickReplies : [{ title: "", payload: "" }] } : {}),
              })
            }
            className={`rounded-full border px-3 py-1 ${mode === m ? "border-accent bg-accent text-white" : "border-border"}`}
          >
            {t(label)}
          </button>
        ))}
      </div>
      {mode === "buttons" && (
        <ButtonList buttons={value.buttons ?? []} commands={commands} onChange={(buttons) => onChange({ ...value, buttons })} />
      )}
      {mode === "quick" && (
        <QuickReplyList replies={value.quickReplies ?? []} commands={commands} onChange={(quickReplies) => onChange({ ...value, quickReplies })} />
      )}
    </div>
  );
}

function CommandSelect({ value, commands, onChange }: { value: string; commands: CommandSummary[]; onChange: (payload: string) => void }) {
  const { t } = useI18n();
  return (
    <select className={field} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{t("Choose the command it opens…")}</option>
      {commands.map((c) => (
        <option key={c.id} value={`cmd:${c.id}`}>{c.name}</option>
      ))}
    </select>
  );
}

function ButtonList({ buttons, commands, onChange }: { buttons: MessageButton[]; commands: CommandSummary[]; onChange: (b: MessageButton[]) => void }) {
  const { t } = useI18n();
  const update = (i: number, b: MessageButton) => onChange(buttons.map((x, j) => (j === i ? b : x)));
  return (
    <div className="space-y-2">
      {buttons.map((b, i) => (
        <div key={i} className="space-y-2 rounded-lg border border-border bg-background p-2">
          <div className="flex gap-2">
            <input className={field} value={b.title} maxLength={20} placeholder={t("Button label")} onChange={(e) => update(i, { ...b, title: e.target.value })} />
            <select
              className={`${field} w-auto`}
              value={b.type}
              onChange={(e) => update(i, e.target.value === "url" ? { type: "url", title: b.title, url: "" } : { type: "postback", title: b.title, payload: "" })}
            >
              <option value="url">{t("Opens a link")}</option>
              <option value="postback">{t("Runs a command")}</option>
            </select>
            <button type="button" className="text-xs text-error" onClick={() => onChange(buttons.filter((_, j) => j !== i))}>✕</button>
          </div>
          {b.type === "url" ? (
            <input className={field} dir="ltr" value={b.url} placeholder="https://" onChange={(e) => update(i, { ...b, url: e.target.value })} />
          ) : (
            <CommandSelect value={b.payload} commands={commands} onChange={(payload) => update(i, { ...b, payload })} />
          )}
        </div>
      ))}
      {buttons.length < 3 && (
        <button type="button" className={smallButton} onClick={() => onChange([...buttons, { type: "url", title: "", url: "" }])}>
          + {t("Add button")}
        </button>
      )}
    </div>
  );
}

function QuickReplyList({ replies, commands, onChange }: { replies: QuickReply[]; commands: CommandSummary[]; onChange: (r: QuickReply[]) => void }) {
  const { t } = useI18n();
  const update = (i: number, r: QuickReply) => onChange(replies.map((x, j) => (j === i ? r : x)));
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted">{t("Each quick reply opens one of your commands, so you can build menus.")}</p>
      {replies.map((r, i) => (
        <div key={i} className="flex flex-wrap gap-2 rounded-lg border border-border bg-background p-2 sm:flex-nowrap">
          <input className={field} value={r.title} maxLength={20} placeholder={t("Label")} onChange={(e) => update(i, { ...r, title: e.target.value })} />
          <CommandSelect value={r.payload} commands={commands} onChange={(payload) => update(i, { ...r, payload })} />
          <button type="button" className="text-xs text-error" onClick={() => onChange(replies.filter((_, j) => j !== i))}>✕</button>
        </div>
      ))}
      {replies.length < 13 && (
        <button type="button" className={smallButton} onClick={() => onChange([...replies, { title: "", payload: "" }])}>
          + {t("Add quick reply")}
        </button>
      )}
    </div>
  );
}

function CardEditor({
  card,
  commands,
  onChange,
  onUpload,
}: {
  card: Card;
  commands: CommandSummary[];
  onChange: (c: Card) => void;
  onUpload: (file: File | undefined, apply: (url: string) => void) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="space-y-2">
      <input className={field} value={card.title} maxLength={80} placeholder={t("Title")} onChange={(e) => onChange({ ...card, title: e.target.value })} />
      <input
        className={field}
        value={card.subtitle ?? ""}
        maxLength={80}
        placeholder={t("Description (optional)")}
        onChange={(e) => onChange({ ...card, subtitle: e.target.value || undefined })}
      />
      <div className="flex items-center gap-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {card.imageUrl && <img src={card.imageUrl} alt="" className="h-12 w-12 rounded object-cover" />}
        <FilePicker
          label={card.imageUrl ? t("Replace photo") : t("Choose photo")}
          accept="image/jpeg,image/png"
          onPick={(file) => onUpload(file, (url) => onChange({ ...card, imageUrl: url }))}
        />
      </div>
      <ButtonList buttons={card.buttons ?? []} commands={commands} onChange={(buttons) => onChange({ ...card, buttons: buttons.length ? buttons : undefined })} />
    </div>
  );
}
