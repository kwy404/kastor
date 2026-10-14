// Writes the SVG art in assets/ and the copies the docs site serves.
// Everything is drawn in code (scripts/site/art) so the files stay in sync.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { favicon, mascot, mascotHead } from './art/mascot.mjs';
import { DATABASES, FEATURE_ICONS, dbIconSvg, featureIconSvg } from './art/icons.mjs';
import { banner } from './art/scene.mjs';

export const ICON_THEMES = {
  light: { ink: '#13254d', accent: '#ffc21a', blue: '#2a63e6', soft: '#ffe7a3', text: '#13254d' },
  dark: { ink: '#e3ecff', accent: '#ffc21a', blue: '#5b8cff', soft: '#2a5299', text: '#e3ecff' },
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
  put('assets/banner.svg', banner('light'));
  put('assets/banner-dark.svg', banner('dark'));
  for (const [mode, theme] of Object.entries(ICON_THEMES)) {
    for (const name of Object.keys(FEATURE_ICONS)) put(`assets/icons/${mode}/${name}.svg`, featureIconSvg(name, theme));
    for (const db of DATABASES) put(`assets/icons/${mode}/db-${db.id}.svg`, dbIconSvg(db, theme));
  }
  // The site serves its own copies so it works without the repo around it.
  for (const f of ['mascot.svg', 'mascot-dark.svg', 'mascot-head.svg', 'mascot-head-dark.svg', 'banner.svg', 'banner-dark.svg']) {
    put(`docs/assets/${f}`, f.startsWith('banner') ? banner(f.includes('dark') ? 'dark' : 'light') : f.startsWith('mascot-head') ? mascotHead({ dark: f.includes('dark') }) : mascot({ dark: f.includes('dark') }));
  }
  put('docs/favicon.svg', favicon());
  return written;
}
