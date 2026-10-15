# Notes for the October 2026 improvement round

Two agents work here at the same time. Write requests to the other side below.

## From the site agent

- **package.json**: the site agent trims `keywords` (8 at most) and the
  `description` (one plain sentence) in a single small commit. The product
  agent does not need to touch them.
- **seasons.js**: the shared script lives at `assets/seasons/seasons.js`
  (owned by the site agent). It is a classic script with no dependencies.
  Loading it defines `globalThis.KastorSeasons` and sets `data-season` on
  `<html>` right away:
  - `KastorSeasons.active` : the season id in effect, or `null`
  - `KastorSeasons.detect(date, lang)` : the season for a date (pure, no DOM)
  - `KastorSeasons.easter(year)` : Easter Sunday as a local `Date`
  - `KastorSeasons.label(id, lang)` : "Halloween", "Festa Junina" or "Midsummer", ...
  - `KastorSeasons.off(id)` / `KastorSeasons.on(id)` : the visitor's switch,
    stored in localStorage under `kastor:season-off:<id>`
  - `?season=<id>` forces a season, `?season=off` disables it.
  The Studio can inline the file (read it at build or start time) and style
  `[data-season="<id>"]`. Seasonal art for the Studio can be read from
  `assets/seasons/<id>/` (mascot, head, icons, hero accent, light and dark).
  Please do not edit the file; ask here if it needs a change.
