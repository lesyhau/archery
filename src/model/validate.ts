// Full validation of a workspace: per-file schemas (load.ts) + cross-file references (checks.ts).
import { checkReferences, type CheckInput } from './checks';
import { loadWorkspace, parseCanvasDiagram, parseSequenceDiagram, parseTimingDiagram, parseYaml, type Issue, type LoadedWorkspace, type WorkspaceReader } from './load';
import { QualityGoalsSchema, QualityRequirementsSchema } from './schema';
import { layoutProblems } from '../render/layoutLint';
import { listForSrc } from '../doc/dataLists';

export async function validateWorkspace(reader: WorkspaceReader): Promise<{ workspace: LoadedWorkspace; issues: Issue[] }> {
  const workspace = await loadWorkspace(reader);
  const input: CheckInput = { model: workspace.model, canvasDiagrams: [], sequenceDiagrams: [], timingDiagrams: [] };

  for (const { file } of workspace.diagrams) {
    const text = (await reader.readText(file)) ?? '';
    if (file.endsWith('.uml.json')) {
      const diagram = parseCanvasDiagram(text, file).value;
      if (diagram) input.canvasDiagrams.push({ file, diagram });
    } else if (file.endsWith('.timing.json')) {
      const diagram = parseTimingDiagram(text, file).value;
      if (diagram) input.timingDiagrams!.push({ file, diagram });
    } else {
      const diagram = parseSequenceDiagram(text, file).value;
      if (diagram) input.sequenceDiagrams.push({ file, diagram });
    }
  }

  const goalsText = await reader.readText('data/quality-goals.yaml');
  if (goalsText !== undefined) input.qualityGoals = parseYaml('data/quality-goals.yaml', goalsText, QualityGoalsSchema).value;
  const reqText = await reader.readText('data/quality-requirements.yaml');
  if (reqText !== undefined) {
    input.qualityRequirements = parseYaml('data/quality-requirements.yaml', reqText, QualityRequirementsSchema).value;
  }

  // Reference checks are only meaningful when model.yaml itself parsed.
  const modelBroken = workspace.issues.some((i) => i.file === 'model.yaml' && i.severity === 'error');
  const issues = [...workspace.issues, ...(modelBroken ? [] : checkReferences(input))];
  issues.push(...(await directiveProblems(reader, workspace)));
  // Layout: what is drawn over something else (with coordinates, for agents that cannot look).
  if (!modelBroken) {
    for (const { file, diagram } of input.canvasDiagrams) {
      for (const message of layoutProblems(diagram, workspace.model)) issues.push({ file, message, severity: 'warning' });
    }
  }
  return { workspace, issues };
}

/** `<!-- archery:diagram <src> ... -->` / `<!-- archery:table <src> ... -->`, outside code blocks. */
const DIRECTIVE = /<!--\s*archery:(diagram|table)\s+((?:(?!-->)\S)+)/g;
const FENCE = /^(```|~~~)[\s\S]*?^\1/gm;

/** Chapter directives that show a diagram or table that does not exist (deleted, renamed, mistyped). */
async function directiveProblems(reader: WorkspaceReader, workspace: LoadedWorkspace): Promise<Issue[]> {
  const issues: Issue[] = [];
  const diagrams = new Set(workspace.diagrams.map((d) => d.file));
  for (const section of workspace.project?.sections ?? []) {
    const text = await reader.readText(section.file);
    if (text === undefined) continue;
    for (const m of text.replace(FENCE, '').matchAll(DIRECTIVE)) {
      const [, kind, src = ''] = m;
      if (kind === 'diagram' && !diagrams.has(src.split('#')[0]!)) {
        issues.push({ file: section.file, message: `Shows diagram "${src}", which does not exist`, severity: 'error' });
      } else if (kind === 'table' && !listForSrc(src)) {
        issues.push({ file: section.file, message: `Shows table "${src}", which is not a data list`, severity: 'error' });
      }
    }
  }
  return issues;
}
