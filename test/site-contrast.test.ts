// Color contrast of the built docs site. The full audit opens every page in
// a headless Chromium and measures every button, tab, chip and card in light
// and dark, at rest and in the hover, focus, focus-visible and active states
// (scripts/site/contrast.mjs). It takes a few minutes and needs a browser and
// the CDN stylesheets, so it runs on request:
//   KASTOR_CONTRAST=1 npx vitest run test/site-contrast
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const css = readFileSync(join(root, 'scripts', 'site', 'static', 'site.css'), 'utf8');

describe('site contrast rules', () => {
  it('keeps prose link colors off buttons, so a button in a guide callout keeps its own text color', () => {
    const prose = /^\.k-prose a([^{]*)\{[^}]*color:/m.exec(css);
    expect(prose, 'the .k-prose link rule').toBeTruthy();
    expect(prose![1]).toContain(':not(.btn)');
    expect(css).toMatch(/\.k-prose[^{]*\) a\.btn \{ color: var\(--btn-fg\)/);
  });
});

const run = process.env.KASTOR_CONTRAST === '1';
describe.skipIf(!run)('site contrast audit', () => {
  it('gives every interactive element 4.5:1 text contrast in both themes and every state', async () => {
    const mod = (await import(pathToFileURL(join(root, 'scripts', 'site', 'contrast.mjs')).href)) as {
      auditContrast: (o: { docs: string }) => Promise<{ pages: number; checked: number; failures: { page: string; theme: string; state: string; label: string; ratio: number; fg: string; bg: string }[] }>;
      findBrowser: () => string | null;
    };
    if (!mod.findBrowser()) throw new Error('KASTOR_CONTRAST=1 needs Edge or Chrome (or KASTOR_BROWSER)');
    const res = await mod.auditContrast({ docs: join(root, 'docs') });
    expect(res.pages).toBeGreaterThan(40);
    expect(res.checked).toBeGreaterThan(500);
    expect(res.failures.map((f) => `${f.ratio} ${f.theme} ${f.state} ${f.page} "${f.label}" ${f.fg} on ${f.bg}`)).toEqual([]);
  }, 900_000);
});
