# Contributing to kastor

Thanks for helping build kastor. Issues and pull requests are welcome.

## Setup

```bash
git clone https://github.com/kwy404/kastor.git
cd kastor
npm install
npm run build
npm test
```

kastor supports Node.js 18 and later. Unit tests need no database.

## Integration tests

Integration tests run the shared conformance suite against real databases from
`docker-compose.yml`. Start the ones you need and set their environment
variables (each suite skips cleanly when its variable is missing):

```bash
docker compose up -d --wait postgres mysql
KASTOR_PG_URL=postgres://kastor:kastor@localhost:54329/kastor \
KASTOR_MYSQL_URL=mysql://root:kastor@localhost:33069/kastor \
npm run test:integration
```

The services and variables for every database are listed in
`docker-compose.yml` and `.github/workflows/ci.yml`.

## Before you open a pull request

- `npm run typecheck`, `npm run lint`, `npm test` and `npm run check:rules` pass.
- New behavior has tests; a new dialect feature runs through the conformance
  suite in `test/helpers/conformance.ts`.
- Error messages say what went wrong in plain English and carry a `hint` with
  the fix.
- Keep the house rules: no emoji and no en or em dash characters in any file.

## Docs site

The site in `docs/` is generated. Edit the sources in `scripts/site/` (guides
live in `scripts/site/guides/`), then rebuild:

```bash
node scripts/build-site.mjs           # pages, art and the playground bundle
node scripts/build-site.mjs --images  # also the PNG social images (needs Edge or Chrome)
```

## Commits

Small, focused commits with a message that says what changed and why. By
contributing you agree that your work is released under the MIT license.
