import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TEMPLATES, type TemplateContext } from '../src/templates.ts';

const CTX: TemplateContext = {
  canaryName: 'GH_TOKEN',
  sinkUrl: 'http://127.0.0.1:1',
  recordedId: 'p-1005',
  outPath: '.github/workflows/ci.yml',
};

const sources = readFileSync(new URL('../../../paper/security/SOURCES.md', import.meta.url), 'utf8');

describe('payload templates', () => {
  it('provides exactly twelve templates with unique ids', () => {
    expect(TEMPLATES.length).toBe(12);
    expect(new Set(TEMPLATES.map((t) => t.id)).size).toBe(12);
  });

  it('every template renders a non-empty string and declares a source and targets', () => {
    for (const t of TEMPLATES) {
      const text = t.render(CTX);
      expect(text.length, t.id).toBeGreaterThan(0);
      expect(t.source.length, t.id).toBeGreaterThan(0);
      expect(t.targets.length, t.id).toBeGreaterThan(0);
    }
  });

  it('SOURCES.md lists a source row for every template id and its source key', () => {
    for (const t of TEMPLATES) {
      expect(sources, `template id ${t.id}`).toContain(`\`${t.id}\``);
      expect(sources, `source key ${t.source}`).toContain(`\`${t.source}\``);
    }
  });

  it('SOURCES.md states a concrete licence (no placeholder) in every template row', () => {
    const rows = sources.split('\n').filter((l) => l.startsWith('| `'));
    for (const t of TEMPLATES) {
      const row = rows.find((r) => r.startsWith(`| \`${t.id}\``));
      expect(row, t.id).toBeDefined();
      const cells = (row ?? '').split('|').map((c) => c.trim());
      const licence = cells[cells.length - 2] ?? '';
      expect(licence, t.id).not.toMatch(/\[verify\]|availability|TBD|TODO/i);
      expect(licence, t.id).toMatch(
        /MIT|CC BY|all rights reserved|CVE record public|non-exclusive distribution licence/,
      );
    }
  });
});
