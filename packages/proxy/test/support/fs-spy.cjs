// Test preload: appends every path this process opens through node:fs to FIKS_TEST_FS_SPY_LOG
// (one per line), so a test can assert that a file was never opened.
//   NODE_OPTIONS="--require packages/proxy/test/support/fs-spy.cjs" FIKS_TEST_FS_SPY_LOG=<file> ...
'use strict';

const fs = require('node:fs');
const { syncBuiltinESMExports } = require('node:module');

const log = process.env.FIKS_TEST_FS_SPY_LOG;
if (log) {
  const append = fs.appendFileSync;
  const note = (p) => {
    if (typeof p === 'string' || p instanceof URL || Buffer.isBuffer(p)) append(log, `${String(p)}\n`);
  };
  const wrap = (obj, name) => {
    const orig = obj[name];
    if (typeof orig !== 'function') return;
    obj[name] = function spied(p, ...rest) {
      note(p);
      return orig.call(this, p, ...rest);
    };
  };
  for (const name of ['readFileSync', 'openSync', 'readFile', 'open', 'createReadStream']) wrap(fs, name);
  for (const name of ['readFile', 'open']) wrap(fs.promises, name);
  syncBuiltinESMExports();
}
