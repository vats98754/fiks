// Canary probes (PLAN P1): run inside a sandbox container before it is trusted with a run. Each probe
// states what must be impossible (egress, a host secret in env, a write outside the worktree, a read
// of the host's .env) and checks it really is. Denied egress attempts go to the egress log (JSONL).
import { randomBytes } from 'node:crypto';
import { appendFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { ExecResult } from '@fiks/interfaces';
import { type DockerExecBackend, SANDBOX_ENV } from './backend.ts';

/** Canary values planted in the host environment; none may ever be seen inside a container. */
export function makeCanaries(): Record<string, string> {
  const id = randomBytes(6).toString('hex');
  return { GH_TOKEN: `fiks-canary-${id}`, FIKS_CANARY: `fiks-canary-${id}-env` };
}

export interface ProbeResult {
  name: string;
  ok: boolean;
  /** What was run and what came back (exit code and the first lines of output). */
  detail: string;
}

export interface ProbeOptions {
  /** The exact environment commands must see (default SANDBOX_ENV). */
  expectedEnv?: Record<string, string>;
  /** Canary values (e.g. from makeCanaries(), planted in the host env); none may appear. */
  canaries?: string[];
  /** JSONL egress log on the host. */
  egressLog?: string;
  /** Host paths that must not exist in the container (default: ~/fiks/.env and the repo's .env). */
  hostSecrets?: string[];
}

const short = (r: ExecResult) =>
  `exit ${r.code}; ${`${r.stdout}${r.stderr}`.trim().split('\n').slice(0, 3).join(' | ').slice(0, 300)}`;

export function logEgressDenial(
  file: string,
  entry: { container: string; probe: string; target: string; detail: string },
): void {
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify({ at: new Date().toISOString(), denied: true, ...entry })}\n`);
}

const NODE_FETCH = `fetch('https://example.com').then(()=>process.exit(0),e=>{console.error('denied',String(e.cause&&e.cause.code||e));process.exit(3)})`;
const NODE_TCP = `const s=require('net').connect(443,'93.184.215.14');s.on('connect',()=>process.exit(0));s.on('error',e=>{console.error('denied',e.code);process.exit(3)})`;
const NODE_LOOPBACK = `const n=require('net');const v=n.createServer(c=>c.end('ok')).listen(0,'127.0.0.1',()=>{n.connect(v.address().port,'127.0.0.1').on('data',d=>{console.log(String(d));process.exit(0)}).on('error',e=>{console.error(e.code);process.exit(4)})})`;

export async function runCanaryProbes(
  sb: DockerExecBackend,
  opts: ProbeOptions = {},
): Promise<{ ok: boolean; results: ProbeResult[] }> {
  const results: ProbeResult[] = [];
  const add = (name: string, ok: boolean, detail: string) => results.push({ name, ok, detail });
  const expected = opts.expectedEnv ?? SANDBOX_ENV;

  // Egress: three ways out, each must fail on the network (not on a missing binary).
  const egress: [string, string, string[]][] = [
    ['egress: curl https://example.com', 'curl', ['-sS', '--max-time', '5', 'https://example.com']],
    ['egress: node fetch https://example.com', 'node', ['-e', NODE_FETCH]],
    ['egress: raw TCP to 93.184.215.14:443', 'node', ['-e', NODE_TCP]],
  ];
  for (const [name, cmd, args] of egress) {
    const r = await sb.exec(cmd, args, { env: expected, timeoutMs: 20_000 });
    const denied = r.code !== 0 && r.code !== 127 && r.code !== 126;
    add(name, denied, short(r));
    if (denied && opts.egressLog) {
      logEgressDenial(opts.egressLog, {
        container: sb.name,
        probe: name,
        target: args.at(-1) ?? '',
        detail: short(r),
      });
    }
  }
  const lo = await sb.exec('node', ['-e', NODE_LOOPBACK], { env: expected, timeoutMs: 20_000 });
  add('loopback still works', lo.code === 0 && lo.stdout.includes('ok'), short(lo));

  // Environment: exactly the expected variables, no canary anywhere.
  const env = await sb.exec('env', [], { env: expected });
  const seen = Object.fromEntries(
    env.stdout
      .split('\n')
      .filter(Boolean)
      .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
  );
  const sameKeys = Object.keys(seen).sort().join() === Object.keys(expected).sort().join();
  const sameValues = Object.entries(expected).every(([k, v]) => seen[k] === v);
  add(
    `env is exactly {${Object.keys(expected).join(', ')}}`,
    env.code === 0 && sameKeys && sameValues,
    env.stdout.trim().replace(/\n/g, ' '),
  );
  const leaked = (opts.canaries ?? []).filter((c) => env.stdout.includes(c));
  add(
    'no canary or token variable in env',
    leaked.length === 0 &&
      !/^(GH_TOKEN|GITHUB_TOKEN|FIKS_CANARY|CLAUDE_CODE_OAUTH_TOKEN|ANTHROPIC_API_KEY)=/m.test(env.stdout),
    leaked.length ? `leaked ${leaked.length} canary value(s)` : 'none',
  );

  // Writes: nowhere outside the worktree (and /tmp, the tmpfs HOME), but inside it.
  for (const p of ['/fiks-probe', '/opt/fiks-probe', '/etc/fiks-probe', '/usr/local/bin/fiks-probe']) {
    const r = await sb.exec('sh', ['-c', `echo x > ${p}`], { env: expected });
    add(`write outside the worktree fails: ${p}`, r.code !== 0, short(r));
  }
  const inside = await sb.exec('sh', ['-c', 'echo x > .fiks-probe && rm .fiks-probe'], { env: expected });
  add('write inside the worktree works', inside.code === 0, short(inside));

  // Host secrets: neither the repo's .env nor ~/fiks/.env exists in the container; $HOME is /tmp.
  const secrets = opts.hostSecrets ?? [join(homedir(), 'fiks', '.env'), '/Users', homedir()];
  for (const p of secrets) {
    const r = await sb.exec('test', ['-e', p], { env: expected });
    add(`host path absent: ${p}`, r.code === 1, short(r));
  }
  const home = await sb.exec('sh', ['-c', 'echo "$HOME"; cat "$HOME/fiks/.env"'], { env: expected });
  add(
    'HOME=/tmp and $HOME/fiks/.env is ENOENT',
    home.stdout.trim() === '/tmp' && /No such file/.test(home.stderr),
    short(home),
  );
  return { ok: results.every((r) => r.ok), results };
}
