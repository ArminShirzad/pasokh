# Security policy

Pasokh stores Instagram and Zernio credentials, webhook payloads, DMs and the
people who sent them. Please report security problems privately.

## Reporting a vulnerability

Use GitHub's private reporting: **Security → Report a vulnerability** on this
repository. Do not open a public issue for a vulnerability.

Include what an attacker can do, the steps to reproduce, and the version
(image tag or commit). You will get an answer within a week.

## Supported versions

Fixes go into the latest release. Update with:

```bash
cd ~/pasokh && docker compose pull && docker compose up -d
```

## What the project already does

- Instagram and Zernio keys are encrypted at rest with `ENCRYPTION_KEY`.
- Meta and Zernio webhooks are verified by signature before they are processed.
- Passwords are hashed with scrypt; failed sign-ins are rate-limited per email
  and per address.
- There is no sign-up: accounts are created only by first-run setup and
  invitations.

## What you are responsible for

- Keep `.env` private and backed up; anyone with it can decrypt stored keys.
- Keep the server updated, and expose only the ports your mode needs (none
  for tunnels; 80 and 443 for the domain mode).
- Rotate a key that was pasted somewhere it could be logged, including a chat
  with an AI assistant.
