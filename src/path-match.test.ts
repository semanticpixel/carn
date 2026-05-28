import { describe, expect, it } from 'vitest';
import { REPO_WIDE_SENTINEL, filterByPaths, pathsOverlap } from './path-match.js';

describe('pathsOverlap', () => {
  it('exact file match — same string both sides', () => {
    expect(pathsOverlap(['src/auth/login.ts'], ['src/auth/login.ts'])).toBe(true);
  });

  it('entry-side recursive glob matches a deep query file', () => {
    expect(pathsOverlap(['src/**/*.ts'], ['src/auth/login.ts'])).toBe(true);
  });

  it('query-side recursive glob matches a deep entry file', () => {
    expect(pathsOverlap(['src/auth/login.ts'], ['src/**/*.ts'])).toBe(true);
  });

  it('single-level wildcard matches one segment only', () => {
    expect(pathsOverlap(['src/*.ts'], ['src/index.ts'])).toBe(true);
    expect(pathsOverlap(['src/*.ts'], ['src/auth/login.ts'])).toBe(false);
  });

  it('non-overlapping concrete paths do not match', () => {
    expect(pathsOverlap(['src/auth/login.ts'], ['src/billing/charge.ts'])).toBe(false);
  });

  it('overlapping globs match (entry `src/**` overlaps query `src/auth/**`)', () => {
    expect(pathsOverlap(['src/**'], ['src/auth/**'])).toBe(true);
    expect(pathsOverlap(['src/auth/**'], ['src/**'])).toBe(true);
  });

  it('disjoint globs at peer subtrees do not match', () => {
    expect(pathsOverlap(['src/auth/**'], ['src/billing/**'])).toBe(false);
  });

  it('multi-path arrays match if any pair overlaps', () => {
    expect(
      pathsOverlap(
        ['docs/**', 'src/auth/**'],
        ['src/billing/charge.ts', 'src/auth/login.ts'],
      ),
    ).toBe(true);
    expect(
      pathsOverlap(
        ['docs/**', 'src/auth/**'],
        ['src/billing/charge.ts', 'README.md'],
      ),
    ).toBe(false);
  });

  it('repo-wide sentinel `*` on the entry side matches any query', () => {
    expect(pathsOverlap([REPO_WIDE_SENTINEL], ['src/anything.ts'])).toBe(true);
    expect(pathsOverlap(['*'], ['totally/elsewhere'])).toBe(true);
  });

  it('repo-wide sentinel `*` on the query side matches any entry', () => {
    expect(pathsOverlap(['src/auth/login.ts'], [REPO_WIDE_SENTINEL])).toBe(true);
  });

  it('windows-style backslashes normalize to posix slashes before matching', () => {
    expect(pathsOverlap(['src/**/*.ts'], ['src\\auth\\login.ts'])).toBe(true);
    expect(pathsOverlap(['src\\auth\\**'], ['src/auth/login.ts'])).toBe(true);
  });

  it('empty entryPaths is treated as repo-wide (matches any non-empty query)', () => {
    expect(pathsOverlap([], ['src/auth/login.ts'])).toBe(true);
  });

  it('empty queryPaths matches anything — keeps API symmetric with filterByPaths', () => {
    expect(pathsOverlap(['src/auth/login.ts'], [])).toBe(true);
  });

  it('hidden / dotfile paths match (dot: true on picomatch)', () => {
    expect(pathsOverlap(['**'], ['.env'])).toBe(true);
    expect(pathsOverlap(['.github/**'], ['.github/workflows/ci.yml'])).toBe(true);
  });
});

describe('filterByPaths', () => {
  type E = { id: string; paths: string[] };

  const entries: E[] = [
    { id: 'aaaaaaaa', paths: ['src/auth/**'] },
    { id: 'bbbbbbbb', paths: ['src/billing/**'] },
    { id: 'cccccccc', paths: ['*'] }, // repo-wide
    { id: 'dddddddd', paths: [] }, // unscoped
  ];

  it('returns input unchanged when queryPaths is empty', () => {
    expect(filterByPaths(entries, [])).toBe(entries);
  });

  it('selects entries whose paths overlap a concrete query file', () => {
    const got = filterByPaths(entries, ['src/auth/login.ts']);
    expect(got.map((e) => e.id).sort()).toEqual(
      ['aaaaaaaa', 'cccccccc', 'dddddddd'].sort(),
    );
  });

  it('selects entries whose paths overlap a query glob', () => {
    const got = filterByPaths(entries, ['src/billing/**']);
    expect(got.map((e) => e.id).sort()).toEqual(
      ['bbbbbbbb', 'cccccccc', 'dddddddd'].sort(),
    );
  });

  it('preserves entry order — no implicit sort in the filter', () => {
    const got = filterByPaths(entries, ['**']);
    expect(got.map((e) => e.id)).toEqual(['aaaaaaaa', 'bbbbbbbb', 'cccccccc', 'dddddddd']);
  });
});
