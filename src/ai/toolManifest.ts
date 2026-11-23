// Builds the `contributes.languageModelTools` entries for package.json from the shared
// tool definitions. VS Code needs them statically in the manifest, so they are generated
// by `npm run gen:tools` and a test checks that package.json is up to date.
import { z } from 'zod';
import { INITIALIZE_TOOL, TOOLS } from '../ops/tools';
import { withDoc } from '../ops/docs';

export const COPILOT_PREFIX = 'archery_';

export interface LanguageModelToolContribution {
  name: string;
  displayName: string;
  toolReferenceName: string;
  canBeReferencedInPrompt: boolean;
  userDescription: string;
  modelDescription: string;
  icon: string;
  tags: string[];
  inputSchema: Record<string, unknown>;
}

export function toJsonSchema(schema: z.ZodType): Record<string, unknown> {
  // `io: 'input'` makes fields with defaults optional, as callers may omit them.
  const { $schema: _ignored, ...json } = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>;
  return json;
}

export function languageModelTools(): LanguageModelToolContribution[] {
  // Every tool but initialize can name the documentation it works on.
  const defs = [{ ...INITIALIZE_TOOL, readOnly: false }, ...TOOLS.map((t) => ({ ...t, input: withDoc(t.input) }))];
  return defs.map((def) => ({
    name: `${COPILOT_PREFIX}${def.name}`,
    displayName: def.title,
    toolReferenceName: `archery-${def.name.replaceAll('_', '-')}`,
    canBeReferencedInPrompt: true,
    userDescription: def.description.split('\n')[0]!.split(/(?<=\.) /)[0]!,
    modelDescription: def.description,
    icon: def.readOnly ? '$(book)' : '$(edit)',
    tags: ['archery', 'arc42', def.readOnly ? 'read' : 'write'],
    inputSchema: toJsonSchema(def.input),
  }));
}
