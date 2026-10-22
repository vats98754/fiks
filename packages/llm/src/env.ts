// Child-process environment for Agent SDK sessions (PLAN P1: host agent env = OAuth token + PATH +
// temp HOME). Built from an allow-list, never by copying process.env, so no other credential, git
// identity or fiks state reaches the Claude Code process.

import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LlmConfigError } from './errors.ts';

export const OAUTH_ENV = 'CLAUDE_CODE_OAUTH_TOKEN';

/** Variables copied from the parent when set (no secrets among them). */
const PASS_THROUGH = ['PATH', 'LANG', 'LC_ALL', 'TZ'] as const;

export interface ScrubbedEnvOptions {
  /** HOME for the child; a fresh temp dir when omitted. */
  home?: string;
  /** Extra variables the caller explicitly allows (names are logged, values never). */
  extra?: Record<string, string>;
  /** Parent environment to read from (tests). */
  parent?: NodeJS.ProcessEnv;
  /** False only for mocked queries, which need no token. */
  requireToken?: boolean;
}

export function freshHome(): string {
  return mkdtempSync(join(tmpdir(), 'fiks-llm-home-'));
}

export function scrubbedEnv(opts: ScrubbedEnvOptions = {}): Record<string, string> {
  const parent = opts.parent ?? process.env;
  const env: Record<string, string> = {};
  for (const k of PASS_THROUGH) {
    const v = parent[k];
    if (v) env[k] = v;
  }
  env.HOME = opts.home ?? freshHome();
  env.TMPDIR = parent.TMPDIR ?? tmpdir();
  env.DISABLE_AUTOUPDATER = '1';
  env.CLAUDE_AGENT_SDK_CLIENT_APP = 'fiks-llm/0.0.0';
  const token = parent[OAUTH_ENV];
  if (token) env[OAUTH_ENV] = token;
  else if (opts.requireToken !== false) {
    throw new LlmConfigError(`${OAUTH_ENV} is not set: the LLM route runs only on the OAuth token (.env)`);
  }
  for (const [k, v] of Object.entries(opts.extra ?? {})) env[k] = v;
  return env;
}

/** Names only, for transcripts and logs. */
export function envKeys(env: Record<string, string>): string[] {
  return Object.keys(env).sort();
}

/** Loads the fiks root `.env` (if present) into process.env, like `packages/cli/src/main.ts`. */
export function loadRootEnv(): void {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    const f = join(dir, '.env');
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) {
      if (existsSync(f)) process.loadEnvFile(f);
      return;
    }
    dir = dirname(dir);
  }
}
