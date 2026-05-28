import { afterEach, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  addEntry,
  closeEntry,
  getEntry,
  listEntries,
  updateEntry,
} from './entry.js';
import { CARN_REF, acquireWorktree, gitExec, revParse } from './worktree.js';
import { EntryNotFoundError } from './errors.js';
import { INDEX_LOG_PATH, readIndexLog } from './index-log.js';
import {
  gitStatusSnapshot,
  makeBareRepo,
  makeSandbox,
} from './_test-utils.js';

let cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(cleanups.map((fn) => fn()));
  cleanups = [];
});

describe('entry — single-repo flow', () => {
  it('addEntry → getEntry round-trips and never touches the user worktree', async () => {
    const sbx = await makeBareRepo();
    cleanups.push(sbx.cleanup);

    const before = await gitStatusSnapshot(sbx.root);
    const entry = await addEntry(sbx.root, { note: 'hello' });
    const after = await gitStatusSnapshot(sbx.root);

    expect(entry.id).toHaveLength(8);
    expect(entry).toMatchObject({ note: 'hello' });
    expect(after).toBe(before);

    const fetched = await getEntry(sbx.root, entry.id);
    expect(fetched).toEqual(entry);
  });

  it('getEntry returns null for an unknown id and for a malformed id', async () => {
    const sbx = await makeBareRepo();
    cleanups.push(sbx.cleanup);
    await addEntry(sbx.root, { note: 'present' });

    expect(await getEntry(sbx.root, 'nopeyyyz')).toBeNull();
    expect(await getEntry(sbx.root, 'not-a-valid-id')).toBeNull();
  });

  it('updateEntry merges patch + writes an `update` log line', async () => {
    const sbx = await makeBareRepo();
    cleanups.push(sbx.cleanup);
    const entry = await addEntry(sbx.root, { kind: 'note', body: 'first' });

    const updated = await updateEntry(sbx.root, entry.id, { body: 'second', extra: 1 });
    expect(updated).toMatchObject({ id: entry.id, body: 'second', extra: 1, kind: 'note' });

    // Confirm the on-disk file is the merged shape.
    const fetched = await getEntry(sbx.root, entry.id);
    expect(fetched).toMatchObject({ body: 'second', extra: 1 });

    // Confirm the log got both `add` and `update`.
    const lease = await acquireWorktree(sbx.root);
    try {
      const log = await readIndexLog(lease.path);
      const ops = log.filter((r) => r.id === entry.id).map((r) => r.op);
      expect(ops).toEqual(['add', 'update']);
    } finally {
      await lease.release();
    }
  });

  it('closeEntry moves in-flight → closed and appends `close` to index.jsonl', async () => {
    const sbx = await makeBareRepo();
    cleanups.push(sbx.cleanup);
    const entry = await addEntry(sbx.root, { note: 'to-close' });

    const closed = await closeEntry(sbx.root, entry.id);
    expect(closed).toMatchObject({ id: entry.id, note: 'to-close' });

    const lease = await acquireWorktree(sbx.root);
    try {
      expect(existsSync(join(lease.path, 'in-flight', `${entry.id}.json`))).toBe(false);
      expect(existsSync(join(lease.path, 'closed', `${entry.id}.json`))).toBe(true);
      const log = await readIndexLog(lease.path);
      const closeRecs = log.filter((r) => r.id === entry.id && r.op === 'close');
      expect(closeRecs).toHaveLength(1);
    } finally {
      await lease.release();
    }

    // getEntry still finds it (now under closed/) — surface a unified view.
    const found = await getEntry(sbx.root, entry.id);
    expect(found?.id).toBe(entry.id);

    // listEntries default ('in-flight') excludes it; status:'closed' includes it.
    expect(await listEntries(sbx.root)).toHaveLength(0);
    const closedList = await listEntries(sbx.root, { status: 'closed' });
    expect(closedList.map((e) => e.id)).toEqual([entry.id]);
  });

  it('updateEntry on an unknown id throws EntryNotFoundError', async () => {
    const sbx = await makeBareRepo();
    cleanups.push(sbx.cleanup);
    await expect(updateEntry(sbx.root, 'aaaaaaaa', { x: 1 })).rejects.toBeInstanceOf(
      EntryNotFoundError,
    );
  });
});

describe('entry — sibling-worktree concurrency', () => {
  it('two parallel addEntry calls from sibling clones both succeed against the same bare origin', async () => {
    const sbx = await makeSandbox(2);
    cleanups.push(sbx.cleanup);
    const [a, b] = sbx.clones as [string, string];

    const before = await Promise.all([gitStatusSnapshot(a), gitStatusSnapshot(b)]);
    const [eA, eB] = await Promise.all([
      addEntry(a, { note: 'from-a' }),
      addEntry(b, { note: 'from-b' }),
    ]);
    const after = await Promise.all([gitStatusSnapshot(a), gitStatusSnapshot(b)]);

    // Neither sibling's user-visible git state moved.
    expect(after).toEqual(before);

    expect(eA.id).not.toBe(eB.id);

    // Pull origin/carn into a fresh observer and confirm both entries landed.
    const sbx2 = await makeSandbox(1);
    cleanups.push(sbx2.cleanup);
    // Re-target origin to the existing bare from sbx.
    const [observer] = sbx2.clones as [string];
    await gitExec(observer, ['remote', 'set-url', 'origin', sbx.bare]);
    await gitExec(observer, ['fetch', 'origin', 'carn:refs/heads/carn'], {
      allowFailure: true,
    });

    const log = await gitExec(observer, [
      'log',
      '--format=%s',
      CARN_REF,
    ]);
    const subjects = log.stdout.trim().split('\n');
    // The two `add` commits plus the orphan root.
    expect(subjects.filter((s) => s.startsWith('carn: add'))).toHaveLength(2);
    expect(subjects.some((s) => s === 'carn: root')).toBe(true);

    // Pull entries back through the observer-side getEntry to confirm both are addressable.
    expect((await getEntry(observer, eA.id))?.note).toBe('from-a');
    expect((await getEntry(observer, eB.id))?.note).toBe('from-b');
  }, 30_000);
});

describe('entry — no-origin behavior', () => {
  it('addEntry succeeds without a remote and updates the local carn ref', async () => {
    const sbx = await makeBareRepo();
    cleanups.push(sbx.cleanup);
    const entry = await addEntry(sbx.root, { note: 'orphan' });

    const ref = await revParse(sbx.root, CARN_REF);
    expect(ref).toBeTruthy();

    // The user's HEAD is untouched.
    const head = await gitExec(sbx.root, ['rev-parse', 'HEAD']);
    expect(head.stdout.trim()).not.toBe(ref);

    expect((await getEntry(sbx.root, entry.id))?.note).toBe('orphan');
  });
});

describe('entry — index.jsonl shape', () => {
  it('appends one line per op, parseable as JSON', async () => {
    const sbx = await makeBareRepo();
    cleanups.push(sbx.cleanup);
    const a = await addEntry(sbx.root, { v: 1 });
    await updateEntry(sbx.root, a.id, { v: 2 });
    await closeEntry(sbx.root, a.id);

    const lease = await acquireWorktree(sbx.root);
    try {
      const raw = await readFile(join(lease.path, INDEX_LOG_PATH), 'utf8');
      const lines = raw.split('\n').filter((l) => l.length > 0);
      expect(lines).toHaveLength(3);
      for (const line of lines) {
        expect(() => JSON.parse(line)).not.toThrow();
      }
      const parsed = lines.map((l) => JSON.parse(l));
      expect(parsed.map((p) => p.op)).toEqual(['add', 'update', 'close']);
    } finally {
      await lease.release();
    }
  });
});
