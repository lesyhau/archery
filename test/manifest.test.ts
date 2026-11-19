import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { languageModelTools } from '../src/ai/toolManifest';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));

describe('package.json', () => {
  it('languageModelTools are generated from src/ops/tools.ts (run `npm run gen:tools` if this fails)', () => {
    expect(pkg.contributes.languageModelTools).toEqual(languageModelTools());
  });

  it('every tool has a valid name and an object input schema', () => {
    for (const t of pkg.contributes.languageModelTools) {
      expect(t.name).toMatch(/^archery_[a-z_]+$/);
      expect(t.inputSchema.type).toBe('object');
    }
  });

  it('declares the @archery chat participant and the Claude Code setup command', () => {
    expect(pkg.contributes.chatParticipants[0].name).toBe('archery');
    expect(pkg.contributes.commands.map((c: { command: string }) => c.command)).toContain('archery.setupClaudeCode');
  });
});
