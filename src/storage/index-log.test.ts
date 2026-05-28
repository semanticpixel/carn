import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import {
  INDEX_LOG_PATH,
  appendIndexRecord,
  readIndexLog,
  type IndexRecord,
} from './index-log.js';

let dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
  dirs = [];
});

async function freshDir(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), 'carn-ixlog-'));
  dirs.push(d);
  return d;
}

describe('index-log', () => {
  it('returns [] when the log file does not exist', async () => {
    const d = await freshDir();
    expect(await readIndexLog(d)).toEqual([]);
  });

  it('round-trips a sequence of records appended via appendIndexRecord', async () => {
    const d = await freshDir();
    const recs: IndexRecord[] = [
      { op: 'add', id: 'aaaaaaaa', at: '2026-01-01T00:00:00Z' },
      { op: 'update', id: 'aaaaaaaa', at: '2026-01-01T00:00:01Z' },
      { op: 'close', id: 'aaaaaaaa', at: '2026-01-01T00:00:02Z' },
    ];
    for (const r of recs) await appendIndexRecord(d, r);
    expect(await readIndexLog(d)).toEqual(recs);
  });

  it('creates the .carn/ parent directory if it does not exist', async () => {
    const d = await freshDir();
    // No mkdir of .carn/ ahead of time — appendIndexRecord must create it.
    await appendIndexRecord(d, { op: 'add', id: 'bbbbbbbb', at: '2026-01-02T00:00:00Z' });
    const log = await readIndexLog(d);
    expect(log).toHaveLength(1);
    expect(log[0]?.id).toBe('bbbbbbbb');
  });

  it('skips malformed JSON lines defensively without throwing', async () => {
    const d = await freshDir();
    const full = join(d, INDEX_LOG_PATH);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(
      full,
      [
        '{"op":"add","id":"cccccccc","at":"2026-01-03T00:00:00Z"}',
        '{this is not json}',
        '',
        '   ',
        '{"op":"close","id":"cccccccc","at":"2026-01-03T00:00:01Z"}',
      ].join('\n'),
      'utf8',
    );
    const recs = await readIndexLog(d);
    expect(recs.map((r) => r.op)).toEqual(['add', 'close']);
  });

  it('appends are newline-terminated so concatenation never collides', async () => {
    const d = await freshDir();
    await appendIndexRecord(d, { op: 'add', id: 'dddddddd', at: 'x' });
    // Sneak in a hand-appended line — simulates a parallel writer in another
    // worktree. The split-on-newline reader must keep both lines distinct.
    await appendFile(
      join(d, INDEX_LOG_PATH),
      `${JSON.stringify({ op: 'close', id: 'dddddddd', at: 'y' })}\n`,
      'utf8',
    );
    const recs = await readIndexLog(d);
    expect(recs).toHaveLength(2);
  });
});
