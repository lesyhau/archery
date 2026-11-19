// Full validation of a workspace: per-file schemas (load.ts) + cross-file references (checks.ts).
import { checkReferences, type CheckInput } from './checks';
import { loadWorkspace, parseCanvasDiagram, parseSequenceDiagram, parseTimingDiagram, parseYaml, type Issue, type LoadedWorkspace, type WorkspaceReader } from './load';
import { QualityGoalsSchema, QualityRequirementsSchema } from './schema';

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
  return { workspace, issues };
}
