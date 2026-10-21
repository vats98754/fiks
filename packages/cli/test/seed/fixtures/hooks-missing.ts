// Three stub Domains, each omitting one round-5 hook. Each declaration is preceded by a
// ts-expect-error directive, so the file compiles only if every omission is a type error (an
// unused directive fails the compile). domain-hooks.test.ts also compiles a copy with the
// directives stripped and expects tsc to fail.
import type { Domain } from '@fiks/interfaces';
import { stubAllowedEditPaths, stubBase, stubReproEmitter, stubSuite } from './stub.ts';

// @ts-expect-error reproEmitter is required
export const noReproEmitter: Domain = {
  ...stubBase('a'),
  suite: stubSuite,
  allowedEditPaths: stubAllowedEditPaths,
};

// @ts-expect-error suite is required
export const noSuite: Domain = {
  ...stubBase('b'),
  reproEmitter: stubReproEmitter,
  allowedEditPaths: stubAllowedEditPaths,
};

// @ts-expect-error allowedEditPaths is required
export const noAllowedEditPaths: Domain = {
  ...stubBase('c'),
  reproEmitter: stubReproEmitter,
  suite: stubSuite,
};
