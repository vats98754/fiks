#!/usr/bin/env node
// A stand-in for the GitHub CLI in repair tests. It reads the pushed branch from a local bare
// remote, answers `run list` with a CI result chosen by FAKE_CI (success|failure|pending),
// and logs every invocation to FAKE_GH_LOG so tests can assert what was (not) called.
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
appendFileSync(process.env.FAKE_GH_LOG, `${JSON.stringify(args)}\n`);
const [cmd, sub] = args;
const flag = (name) => args[args.indexOf(name) + 1];

if (cmd === 'run' && sub === 'list') {
  const branch = flag('--branch');
  let sha = '';
  try {
    sha = execFileSync('git', ['--git-dir', process.env.FAKE_REMOTE, 'rev-parse', `refs/heads/${branch}`], {
      encoding: 'utf8',
    }).trim();
  } catch {}
  const ci = process.env.FAKE_CI ?? 'success';
  const done = ci !== 'pending';
  console.log(
    JSON.stringify(
      sha
        ? [
            {
              databaseId: 1,
              headSha: sha,
              event: 'push',
              url: 'https://ci.example/run/1',
              status: done ? 'completed' : 'in_progress',
              conclusion: done ? ci : '',
            },
          ]
        : [],
    ),
  );
} else if (cmd === 'label') {
  process.exit(0);
} else if (cmd === 'pr' && sub === 'list') {
  console.log(process.env.FAKE_OPEN_PRS ?? '[]');
} else if (cmd === 'pr' && sub === 'create') {
  writeFileSync(`${process.env.FAKE_GH_LOG}.head`, flag('--head'));
  console.log('https://github.com/example/shop-mcp/pull/7');
} else if (cmd === 'pr' && sub === 'view') {
  const branch = readFileSync(`${process.env.FAKE_GH_LOG}.head`, 'utf8');
  const sha = execFileSync(
    'git',
    ['--git-dir', process.env.FAKE_REMOTE, 'rev-parse', `refs/heads/${branch}`],
    { encoding: 'utf8' },
  ).trim();
  console.log(JSON.stringify({ headRefOid: process.env.FAKE_HEAD ?? sha }));
} else if (cmd === 'pr' && sub === 'close') {
  process.exit(0);
} else {
  console.error(`fake gh: unsupported ${args.join(' ')}`);
  process.exit(1);
}
