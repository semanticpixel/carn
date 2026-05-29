import { describe, expect, it } from 'vitest';
import { extractPathsFromPrompt } from './infer-paths.js';

describe('extractPathsFromPrompt', () => {
  it('extracts plain file paths from prompt text', () => {
    expect(extractPathsFromPrompt('please fix src/auth/login.ts')).toEqual([
      'src/auth/login.ts',
    ]);
  });

  it('extracts multiple distinct paths', () => {
    const got = extractPathsFromPrompt(
      'compare src/foo.ts to src/bar.ts then update package.json',
    );
    expect(got.sort()).toEqual(['package.json', 'src/bar.ts', 'src/foo.ts'].sort());
  });

  it('strips leading ./', () => {
    expect(extractPathsFromPrompt('look at ./src/auth.md')).toEqual([
      'src/auth.md',
    ]);
  });

  it('drops version-like tokens', () => {
    expect(extractPathsFromPrompt('we are on 1.2.3 and 2.0')).toEqual([]);
  });

  it('drops email addresses', () => {
    expect(extractPathsFromPrompt('contact admin@example.com about this')).toEqual([]);
  });

  it('drops bare domains (no slash, single dot)', () => {
    expect(extractPathsFromPrompt('see example.com for details')).toEqual([]);
  });

  it('keeps deep nested paths with multiple dots', () => {
    expect(extractPathsFromPrompt('check src/a.b.test.ts')).toEqual(['src/a.b.test.ts']);
  });

  it('returns [] for prompts with no file tokens', () => {
    expect(extractPathsFromPrompt('refactor the auth module please')).toEqual([]);
  });

  it('deduplicates repeated tokens', () => {
    expect(extractPathsFromPrompt('src/foo.ts again src/foo.ts')).toEqual([
      'src/foo.ts',
    ]);
  });
});
