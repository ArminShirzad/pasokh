# Developing Pasokh

For installing Pasokh on a server, see the README. This page is for working on
the code.

## Run it locally

```bash
docker compose -f docker-compose.dev.yml up -d   # Postgres 55432, Redis 56379, Mailpit 58025
cp .env.example .env                              # then fill the secrets (see below)
npm ci
npx prisma migrate deploy
npm run dev                                       # web app
npm run worker                                    # second terminal: sends the DMs
```

`.env` for local development:

```
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=<openssl rand -hex 32>
CRON_SECRET=<openssl rand -hex 32>
ENCRYPTION_KEY=<openssl rand -hex 32>
DATABASE_URL=postgresql://postgres:postgres@localhost:55432/pasokh
REDIS_URL=redis://localhost:56379
EMAIL_SERVER=smtp://localhost:58125     # optional; magic links land in Mailpit
DEFAULT_LOCALE=fa
```

If port 3000 is taken, run `npx next dev -p 3005` and set `NEXTAUTH_URL` to
match, either in `.env` or inline (`NEXTAUTH_URL=http://localhost:3005 npx next dev -p 3005`).
Auth.js builds post-sign-in redirects from `NEXTAUTH_URL`, so a mismatch sends
you to whatever else is listening on that port.

The first visit opens `/setup`, which creates the owner account. The local test
account used during development is `dev@pasokh.local` / `pasokh-dev-1234`
(dev database only). Reset any password with:

```bash
npm run user:password -- dev@pasokh.local            # prints a random new one
npm run user:password -- dev@pasokh.local 'new pass'
```

## Tests

```bash
npm test                     # unit tests; database suites are skipped
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:55432/pasokh npm test
```

Database suites (`*.db.test.ts`) build the schema from `prisma/migrations` in a
throwaway Postgres schema and drop it afterwards.

Name a test after the failure it prevents. A race or ordering test only counts
if it fails with the fix removed; check that once before committing.

## Translations

English strings in the code are the keys; `lib/i18n/fa.json` maps each to
Persian. `t()` is typed against that file, so a new string fails `npm run
typecheck` until it has a Persian entry. Use logical Tailwind classes (`ms-`,
`me-`, `ps-`, `pe-`, `text-start`, `start-0`, `border-e`) so the layout mirrors
in RTL.

## Windows notes

- Keep files LF (`.gitattributes` enforces it). Scripted edits in Python need
  `newline=''`.
- `npm uninstall` on Windows can drop other platforms' optional packages from
  `package-lock.json`; check the lockfile diff and `npm ci --dry-run`.
- Some ports in the 49000–51700 range are reserved by Hyper-V
  (`netsh interface ipv4 show excludedportrange protocol=tcp`).
