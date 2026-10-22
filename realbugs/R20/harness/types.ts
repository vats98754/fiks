// Shared shapes of the R20 harness (Figma-Context-MCP #364).
import type { ToolResultLike } from '../../../packages/contracts/src/index.ts';

export interface Exchange {
  request: { method: string; url: string };
  response: {
    status: number;
    headers?: Record<string, string>;
    /** UTF-8 body (JSON text or SVG). */
    body?: string;
    /** Binary body (PNG). */
    bodyBase64?: string;
  };
}

export interface DownloadNode {
  nodeId: string;
  imageRef?: string;
  gifRef?: string;
  fileName: string;
  needsCropping?: boolean;
  cropTransform?: number[][];
  requiresImageDimensions?: boolean;
  filenameSuffix?: string;
}

export interface DownloadArgs {
  fileKey: string;
  nodes: DownloadNode[];
  localPath: string;
  pngScale?: number;
}

/** A replayable case: the trigger fixture or a held-out input. */
export interface Case {
  id: string;
  label: 'recorded' | 'synthesized';
  capturedAt: string;
  source: string;
  tool: 'download_figma_images';
  args: DownloadArgs;
  server: {
    /** Wiped and recreated before every run; everything under it is listed after the call. */
    root: string;
    /** The server process's cwd (= its default image directory). */
    cwd: string;
    /** Extra server flags, e.g. --image-dir. */
    args?: string[];
    /** Directories to create before the call. */
    mkdirs?: string[];
  };
  upstream: Exchange[];
}

export interface FileEntry {
  path: string;
  type: 'file' | 'dir' | 'symlink' | 'other';
  size: number;
  /** Files only. */
  sha256?: string;
}

/** What the in-sandbox runner reports for one case run. */
export interface CaseRun {
  caseId: string;
  /** The download tool's description from tools/list (announces the image directory). */
  description: string | null;
  result: ToolResultLike | null;
  rpcError: { message: string } | null;
  files: FileEntry[];
  served: string[];
  unmatched: string[];
  denied: string[];
  stderr: string;
}
