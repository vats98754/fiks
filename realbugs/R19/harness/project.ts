// R19 text projection (part of the blind contract; see ../contract-log.md).
//
// mongodb-mcp-server's atlas-list-clusters returns text only (no outputSchema, no
// structuredContent), and the outcome-contract evaluator reads structuredContent. This module
// turns the tool's text into a structured view the contract can check, without looking at how the
// tool computes it:
//   reportedCount  N from the summary line "Found N cluster(s)" (null when there is no such line)
//   rowCount       the number of data rows in the cluster table that follows
//   clusters[]     one object per data row, cells by column header
// It is a pure function of the tool result; the contract (../contract.json) is written against it.
import type { ToolResultLike } from '../../../packages/contracts/src/index.ts';

export interface ClusterRow {
  [column: string]: string;
}

export interface ListClustersView {
  reportedCount: number | null;
  rowCount: number;
  clusters: ClusterRow[];
}

const SUMMARY = /\bFound\s+(\d+)\s+clusters?\b/i;
/** A markdown-ish table separator: `----|----|...` (at least two columns). */
const SEPARATOR = /^\s*-{3,}(\s*\|\s*-{3,})+\s*$/;
const TAG = /^\s*<\/?untrusted-user-data-[0-9a-f-]+>\s*$/i;

function texts(result: ToolResultLike): string[] {
  return (result.content ?? [])
    .filter(
      (c): c is { type: 'text'; text: string } =>
        c !== null &&
        typeof c === 'object' &&
        (c as { type?: unknown }).type === 'text' &&
        typeof (c as { text?: unknown }).text === 'string',
    )
    .map((c) => c.text);
}

const cells = (line: string) => line.split('|').map((s) => s.trim());

/** The structured view of an atlas-list-clusters text result, or undefined if it has no text. */
export function projectListClusters(result: ToolResultLike): ListClustersView | undefined {
  const all = texts(result);
  if (all.length === 0) return undefined;
  const joined = all.join('\n');
  const m = SUMMARY.exec(joined);
  const reportedCount = m ? Number(m[1]) : null;

  const lines = joined.split('\n');
  const clusters: ClusterRow[] = [];
  const sep = lines.findIndex((l) => SEPARATOR.test(l));
  if (sep > 0) {
    const header = cells(lines[sep - 1] ?? '');
    for (const line of lines.slice(sep + 1)) {
      if (line.trim() === '' || TAG.test(line) || !line.includes('|')) break;
      const row: ClusterRow = {};
      cells(line).forEach((v, i) => {
        row[header[i] || `col${i}`] = v;
      });
      clusters.push(row);
    }
  }
  return { reportedCount, rowCount: clusters.length, clusters };
}

/**
 * The tool result the contract evaluates: the original result plus the projection as
 * structuredContent (a result that already carries structuredContent is left as it is).
 */
export function withProjection<T extends ToolResultLike>(result: T): T {
  if (result.structuredContent || result.isError) return result;
  const view = projectListClusters(result);
  return view ? { ...result, structuredContent: view as unknown as Record<string, unknown> } : result;
}
