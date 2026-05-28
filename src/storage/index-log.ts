import { appendFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { mkdir } from 'node:fs/promises';

export type IndexOp = 'add' | 'update' | 'close';

export interface IndexRecord {
  op: IndexOp;
  id: string;
  at: string;
}

export const INDEX_LOG_PATH = '.carn/index.jsonl';

/**
 * Append a single record to .carn/index.jsonl as a newline-terminated JSON line.
 *
 * The log is **append-only by contract** — never rewrite existing lines or
 * compact. Older entries are forensically valuable (you want to know when an
 * entry was opened, who closed it, what amendments happened), and a rewriting
 * scheme would break concurrent writers that snapshotted a previous offset.
 */
export async function appendIndexRecord(
  worktreePath: string,
  record: IndexRecord,
): Promise<void> {
  const full = `${worktreePath}/${INDEX_LOG_PATH}`;
  await mkdir(dirname(full), { recursive: true });
  await appendFile(full, `${JSON.stringify(record)}\n`, 'utf8');
}

export async function readIndexLog(worktreePath: string): Promise<IndexRecord[]> {
  const full = `${worktreePath}/${INDEX_LOG_PATH}`;
  if (!existsSync(full)) return [];
  const raw = await readFile(full, 'utf8');
  const out: IndexRecord[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as IndexRecord;
      out.push(parsed);
    } catch {
      // Skip malformed lines defensively — a corrupt entry should not jam the log.
    }
  }
  return out;
}
