<div align="center">

# Pasokh · پاسخ

**Open-source Instagram DM and comment automation you run on your own server.**
Persian and English, right-to-left ready, one-command install.

[فارسی](README.fa.md) · [Roadmap](docs/ROADMAP.md) · [Development](docs/DEVELOPMENT.md)

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-black.svg)](LICENSE)

</div>

Someone comments `LINK` under your reel; Pasokh sends them a DM with your link,
optionally asks them to follow first, and replies publicly under the comment.
The same keywords can fire from a DM or a story reply. It is the kind of tool
Iranian businesses pay monthly for (Directam and similar), as free software you
host yourself.

Pasokh connects to Instagram through **Zernio** (easiest: no Meta app review,
free for your first two accounts) or through **your own Meta app**. It uses the
official APIs only: no scraping, no browser automation, never your Instagram
password.

## What it does today

- **Comment → DM**: keywords per post, any post, the next reel you publish,
  or your live videos (Meta connection); whole-word or partial match; Persian
  and English text.
- **Public reply** under the comment, from at least three wordings, never the
  same one twice in a row.
- **Follow gate**: the link is sent only after they follow.
- **Smart reply**: DM and story-reply keywords (exact or contained), replies to
  one specific story, story mentions; answers of text, image, video, voice,
  file, or product cards, with buttons and quick-reply menus that open other
  replies; a heart on their message. A comment campaign can hand off to one.
- **Showcase**: product carousels (photo, title, description, buttons) kept in
  one place; every smart reply that shows one sends its current version.
- **Welcome message**: up to four questions Instagram shows on a new chat,
  each answered by a smart reply; sent to Instagram from the dashboard.
- **Smart support**: follow-up messages minutes, hours or days after a smart
  reply, stopping when the person answers; the builder warns about any step
  Instagram's 24-hour window would refuse.
- **Form builder**: questions asked one at a time in the DM (text, phone,
  email, number, choice buttons) with a cancel word; phone numbers in Persian
  or English digits; results with a one-row-per-person filter and CSV that
  Excel opens with Persian intact.
- **Contacts**: everyone who messaged or commented, with phone, email and
  tags; search, filter and CSV export.
- **Test lab**: try every flow with a pretend follower, no Instagram needed;
  it refuses what Instagram refuses.
- **Tracked links** with click counts per campaign, up to three per DM.
- **Inbox**: read and answer Instagram DMs from the dashboard.
- **DM logs** with a reason for every send, skip and failure.
- **Team**: several Instagram accounts, workspace members and roles.
- **Persian interface** with a Jalali calendar, or English; each person picks.

Coming next (see the [roadmap](docs/ROADMAP.md)): AI replies; SMS.

## Install

You need a server **outside Iran** (Instagram and Zernio are not reachable
from inside the country) with 1 GB of RAM or more (2 GB is comfortable; an
idle Pasokh uses about 500 MB, measured 2026-10-02) and Docker. The installer
installs Docker on Linux if it is missing.

**Linux or macOS server**

```bash
curl -fsSL https://raw.githubusercontent.com/ArminShirzad/pasokh/main/install.sh | bash
```

**Windows (Docker Desktop), for trying it out**

```powershell
irm https://raw.githubusercontent.com/ArminShirzad/pasokh/main/install.ps1 | iex
```

The installer asks for the language and how the server is reached:

| Choice | When to use it |
|---|---|
| Cloudflare quick tunnel | Trying Pasokh. No domain needed. The address changes when the tunnel restarts; Pasokh notices and re-points its Zernio webhook by itself. |
| Your own domain | Production. Point a DNS A record at the server and open ports 80 and 443; HTTPS certificates are automatic (Caddy). |
| Cloudflare named tunnel | Production without open ports. Create a tunnel in Cloudflare, route a hostname to `http://web:3000`, paste the token. |
| This computer only | Looking at the interface. Instagram cannot reach it. |

When it finishes it prints the address. Open it, create the owner account,
then:

1. **Settings → Zernio**: paste a Zernio API key (unrestricted, read-write,
   with Inbox access), pick a profile, import your Instagram account.
2. **Campaigns → New campaign**: keyword, the DM, optional link and follow gate.
3. Comment the keyword from a different Instagram account to test.

## Running it

```bash
cd ~/pasokh
docker compose ps                                   # what is running
docker compose logs -f web worker                   # watch it work
docker compose pull && docker compose up -d         # update
docker compose exec web npm run user:password -- you@example.com   # reset a password
```

**Back up** `~/pasokh/.env` (it holds the key that decrypts your saved
connections) and the database:

```bash
docker compose exec -T postgres pg_dump -U pasokh pasokh > pasokh-$(date +%F).sql
```

## How it works

```
Instagram ──▶ Zernio or Meta webhook ──▶ web (Next.js) ──▶ Redis queue ──▶ worker ──▶ Zernio or Meta API ──▶ DM
                                              │                                │
                                          PostgreSQL ◀─────────────────────────┘
```

The web app receives events and serves the dashboard; a separate worker sends
messages so that rate limits (750 private replies an hour per account),
retries and Instagram's quirks never block the page. Sends are idempotent:
an ambiguous API response is never retried into a duplicate DM.

## Instagram's rules still apply

- One private reply per comment, within 7 days of it.
- Since late August 2026 Instagram refuses buttons and cards in a comment
  reply to someone who does not follow you. Pasokh answers those people in
  plain text and continues with buttons once they reply.
- Messages outside 24 hours of the person's last message are refused.
- Follow status is only known for people who have messaged you.

## Using your own Meta app instead of Zernio

Possible and supported side by side with Zernio; it needs a Meta developer
app, business verification and app review. See [docs/setup.md](docs/setup.md).
Live-video comments need this route: Zernio does not forward them.

## Credits and license

Pasokh is a fork of [OpenReply](https://github.com/diwenne/openreply) by Diwen
Huang (itself built on
[instagram-comment-to-dm](https://github.com/im-anishraj/instagram-comment-to-dm)
by Anish Raj), whose delivery engine it keeps. Their code remains under the MIT
license ([LICENSE-OPENREPLY-MIT](LICENSE-OPENREPLY-MIT)); Pasokh's changes are
[AGPL-3.0](LICENSE): you may use, modify and host it, and if you offer a
modified version as a service, you must publish your changes.

Pasokh is not affiliated with Instagram, Meta, Zernio or Directam.
