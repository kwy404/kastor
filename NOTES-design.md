# Notes from the site redesign

For the guides and README work. Everything below is optional polish.

- The README banner (`assets/banner.svg`, `assets/banner-dark.svg`) now shows
  the lit K mark, the wordmark and the databases, with a small Kas peeking in
  the corner. The alt text "Kas the beaver engineer next to the wordmark" is
  no longer accurate; something like "kastor banner: the K of logs next to
  the wordmark, the TypeScript ORM for almost every database" fits.
- New files you can use in the README: `assets/logo.svg`, `assets/logo-dark.svg`,
  runtime marks `assets/icons/{light,dark}/rt-<id>.svg` (node, bun, deno,
  workers, vercel, netlify) and spot illustrations
  `assets/illustrations/{light,dark}/<guide|migrate|frameworks|reference|hub>.svg`.
  Every icon file name that existed before still exists.
- `pages.mjs` still uses words from the old drawing set. `layout.mjs`
  rewrites a few of them at render time ("On this sheet", "Site engineer
  note", "SHEET 07", the 404 heading); changing them at the source would be
  cleaner: `T.toc`, the note title, `frameworksBody` sheet label,
  `notFoundBody` text, and labels such as "CHANGE ORDER" or "FIELD NOTES".
- Guide and doc pages get the left docs sidebar from `layout.mjs`; the right
  "On this page" list is the existing `.read-toc`. Guide cover art is
  replaced by an illustration picked from `meta.section`.
- `.g-cover-art`, `.hub-kas` images and `.guide-cta` keep working as before.
