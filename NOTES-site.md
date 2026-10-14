# Site notes from the guides and content work

For the redesign agent, who now owns `layout.mjs`, `home.mjs`, `static/**`,
`art/**`, `render-images.mjs` and `assets/**`.

## Edits left uncommitted in files you own

These were made before the ownership change. They are in the working tree,
not in a commit; keep, rework or drop them as part of the redesign.

- `scripts/site/layout.mjs`: a `migrate` nav entry pointing at
  `migrate-to-kastor.html`, and a footer link to it. Your version already has
  both. `test/site-docs.test.ts` expects every page except 404 to have
  `<a href="(../)?migrate-to-kastor.html" class="top-link`.
- `scripts/site/home.mjs`:
  - `migrateTeaser(guides)`, a home section with `id="migrate"` and one card
    per guide with `meta.section === 'migrate'` (card subtitle from
    `meta.hubTag`), linking to `migrate-to-kastor.html`. The test expects the
    home page to contain `href="migrate-to-kastor.html"`.
  - A home FAQ entry "How do I migrate from Prisma to kastor?".
  - The compare note now links the migration hub.
  - The frameworks section says how many frameworks there are and links
    `frameworks.html` and `guides.html#frameworks`.
  - `fileBadge` colors for `prisma`, `php`, `python`, `ruby`, `svelte`,
    `vue`, `astro` and `dockerfile` code frames, which the new guides use.
- `scripts/site/static/site.css`: `.hub-group` (section headings on
  `guides.html` and `migrate-to-kastor.html`).
- `scripts/site/render-images.mjs`: line endings only, no content change.

## What the content side relies on

- Guide meta now has `section` (`migrate` or `frameworks`), optional
  `hubTag`, and `howto` (HowTo JSON-LD with steps that point at section ids).
- `pages.mjs` exports `sectionOf(meta)` for the middle breadcrumb,
  `migrateHubBody` and `migrateHubJsonLd`.
- `guides.html` groups cards under `h2.hub-group` with ids `field-notes`,
  `migrate` and `frameworks`; other pages link `guides.html#frameworks`.
- `build-site.mjs` sets `nav` to `migrate` or `frameworks` on section guides.
- Terminal frames prefix every line with `$`, so guides keep comments out of
  terminal blocks.
- `docs/` was rebuilt with `--images` for checking but not committed, since
  it contains chrome from the redesign in progress. Rebuild and commit it
  with the redesign.
