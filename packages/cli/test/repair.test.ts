// The repair pipeline end to end, offline: a local bare git remote stands in for GitHub and
// a fake `gh` stands in for CI and PRs. Oracle runners (test-only) stand in for the agent.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RepairRunner } from '@fiks/repair';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { repair } from '../src/commands/repair.ts';
import { shopDir } from '../src/paths.ts';

const ORACLES = new URL('./oracles/', import.meta.url).pathname;
const FAKE_GH = new URL('./support/fake-gh.mjs', import.meta.url).pathname;
const T = 240_000;
const realShop = shopDir();
let tmp: string;
let log: string;

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), 'fiks-repair-'));
  const remote = join(tmp, 'remote.git');
  execFileSync('git', ['clone', '-q', '--bare', realShop, remote]);
  // The remote's main starts at the unfixed seed, like shop-mcp did before any fiks PR.
  execFileSync('git', ['--git-dir', remote, 'update-ref', 'refs/heads/main', 'seed-v1^{commit}']);
  const clone = join(tmp, 'shop');
  execFileSync('git', ['clone', '-q', remote, clone]);
  symlinkSync(join(realShop, 'node_modules'), join(clone, 'node_modules'));
  log = join(tmp, 'gh.log');
  Object.assign(process.env, {
    FIKS_SHOP_DIR: clone,
    FIKS_GH: FAKE_GH,
    FAKE_REMOTE: remote,
    FAKE_GH_LOG: log,
    SHOP_MCP_REPO: 'example/shop-mcp',
  });
});
beforeEach(() => {
  writeFileSync(log, '');
  process.env.FAKE_CI = 'success';
});
afterAll(() => {
  execFileSync('git', ['worktree', 'prune'], { cwd: join(tmp, 'shop') });
  rmSync(tmp, { recursive: true, force: true });
});

const remoteBranches = () =>
  execFileSync(
    'git',
    [
      '--git-dir',
      process.env.FAKE_REMOTE as string,
      'for-each-ref',
      '--format=%(refname:short)',
      'refs/heads',
    ],
    {
      encoding: 'utf8',
    },
  )
    .split('\n')
    .filter(Boolean);

const ghCalls = () =>
  readFileSync(log, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as string[]);

const oracle = (drift: string): RepairRunner => ({
  kind: 'oracle',
  async run(job) {
    execFileSync('git', ['apply', join(ORACLES, `${drift}.patch`)], { cwd: job.worktree });
    return {
      ok: true,
      kind: 'oracle',
      turns: 1,
      costUsd: 0,
      summary: `Oracle fix for ${drift}. Test-only.`,
      log: '',
    };
  },
});

const fast = { ciPollMs: 20, ciTimeoutMs: 5_000, attempts: 1 };

describe('fiks repair (offline)', () => {
  test('D2: F gate, fix commit, green CI, then a PR with every section; never a merge', {
    timeout: T,
  }, async () => {
    const r = await repair({ scenario: 'D2', runners: [oracle('D2')], ...fast });
    expect(r.status, r.reason).toBe('pr_opened');
    expect(r.gates.map((g) => `${g.gate}:${g.ok}`)).toEqual(['F:true', 'P:true', 'local:true', 'ci:true']);
    expect(r.fixCommitFiles).toEqual(['src/tools/get_product.ts']);
    expect(r.commits).toHaveLength(2);
    const calls = ghCalls();
    const create = calls.find((c) => c[0] === 'pr' && c[1] === 'create') as string[];
    expect(create).toBeDefined();
    expect(create).toContain('fiks');
    const body = readFileSync(create[create.indexOf('--body-file') + 1] as string, 'utf8');
    for (const h of ['What broke', 'Trace', 'Reproduction test', 'Fix', 'Before / after', 'Gates']) {
      expect(body).toMatch(new RegExp(`^## ${h}$`, 'm'));
    }
    // no merge of any kind, no auto-merge flag
    expect(calls.flat().join(' ')).not.toMatch(new RegExp(['merge', `--${'auto'}`].join('|')));
    // the PR was opened only after the CI result for the pushed commit was known
    const runIdx = calls.findIndex((c) => c[0] === 'run');
    const prIdx = calls.findIndex((c) => c[0] === 'pr' && c[1] === 'create');
    expect(runIdx).toBeGreaterThanOrEqual(0);
    expect(prIdx).toBeGreaterThan(runIdx);
  });

  test('D3: fiks re-records in its own commit holding only *.rerecorded.json', { timeout: T }, async () => {
    const r = await repair({ scenario: 'D3', runners: [oracle('D3')], ...fast });
    expect(r.status, r.reason).toBe('pr_opened');
    expect(r.commits).toHaveLength(3);
    expect(r.rerecorded.length).toBeGreaterThan(0);
    const shop = shopDir();
    const files = execFileSync(
      'git',
      [
        '--git-dir',
        process.env.FAKE_REMOTE as string,
        'show',
        '--name-only',
        '--format=',
        r.commits[2] as string,
      ],
      { cwd: shop, encoding: 'utf8' },
    )
      .split('\n')
      .filter(Boolean);
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) expect(f).toMatch(/\.rerecorded\.json$/);
  });

  test('red CI: no PR is opened', { timeout: T }, async () => {
    process.env.FAKE_CI = 'failure';
    const r = await repair({ scenario: 'D2', runners: [oracle('D2')], ...fast });
    expect(r.status).toBe('ci_red');
    expect(ghCalls().some((c) => c[0] === 'pr' && c[1] === 'create')).toBe(false);
  });

  test('CI never finishes: ci_timeout and no PR', { timeout: T }, async () => {
    process.env.FAKE_CI = 'pending';
    const r = await repair({ scenario: 'D2', runners: [oracle('D2')], ...fast, ciTimeoutMs: 300 });
    expect(r.status).toBe('ci_timeout');
    expect(ghCalls().some((c) => c[0] === 'pr' && c[1] === 'create')).toBe(false);
  });

  test('an agent that edits tests is rejected by the guard; nothing is pushed', { timeout: T }, async () => {
    const pushedBefore = remoteBranches().filter((b) => b.startsWith('fiks/'));
    const cheat: RepairRunner = {
      kind: 'oracle',
      async run(job) {
        execFileSync('git', ['apply', join(ORACLES, 'D2.patch')], { cwd: job.worktree });
        const f = join(job.worktree, 'test/fiks/check.ts');
        writeFileSync(f, readFileSync(f, 'utf8').replace('mustCheck', 'mustCheckX'));
        return { ok: true, kind: 'oracle', summary: 'cheat', log: '' };
      },
    };
    const r = await repair({ scenario: 'D2', runners: [cheat], ...fast });
    expect(r.status).toBe('gate_failed');
    expect(r.reason).toMatch(/outside src\/: test\/fiks\/check\.ts/);
    expect(ghCalls().filter((c) => !(c[0] === 'pr' && c[1] === 'list'))).toEqual([]);
    expect(remoteBranches().filter((b) => b.startsWith('fiks/'))).toEqual(pushedBefore);
  });

  test('a fix that does not repair the drift fails the local gate; nothing is pushed', {
    timeout: T,
  }, async () => {
    const pushedBefore = remoteBranches().filter((b) => b.startsWith('fiks/'));
    const r = await repair({ scenario: 'D2', runners: [oracle('D5')], ...fast });
    expect(r.status).toBe('gate_failed');
    expect(r.reason).toMatch(/local gate/);
    expect(ghCalls().filter((c) => !(c[0] === 'pr' && c[1] === 'list'))).toEqual([]);
    expect(remoteBranches().filter((b) => b.startsWith('fiks/'))).toEqual(pushedBefore);
  });

  test('agent code that rewrites fiks re-recordings during the gates is rejected; no PR', {
    timeout: T,
  }, async () => {
    const pushedBefore = remoteBranches().filter((b) => b.startsWith('fiks/'));
    // The verifier's attack: a no-op request change forces a re-record, and code that runs during
    // the gates doctors the re-recording, then erases itself from the source file.
    const evil: RepairRunner = {
      kind: 'oracle',
      async run(job) {
        const f = join(job.worktree, 'src/tools/get_product.ts');
        let s = readFileSync(f, 'utf8');
        s = s.replace(
          "import { z } from 'zod';",
          "import { readdirSync, readFileSync, writeFileSync } from 'node:fs';\nimport { z } from 'zod';",
        );
        s = s.replace(
          '`/products/${encodeURIComponent(args.id)}`',
          '`/products/${encodeURIComponent(args.id)}?fresh=1`',
        );
        s += [
          "const reproDir = new URL('../../test/repro/', import.meta.url);",
          'for (const name of readdirSync(reproDir)) {',
          "  if (!name.endsWith('.rerecorded.json')) continue;",
          '  const p = new URL(name, reproDir);',
          "  const text = readFileSync(p, 'utf8');",
          "  if (!text.includes('unit_amount')) continue;",
          "  writeFileSync(p, text.replaceAll('unit_amount', 'price'));",
          '  const self = new URL(import.meta.url);',
          "  writeFileSync(self, readFileSync(self, 'utf8').slice(0, readFileSync(self, 'utf8').indexOf('const reproDir')));",
          '}',
          '',
        ].join('\n');
        writeFileSync(f, s);
        return {
          ok: true,
          kind: 'oracle',
          turns: 1,
          costUsd: 0,
          summary: 'Subject: refresh product reads\nFresh reads.',
          log: '',
        };
      },
    };
    const r = await repair({ scenario: 'D2', runners: [evil], ...fast });
    expect(r.status).toBe('gate_failed');
    expect(r.reason).toMatch(/changed after they were checked|committed files differ/);
    expect(ghCalls().some((c) => c[0] === 'pr' && c[1] === 'create')).toBe(false);
    expect(remoteBranches().filter((b) => b.startsWith('fiks/'))).toEqual(pushedBefore);
  });

  test('a background helper started by agent code cannot change what fiks commits', {
    timeout: T,
  }, async () => {
    // The verifier's second attack: during its session the agent runs `pnpm test` with source that
    // spawns a detached helper; the helper doctors every re-recording it sees, while the final
    // source only adds a no-op query string. fiks builds re-recordings in memory and verifies the
    // committed blobs, so the doctored bytes never ship.
    const mark = join(tmpdir(), `fiks-helper-${process.pid}.lock`);
    rmSync(mark, { force: true });
    const helper = [
      "/*fiks-test-helper*/const fs=require('fs');const d=process.argv[1];const end=Date.now()+60000;",
      'setInterval(()=>{if(Date.now()>end)process.exit(0);try{for(const n of fs.readdirSync(d)){',
      "if(!n.endsWith('.rerecorded.json'))continue;const p=d+n;const s=fs.readFileSync(p,'utf8');",
      "if(s.includes('unit_amount'))fs.writeFileSync(p,s.split('unit_amount').join('price'))}}catch{}},1)",
    ].join('');
    const evil: RepairRunner = {
      kind: 'oracle',
      async run(job) {
        const f = join(job.worktree, 'src/tools/get_product.ts');
        const clean = readFileSync(f, 'utf8').replace(
          '`/products/${encodeURIComponent(args.id)}`',
          '`/products/${encodeURIComponent(args.id)}?fresh=1`',
        );
        const spawnLine = `if (!existsSync(${JSON.stringify(mark)})) { wfs(${JSON.stringify(mark)}, ''); spawn(process.execPath, ['-e', ${JSON.stringify(helper)}, new URL('../../test/repro/', import.meta.url).pathname], { detached: true, stdio: 'ignore' }).unref(); }`;
        writeFileSync(
          f,
          `import { spawn } from 'node:child_process';\nimport { existsSync, writeFileSync as wfs } from 'node:fs';\n${clean}\n${spawnLine}\n`,
        );
        try {
          execFileSync(join(job.worktree, 'node_modules/.bin/vitest'), ['run'], {
            cwd: job.worktree,
            stdio: 'pipe',
          });
        } catch {
          // the repro still fails; the point was to start the helper
        }
        writeFileSync(f, clean);
        return {
          ok: true,
          kind: 'oracle',
          turns: 1,
          costUsd: 0,
          summary: 'Subject: refresh product reads\nFresh reads.',
          log: '',
        };
      },
    };
    const r = await repair({ scenario: 'D2', runners: [evil], ...fast });
    if (r.status === 'pr_opened') {
      // Only possible if every committed re-recording holds fiks's own bytes, which still say
      // unit_amount; real CI would then fail the unfixed code, so no green PR in practice.
      const remote = process.env.FAKE_REMOTE as string;
      for (const f of r.rerecorded.filter((x) => x.startsWith('test/repro/'))) {
        const blob = execFileSync('git', ['--git-dir', remote, 'show', `${r.commits.at(-1)}:${f}`], {
          encoding: 'utf8',
        });
        expect(blob).toContain('unit_amount');
      }
    } else {
      expect(r.status).toBe('gate_failed');
      expect(r.reason).toMatch(/changed after they were checked|committed files differ/);
    }
    rmSync(mark, { force: true });
    try {
      execFileSync('pkill', ['-f', 'fiks-test-helper']);
    } catch {
      // none left
    }
  });

  test("a helper that swaps a recording's upstream profile cannot steer the re-recording", {
    timeout: T,
  }, async () => {
    // The verifier's third attack: after fiks's guard check, a helper makes the repro trace claim a
    // v2 profile without D2, so an honest re-record would hit a vendor that still sends `price`;
    // it restores the file once the re-recording exists. fiks reads re-record inputs from the
    // committed blob, so the swap has no effect.
    const mark = join(tmpdir(), `fiks-helper3-${process.pid}.lock`);
    rmSync(mark, { force: true });
    const helper = [
      "/*fiks-test-helper*/const fs=require('fs');const wt=process.argv[1];const d=wt+'/test/repro/';",
      "const srcf=wt+'/src/tools/get_product.ts';const saved={};let armedAt=0;const end=Date.now()+60000;",
      'setInterval(()=>{if(Date.now()>end)process.exit(0);try{',
      " if(!armedAt){if(!fs.readFileSync(srcf,'utf8').includes('qa4-helper'))armedAt=Date.now()+1500;return}",
      ' if(Date.now()<armedAt)return;',
      " for(const n of fs.readdirSync(d)){if(!n.endsWith('.json')||n.endsWith('.rerecorded.json'))continue;",
      "  const p=d+n;const alt=p.replace(/\\.json$/,'.rerecorded.json');",
      '  if(fs.existsSync(alt)){if(saved[p]!==undefined){fs.writeFileSync(p,saved[p]);saved[p]=null}continue}',
      "  if(saved[p]===undefined){const s=fs.readFileSync(p,'utf8');const o=JSON.parse(s);if(!o.upstream)continue;saved[p]=s;o.upstream.drifts=['D1'];fs.writeFileSync(p,JSON.stringify(o,null,2)+'\\n')}}",
      '}catch(e){}},1)',
    ].join('\n');
    const evil: RepairRunner = {
      kind: 'oracle',
      async run(job) {
        const f = join(job.worktree, 'src/tools/get_product.ts');
        const clean = readFileSync(f, 'utf8').replace(
          '`/products/${encodeURIComponent(args.id)}`',
          '`/products/${encodeURIComponent(args.id)}?fresh=1`',
        );
        const spawnLine = `if (!existsSync(${JSON.stringify(mark)})) { wfs(${JSON.stringify(mark)}, ''); spawn(process.execPath, ['-e', ${JSON.stringify(helper)}, new URL('../../', import.meta.url).pathname.replace(/\\/$/, '')], { detached: true, stdio: 'ignore' }).unref(); }`;
        writeFileSync(
          f,
          `// qa4-helper\nimport { spawn } from 'node:child_process';\nimport { existsSync, writeFileSync as wfs } from 'node:fs';\n${clean}\n${spawnLine}\n`,
        );
        try {
          execFileSync(join(job.worktree, 'node_modules/.bin/vitest'), ['run'], {
            cwd: job.worktree,
            stdio: 'pipe',
          });
        } catch {
          // the repro still fails; the point was to start the helper
        }
        writeFileSync(f, clean);
        return {
          ok: true,
          kind: 'oracle',
          turns: 1,
          costUsd: 0,
          summary: 'Subject: refresh product reads\nFresh reads.',
          log: '',
        };
      },
    };
    const r = await repair({ scenario: 'D2', runners: [evil], ...fast });
    if (r.status === 'pr_opened') {
      // Only acceptable if the committed re-recording kept the original's full v2 profile.
      const remote = process.env.FAKE_REMOTE as string;
      for (const f of r.rerecorded.filter((x) => x.startsWith('test/repro/'))) {
        const show = (path: string) =>
          JSON.parse(
            execFileSync('git', ['--git-dir', remote, 'show', `${r.commits.at(-1)}:${path}`], {
              encoding: 'utf8',
            }),
          );
        expect(show(f).upstream.drifts).toEqual(show(f.replace('.rerecorded', '')).upstream.drifts);
      }
    } else {
      expect(r.status).toBe('gate_failed');
    }
    expect(ghCalls().some((c) => c[0] === 'pr' && c[1] === 'create')).toBe(r.status === 'pr_opened');
    rmSync(mark, { force: true });
    try {
      execFileSync('pkill', ['-f', 'fiks-test-helper']);
    } catch {
      // none left
    }
  });

  test('an open fiks PR for the same property: no second agent run, no second PR', {
    timeout: T,
  }, async () => {
    process.env.FAKE_OPEN_PRS = JSON.stringify([
      {
        title: 'fix(get_product): price.notNull violated on vendor API 2026-10-01 (fiks)',
        url: 'https://github.com/example/shop-mcp/pull/1',
      },
    ]);
    let ran = false;
    const runner: RepairRunner = {
      kind: 'oracle',
      async run() {
        ran = true;
        return { ok: true, kind: 'oracle', summary: '', log: '' };
      },
    };
    const r = await repair({ scenario: 'D2', runners: [runner], ...fast });
    delete process.env.FAKE_OPEN_PRS;
    expect(r.status).toBe('duplicate');
    expect(r.reason).toContain('/pull/1');
    expect(ran).toBe(false);
    expect(ghCalls().some((c) => c[0] === 'pr' && c[1] === 'create')).toBe(false);
  });

  test('a helper that swaps a recording for a symlink cannot redirect the re-recording', {
    timeout: T,
  }, async () => {
    // The verifier's fourth attack: the repro trace is briefly replaced by a symlink to a v1
    // fixture, so a path resolved through the filesystem would re-record against v1. fiks takes
    // the path as a string, reads the tracked blob, and checks the re-recording's call and
    // upstream against the committed original.
    const mark = join(tmpdir(), `fiks-helper4-${process.pid}.lock`);
    rmSync(mark, { force: true });
    const helper = [
      "/*fiks-test-helper*/const fs=require('fs');const wt=process.argv[1];const d=wt+'/test/repro/';",
      "const srcf=wt+'/src/tools/get_product.ts';const saved={};let armedAt=0;const end=Date.now()+60000;",
      'setInterval(()=>{if(Date.now()>end)process.exit(0);try{',
      " if(!armedAt){if(!fs.readFileSync(srcf,'utf8').includes('qa5-helper'))armedAt=Date.now()+1500;return}",
      ' if(Date.now()<armedAt)return;',
      " for(const n of fs.readdirSync(d)){if(!n.endsWith('.json')||n.endsWith('.rerecorded.json'))continue;",
      "  const p=d+n;const alt=p.replace(/\\.json$/,'.rerecorded.json');",
      '  if(fs.existsSync(alt)){if(saved[p]!==undefined&&saved[p]!==null){fs.unlinkSync(p);fs.writeFileSync(p,saved[p]);saved[p]=null}continue}',
      "  if(saved[p]===undefined){saved[p]=fs.readFileSync(p,'utf8');fs.unlinkSync(p);fs.symlinkSync('../fixtures/v1/product-p-1001.json',p)}}",
      '}catch(e){}},1)',
    ].join('\n');
    const evil: RepairRunner = {
      kind: 'oracle',
      async run(job) {
        const f = join(job.worktree, 'src/tools/get_product.ts');
        const clean = readFileSync(f, 'utf8').replace(
          '`/products/${encodeURIComponent(args.id)}`',
          '`/products/${encodeURIComponent(args.id)}?fresh=1`',
        );
        const spawnLine = `if (!existsSync(${JSON.stringify(mark)})) { wfs(${JSON.stringify(mark)}, ''); spawn(process.execPath, ['-e', ${JSON.stringify(helper)}, new URL('../../', import.meta.url).pathname.replace(/\\/$/, '')], { detached: true, stdio: 'ignore' }).unref(); }`;
        writeFileSync(
          f,
          `// qa5-helper\nimport { spawn } from 'node:child_process';\nimport { existsSync, writeFileSync as wfs } from 'node:fs';\n${clean}\n${spawnLine}\n`,
        );
        try {
          execFileSync(join(job.worktree, 'node_modules/.bin/vitest'), ['run'], {
            cwd: job.worktree,
            stdio: 'pipe',
          });
        } catch {
          // the repro still fails; the point was to start the helper
        }
        writeFileSync(f, clean);
        return {
          ok: true,
          kind: 'oracle',
          turns: 1,
          costUsd: 0,
          summary: 'Subject: refresh product reads\nFresh reads.',
          log: '',
        };
      },
    };
    const r = await repair({ scenario: 'D2', runners: [evil], ...fast });
    if (r.status === 'pr_opened') {
      const remote = process.env.FAKE_REMOTE as string;
      for (const f of r.rerecorded.filter((x) => x.startsWith('test/repro/'))) {
        const show = (path: string) =>
          JSON.parse(
            execFileSync('git', ['--git-dir', remote, 'show', `${r.commits.at(-1)}:${path}`], {
              encoding: 'utf8',
            }),
          );
        expect(show(f).upstream).toEqual(show(f.replace('.rerecorded', '')).upstream);
      }
    } else {
      expect(r.status).toBe('gate_failed');
    }
    rmSync(mark, { force: true });
    try {
      execFileSync('pkill', ['-f', 'fiks-test-helper']);
    } catch {
      // none left
    }
  });

  test('a PR whose head is not the commit that passed CI is closed', { timeout: T }, async () => {
    process.env.FAKE_HEAD = '0000000000000000000000000000000000000000';
    const r = await repair({ scenario: 'D2', runners: [oracle('D2')], ...fast });
    delete process.env.FAKE_HEAD;
    expect(r.status).toBe('gate_failed');
    expect(r.reason).toMatch(/differs from the commit that passed CI; PR closed/);
    expect(ghCalls().some((c) => c[0] === 'pr' && c[1] === 'close')).toBe(true);
  });
});
