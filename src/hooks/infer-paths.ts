import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Token-shape regex: file-like substrings. Matches `src/foo.ts`,
 * `./auth.md`, `package.json`, `node_modules/...`. Intentionally loose —
 * the path-match step later filters by overlap with entry paths, so
 * over-extraction is cheap (a non-matching path produces zero overlaps).
 *
 * Anchored on a word boundary so the matcher doesn't trip on URL paths
 * (`https://example.com/foo.html`) — though even if it did, the overlap
 * predicate would skip it.
 */
const FILE_TOKEN = /\b[\w@./-]+\.[\w]{1,8}\b/g;

/**
 * Drop tokens we know aren't repo files but still match the regex: bare
 * domains (`example.com`), version strings (`1.2.3`), commit-like shas
 * (`abc12345.def`), email-ish (`foo@bar.com`).
 *
 * For zero-slash tokens (a bare filename like `package.json` vs a bare
 * domain like `example.com`), allow through when the extension is a
 * known file extension — that disambiguates the common case without a
 * fragile TLD blocklist.
 */
const KNOWN_FILE_EXTENSIONS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs',
  'json', 'jsonc', 'json5', 'yaml', 'yml', 'toml',
  'md', 'mdx', 'txt', 'rst',
  'html', 'css', 'scss', 'sass', 'less',
  'astro', 'vue', 'svelte',
  'py', 'rb', 'go', 'rs', 'java', 'kt', 'swift',
  'c', 'cc', 'cpp', 'h', 'hpp',
  'sh', 'bash', 'zsh', 'fish',
  'sql', 'graphql', 'gql', 'proto',
  'tf', 'tfvars', 'hcl',
  'dockerfile',
  'lock', 'env', 'gitignore', 'gitattributes',
  'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico',
]);

function looksLikeRepoPath(token: string): boolean {
  if (token.includes('@')) return false;
  if (/^\d+\.\d+(\.\d+)*$/.test(token)) return false;
  const slashes = (token.match(/\//g) ?? []).length;
  if (slashes === 0 && /^[\w-]+\.[\w-]+$/.test(token)) {
    const ext = token.slice(token.lastIndexOf('.') + 1).toLowerCase();
    if (!KNOWN_FILE_EXTENSIONS.has(ext)) return false;
  }
  return true;
}

/**
 * Extract candidate file paths from the prompt text. Heuristic, designed
 * for over-inclusion — the path-overlap predicate in ST-4 handles false
 * positives by silently dropping them at query time.
 */
export function extractPathsFromPrompt(prompt: string): string[] {
  const matches = prompt.match(FILE_TOKEN) ?? [];
  const out = new Set<string>();
  for (const raw of matches) {
    if (!looksLikeRepoPath(raw)) continue;
    out.add(raw.startsWith('./') ? raw.slice(2) : raw);
  }
  return [...out];
}

/**
 * Files that the developer touched recently. Combines `git status
 * --short` (uncommitted) + `git diff --name-only HEAD~5..HEAD` (last 5
 * commits). Errors fall back to an empty array — the hook stays silent
 * rather than blowing up on shallow clones / repos with <5 commits.
 */
export async function recentlyTouchedFiles(cwd: string): Promise<string[]> {
  const out = new Set<string>();
  try {
    const { stdout } = await execFileAsync('git', ['status', '--short'], { cwd });
    for (const line of stdout.split('\n')) {
      // Format: `XY <path>` or `XY <old> -> <new>`.
      const trimmed = line.slice(3).trim();
      if (!trimmed) continue;
      const arrow = trimmed.lastIndexOf(' -> ');
      const path = arrow === -1 ? trimmed : trimmed.slice(arrow + 4);
      if (path) out.add(path);
    }
  } catch {
    /* not a git repo, no commits, etc. — silent */
  }
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['diff', '--name-only', 'HEAD~5..HEAD'],
      { cwd },
    );
    for (const line of stdout.split('\n')) {
      const path = line.trim();
      if (path) out.add(path);
    }
  } catch {
    /* shallow clone, < 5 commits — silent */
  }
  return [...out];
}

export interface InferOptions {
  cwd: string;
  prompt: string;
}

/**
 * Combine prompt extraction + recent files. Order:
 * 1. Tokens from the prompt (the user explicitly named these — highest
 *    signal).
 * 2. Recently touched files (the user is probably about to edit them).
 *
 * Deduplicated, preserving first-seen order. Returns `[]` when neither
 * source yields anything — callers should still call carn_query with
 * `[]` (which returns no entries from query semantics; the hook will
 * silently exit).
 */
export async function inferPaths(opts: InferOptions): Promise<string[]> {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of extractPathsFromPrompt(opts.prompt)) {
    if (!seen.has(p)) {
      seen.add(p);
      out.push(p);
    }
  }
  for (const p of await recentlyTouchedFiles(opts.cwd)) {
    if (!seen.has(p)) {
      seen.add(p);
      out.push(p);
    }
  }
  return out;
}
