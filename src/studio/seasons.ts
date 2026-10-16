/**
 * Seasonal themes in the studio. The shared `assets/seasons/seasons.js` picks
 * the season in the browser; the server only hands out that script and the
 * costume art of Kas, from a fixed list of files.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SEASON_IDS = ['newyear', 'carnival', 'easter', 'valentine', 'junina', 'halloween', 'christmas'] as const;
export const SEASON_ART = ['mascot', 'mascot-dark', 'head', 'head-dark'] as const;

/** Served when the seasons script is missing, so the page still loads cleanly. */
export const NO_SEASONS_SCRIPT = '/* kastor studio: no seasonal themes in this build */\n';

/** The assets/seasons folder next to the package: one level up from dist, two from src/studio. */
export function findSeasonsDir(): string | null {
  let here: string;
  try {
    here = dirname(fileURLToPath(import.meta.url));
  } catch {
    return null;
  }
  for (const candidate of [resolve(here, '../assets/seasons'), resolve(here, '../../assets/seasons')]) {
    if (existsSync(join(candidate, 'seasons.js'))) return candidate;
  }
  return null;
}

export interface SeasonFiles {
  script: string;
  /** SVG text for `/seasons/<id>/<art>.svg`, or null when the path is not one of ours. */
  art(path: string): string | null;
}

/** Reads the script once and the art on demand, with a cache. `dir` null turns seasons off. */
export function seasonFiles(dir: string | null): SeasonFiles {
  const script = dir && existsSync(join(dir, 'seasons.js')) ? readFileSync(join(dir, 'seasons.js'), 'utf8') : NO_SEASONS_SCRIPT;
  const cache = new Map<string, string | null>();
  return {
    script,
    art(path) {
      const m = /^\/seasons\/([a-z]+)\/([a-z-]+)\.svg$/.exec(path);
      if (!dir || !m || !(SEASON_IDS as readonly string[]).includes(m[1]!) || !(SEASON_ART as readonly string[]).includes(m[2]!)) return null;
      if (!cache.has(path)) {
        const file = join(dir, m[1]!, `${m[2]!}.svg`);
        cache.set(path, existsSync(file) ? readFileSync(file, 'utf8') : null);
      }
      return cache.get(path)!;
    },
  };
}
