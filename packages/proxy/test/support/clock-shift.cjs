// Test preload: shifts the system clock seen by JavaScript (Date.now(), new Date(), Date())
// by FIKS_TEST_CLOCK_SHIFT_DAYS days. Dates built from explicit values are unchanged.
//   node --require packages/proxy/test/support/clock-shift.cjs ...
'use strict';

const days = Number(process.env.FIKS_TEST_CLOCK_SHIFT_DAYS ?? '0');
if (!Number.isFinite(days)) throw new Error('FIKS_TEST_CLOCK_SHIFT_DAYS must be a number');
const shiftMs = days * 86_400_000;
const RealDate = Date;
const realNow = RealDate.now.bind(RealDate);

function ShiftedDate(...args) {
  if (!new.target) return new RealDate(realNow() + shiftMs).toString();
  return Reflect.construct(RealDate, args.length ? args : [realNow() + shiftMs], new.target);
}
Object.setPrototypeOf(ShiftedDate, RealDate);
ShiftedDate.prototype = RealDate.prototype;
ShiftedDate.now = () => realNow() + shiftMs;
globalThis.Date = ShiftedDate;
