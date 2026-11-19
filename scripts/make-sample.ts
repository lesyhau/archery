// Regenerates sample/docs/architecture (the workspace opened by the F5 launch config): the scaffold
// plus a small webshop documented with every diagram type. Content is created through the
// same operations the editors and AI tools use (src/ops/tools.ts).
// Run with: npm run sample
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { scaffold } from '../src/template/scaffold';
import type { WorkspaceReader } from '../src/model/load';
import { ArcherySession } from '../src/ops/session';
import { TOOLS } from '../src/ops/tools';

const root = join(process.cwd(), 'sample', 'docs', 'architecture');
const files = scaffold({ system: 'Webshop', includeHelp: true });
const reader: WorkspaceReader = {
  readText: async (p) => files.get(p),
  list: async (dir) => [...files.keys()].filter((p) => p.startsWith(`${dir}/`) && !p.slice(dir.length + 1).includes('/')).map((p) => p.slice(dir.length + 1)),
};
async function op(name: string, input: Record<string, unknown>): Promise<any> {
  const def = TOOLS.find((t) => t.name === name)!;
  const session = await ArcherySession.load(reader, '');
  const result = await def.run(session, def.input.parse(input));
  for (const [p, t] of session.changes) files.set(p, t);
  return result;
}

async function main() {
  // --- model + building blocks (section 5) -------------------------------------------
  const bb = 'building-blocks-l1';
  await op('add_element', { name: 'Customer', kind: 'actor', diagram: bb, x: 40, y: 60 });
  await op('add_element', { name: 'Webshop', kind: 'package', diagram: bb, x: 200, y: 20, description: 'The system under design.' });
  await op('add_element', { name: 'Storefront', kind: 'component', parent: 'webshop', diagram: bb, x: 240, y: 90, w: 170, h: 80, description: 'Web UI for browsing and ordering.' });
  await op('add_element', { name: 'Order Service', kind: 'component', parent: 'webshop', stereotype: 'service', diagram: bb, x: 520, y: 90, w: 170, h: 80, description: 'Accepts and validates orders.' });
  await op('add_element', { name: 'Payments', kind: 'interface', diagram: bb, x: 820, y: 118, w: 24, h: 24 });
  await op('set_node_style', { diagram: bb, ref: 'payments', style: { notation: 'lollipop' } });
  await op('add_element', { name: 'Payment Gateway', kind: 'externalSystem', diagram: bb, x: 940, y: 90, w: 170, h: 80, description: 'Third-party payment provider.' });
  await op('add_element', { name: 'api', kind: 'port', parent: 'orderService', diagram: bb, x: 513, y: 123 });
  await op('add_relationship', { kind: 'association', from: 'customer', to: 'storefront', label: 'uses', id: 'r3' });
  await op('add_relationship', { kind: 'dependency', from: 'storefront', to: 'api', label: 'placeOrder()', id: 'r2' });
  await op('add_relationship', { kind: 'usage', from: 'orderService', to: 'payments', id: 'r1' });
  await op('add_relationship', { kind: 'realization', from: 'paymentGateway', to: 'payments', id: 'r4' });

  // --- use cases (section 3) ---------------------------------------------------------------
  const uc = (await op('create_diagram', { title: 'Shopping use cases', type: 'context' })).file.replace(/^.*\//, '').replace('.uml.json', '');
  await op('add_to_diagram', { diagram: uc, elements: ['customer'] });
  await op('move_nodes', { diagram: uc, nodes: [{ id: 'customer', x: 40, y: 110 }] });
  await op('add_element', { name: 'Place order', id: 'ucPlaceOrder', kind: 'usecase', diagram: uc, x: 220, y: 80, extensionPoints: ['payment failed'] });
  await op('add_element', { name: 'Pay', id: 'ucPay', kind: 'usecase', diagram: uc, x: 560, y: 30 });
  await op('add_element', { name: 'Retry payment', id: 'ucRetryPayment', kind: 'usecase', diagram: uc, x: 560, y: 220 });
  await op('add_relationship', { kind: 'association', from: 'customer', to: 'ucPlaceOrder' });
  await op('add_relationship', { kind: 'dependency', from: 'ucPlaceOrder', to: 'ucPay', stereotype: 'include' });
  await op('add_relationship', { kind: 'dependency', from: 'ucRetryPayment', to: 'ucPlaceOrder', stereotype: 'extend', condition: 'card declined', extensionPoint: 'payment failed' });

  // --- deployment (section 7) ----------------------------------------------------------
  const dp = 'deployment-l1';
  await op('add_element', { name: 'Kubernetes cluster', kind: 'node', stereotype: 'cloud', diagram: dp, x: 40, y: 40 });
  await op('add_element', { name: 'web pod', kind: 'executionEnvironment', parent: 'kubernetesCluster', diagram: dp, x: 70, y: 110, w: 200, h: 100 });
  await op('add_element', { name: 'orders pod', kind: 'executionEnvironment', parent: 'kubernetesCluster', diagram: dp, x: 320, y: 110, w: 200, h: 100 });
  await op('add_element', { name: 'storefront.jar', kind: 'artifact', parent: 'webPod', diagram: dp, x: 90, y: 160, w: 150, h: 40 });
  await op('add_element', { name: 'orders.jar', kind: 'artifact', parent: 'ordersPod', diagram: dp, x: 340, y: 160, w: 150, h: 40 });
  await op('add_element', { name: 'PostgreSQL', kind: 'node', stereotype: 'database', diagram: dp, x: 640, y: 120, w: 170, h: 90 });
  await op('add_relationship', { kind: 'deploy', from: 'storefrontJar', to: 'storefront' });
  await op('add_relationship', { kind: 'connector', from: 'ordersPod', to: 'postgreSQL', label: 'JDBC/TLS' });
  await op('add_relationship', { kind: 'connector', from: 'webPod', to: 'ordersPod', label: 'HTTPS' });

  // --- domain model (section 8) -------------------------------------------------------
  const dm = (await op('create_diagram', { title: 'Domain model', type: 'class' })).file.replace(/^.*\//, '').replace('.uml.json', '');
  await op('add_element', { name: 'Order', kind: 'class', diagram: dm, x: 40, y: 40, attributes: [{ name: 'id', type: 'UUID', visibility: '-' }, { name: 'total', type: 'Money', visibility: '+', derived: true }], operations: [{ name: 'submit', visibility: '+' }, { name: 'cancel', params: [{ name: 'reason', type: 'String' }], visibility: '+' }] });
  await op('add_element', { name: 'OrderLine', kind: 'class', diagram: dm, x: 420, y: 40, attributes: [{ name: 'quantity', type: 'int', visibility: '-' }] });
  await op('add_element', { name: 'Product', kind: 'class', diagram: dm, x: 760, y: 40, attributes: [{ name: 'sku', type: 'String', visibility: '-' }, { name: 'price', type: 'Money', visibility: '-' }] });
  await op('add_element', { name: 'OrderStatus', kind: 'enum', diagram: dm, x: 40, y: 300, literals: ['NEW', 'PAID', 'SHIPPED', 'CANCELLED'] });
  await op('add_element', { name: 'Repository', kind: 'interface', typeParams: ['T'], diagram: dm, x: 420, y: 300, operations: [{ name: 'find', params: [{ name: 'id', type: 'UUID' }], returns: 'T', visibility: '+' }, { name: 'save', params: [{ name: 'item', type: 'T' }], visibility: '+' }] });
  await op('add_element', { name: 'Catalog', kind: 'class', diagram: dm, x: 760, y: 300 });
  await op('add_element', { name: 'Discount', kind: 'class', diagram: dm, x: 600, y: 190, w: 120, h: 60 });
  await op('add_relationship', { kind: 'composition', from: 'order', to: 'orderLine', multiplicity: { from: '1', to: '1..*' }, roles: { to: 'lines' } });
  await op('add_relationship', { kind: 'association', from: 'orderLine', to: 'product', multiplicity: { to: '1' }, navigable: { to: true }, associationClass: 'discount' });
  await op('add_relationship', { kind: 'association', from: 'catalog', to: 'product', qualifier: { from: 'sku' }, multiplicity: { to: '0..1' } });
  await op('add_relationship', { kind: 'dependency', from: 'order', to: 'orderStatus' });

  // --- state machine (section 8) ------------------------------------------------------
  const sm = (await op('create_diagram', { title: 'Order lifecycle', type: 'state' })).file.replace(/^.*\//, '').replace('.uml.json', '');
  const n = async (kind: string, x: number, y: number, extra: Record<string, unknown> = {}) => (await op('add_local_node', { diagram: sm, kind, x, y, ...extra })).id as string;
  const init = await n('initial', 40, 70);
  const created = await n('state', 120, 52, { name: 'New', text: 'entry / reserve stock' });
  const active = await n('state', 340, 20, { name: 'Active', w: 360, h: 140 });
  const paid = await n('state', 370, 70, { name: 'Paid', parent: active });
  const shipped = await n('state', 550, 70, { name: 'Shipped', parent: active });
  const hist = await n('history', 352, 34, { parent: active });
  const check = await n('choice', 230, 200);
  const done = await n('final', 760, 76);
  const cancelled = await n('state', 120, 300, { name: 'Cancelled', text: 'entry / release stock' });
  const t = async (from: string, to: string, label?: string) => op('add_local_edge', { diagram: sm, kind: 'transition', from, to, label });
  await t(init, created);
  await t(created, check, 'pay');
  await t(check, paid, '[payment ok]');
  await t(check, cancelled, '[declined]');
  await t(paid, shipped, 'ship / notify()');
  await t(active, done, 'deliver');
  await t(hist, paid);
  // A composite state with two orthogonal regions and entry / exit points on its border.
  const fulfil = await n('state', 520, 220, { name: 'Fulfilment', w: 320, h: 200 });
  const goods = await n('region', 520, 248, { name: 'goods', w: 320, h: 80, parent: fulfil });
  const billing = await n('region', 520, 330, { name: 'billing', w: 320, h: 90, parent: fulfil });
  const packing = await n('state', 600, 270, { name: 'Packing', parent: goods });
  const invoicing = await n('state', 600, 355, { name: 'Invoicing', parent: billing });
  const express = await n('entryPoint', 512, 290, { name: 'express', parent: fulfil });
  const aborted = await n('exitPoint', 512, 380, { name: 'aborted', parent: fulfil });
  await t(check, express, '[express]');
  await t(express, packing);
  await t(aborted, cancelled);
  void invoicing;

  // --- activity (section 6) -----------------------------------------------------------
  const ac = (await op('create_diagram', { title: 'Checkout', type: 'activity' })).file.replace(/^.*\//, '').replace('.uml.json', '');
  const a = async (kind: string, x: number, y: number, extra: Record<string, unknown> = {}) => (await op('add_local_node', { diagram: ac, kind, x, y, ...extra })).id as string;
  const lane1 = await a('partition', 20, 20, { name: 'Customer', w: 240, h: 520 });
  const lane2 = await a('partition', 260, 20, { name: 'Webshop', w: 430, h: 560 });
  const start = await a('initial', 130, 70, { parent: lane1 });
  const fill = await a('action', 70, 120, { name: 'Fill in cart', parent: lane1 });
  const place = await a('sendSignal', 70, 200, { name: 'Place order', parent: lane1 });
  const recv = await a('acceptEvent', 340, 200, { name: 'Order received', parent: lane2 });
  const dec = await a('decision', 396, 280, { parent: lane2 });
  const fork = await a('fork', 345, 350, { parent: lane2, w: 130, h: 8 });
  const payment = await a('interruptibleRegion', 275, 378, { name: 'payment', parent: lane2, w: 400, h: 76 });
  const charge = await a('action', 285, 390, { name: 'Charge', parent: payment, w: 120 });
  const reserve = await a('action', 415, 390, { name: 'Reserve', parent: payment, w: 120 });
  await a('pin', 280, 408, { name: 'amount', parent: charge });
  const timeout = await a('acceptTimeEvent', 610, 388, { name: 'after 30 min', parent: payment });
  const cancelOrder = await a('action', 560, 500, { name: 'Cancel order', parent: lane2, w: 110 });
  const joinBar = await a('join', 345, 460, { parent: lane2, w: 130, h: 8 });
  const end = await a('activityFinal', 398, 490, { parent: lane2 });
  const reject = await a('flowFinal', 500, 284, { parent: lane2 });
  const f = async (from: string, to: string, label?: string) => op('add_local_edge', { diagram: ac, kind: 'flow', from, to, label });
  await f(start, fill);
  await f(fill, place);
  await f(place, recv);
  await f(recv, dec);
  await f(dec, fork, '[in stock]');
  await f(dec, reject, '[sold out]');
  await f(fork, charge);
  await f(fork, reserve);
  await f(charge, joinBar);
  await f(reserve, joinBar);
  await f(joinBar, end);
  await op('add_local_edge', { diagram: ac, kind: 'interrupt', from: timeout, to: cancelOrder });
  await f(cancelOrder, end);

  // --- runtime scenario (section 6) ---------------------------------------------------
  await op('write_sequence_diagram', {
    title: 'Place order',
    lifelines: ['customer', 'storefront', 'orderService', 'paymentGateway'],
    steps: [
      { msg: { from: 'customer', to: 'storefront', label: 'checkout()', kind: 'sync' } },
      { msg: { from: 'storefront', to: 'orderService', label: 'placeOrder(cart)', kind: 'sync' } },
      { msg: { from: 'orderService', to: 'orderService', label: 'validate()', kind: 'self' } },
      { fragment: 'loop', min: 1, max: 3, branches: [{ guard: 'stock not reserved', steps: [{ msg: { from: 'orderService', to: 'orderService', label: 'reserveStock()', kind: 'self' } }] }] },
      { msg: { from: 'orderService', to: 'paymentGateway', label: 'charge(amount)', kind: 'sync' } },
      { constraint: 'response < 2s', over: ['paymentGateway'] },
      {
        fragment: 'alt',
        branches: [
          { guard: 'payment ok', steps: [{ msg: { from: 'paymentGateway', to: 'orderService', label: 'ok', kind: 'reply' } }, { msg: { from: 'orderService', to: 'storefront', label: 'confirmation', kind: 'reply' } }] },
          { guard: 'else', steps: [{ msg: { from: 'paymentGateway', to: 'orderService', label: 'declined', kind: 'reply' } }, { msg: { from: 'orderService', to: 'storefront', label: 'error', kind: 'reply' } }] },
        ],
      },
      { msg: { from: 'orderService', label: 'audit event', kind: 'lost' } },
      { msg: { from: 'orderService', label: 'orderPlaced', kind: 'lost', gate: true, async: true } },
      { msg: { from: 'storefront', to: 'customer', label: 'show result', kind: 'reply' } },
    ],
  });

  // --- the same scenario as a communication diagram (section 6) ------------------------------------
  const placeOrder = JSON.parse(files.get('diagrams/place-order.seq.json')!) as { lifelines: { ref: string }[]; steps: unknown[] };
  await op('write_sequence_diagram', { title: 'Place order (communication)', name: 'place-order-communication', notation: 'communication', lifelines: placeOrder.lifelines.map((l) => l.ref), steps: placeOrder.steps });

  // --- object diagram: an example order (section 8) -------------------------------------------
  const ob = (await op('create_diagram', { title: 'Example order', type: 'object' })).file.replace(/^.*\//, '').replace('.uml.json', '');
  await op('add_element', { name: 'order42', kind: 'instance', classifier: 'order', diagram: ob, x: 40, y: 40, slots: [{ name: 'id', value: '42' }, { name: 'total', value: '59.90 EUR' }] });
  await op('add_element', { name: 'line1', kind: 'instance', classifier: 'orderLine', diagram: ob, x: 360, y: 40, slots: [{ name: 'quantity', value: '2' }] });
  await op('add_element', { name: 'book', kind: 'instance', classifier: 'product', diagram: ob, x: 660, y: 40, slots: [{ name: 'sku', value: 'B-123' }, { name: 'price', value: '29.95 EUR' }] });
  await op('add_relationship', { kind: 'link', from: 'order42', to: 'line1' });
  await op('add_relationship', { kind: 'link', from: 'line1', to: 'book' });

  // --- composite structure: inside the order service (section 5) --------------------------------
  await op('add_element', { name: 'OrderValidator', kind: 'class', description: 'Checks stock, prices and limits.' });
  const cs = (await op('create_diagram', { title: 'Order service internals', type: 'composite' })).file.replace(/^.*\//, '').replace('.uml.json', '');
  await op('add_to_diagram', { diagram: cs, elements: ['orderService'] });
  await op('add_element', { name: 'validator', kind: 'part', classifier: 'orderValidator', parent: 'orderService', diagram: cs, x: 120, y: 120, w: 190, h: 50 });
  await op('add_element', { name: 'store', kind: 'part', classifier: 'repository', multiplicity: '1', reference: true, parent: 'orderService', diagram: cs, x: 420, y: 120, w: 190, h: 50 });
  await op('add_to_diagram', { diagram: cs, elements: ['api'] });
  await op('add_relationship', { kind: 'connector', from: 'api', to: 'validator' });
  await op('add_relationship', { kind: 'connector', from: 'validator', to: 'store' });

  // --- interaction overview: the order flow (section 6) ------------------------------------------
  const io = (await op('create_diagram', { title: 'Order flow', type: 'interactionOverview' })).file.replace(/^.*\//, '').replace('.uml.json', '');
  const ion = async (kind: string, x: number, y: number, extra: Record<string, unknown> = {}) => (await op('add_local_node', { diagram: io, kind, x, y, ...extra })).id as string;
  const ioStart = await ion('initial', 160, 20);
  const ioPlace = await ion('interactionUse', 60, 80, { name: 'Place order', diagram_ref: 'diagrams/place-order.seq.json' });
  const ioPaid = await ion('decision', 156, 180);
  const ioShip = await ion('interaction', 280, 230, { name: 'Ship order', text: 'Warehouse picks and packs\nCarrier collects the parcel' });
  const ioEnd = await ion('activityFinal', 158, 420);
  const iof = (from: string, to: string, label?: string) => op('add_local_edge', { diagram: io, kind: 'flow', from, to, ...(label ? { label } : {}) });
  await iof(ioStart, ioPlace);
  await iof(ioPlace, ioPaid);
  await iof(ioPaid, ioShip, '[paid]');
  await iof(ioPaid, ioEnd, '[declined]');
  await iof(ioShip, ioEnd);

  // --- timing: placing an order against the clock (section 6) -----------------------------------
  await op('write_timing_diagram', {
    title: 'Place order timing',
    unit: 'ms',
    tick: 250,
    lifelines: [
      { ref: 'storefront', form: 'value', states: [], changes: [{ at: 0, state: 'Cart' }, { at: 50, state: 'Spinner' }, { at: 1750, state: 'Confirmation' }] },
      { ref: 'orderService', states: ['Idle', 'Validating', 'Waiting for payment', 'Confirming'], changes: [{ at: 0, state: 'Idle' }, { at: 50, state: 'Validating' }, { at: 300, state: 'Waiting for payment' }, { at: 1550, state: 'Confirming' }, { at: 1750, state: 'Idle' }] },
      { ref: 'paymentGateway', states: ['Idle', 'Authorizing'], changes: [{ at: 0, state: 'Idle' }, { at: 350, state: 'Authorizing' }, { at: 1500, state: 'Idle' }] },
    ],
    messages: [
      { from: 'storefront', to: 'orderService', at: 50, label: 'placeOrder(cart)', kind: 'sync' },
      { from: 'orderService', to: 'paymentGateway', at: 300, arrive: 350, label: 'charge(amount)', kind: 'sync' },
      { from: 'paymentGateway', to: 'orderService', at: 1500, arrive: 1550, label: 'ok', kind: 'reply' },
      { from: 'orderService', to: 'storefront', at: 1750, label: 'confirmation', kind: 'reply' },
      { from: 'orderService', to: 'orderService', at: 50, arrive: 250, label: 'validate()', kind: 'sync' },
      { from: 'paymentGateway', at: 1600, label: 'settlement', kind: 'async' },
    ],
    constraints: [
      { on: 'storefront', from: 50, label: 't = now' },
      { on: 'orderService', from: 300, to: 1550, label: '0..2000' },
    ],
  });

  // --- prose ---------------------------------------------------------------------------
  const edit = (path: string, fn: (text: string) => string) => files.set(path, fn(files.get(path)!));
  edit('sections/01-introduction-and-goals.md', (text) =>
    text.replace(
      /(## Requirements Overview\n\n<!-- archery:help[\s\S]*?-->\n)/,
      `$1\nThe Webshop lets customers browse the catalogue and **place orders** that are paid through an external payment provider.\n\n- Browse and search products\n- Place and pay orders\n- Track order status\n`,
    ),
  );
  edit('sections/06-runtime-view.md', (text) =>
    text.replace(
      '## <Runtime Scenario 1>',
      `## Place an order\n\n<!-- archery:diagram diagrams/place-order.seq.json -->\n\nThe order service charges the payment gateway synchronously and answers the customer either way.\n\n## Checkout workflow\n\n<!-- archery:diagram diagrams/checkout.uml.json -->\n\nThe same scenario as a communication diagram (the numbers show the call nesting):\n\n<!-- archery:diagram diagrams/place-order-communication.seq.json -->\n\n## Order flow\n\n<!-- archery:diagram diagrams/${io}.uml.json -->\n\n## Place order against the clock\n\n<!-- archery:diagram diagrams/place-order-timing.timing.json -->\n\nThe payment gateway must answer within 2 seconds of the charge; the storefront shows a spinner meanwhile.`,
    ),
  );
  edit('sections/03-context-and-scope.md', (text) =>
    text.replace(
      /(## Business Context\n\n<!-- archery:help[\s\S]*?-->\n)/,
      `$1\nCustomers place orders; paying is part of it, and a declined card can be retried:\n\n<!-- archery:diagram diagrams/shopping-use-cases.uml.json -->\n`,
    ),
  );
  edit('sections/05-building-block-view.md', (text) =>
    text.replace('### White Box *<building block 1>*', `### White Box Order Service

<!-- archery:diagram diagrams/${cs}.uml.json -->

The validator checks each order before it is stored; the store is the shared order repository.`),
  );
  edit('sections/08-crosscutting-concepts.md', (text) =>
    text
      .replace('## <Concept 1>', `## Domain model\n\n<!-- archery:diagram diagrams/domain-model.uml.json -->\n\nAn example order:\n\n<!-- archery:diagram diagrams/${ob}.uml.json -->`)
      .replace('## <Concept 2>', `## Order lifecycle\n\n<!-- archery:diagram diagrams/order-lifecycle.uml.json -->`),
  );
  edit('data/quality-goals.yaml', (text) =>
    text.replace(
      'goals: []',
      `goals:\n  - id: availability\n    priority: 1\n    quality: Availability\n    goal: Customers can order 24/7; at most 1 hour of downtime per month.\n  - id: security\n    priority: 2\n    quality: Security\n    goal: Payment data never touches our servers.`,
    ),
  );
  edit('data/stakeholders.yaml', (text) =>
    text.replace(
      'stakeholders: []',
      `stakeholders:\n  - role: Product Owner\n    contact: Product Management\n    expectations: Requirements overview and quality goals kept aligned with the product strategy\n  - role: Development Team\n    contact: Engineering\n    expectations: Clear building blocks (section 5) and runtime scenarios (section 6)`,
    ),
  );

  const { ok, problems } = (await op('validate', {})) as { ok: boolean; problems: unknown[] };
  if (!ok) throw new Error(`sample does not validate: ${JSON.stringify(problems)}`);

  rmSync(root, { recursive: true, force: true });
  for (const [path, content] of files) {
    const target = join(root, ...path.split('/'));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
  console.log(`Wrote ${files.size} files to ${root}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
