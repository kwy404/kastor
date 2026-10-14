// Writes the SVG art in assets/ and the copies the docs site serves.
// Everything is drawn in code (scripts/site/art) so the files stay in sync.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { mascot, mascotHead } from './art/mascot.mjs';
import { favicon, logoFile } from './art/brand.mjs';
import { banner } from './art/banner.mjs';
import { DATABASES, FEATURE_ICONS, RUNTIMES, dbIconSvg, featureIconSvg, runtimeSymbol } from './art/icons.mjs';
import { illustrationFile } from './art/illustrations.mjs';

export const ICON_THEMES = {
  light: { ink: '#171717', accent: '#d4622b', text: '#171717' },
  dark: { ink: '#ededed', accent: '#ffb547', text: '#ededed' },
};

/** Writes every SVG asset under `root` and returns the list of written paths. */
export function writeAssets(root) {
  const written = [];
  const put = (rel, text) => {
    const file = join(root, rel);
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, `${text.trim()}\n`);
    written.push(rel);
  };
  put('assets/mascot.svg', mascot());
  put('assets/mascot-dark.svg', mascot({ dark: true }));
  put('assets/mascot-head.svg', mascotHead());
  put('assets/mascot-head-dark.svg', mascotHead({ dark: true }));
  put('assets/favicon.svg', favicon());
  put('assets/logo.svg', logoFile('light'));
  put('assets/logo-dark.svg', logoFile('dark'));
  put('assets/banner.svg', banner('light'));
  put('assets/banner-dark.svg', banner('dark'));
  for (const [mode, theme] of Object.entries(ICON_THEMES)) {
    for (const name of Object.keys(FEATURE_ICONS)) put(`assets/icons/${mode}/${name}.svg`, featureIconSvg(name, theme));
    for (const db of DATABASES) put(`assets/icons/${mode}/db-${db.id}.svg`, dbIconSvg(db, theme));
    for (const rt of RUNTIMES) put(`assets/icons/${mode}/rt-${rt.id}.svg`, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="48" height="48" role="img" aria-label="${rt.name}">${runtimeSymbol(rt, theme.ink)}</svg>`);
    for (const kind of ['guide', 'migrate', 'frameworks', 'reference', 'hub']) put(`assets/illustrations/${mode}/${kind}.svg`, illustrationFile(kind, mode));
  }
  // The site serves its own copies so it works without the repo around it.
  for (const f of ['mascot.svg', 'mascot-dark.svg', 'mascot-head.svg', 'mascot-head-dark.svg', 'banner.svg', 'banner-dark.svg']) {
    put(`docs/assets/${f}`, f.startsWith('banner') ? banner(f.includes('dark') ? 'dark' : 'light') : f.startsWith('mascot-head') ? mascotHead({ dark: f.includes('dark') }) : mascot({ dark: f.includes('dark') }));
  }
  put('docs/favicon.svg', favicon());
  return written;
}
