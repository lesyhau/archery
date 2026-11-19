import { describe, expect, it } from 'vitest';
import { parseCanvasDiagram, parseModel, parseSequenceDiagram } from '../src/model/load';

// The examples below are the draft formats from handoff.md §5.

describe('model.yaml', () => {
  it('accepts the handoff example', () => {
    const parsed = parseModel(`
elements:
  - id: customer
    kind: actor
    name: Customer
  - id: orderService
    kind: component
    name: Order Service
    parent: shop
    stereotype: service
    description: Accepts and validates orders.
  - id: order
    kind: class
    name: Order
    attributes:
      - { name: id, type: UUID, visibility: "-" }
    operations:
      - { name: total, returns: Money, visibility: "+" }
relationships:
  - id: r1
    kind: dependency
    from: orderService
    to: paymentGateway
    label: charge()
    multiplicity: { from: "1", to: "*" }
`);
    expect(parsed.issues).toEqual([]);
    expect(parsed.value?.elements).toHaveLength(3);
  });

  it('reports schema errors with the line of the offending node', () => {
    const parsed = parseModel(`elements:
  - id: a
    kind: component
    name: A
  - id: b
    kind: banana
    name: B
`);
    expect(parsed.value).toBeUndefined();
    expect(parsed.issues).toHaveLength(1);
    expect(parsed.issues[0]!.message).toMatch(/^elements\[1\]\.kind: /);
    expect(parsed.issues[0]!.line).toBe(6);
  });

  it('reports YAML syntax errors with a position', () => {
    const parsed = parseModel('elements:\n  - id: a\n   kind: [\n');
    expect(parsed.value).toBeUndefined();
    expect(parsed.issues.length).toBeGreaterThan(0);
    expect(parsed.issues[0]!.line).toBeGreaterThan(0);
  });
});

describe('*.uml.json', () => {
  it('accepts the handoff example and fills defaults', () => {
    const parsed = parseCanvasDiagram(
      JSON.stringify({
        version: 1,
        type: 'component',
        title: 'Building blocks — level 1',
        nodes: [{ ref: 'orderService', x: 120, y: 80, w: 180, h: 80 }],
        edges: [{ ref: 'r1' }],
      }),
    );
    expect(parsed.issues).toEqual([]);
    expect(parsed.value?.edges[0]?.waypoints).toEqual([]);
    expect(parsed.value?.local).toEqual({ nodes: [], edges: [] });
  });

  it('rejects unknown diagram types', () => {
    const parsed = parseCanvasDiagram('{"version":1,"type":"timing"}');
    expect(parsed.issues[0]?.message).toMatch(/^type: /);
  });

  it('reports JSON syntax errors', () => {
    expect(parseCanvasDiagram('{ "version": 1, ').issues).toHaveLength(1);
  });
});

describe('*.seq.json', () => {
  it('accepts the handoff example with nested fragments', () => {
    const parsed = parseSequenceDiagram(
      JSON.stringify({
        version: 1,
        type: 'sequence',
        title: 'Place order',
        lifelines: [{ ref: 'customer' }, { ref: 'orderService' }, { ref: 'paymentGateway' }],
        steps: [
          { msg: { from: 'customer', to: 'orderService', label: 'placeOrder()', kind: 'sync' } },
          {
            fragment: 'alt',
            branches: [
              { guard: 'payment ok', steps: [{ msg: { from: 'orderService', to: 'customer', label: 'confirmation', kind: 'reply' } }] },
              { guard: 'else', steps: [{ msg: { from: 'orderService', to: 'customer', label: 'error', kind: 'reply' } }] },
            ],
          },
        ],
      }),
    );
    expect(parsed.issues).toEqual([]);
    expect(parsed.value?.steps).toHaveLength(2);
  });
});
