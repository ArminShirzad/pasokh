# Connect your own Meta app

Most people should connect Instagram through Zernio (Settings → Zernio): no
Meta developer app, no review, free for the first two accounts. This page is
for the other route: your own Meta app, which costs nothing per account and is
the only way to receive live-video comments, but takes an afternoon of Meta
console work.

Install Pasokh first (see the [README](../README.md)) with a **fixed public
address**: your own domain or a Cloudflare named tunnel. A quick tunnel's
address changes on restart, and Meta's webhook callback URL can only be
changed by hand in the Meta console.

When you have the values from the steps below, add them to `~/pasokh/.env`
and restart:

```
INSTAGRAM_APP_ID=...
INSTAGRAM_APP_SECRET=...
FACEBOOK_APP_SECRET=...
WEBHOOK_VERIFY_TOKEN=<any long random string, e.g. openssl rand -hex 16>
```

```bash
cd ~/pasokh && docker compose up -d
```

Then Settings → Connect Instagram.

This is the slow part. The code works out of the box; getting Meta to send you
comment events is where people lose an afternoon. Every step here exists
because skipping it breaks something later.

### Step 1: Create the Meta app

Go to [developers.facebook.com/apps](https://developers.facebook.com/apps) and create an app.

- App type: Business.
- Contact email: one you actually check.

When it asks you to add a use case, filter to All, then choose Manage messaging and content on Instagram. Do not pick "Create and manage ads with Marketing API", and do not pick "Authenticate with Facebook Login". Pasokh uses Instagram Login. Picking the Facebook Login variant makes the OAuth flow fail later with a mismatched client error.

If you accidentally added the Marketing API use case, remove it. It has its own heavy review requirements and can block publishing.

### Step 2: Collect the three secrets

There are two app secrets and two app IDs, which is confusing. Here is what maps to what.

| Environment variable | Where it lives |
| --- | --- |
| `INSTAGRAM_APP_ID` | Instagram, API setup with Instagram login. A number like `2036...` |
| `INSTAGRAM_APP_SECRET` | Same page, click Show |
| `FACEBOOK_APP_SECRET` | App settings, Basic, App secret, click Show |

The Instagram app ID is not the same number as the Facebook App ID shown on the Basic settings page. Use the one under the Instagram product.

Pasokh verifies webhook signatures against both `FACEBOOK_APP_SECRET` and `INSTAGRAM_APP_SECRET`, so you do not have to guess which one Meta signs with. Set both.

### Step 3: Add your Instagram account as a tester, and accept the invite

This is the step people miss, and it produces the error "Insufficient Developer Role" on the Instagram login screen. In development, only accounts that have a role on your app can connect. Even your own account has to be added and accept.

There are two halves. Both are required.

Half one, on the Meta side. In the app dashboard, open App roles, then Roles (in the newer console this is also reachable from the Instagram product under "Generate access tokens"). Find the section for Instagram testers, click add, and enter the exact Instagram username of the account you want to connect. Send the invite.

Half two, on the Instagram side. This is the part that gets skipped. Open Instagram as that account (the phone app is easiest):

1. Go to your profile, then the menu, then Settings and activity.
2. Open Apps and websites (older versions: Website permissions, then Apps and websites).
3. Open Tester invites.
4. Accept the invite from your app.

Until you accept here, the account is not really a tester and the login will keep failing. If you do not see the invite, double-check you sent it to the exact username and that the account is a Business or Creator account.

### Step 4: Register the OAuth redirect

In the Instagram product, open Set up Instagram business login, then Business login settings. In the OAuth redirect URIs field, add exactly, using your Pasokh address:

```
https://pasokh.example.com/api/instagram/callback
```

No trailing slash. If this is missing or wrong, connecting an account fails with a redirect_uri mismatch. You can register more than one, which is useful if you change domains later; keep the old and new both listed.

You do not need the "Embed URL" that Meta shows here. Pasokh builds its own login URL. Users connect by opening your app, going to Settings, and clicking Connect Instagram.

### Step 5: Configure the webhook

Still in the Instagram product, find the Configure webhooks step.

- Callback URL: `https://pasokh.example.com/api/webhook`
- Verify token: the value of `WEBHOOK_VERIFY_TOKEN` from your `.env`
- Click Verify and save. It should succeed immediately, because the app answers Meta's verification challenge. If the button is greyed out, click into the verify-token field and paste the token again; editing the callback URL often clears it.
- Subscribe to the `comments` field, to `messages`, to `messaging_postbacks`, and to `live_comments` if you will use live campaigns.

These fields matter. `comments` carries comment-to-DM, which is what most people come here for. `messages` carries inbound DMs and Story replies, which is what smart replies and a campaign's "also reply when someone DMs these words" toggle run on. Subscribe to `comments` alone and those look enabled but never fire, because the events they need are never delivered. `messaging_postbacks` carries taps on buttons and on welcome questions; without it a button or a welcome question does nothing. `live_comments` carries comments under your live videos, and Meta sends them only while the video is on air; a campaign set to "Comments on my live videos" listens for them.

To test delivery without a real comment, click Test next to `comments`, then click Send to My Server. This is a two-step control. Clicking Test only previews the sample payload; the second button is what actually POSTs it to your endpoint. After sending, a row should appear in your `WebhookEvent` table.

If your primary domain ever changes, update this callback URL to the new domain. A non-primary domain will 307-redirect the POST, and Meta does not reliably follow redirects, so webhooks silently stop.

### Step 6: Publish the app

Real comment webhooks are only delivered when the app is in Live state. In Development mode, only the console Test button delivers events. This is the single most common reason for "I set everything up and nothing happens."

Go to the Publish item in the left sidebar. Set the privacy policy, terms of service, and data deletion URLs first, or it will not let you publish. Pasokh ships these pages at your Pasokh address:

```
https://pasokh.example.com/privacy
https://pasokh.example.com/data-deletion
https://pasokh.example.com/terms
```

Then publish. Depending on your access level, Meta may let you go live for your own tester accounts immediately, or it may require App Review first (see the last section).

### Publishing is not Advanced Access: every account still needs a role on the app

This one costs an afternoon because the symptom points nowhere near the cause.

A published app still holds **Standard Access** to `instagram_business_basic`, `instagram_business_manage_comments`, and `instagram_business_manage_messages`. Standard Access only covers Instagram accounts that have a role on your app — admins, developers, and Instagram testers. Publishing makes the app live; it does not widen who the permissions apply to. Advanced Access, which covers everyone else, comes only from App Review.

So connecting a second account fails even though the first one works, on the same app, with the same code.

The symptom: Instagram's consent screen appears and the login succeeds, the code exchange at `api.instagram.com/oauth/access_token` returns a normal `IGAA…` token with all the requested permissions — and then every single call against `graph.instagram.com` is refused:

```
Unsupported request - method type: get  [code=100, type=IGApiException]
```

`/access_token`, `/refresh_access_token`, `/me` — all of them, identically. Nothing about the message suggests a missing role, and the token itself looks fine.

The fix for your own accounts is the same two-part dance as Step 3, once per account: invite the Instagram username under App roles, Roles, Instagram testers, then accept the invite inside Instagram under Edit profile, Apps and websites, Tester invites. For accounts you do not control, you need App Review — see [META_APP_REVIEW.md](../META_APP_REVIEW.md).

### Moving from Directam, ManyChat or another DM tool: give Pasokh control of conversations

Do this whenever the Instagram account was ever connected to Directam, ManyChat or another comment-to-DM tool, even if you have cancelled it. Skip it and comments look fine, but every DM button tap fails.

The symptom: comments work. The public reply posts and the first DM arrives. But when the commenter taps the DM button, nothing comes back, and DM Logs shows the button tap as failed with:

```
The action is invalid since it's not the thread owner. [code=100 sub=2534037 type=IGApiException]
```

Instagram lets any connected app send the one private reply to a comment, which is why the first DM gets through. Every message after that, including the reply to a button tap, has to come from the app that owns the conversation. If another tool is still connected to the Instagram account, it can stay the owner even after you cancel or turn it off.

Fix it in Meta Business Suite, under Settings, Integrations, Conversation routing:

1. Select the Instagram account and open the Partner apps tab. It lists every app connected to the account's messages. Remove any old DM tool from inside that tool, for example ManyChat's Settings, Instagram, Disconnect channel. These apps often do not appear under Instagram's Apps and websites or Facebook's Business integrations, so Partner apps is the place to check.
2. Click Manage next to your Pasokh app and switch on both Access all conversations and Take control of conversations, then save.

Tap the button again on a fresh comment. The follow-up DM should now send.

### The account ID trap (informational)

You do not have to do anything here; Pasokh handles it. It is worth understanding because it is invisible when it goes wrong.

Meta's `/me` returns two IDs. The `id` field is app-scoped. The `user_id` field is the Instagram professional account ID. Webhooks put `user_id` in `entry.id`, and the messaging API keys off `user_id` too. Pasokh stores `user_id`, so a fresh connection matches correctly. If you upgraded from a very old build and an account was stored with the wrong ID, disconnect and reconnect it once.

## Test it end to end

1. Connect the account in Settings. For Zernio, complete the [provider setup](zernio.md). For direct Meta, make sure the account has accepted its tester invite (Step 3) and the app is published (Step 6).
2. Confirm the account appears in Pasokh and `/api/health` reports a healthy worker.
3. Create a campaign on one of your posts with a keyword like `TEST`.
4. From a different Instagram account, comment `TEST` on that post. It must be a different account, because Pasokh ignores your own comments on purpose.
5. Watch for the DM. If nothing arrives, check the DM Logs page and `/api/health`.

Hit `/api/health` any time. It reports the database, Redis, queue, and worker heartbeat. If `worker.healthy` is false, the worker is not running or cannot reach Redis, and no DM will send even though webhooks are being received.

If you want to inspect where a comment stopped, the Postgres tables tell you: `WebhookEvent` for delivery, `DmLog` for send status and errors, `OperationalEvent` for worker crashes and the polling reconciler's sweep logs.

## Letting other people use your instance

**Direct Meta:** Everything above is enough to run Pasokh for your own accounts, or a handful of accounts you add as testers. No App Review needed.

For a stranger to connect through your own Meta app, Meta requires App Review granting Advanced Access on the messaging and comments permissions. That means:

- A screencast of the full flow working, recorded on real accounts in one take.
- A written justification for each permission. Drafts are in [../META_APP_REVIEW.md](../META_APP_REVIEW.md).
- Business verification, which asks for a document proving a legal business entity: a business registration or license, articles of incorporation, a business tax document, or a business bank statement.

Meta scrutinizes automated-DM apps and often rejects the first submission, so budget for a resubmit. If you do not have a registered business, most self-hosters skip this entirely by running their own instance for their own account, which never needs review.

For Zernio connections, you use its managed connection flow instead of your own Meta app review. Your instance is still self-hosted, and each workspace owner/admin configures its Zernio connection. Platform rules and provider limits still apply.

## Security notes

- `.env` is gitignored. Keep it that way.
- Rotate any secret that has been pasted anywhere it could be logged, including a chat with an AI assistant.
- Instagram tokens are encrypted at rest with `ENCRYPTION_KEY`. Losing or changing it means every connected account has to reconnect.
