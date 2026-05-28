export { ensureBranch, type EnsureBranchOptions } from './branch.js';
export {
  addEntry,
  getEntry,
  listEntries,
  updateEntry,
  closeEntry,
  type Entry,
  type EntryDraft,
  type AddEntryOptions,
  type CloseEntryOptions,
  type ListEntriesOptions,
} from './entry.js';
export {
  CARN_BRANCH,
  CARN_REF,
  DEFAULT_IDENTITY,
  type GitIdentity,
} from './worktree.js';
export {
  ID_ALPHABET,
  ID_LENGTH,
  generateId,
  isValidId,
} from './id.js';
export {
  INDEX_LOG_PATH,
  readIndexLog,
  type IndexOp,
  type IndexRecord,
} from './index-log.js';
export {
  NotAGitRepoError,
  EntryNotFoundError,
  IdCollisionError,
  ConcurrentWriteError,
  GitCommandError,
} from './errors.js';
