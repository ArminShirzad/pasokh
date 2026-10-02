# Pasokh (پاسخ) roadmap

Pasokh is a self-hosted, open-source Instagram DM and comment automation
platform, Persian and English, with the feature set of paid Iranian services
such as Directam. It is a hard fork of [OpenReply](https://github.com/diwenne/openreply)
(MIT), relicensed as AGPL-3.0 for new work.

This file is the plan of record. Each phase ends in a release that someone can
install and use; nothing is "done" until it works through the installer on a
clean machine.

## Feature target

Measured against Directam's dashboard and app bundles on 2026-10-02 (read-only
review of a live account).

| Area | Directam feature | Pasokh phase |
|---|---|---|
| Smart reply (پاسخ هوشمند) | DM keyword triggers (exact / contains), story-scoped triggers, auto-like the trigger, responses of text / voice / image / video / cards, quick-reply buttons that chain into other commands | P2 |
| Comment & live (کامنت و لایو هوشمند) | Per-post or all-post, keyword or any comment, random public-reply variants (min 3, anti-spam), DM with rich responses, follow gate with re-check button, AI reply, live comments → DM | P3 (live: Meta only) |
| Showcase (ویترین‌ساز) | Product carousel in DM: image, title, description, buttons per card | P4 |
| Welcome message (پیام خوش‌آمدگویی) | Up to 4 ice breakers on a first DM, each linked to a reply | P4 |
| Smart support (پشتیبان هوشمند) | Drip: after a trigger, N messages with minute / hour delays | P5 |
| Form builder (فرم‌ساز) | Conversational form: ordered questions, optional choices, cancel word, completion / cancel messages, results with duplicate filter, Excel export | P6 |
| AI | Persona, tone (4 levels), knowledge base; comment and DM replies | P7 |
| Smart SMS (پیامک هوشمند) | Phone capture, contact list import / export, bulk SMS | P8 |
| Already in OpenReply | Inbox, tracked links + click stats, DM logs, workspaces and roles, follower history | kept |

## Provider support

Both providers sit behind one interface (`lib/instagram/*`). Zernio events are
normalised into Meta's webhook shape (`lib/zernio/normalize-event.ts`), so the
engine sees one event stream. Every new capability ships for both, except where
a provider cannot do it.

| Capability | Zernio | Meta (own app) |
|---|---|---|
| Text, buttons (≤3), quick replies (≤13) | yes | yes |
| Image / video / audio / file | `attachmentUrl` + `attachmentType` | `attachment.type` |
| Cards / carousel (≤10) | `template.generic` | generic template |
| Story reply / story mention events | `metadata.storyReply`, `isStoryMention` | `reply_to.story`, `story_mention` attachment |
| React to a message | `/reactions` (any emoji) | `sender_action: react` (heart) |
| Ice breakers | `/instagram-ice-breakers` | `messenger_profile.ice_breakers` |
| Active stories list | `/instagram/stories` | `/{ig-id}/stories` |
| Live-video comments | **no** | `live_comments` webhook field |
| Follow status | consent-gated, often unknown | consent-gated, often unknown |

Zernio is the default for beginners (no Meta app review). Meta is for people who
need live comments or want no per-account fee.

### Platform constraint that shapes the design

Since late August 2026 Instagram refuses buttons, cards and attachments in a
comment private reply to someone who does not follow the account (Meta code 2,
subcode 1545133), and the refused call still consumes the comment's single
private reply. Source: Zernio's private-reply docs, read 2026-10-02.

So the comment path is always: **plain-text private reply → user answers → full
rich flow in the open DM thread.** OpenReply sends a button in the private
reply today, which this breaks for exactly the people the follow gate targets.
Fixed in P0.

## Architecture changes

### Message engine (P1)

One ordered list of `ResponseBlock`s is the unit everything sends: commands,
campaigns, sequences, forms, ice breakers.

```
ResponseBlock  type TEXT | IMAGE | VIDEO | AUDIO | FILE | CARDS | AI
               text, mediaAssetId, buttons[], quickReplies[], cards[], delayMs
MediaAsset     uploaded file on a local volume, served at /media/<unguessable id>
               (providers fetch attachments by public URL)
Contact        one per (account, IGSID): username, name, phone, tags, firstSeen,
               lastInboundAt (drives the 24-hour window)
ConversationSession  per contact: what the next inbound message means
               (awaiting comment follow-up, form step N, …), expiresAt
```

Inbound DM routing order: active session → quick-reply / postback payload →
story reply / mention → keyword commands → any-DM fallback.

### Commands (P2)

```
Command         name, isActive, likeTrigger, followGate, responses[]
CommandTrigger  type DM_KEYWORD | STORY_REPLY | STORY_MENTION | COMMENT | LIVE_COMMENT
                | QUICK_REPLY | ICE_BREAKER | ANY_DM, keywords[], matchMode, postId?, storyId?
```

Existing campaigns (`Automation`) keep their production-tested delivery code
(one private reply per comment, unconfirmed-delivery handling, follow re-checks)
and gain "then run command X" for the rich part.

### Delivery guarantees kept from OpenReply

Every new send path reuses: idempotency keys, durable claims
(`PostbackDelivery`-style), `dmDeliveryUnconfirmed` (never auto-resend an
ambiguous send), per-account rate limiting (750/hour), and a DM log row per
outcome with a reason.

## Install experience (P0, then kept working every phase)

Target user: has a VPS and has never used Docker.

1. **One command**: `curl -fsSL …/install.sh | bash` (and `install.ps1`). Checks
   Docker, writes `.env` with generated secrets, asks three questions
   (language; public URL mode; admin email), starts the stack, prints the URL.
2. **Prebuilt images** on GHCR (amd64 + arm64) via GitHub Actions. No build on
   the user's machine.
3. **Public URL modes**: quick test tunnel (Cloudflare, URL changes on restart);
   own domain with Caddy and automatic HTTPS; Cloudflare named tunnel token
   (stable, no open ports).
4. **No SMTP needed**: first-run setup page creates the admin with email +
   password. Magic links stay optional.
5. **Migrations run on start**; the Zernio webhook re-registers itself when the
   public URL changes.
6. **Docs in Persian and English**, including the Iran-specific facts: the server
   must be outside Iran to reach Instagram and Zernio; Docker Hub / GHCR mirrors.

## Phases

Each phase lists what "done" means.

### P0 Foundation (release v0.1)
- AGPL-3.0 license, NOTICE crediting OpenReply (MIT), Pasokh branding,
  remove OpenReply's sponsor / SEO marketing pages.
- Persian locale (`fa.json`), RTL layout (`dir="rtl"`, Tailwind logical
  properties), Vazirmatn font, Persian digits, Jalali dates.
- Follow-gate fix: plain-text private reply, continue on the user's answer.
- Password login + first-run setup; installer; GHCR images; Caddy / tunnel modes.
- Done when: clean VPS → installer → Persian UI → Zernio connected → a comment
  from a non-follower gets the text reply, and the link after they answer.
- Status 2026-10-02: built and tested locally (installer end to end in
  quick-tunnel mode on Docker Desktop; 370 tests including database suites).
  Not yet done: publishing the repository and first image (v0.1.0); a run on
  a real Linux VPS; a real Instagram account through Zernio; legal pages and
  campaign templates still carry OpenReply's English copy.

### P1 Message engine
- `ResponseBlock`, `MediaAsset`, `Contact`, `ConversationSession`.
- Provider send API for text / media / cards / buttons / quick replies on
  Zernio and Meta; webhook parsing of quick-reply payloads, story replies,
  story mentions, attachments, reactions.
- **Simulator**: a dev-only page that injects fake comment / DM / tap events, so
  flows can be tested without Instagram (also used by e2e tests).
- Done when: every block type delivers through both providers in the simulator,
  and through Zernio on a real account.
- Status 2026-10-02: built. OutboundMessage (text + buttons / quick replies,
  media, cards) with Instagram's limits, Meta and Zernio request bodies,
  reactions; inbound quick replies, story replies, story mentions,
  attachments; Contact with the 24-hour window; MediaAsset uploads served
  publicly; the test lab (SIMULATOR provider) with Instagram's refusal rules.
  The follow-gate campaign runs end to end in the lab. Not yet verified: any
  of it through Zernio or Meta on a real account. The upload UI arrives with
  the P2 builder. ResponseBlock became OutboundMessage lists, stored by the
  features that use them (P2 onwards).

### P2 Smart reply (commands)
- Command + triggers, exact / contains, story picker, quick-reply chaining,
  auto-like, builder UI with phone preview, search, enable / disable.
- Done when: the city-menu pattern (one command offers buttons, each button
  runs another command) works end to end.
- Status 2026-10-02: built; the city menu runs end to end in the test lab
  (exact match with an Arabic-keyboard spelling, heart, personalised quick
  replies, a tap delivering cards). Commands without keywords are menu items.
  Not yet verified on a real account, including the story picker against
  Meta's and Zernio's story endpoints.

### P3 Comment & live
- Campaign → rich responses via command, any-comment, ≥3 public-reply variants
  enforced when enabled, live comments (Meta provider).
- Status 2026-10-02: built. A campaign can hand off to a smart reply: its
  comment reply is text (a button for confirmed followers), and the answer,
  tap or passed follow gate runs the command in the DM, once per trigger.
  Public replies need three different wordings and never repeat the last one
  (campaigns saved before keep working until edited). `live_comments` webhooks
  reach live campaigns only, with no public reply; Zernio accounts cannot pick
  live. Proven in the test lab, which now has a live video, and in a database
  test that runs the real worker. Not yet verified: Meta's `live_comments`
  delivery and private replies during a real broadcast. Any-comment existed
  already (OpenReply's "any word").

### P4 Showcase and welcome
- Card / carousel builder; ice breakers synced to the account, each mapped to a
  command.
- Status 2026-10-02: built. A showcase is a named carousel of up to 10
  products on one account; smart replies add it as a response and send its
  cards as they are at send time (a deleted showcase fails the run with that
  reason; deleting one still shown is refused). Welcome questions (up to 4,
  80 characters) each open a smart reply; saving pushes them to Meta
  (`messenger_profile`) or Zernio (`instagram-ice-breakers`), keeps the error
  if Instagram refuses, and a tap arrives as an ordinary `cmd:` postback.
  Deleting a smart reply a question opens is refused. Proven in the test
  lab, which shows the questions on an empty chat, and in database tests
  through the real worker. Not yet verified: either provider's ice-breaker
  call against a real account (request bodies follow Meta's docs and
  Zernio's OpenAPI schema, read 2026-10-02).

### P5 Smart support (sequences)
- Trigger → N steps with delays; stops on reply (optional); respects the
  24-hour window and says so in the UI when a step would fall outside it.
- Status 2026-10-02: built. A sequence (up to 10 steps, each a message or
  showcase after a delay of up to 7 days from the previous step) is started
  by a smart reply once its messages are delivered; someone already part-way
  through is not restarted. Each step is a delayed queue job; the step is
  claimed before sending, a rate limit hands it back, and an ambiguous send
  ends the run as UNCONFIRMED rather than retrying. Before sending it stops
  if they replied (when chosen) or if the 24-hour window has closed. Measured
  in the test lab with real BullMQ delays: steps of 1 and 2 minutes arrived
  at 61 s and 181 s (2026-10-02, dev worker on Windows). The concurrent-
  delivery claim is not exercised by a test (sequential redelivery is).
  Campaigns reach a sequence through their smart reply.

### P6 Form builder and contacts
- Conversational forms on `ConversationSession`; results table, duplicate
  filter, CSV / Excel export; contacts page with tags and phone numbers.
- Status 2026-10-02: built, on its own FormSubmission table rather than
  ConversationSession (a form needs its answers and step). A smart reply
  starts a form after its messages; one form at a time per person; an open
  form takes their DMs before keywords, so «قیمت» typed as an answer is an
  answer. Phone (Iranian forms → 09…, Persian digits), email, number and
  choice (button, text on any keyboard, or its number) are checked and asked
  again with a hint; the cancel word stops it; 24 hours unanswered expires it.
  Each answer is claimed by message id, so a redelivered webhook is taken
  once. Phone and email can be saved on the contact. Results: one row per
  person filter, CSV with a UTF-8 byte-order mark (Excel shows Persian) and
  formula-like cells neutralised; no .xlsx (a CSV opens in Excel). Contacts:
  search (Persian digits too), tags, phone, email, edit, CSV export. Run
  end to end in the test lab through the real worker.

### P7 AI replies
- Persona, tone, knowledge base; for comments and DMs. Providers: Anthropic
  (Claude) and any OpenAI-compatible endpoint (covers Iranian gateways).
- Status 2026-10-03: built for DMs. One assistant per account answers a DM
  that no form, smart reply or campaign answered. Its reply is claimed per
  message before the model is called (a redelivered webhook costs no second
  call); a busy provider frees the claim for the job's retry; an Instagram
  rate limit after the answer is written resends the stored answer without a
  new call. The model sees the last 6 exchanges with that person, a system
  prompt stating that customers' messages cannot change the rules, and the
  owner's knowledge base, and is told not to invent prices or facts. Daily
  cap per person; key encrypted at rest and never returned to the browser;
  a "try it" box asks without sending. Not done: comment replies by AI (a
  wrong public answer is visible to everyone and the private reply is used
  once; left for a later decision), and no run against a real model yet.
  Tested with the model endpoint stubbed.

### P8 SMS
- Provider interface; Kavenegar, sms.ir, Melipayamak; bulk send to contacts;
  phone capture via forms.
- Status 2026-10-03: built. One panel per workspace (key encrypted, never
  returned) or a test mode that sends nothing. A send fixes its recipients
  at creation (contacts with a phone, optionally one account or tag), one
  row per distinct number. Batches of 100 go through the worker; each run
  claims rows under its own claim id, so overlapping runs split the rows
  (measured with the old read-then-claim code: 150 numbers, three
  overlapping runs, 200 SMS sent; with the claim id, 150). A refusal about
  the account (credit, key, line) stops the send; an unclear outcome
  (network, 5xx, unreadable answer) marks that batch UNCONFIRMED and stops,
  never resending. Request formats follow each provider's docs (Kavenegar
  REST page, sms.ir v1, Melipayamak console as used by its Node library),
  read 2026-10-03; no real panel tested. Phone capture via forms is P6.

### P9 Polish
- Reports, ideas / templates gallery, docs site, demo video.
- Status 2026-10-03: built. Reports: 30 days of new contacts, campaign
  DMs, smart replies, AI replies, forms completed, sequences started, SMS
  and link clicks, counted by day in the instance's time zone (Asia/Tehran
  by default, REPORT_TIMEZONE to change). Templates: branches menu, price
  carousel, DM sign-up, follow-up, comment giveaway; every object created
  paused, written in the instance language, and checked by the same rules
  as hand-built ones. Docs: a user guide in Persian and English
  (`docs/guide*.md`) rather than a separate site, and a demo video script
  (`docs/demo-script.md`); the video itself is still to be recorded.

## Conventions

- Commit subjects state the finding, not the action.
- Tests are named after the failure they prevent.
- Every measured number carries its date and what it was measured against.
- Feature parity with Directam, never its name, logo, copy, help texts or
  example prompts.
