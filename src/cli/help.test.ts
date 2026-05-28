import { describe, expect, it } from 'vitest';
import { COMMANDS, levenshtein, suggestCommand, topLevelHelp } from './help.js';

describe('topLevelHelp', () => {
  it('lists every command name', () => {
    const help = topLevelHelp();
    for (const c of COMMANDS) {
      if (c === 'help') continue;
      expect(help).toContain(c);
    }
  });

  it('documents exit codes 0/1/2', () => {
    const help = topLevelHelp();
    expect(help).toContain('Exit codes');
    expect(help).toContain('0');
    expect(help).toContain('1');
    expect(help).toContain('2');
  });
});

describe('levenshtein', () => {
  it('returns 0 for identical strings', () => {
    expect(levenshtein('add', 'add')).toBe(0);
  });
  it('counts single insertions and substitutions', () => {
    expect(levenshtein('add', 'ad')).toBe(1);
    expect(levenshtein('add', 'add!')).toBe(1);
    expect(levenshtein('add', 'ode')).toBe(2);
  });
});

describe('suggestCommand', () => {
  it('suggests the closest command when within edit-distance 2', () => {
    expect(suggestCommand('ad')).toBe('add');
    expect(suggestCommand('lst')).toBe('list');
    expect(suggestCommand('sho')).toBe('show');
  });

  it('returns null when nothing is close enough', () => {
    expect(suggestCommand('xyzzy')).toBeNull();
  });
});
