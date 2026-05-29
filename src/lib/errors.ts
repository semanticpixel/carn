/**
 * Raised when an id (or id prefix) provided to a lib function does not
 * resolve uniquely to a single entry. The CLI/MCP surface translates
 * this into its exit code / JSON-RPC error.
 */
export class EntryRefError extends Error {
  readonly kind: 'not-found' | 'ambiguous';
  readonly matches: string[];
  constructor(kind: 'not-found' | 'ambiguous', message: string, matches: string[] = []) {
    super(message);
    this.name = 'EntryRefError';
    this.kind = kind;
    this.matches = matches;
  }
}
