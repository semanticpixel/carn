export class NotAGitRepoError extends Error {
  constructor(path: string) {
    super(
      `Not a git repository: ${path}. Run \`git init\` first, or invoke carn from inside an existing repo.`,
    );
    this.name = 'NotAGitRepoError';
  }
}

export class EntryNotFoundError extends Error {
  constructor(id: string) {
    super(`Entry not found: ${id}`);
    this.name = 'EntryNotFoundError';
  }
}

export class IdCollisionError extends Error {
  constructor(id: string) {
    super(
      `ID collision generating ${id}. This is vanishingly unlikely; please retry. ` +
        `If you see this repeatedly, the random source may be broken.`,
    );
    this.name = 'IdCollisionError';
  }
}

export class ConcurrentWriteError extends Error {
  constructor(detail: string) {
    super(
      `Concurrent write to carn branch could not be reconciled after retry: ${detail}`,
    );
    this.name = 'ConcurrentWriteError';
  }
}

export class GitCommandError extends Error {
  readonly exitCode: number;
  readonly stderr: string;
  readonly args: readonly string[];
  constructor(args: readonly string[], exitCode: number, stderr: string) {
    super(`git ${args.join(' ')} exited ${exitCode}: ${stderr.trim()}`);
    this.name = 'GitCommandError';
    this.exitCode = exitCode;
    this.stderr = stderr;
    this.args = args;
  }
}
