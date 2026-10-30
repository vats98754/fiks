// The E-A prompt variants live in @fiks/repair (packages/repair/src/prompt-variants.ts) but are not
// part of its public index (owned by another stream). They are loaded next to the package's
// resolved entry point, so the CLI works wherever @fiks/repair resolves (also from a copied CLI).
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type * as Variants from '../../../repair/src/prompt-variants.ts';

const entry = createRequire(import.meta.url).resolve('@fiks/repair');
const variants = (await import(
  pathToFileURL(join(dirname(entry), 'prompt-variants.ts')).href
)) as typeof Variants;

export const {
  buildAlertPrompt,
  buildNoHintPrompt,
  NOHINT_OMISSIONS,
  noHintPromptWithOmissions,
  renderExchanges,
} = variants;
export type { AlertPromptInput, NoHintOmission, NoHintResult } from '../../../repair/src/prompt-variants.ts';
