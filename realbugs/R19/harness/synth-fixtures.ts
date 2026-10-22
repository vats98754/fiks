// Writes R19's synthesized fixtures (label `synthesized`: there is no Atlas account, so nothing was
// recorded from cloud.mongodb.com). Each fixture is a `Recording` of one atlas-list-clusters call
// with a projectId, holding the upstream exchanges the unmodified server makes:
//   GET  /api/atlas/v2/groups/<id> the project
//   GET  /api/atlas/v2/groups/<id>/clusters
// The replay is plain HTTP (base-URL override), where oauth4webapi refuses the client-credentials
// token request before sending it (HTTPS only), so no token exchange happens and the API requests
// carry no Authorization header. The HTTPS variant is not usable: the server's fetch
// (@mongodb-js/devtools-proxy-support) trusts only the system and bundled CAs, never
// NODE_EXTRA_CA_CERTS, so a throwaway CA is rejected. Neither affects the tool's formatting code.
// Bodies follow the Atlas Admin API v2 schemas in the prefix's src/common/atlas/openapi.d.ts
// (Group, PaginatedClusterDescription20240805). Header names are the ones the prefix sends (they
// are part of the replay key).
//
// usage: pnpm tsx realbugs/R19/harness/synth-fixtures.ts   (rewrites fixtures/ and heldout/)
//   then pnpm tsx realbugs/R19/harness/stamp-trigger.ts (adds the prefix replay's result/violated/target)
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { HttpExchange, Recording } from '../../../packages/contracts/src/index.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const BUG = join(HERE, '..');

export const PROJECT_ID = '68c8a1f2e4b0a1b2c3d4e5f6';
const ORG_ID = '68c8a1d0e4b0a1b2c3d4e500';
const CAPTURED_AT = '2025-09-15T12:00:00.000Z';
const ATLAS_JSON = 'application/vnd.atlas.2025-03-12+json;charset=utf-8';

interface ClusterSpec {
  name: string;
  /** M0 = shared tier (providerName TENANT), else a dedicated tier. */
  tier: string;
  state?: string;
  version?: string;
  /** Omit the connection strings (a cluster still being created). */
  noConnection?: boolean;
}

function clusterBody(c: ClusterSpec, i: number): Record<string, unknown> {
  const host = `${c.name.toLowerCase()}.ab${String(i).padStart(3, '0')}.mongodb.net`;
  const free = c.tier === 'M0';
  return {
    clusterType: 'REPLICASET',
    connectionStrings: c.noConnection
      ? {}
      : { standard: `mongodb://${host}:27017/?ssl=true`, standardSrv: `mongodb+srv://${host}` },
    createDate: '2025-08-01T10:00:00Z',
    groupId: PROJECT_ID,
    id: `68c8a2${String(i).padStart(18, '0')}`,
    mongoDBMajorVersion: (c.version ?? '8.0.13').split('.').slice(0, 2).join('.'),
    mongoDBVersion: c.version ?? '8.0.13',
    name: c.name,
    paused: false,
    replicationSpecs: [
      {
        id: `68c8a3${String(i).padStart(18, '0')}`,
        zoneName: 'Zone 1',
        regionConfigs: [
          free
            ? {
                providerName: 'TENANT',
                backingProviderName: 'AWS',
                regionName: 'US_EAST_1',
                priority: 7,
                electableSpecs: { instanceSize: 'M0' },
              }
            : {
                providerName: 'AWS',
                regionName: 'US_EAST_1',
                priority: 7,
                electableSpecs: { instanceSize: c.tier, nodeCount: 3 },
              },
        ],
      },
    ],
    stateName: c.state ?? 'IDLE',
    terminationProtectionEnabled: false,
  };
}

const json = (status: number, body: unknown, type = ATLAS_JSON) => ({
  status,
  headers: { 'content-type': type },
  body: JSON.stringify(body),
});

function exchanges(projectName: string, clusters: ClusterSpec[]): HttpExchange[] {
  const at = (ms: number) => new Date(Date.parse(CAPTURED_AT) + ms).toISOString();
  const api = { accept: 'application/vnd.atlas.2025-03-12+json' };
  return [
    {
      seq: 0,
      startedAt: at(100),
      durationMs: 60,
      request: { method: 'GET', url: `/api/atlas/v2/groups/${PROJECT_ID}`, headers: api, body: null },
      response: json(200, {
        clusterCount: clusters.length,
        created: '2025-08-01T09:00:00Z',
        id: PROJECT_ID,
        links: [],
        name: projectName,
        orgId: ORG_ID,
        tags: [],
      }),
    },
    {
      seq: 1,
      startedAt: at(200),
      durationMs: 80,
      request: {
        method: 'GET',
        url: `/api/atlas/v2/groups/${PROJECT_ID}/clusters`,
        headers: api,
        body: null,
      },
      response: json(200, {
        links: [],
        results: clusters.map((c, i) => clusterBody(c, i)),
        totalCount: clusters.length,
      }),
    },
  ];
}

export interface R19Fixture extends Recording {
  label: 'synthesized';
  provenance: string;
}

function fixture(id: string, projectName: string, clusters: ClusterSpec[], note: string): R19Fixture {
  return {
    id,
    label: 'synthesized',
    provenance: `Synthesized from the Atlas Admin API v2 schemas (prefix openapi.d.ts); ${note}`,
    capturedAt: CAPTURED_AT,
    tool: 'atlas-list-clusters',
    args: { projectId: PROJECT_ID },
    http: exchanges(projectName, clusters),
  };
}

/** The trigger (fixtures/) and the held-out manifestations (heldout/), by file name. */
export const FIXTURES: Record<string, R19Fixture> = {
  'fixtures/trigger-two-clusters.json': fixture(
    'r19-trigger-two-clusters',
    'fiks-r19',
    [
      { name: 'orders-prod', tier: 'M10' },
      { name: 'sandbox', tier: 'M0' },
    ],
    'trigger: one dedicated and one shared-tier cluster.',
  ),
  'heldout/one-cluster.json': fixture(
    'r19-heldout-one-cluster',
    'fiks-r19-single',
    [{ name: 'Cluster0', tier: 'M0' }],
    'held-out: a single shared-tier cluster.',
  ),
  'heldout/five-mixed.json': fixture(
    'r19-heldout-five-mixed',
    'fiks-r19-mixed',
    [
      { name: 'analytics', tier: 'M30', version: '7.0.21' },
      { name: 'orders-prod', tier: 'M10' },
      { name: 'orders-stage', tier: 'M10', state: 'UPDATING' },
      { name: 'new-cluster', tier: 'M20', state: 'CREATING', noConnection: true },
      { name: 'scratch', tier: 'M0' },
    ],
    'held-out: five clusters with mixed tiers, states and a cluster without connection strings.',
  ),
  'heldout/twelve-clusters.json': fixture(
    'r19-heldout-twelve-clusters',
    'fiks-r19-fleet',
    Array.from({ length: 12 }, (_, i) => ({ name: `shard-${String(i + 1).padStart(2, '0')}`, tier: 'M40' })),
    'held-out: twelve dedicated clusters (count >= 10, two-digit).',
  ),
};

function main(): void {
  for (const [rel, f] of Object.entries(FIXTURES)) {
    const file = join(BUG, rel);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(f, null, 2)}\n`);
    console.log(`wrote ${rel}`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
