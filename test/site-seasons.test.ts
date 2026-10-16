// The seasonal themes: Easter and the movable feasts, every window boundary,
// the pt-BR dates and the ?season= override, from assets/seasons/seasons.js.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(join(root, 'assets', 'seasons', 'seasons.js'), 'utf8');

interface Seasons {
  ids: string[];
  easter(year: number): Date;
  detect(date: Date, lang?: string): string | null;
  label(id: string, lang?: string, pageInPortuguese?: boolean): string;
  resolve(search: string, now: Date, lang?: string): { id: string | null; forced: boolean };
}
const context: { KastorSeasons?: Seasons } = {};
runInNewContext(source, context);
const S = context.KastorSeasons!;

const day = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d, 12);
};
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

describe('seasons.js', () => {
  it('stays small and has no dependencies', () => {
    expect(source.length).toBeLessThan(4500);
    expect(source).not.toMatch(/\bimport\b|\brequire\(/);
  });

  it('computes Easter Sunday for 2024 to 2030', () => {
    const known = { 2024: '2024-03-31', 2025: '2025-04-20', 2026: '2026-04-05', 2027: '2027-03-28', 2028: '2028-04-16', 2029: '2029-04-01', 2030: '2030-04-21' };
    for (const [year, date] of Object.entries(known)) expect(ymd(S.easter(Number(year))), year).toBe(date);
  });

  it('opens and closes every fixed window on the right day', () => {
    const cases: [string, string | null][] = [
      ['2026-12-29', null], ['2026-12-30', 'newyear'], ['2027-01-02', 'newyear'], ['2027-01-03', null],
      ['2026-12-17', null], ['2026-12-18', 'christmas'], ['2026-12-26', 'christmas'], ['2026-12-27', null],
      ['2026-10-23', null], ['2026-10-24', 'halloween'], ['2026-10-31', 'halloween'], ['2026-11-01', null],
      ['2027-02-13', null], ['2027-02-14', 'valentine'], ['2027-02-15', null],
      ['2026-06-12', null], ['2026-06-13', 'junina'], ['2026-06-29', 'junina'], ['2026-06-30', null],
    ];
    for (const [date, id] of cases) expect(S.detect(day(date), 'en-US'), date).toBe(id);
  });

  it('runs Carnival from the Saturday before Ash Wednesday through Ash Wednesday, and Easter from Good Friday', () => {
    // 2027: Easter March 28, Ash Wednesday February 10.
    expect(S.detect(day('2027-02-05'), 'en')).toBe(null);
    expect(S.detect(day('2027-02-06'), 'en')).toBe('carnival');
    expect(S.detect(day('2027-02-09'), 'en')).toBe('carnival');
    expect(S.detect(day('2027-02-10'), 'en')).toBe('carnival');
    expect(S.detect(day('2027-02-11'), 'en')).toBe(null);
    expect(S.detect(day('2027-03-25'), 'en')).toBe(null);
    expect(S.detect(day('2027-03-26'), 'en')).toBe('easter');
    expect(S.detect(day('2027-03-28'), 'en')).toBe('easter');
    expect(S.detect(day('2027-03-29'), 'en')).toBe(null);
    // 2030: Easter April 21, Ash Wednesday March 6.
    expect(S.detect(day('2030-03-02'), 'en')).toBe('carnival');
    expect(S.detect(day('2030-03-01'), 'en')).toBe(null);
    expect(S.detect(day('2030-04-19'), 'en')).toBe('easter');
  });

  it('gives Carnival the day when it falls on February 14', () => {
    // 2026: Ash Wednesday is February 18, so Carnival starts on Saturday February 14.
    expect(S.detect(day('2026-02-14'), 'en')).toBe('carnival');
    expect(S.detect(day('2026-02-13'), 'en')).toBe(null);
  });

  it('adds the Brazilian Valentine date and keeps the Festa Junina name for pt-BR visitors', () => {
    expect(S.detect(day('2026-06-12'), 'pt-BR')).toBe('valentine');
    expect(S.detect(day('2026-06-12'), 'pt-PT')).toBe(null);
    expect(S.detect(day('2026-06-12'), 'en-US')).toBe(null);
    expect(S.label('junina', 'pt-BR')).toBe('Festa Junina');
    expect(S.label('junina', 'en-US')).toBe('Midsummer');
    expect(S.label('christmas', 'en-US', true)).toBe('Natal');
    expect(S.label('halloween', 'en-US')).toBe('Halloween');
  });

  it('lets ?season= force a season or turn it off', () => {
    const october = day('2026-10-28');
    expect(S.resolve('', october, 'en')).toEqual({ id: 'halloween', forced: false });
    expect(S.resolve('?season=christmas', october, 'en')).toEqual({ id: 'christmas', forced: true });
    expect(S.resolve('?a=1&season=junina', day('2026-03-03'), 'en')).toEqual({ id: 'junina', forced: true });
    expect(S.resolve('?season=off', october, 'en')).toEqual({ id: null, forced: true });
    expect(S.resolve('?season=nope', october, 'en')).toEqual({ id: null, forced: true });
    expect(S.resolve('', day('2026-08-10'), 'en')).toEqual({ id: null, forced: false });
  });

  it('has the art for every season in light and dark', () => {
    for (const id of S.ids) {
      for (const f of ['mascot.svg', 'mascot-dark.svg', 'head.svg', 'head-dark.svg', 'accent.svg', 'accent-dark.svg']) {
        expect(existsSync(join(root, 'assets', 'seasons', id, f)), `${id}/${f}`).toBe(true);
      }
      for (const mode of ['light', 'dark']) {
        const icons = join(root, 'assets', 'seasons', id, 'icons', mode);
        expect(existsSync(icons), `${id} ${mode} icons`).toBe(true);
      }
    }
  });
});
