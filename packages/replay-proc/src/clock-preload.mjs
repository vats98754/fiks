// Preloaded into a replayed Node server (NODE_OPTIONS=--import <this file's URL>) when
// FIKS_REPLAY_NOW_MS is set: `Date` reads that instant and does not advance, like the
// in-process harness's fake Date. Timers and performance.now() are untouched.
const ms = Number(process.env.FIKS_REPLAY_NOW_MS);
if (process.env.FIKS_REPLAY_NOW_MS && Number.isFinite(ms)) {
  const RealDate = globalThis.Date;
  class FrozenDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(ms);
      else super(...args);
    }
    static now() {
      return ms;
    }
  }
  globalThis.Date = new Proxy(FrozenDate, {
    // `Date()` without `new` returns a string of the current time.
    apply: () => new RealDate(ms).toString(),
  });
}
