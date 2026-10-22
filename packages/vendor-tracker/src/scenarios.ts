// The tracker's scripted calls: the v1 baseline fixture calls (recorded into tracker-mcp's
// test/fixtures/v1) and the scenarios the CLI can run (`fiks scenario <id> --domain tracker`).
import type { DomainFixtureCall, DomainScenario } from '@fiks/interfaces';

/** Recorded in this order in one session against vendor v1 (original catalog, frozen clock). */
export const FIXTURE_CALLS: DomainFixtureCall[] = [
  { slug: 'search-all', tool: 'search_issues', args: {} },
  { slug: 'search-login', tool: 'search_issues', args: { query: 'login' } },
  { slug: 'search-open-bugs', tool: 'search_issues', args: { type: 'bug', state: 'open' } },
  { slug: 'search-label-security', tool: 'search_issues', args: { label: 'security' } },
  { slug: 'search-none', tool: 'search_issues', args: { query: 'teapot' } },
  { slug: 'issue-TRK-101', tool: 'get_issue', args: { key: 'TRK-101' } },
  { slug: 'issue-TRK-113', tool: 'get_issue', args: { key: 'TRK-113' } },
  { slug: 'issue-unknown', tool: 'get_issue', args: { key: 'TRK-999' } },
  { slug: 'comments-TRK-104', tool: 'list_comments', args: { issue_key: 'TRK-104' } },
  { slug: 'comments-TRK-103', tool: 'list_comments', args: { issue_key: 'TRK-103' } },
  {
    slug: 'comment-add',
    tool: 'add_comment',
    args: { issue_key: 'TRK-103', body: 'Picked this up; a draft is coming this week.' },
  },
  { slug: 'transition-TRK-101', tool: 'transition_issue', args: { key: 'TRK-101', to: 'in_progress' } },
  { slug: 'transition-refused', tool: 'transition_issue', args: { key: 'TRK-106', to: 'resolved' } },
  { slug: 'labels-TRK-119', tool: 'update_labels', args: { key: 'TRK-119', add: ['triaged'] } },
  { slug: 'assign-TRK-119', tool: 'assign_issue', args: { key: 'TRK-119', assignee: 'frank' } },
];

export const SCENARIOS: Record<string, DomainScenario> = {
  'v1-all': {
    id: 'v1-all',
    vendor: 'v1',
    calls: FIXTURE_CALLS.map(({ tool, args }) => ({ tool, args })),
    target: [],
  },
};
