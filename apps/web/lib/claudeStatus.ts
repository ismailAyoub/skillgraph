/**
 * The "your Claude subscription" path has three links: a relay on this machine (this app's own
 * server, or the bridge), the Claude Code CLI installed, and that CLI logged in. This module turns
 * what the relays report into the one step the user has to do next.
 */

/** What a relay reported about the CLI (the bridge's `/api/health`, this app's `/api/ai/status`). */
export interface ClaudeAuthReport {
  bin: string | null;
  loggedIn: boolean;
  method: string | null;
  subscription: string | null;
  account: string | null;
  error?: string;
}

export interface ClaudeStatus {
  /** Which relay answered: this app's server (local), the bridge, or none reachable. */
  relay: 'local' | 'bridge' | null;
  installed: boolean;
  loggedIn: boolean;
  method: string | null;
  subscription: string | null;
  account: string | null;
  /** Why the relay could not check (timeout, crash), when it said so. */
  error?: string;
}

export const NO_CLAUDE: ClaudeStatus = {
  relay: null,
  installed: false,
  loggedIn: false,
  method: null,
  subscription: null,
  account: null,
};

/** relay: nothing on this machine answers. install: no `claude`. login: logged out. ready. */
export type SubscriptionStep = 'relay' | 'install' | 'login' | 'ready';

export function claudeStep(c: ClaudeStatus): SubscriptionStep {
  if (!c.relay) return 'relay';
  if (!c.installed) return 'install';
  if (!c.loggedIn) return 'login';
  return 'ready';
}

/**
 * Merge what the two relays said. A relay that is ready wins (it is the one calls will use, see
 * `resolveBackend`); among the rest, this app's own server wins, being one process fewer.
 */
export function mergeClaudeStatus(
  local: { enabled: boolean; claude: ClaudeAuthReport | null } | null,
  bridge: { ai?: string | null; claude?: ClaudeAuthReport | null } | null,
): ClaudeStatus {
  const fromLocal = local?.enabled ? fromReport('local', local.claude) : null;
  let fromBridge: ClaudeStatus | null = null;
  if (bridge) {
    // Bridges built before the login check only say whether `claude -p` is available.
    fromBridge = bridge.claude
      ? fromReport('bridge', bridge.claude)
      : {
          ...NO_CLAUDE,
          relay: 'bridge',
          installed: bridge.ai === 'claude-cli',
          loggedIn: bridge.ai === 'claude-cli',
        };
  }
  if (fromLocal?.loggedIn) return fromLocal;
  if (fromBridge?.loggedIn) return fromBridge;
  return fromLocal ?? fromBridge ?? NO_CLAUDE;
}

function fromReport(relay: 'local' | 'bridge', r: ClaudeAuthReport | null): ClaudeStatus {
  if (!r) return { ...NO_CLAUDE, relay };
  return {
    relay,
    installed: !!r.bin,
    loggedIn: !!r.bin && r.loggedIn,
    method: r.method,
    subscription: r.subscription,
    account: r.account,
    ...(r.error ? { error: r.error } : {}),
  };
}

/** What to tell the user when AI is not usable yet, given where the subscription path stops. */
export function subscriptionHint(step: SubscriptionStep): string {
  switch (step) {
    case 'install':
      return 'Claude Code is not installed on this machine. Install it and log in once, and the AI runs on your subscription. Or use an Anthropic API key.';
    case 'login':
      return 'Claude Code on this machine is not logged in. In a terminal run `claude auth login`, sign in, and paste the code it shows back into the terminal (run `claude auth logout` first if it says the session expired).';
    case 'ready':
      return 'AI is connected.';
    default:
      return 'AI is not connected yet. Open "Connect AI" to use your Claude subscription (Claude Code on this machine) or an Anthropic API key.';
  }
}

/**
 * Short call to action for the header when AI is not usable yet. Only a logged-out CLI gets a
 * specific label: a relay plus an installed Claude Code means the user is on the subscription
 * path. Before that, nothing says they prefer it to an API key, so the neutral "Connect AI".
 */
export function subscriptionCta(step: SubscriptionStep): string {
  return step === 'login' ? 'Log in to Claude Code' : 'Connect AI';
}
