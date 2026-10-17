# Contributing

Thanks for taking a look. This is a small, dependency-free project; keep changes focused.

## Development

```bash
git clone <repo-url>
cd weight-butler
npm start        # http://127.0.0.1:8787
npm test
```

There is no build step. Edit files under `app/public/` and refresh the page.

## Ground rules

- **No personal data in commits.** `data/` in this repo is synthetic demo data. If you test with real records, keep them in a private branch or outside the repo.
- **No new runtime dependencies** unless there is a strong reason. The server intentionally uses only Node built-ins.
- **Statistics need an explanation.** If you change a model, update `docs/algorithms.md` and add a unit test for the property you rely on.
- **Keep the UI local-first.** No telemetry, no external fonts, no CDN scripts, no analytics.
- **Don't expose the server.** It binds to `127.0.0.1` on purpose and has no authentication.

## Pull requests

- Describe the problem and the observed behavior, not just the patch.
- Include before/after numbers for statistical changes.
- Run `npm test`.
- If you change `data/` schema, update `docs/data-format.md` and the seed script.

## Regenerating demo data

```bash
npm run seed
```

This overwrites `data/`. The generator uses a fixed random seed, so the diff should be reproducible.
