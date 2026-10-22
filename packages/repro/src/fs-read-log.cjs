// Node `--require` preload: appends every path this process opens for reading to the file named
// by FIKS_FS_READ_LOG (one absolute path per line, each path once). Used by `fiks rerecord-head`
// (PLAN P23) to find the recordings a check reads, and by tests as an fs spy. Writes nothing else.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { syncBuiltinESMExports } = require('node:module');

const log = process.env.FIKS_FS_READ_LOG;
if (log) {
  const append = fs.appendFileSync;
  const seen = new Set();
  const note = (p) => {
    try {
      let s = null;
      if (typeof p === 'string') s = p;
      else if (p instanceof URL) s = p.protocol === 'file:' ? decodeURIComponent(p.pathname) : null;
      else if (Buffer.isBuffer(p)) s = p.toString('utf8');
      if (!s) return;
      if (s.startsWith('file:')) s = decodeURIComponent(new URL(s).pathname);
      s = path.resolve(s);
      if (s === log || seen.has(s)) return;
      seen.add(s);
      append(log, `${s}\n`);
    } catch {
      // Logging must never change what the process does.
    }
  };
  const wrap = (obj, name, isRead) => {
    const orig = obj[name];
    if (typeof orig !== 'function') return;
    obj[name] = function (p, ...rest) {
      if (isRead(rest)) note(p);
      return orig.call(this, p, ...rest);
    };
  };
  const always = () => true;
  // open/openSync: only read-only opens count as reads.
  const readFlags = (rest) => {
    const flags = rest[0];
    return (
      flags === undefined ||
      typeof flags === 'function' ||
      flags === 'r' ||
      flags === 'rs' ||
      flags === 'r+' ||
      flags === 0
    );
  };
  wrap(fs, 'readFileSync', always);
  wrap(fs, 'readFile', always);
  wrap(fs, 'createReadStream', always);
  wrap(fs, 'openSync', readFlags);
  wrap(fs, 'open', readFlags);
  wrap(fs.promises, 'readFile', always);
  wrap(fs.promises, 'open', readFlags);
  // process.loadEnvFile reads through a native binding, not fs: log it explicitly.
  if (typeof process.loadEnvFile === 'function') {
    const loadEnvFile = process.loadEnvFile;
    process.loadEnvFile = function (p, ...rest) {
      note(p === undefined ? '.env' : p);
      return loadEnvFile.call(this, p, ...rest);
    };
  }
  syncBuiltinESMExports();
}
