# Pasokh user guide

For people who have installed Pasokh and want to use it. To install, see the
[README](../README.md). This guide also exists [in Persian](guide.fa.md).

## First: the test lab

The **Test lab** has a pretend Instagram account and a pretend follower.
Try everything there first: comment, send DMs, tap buttons, follow. It
refuses what Instagram refuses (buttons in a private reply to a
non-follower, messages after 24 hours), so what works there should work on
Instagram. Nothing is sent to Instagram.

## Two Instagram rules that shape everything

- **The 24-hour window:** you can message someone only within 24 hours of
  their last message. Pasokh's follow-ups never send outside it.
- **One private reply per comment, and no buttons for non-followers:**
  since late August 2026 Instagram refuses buttons and cards in a private
  reply to someone who does not follow you, and the refusal uses up the
  reply. So comment replies are always text, and the rich part (buttons,
  cards, menus) continues in the DM once they answer.

## Campaigns (comment → DM)

On one post, every post, the next reel, or your live videos (Meta
connection only); for keywords or any comment. A campaign can:

- reply publicly under the comment (at least three wordings, never the same
  one twice in a row);
- send a link, ask them to follow first, or hand off to a **smart reply** so
  cards and menus arrive in the DM;
- also answer when someone DMs the same word.

## Smart reply

Automatic answers to DMs, story replies and story mentions. Keywords can
match "exactly this" or "a message containing this"; Arabic or Persian
keyboard letters, Persian digits and emoji do not matter. An answer can be
up to 10 messages: text, image, video, voice, file, cards or a showcase.

**Menus:** a button or quick reply can open another smart reply. One with no
keywords is "menu only".

After answering, a smart reply can start a **sequence** or a **form**.

## Showcase

A product carousel: photo, title, description and up to three buttons per
product, up to ten products. Build it once and add it to any smart reply;
editing it updates every reply that shows it.

## Welcome message

Up to four questions Instagram shows on a new chat, each opening a smart
reply. "Save and send to Instagram" pushes them. With your own Meta app,
also subscribe the webhook to `messaging_postbacks`.

## Smart support (sequences)

Follow-up messages minutes, hours or days after a smart reply. With "stop
when they reply" on, the first answer from them ends it. A step 24 hours or
more after the start is flagged, because Instagram would refuse it.

## Forms

Questions asked one at a time in the DM: text, phone, email, number or a
choice. While a form is open, their messages are its answers. Phone numbers
are accepted in Persian or English digits and any common form (09…, +98…)
and stored one way. Results have a one-row-per-person filter and a CSV
download that Excel opens with Persian intact.

## Contacts

Everyone who messaged or commented. Phones and emails come from forms or
your edits; tags group people. Search, filters and CSV export.

## AI assistant

Answers the DMs that no form, smart reply or campaign answered. Add your own
API key for Anthropic (Claude) or any OpenAI-compatible service (including
Iranian gateways), describe who it speaks for, and fill in the knowledge
base. It does not invent prices or facts that are not in the knowledge base.
Ask it something with "Try it" before switching it on. A daily cap per
person limits cost.

## SMS

Connect your Kavenegar, sms.ir or Melipayamak panel (or test mode, which
sends nothing). Send a test SMS to your own number first. A send goes to all
contacts with a phone, or one tag, and each number gets one SMS. Only message
people who agreed to it.

## Templates and reports

**Templates** creates ready-made setups (menu, price list, sign-up,
follow-up, giveaway), all **paused**: change the wording to yours and switch
them on. **Reports** shows what each part did over the last 30 days.

## When something does not work

- **Diagnostics** shows the database, Redis, queue and worker.
- **DM logs** give the reason for every campaign send, skip and failure.
- A message recorded as "unclear" is deliberately not sent again: it may
  have arrived. Check the Instagram inbox first.
