// Registers the Docker ExecBackend (ORCH; PLAN P1): experiment-mode repairs (`fiks repair --arm`)
// run the agent's allow-listed Bash, the gates, `rerecord-head` and local CI inside one
// per-attempt container made by this factory. The slot is a process-wide symbol, read by
// `commands/repair.ts` (`sandboxBackendFactory()`). Loaded twice under different paths (tests,
// copies of the CLI), the first registration wins. Imports @fiks/sandbox (SBX) only.
import { DockerExecBackend, type DockerExecBackendOptions } from '@fiks/sandbox';

const KEY = Symbol.for('fiks.sandbox.backend.factory');
const slot = globalThis as { [KEY]?: (opts: DockerExecBackendOptions) => DockerExecBackend };

slot[KEY] ??= (opts) => new DockerExecBackend(opts);
