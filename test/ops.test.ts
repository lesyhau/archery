import { describe, expect, it } from 'vitest';
import { scaffold } from '../src/template/scaffold';
import type { WorkspaceReader } from '../src/model/load';
import { camelSlug, kebabSlug } from '../src/ops/ids';
import { ArcherySession, DELETED, OpError } from '../src/ops/session';
import { TOOLS } from '../src/ops/tools';

export function memoryReader(files: Map<string, string>): WorkspaceReader {
  return {
    readText: async (path) => files.get(path),
    list: async (dir) =>
      [...files.keys()]
        .filter((p) => p.startsWith(`${dir}/`) && !p.slice(dir.length + 1).includes('/'))
        .map((p) => p.slice(dir.length + 1)),
  };
}

/** A fresh scaffolded workspace; `call` runs a tool and commits its changes. */
async function workspace() {
  const files = scaffold({ system: 'Webshop', includeHelp: false });
  const call = async (name: string, args: Record<string, unknown> = {}): Promise<any> => {
    const def = TOOLS.find((t) => t.name === name)!;
    const session = await ArcherySession.load(memoryReader(files), 'docs/architecture');
    const result = await def.run(session, def.input.parse(args));
    for (const [path, text] of session.changes) text === DELETED ? files.delete(path) : files.set(path, text);
    return result;
  };
  return { files, call };
}

describe('ids', () => {
  it('derives readable slugs', () => {
    expect(camelSlug('Order Service')).toBe('orderService');
    expect(camelSlug('Zahlungs-Gateway (extern)')).toBe('zahlungsGatewayExtern');
    expect(camelSlug('3rd party')).toBe('_3rdParty');
    expect(camelSlug('API Gateway')).toBe('apiGateway');
    expect(camelSlug('Order HTTP API')).toBe('orderHttpApi');
    expect(camelSlug('iPhone App')).toBe('iPhoneApp');
    expect(kebabSlug('Building blocks – level 1')).toBe('building-blocks-level-1');
  });
});

describe('model operations', () => {
  it('adds elements with slug ids, unique per model, keeping the YAML header comments', async () => {
    const { files, call } = await workspace();
    expect((await call('add_element', { name: 'Order Service', kind: 'component' })).id).toBe('orderService');
    expect((await call('add_element', { name: 'Order Service', kind: 'component' })).id).toBe('orderService2');
    const yaml = files.get('model.yaml')!;
    expect(yaml).toMatch(/^# Shared architecture model/);
    expect(yaml).toContain('- id: orderService\n    kind: component\n    name: Order Service');
    expect(yaml).toMatch(/\nrelationships: \[\]\n$/); // untouched empty list stays compact
    expect(camelSlug('Crème brûlée')).toBe('cremeBrulee');
  });

  it('renames without changing the id', async () => {
    const { call } = await workspace();
    await call('add_element', { name: 'Order Service', kind: 'component', stereotype: 'service' });
    await call('update_element', { id: 'orderService', name: 'Ordering', stereotype: null });
    const { elements } = await call('get_model');
    expect(elements).toEqual([{ id: 'orderService', kind: 'component', name: 'Ordering' }]);
  });

  it('stores structured details (technology, scenario, tags, generics) and clears them with null', async () => {
    const { call, files } = await workspace();
    await call('add_element', { name: 'Checkout', kind: 'usecase' });
    await call('update_element', {
      id: 'checkout',
      scenario: { trigger: 'Customer clicks Checkout', steps: ['Show the cart', 'Pay'], alternatives: [{ when: 'Payment declined', steps: ['Ask for another card'] }] },
      tags: { owner: 'Team Orders' },
      constraints: ['cart is not empty'],
    });
    await call('add_element', { name: 'Repo', kind: 'class', technology: 'JPA' });
    await call('update_element', { id: 'repo', typeParams: ['T'], responsibilities: ['Load orders'] });
    let { elements } = await call('get_model');
    expect(elements.find((e: { id: string }) => e.id === 'checkout').scenario.alternatives[0].when).toBe('Payment declined');
    expect(elements.find((e: { id: string }) => e.id === 'repo')).toMatchObject({ technology: 'JPA', typeParams: ['T'], responsibilities: ['Load orders'] });
    expect(files.get('model.yaml')).toContain('owner: Team Orders');
    await call('update_element', { id: 'checkout', scenario: null, tags: null });
    ({ elements } = await call('get_model'));
    expect(elements.find((e: { id: string }) => e.id === 'checkout')).toEqual({ id: 'checkout', kind: 'usecase', name: 'Checkout', constraints: ['cart is not empty'] });
  });

  it('adding an element with a sequence diagram makes it the last lifeline', async () => {
    const { call, files } = await workspace();
    await call('add_element', { name: 'Customer', kind: 'actor' });
    await call('write_sequence_diagram', { name: 'checkout', title: 'Checkout', lifelines: ['customer'], steps: [] });
    await call('add_element', { name: 'Shop', kind: 'component', diagram: 'diagrams/checkout.seq.json' });
    expect(JSON.parse(files.get('diagrams/checkout.seq.json')!).lifelines).toEqual([{ ref: 'customer' }, { ref: 'shop' }]);
  });

  it('instances and parts need an existing type', async () => {
    const { call } = await workspace();
    await expect(call('add_element', { name: 'o1', kind: 'instance', classifier: 'nope' })).rejects.toThrow(OpError);
    await call('add_element', { name: 'Order', kind: 'class' });
    await call('add_element', { name: 'o1', kind: 'instance', classifier: 'order', slots: [{ name: 'id', value: '1' }] });
    const { elements } = await call('get_model');
    expect(elements.find((e: { id: string }) => e.id === 'o1')).toMatchObject({ classifier: 'order', slots: [{ name: 'id', value: '1' }] });
  });

  it('rejects unknown references and nesting cycles', async () => {
    const { call } = await workspace();
    await expect(call('add_element', { name: 'X', kind: 'component', parent: 'nope' })).rejects.toThrow(OpError);
    await call('add_element', { name: 'Shop', kind: 'package' });
    await call('add_element', { name: 'Orders', kind: 'component', parent: 'shop' });
    await expect(call('update_element', { id: 'shop', parent: 'orders' })).rejects.toThrow(/cycle/);
  });

  it('adds relationships to diagrams that show both ends', async () => {
    const { call } = await workspace();
    await call('add_element', { name: 'Order Service', kind: 'component' });
    await call('add_element', { name: 'Payment Gateway', kind: 'externalSystem' });
    await call('add_to_diagram', { diagram: 'building-blocks-l1', elements: ['orderService', 'paymentGateway'] });
    const rel = await call('add_relationship', { kind: 'dependency', from: 'orderService', to: 'paymentGateway', label: 'charge()' });
    expect(rel.id).toBe('orderService-paymentGateway');
    expect(rel.shownOn).toEqual(['docs/architecture/diagrams/building-blocks-l1.uml.json']);
    const diagram = await call('get_diagram', { diagram: 'building-blocks-l1' });
    expect(diagram.nodes.map((n: any) => n.name)).toEqual(['Order Service', 'Payment Gateway']);
    expect(diagram.edges).toEqual([{ ref: rel.id, kind: 'dependency', from: 'orderService', to: 'paymentGateway', label: 'charge()' }]);
  });

  it('refuses to delete a used element unless cascading, then cleans up everywhere', async () => {
    const { call } = await workspace();
    await call('add_element', { name: 'Customer', kind: 'actor' });
    await call('add_element', { name: 'Shop', kind: 'component' });
    await call('add_relationship', { kind: 'association', from: 'customer', to: 'shop' });
    await call('create_diagram', { title: 'Context', type: 'context', elements: ['customer', 'shop'] });
    await call('write_sequence_diagram', {
      title: 'Browse',
      steps: [
        { msg: { from: 'customer', to: 'shop', label: 'open()' } },
        { fragment: 'opt', branches: [{ guard: 'logged in', steps: [{ msg: { from: 'shop', to: 'customer', label: 'hello', kind: 'reply' } }] }] },
      ],
    });

    await expect(call('delete_element', { id: 'customer' })).rejects.toThrow(/still used by/);
    await call('delete_element', { id: 'customer', cascade: true });

    expect((await call('get_model')).relationships).toEqual([]);
    expect((await call('get_diagram', { diagram: 'context' })).nodes.map((n: any) => n.ref)).toEqual(['shop']);
    const seq = await call('get_diagram', { diagram: 'browse' });
    expect(seq.lifelines).toEqual([{ ref: 'shop', name: 'Shop' }]);
    expect(seq.steps).toEqual([{ fragment: 'opt', branches: [{ guard: 'logged in', steps: [] }] }]);
    expect((await call('validate')).ok).toBe(true);
  });

  it('adds lifelines used by messages and protects existing sequence diagrams', async () => {
    const { call } = await workspace();
    await call('add_element', { name: 'Customer', kind: 'actor' });
    await call('add_element', { name: 'Shop', kind: 'component' });
    const result = await call('write_sequence_diagram', { title: 'Place order', steps: [{ msg: { from: 'customer', to: 'shop', label: 'order()' } }] });
    expect(result.lifelines).toEqual(['customer', 'shop']);
    await expect(call('write_sequence_diagram', { title: 'Place order', steps: [] })).rejects.toThrow(/overwrite/);
    await expect(call('write_sequence_diagram', { title: 'X', steps: [{ msg: { from: 'ghost', to: 'shop' } }] })).rejects.toThrow(/Unknown element "ghost"/);
  });
});

describe('data operations', () => {
  it('upserts by key field, merges fields and validates before writing', async () => {
    const { files, call } = await workspace();
    await call('upsert_data_item', { list: 'quality-goals', item: { id: 'perf', priority: 1, quality: 'Performance', goal: 'Fast checkout' } });
    await call('upsert_data_item', { list: 'quality-goals', item: { id: 'perf', motivation: 'Conversion rate' } });
    const { items } = await call('get_data', { list: 'quality-goals' });
    expect(items).toEqual([{ id: 'perf', priority: 1, quality: 'Performance', goal: 'Fast checkout', motivation: 'Conversion rate' }]);
    expect(files.get('data/quality-goals.yaml')).toMatch(/^# Section 1.2/);

    await expect(call('upsert_data_item', { list: 'quality-goals', item: { id: 'x', priority: 'high' } })).rejects.toThrow(/invalid/);
    await call('delete_data_item', { list: 'quality-goals', key: 'perf' });
    expect((await call('get_data', { list: 'quality-goals' })).items).toEqual([]);
  });

  it('validate reports scenarios that point to unknown quality goals', async () => {
    const { call } = await workspace();
    await call('upsert_data_item', { list: 'quality-scenarios', item: { id: 's1', name: 'Peak load', goals: ['perf'] } });
    const result = await call('validate');
    expect(result.ok).toBe(false);
    expect(result.problems[0].message).toMatch(/unknown quality goal "perf"/);
  });
});

describe('guides and overview', () => {
  it('returns the template guide for a section by number, id or title', async () => {
    const { call } = await workspace();
    const byNumber = await call('get_section_guide', { section: '10' });
    expect(byNumber.title).toBe('Quality Requirements');
    expect(byNumber.subsections.map((s: any) => s.number)).toEqual(['10.1', '10.2']);
    expect((await call('get_section_guide', { section: 'runtime-view' })).number).toBe(6);
    expect((await call('get_section_guide', { section: 'glossary' })).file).toBe('docs/architecture/sections/12-glossary.md');
  });

  it('summarizes the workspace', async () => {
    const { call } = await workspace();
    const overview = await call('overview');
    expect(overview.system).toBe('Webshop');
    expect(overview.sections).toHaveLength(12);
    expect(overview.problems).toEqual({ errors: 0, warnings: 0 });
  });
});

describe('diagram editing operations', () => {
  it('adds an element directly onto a diagram at a position', async () => {
    const { call } = await workspace();
    await call('add_element', { name: 'Orders', kind: 'component', diagram: 'building-blocks-l1', x: 300, y: 120 });
    const d = await call('get_diagram', { diagram: 'building-blocks-l1' });
    expect(d.nodes).toEqual([expect.objectContaining({ ref: 'orders', x: 300, y: 120, name: 'Orders' })]);
  });

  it('updates relationships with UML adornments and clears them with null', async () => {
    const { call } = await workspace();
    await call('add_element', { name: 'Library', kind: 'class' });
    await call('add_element', { name: 'Book', kind: 'class' });
    await call('add_element', { name: 'Loan', kind: 'class' });
    await call('add_relationship', { kind: 'association', from: 'library', to: 'book' });
    await call('update_relationship', { id: 'library-book', roles: { to: 'books' }, qualifier: { from: 'isbn' }, navigable: { to: true }, associationClass: 'loan', multiplicity: { to: '0..1' } });
    let rel = (await call('get_model')).relationships[0];
    expect(rel).toMatchObject({ roles: { to: 'books' }, qualifier: { from: 'isbn' }, navigable: { to: true }, associationClass: 'loan' });
    await call('update_relationship', { id: 'library-book', qualifier: null, kind: 'aggregation' });
    rel = (await call('get_model')).relationships[0];
    expect(rel.qualifier).toBeUndefined();
    expect(rel.kind).toBe('aggregation');
    await expect(call('update_relationship', { id: 'library-book', associationClass: 'ghost' })).rejects.toThrow(/Unknown element/);
  });

  it('moves and resizes model and local nodes; sets lollipop notation', async () => {
    const { call } = await workspace();
    await call('add_element', { name: 'IOrders', kind: 'interface', diagram: 'building-blocks-l1' });
    const note = await call('add_local_node', { diagram: 'building-blocks-l1', kind: 'note', text: 'Hi' });
    await call('move_nodes', { diagram: 'building-blocks-l1', nodes: [{ id: 'iOrders', x: 10.4, y: 20, w: 30, h: 30 }, { id: note.id, x: 200, y: 300 }] });
    await call('set_node_style', { diagram: 'building-blocks-l1', ref: 'iOrders', style: { notation: 'lollipop' } });
    const d = await call('get_diagram', { diagram: 'building-blocks-l1' });
    expect(d.nodes[0]).toMatchObject({ ref: 'iOrders', x: 10, y: 20, w: 30, h: 30, style: { notation: 'lollipop' } });
    expect(d.local.nodes[0]).toMatchObject({ id: note.id, x: 200, y: 300 });
    await expect(call('move_nodes', { diagram: 'building-blocks-l1', nodes: [{ id: 'nope', x: 0, y: 0 }] })).rejects.toThrow(/Not on/);
  });

  it('builds a state machine with transitions, composite states and removes with cascade to edges', async () => {
    const { call } = await workspace();
    await call('create_diagram', { title: 'Order states', type: 'state' });
    const init = await call('add_local_node', { diagram: 'order-states', kind: 'initial' });
    const open = await call('add_local_node', { diagram: 'order-states', kind: 'state', name: 'Open', text: 'entry / reserve stock' });
    const active = await call('add_local_node', { diagram: 'order-states', kind: 'state', name: 'Active' });
    await call('update_local_node', { diagram: 'order-states', id: open.id, parent: active.id });
    const t = await call('add_local_edge', { diagram: 'order-states', kind: 'transition', from: init.id, to: open.id, label: 'create / init()' });
    await call('update_local_edge', { diagram: 'order-states', id: t.id, label: 'submit [valid]' });
    await expect(call('add_local_edge', { diagram: 'order-states', kind: 'flow', from: init.id, to: 'ghost' })).rejects.toThrow(/not on/);
    await call('set_edge_waypoints', { diagram: 'order-states', id: t.id, waypoints: [{ x: 100, y: 100 }] });
    let d = await call('get_diagram', { diagram: 'order-states' });
    expect(d.local.edges[0]).toMatchObject({ label: 'submit [valid]', waypoints: [{ x: 100, y: 100 }] });
    expect(d.local.nodes.find((n: any) => n.id === open.id).parent).toBe(active.id);
    // Moved labels: on the edge and on a node; null puts them back.
    await call('set_label_offset', { diagram: 'order-states', id: t.id, offset: { x: 20.4, y: -30 } });
    await call('set_label_offset', { diagram: 'order-states', id: init.id, offset: { x: 5, y: 5 } });
    d = await call('get_diagram', { diagram: 'order-states' });
    expect(d.local.edges[0].labelOffset).toEqual({ x: 20, y: -30 });
    expect(d.local.nodes.find((n: any) => n.id === init.id).labelOffset).toEqual({ x: 5, y: 5 });
    await call('set_label_offset', { diagram: 'order-states', id: t.id, offset: null });
    d = await call('get_diagram', { diagram: 'order-states' });
    expect(d.local.edges[0].labelOffset).toBeUndefined();
    await expect(call('set_label_offset', { diagram: 'order-states', id: 'ghost', offset: null })).rejects.toThrow(/No edge/);

    await call('remove_from_diagram', { diagram: 'order-states', refs: [active.id] });
    d = await call('get_diagram', { diagram: 'order-states' });
    expect(d.local.nodes.find((n: any) => n.id === open.id).parent).toBeUndefined(); // moved up
    await call('remove_from_diagram', { diagram: 'order-states', refs: [open.id] });
    d = await call('get_diagram', { diagram: 'order-states' });
    expect(d.local.edges).toEqual([]); // the transition went with its target
    expect((await call('validate')).ok).toBe(true);
  });

  it('auto-layouts with ELK, keeping children inside containers', async () => {
    const { call } = await workspace();
    await call('add_element', { name: 'Shop', kind: 'package', diagram: 'building-blocks-l1', x: 0, y: 0 });
    for (const name of ['Web', 'Orders', 'Billing']) await call('add_element', { name, kind: 'component', parent: 'shop', diagram: 'building-blocks-l1', x: 0, y: 0 });
    await call('add_element', { name: 'Bank', kind: 'externalSystem', diagram: 'building-blocks-l1', x: 0, y: 0 });
    await call('add_relationship', { kind: 'dependency', from: 'web', to: 'orders' });
    await call('add_relationship', { kind: 'dependency', from: 'orders', to: 'billing' });
    await call('add_relationship', { kind: 'dependency', from: 'billing', to: 'bank' });
    await call('auto_layout', { diagram: 'building-blocks-l1' });
    const d = await call('get_diagram', { diagram: 'building-blocks-l1' });
    const box = (ref: string) => d.nodes.find((n: any) => n.ref === ref);
    const shop = box('shop');
    for (const ref of ['web', 'orders', 'billing']) {
      const n = box(ref);
      expect(n.x).toBeGreaterThanOrEqual(shop.x);
      expect(n.y).toBeGreaterThanOrEqual(shop.y);
      expect(n.x + 160).toBeLessThanOrEqual(shop.x + shop.w + 1);
    }
    // No two top-level nodes overlap.
    expect(box('bank').y >= shop.y + shop.h || box('bank').x >= shop.x + shop.w || box('bank').y + 70 <= shop.y).toBe(true);
    // Layered top-down: web above orders above billing.
    expect(box('web').y).toBeLessThan(box('orders').y);
    expect(box('orders').y).toBeLessThan(box('billing').y);
    // Children sit below the container's name header.
    expect(Math.min(...['web', 'orders', 'billing'].map((r) => box(r).y))).toBeGreaterThanOrEqual(shop.y + 34);
    // Running it again changes nothing.
    await call('auto_layout', { diagram: 'building-blocks-l1' });
    expect((await call('get_diagram', { diagram: 'building-blocks-l1' })).nodes).toEqual(d.nodes);
  });

  it('auto-layouts nested deployment nodes without overlaps (report H-3)', async () => {
    const { call } = await workspace();
    await call('create_diagram', { title: 'Dep', type: 'deployment' });
    await call('add_element', { name: 'Bench PC', kind: 'node', diagram: 'dep', x: 0, y: 0, technology: 'Windows 11' });
    for (const env of ['VS Code extension host', 'MCP process', 'Service process']) {
      const { id } = await call('add_element', { name: env, kind: 'executionEnvironment', parent: 'benchPc', diagram: 'dep', x: 0, y: 0, technology: 'Node 22' });
      await call('add_element', { name: `${env} bundle`, kind: 'artifact', parent: id, diagram: 'dep', x: 0, y: 0 });
    }
    await call('add_relationship', { kind: 'connector', from: 'vsCodeExtensionHost', to: 'mcpProcess', label: 'named pipe' });
    await call('add_relationship', { kind: 'connector', from: 'mcpProcess', to: 'serviceProcess', label: 'HTTP' });
    for (const direction of ['RIGHT', 'DOWN']) {
      await call('auto_layout', { diagram: 'dep', direction });
      const d = await call('get_diagram', { diagram: 'dep' });
      const model = (await call('get_model')).elements as { id: string; parent?: string }[];
      const parent = new Map(model.map((e) => [e.id, e.parent]));
      const box = new Map<string, any>(d.nodes.map((n: any) => [n.ref, n]));
      const nodes = [...box.values()] as any[];
      for (const a of nodes) {
        const p = parent.get(a.ref) && box.get(parent.get(a.ref)!);
        // Inside its parent, below the parent's header.
        if (p) {
          expect(a.x).toBeGreaterThanOrEqual(p.x);
          expect(a.y).toBeGreaterThan(p.y + 30);
          expect(a.x + a.w).toBeLessThanOrEqual(p.x + p.w);
          expect(a.y + a.h).toBeLessThanOrEqual(p.y + p.h);
        }
        for (const b of nodes) {
          if (a === b || parent.get(a.ref) !== parent.get(b.ref)) continue;
          const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
          expect(overlap, `${a.ref} overlaps ${b.ref} (${direction})`).toBe(false);
        }
      }
    }
  });

  it('auto-layouts class hierarchies with the superclass on top', async () => {
    const { call } = await workspace();
    await call('create_diagram', { title: 'Domain', type: 'class' });
    for (const name of ['Payment', 'Card Payment', 'Invoice Payment']) await call('add_element', { name, kind: 'class', diagram: 'domain', x: 0, y: 0 });
    await call('add_relationship', { kind: 'generalization', from: 'cardPayment', to: 'payment' });
    await call('add_relationship', { kind: 'generalization', from: 'invoicePayment', to: 'payment' });
    await call('auto_layout', { diagram: 'domain' });
    const d = await call('get_diagram', { diagram: 'domain' });
    const y = (ref: string) => d.nodes.find((n: any) => n.ref === ref).y;
    expect(y('payment')).toBeLessThan(y('cardPayment'));
    expect(y('payment')).toBeLessThan(y('invoicePayment'));
    expect(y('cardPayment')).toBe(y('invoicePayment'));
  });

  it('auto-layouts state machines: initial first, final last, regions stacked in their state', async () => {
    const { call } = await workspace();
    await call('create_diagram', { title: 'Order states', type: 'state' });
    const add = async (kind: string, name?: string, parent?: string) => (await call('add_local_node', { diagram: 'order-states', kind, name, parent, x: 0, y: 0 })).id;
    const final = await add('final');
    const start = await add('initial');
    const open = await add('state', 'Open');
    const active = await add('state', 'Active');
    const r1 = await add('region', undefined, active);
    const r2 = await add('region', undefined, active);
    const paying = await add('state', 'Paying', r1);
    const packing = await add('state', 'Packing', r2);
    await call('add_local_edge', { diagram: 'order-states', kind: 'transition', from: start, to: open });
    await call('add_local_edge', { diagram: 'order-states', kind: 'transition', from: open, to: active, label: 'checkout' });
    await call('add_local_edge', { diagram: 'order-states', kind: 'transition', from: active, to: final });
    await call('auto_layout', { diagram: 'order-states' });
    const d = await call('get_diagram', { diagram: 'order-states' });
    const n = (id: string) => d.local.nodes.find((x: any) => x.id === id);
    expect(n(start).y).toBeLessThan(n(open).y);
    expect(n(open).y).toBeLessThan(n(active).y);
    expect(n(active).y + n(active).h).toBeLessThanOrEqual(n(final).y);
    // The regions are one above the other, inside the state.
    expect(n(r2).y).toBeGreaterThanOrEqual(n(r1).y + n(r1).h);
    for (const r of [r1, r2]) {
      expect(n(r).y).toBeGreaterThanOrEqual(n(active).y);
      expect(n(r).y + n(r).h).toBeLessThanOrEqual(n(active).y + n(active).h + 1);
    }
    expect(n(paying).y).toBeGreaterThanOrEqual(n(r1).y);
    expect(n(packing).y).toBeGreaterThanOrEqual(n(r2).y);
  });
});

describe('write_data_table (in-place table editing)', () => {
  it('writes rows with typed fields, generated ids and custom columns; keeps the header comment', async () => {
    const { files, call } = await workspace();
    await call('write_data_table', {
      list: 'quality-goals',
      rows: [
        { priority: '1', quality: 'Availability', goal: '24/7', owner: 'Ops' },
        { priority: '2', quality: 'Security', goal: 'No card data' },
      ],
      columns: [
        { field: 'priority', label: '#' },
        { field: 'quality', label: 'Quality' },
        { field: 'goal', label: 'Goal' },
        { field: 'owner', label: 'Owner' },
      ],
    });
    const yaml = files.get('data/quality-goals.yaml')!;
    expect(yaml).toMatch(/^# Section 1.2/);
    expect(yaml).toContain('- id: qg1\n    priority: 1\n    quality: Availability\n    goal: 24/7\n    owner: Ops');
    expect(yaml).toContain('views:\n  goals:\n    columns:');
    expect((await call('validate')).ok).toBe(true);
    // Back to the default layout removes the saved view.
    await call('write_data_table', {
      list: 'quality-goals',
      rows: [{ id: 'qg1', priority: '1', quality: 'Availability', goal: '24/7' }],
      columns: [
        { field: 'priority', label: '#' },
        { field: 'quality', label: 'Quality' },
        { field: 'goal', label: 'Goal' },
      ],
    });
    expect(files.get('data/quality-goals.yaml')).not.toContain('views:');
  });

  it('saves with the default layout when the file has no saved layout', async () => {
    const { files, call } = await workspace();
    await call('write_data_table', {
      list: 'stakeholders',
      rows: [{ role: 'Architect', contact: 'Team A' }],
      columns: [
        { field: 'role', label: 'Role/Name' },
        { field: 'contact', label: 'Contact' },
        { field: 'expectations', label: 'Expectations' },
      ],
    });
    expect(files.get('data/stakeholders.yaml')).toContain('- role: Architect');
    expect(files.get('data/stakeholders.yaml')).not.toContain('views:');
  });

  it('reports which row and column is wrong, and refuses duplicates', async () => {
    const { call } = await workspace();
    await expect(call('write_data_table', { list: 'quality-goals', rows: [{ priority: 'high', quality: 'Q', goal: 'G' }] })).rejects.toThrow(/Row 1, #: "high" is not a whole number/);
    await expect(call('write_data_table', { list: 'quality-goals', rows: [{ priority: '1', quality: 'Q' }] })).rejects.toThrow(/Row 1: "Goal" is required/);
    await expect(call('write_data_table', { list: 'stakeholders', rows: [{ contact: 'x' }] })).rejects.toThrow(/Row 1 needs a Role\/Name/);
    await expect(call('write_data_table', { list: 'glossary', rows: [{ term: 'A', definition: 'x' }, { term: 'A', definition: 'y' }] })).rejects.toThrow(/Two rows have the Term "A"/);
  });

  it('converts list and map fields', async () => {
    const { call } = await workspace();
    await call('write_data_table', { list: 'glossary', rows: [{ term: 'Order', definition: 'A purchase', synonyms: 'Purchase, Sale', translations: 'de: Bestellung, fr: Commande' }] });
    const { items } = await call('get_data', { list: 'glossary' });
    expect(items[0]).toEqual({ term: 'Order', definition: 'A purchase', synonyms: ['Purchase', 'Sale'], translations: { de: 'Bestellung', fr: 'Commande' } });
  });
});

describe('document tables', () => {
  it('builds editable tables with saved column layouts and hidden fields', async () => {
    const { buildTables } = await import('../src/doc/tables');
    const tables = buildTables(
      new Map([
        ['data/quality-goals.yaml', { goals: [{ id: 'qg1', priority: 1, quality: 'Q', goal: 'G', owner: 'Ops' }], views: { goals: { columns: [{ field: 'goal', label: 'Goal' }, { field: 'owner', label: 'Owner' }] } } }],
        ['data/quality-requirements.yaml', { overview: [], scenarios: [{ id: 's1', name: 'Peak', goals: ['qg1'] }] }],
      ]),
    );
    const goals = tables['data/quality-goals.yaml']!;
    expect(goals.columns).toEqual([{ field: 'goal', label: 'Goal', builtin: true }, { field: 'owner', label: 'Owner', builtin: false }]);
    expect(goals.rows).toEqual([{ id: 'qg1', priority: '1', quality: 'Q', goal: 'G', owner: 'Ops' }]);
    expect(tables['data/quality-requirements.yaml#scenarios']!.rows[0]!.goals).toBe('qg1');
    expect(tables['data/quality-requirements.yaml']!.list).toBe('quality-overview');
  });
});

describe('write_data_table merges', () => {
  it('stores merged cells in the view and keeps them with the default columns', async () => {
    const { files, call } = await workspace();
    await call('write_data_table', {
      list: 'stakeholders',
      rows: [
        { role: 'Dev team', contact: 'Engineering' },
        { role: 'Ops team', contact: 'Engineering' },
      ],
      columns: [
        { field: 'role', label: 'Role/Name' },
        { field: 'contact', label: 'Contact' },
        { field: 'expectations', label: 'Expectations' },
      ],
      merges: [{ row: 'Dev team', field: 'contact', rows: 2, cols: 1 }],
    });
    const yaml = files.get('data/stakeholders.yaml')!;
    expect(yaml).toContain('merges:\n      - row: Dev team\n        field: contact\n        rows: 2\n        cols: 1');
    expect(yaml).not.toContain('columns:'); // default layout is not stored
    // Omitting merges keeps them; an empty list removes the view.
    await call('write_data_table', { list: 'stakeholders', rows: [{ role: 'Dev team', contact: 'Engineering' }, { role: 'Ops team', contact: 'Engineering' }] });
    expect(files.get('data/stakeholders.yaml')).toContain('merges:');
    await call('write_data_table', { list: 'stakeholders', rows: [{ role: 'Dev team' }], merges: [] });
    expect(files.get('data/stakeholders.yaml')).not.toContain('views:');
  });
});
