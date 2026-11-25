// UML 2.5 rules a diagram can break while every reference in it is valid: calls without replies in
// sequence diagrams, and the constraints on pseudostates and control nodes in state machines and
// activities. validate reports them as warnings; write_sequence_diagram returns them at once.
import type { CanvasDiagram, FragmentOperator, Message, SequenceStep } from './schema';

// ---------------------------------------------------------------------------
// Sequence diagrams
// ---------------------------------------------------------------------------

/** A synchronous call waiting for its reply. `waited`: its sender's message while waiting was reported. */
interface Call {
  m: Message;
  waited?: boolean;
}

interface Flow {
  /** Pending synchronous calls, innermost last. */
  calls: Call[];
  /** Lifelines destroyed (and not created again). */
  gone: Set<string>;
}

/** Every operand runs (par, strict ...); exactly one runs (alt); the operand may not run (opt, loop ...). */
const ALL_RUN = new Set<FragmentOperator>(['par', 'seq', 'strict', 'critical', 'assert', 'ignore', 'consider']);

const quoted = (m: Message) => (m.label ? `"${m.label}"` : 'unlabeled message');
const call = (m: Message) => `Synchronous message ${quoted(m)} from ${m.from} to ${m.to}`;

/**
 * UML 2 rules of an interaction: a synchronous call is answered by a reply from its receiver to its
 * sender, after the calls the receiver made meanwhile were answered (replies nest), and within the
 * fragment operand it was made in; its sender sends nothing until then. Replies answer a pending
 * call; destroyed lifelines take part in nothing until created again.
 */
export function sequenceProblems(steps: SequenceStep[]): string[] {
  const out: string[] = [];

  const message = (m: Message, f: Flow) => {
    for (const id of [m.from, m.to]) {
      if (id && f.gone.has(id) && !(m.kind === 'create' && id === m.to)) out.push(`${quoted(m)} from ${m.from ?? 'a found message'} to ${m.to ?? 'a lost message'} uses ${id} after it was destroyed`);
    }
    if (m.kind === 'create' && m.to) f.gone.delete(m.to);
    if (m.kind === 'destroy' && m.to) f.gone.add(m.to);
    if (!m.from || !m.to || m.from === m.to) return; // found, lost and self messages need no reply

    if (m.kind === 'reply') {
      let k = f.calls.length - 1;
      while (k >= 0 && !(f.calls[k]!.m.from === m.to && f.calls[k]!.m.to === m.from)) k--;
      if (k < 0) {
        out.push(`Reply ${quoted(m)} from ${m.from} to ${m.to} answers no synchronous message from ${m.to} to ${m.from}`);
        return;
      }
      for (const c of f.calls.splice(k + 1)) out.push(`${call(c.m)} has no reply before the reply ${quoted(m)} from ${m.from} to ${m.to}`);
      f.calls.pop();
      return;
    }
    // The sender is blocked when it waits for a reply and was not called again since.
    let waiting: Call | undefined;
    for (const c of f.calls) {
      if (c.m.from === m.from) waiting = c;
      else if (c.m.to === m.from) waiting = undefined;
    }
    if (waiting && !waiting.waited) {
      waiting.waited = true;
      out.push(`${m.from} sends ${quoted(m)} while it waits for the reply to ${call(waiting.m).replace('Synchronous message', 'synchronous message')}`);
    }
    if (m.kind === 'sync') f.calls.push({ m });
  };

  const walk = (list: SequenceStep[], f: Flow) => {
    for (const s of list) {
      if ('msg' in s) message(s.msg, f);
      else if ('branches' in s) fragment(s.fragment, s.branches, f);
    }
  };

  const fragment = (op: FragmentOperator, branches: { steps: SequenceStep[] }[], f: Flow) => {
    const entry = new Set(f.calls);
    const ends = branches.map((b) => {
      const g: Flow = { calls: [...f.calls], gone: new Set(f.gone) };
      walk(b.steps, g);
      for (const c of g.calls.filter((c) => !entry.has(c))) out.push(`${call(c.m)} has no reply within its ${op} operand`);
      return { depth: g.calls.filter((c) => entry.has(c)).length, gone: g.gone };
    });
    // Calls answered in every operand that runs are answered after the fragment.
    if (ALL_RUN.has(op)) {
      f.calls.length = Math.min(...ends.map((e) => e.depth));
      for (const e of ends) e.gone.forEach((id) => f.gone.add(id));
    } else if (op === 'alt') {
      f.calls.length = Math.max(...ends.map((e) => e.depth));
      f.gone = new Set([...ends[0]!.gone].filter((id) => ends.every((e) => e.gone.has(id))));
    }
    // opt, break, loop, neg: the operand may not run, so nothing it does carries over.
  };

  const flow: Flow = { calls: [], gone: new Set() };
  walk(steps, flow);
  for (const c of flow.calls) out.push(`${call(c.m)} has no reply from ${c.m.to}`);
  return out;
}

// ---------------------------------------------------------------------------
// State machines and activities
// ---------------------------------------------------------------------------

const NODE_WORD: Record<string, string> = {
  initial: 'Initial node',
  final: 'Final state',
  terminate: 'Terminate pseudostate',
  activityFinal: 'Activity final node',
  flowFinal: 'Flow final node',
  fork: 'Fork',
  join: 'Join',
  choice: 'Choice',
  junction: 'Junction',
  decision: 'Decision node',
  merge: 'Merge node',
  history: 'History pseudostate',
  deepHistory: 'Deep history pseudostate',
};

const hasGuard = (label?: string) => /\[[^\]]*\]/.test(label ?? '');

/**
 * UML 2.5 constraints on pseudostates (14.5.6) and control nodes (15.7) of the diagram's local nodes,
 * and the edge kind its diagram type uses (transitions in state machines, flows in activities).
 */
export function behaviorProblems(diagram: CanvasDiagram): string[] {
  const out: string[] = [];
  const nodes = diagram.local.nodes;
  const stateMachine = diagram.type === 'state';
  const activity = diagram.type === 'activity' || diagram.type === 'interactionOverview';
  const edges = diagram.local.edges.filter((e) => e.kind !== 'anchor');
  const word = stateMachine ? 'transition' : 'flow';

  for (const e of edges) {
    if (stateMachine && e.kind !== 'transition') out.push(`Edge "${e.id}" is a ${e.kind}; a state machine connects states with transitions`);
    if (activity && e.kind === 'transition') out.push(`Edge "${e.id}" is a transition; an activity connects its nodes with flows`);
  }

  const plural = (n: number) => `${n} ${word}${n === 1 ? '' : 's'}`;
  for (const n of nodes) {
    const what = NODE_WORD[n.kind];
    if (!what) continue;
    const name = `${what} "${n.id}"`;
    const incoming = edges.filter((e) => e.to === n.id);
    const outgoing = edges.filter((e) => e.from === n.id);
    switch (n.kind) {
      case 'initial':
        if (incoming.length) out.push(`${name} has ${plural(incoming.length)} coming in; it can have none`);
        if (stateMachine && outgoing.length > 1) out.push(`${name} has ${plural(outgoing.length)} going out; it can have one`);
        for (const e of stateMachine ? outgoing : []) {
          if (e.label?.trim() && !e.label.trim().startsWith('/')) out.push(`The transition "${e.id}" from ${name} has a trigger or guard ("${e.label}"); it can only have an effect ("/ action")`);
        }
        break;
      case 'final':
      case 'terminate':
      case 'activityFinal':
      case 'flowFinal':
        if (outgoing.length) out.push(`${name} has ${plural(outgoing.length)} going out; it can have none`);
        break;
      case 'fork':
        if (incoming.length !== 1 || outgoing.length < 2) out.push(`${name} has ${plural(incoming.length)} coming in and ${outgoing.length} going out; it needs one in and at least two out`);
        break;
      case 'join':
        if (incoming.length < 2 || outgoing.length !== 1) out.push(`${name} has ${plural(incoming.length)} coming in and ${outgoing.length} going out; it needs at least two in and one out`);
        break;
      case 'merge':
        if (outgoing.length > 1) out.push(`${name} has ${plural(outgoing.length)} going out; it can have one (a decision node chooses between several)`);
        break;
      case 'decision':
      case 'choice':
        if (n.kind === 'decision' && incoming.length > 1) out.push(`${name} has ${plural(incoming.length)} coming in; it can have one (a merge node joins several before it)`);
        if (outgoing.length > 1 && outgoing.some((e) => !hasGuard(e.label))) {
          const bare = outgoing.filter((e) => !hasGuard(e.label)).map((e) => `"${e.id}"`).join(', ');
          out.push(`${name} has ${word}s going out without a guard (${bare}); give each a [condition] or [else]`);
        }
        break;
      case 'history':
      case 'deepHistory':
        if (outgoing.length > 1) out.push(`${name} has ${plural(outgoing.length)} going out; it can have one (to the default state)`);
        break;
    }
  }

  // A region (the top level, a region node or a composite state's single region) has at most one initial pseudostate.
  if (stateMachine) {
    const initials = new Map<string, string[]>();
    for (const n of nodes) if (n.kind === 'initial') initials.set(n.parent ?? '', [...(initials.get(n.parent ?? '') ?? []), n.id]);
    for (const [parent, ids] of initials) {
      if (ids.length > 1) out.push(`${parent ? `"${parent}"` : 'The state machine'} has ${ids.length} initial pseudostates (${ids.map((i) => `"${i}"`).join(', ')}); a region can have one`);
    }
  }
  return out;
}
