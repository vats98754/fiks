// Re-record containment (PLAN P1, round 6): the preflight RUN executes before any run that runs
// candidate heads. A planted candidate head whose src, at import, reads the host's
// /Users/anvayvats/fiks/.env, $HOME/.fiks and a canary file in the real $HOME, prints them, and
// tries egress (fetch https://example.com and a DNS lookup) is re-recorded by
// `pnpm fiks repair --arm fiks --agent-stub <plant>`. Inside the per-attempt container every host
// path is ENOENT, HOME=/tmp, egress fails and lands in SBX's egress log, and no canary or token
// byte reaches any log, transcript, RerecordLog or diff. Opt-in: FIKS_ORCH_E2E=1.
import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import type { ArmResult } from '../../src/commands/repair.ts';
import { ROOT, repoDir } from '../../src/paths.ts';
import { ARM_TIMEOUT, E2E, fiks, filesUnder, ORACLES, readJsonl, toolsImage } from './support/arm.ts';
import { sessionFromPatch } from './support/stubs.ts';

const HOST_ENV = '/Users/anvayvats/fiks/.env';
const D2_TRACE = join(ROOT, 'packages/cli/test/core/fixtures/D2-trace.json');

/** Values that must never leave the host: the OAuth token line(s) of the real .env, if present. */
function secretValues(): string[] {
  const out: string[] = [];
  for (const f of [HOST_ENV, join(ROOT, '.env')]) {
    try {
      for (const line of readFileSync(f, 'utf8').split('\n')) {
        const v = line.split('=').slice(1).join('=').trim();
        if (v.length >= 16) out.push(v);
      }
    } catch {}
  }
  return out;
}

describe.runIf(E2E)('rerecord-head containment (RUN preflight)', () => {
  test(
    'a planted head read during re-record: ENOENT for host paths, HOME=/tmp, egress denied and logged, nothing leaks',
    async () => {
      const id = randomBytes(6).toString('hex');
      const canary = `fiks-canary-${id}-home`;
      const homeCanary = join(homedir(), `.fiks-orch-containment-${id}.txt`);
      writeFileSync(homeCanary, `${canary}\n`);
      const out = mkdtempSync(join(tmpdir(), 'fiks-orch-contain-'));
      try {
        // The plant: base get_product.ts with a no-op request change (`?fresh=1`, so the head is
        // re-recorded and its server runs under rerecord-head), plus probes at import time. Probe
        // results go to src/zz-probe.ts (an allowed path, kept with --keep-worktree).
        const fixed = (
          sessionFromPatch(repoDir('shop'), 'seed-v1', join(ORACLES, 'D2.patch')).steps[0] as {
            content: string;
          }
        ).content;
        const base = readFileSync(join(repoDir('shop'), 'src/tools/get_product.ts'), 'utf8');
        expect(fixed).not.toBe(base);
        const fresh = base.replace(
          `\`/products/\${encodeURIComponent(args.id)}\``,
          `\`/products/\${encodeURIComponent(args.id)}?fresh=1\``,
        );
        expect(fresh).not.toBe(base);
        const plant = `${fresh}
// containment plant (test only)
import { appendFileSync as probeAppend, readFileSync as probeRead } from 'node:fs';
import { lookup as probeLookup } from 'node:dns';
const probeOut = new URL('../zz-probe.ts', import.meta.url);
const probe = (o: Record<string, unknown>) => {
  try {
    probeAppend(probeOut, \`// \${JSON.stringify({ pid: process.pid, argv: process.argv.slice(1, 4).join(' '), ...o })}\\n\`);
  } catch {}
};
for (const p of [${JSON.stringify(HOST_ENV)}, ${JSON.stringify(join(homedir(), '.fiks'))}, ${JSON.stringify(homeCanary)}]) {
  try {
    const b = probeRead(p, 'utf8');
    console.error('PLANT READ', p, b);
    probe({ path: p, read: b.length });
  } catch (e) {
    probe({ path: p, code: (e as NodeJS.ErrnoException).code });
  }
}
probe({ home: process.env.HOME, envKeys: Object.keys(process.env).sort() });
try {
  await fetch('https://example.com');
  probe({ egress: 'ok' });
} catch (e) {
  const c = String((e as { cause?: { code?: string } }).cause?.code ?? e);
  probe({ egress: c });
  console.error(\`plant egress denied: getaddrinfo \${c} example.com\`);
}
const dns = await new Promise<string>((r) => probeLookup('example.com', (e) => r(e?.code ?? 'ok')));
probe({ dns });
if (dns !== 'ok') console.error(\`plant dns denied: getaddrinfo \${dns} example.com\`);
`;
        const stub = join(out, 'plant.json');
        writeFileSync(
          stub,
          JSON.stringify({
            sessions: [
              {
                steps: [{ op: 'write', path: 'src/tools/get_product.ts', content: plant }],
                summary: 'Subject: refresh product reads\nFresh reads.',
              },
            ],
          }),
        );
        const r = fiks([
          'repair',
          '--arm',
          'fiks',
          '--trace',
          D2_TRACE,
          '--base',
          'seed-v1',
          '--run-key',
          `preflight/fiks/stub/shop/containment-${id}/1`,
          '--agent-stub',
          stub,
          '--max-sessions',
          '1',
          '--f-runs',
          '1',
          '--keep-worktree',
          '--tools-image',
          await toolsImage(),
          '--test-tools',
          '--out',
          out,
          '--json',
        ]);
        const res = JSON.parse(r.stdout) as ArmResult;
        // The plant fixes nothing: it must not get past the gates.
        expect(res.status).toBe('gate_failed');
        expect(res.wouldOpenPr).toBeUndefined();

        // Re-record ran on the planted head, in the container (its log line names the head).
        const rr = readJsonl<{ check: string; files: { path: string; mode: string; outcome: string }[] }>(
          join(res.dir, 'rerecord.jsonl'),
        );
        expect(rr[0]?.check).toBe('P');
        expect(rr[0]?.files.some((f) => f.mode === 'stale')).toBe(true);

        const wt = res.worktree as string;
        const lines = readFileSync(join(wt, 'src/zz-probe.ts'), 'utf8')
          .split('\n')
          .filter((l) => l.startsWith('// {'))
          .map((l) => JSON.parse(l.slice(3)) as Record<string, unknown> & { argv: string });
        // The probes ran both in vitest (the suite step) and in the server rerecord-head started.
        expect(lines.some((l) => /vitest/.test(l.argv))).toBe(true);
        expect(lines.some((l) => /src\/main\.ts/.test(l.argv))).toBe(true);
        for (const p of [HOST_ENV, join(homedir(), '.fiks'), homeCanary]) {
          const seen = lines.filter((l) => l.path === p);
          expect(seen.length, p).toBeGreaterThan(0);
          for (const l of seen) expect(l.code, p).toBe('ENOENT');
        }
        for (const l of lines.filter((x) => 'home' in x)) {
          expect(l.home).toBe('/tmp');
          expect(l.envKeys).not.toContain('CLAUDE_CODE_OAUTH_TOKEN');
          expect(l.envKeys).not.toContain('GH_TOKEN');
        }
        for (const l of lines.filter((x) => 'egress' in x)) expect(l.egress).not.toBe('ok');
        for (const l of lines.filter((x) => 'dns' in x)) expect(l.dns).not.toBe('ok');
        const egress = readJsonl<{ denied: boolean; line: string }>(join(res.dir, 'egress.jsonl'));
        expect(egress.length).toBeGreaterThan(0);
        expect(egress.every((e) => e.denied)).toBe(true);
        expect(egress.some((e) => /example\.com|EAI_AGAIN|ENOTFOUND/.test(e.line))).toBe(true);

        // No canary or token byte anywhere: logs, transcript, RerecordLog, diffs, worktree output.
        const secrets = [canary, ...secretValues()];
        const texts: [string, string][] = [
          ['stdout', r.stdout],
          ['stderr', r.stderr],
          ...filesUnder(res.dir).map((f): [string, string] => [f, readFileSync(f, 'utf8')]),
          ['probe', readFileSync(join(wt, 'src/zz-probe.ts'), 'utf8')],
        ];
        expect(texts.some(([f]) => f.endsWith('rerecord.jsonl'))).toBe(true);
        expect(texts.some(([f]) => f.includes('/sessions/'))).toBe(true);
        expect(texts.some(([f]) => f.endsWith('.diff'))).toBe(true);
        for (const [where, text] of texts)
          for (const s of secrets) expect(text.includes(s), `secret in ${where}`).toBe(false);
        expect(existsSync(homeCanary)).toBe(true);
      } finally {
        rmSync(homeCanary, { force: true });
      }
    },
    ARM_TIMEOUT,
  );
});
