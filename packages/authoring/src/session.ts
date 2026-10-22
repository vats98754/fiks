// One logged, isolated author session (PLAN 5.2 item 2): LLMR's agentSession with
// settingSources: [], cwd = the export dir, no web tools, every tool call through a permission hook
// that keeps reads and writes inside the export and runs Bash in a `--network none` container.
// Every tool call is logged; the transcript is audited afterwards for forbidden reads, web tools and
// sentinel strings.
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import {
  type AgentSessionOptions,
  type AgentSessionResult,
  agentSession,
  type LlmDeps,
  type SessionBudget,
  WEB_TOOLS,
} from '@fiks/llm';
import { DockerExecBackend, SANDBOX_ENV } from '@fiks/sandbox';
import { TRANSCRIPT_SENTINELS } from './deny.ts';
import { isInside, sha256 } from './export.ts';

export type AuthorTool = 'Read' | 'Glob' | 'Grep' | 'Write' | 'Edit' | 'MultiEdit' | 'Bash';
type CanUseTool = NonNullable<AgentSessionOptions['canUseTool']>;

/** Where an author's Bash commands run. */
export interface BashSandbox {
  describe(): { backend: string; network: string; image: string; container: string };
  run(command: string, timeoutMs: number): Promise<{ code: number; stdout: string; stderr: string }>;
  cleanup(): Promise<void>;
}

/**
 * Bash in a per-session container: `--network none`, read-only root, the export bind-mounted at
 * /work. The container (and a lazily resolved image, e.g. a repo image build) starts on first use.
 */
export function dockerBash(opts: {
  exportDir: string;
  image: string | (() => Promise<string>);
  /** 'image' when the image carries the server's node_modules (repo images); default 'none'. */
  nodeModules?: 'image' | 'none';
  nodeModulesFrom?: string;
  egressLog?: string;
}): BashSandbox {
  let backend: DockerExecBackend | undefined;
  let image = typeof opts.image === 'string' ? opts.image : '';
  const name = `blind-sbx-${Math.random().toString(16).slice(2, 12)}`;
  const get = async () => {
    if (!backend) {
      if (!image) image = await (opts.image as () => Promise<string>)();
      backend = new DockerExecBackend({
        worktree: opts.exportDir,
        image,
        name,
        nodeModules: opts.nodeModules ?? 'none',
        ...(opts.nodeModulesFrom ? { nodeModulesFrom: opts.nodeModulesFrom } : {}),
        env: { ...SANDBOX_ENV },
        ...(opts.egressLog ? { egressLog: opts.egressLog } : {}),
      });
    }
    return backend;
  };
  return {
    describe: () => ({ backend: 'docker', network: 'none', image: image || '(lazy)', container: name }),
    async run(command, timeoutMs) {
      const r = await (await get()).exec('sh', ['-c', command], { timeoutMs });
      return { code: r.code, stdout: r.stdout, stderr: r.stderr };
    },
    async cleanup() {
      await backend?.cleanup();
    },
  };
}

/** Tool-input keys that name a filesystem path, per tool. */
const PATH_KEYS: Record<string, string[]> = {
  Read: ['file_path'],
  Write: ['file_path'],
  Edit: ['file_path'],
  MultiEdit: ['file_path'],
  NotebookEdit: ['notebook_path'],
  Glob: ['path', 'pattern'],
  Grep: ['path'],
  LS: ['path'],
};
const READ_TOOLS = new Set(['Read', 'Glob', 'Grep', 'LS']);

function realish(p: string): string {
  let cur = p;
  const tail: string[] = [];
  for (;;) {
    try {
      return join(realpathSync(cur), ...tail.reverse());
    } catch {
      const parent = dirname(cur);
      if (parent === cur) return p;
      tail.push(cur.slice(parent.length + 1));
      cur = parent;
    }
  }
}

/** Paths named by a tool input that resolve (through symlinks) outside `root`. */
export function outsidePaths(tool: string, input: Record<string, unknown>, root: string): string[] {
  const out: string[] = [];
  for (const k of PATH_KEYS[tool] ?? []) {
    const v = input[k];
    if (typeof v !== 'string' || !v) continue;
    if (k === 'pattern' && !isAbsolute(v) && !v.includes('..')) continue;
    // A glob pattern: check its literal prefix.
    const lit = k === 'pattern' ? v.split(/[*?[{]/)[0] || '.' : v;
    const abs = isAbsolute(lit) ? lit : resolve(root, lit);
    if (!isInside(realish(abs), root)) out.push(v);
  }
  return out;
}

export interface ToolLogEntry {
  at: string;
  tool: string;
  input: Record<string, unknown>;
  decision: 'allow' | 'deny';
  reason?: string;
  forbiddenRead?: boolean;
  bash?: { code: number; container: string; network: string; image: string; outputHead: string };
}

const clip = (input: Record<string, unknown>) => {
  const s = JSON.stringify(input);
  return s.length > 4000 ? { truncated: s.slice(0, 4000) } : input;
};

/** The permission hook: allow-listed tools only, paths inside the export, Bash relayed from the sandbox. */
export function makeAuthorCanUseTool(opts: {
  exportDir: string;
  tools: readonly AuthorTool[];
  toolLog: string;
  bash?: BashSandbox;
  bashTimeoutMs?: number;
}): CanUseTool {
  const root = realpathSync(opts.exportDir);
  const allowed = new Set<string>(opts.tools);
  const relayDir = mkdtempSync(join(tmpdir(), 'blind-relay-'));
  let n = 0;
  const log = (e: ToolLogEntry) => appendFileSync(opts.toolLog, `${JSON.stringify(e)}\n`);
  mkdirSync(dirname(opts.toolLog), { recursive: true });
  if (!existsSync(opts.toolLog)) writeFileSync(opts.toolLog, '');
  return async (tool, input) => {
    const at = new Date().toISOString();
    const deny = (reason: string, forbiddenRead = false) => {
      log({
        at,
        tool,
        input: clip(input),
        decision: 'deny',
        reason,
        ...(forbiddenRead ? { forbiddenRead } : {}),
      });
      return { behavior: 'deny' as const, message: `refused: ${reason}` };
    };
    if ((WEB_TOOLS as readonly string[]).includes(tool)) return deny('web tools are not available');
    if (!allowed.has(tool)) return deny(`tool ${tool} is not allowed in this session`);
    if (tool === 'Bash') {
      if (!opts.bash) return deny('Bash needs the sandbox container');
      const cmd = String(input.command ?? '');
      const r = await opts.bash.run(cmd, opts.bashTimeoutMs ?? 10 * 60_000);
      const relay = join(relayDir, `bash-${++n}.txt`);
      writeFileSync(relay, `${r.stdout}${r.stderr ? `\n[stderr]\n${r.stderr}` : ''}`);
      const d = opts.bash.describe();
      log({
        at,
        tool,
        input: clip(input),
        decision: 'allow',
        reason: 'ran in the sandbox container; the session sees a relay of its output',
        bash: {
          code: r.code,
          container: d.container,
          network: d.network,
          image: d.image,
          outputHead: `${r.stdout}${r.stderr}`.slice(0, 500),
        },
      });
      return {
        behavior: 'allow' as const,
        updatedInput: {
          ...input,
          command: `cat '${relay}'; exit ${Math.max(0, Math.min(255, r.code))}`,
          description: 'relay of the sandboxed command output',
        },
      };
    }
    const outside = outsidePaths(tool, input, root);
    if (outside.length) return deny(`path outside the export: ${outside.join(', ')}`, READ_TOOLS.has(tool));
    log({ at, tool, input: clip(input), decision: 'allow' });
    return { behavior: 'allow' as const, updatedInput: input };
  };
}

export interface TranscriptAudit {
  ok: boolean;
  settingSourcesEmpty: boolean;
  cwd: string | null;
  cwdIsExport: boolean;
  webToolsExcluded: boolean;
  webToolUses: number;
  forbiddenReads: { tool: string; paths: string[] }[];
  sentinelHits: string[];
  bash: { backend: string; network: string } | null;
  bashRuns: number;
}

/** Audits a transcript (+ tool log) of a session that ran in `exportDir`. */
export function auditTranscript(
  transcriptPath: string,
  exportDir: string,
  toolLog?: string,
): TranscriptAudit {
  const root = realpathSync(exportDir);
  const text = readFileSync(transcriptPath, 'utf8');
  const lines = text
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as Record<string, unknown>);
  const header = lines.find((l) => l.type === 'fiks_session_header') ?? {};
  const sb = lines.find((l) => l.type === 'blind_sandbox') as
    | { bash?: { backend: string; network: string } }
    | undefined;
  const forbiddenReads: TranscriptAudit['forbiddenReads'] = [];
  let webToolUses = 0;
  for (const l of lines) {
    if (l.type !== 'assistant') continue;
    const content = ((l.message as { content?: unknown })?.content ?? []) as {
      type?: string;
      name?: string;
      input?: Record<string, unknown>;
    }[];
    for (const b of Array.isArray(content) ? content : []) {
      if (b.type !== 'tool_use' || !b.name) continue;
      if ((WEB_TOOLS as readonly string[]).includes(b.name)) webToolUses++;
      const out = outsidePaths(b.name, b.input ?? {}, root);
      if (out.length) forbiddenReads.push({ tool: b.name, paths: out });
    }
  }
  let bashRuns = 0;
  if (toolLog && existsSync(toolLog)) {
    for (const l of readFileSync(toolLog, 'utf8').split('\n').filter(Boolean)) {
      const e = JSON.parse(l) as ToolLogEntry;
      if (e.forbiddenRead) forbiddenReads.push({ tool: e.tool, paths: [String(e.reason)] });
      if (e.tool === 'Bash' && e.decision === 'allow') bashRuns++;
    }
  }
  const sentinelHits = TRANSCRIPT_SENTINELS.filter(
    (s) => text.includes(s) || text.includes(JSON.stringify(s).slice(1, -1)),
  );
  const tools = (header.tools ?? []) as string[];
  const disallowed = (header.disallowedTools ?? []) as string[];
  const webToolsExcluded =
    header.webTools === 'excluded' && WEB_TOOLS.every((w) => disallowed.includes(w) && !tools.includes(w));
  const cwd = typeof header.cwd === 'string' ? header.cwd : null;
  const settingSourcesEmpty = Array.isArray(header.settingSources) && header.settingSources.length === 0;
  const cwdIsExport = cwd !== null && realish(cwd) === root;
  return {
    ok:
      settingSourcesEmpty &&
      cwdIsExport &&
      webToolsExcluded &&
      webToolUses === 0 &&
      !forbiddenReads.length &&
      !sentinelHits.length,
    settingSourcesEmpty,
    cwd,
    cwdIsExport,
    webToolsExcluded,
    webToolUses,
    forbiddenReads,
    sentinelHits,
    bash: sb?.bash ?? null,
    bashRuns,
  };
}

export interface AuthorSessionOptions {
  kind: string;
  label: string;
  exportDir: string;
  prompt: string;
  model: string;
  tools: AuthorTool[];
  budget: SessionBudget;
  systemPrompt?: string;
  outputSchema?: Record<string, unknown>;
  /** Required when `tools` includes Bash. */
  bash?: BashSandbox;
  /** Transcript and tool log go here. */
  logDir: string;
  runKey?: string;
  llmLogPath?: string;
  deps?: LlmDeps;
}

export interface AuthorSessionRun {
  session: AgentSessionResult;
  transcriptPath: string;
  transcriptSha256: string;
  toolLogPath: string;
  audit: TranscriptAudit;
  startedAt: string;
  endedAt: string;
}

export async function runAuthorSession(o: AuthorSessionOptions): Promise<AuthorSessionRun> {
  if (o.tools.includes('Bash') && !o.bash) throw new Error(`${o.label}: Bash needs a sandbox (dockerBash)`);
  mkdirSync(o.logDir, { recursive: true });
  const transcriptPath = join(o.logDir, `${o.label}.transcript.jsonl`);
  const toolLogPath = join(o.logDir, `${o.label}.tools.jsonl`);
  writeFileSync(toolLogPath, '');
  const canUseTool = makeAuthorCanUseTool({
    exportDir: o.exportDir,
    tools: o.tools,
    toolLog: toolLogPath,
    ...(o.bash ? { bash: o.bash } : {}),
  });
  const startedAt = new Date().toISOString();
  let session: AgentSessionResult;
  try {
    session = await agentSession({
      cwd: o.exportDir,
      prompt: o.prompt,
      model: o.model,
      allowedTools: o.tools,
      budget: o.budget,
      canUseTool,
      transcriptPath,
      label: `${o.kind}:${o.label}`,
      ...(o.systemPrompt !== undefined ? { systemPrompt: o.systemPrompt } : {}),
      ...(o.outputSchema ? { outputSchema: o.outputSchema } : {}),
      ...(o.runKey ? { runKey: o.runKey } : {}),
      ...(o.llmLogPath ? { logPath: o.llmLogPath } : {}),
      ...(o.deps ? { deps: o.deps } : {}),
    });
  } finally {
    if (existsSync(transcriptPath)) {
      appendFileSync(
        transcriptPath,
        `${JSON.stringify({
          type: 'blind_sandbox',
          kind: o.kind,
          exportDir: realpathSync(o.exportDir),
          bash: o.bash ? o.bash.describe() : null,
          toolLog: toolLogPath,
        })}\n`,
      );
    }
    await o.bash?.cleanup();
  }
  const endedAt = new Date().toISOString();
  const audit = auditTranscript(transcriptPath, o.exportDir, toolLogPath);
  return {
    session,
    transcriptPath,
    transcriptSha256: sha256(readFileSync(transcriptPath)),
    toolLogPath,
    audit,
    startedAt,
    endedAt,
  };
}
