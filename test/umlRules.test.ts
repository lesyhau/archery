import { describe, expect, it } from 'vitest';
import { behaviorProblems, sequenceProblems } from '../src/model/umlRules';
import type { CanvasDiagram, LocalEdge, LocalNode, Message, SequenceStep } from '../src/model/schema';

const msg = (from: string | undefined, to: string | undefined, label: string, kind: Message['kind'] = 'sync'): SequenceStep => ({ msg: { from, to, label, kind } });
const reply = (from: string, to: string, label = 'ok') => msg(from, to, label, 'reply');

describe('sequence diagrams: UML 2 call / reply rules', () => {
  it('accepts nested calls answered in order', () => {
    expect(
      sequenceProblems([msg('web', 'orders', 'place()'), msg('orders', 'db', 'insert()'), reply('db', 'orders', 'id'), msg('orders', 'orders', 'check()', 'self'), msg('orders', 'bus', 'placed', 'async'), reply('orders', 'web', 'order')]),
    ).toEqual([]);
  });

  it('reports a call without a reply', () => {
    expect(sequenceProblems([msg('web', 'orders', 'place()')])).toEqual(['Synchronous message "place()" from web to orders has no reply from orders']);
  });

  it('reports a reply that answers nothing, and replies out of order', () => {
    expect(sequenceProblems([msg('a', 'b', 'x', 'async'), reply('b', 'a')])).toEqual(['Reply "ok" from b to a answers no synchronous message from a to b']);
    expect(sequenceProblems([msg('a', 'b', 'x'), msg('b', 'c', 'y'), reply('b', 'a')])).toEqual(['Synchronous message "y" from b to c has no reply before the reply "ok" from b to a']);
  });

  it('reports a caller that sends while it waits, once', () => {
    const problems = sequenceProblems([msg('a', 'b', 'x'), msg('a', 'c', 'y', 'async'), msg('a', 'c', 'z', 'async'), reply('b', 'a')]);
    expect(problems).toEqual(['a sends "y" while it waits for the reply to synchronous message "x" from a to b']);
  });

  it('allows callbacks to the waiting caller', () => {
    expect(sequenceProblems([msg('a', 'b', 'x'), msg('b', 'a', 'cb()'), msg('a', 'c', 'n', 'async'), reply('a', 'b'), reply('b', 'a')])).toEqual([]);
  });

  it('accepts replies in every alt operand, and an early reply in break', () => {
    const alt: SequenceStep = { fragment: 'alt', branches: [{ guard: 'found', steps: [reply('s', 'c', 'item')] }, { guard: 'else', steps: [reply('s', 'c', '404')] }] };
    expect(sequenceProblems([msg('c', 's', 'get()'), alt])).toEqual([]);
    const brk: SequenceStep = { fragment: 'break', branches: [{ guard: 'invalid', steps: [reply('s', 'c', '400')] }] };
    expect(sequenceProblems([msg('c', 's', 'get()'), brk, reply('s', 'c', 'item')])).toEqual([]);
  });

  it('reports a call left open in a fragment operand', () => {
    const opt: SequenceStep = { fragment: 'opt', branches: [{ steps: [msg('s', 'db', 'load()')] }] };
    expect(sequenceProblems([opt, msg('db', 's', 'rows', 'reply')])).toEqual(['Synchronous message "load()" from s to db has no reply within its opt operand', 'Reply "rows" from db to s answers no synchronous message from s to db']);
  });

  it('reports messages to a destroyed lifeline until it is created again', () => {
    expect(sequenceProblems([msg('a', 'b', '', 'destroy'), msg('a', 'b', 'ping', 'async'), msg('a', 'b', '', 'create'), msg('a', 'b', 'ping', 'async')])).toEqual(['"ping" from a to b uses b after it was destroyed']);
  });

  it('needs no reply for found, lost, create and destroy messages', () => {
    expect(sequenceProblems([msg(undefined, 'a', 'tick', 'found'), msg('a', undefined, 'log', 'lost'), msg('a', 'b', '', 'create'), msg('a', 'b', '', 'destroy')])).toEqual([]);
  });
});

const canvas = (type: CanvasDiagram['type'], nodes: [string, LocalNode['kind'], string?][], edges: [string, string, string?, LocalEdge['kind']?][]): CanvasDiagram => ({
  version: 1,
  type,
  title: '',
  nodes: [],
  edges: [],
  local: {
    nodes: nodes.map(([id, kind, parent]) => ({ id, kind, x: 0, y: 0, ...(parent ? { parent } : {}) })),
    edges: edges.map(([from, to, label, kind]) => ({ id: `${from}-${to}`, kind: kind ?? (type === 'state' ? 'transition' : 'flow'), from, to, waypoints: [], ...(label ? { label } : {}) })),
  },
});

describe('state machines and activities: UML 2 node rules', () => {
  it('accepts a well-formed state machine and activity', () => {
    expect(behaviorProblems(canvas('state', [['i', 'initial'], ['a', 'state'], ['c', 'choice'], ['f', 'final']], [['i', 'a', '/ init()'], ['a', 'c', 'pay'], ['c', 'f', '[ok]'], ['c', 'a', '[else]']]))).toEqual([]);
    expect(behaviorProblems(canvas('activity', [['i', 'initial'], ['d', 'decision'], ['x', 'fork'], ['p', 'action'], ['q', 'action'], ['j', 'join'], ['f', 'activityFinal'], ['ff', 'flowFinal']], [['i', 'd'], ['d', 'x', '[in stock]'], ['d', 'ff', '[sold out]'], ['x', 'p'], ['x', 'q'], ['p', 'j'], ['q', 'j'], ['j', 'f']]))).toEqual([]);
  });

  it('reports broken pseudostates and control nodes', () => {
    const problems = behaviorProblems(
      canvas('state', [['i', 'initial'], ['i2', 'initial'], ['a', 'state'], ['b', 'state'], ['c', 'choice'], ['f', 'final'], ['k', 'fork']], [['i', 'a', 'start'], ['f', 'a'], ['a', 'c'], ['c', 'a', '[x]'], ['c', 'b'], ['a', 'k'], ['k', 'b'], ['i2', 'b']]),
    );
    expect(problems).toEqual([
      'The transition "i-a" from Initial node "i" has a trigger or guard ("start"); it can only have an effect ("/ action")',
      'Choice "c" has transitions going out without a guard ("c-b"); give each a [condition] or [else]',
      'Final state "f" has 1 transition going out; it can have none',
      'Fork "k" has 1 transition coming in and 1 going out; it needs one in and at least two out',
      'The state machine has 2 initial pseudostates ("i", "i2"); a region can have one',
    ]);
  });

  it('reports the wrong edge kind for the diagram type', () => {
    expect(behaviorProblems(canvas('activity', [['a', 'action'], ['b', 'action']], [['a', 'b', undefined, 'transition']]))).toEqual(['Edge "a-b" is a transition; an activity connects its nodes with flows']);
  });
});
