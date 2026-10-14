// Checks the built docs site in docs/: links, metadata, structured data,
// sitemap, guides and the markup rules the page runtime depends on.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const docs = join(root, 'docs');
const SITE = 'https://kwy404.github.io/kastor/';

function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const pages = walk(docs)
  .filter((f) => f.endsWith('.html'))
  .map((file) => ({ file, rel: relative(docs, file).replace(/\\/g, '/'), html: readFileSync(file, 'utf8') }));
const byRel = new Map(pages.map((p) => [p.rel, p]));
const guidePages = pages.filter((p) => /page-guide/.test(p.html));

const attr = (html: string, re: RegExp) => [...html.matchAll(re)].map((m) => m[1] as string);
const meta = (html: string, name: string) => (new RegExp(`<meta (?:name|property)="${name}" content="([^"]*)"`).exec(html) || [])[1];
const ids = (html: string) => new Set(attr(html, /\sid="([^"]+)"/g));

/** Maps a link on a page to a file in docs/ (or null for external links). */
function target(page: { rel: string }, href: string): { file: string; hash: string } | null {
  if (/^(https?:|mailto:|data:|javascript:)/.test(href)) {
    if (!href.startsWith(SITE)) return null;
    href = `/kastor/${href.slice(SITE.length)}`;
  }
  const [path = '', hash = ''] = href.split('#');
  let rel: string;
  if (path === '') rel = page.rel;
  else if (path.startsWith('/kastor/')) rel = path.slice('/kastor/'.length);
  else rel = relative(docs, resolve(docs, dirname(page.rel), path)).replace(/\\/g, '/');
  if (rel === '' || rel.endsWith('/')) rel += 'index.html';
  return { file: rel, hash };
}

describe('docs site', () => {
  it('has the home page, the hubs, the reference pages, 404, sitemap and robots', () => {
    for (const f of ['index.html', 'guides.html', 'pt-br/index.html', 'frameworks.html', 'migrate-to-kastor.html', 'api.html', '404.html', 'sitemap.xml', 'robots.txt', 'og.png', 'favicon.svg', 'site.css', 'site.js', 'search.json']) {
      expect(existsSync(join(docs, f)), f).toBe(true);
    }
  });

  it('has 38 English guides and 6 Portuguese guides', () => {
    expect(guidePages.filter((p) => !p.rel.startsWith('pt-br/')).length).toBeGreaterThanOrEqual(38);
    expect(guidePages.filter((p) => p.rel.startsWith('pt-br/')).length).toBeGreaterThanOrEqual(6);
  });

  const MIGRATE = ['prisma', 'drizzle', 'typeorm', 'sequelize', 'knex', 'mongoose', 'laravel-eloquent', 'django-orm', 'rails-active-record'].map((s) => `migrate-from-${s}.html`);
  const FRAMEWORK_GUIDES = ['nextjs-app-router-orm', 'nuxt-orm', 'sveltekit-orm', 'remix-react-router-orm', 'astro-orm', 'nestjs-orm', 'express-orm', 'fastify-orm', 'hono-orm', 'adonisjs-orm', 'bun-orm', 'deno-orm', 'cloudflare-workers-orm', 'electron-sqlite-orm', 'aws-lambda-orm'].map((s) => `${s}.html`);
  const proseWords = (html: string) => {
    const main = /<article class="read-main[^"]*">([\s\S]*?)<\/article>/.exec(html)![1]!;
    return main.replace(/<figure[\s\S]*?<\/figure>/g, ' ').replace(/<[^>]+>/g, ' ').split(/\s+/).filter((w) => /[A-Za-zÀ-ÿ]/.test(w)).length;
  };

  it('has a migration guide of 900+ words for every source ORM, linked from the migrate hub, the nav and the home page', () => {
    const hub = byRel.get('migrate-to-kastor.html')!.html;
    for (const rel of [...MIGRATE, 'pt-br/migrar-do-prisma.html', 'pt-br/migrar-do-laravel-eloquent.html']) {
      const page = byRel.get(rel);
      expect(page, rel).toBeTruthy();
      expect(proseWords(page!.html), rel).toBeGreaterThanOrEqual(900);
      if (!rel.startsWith('pt-br/')) expect(hub, rel).toContain(`href="${rel}"`);
    }
    expect(byRel.get('index.html')!.html).toContain('href="migrate-to-kastor.html"');
    for (const p of pages) if (p.rel !== '404.html') expect(p.html, p.rel).toMatch(/<a href="(\.\.\/)?migrate-to-kastor\.html" class="top-link/);
  });

  it('has a framework guide of 700+ words for every framework, linked from the frameworks page', () => {
    const fw = byRel.get('frameworks.html')!.html;
    for (const rel of FRAMEWORK_GUIDES) {
      const page = byRel.get(rel);
      expect(page, rel).toBeTruthy();
      expect(proseWords(page!.html), rel).toBeGreaterThanOrEqual(700);
      expect(fw, rel).toContain(`href="${rel}"`);
    }
  });

  it('gives migration and framework guides HowTo structured data whose steps point at sections of the page', () => {
    for (const rel of [...MIGRATE, ...FRAMEWORK_GUIDES]) {
      const html = byRel.get(rel)!.html;
      const graph = attr(html, /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g).flatMap((j) => JSON.parse(j)['@graph'] || []);
      const howto = graph.find((n: { '@type': string }) => n['@type'] === 'HowTo');
      expect(howto, rel).toBeTruthy();
      expect(howto.step.length, rel).toBeGreaterThanOrEqual(3);
      for (const step of howto.step) expect(ids(html).has(step.url.split('#')[1]), `${rel} ${step.url}`).toBe(true);
    }
  });

  it('gives every page a title, a description, a canonical URL and an Open Graph image that exists', () => {
    for (const p of pages) {
      expect(/<title>[^<]{10,}<\/title>/.test(p.html), p.rel).toBe(true);
      const description = meta(p.html, 'description') || '';
      expect(description.length, `${p.rel} description`).toBeGreaterThan(50);
      if (p.rel !== '404.html') expect(p.html, p.rel).toContain(`<link rel="canonical" href="${SITE}`);
      const og = meta(p.html, 'og:image') || '';
      expect(og.startsWith(SITE), p.rel).toBe(true);
      expect(existsSync(join(docs, og.slice(SITE.length))), `${p.rel} og image ${og}`).toBe(true);
    }
  });

  it('has no broken internal links or anchors', () => {
    const broken: string[] = [];
    for (const p of pages) {
      for (const href of attr(p.html, /\s(?:href|src)="([^"]+)"/g)) {
        if (href.startsWith(':') || href.includes('${')) continue;
        const t = target(p, href.replace(/&amp;/g, '&'));
        if (!t) continue;
        if (!existsSync(join(docs, t.file))) {
          broken.push(`${p.rel} -> ${href}`);
          continue;
        }
        if (t.hash && t.file.endsWith('.html')) {
          const other = byRel.get(t.file);
          if (other && !ids(other.html).has(decodeURIComponent(t.hash))) broken.push(`${p.rel} -> ${href} (anchor)`);
        }
      }
    }
    expect(broken).toEqual([]);
  });

  it('ships valid JSON-LD: SoftwareApplication with price 0 on the home page, TechArticle, FAQPage and BreadcrumbList on guides', () => {
    const graphOf = (html: string) =>
      attr(html, /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g).flatMap((j) => {
        const data = JSON.parse(j);
        return data['@graph'] || [data];
      });
    const home = graphOf(byRel.get('index.html')!.html);
    const app = home.find((n: { '@type': string }) => n['@type'] === 'SoftwareApplication');
    expect(app.offers.price).toBe('0');
    expect(home.some((n: { '@type': string }) => n['@type'] === 'FAQPage')).toBe(true);
    for (const g of guidePages) {
      const types = graphOf(g.html).map((n: { '@type': string }) => n['@type']);
      expect(types, g.rel).toEqual(expect.arrayContaining(['TechArticle', 'FAQPage', 'BreadcrumbList']));
    }
  });

  it('links each translated guide to its counterpart with reciprocal hreflang alternates', () => {
    const alternates = (html: string) => attr(html, /<link rel="alternate" hreflang="[^"]+" href="([^"]+)">/g);
    const pt = guidePages.filter((p) => p.rel.startsWith('pt-br/'));
    for (const p of pt) {
      const alts = alternates(p.html);
      expect(alts, p.rel).toContain(`${SITE}${p.rel}`);
      const en = alts.find((a) => !a.includes('/pt-br/'))!;
      const enPage = byRel.get(en.slice(SITE.length))!;
      expect(enPage, en).toBeTruthy();
      expect(alternates(enPage.html)).toContain(`${SITE}${p.rel}`);
      expect(p.html).toContain('<html lang="pt-BR">');
    }
  });

  it('writes guides of at least 800 words of prose', () => {
    for (const g of guidePages) {
      const main = /<article class="read-main[^"]*">([\s\S]*?)<\/article>/.exec(g.html)![1]!;
      const prose = main.replace(/<figure[\s\S]*?<\/figure>/g, ' ').replace(/<[^>]+>/g, ' ');
      const words = prose.split(/\s+/).filter((w) => /[A-Za-zÀ-ÿ]/.test(w)).length;
      expect(words, g.rel).toBeGreaterThanOrEqual(800);
    }
  });

  it('lists every indexable page in the sitemap, with language alternates', () => {
    const sitemap = readFileSync(join(docs, 'sitemap.xml'), 'utf8');
    const locs = new Set(attr(sitemap, /<loc>([^<]+)<\/loc>/g));
    for (const p of pages) {
      if (p.rel === '404.html') continue;
      const url = SITE + p.rel.replace(/(^|\/)index\.html$/, '$1');
      expect(locs.has(url), url).toBe(true);
    }
    expect(sitemap).toContain('xhtml:link rel="alternate" hreflang="pt-BR"');
    expect(readFileSync(join(docs, 'robots.txt'), 'utf8')).toContain(`Sitemap: ${SITE}sitemap.xml`);
  });

  it('keeps braces out of page text, where the Voodoo.js runtime would read them as expressions', () => {
    for (const p of pages) {
      const text = p.html
        .replace(/<(script|style|pre|code|textarea|svg)\b[\s\S]*?<\/\1>/g, ' ')
        .replace(/<[^>]+>/g, ' ');
      const at = text.search(/[{}]/);
      expect(at === -1 ? '' : text.slice(Math.max(0, at - 60), at + 60), p.rel).toBe('');
    }
  });

  it('uses Monsoon and Voodoo.js from pinned CDN versions and credits the author on every page', () => {
    for (const p of pages) {
      expect(p.html, p.rel).toContain('https://cdn.jsdelivr.net/npm/monsooncss@0.2.0/dist/monsoon.min.css');
      expect(p.html, p.rel).toContain('https://cdn.jsdelivr.net/npm/voodoojs@1.0.0/dist/voodoo.full.min.js');
      expect(p.html, p.rel).toContain('rel="me noopener"');
      expect(p.html, p.rel).toContain('Built with <a href="https://kwy404.github.io/monsoon/">Monsoon</a>');
      for (const more of ['cookieowl', 'installkite', 'a11ymedic', 'fontsketch', 'breakhound']) expect(p.html, `${p.rel} ${more}`).toContain(`https://kwy404.github.io/${more}/`);
    }
  });

  it('pre-highlights every code sample with Shiki light-plus and dark-plus', () => {
    for (const p of pages) {
      for (const pre of attr(p.html, /<pre class="shiki"[^>]*>([\s\S]*?)<\/pre>/g)) expect(pre, p.rel).toContain('--shiki-dark');
    }
  });
});
