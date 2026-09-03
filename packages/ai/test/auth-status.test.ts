import { describe, expect, it } from 'vitest';
import { claudeAuthProblem, parseAuthStatus } from '../src/claude-cli';

describe('claude auth status', () => {
  it('reads a subscription login', () => {
    const out = JSON.stringify({
      loggedIn: true,
      authMethod: 'claude.ai',
      apiProvider: 'firstParty',
      email: 'me@example.com',
      subscriptionType: 'max',
    });
    expect(parseAuthStatus(out)).toEqual({
      loggedIn: true,
      method: 'claude.ai',
      subscription: 'max',
      account: 'me@example.com',
    });
  });

  it('reads a logged-out CLI, ignoring noise around the JSON', () => {
    const out = `some hook output\n${JSON.stringify({ loggedIn: false, authMethod: 'none' })}\n`;
    expect(parseAuthStatus(out)).toEqual({
      loggedIn: false,
      method: null,
      subscription: null,
      account: null,
    });
  });

  it('reports unexpected output instead of throwing', () => {
    const r = parseAuthStatus('command not found');
    expect(r.loggedIn).toBe(false);
    expect(r.error).toMatch(/unexpected output/);
    expect(parseAuthStatus('{"loggedIn": tru}').error).toMatch(/could not parse/);
  });

  it('names the blocking step', () => {
    const base = { loggedIn: false, method: null, subscription: null, account: null };
    expect(claudeAuthProblem({ bin: null, ...base })).toMatch(/not installed/);
    expect(claudeAuthProblem({ bin: '/x/claude', ...base })).toMatch(/claude auth login/);
    expect(
      claudeAuthProblem({
        bin: '/x/claude',
        loggedIn: true,
        method: 'claude.ai',
        subscription: 'max',
        account: null,
      }),
    ).toBeNull();
  });
});
