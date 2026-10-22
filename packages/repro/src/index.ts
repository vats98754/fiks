export * from './events.ts';
export * from './format.ts';
export * from './gate.ts';
export * from './generate.ts';
export * from './hooks.ts';
export * from './trace-store.ts';
export * from './worktree.ts';

export const name = '@fiks/repro';

/** Absolute path of the fs-read-log preload (`node --require <it>`, env FIKS_FS_READ_LOG). */
export const FS_READ_LOG_PRELOAD = new URL('./fs-read-log.cjs', import.meta.url).pathname;
