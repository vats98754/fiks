// `fiks exp-detect` argument handling (no run is started for bad input).
import { expect, test, vi } from 'vitest';
import command, { runExpDetect } from '../../src/commands/exp-detect.ts';

test('command module and usage errors', async () => {
  expect(command.name).toBe('exp-detect');
  const err = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    expect(await runExpDetect([])).toBe(2);
    expect(await runExpDetect(['bogus'])).toBe(2);
    expect(await runExpDetect(['mutate', '--ops', 'M1,M99'])).toBe(2);
    expect(await runExpDetect(['mutate', '--run', 'x', '--from-fixtures'])).toBe(2);
    expect(err.mock.calls.flat().join('\n')).toContain('unknown operator(s): M99');
  } finally {
    err.mockRestore();
  }
  expect(process.env.FIKS_LLM_FORBID).toBe('1');
});
