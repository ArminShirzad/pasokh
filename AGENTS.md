<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Pasokh project notes

Pasokh is a Persian/English, self-hosted Instagram DM and comment automation
platform (fork of OpenReply). Plan of record: `docs/ROADMAP.md`. Running and
testing locally: `docs/DEVELOPMENT.md`.

- **Two providers, one event stream.** Zernio events are normalised into Meta's
  webhook shape (`lib/zernio/normalize-event.ts`) and go through
  `lib/queue/process-webhook.ts`; sends branch per provider in
  `lib/instagram/send-messages.ts`. A new capability is built for both unless
  one cannot do it (live comments: Meta only).
- **Delivery guarantees are the product.** One private reply per comment;
  never auto-resend an ambiguous send (`dmDeliveryUnconfirmed`); durable claims
  (`PostbackDelivery`, `ConversationSession`) dedupe redelivered events. Read
  the comments in `lib/queue/dm-worker.ts` before changing a send path.
- **Comment replies are text-first** for anyone not confirmed as a follower
  (Instagram refuses buttons to non-followers since 2026-08 and the refusal
  burns the reply); the rich part continues when they answer.
- **i18n:** English strings are keys, `lib/i18n/fa.json` is Persian, `t()` is
  typed so a missing entry fails typecheck. Logical Tailwind classes only.
- **Public URL:** `getBaseUrl()` (`PASOKH_PUBLIC_URL` → `NEXTAUTH_URL`); in
  quick-tunnel mode the entrypoint sets `PASOKH_PUBLIC_URL` and unsets
  `NEXTAUTH_URL` so sign-in follows the host in use.
- Commit subjects state the finding; tests are named after the failure they
  prevent; scripted edits on Windows must keep LF (`newline=''`).
