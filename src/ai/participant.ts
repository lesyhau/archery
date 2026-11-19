// `@archery` chat participant for GitHub Copilot Chat. It primes the model with the
// arc42 conventions and the current workspace state and lets it use the Archery tools.
import * as vscode from 'vscode';
import { SECTIONS } from '../template/template';
import { ArcherySession } from '../ops/session';
import { SERVER_INSTRUCTIONS, TOOLS } from '../ops/tools';
import { createReader, findArcheryRoots, readText } from '../workspace';
import { COPILOT_PREFIX } from './toolManifest';

const MAX_TOOL_ROUNDS = 12;

async function runTool(name: string, session: ArcherySession, input: unknown = {}): Promise<unknown> {
  const def = TOOLS.find((t) => t.name === name)!;
  return def.run(session, def.input.parse(input));
}

/** Context text: conventions, workspace overview and (per command) extra material. */
async function buildContext(request: vscode.ChatRequest): Promise<string> {
  const parts = [SERVER_INSTRUCTIONS.replace(/\b(overview|get_section_guide|validate|update_element|write_sequence_diagram|create_diagram)\b/g, `${COPILOT_PREFIX}$1`)];
  const root = (await findArcheryRoots())[0];
  if (!root) {
    parts.push(`There is no architecture documentation in this workspace yet. Offer to create it with ${COPILOT_PREFIX}initialize.`);
    return parts.join('\n\n');
  }
  const session = await ArcherySession.load(createReader(root), vscode.workspace.asRelativePath(root));
  parts.push(`Current documentation (overview):\n${JSON.stringify(await runTool('overview', session), null, 2)}`);

  if (request.command === 'check') {
    parts.push(`Validation result:\n${JSON.stringify(await runTool('validate', session), null, 2)}`);
    parts.push('Explain the problems grouped by file, most severe first, and propose concrete fixes. Apply fixes only if the user asks.');
  }

  if (request.command === 'section') {
    const q = request.prompt.trim().split(/\s+/)[0] ?? '';
    const def = SECTIONS.find((s) => String(s.number) === q.replace(/\.$/, '') || s.id === q);
    if (def) {
      const guide = await runTool('get_section_guide', session, { section: String(def.number) });
      const content = (await readText(vscode.Uri.joinPath(root, 'sections', def.file))) ?? '(file missing)';
      parts.push(`Template guide for section ${def.number}:\n${JSON.stringify(guide, null, 2)}`);
      parts.push(`Current content of ${session.display(`sections/${def.file}`)}:\n\`\`\`markdown\n${content}\n\`\`\``);
      parts.push('Review the section against the guide: what is missing, vague or misplaced. Suggest concrete text. Keep <!-- archery:... --> directives and help comments.');
    } else {
      parts.push('The user did not name a valid section (1-12). Ask which section they mean and list the 12 section titles.');
    }
  }
  return parts.join('\n\n');
}

function historyMessages(context: vscode.ChatContext): vscode.LanguageModelChatMessage[] {
  const messages: vscode.LanguageModelChatMessage[] = [];
  for (const turn of context.history) {
    if (turn instanceof vscode.ChatRequestTurn) {
      messages.push(vscode.LanguageModelChatMessage.User(turn.prompt));
    } else if (turn instanceof vscode.ChatResponseTurn) {
      const text = turn.response
        .map((part) => (part instanceof vscode.ChatResponseMarkdownPart ? part.value.value : ''))
        .join('');
      if (text) messages.push(vscode.LanguageModelChatMessage.Assistant(text));
    }
  }
  return messages;
}

const handler: vscode.ChatRequestHandler = async (request, context, stream, token) => {
  const tools = vscode.lm.tools.filter((t) => t.name.startsWith(COPILOT_PREFIX));
  const messages = [
    vscode.LanguageModelChatMessage.User(
      `You are an assistant for architecture documentation inside VS Code (Archery).\n\n${await buildContext(request)}`,
    ),
    ...historyMessages(context),
    vscode.LanguageModelChatMessage.User(request.prompt || (request.command === 'check' ? 'Check my documentation.' : 'Help me.')),
  ];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await request.model.sendRequest(messages, { tools }, token);
    const calls: vscode.LanguageModelToolCallPart[] = [];
    let text = '';
    for await (const part of response.stream) {
      if (part instanceof vscode.LanguageModelTextPart) {
        stream.markdown(part.value);
        text += part.value;
      } else if (part instanceof vscode.LanguageModelToolCallPart) {
        calls.push(part);
      }
    }
    if (calls.length === 0) return {};

    messages.push(vscode.LanguageModelChatMessage.Assistant([...(text ? [new vscode.LanguageModelTextPart(text)] : []), ...calls]));
    const results: vscode.LanguageModelToolResultPart[] = [];
    for (const call of calls) {
      stream.progress(`Running ${call.name}…`);
      try {
        const result = await vscode.lm.invokeTool(call.name, { input: call.input, toolInvocationToken: request.toolInvocationToken }, token);
        results.push(new vscode.LanguageModelToolResultPart(call.callId, result.content));
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        results.push(new vscode.LanguageModelToolResultPart(call.callId, [new vscode.LanguageModelTextPart(`Error: ${message}`)]));
      }
    }
    messages.push(vscode.LanguageModelChatMessage.User(results));
  }
  stream.markdown('\n\n_Stopped after too many tool calls._');
  return {};
};

export function registerChatParticipant(context: vscode.ExtensionContext): vscode.Disposable[] {
  if (!vscode.chat?.createChatParticipant) return [];
  const participant = vscode.chat.createChatParticipant('archery.assistant', handler);
  participant.iconPath = { light: vscode.Uri.joinPath(context.extensionUri, 'media', 'logo-light.svg'), dark: vscode.Uri.joinPath(context.extensionUri, 'media', 'logo-dark.svg') };
  return [participant];
}
