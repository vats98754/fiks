// Catalog authoring with a stub llm (PLAN 3.1, 5.1, 8.1 A0(a)): the catalog export holds only the
// public docs and the brief; `--batches 3` gives 75 entities with 3 distinct authorBatch ids in a
// namespace disjoint from the original ids; each batch session's prompt holds no other batch's
// output (and each runs in its own fresh export); --top-up continues the batch numbering.
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CATALOG as SHOP_ORIGINAL, validateExtended as validateShop } from '@fiks/vendor-api';
import { CATALOG as TRACKER_ORIGINAL, validateExtended as validateTracker } from '@fiks/vendor-tracker';
import { describe, expect, test } from 'vitest';
import { authorCatalog, EXTENDED_PATHS } from '../src/catalog.ts';
import { readManifest } from '../src/export.ts';
import { stubDeps } from '../src/stub.ts';
import catalogStub from './stubs/catalog.ts';
import { fiks, STUBS } from './support/cli.ts';

describe.each(['shop', 'tracker'] as const)('catalog %s', (domain) => {
  test('--batches 3: 75 entities, 3 authorBatch ids, disjoint ids, independent prompts and exports', async () => {
    const outRoot = mkdtempSync(join(tmpdir(), 'blind-cat-'));
    const deps = stubDeps(catalogStub);
    const r = await authorCatalog({ domain, batches: 3, outRoot, model: 'claude-opus-5-5', deps });
    expect(r.added).toBe(75);
    const file = JSON.parse(readFileSync(join(outRoot, EXTENDED_PATHS[domain]), 'utf8')) as {
      entities: Record<string, unknown>[];
    };
    expect(file.entities).toHaveLength(75);
    // Loads with the vendor's own validator.
    if (domain === 'shop') validateShop(file);
    else validateTracker(file);
    const batches = [...new Set(file.entities.map((e) => e.authorBatch))];
    expect(batches).toEqual(['b001', 'b002', 'b003']);
    const ids = file.entities.map((e) => String(domain === 'shop' ? e.id : e.key));
    expect(new Set(ids).size).toBe(75);
    const original = new Set<string>(
      domain === 'shop' ? SHOP_ORIGINAL.map((p) => p.id) : TRACKER_ORIGINAL.map((i) => i.key),
    );
    expect(ids.filter((i) => original.has(i))).toEqual([]);
    expect(ids.every((i) => (domain === 'shop' ? /^px-b00\d-\d\d$/ : /^TX-B00\d-\d\d$/).test(i))).toBe(true);
    // Each batch: its own session, the same prompt (the brief only), no other batch's output.
    expect(deps.calls).toHaveLength(3);
    const names = (k: number) =>
      file.entities.filter((e) => e.authorBatch === `b00${k + 1}`).map((e) => String(e.name ?? e.title));
    for (const [i, call] of deps.calls.entries()) {
      expect(call.prompt).toBe(deps.calls[0]?.prompt);
      for (let k = 0; k < 3; k++) if (k !== i) for (const n of names(k)) expect(call.prompt).not.toContain(n);
      expect(call.prompt).not.toMatch(/Stub (Widget|issue)/);
    }
    const cwds = deps.calls.map((c) => c.cwd);
    expect(new Set(cwds).size).toBe(3);
    // The catalog export holds only the public docs and the brief.
    for (const cwd of cwds) {
      expect(
        readManifest(cwd)
          .files.map((f) => f.path)
          .sort(),
      ).toEqual(
        domain === 'shop'
          ? ['BRIEF.md', 'docs/openapi.json', 'docs/shop.md']
          : ['BRIEF.md', 'docs/openapi.json', 'docs/tracker.md'],
      );
    }
    // The per-batch log.
    const log = readFileSync(
      join(outRoot, EXTENDED_PATHS[domain].replace('extended.json', 'AUTHORING-catalog.jsonl')),
      'utf8',
    )
      .trim()
      .split('\n')
      .map(
        (l) =>
          JSON.parse(l) as { batch: string; kept: number; transcriptSha256: string; audit: { ok: boolean } },
      );
    expect(log.map((l) => [l.batch, l.kept, l.audit.ok])).toEqual([
      ['b001', 25, true],
      ['b002', 25, true],
      ['b003', 25, true],
    ]);

    // Top-up: one more batch, numbered after the existing ones; a plain run refuses to overwrite.
    const t = await authorCatalog({
      domain,
      batches: 1,
      topUp: true,
      outRoot,
      model: 'm',
      deps: stubDeps(catalogStub),
    });
    expect(t).toMatchObject({ added: 25, total: 100 });
    const after = JSON.parse(readFileSync(join(outRoot, EXTENDED_PATHS[domain]), 'utf8')) as {
      entities: { authorBatch: string }[];
    };
    expect([...new Set(after.entities.map((e) => e.authorBatch))]).toEqual(['b001', 'b002', 'b003', 'b004']);
    await expect(
      authorCatalog({ domain, batches: 1, outRoot, model: 'm', deps: stubDeps(catalogStub) }),
    ).rejects.toThrow(/--top-up/);
  });
});

test('pnpm fiks author --kind catalog --batches 3 (CLI, stub llm)', () => {
  const outRoot = mkdtempSync(join(tmpdir(), 'blind-cat-cli-'));
  const r = fiks([
    'author',
    '--kind',
    'catalog',
    '--domain',
    'shop',
    '--batches',
    '3',
    '--out-root',
    outRoot,
    '--llm-stub',
    join(STUBS, 'catalog.ts'),
  ]);
  expect(r.code, r.out).toBe(0);
  expect(r.out).toMatch(/\+75 entities \(75 total\)/);
  expect(existsSync(join(outRoot, EXTENDED_PATHS.shop))).toBe(true);
});
