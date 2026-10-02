# Contributing to Pasokh

Thanks for helping. Bug reports, translations, documentation and code are all
welcome. Persian or English, either is fine in issues and pull requests.

## Before you start

- Check the [roadmap](docs/ROADMAP.md) and open issues; comment on an issue
  before starting something large so work is not duplicated.
- Instagram quirks are worth as much as code: if you hit a Meta or Zernio
  behaviour that is not documented, a pull request that documents it helps
  everyone.

## Working on the code

See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for running Pasokh locally,
tests and translations. Before opening a pull request:

```bash
npm run typecheck && npm run lint && npm test
```

## Conventions

- **Commit subjects state the finding, not the action.** "A 64px slot was
  served a 640px file", not "optimise images".
- **Name tests after the failure they prevent.** A rule that was tried and
  rejected gets a test too, so nobody reinstates it.
- **Every user-facing string goes through `t()`** and needs a Persian entry in
  `lib/i18n/fa.json`; typecheck fails without one.
- **Use logical CSS** (`ms-`, `me-`, `text-start`, `start-0`) so the layout
  mirrors in right-to-left.
- **Never auto-resend an ambiguous send.** If an API call may have delivered a
  DM, mark it unconfirmed rather than retrying it into a duplicate.
- Every measured number carries the date it was measured and what it was
  measured against.

## License

By contributing you agree that your contribution is licensed under the
[AGPL-3.0](LICENSE).
