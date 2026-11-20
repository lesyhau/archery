import { describe, expect, it } from 'vitest';
import type { CanvasDiagram, Model, SequenceDiagram } from '../src/model/schema';
import { clipToBox, elementPrims, keywordText, layoutCanvas, localNodePrims, propertyLines, relationshipKeywords, relationshipPrims, typedName } from '../src/render/canvasLayout';
import { textWidth } from '../src/render/scene';
import { layoutCommunication, layoutCommunicationWithHits, numberMessages } from '../src/render/communicationLayout';
import { layoutSequence, layoutSequenceWithHits } from '../src/render/sequenceLayout';
import { insertAt, moveWithin, removeMany, stepAt, unwrap, wrap } from '../webview/sequence/steps';

const model: Model = {
  elements: [
    { id: 'customer', kind: 'actor', name: 'Customer' },
    { id: 'orders', kind: 'component', name: 'Order Service', stereotype: 'service' },
    { id: 'pay', kind: 'externalSystem', name: 'Payment Gateway' },
    { id: 'order', kind: 'class', name: 'Order', attributes: [{ name: 'id', type: 'UUID', visibility: '-' }], operations: [{ name: 'total', returns: 'Money', visibility: '+' }] },
  ],
  relationships: [
    { id: 'r1', kind: 'dependency', from: 'orders', to: 'pay', label: 'charge()' },
    { id: 'r2', kind: 'composition', from: 'orders', to: 'order' },
  ],
};

const texts = (scene: { prims: { t: string; text?: string }[] }) => scene.prims.filter((p) => p.t === 'text').map((p) => p.text);

describe('canvas layout', () => {
  const diagram: CanvasDiagram = {
    version: 1,
    type: 'component',
    title: 'T',
    nodes: [
      { ref: 'orders', x: 100, y: 100 },
      { ref: 'pay', x: 400, y: 100 },
      { ref: 'order', x: 100, y: 300 },
      { ref: 'ghost', x: 400, y: 300 },
    ],
    edges: [{ ref: 'r1', waypoints: [] }, { ref: 'r2', waypoints: [] }],
    local: { nodes: [], edges: [] },
  };

  it('draws names, keywords, members, labels and missing elements', () => {
    const scene = layoutCanvas(diagram, model);
    expect(texts(scene)).toEqual(expect.arrayContaining(['«component» «service»', 'Order Service', '«external»', 'Payment Gateway', 'Order', '-id: UUID', '+total(): Money', 'charge()', 'missing: ghost']));
    expect(scene.width).toBeGreaterThan(400);
    // Normalized: nothing is drawn at negative coordinates.
    for (const p of scene.prims) if (p.t === 'rect') expect(p.x).toBeGreaterThanOrEqual(0);
  });

  it('dashes dependencies and fills composition diamonds', () => {
    const paths = layoutCanvas(diagram, model).prims.filter((p) => p.t === 'path');
    expect(paths.some((p) => p.t === 'path' && p.dashed)).toBe(true);
    expect(paths.some((p) => p.t === 'path' && p.fill === 'ink')).toBe(true);
  });

  it('clips connection points to the box border', () => {
    expect(clipToBox({ x: 0, y: 0, w: 100, h: 50 }, 300, 25)).toEqual([100, 25]);
    expect(clipToBox({ x: 0, y: 0, w: 100, h: 50 }, 50, -200)).toEqual([50, 0]);
  });
});

describe('sequence layout', () => {
  const diagram: SequenceDiagram = {
    version: 1,
    type: 'sequence',
    title: 'Place order',
    lifelines: [{ ref: 'customer' }, { ref: 'orders' }, { ref: 'pay' }],
    steps: [
      { msg: { from: 'customer', to: 'orders', label: 'placeOrder()', kind: 'sync' } },
      { msg: { from: 'orders', to: 'orders', label: 'validate()', kind: 'self' } },
      {
        fragment: 'alt',
        branches: [
          { guard: 'payment ok', steps: [{ msg: { from: 'orders', to: 'customer', label: 'confirmation', kind: 'reply' } }] },
          { guard: 'else', steps: [{ msg: { from: 'orders', to: 'customer', label: 'error', kind: 'reply' } }] },
        ],
      },
      { note: 'Async from here', over: ['orders'] },
    ],
  };

  it('lays out lifelines, messages, fragments and notes', () => {
    const scene = layoutSequence(diagram, model);
    expect(texts(scene)).toEqual(expect.arrayContaining([':Customer', ':Order Service', ':Payment Gateway', 'placeOrder()', 'validate()', 'alt', '[payment ok]', '[else]', 'confirmation', 'error', 'Async from here']));
    expect(scene.height).toBeGreaterThan(250);
  });

  it('reports hit areas for lifelines, steps (with paths) and fragment operands, inside the scene', () => {
    const { scene, hits } = layoutSequenceWithHits(diagram, model);
    expect(hits.lifelines.map((l) => l.ref)).toEqual(['customer', 'orders', 'pay']);
    expect(hits.steps.map((s) => s.path.join('.'))).toEqual(['0', '1', '2.0.0', '2.1.0', '2', '3']);
    expect(hits.operands.map((o) => o.path.join('.'))).toEqual(['2.0', '2.1']);
    const inScene = (b: { x: number; y: number; w: number; h: number }) => b.x >= 0 && b.y >= 0 && b.x + b.w <= scene.width + 1 && b.y + b.h <= scene.height + 1;
    for (const s of hits.steps) expect(inScene(s.box), s.path.join('.')).toBe(true);
    // the messages read top to bottom, the operands of the alt one below the other
    const ys = hits.steps.filter((s) => s.kind === 'msg').map((s) => s.y);
    expect([...ys].sort((a, b) => a - b)).toEqual(ys);
    expect(hits.operands[0]!.box.y + hits.operands[0]!.box.h).toBeLessThanOrEqual(hits.operands[1]!.box.y + 1);
    // the layout is the same as the plain one
    expect(scene).toEqual(layoutSequence(diagram, model));
  });

  it('edits the step tree by path: insert into an operand, move, wrap, unwrap, remove', () => {
    const msg = (label: string) => ({ msg: { from: 'customer', to: 'orders', label, kind: 'sync' as const } });
    let steps = insertAt(diagram.steps, [2, 1], 1, msg('retry()'));
    expect((stepAt(steps, [2, 1, 1]) as { msg: { label: string } }).msg.label).toBe('retry()');
    const moved = moveWithin(steps, [1], -1);
    expect(moved.path).toEqual([0]);
    expect((stepAt(moved.steps, [0]) as { msg: { label: string } }).msg.label).toBe('validate()');
    const wrapped = wrap(diagram.steps, [[0], [1]], 'loop')!;
    expect(wrapped.path).toEqual([0]);
    expect(wrapped.steps).toHaveLength(3);
    expect(unwrap(wrapped.steps, [0])).toEqual(diagram.steps);
    expect(wrap(diagram.steps, [[0], [2, 0, 0]])).toBeNull(); // not siblings
    steps = removeMany(diagram.steps, [[0], [2, 0, 0], [3]]);
    expect(steps).toHaveLength(2);
    expect((steps[1] as { branches: { steps: unknown[] }[] }).branches[0]!.steps).toHaveLength(0);
  });

  it('keeps columns apart far enough for long labels', () => {
    const long: SequenceDiagram = { ...diagram, steps: [{ msg: { from: 'customer', to: 'orders', label: 'a very long message label that needs room(arg1, arg2, arg3)', kind: 'async' } }] };
    expect(layoutSequence(long, model).width).toBeGreaterThan(layoutSequence({ ...diagram, steps: [] }, model).width + 100);
  });
});

describe('canvas layout: containment, ports, interfaces, class details', () => {
  const m: Model = {
    elements: [
      { id: 'shop', kind: 'package', name: 'Shop' },
      { id: 'orders', kind: 'component', name: 'Orders', parent: 'shop' },
      { id: 'api', kind: 'port', name: 'api', parent: 'orders' },
      { id: 'IOrders', kind: 'interface', name: 'IOrders' },
      { id: 'web', kind: 'component', name: 'Web' },
      { id: 'repo', kind: 'class', name: 'Repository', typeParams: ['T'], attributes: [{ name: 'size', type: 'int', derived: true, visibility: '+' }] },
      { id: 'book', kind: 'class', name: 'Book' },
      { id: 'lib', kind: 'class', name: 'Library' },
      { id: 'loan', kind: 'class', name: 'Loan' },
      { id: 'login', kind: 'usecase', name: 'Log in' },
    ],
    relationships: [
      { id: 'prov', kind: 'realization', from: 'orders', to: 'IOrders' },
      { id: 'req', kind: 'usage', from: 'web', to: 'IOrders' },
      { id: 'holds', kind: 'association', from: 'lib', to: 'book', qualifier: { from: 'isbn' }, roles: { to: 'books' }, multiplicity: { to: '0..1' }, navigable: { to: true }, associationClass: 'loan' },
    ],
  };
  const d: CanvasDiagram = {
    version: 1,
    type: 'component',
    title: 'T',
    nodes: [
      { ref: 'shop', x: 0, y: 0, w: 100, h: 60 },
      { ref: 'orders', x: 40, y: 80 },
      { ref: 'api', x: 196, y: 104 },
      { ref: 'IOrders', x: 500, y: 100, style: { notation: 'lollipop' } },
      { ref: 'web', x: 700, y: 80 },
      { ref: 'repo', x: 0, y: 400 },
      { ref: 'lib', x: 300, y: 400 },
      { ref: 'book', x: 650, y: 400 },
      { ref: 'loan', x: 450, y: 600 },
      { ref: 'login', x: 900, y: 400 },
    ],
    edges: [{ ref: 'prov', waypoints: [] }, { ref: 'req', waypoints: [] }, { ref: 'holds', waypoints: [] }],
    local: { nodes: [], edges: [] },
  };

  it('grows containers around children and snaps ports to the border', async () => {
    const { layoutNodes } = await import('../src/render/canvasLayout');
    const nodes = layoutNodes(d, m);
    const shop = nodes.get('shop')!.box;
    const orders = nodes.get('orders')!.box;
    expect(nodes.get('shop')!.container).toBe(true);
    expect(shop.x + shop.w).toBeGreaterThanOrEqual(orders.x + orders.w);
    expect(shop.y + shop.h).toBeGreaterThanOrEqual(orders.y + orders.h);
    const api = nodes.get('api')!.box;
    expect(api.x + api.w / 2).toBe(orders.x + orders.w); // right border of Orders
    expect(nodes.get('IOrders')!.lollipop).toBe(true);
  });

  it('draws generics, derived attributes, qualifiers, roles and the association class link', () => {
    const scene = layoutCanvas(d, m);
    expect(texts(scene)).toEqual(expect.arrayContaining(['T', '+/size: int', 'isbn', 'books', '0..1', 'IOrders', 'Log in']));
    // Lollipop + socket: the usage ends in a half circle (Bezier curves; paths never use arc commands,
    // whose radii/flags would be corrupted when the scene is shifted).
    expect(scene.prims.some((p) => p.t === 'path' && p.d.includes('C'))).toBe(true);
    expect(scene.prims.every((p) => p.t !== 'path' || !/[Aa]/.test(p.d))).toBe(true);
    expect(scene.prims.some((p) => p.t === 'ellipse')).toBe(true); // use case
    // Nothing far outside the drawn nodes inflates the scene.
    expect(scene.height).toBeLessThan(800);
  });
});

describe('canvas layout: state machines and activities', () => {
  it('draws every local node kind and transitions with labels', async () => {
    const { LocalNodeKinds } = await import('../src/model/schema');
    const d: CanvasDiagram = {
      version: 1,
      type: 'state',
      title: 'S',
      nodes: [],
      edges: [],
      local: {
        nodes: LocalNodeKinds.map((kind, i) => ({ id: `n${i}`, kind, name: kind === 'state' ? 'Idle' : kind === 'action' ? 'Pay' : undefined, x: (i % 5) * 200, y: Math.floor(i / 5) * 150 })),
        edges: [{ id: 'e1', kind: 'transition', from: 'n0', to: 'n1', label: 'start [ok] / init()', waypoints: [] }],
      },
    };
    const scene = layoutCanvas(d, { elements: [], relationships: [] });
    expect(texts(scene)).toEqual(expect.arrayContaining(['Idle', 'Pay', 'H', 'H*', 'start [ok] / init()']));
  });
});

describe('sequence layout: activations, create/destroy, lost/found, operators, constraints', () => {
  it('handles the full message and fragment vocabulary', async () => {
    const { FragmentOperators } = await import('../src/model/schema');
    const d: SequenceDiagram = {
      version: 1,
      type: 'sequence',
      title: 'All',
      lifelines: [{ ref: 'customer' }, { ref: 'orders' }],
      steps: [
        { msg: { from: 'customer', to: 'orders', label: 'order()', kind: 'sync' } },
        { msg: { from: 'orders', to: 'pay', label: 'new', kind: 'create' } },
        { msg: { from: 'orders', to: 'customer', label: 'ok', kind: 'reply' } },
        { msg: { from: 'orders', label: 'audit', kind: 'lost' } },
        { msg: { to: 'orders', label: 'tick', kind: 'found' } },
        { constraint: 'd < 2s', over: ['orders'] },
        ...FragmentOperators.map((op) => ({ fragment: op, branches: [{ guard: op, steps: [{ msg: { from: 'orders', to: 'orders', label: `${op}()`, kind: 'self' as const } }] }] })),
        { msg: { from: 'orders', to: 'pay', label: '', kind: 'destroy' } },
      ],
    };
    const scene = layoutSequence(d, model);
    expect(texts(scene)).toEqual(expect.arrayContaining(['order()', 'new', 'audit', 'tick', '{d < 2s}', '«destroy»', ...FragmentOperators]));
    // Activation bars are narrow rects on lifelines.
    expect(scene.prims.filter((p) => p.t === 'rect' && p.w === 10).length).toBeGreaterThan(0);
    // Lost/found endpoints are filled circles.
    expect(scene.prims.filter((p) => p.t === 'circle' && p.fill === 'ink').length).toBe(2);
  });
});

describe('UML 2.0 notation (formal/05-07-04)', () => {
  const textsOf = (prims: { t: string; text?: string }[]) => prims.filter((p) => p.t === 'text').map((p) => p.text!);
  const box = { x: 0, y: 0, w: 220, h: 90 };

  it('shows the kind keyword together with the stereotype, with UML spellings', () => {
    expect(keywordText({ kind: 'interface', stereotype: 'service' })).toBe('«interface» «service»');
    expect(keywordText({ kind: 'component' })).toBe('«component»');
    expect(keywordText({ kind: 'executionEnvironment' })).toBe('«executionEnvironment»');
    expect(keywordText({ kind: 'externalSystem' })).toBe('«external»');
    expect(keywordText({ kind: 'node', stereotype: 'device' })).toBe('«device»');
    expect(keywordText({ kind: 'interface', stereotype: 'interface' })).toBe('«interface»');
  });

  it('labels usages «use» and deployments «deploy», keeping a stereotype', () => {
    expect(relationshipKeywords({ kind: 'usage' })).toBe('«use»');
    expect(relationshipKeywords({ kind: 'deploy' })).toBe('«deploy»');
    expect(relationshipKeywords({ kind: 'dependency', stereotype: 'include' })).toBe('«include»');
    expect(relationshipKeywords({ kind: 'usage', stereotype: 'REST' })).toBe('«use» «REST»');
  });

  it('draws tagged values, constraints and instance multiplicity', () => {
    const e = { id: 'db', kind: 'node' as const, name: 'DB server', technology: 'PostgreSQL 16', tags: { owner: 'Ops' }, constraints: ['replicas >= 2'], instances: '3' };
    expect(propertyLines(e)).toEqual(['{technology=PostgreSQL 16, owner=Ops}', '{replicas >= 2}']);
    const t = textsOf(elementPrims(e, 'db', { ...box, w: 320 }));
    expect(t).toEqual(expect.arrayContaining(['DB server', '{technology=PostgreSQL 16, owner=Ops}', '{replicas >= 2}', '3']));
    // A narrower box: the property string breaks after a comma, a long value is cut.
    expect(propertyLines(e, 200)).toEqual(['{technology=PostgreSQL 16,', 'owner=Ops}', '{replicas >= 2}']);
    const long = { ...e, tags: { location: 'packages/service/src/very/long/path/server.ts' } };
    for (const line of propertyLines(long, 150)) expect(textWidth(line, 11)).toBeLessThanOrEqual(150);
  });

  it('puts a package name in the tab only when members are shown inside', () => {
    const pkg = { id: 'p', kind: 'package' as const, name: 'Orders', stereotype: 'subsystem' };
    const empty = elementPrims(pkg, 'p', box).filter((p) => p.t === 'text') as { text: string; y: number }[];
    expect(empty.find((p) => p.text === 'Orders')!.y).toBeGreaterThan(30); // in the body
    expect(empty.find((p) => p.text === '«subsystem»')!.y).toBeLessThan(empty.find((p) => p.text === 'Orders')!.y); // keyword above
    const full = elementPrims(pkg, 'p', box, { container: true }).filter((p) => p.t === 'text') as { text: string; y: number }[];
    expect(full.find((p) => p.text === 'Orders')!.y).toBeLessThan(32); // in the tab
  });

  it('draws the subject of use cases as a plain rectangle (no «component», no icon)', () => {
    const c = { id: 's', kind: 'component' as const, name: 'Webshop' };
    const prims = elementPrims(c, 's', box, { container: true, subject: true });
    expect(textsOf(prims)).toEqual(['Webshop']);
    expect(prims.filter((p) => p.t === 'rect')).toHaveLength(1);
  });

  it('sequence: role : Type labels, constraints on the lifeline, asynchronous lost messages', () => {
    const model: Model = { elements: [{ id: 'a', kind: 'component', name: 'Shop' }, { id: 'b', kind: 'component', name: 'Bank' }], relationships: [] };
    const d: SequenceDiagram = {
      version: 1,
      type: 'sequence',
      title: 'T',
      lifelines: [{ ref: 'a', role: 'web' }, { ref: 'b' }],
      steps: [{ constraint: 'up', over: ['b'] }, { msg: { from: 'a', label: 'ping', kind: 'lost', async: true } }],
    };
    const { scene, hits } = layoutSequenceWithHits(d, model);
    const t = scene.prims.filter((p) => p.t === 'text') as { text: string; x: number; anchor?: string }[];
    expect(t.map((p) => p.text)).toEqual(expect.arrayContaining(['web : Shop', ':Bank']));
    const bank = hits.lifelines.find((l) => l.ref === 'b')!;
    const c = t.find((p) => p.text === '{up}')!;
    expect(c.anchor).toBe('middle');
    expect(Math.abs(c.x - bank.x)).toBeLessThan(1);
    // the asynchronous lost message has an open arrowhead; as a call it would be filled
    const filledPaths = (diagram: SequenceDiagram) => layoutSequence(diagram, model).prims.filter((p) => p.t === 'path' && (p as { fill?: string }).fill === 'ink').length;
    const asCall: SequenceDiagram = { ...d, steps: [{ msg: { from: 'a', label: 'ping', kind: 'lost' } }] };
    const asAsync: SequenceDiagram = { ...d, steps: [{ msg: { from: 'a', label: 'ping', kind: 'lost', async: true } }] };
    expect(filledPaths(asCall)).toBe(filledPaths(asAsync) + 1);
  });
});

describe('object, composite structure and interaction overview diagrams', () => {
  const box = { x: 0, y: 0, w: 220, h: 90 };
  const order = { id: 'order', kind: 'class' as const, name: 'Order' };

  it('draws an instance as "name : Type" underlined with its slots, shaped like its classifier', () => {
    const inst = { id: 'o', kind: 'instance' as const, name: 'order42', classifier: 'order', slots: [{ name: 'total', value: '59.90' }] };
    const prims = elementPrims(inst, 'o', box, { classifier: order });
    const label = prims.find((p) => p.t === 'text' && p.text === 'order42 : Order') as { underline?: boolean } | undefined;
    expect(label?.underline).toBe(true);
    expect(prims.some((p) => p.t === 'text' && p.text === 'total = 59.90')).toBe(true);
    expect(typedName({ ...inst, name: ':' }, order)).toBe(':Order');
    // a node instance keeps the 3D node box
    const nodeInst = elementPrims({ id: 'n', kind: 'instance', name: 'web1', classifier: 'srv' }, 'n', box, { classifier: { id: 'srv', kind: 'node', name: 'AppServer' } });
    expect(nodeInst.filter((p) => p.t === 'path').length).toBeGreaterThanOrEqual(2);
  });

  it('draws parts as "name : Type [m]", dashed for references; collaborations as dashed ellipses', () => {
    const part = elementPrims({ id: 'p', kind: 'part', name: 'store', classifier: 'repo', multiplicity: '1', reference: true }, 'p', box, { classifier: { id: 'repo', kind: 'interface', name: 'Repository' } });
    expect(part.some((p) => p.t === 'text' && p.text === 'store : Repository [1]')).toBe(true);
    expect((part.find((p) => p.t === 'rect') as { dashed?: boolean }).dashed).toBe(true);
    const collab = elementPrims({ id: 'c', kind: 'collaboration', name: 'Checkout' }, 'c', box);
    expect((collab.find((p) => p.t === 'ellipse') as { dashed?: boolean }).dashed).toBe(true);
    const use = elementPrims({ id: 'u', kind: 'collaborationUse', name: 'pay', classifier: 'c' }, 'u', box, { classifier: { id: 'c', kind: 'collaboration', name: 'Checkout' } });
    expect(use.some((p) => p.t === 'text' && p.text === 'pay : Checkout')).toBe(true);
  });

  it('draws ref and sd frames of interaction overview diagrams', () => {
    const ref = localNodePrims({ id: 'r', kind: 'interactionUse', name: 'Place order', x: 0, y: 0 }, box);
    expect(ref.filter((p) => p.t === 'text').map((p) => (p as { text: string }).text)).toEqual(['ref', 'Place order']);
    const sd = localNodePrims({ id: 's', kind: 'interaction', name: 'Ship', x: 0, y: 0 }, box);
    expect(sd.some((p) => p.t === 'text' && (p as { text: string }).text === 'sd Ship')).toBe(true);
  });

  it('draws links as plain lines and manifestations as dashed «manifest» arrows', () => {
    const a = { box: { x: 0, y: 0, w: 100, h: 50 }, outline: 'rect' as const };
    const b = { box: { x: 300, y: 0, w: 100, h: 50 }, outline: 'rect' as const };
    const link = relationshipPrims({ id: 'l', kind: 'link', from: 'a', to: 'b' }, a, b, []);
    expect(link.filter((p) => p.t === 'path')).toHaveLength(1); // the line, no heads
    expect(relationshipKeywords({ kind: 'manifest' })).toBe('«manifest»');
  });

  it('lays out a composite structure: parts inside their structured classifier', () => {
    const model: Model = {
      elements: [
        { id: 'svc', kind: 'component', name: 'Service' },
        { id: 'v', kind: 'class', name: 'Validator' },
        { id: 'p1', kind: 'part', name: 'validator', classifier: 'v', parent: 'svc' },
      ],
      relationships: [],
    };
    const d: CanvasDiagram = { version: 1, type: 'composite', title: 'C', nodes: [{ ref: 'svc', x: 0, y: 0 }, { ref: 'p1', x: 40, y: 80 }], edges: [], local: { nodes: [], edges: [] } };
    const scene = layoutCanvas(d, model);
    expect(scene.prims.some((p) => p.t === 'text' && (p as { text: string }).text === 'validator : Validator')).toBe(true);
  });
});

describe('communication diagrams', () => {
  const model: Model = {
    elements: [
      { id: 'c', kind: 'actor', name: 'Customer' },
      { id: 's', kind: 'component', name: 'Shop' },
      { id: 'p', kind: 'component', name: 'Payment' },
    ],
    relationships: [],
  };
  const steps: SequenceDiagram['steps'] = [
    { msg: { from: 'c', to: 's', label: 'checkout()', kind: 'sync' } },
    { msg: { from: 's', to: 'p', label: 'charge()', kind: 'sync' } },
    { msg: { from: 'p', to: 's', label: 'ok', kind: 'reply' } },
    { fragment: 'alt', branches: [{ guard: 'paid', steps: [{ msg: { from: 's', to: 'p', label: 'capture()', kind: 'async' } }] }] },
    { fragment: 'loop', branches: [{ guard: 'each item', steps: [{ msg: { from: 's', to: 's', label: 'reserve()', kind: 'self' } }] }] },
    { msg: { from: 's', to: 'c', label: 'done', kind: 'reply' } },
    { msg: { from: 'c', to: 's', label: 'logout()', kind: 'sync' } },
  ];
  const d: SequenceDiagram = { version: 1, type: 'sequence', title: 'T', lifelines: [{ ref: 'c' }, { ref: 's' }, { ref: 'p' }], steps, notation: 'communication' };

  it('numbers messages by call nesting, with guards and iterations, and leaves replies out', () => {
    const n = numberMessages(steps).map((m) => `${m.number}${m.guard ? ' ' + m.guard : ''} ${m.msg.label}`);
    expect(n).toEqual(['1 checkout()', '1.1 charge()', '1.2 [paid] capture()', '1.3 *[each item] reserve()', '2 logout()']);
  });

  it('draws participants, links and the numbered messages along them', () => {
    const { scene, hits } = layoutCommunicationWithHits(d, model);
    const texts = scene.prims.filter((p) => p.t === 'text').map((p) => (p as { text: string }).text);
    expect(texts).toEqual(expect.arrayContaining([':Customer', ':Shop', ':Payment', '1: checkout()', '1.1: charge()', '1.2 [paid]: capture()', '1.3 *[each item]: reserve()', '2: logout()']));
    expect(hits.lifelines.map((l) => l.ref)).toEqual(['c', 's', 'p']);
    expect(hits.messages.map((m) => m.path.join('.'))).toEqual(expect.arrayContaining(['0', '1', '3.0.0', '4.0.0', '6']));
    expect(scene.prims.filter((p) => p.t === 'line').length).toBeGreaterThanOrEqual(2);
  });

  it('keeps stored participant positions', () => {
    const placed = layoutCommunicationWithHits({ ...d, positions: { c: { x: 0, y: 0 }, s: { x: 400, y: 0 }, p: { x: 400, y: 300 } } }, model).hits.lifelines;
    const box = (r: string) => placed.find((l) => l.ref === r)!.box;
    expect(Math.round(box('s').x - box('c').x)).toBe(400);
    expect(Math.round(box('p').y - box('s').y)).toBe(300);
    expect(layoutCommunication(d, model).width).toBeGreaterThan(200);
  });
});

