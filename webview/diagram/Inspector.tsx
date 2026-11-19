// Right-hand inspector of the canvas editor: metadata and details of the active element.
//  - nothing selected: the diagram (title, type, what is on it, other diagrams)
//  - an element: name, kind, stereotype, technology..., kind-specific details (members, use case
//    scenario, actor goals, responsibilities), its relations grouped by meaning (use cases, provided /
//    required interfaces, deployment, specialization, containment) with quick-add, the scenarios
//    (sequence diagrams) and other diagrams it appears in, constraints and tagged values
//  - a relationship / diagram-local node or edge: their properties
//  - several items: alignment and distribution
// Fields commit on blur / Enter; every change is one operation.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { CanvasDiagram, CanvasDiagramType, Element, ElementKind, LocalEdge, LocalNode, Model, Relationship, RelationshipKind, Scenario } from '../../src/model/schema';
import type { DiagramUsage } from '../../src/model/usage';
import { formatAttribute, formatOperation, parseAttribute, parseLines, parseOperation } from '../../src/model/umlText';
import { KIND_FAMILIES, LOCAL_FAMILIES, RELATIONSHIPS } from './palette';
import { IconInterrupt,
  ELEMENT_ICONS,
  IconAlignBottom,
  IconAlignCenterH,
  IconAlignLeft,
  IconAlignMiddle,
  IconAlignRight,
  IconAlignTop,
  IconAnchor,
  IconDistributeH,
  IconDistributeV,
  IconOpen,
  IconPlus,
  IconRemove,
  IconTransition,
  IconTrash,
  LOCAL_ICONS,
  RELATIONSHIP_ICONS,
  TYPE_ICONS,
  TYPE_LABELS,
} from './umlIcons';

export type Selection =
  | { type: 'none' }
  | { type: 'element'; element: Element; style?: Record<string, string> }
  | { type: 'local'; node: LocalNode }
  | { type: 'relationship'; rel: Relationship; waypoints: number }
  | { type: 'localEdge'; edge: LocalEdge }
  | { type: 'multi'; count: number; nodes: number };

import type { AlignMode } from '../../src/ops/align';
export type { AlignMode };

/** Align and distribute actions (toolbar, context menu, inspector); `needs`: the shapes they need. */
export const ALIGN_ACTIONS: { mode: AlignMode; label: string; title: string; icon: () => JSX.Element; needs: number }[] = [
  { mode: 'left', label: 'Align left', title: 'Align left edges', icon: IconAlignLeft, needs: 2 },
  { mode: 'centerH', label: 'Align center', title: 'Align centers on a vertical line', icon: IconAlignCenterH, needs: 2 },
  { mode: 'right', label: 'Align right', title: 'Align right edges', icon: IconAlignRight, needs: 2 },
  { mode: 'top', label: 'Align top', title: 'Align top edges', icon: IconAlignTop, needs: 2 },
  { mode: 'middle', label: 'Align middle', title: 'Align centers on a horizontal line', icon: IconAlignMiddle, needs: 2 },
  { mode: 'bottom', label: 'Align bottom', title: 'Align bottom edges', icon: IconAlignBottom, needs: 2 },
  { mode: 'distributeH', label: 'Distribute horizontally', title: 'Space evenly from left to right', icon: IconDistributeH, needs: 3 },
  { mode: 'distributeV', label: 'Distribute vertically', title: 'Space evenly from top to bottom', icon: IconDistributeV, needs: 3 },
];

/** Adds an element related to the selected one (placed next to it, then renamed). */
export interface QuickAdd {
  kind: ElementKind;
  name: string;
  /** Relationship from the selected element ('out') or to it ('in'). */
  rel?: { kind: RelationshipKind; dir: 'out' | 'in'; stereotype?: string };
  /** Nest the new element inside the selected one. */
  child?: boolean;
  lollipop?: boolean;
}

interface Props {
  selection: Selection;
  /** Modern style: lines are routed automatically (bend points reset to that, not to a straight line). */
  modern?: boolean;
  diagram: CanvasDiagram;
  model: Model;
  diagrams: DiagramUsage[];
  editable: boolean;
  op(name: string, input: Record<string, unknown>): void;
  quickAdd(spec: QuickAdd): void;
  /** Selects an element on the canvas (and brings it into view). */
  select(ref: string): void;
  /** Elements shown on this diagram (the others cannot be selected from here). */
  canvasRefs: string[];
  /** This diagram's path relative to the root, when known. */
  self?: string;
  openDiagram(file: string): void;
  align(mode: AlignMode): void;
  removeSelected(): void;
  deleteSelectedFromModel(): void;
}

// --------------------------------------------------------------------------------------------
// small building blocks

const orNull = (v: string) => (v.trim() ? v.trim() : null);
const listOrNull = (v: string[]) => (v.length ? v : null);

/** Collapsible group; remembers its state while the editor is open. */
const collapsed = new Set<string>();
export function Section({ id, title, count, actions, children, defaultOpen = true }: { id: string; title: string; count?: number; actions?: ReactNode; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(collapsed.has(id) ? false : defaultOpen);
  return (
    <section className={`ins-section${open ? ' open' : ''}`}>
      <header>
        <button
          type="button"
          className="ins-toggle"
          aria-expanded={open}
          onClick={() => {
            if (open) collapsed.add(id);
            else collapsed.delete(id);
            setOpen(!open);
          }}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <path d="M3 2l4 3-4 3" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>{title}</span>
          {count !== undefined && count > 0 && <span className="ins-count">{count}</span>}
        </button>
        {actions && <span className="ins-actions">{actions}</span>}
      </header>
      {open && <div className="ins-body">{children}</div>}
    </section>
  );
}

export function Field({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <label className={`field${wide ? ' wide' : ''}`}>
      <span>{label}</span>
      {children}
    </label>
  );
}

/** A text input that commits on blur / Enter when the value changed. */
export function Text({ value, onCommit, placeholder, multiline, rows = 3, disabled, mono, className }: { value: string; onCommit(v: string): void; placeholder?: string; multiline?: boolean; rows?: number; disabled?: boolean; mono?: boolean; className?: string }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const commit = () => v !== value && onCommit(v);
  if (multiline)
    return (
      <textarea
        className={`${mono ? 'mono' : ''} ${className ?? ''}`}
        value={v}
        rows={rows}
        placeholder={placeholder}
        disabled={disabled}
        spellCheck={false}
        onChange={(e) => setV(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && (e.ctrlKey || e.metaKey) && commit()}
      />
    );
  return <input className={className} value={v} placeholder={placeholder} disabled={disabled} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} />;
}

/** One short line per entry: Enter adds the next, Backspace on an empty line removes it. */
export function ListField({ items, onCommit, placeholder, numbered, disabled }: { items: string[]; onCommit(v: string[]): void; placeholder: string; numbered?: boolean; disabled?: boolean }) {
  const [rows, setRowsState] = useState<string[]>(items);
  const rowsRef = useRef(rows);
  const setRows = (next: string[]) => {
    rowsRef.current = next;
    setRowsState(next);
  };
  const key = JSON.stringify(items);
  // Saved when focus leaves the whole list (Enter only moves to the next line); outside changes
  // are taken over unless the list is being edited.
  const box = useRef<HTMLDivElement>(null);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setRows(items);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const [focus, setFocus] = useState<number | null>(null);
  useEffect(() => {
    if (focus === null) return;
    refs.current[focus]?.focus();
    setFocus(null);
  }, [focus, rows.length]);
  const commit = (next: string[]) => {
    const clean = next.map((s) => s.trim()).filter(Boolean);
    if (JSON.stringify(clean) !== key) onCommit(clean);
  };
  return (
    <div
      className="list-field"
      ref={box}
      onFocus={() => (focused.current = true)}
      onBlur={(e) => {
        if (box.current?.contains(e.relatedTarget as Node | null)) return;
        focused.current = false;
        commit(rowsRef.current);
      }}
    >
      {rows.map((row, i) => (
        <div className="list-row" key={i}>
          {numbered && <span className="list-num">{i + 1}</span>}
          <input
            ref={(el) => (refs.current[i] = el)}
            value={row}
            placeholder={placeholder}
            disabled={disabled}
            onChange={(e) => setRows(rows.map((r, j) => (j === i ? e.target.value : r)))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                setRows([...rows.slice(0, i + 1), '', ...rows.slice(i + 1)]);
                setFocus(i + 1);
              } else if (e.key === 'Backspace' && row === '' && rows.length > 0) {
                e.preventDefault();
                const next = rows.filter((_, j) => j !== i);
                setRows(next);
                commit(next);
                setFocus(Math.max(0, i - 1));
              }
            }}
          />
          {!disabled && (
            <button
              type="button"
              className="icon-btn subtle"
              title="Remove"
              onClick={() => {
                const next = rows.filter((_, j) => j !== i);
                setRows(next);
                commit(next);
              }}
            >
              <IconRemove />
            </button>
          )}
        </div>
      ))}
      {!disabled && (
        <button
          type="button"
          className="add-row"
          title="Add"
          onClick={() => {
            setRows([...rows, '']);
            setFocus(rows.length);
          }}
        >
          <IconPlus />
          {rows.length === 0 && <span>{placeholder}</span>}
        </button>
      )}
    </div>
  );
}

/** Tagged values: key = value rows. */
function TagsField({ tags, onCommit, disabled }: { tags: Record<string, string>; onCommit(v: Record<string, string> | null): void; disabled?: boolean }) {
  const [rows, setRowsState] = useState<[string, string][]>(Object.entries(tags));
  const rowsRef = useRef(rows);
  const setRows = (next: [string, string][]) => {
    rowsRef.current = next;
    setRowsState(next);
  };
  const key = JSON.stringify(tags);
  const box = useRef<HTMLDivElement>(null);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setRows(Object.entries(tags));
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const commit = (next: [string, string][]) => {
    const clean = Object.fromEntries(next.map(([k, v]) => [k.trim(), v.trim()]).filter(([k]) => k));
    if (JSON.stringify(clean) !== key) onCommit(Object.keys(clean).length ? clean : null);
  };
  return (
    <div
      className="list-field"
      ref={box}
      onFocus={() => (focused.current = true)}
      onBlur={(e) => {
        if (box.current?.contains(e.relatedTarget as Node | null)) return;
        focused.current = false;
        commit(rowsRef.current);
      }}
    >
      {rows.map(([k, v], i) => (
        <div className="list-row tag-row" key={i}>
          <input value={k} placeholder="key" disabled={disabled} onChange={(e) => setRows(rows.map((r, j) => (j === i ? [e.target.value, r[1]] : r)))} />
          <input value={v} placeholder="value" disabled={disabled} onChange={(e) => setRows(rows.map((r, j) => (j === i ? [r[0], e.target.value] : r)))} onKeyDown={(e) => e.key === 'Enter' && commit(rows)} />
          {!disabled && (
            <button
              type="button"
              className="icon-btn subtle"
              title="Remove"
              onClick={() => {
                const next = rows.filter((_, j) => j !== i);
                setRows(next);
                commit(next);
              }}
            >
              <IconRemove />
            </button>
          )}
        </div>
      ))}
      {!disabled && (
        <button type="button" className="add-row" title="Add a tagged value" onClick={() => setRows([...rows, ['', '']])}>
          <IconPlus />
          {rows.length === 0 && <span>owner, SLA, team</span>}
        </button>
      )}
    </div>
  );
}

/** Icon buttons for choosing one of a few kinds. */
export function Segmented<T extends string>({ value, options, onChange, disabled }: { value: T; options: { value: T; label: string; icon: () => JSX.Element }[]; onChange(v: T): void; disabled?: boolean }) {
  return (
    <div className="segmented" role="radiogroup">
      {options.map((o) => (
        <button
          type="button"
          key={o.value}
          role="radio"
          aria-checked={o.value === value}
          title={o.label}
          disabled={disabled}
          className={o.value === value ? 'on' : undefined}
          onClick={() => o.value !== value && onChange(o.value)}
        >
          <o.icon />
        </button>
      ))}
    </div>
  );
}

const KindIcon = ({ kind }: { kind: ElementKind }) => {
  const I = ELEMENT_ICONS[kind];
  return <I />;
};

const KIND_LABELS: Record<ElementKind, string> = {
  actor: 'Actor',
  externalSystem: 'External system',
  usecase: 'Use case',
  component: 'Component',
  interface: 'Interface',
  port: 'Port',
  package: 'Package',
  node: 'Node',
  executionEnvironment: 'Execution environment',
  artifact: 'Artifact',
  class: 'Class',
  datatype: 'Data type',
  enum: 'Enumeration',
  naryAssociation: 'N-ary association',
  instance: 'Instance',
  part: 'Part',
  collaboration: 'Collaboration',
  collaborationUse: 'Collaboration use',
};

// --------------------------------------------------------------------------------------------
// relations of an element, grouped by meaning

interface Related {
  rel: Relationship;
  other: Element;
}

function relationGroup(e: Element, rel: Relationship, other: Element): string {
  const out = rel.from === e.id;
  const st = rel.stereotype?.toLowerCase();
  if ((e.kind === 'actor' && other.kind === 'usecase') || (e.kind !== 'usecase' && other.kind === 'usecase' && rel.kind !== 'dependency')) return 'Use cases';
  if (e.kind === 'usecase' && (other.kind === 'actor' || other.kind === 'externalSystem') && rel.kind !== 'dependency') return 'Actors';
  switch (rel.kind) {
    case 'generalization':
      return out ? 'Specializes' : 'Specialized by';
    case 'realization':
      return out ? (other.kind === 'interface' ? 'Provides' : 'Realizes') : other.kind === 'interface' ? 'Implemented by' : 'Provided by';
    case 'usage':
      return out ? 'Requires' : 'Required by';
    case 'dependency':
      if (st === 'include') return out ? 'Includes' : 'Included by';
      if (st === 'extend') return out ? 'Extends' : 'Extended by';
      return out ? 'Depends on' : 'Used by';
    case 'aggregation':
      return out ? 'Has' : 'Part of';
    case 'composition':
      return out ? 'Composed of' : 'Part of';
    case 'deploy':
      return out ? 'Deployed on' : 'Hosts';
    case 'connector':
      return 'Connected to';
    default:
      return 'Associated with';
  }
}

const GROUP_ORDER = ['Use cases', 'Actors', 'Includes', 'Included by', 'Extends', 'Extended by', 'Provides', 'Requires', 'Implemented by', 'Provided by', 'Required by', 'Realizes', 'Specializes', 'Specialized by', 'Composed of', 'Has', 'Part of', 'Deployed on', 'Hosts', 'Connected to', 'Associated with', 'Depends on', 'Used by'];

/** Quick-add actions offered per element kind (create the related element and the relationship). */
function quickAdds(kind: ElementKind): { group: string; label: string; spec: QuickAdd }[] {
  switch (kind) {
    case 'actor':
      return [{ group: 'Use cases', label: 'Add a use case for this actor', spec: { kind: 'usecase', name: 'Use case', rel: { kind: 'association', dir: 'out' } } }];
    case 'usecase':
      return [
        { group: 'Actors', label: 'Add an actor', spec: { kind: 'actor', name: 'Actor', rel: { kind: 'association', dir: 'in' } } },
        { group: 'Includes', label: 'Add an included use case («include»)', spec: { kind: 'usecase', name: 'Use case', rel: { kind: 'dependency', dir: 'out', stereotype: 'include' } } },
        { group: 'Extended by', label: 'Add an extending use case («extend»)', spec: { kind: 'usecase', name: 'Use case', rel: { kind: 'dependency', dir: 'in', stereotype: 'extend' } } },
      ];
    case 'component':
    case 'externalSystem':
      return [
        { group: 'Provides', label: 'Add a provided interface', spec: { kind: 'interface', name: 'Interface', rel: { kind: 'realization', dir: 'out' }, lollipop: true } },
        { group: 'Requires', label: 'Add a required interface', spec: { kind: 'interface', name: 'Interface', rel: { kind: 'usage', dir: 'out' }, lollipop: true } },
        { group: 'Use cases', label: 'Add a use case it supports', spec: { kind: 'usecase', name: 'Use case', rel: { kind: 'association', dir: 'out' } } },
        { group: 'Depends on', label: 'Add a component it depends on', spec: { kind: 'component', name: 'Component', rel: { kind: 'dependency', dir: 'out' } } },
      ];
    case 'interface':
      return [{ group: 'Implemented by', label: 'Add a component providing it', spec: { kind: 'component', name: 'Component', rel: { kind: 'realization', dir: 'in' } } }];
    case 'node':
    case 'executionEnvironment':
      return [
        { group: 'Hosts', label: 'Add an artifact deployed here', spec: { kind: 'artifact', name: 'Artifact', rel: { kind: 'deploy', dir: 'in' } } },
        { group: 'Connected to', label: 'Add a connected node', spec: { kind: 'node', name: 'Node', rel: { kind: 'connector', dir: 'out' } } },
      ];
    case 'artifact':
      return [{ group: 'Deployed on', label: 'Add the node it is deployed on', spec: { kind: 'node', name: 'Node', rel: { kind: 'deploy', dir: 'out' } } }];
    case 'class':
      return [
        { group: 'Specializes', label: 'Add a superclass', spec: { kind: 'class', name: 'Class', rel: { kind: 'generalization', dir: 'out' } } },
        { group: 'Specialized by', label: 'Add a subclass', spec: { kind: 'class', name: 'Class', rel: { kind: 'generalization', dir: 'in' } } },
        { group: 'Realizes', label: 'Add an interface it implements', spec: { kind: 'interface', name: 'Interface', rel: { kind: 'realization', dir: 'out' } } },
        { group: 'Composed of', label: 'Add a part (composition)', spec: { kind: 'class', name: 'Class', rel: { kind: 'composition', dir: 'out' } } },
      ];
    default:
      return [];
  }
}

function ElementRow({ e, sub, onClick, dim, trailing }: { e: { kind: ElementKind; name: string }; sub?: string; onClick?: () => void; dim?: boolean; trailing?: ReactNode }) {
  return (
    <div className={`ins-row${onClick ? ' clickable' : ''}${dim ? ' dim' : ''}`} onClick={onClick} title={dim ? 'Not on this diagram' : undefined}>
      <span className="ins-icon">
        <KindIcon kind={e.kind} />
      </span>
      <span className="ins-name">{e.name}</span>
      {sub && <span className="ins-sub">{sub}</span>}
      {trailing}
    </div>
  );
}

// --------------------------------------------------------------------------------------------

export function Inspector(p: Props) {
  const { selection, diagram, model, editable } = p;
  const onCanvas = (ref: string) => p.canvasRefs.includes(ref);
  const ro = !editable;
  const byId = new Map(model.elements.map((e) => [e.id, e]));
  const names = (id: string) => byId.get(id)?.name ?? id;
  const others = p.diagrams.filter((d) => (p.self ? d.file !== p.self : !(d.title === diagram.title && d.type === diagram.type)));

  // ---- nothing selected: the diagram ---------------------------------------------------------
  if (selection.type === 'none') {
    const onIt = diagram.nodes.map((n) => byId.get(n.ref)).filter((e): e is Element => !!e);
    const detailed = p.self ? model.elements.filter((e) => e.detail === p.self) : [];
    const counts = new Map<ElementKind, number>();
    for (const e of onIt) counts.set(e.kind, (counts.get(e.kind) ?? 0) + 1);
    const TypeIcon = TYPE_ICONS[diagram.type];
    return (
      <div className="inspector">
        <div className="ins-head">
          <span className="ins-kind-icon">
            <TypeIcon />
          </span>
          <div className="ins-head-text">
            <Text className="ins-title" value={diagram.title} disabled={ro} placeholder="Diagram title" onCommit={(title) => p.op('update_diagram', { title })} />
            <span className="ins-kind">{TYPE_LABELS[diagram.type]}</span>
          </div>
        </div>
        <div className="stat-chips">
          {[...counts].map(([kind, n]) => (
            <span className="chip" key={kind} title={`${n} ${KIND_LABELS[kind]}${n > 1 ? 's' : ''}`}>
              <KindIcon kind={kind} /> {n}
            </span>
          ))}
          {diagram.local.nodes.length > 0 && <span className="chip" title="Diagram-only nodes (states, actions, notes)">◇ {diagram.local.nodes.length}</span>}
          <span className="chip" title="Relationships and flows">↔ {diagram.edges.length + diagram.local.edges.length}</span>
        </div>
        {onIt.length > 0 && (
          <Section id="diagram-elements" title="On this diagram" count={onIt.length}>
            {onIt.map((e) => (
              <ElementRow key={e.id} e={e} sub={e.stereotype ? `«${e.stereotype}»` : undefined} onClick={() => p.select(e.id)} />
            ))}
          </Section>
        )}
        {detailed.length > 0 && (
          <Section id="diagram-details-of" title="Shows in detail" count={detailed.length}>
            {detailed.map((e) => (
              <ElementRow key={e.id} e={e} sub="Other diagrams link here" onClick={onCanvas(e.id) ? () => p.select(e.id) : undefined} dim={!onCanvas(e.id)} />
            ))}
          </Section>
        )}
        {others.length > 0 && (
          <Section id="diagram-others" title="Other diagrams" count={others.length} defaultOpen={false}>
            {others.map((d) => (
              <DiagramRow key={d.file} d={d} open={p.openDiagram} />
            ))}
          </Section>
        )}
        <Section id="diagram-keys" title="Keys" defaultOpen={false}>
          <dl className="keys">
            <dt>Scroll / Ctrl+scroll</dt>
            <dd>Pan / zoom</dd>
            <dt>Space+drag, middle drag</dt>
            <dd>Pan</dd>
            <dt>Drag on empty canvas</dt>
            <dd>Select an area</dd>
            <dt>Shift+1 / Shift+2 / Shift+0</dt>
            <dd>Fit / center selection / 100%</dd>
            <dt>Arrows (Shift: ×5)</dt>
            <dd>Nudge</dd>
            <dt>F2 / double-click</dt>
            <dd>Rename</dd>
            <dt>Del / Shift+Del</dt>
            <dd>Remove / delete from model</dd>
            <dt>Ctrl+A / Esc</dt>
            <dd>Select all / clear</dd>
          </dl>
        </Section>
      </div>
    );
  }

  // ---- several items -------------------------------------------------------------------------
  if (selection.type === 'multi') {
    const can = selection.nodes >= 2;
    const btn = (mode: AlignMode) => {
      const a = ALIGN_ACTIONS.find((x) => x.mode === mode)!;
      return (
        <button type="button" className="icon-btn" title={a.title} aria-label={a.label} disabled={ro || selection.nodes < a.needs} onClick={() => p.align(mode)}>
          <a.icon />
        </button>
      );
    };
    return (
      <div className="inspector">
        <div className="ins-head">
          <div className="ins-head-text">
            <strong>{selection.count} selected</strong>
            <span className="ins-kind">{selection.nodes} nodes</span>
          </div>
        </div>
        {can && (
          <Section id="multi-align" title="Arrange">
            <div className="icon-grid">
              {btn('left')}
              {btn('centerH')}
              {btn('right')}
              {btn('distributeH')}
              {btn('top')}
              {btn('middle')}
              {btn('bottom')}
              {btn('distributeV')}
            </div>
          </Section>
        )}
        <Actions ro={ro} remove={p.removeSelected} del={p.deleteSelectedFromModel} />
      </div>
    );
  }

  // ---- a model element ---------------------------------------------------------------------
  if (selection.type === 'element') {
    const e = selection.element;
    const update = (patch: Record<string, unknown>) => p.op('update_element', { id: e.id, ...patch });
    const family = KIND_FAMILIES.find((f) => f.includes(e.kind)) ?? [e.kind];
    const classLike = e.kind === 'class' || e.kind === 'interface' || e.kind === 'datatype';
    const related: Related[] = model.relationships.flatMap((r) => {
      if (r.from !== e.id && r.to !== e.id) return [];
      const other = byId.get(r.from === e.id ? r.to : r.from);
      return other ? [{ rel: r, other }] : [];
    });
    const groups = new Map<string, Related[]>();
    for (const r of related) {
      const g = relationGroup(e, r.rel, r.other);
      groups.set(g, [...(groups.get(g) ?? []), r]);
    }
    const adds = editable ? quickAdds(e.kind) : [];
    for (const a of adds) if (!groups.has(a.group)) groups.set(a.group, []);
    const ordered = [...groups.keys()].sort((a, b) => (GROUP_ORDER.indexOf(a) + 1 || 99) - (GROUP_ORDER.indexOf(b) + 1 || 99));
    const children = model.elements.filter((x) => x.parent === e.id);
    const typedBy = model.elements.filter((x) => x.classifier === e.id);
    const typeKinds: Partial<Record<string, string[]>> = {
      instance: ['class', 'component', 'node', 'executionEnvironment', 'artifact', 'actor', 'externalSystem', 'interface', 'datatype', 'enum'],
      part: ['class', 'component', 'interface', 'datatype', 'node'],
      collaborationUse: ['collaboration'],
    };
    const types = typeKinds[e.kind] ? model.elements.filter((x) => typeKinds[e.kind]!.includes(x.kind) && x.id !== e.id) : [];
    const parent = e.parent ? byId.get(e.parent) : undefined;
    const scenarios = p.diagrams.filter((d) => d.type === 'sequence' && d.refs.includes(e.id));
    const appears = others.filter((d) => d.type !== 'sequence' && d.refs.includes(e.id));
    const show = {
      technology: ['component', 'node', 'executionEnvironment', 'externalSystem', 'artifact', 'interface', 'port', 'package', 'class', 'datatype'].includes(e.kind),
      version: ['component', 'artifact', 'externalSystem', 'interface'].includes(e.kind),
      instances: ['node', 'executionEnvironment', 'component', 'artifact'].includes(e.kind),
      responsibilities: ['component', 'externalSystem', 'class', 'package', 'node', 'executionEnvironment', 'interface', 'artifact', 'datatype'].includes(e.kind),
    };
    const techLabel = e.kind === 'interface' || e.kind === 'port' ? 'Protocol' : e.kind === 'node' || e.kind === 'executionEnvironment' ? 'Platform' : 'Technology';
    const techHint = e.kind === 'interface' || e.kind === 'port' ? 'REST/HTTPS, gRPC, AMQP' : e.kind === 'node' ? 'Kubernetes, AWS EC2' : e.kind === 'executionEnvironment' ? 'JVM 21, Docker' : 'Spring Boot, PostgreSQL';

    return (
      <div className="inspector">
        <div className="ins-head">
          <span className="ins-kind-icon">
            <KindIcon kind={e.kind} />
          </span>
          <div className="ins-head-text">
            <Text className="ins-title" value={e.name} disabled={ro} onCommit={(name) => name.trim() && update({ name: name.trim() })} />
            <span className="ins-kind">
              {e.stereotype ? `«${e.stereotype}» ` : ''}
              {KIND_LABELS[e.kind]}
              {e.abstract ? ', abstract' : ''}
            </span>
          </div>
        </div>
        {family.length > 1 && (
          <Segmented
            value={e.kind}
            disabled={ro}
            options={family.map((k) => ({ value: k, label: KIND_LABELS[k], icon: ELEMENT_ICONS[k] }))}
            onChange={(kind) => update({ kind })}
          />
        )}

        <Section id="el-details" title="Details">
          <div className="field-grid">
            <Field label="Stereotype">
              <Text value={e.stereotype ?? ''} disabled={ro} placeholder="service" onCommit={(v) => update({ stereotype: orNull(v) })} />
            </Field>
            {show.technology && (
              <Field label={techLabel}>
                <Text value={e.technology ?? ''} disabled={ro} placeholder={techHint} onCommit={(v) => update({ technology: orNull(v) })} />
              </Field>
            )}
            {show.version && (
              <Field label="Version">
                <Text value={e.version ?? ''} disabled={ro} placeholder="2.1" onCommit={(v) => update({ version: orNull(v) })} />
              </Field>
            )}
            {show.instances && (
              <Field label="Instances">
                <Text value={e.instances ?? ''} disabled={ro} placeholder="3, 1..*" onCommit={(v) => update({ instances: orNull(v) })} />
              </Field>
            )}
          </div>
          {e.kind === 'interface' && (
            <Field label="Notation here" wide>
              <Segmented
                value={selection.style?.notation === 'lollipop' ? 'lollipop' : 'box'}
                disabled={ro}
                options={[
                  { value: 'box', label: 'Box «interface»', icon: ELEMENT_ICONS.class },
                  { value: 'lollipop', label: 'Lollipop (ball)', icon: ELEMENT_ICONS.interface },
                ]}
                onChange={(v) => p.op('set_node_style', { ref: e.id, style: v === 'lollipop' ? { notation: 'lollipop' } : null })}
              />
            </Field>
          )}
          <Field label="Description" wide>
            <Text multiline rows={2} disabled={ro} value={e.description ?? ''} placeholder="One or two sentences" onCommit={(v) => update({ description: orNull(v) })} />
          </Field>
        </Section>

        {typeKinds[e.kind] && (
          <Section id="el-type" title={e.kind === 'instance' ? 'Instance of' : 'Type'}>
            <Field label={e.kind === 'collaborationUse' ? 'Collaboration' : 'Type (classifier)'} wide>
              <select value={e.classifier ?? ''} disabled={ro} onChange={(ev) => update({ classifier: ev.target.value || null })}>
                <option value="">(none)</option>
                {types.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name} ({KIND_LABELS[x.kind]})
                  </option>
                ))}
              </select>
            </Field>
            {e.kind === 'part' && (
              <div className="field-grid">
                <Field label="Multiplicity">
                  <Text value={e.multiplicity ?? ''} disabled={ro} placeholder="1..*" onCommit={(v) => update({ multiplicity: orNull(v) })} />
                </Field>
                <label className="check">
                  <input type="checkbox" checked={!!e.reference} disabled={ro} onChange={(ev) => update({ reference: ev.target.checked || null })} /> Reference (not owned)
                </label>
              </div>
            )}
            {e.kind === 'instance' && (
              <>
                <div className="sub-title">Slots (attribute = value)</div>
                <TagsField
                  tags={Object.fromEntries((e.slots ?? []).map((sl) => [sl.name, sl.value]))}
                  disabled={ro}
                  onCommit={(v) => update({ slots: v ? Object.entries(v).map(([name, value]) => ({ name, value })) : null })}
                />
              </>
            )}
          </Section>
        )}

        {e.kind === 'actor' && (
          <Section id="el-goals" title="Goals" count={e.goals?.length}>
            <ListField items={e.goals ?? []} disabled={ro} placeholder="Track an order" onCommit={(v) => update({ goals: listOrNull(v) })} />
          </Section>
        )}

        {e.kind === 'usecase' && <ScenarioEditor scenario={e.scenario} disabled={ro} onCommit={(s) => update({ scenario: s })} />}
        {e.kind === 'usecase' && (
          <Section id="el-extension-points" title="Extension points" count={e.extensionPoints?.length} defaultOpen={!!e.extensionPoints?.length}>
            <ListField items={e.extensionPoints ?? []} disabled={ro} placeholder="payment failed" onCommit={(v) => update({ extensionPoints: listOrNull(v) })} />
          </Section>
        )}

        {show.responsibilities && (
          <Section id="el-resp" title="Responsibilities" count={e.responsibilities?.length}>
            <ListField items={e.responsibilities ?? []} disabled={ro} placeholder="Validates and stores orders" onCommit={(v) => update({ responsibilities: listOrNull(v) })} />
          </Section>
        )}

        {(classLike || e.kind === 'enum') && (
          <Section id="el-members" title={e.kind === 'enum' ? 'Literals' : 'Members'} count={(e.attributes?.length ?? 0) + (e.operations?.length ?? 0) + (e.literals?.length ?? 0)}>
            {(classLike || e.kind === 'enum') && (
              <label className="check">
                <input type="checkbox" checked={!!e.abstract} disabled={ro} onChange={(ev) => update({ abstract: ev.target.checked || null })} /> Abstract
              </label>
            )}
            {classLike && (
              <Field label="Generics" wide>
                <Text value={(e.typeParams ?? []).join(', ')} disabled={ro} placeholder="T, K extends Key" onCommit={(v) => update({ typeParams: v.trim() ? v.split(',').map((s) => s.trim()).filter(Boolean) : null })} />
              </Field>
            )}
            {classLike && e.kind !== 'interface' && (
              <Field label="Attributes" wide>
                <Text
                  multiline
                  mono
                  disabled={ro}
                  value={(e.attributes ?? []).map(formatAttribute).join('\n')}
                  placeholder={'-id: UUID\n+items: Item [0..*]'}
                  onCommit={(v) => update({ attributes: v.trim() ? parseLines(v, parseAttribute) : null })}
                />
              </Field>
            )}
            {(classLike || e.kind === 'interface') && (
              <Field label="Operations" wide>
                <Text
                  multiline
                  mono
                  disabled={ro}
                  value={(e.operations ?? []).map(formatOperation).join('\n')}
                  placeholder={'+total(): Money\n+find(id: UUID): T'}
                  onCommit={(v) => update({ operations: v.trim() ? parseLines(v, parseOperation) : null })}
                />
              </Field>
            )}
            {e.kind === 'enum' && <ListField items={e.literals ?? []} disabled={ro} placeholder="PAID" onCommit={(v) => update({ literals: listOrNull(v) })} />}
          </Section>
        )}

        <Section id="el-relations" title="Relations" count={related.length + children.length + (parent ? 1 : 0)}>
          {parent && (
            <div className="ins-group">
              <div className="ins-group-title">Inside</div>
              <ElementRow
                e={parent}
                onClick={onCanvas(parent.id) ? () => p.select(parent.id) : undefined}
                trailing={
                  !ro && (
                    <button
                      type="button"
                      className="icon-btn subtle"
                      title="Move out"
                      onClick={(ev) => {
                        ev.stopPropagation();
                        update({ parent: null });
                      }}
                    >
                      <IconRemove />
                    </button>
                  )
                }
              />
            </div>
          )}
          {typedBy.length > 0 && (
            <div className="ins-group">
              <div className="ins-group-title">{e.kind === 'collaboration' ? 'Used by' : 'Instances and parts of this type'}</div>
              {typedBy.map((c) => (
                <ElementRow key={c.id} e={c} onClick={onCanvas(c.id) ? () => p.select(c.id) : undefined} dim={!onCanvas(c.id)} />
              ))}
            </div>
          )}
          {children.length > 0 && (
            <div className="ins-group">
              <div className="ins-group-title">Contains</div>
              {children.map((c) => (
                <ElementRow key={c.id} e={c} onClick={onCanvas(c.id) ? () => p.select(c.id) : undefined} dim={!onCanvas(c.id)} />
              ))}
            </div>
          )}
          {e.kind === 'component' && editable && (
            <div className="ins-group">
              <div className="ins-group-title">
                Ports
                <button type="button" className="icon-btn subtle" title="Add a port" onClick={() => p.quickAdd({ kind: 'port', name: 'port', child: true })}>
                  <IconPlus />
                </button>
              </div>
            </div>
          )}
          {ordered.map((g) => {
            const rows = groups.get(g)!;
            const add = adds.find((a) => a.group === g);
            return (
              <div className="ins-group" key={g}>
                <div className="ins-group-title">
                  {g}
                  {add && (
                    <button type="button" className="icon-btn subtle" title={add.label} onClick={() => p.quickAdd(add.spec)}>
                      <IconPlus />
                    </button>
                  )}
                </div>
                {rows.map(({ rel, other }) => {
                  const RelIcon = RELATIONSHIP_ICONS[rel.kind];
                  return (
                    <ElementRow
                      key={rel.id}
                      e={other}
                      sub={[rel.label, rel.stereotype && `«${rel.stereotype}»`].filter(Boolean).join(' ') || undefined}
                      onClick={onCanvas(other.id) ? () => p.select(other.id) : undefined}
                      dim={!onCanvas(other.id)}
                      trailing={
                        <span className="ins-rel" title={RELATIONSHIPS.find((x) => x.kind === rel.kind)?.label}>
                          <RelIcon />
                        </span>
                      }
                    />
                  );
                })}
              </div>
            );
          })}
        </Section>

        {e.kind !== 'port' && (
          <Section id="el-detail" title="Detailed in" defaultOpen={!!e.detail || editable}>
            <Field label="Diagram that shows it in detail" wide>
              <select value={e.detail ?? ''} disabled={ro} onChange={(ev) => update({ detail: ev.target.value || null })}>
                <option value="">(none)</option>
                {e.detail && !p.diagrams.some((d) => d.file === e.detail) && <option value={e.detail}>A missing diagram</option>}
                {p.diagrams
                  .filter((d) => d.file !== p.self || d.file === e.detail)
                  .map((d) => (
                    <option key={d.file} value={d.file}>
                      {d.title}
                    </option>
                  ))}
              </select>
            </Field>
            {e.detail && (
              <div className="ins-hint-row">
                <span className="ins-hint">{e.detail === p.self ? 'This diagram. The others mark it and link here.' : 'Marked on its diagrams; click the mark to drill down.'}</span>
                {e.detail !== p.self && (
                  <button type="button" className="icon-text" onClick={() => p.openDiagram(e.detail!)}>
                    <IconOpen /> Open
                  </button>
                )}
              </div>
            )}
          </Section>
        )}

        {(scenarios.length > 0 || appears.length > 0) && (
          <Section id="el-usage" title="Scenarios and diagrams" count={scenarios.length + appears.length}>
            {scenarios.map((d) => (
              <DiagramRow key={d.file} d={d} open={p.openDiagram} />
            ))}
            {appears.map((d) => (
              <DiagramRow key={d.file} d={d} open={p.openDiagram} />
            ))}
          </Section>
        )}

        <Section id="el-constraints" title="Constraints" count={e.constraints?.length} defaultOpen={!!e.constraints?.length}>
          <ListField items={e.constraints ?? []} disabled={ro} placeholder="total >= 0" onCommit={(v) => update({ constraints: listOrNull(v) })} />
        </Section>
        <Section id="el-tags" title="Tagged values" count={Object.keys(e.tags ?? {}).length} defaultOpen={!!e.tags}>
          <TagsField tags={e.tags ?? {}} disabled={ro} onCommit={(v) => update({ tags: v })} />
        </Section>
        <Actions ro={ro} remove={p.removeSelected} del={p.deleteSelectedFromModel} />
      </div>
    );
  }

  // ---- a diagram-local node ------------------------------------------------------------------
  if (selection.type === 'local') {
    const n = selection.node;
    const family = LOCAL_FAMILIES.find((f) => f.includes(n.kind)) ?? [n.kind];
    const update = (patch: Record<string, unknown>) => p.op('update_local_node', { id: n.id, ...patch });
    const hasName = !['initial', 'final', 'activityFinal', 'flowFinal', 'junction', 'fork', 'join', 'history', 'deepHistory', 'terminate', 'note'].includes(n.kind);
    const I = LOCAL_ICONS[n.kind];
    return (
      <div className="inspector">
        <div className="ins-head">
          <span className="ins-kind-icon">
            <I />
          </span>
          <div className="ins-head-text">
            {hasName ? <Text className="ins-title" value={n.name ?? ''} disabled={ro} placeholder="Name" onCommit={(v) => update({ name: orNull(v) })} /> : <strong>{n.kind}</strong>}
            <span className="ins-kind">{n.kind}</span>
          </div>
        </div>
        {family.length > 1 && <Segmented value={n.kind} disabled={ro} options={family.map((k) => ({ value: k, label: k, icon: LOCAL_ICONS[k] }))} onChange={(kind) => update({ kind })} />}
        {(n.kind === 'interactionUse' || n.kind === 'interaction') && (
          <Section id="local-diagram" title="Interaction">
            <Field label="Diagram it stands for" wide>
              <select value={n.diagram ?? ''} disabled={ro} onChange={(ev) => update({ diagram_ref: ev.target.value || null })}>
                <option value="">(none)</option>
                {p.diagrams
                  .filter((d) => d.type === 'sequence' || d.type === 'communication' || (d.type as string) === 'timing')
                  .map((d) => (
                    <option key={d.file} value={d.file}>
                      {d.title}
                    </option>
                  ))}
              </select>
            </Field>
            {n.diagram && (
              <button type="button" className="icon-text" onClick={() => p.openDiagram(n.diagram!)}>
                <IconOpen /> Open
              </button>
            )}
          </Section>
        )}
        {(n.kind === 'note' || n.kind === 'state' || n.kind === 'action' || n.kind === 'interaction') && (
          <Section id="local-text" title={n.kind === 'note' ? 'Text' : n.kind === 'state' ? 'Internal activities' : 'Details'}>
            <Text
              multiline
              rows={n.kind === 'state' ? 3 : 3}
              mono={n.kind === 'state'}
              disabled={ro}
              value={n.text ?? ''}
              placeholder={n.kind === 'state' ? 'entry / start timer\ndo / poll\nexit / stop timer' : ''}
              onCommit={(v) => update({ text: orNull(v) })}
            />
          </Section>
        )}
        {n.parent && (
          <div className="ins-row">
            Inside <strong>{diagram.local.nodes.find((x) => x.id === n.parent)?.name ?? n.parent}</strong>
            {!ro && (
              <button type="button" className="icon-btn subtle" title="Move out" onClick={() => update({ parent: null })}>
                <IconRemove />
              </button>
            )}
          </div>
        )}
        <Actions ro={ro} remove={p.removeSelected} />
      </div>
    );
  }

  // ---- a relationship ------------------------------------------------------------------------
  if (selection.type === 'relationship') {
    const r = selection.rel;
    const update = (patch: Record<string, unknown>) => p.op('update_relationship', { id: r.id, ...patch });
    const assoc = r.kind === 'association' || r.kind === 'aggregation' || r.kind === 'composition';
    const from = byId.get(r.from);
    const to = byId.get(r.to);
    const RelIcon = RELATIONSHIP_ICONS[r.kind];
    const ends = (key: 'multiplicity' | 'roles' | 'qualifier', label: string, placeholder: string) => (
      <div className="field-grid">
        <Field label={`${label}: ${names(r.from)}`}>
          <Text value={r[key]?.from ?? ''} disabled={ro} placeholder={placeholder} onCommit={(v) => update({ [key]: { ...r[key], from: v.trim() || undefined } })} />
        </Field>
        <Field label={`${label}: ${names(r.to)}`}>
          <Text value={r[key]?.to ?? ''} disabled={ro} placeholder={placeholder} onCommit={(v) => update({ [key]: { ...r[key], to: v.trim() || undefined } })} />
        </Field>
      </div>
    );
    return (
      <div className="inspector">
        <div className="ins-head rel-head">
          {from && <ElementRow e={from} onClick={() => p.select(from.id)} />}
          <span className="ins-kind-icon">
            <RelIcon />
          </span>
          {to && <ElementRow e={to} onClick={() => p.select(to.id)} />}
        </div>
        <Segmented value={r.kind} disabled={ro} options={RELATIONSHIPS.map((k) => ({ value: k.kind, label: `${k.label}: ${k.hint}`, icon: RELATIONSHIP_ICONS[k.kind] }))} onChange={(kind) => update({ kind })} />
        <Section id="rel-details" title="Details">
          <div className="field-grid">
            <Field label="Label">
              <Text value={r.label ?? ''} disabled={ro} placeholder="placeOrder(), REST" onCommit={(v) => update({ label: orNull(v) })} />
            </Field>
            <Field label="Stereotype">
              <Text value={r.stereotype ?? ''} disabled={ro} placeholder="include, use" onCommit={(v) => update({ stereotype: orNull(v) })} />
            </Field>
          </div>
          {r.stereotype === 'extend' && (
            <div className="field-grid">
              <Field label="Condition">
                <Text value={r.condition ?? ''} disabled={ro} placeholder="card declined" onCommit={(v) => update({ condition: orNull(v) })} />
              </Field>
              <Field label="Extension point">
                {(() => {
                  const target = p.model.elements.find((x) => x.id === r.to);
                  const points = target?.extensionPoints ?? [];
                  return points.length ? (
                    <select value={r.extensionPoint ?? ''} disabled={ro} onChange={(ev) => update({ extensionPoint: ev.target.value || null })}>
                      <option value="">(none)</option>
                      {points.map((pt) => (
                        <option key={pt} value={pt}>
                          {pt}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <Text value={r.extensionPoint ?? ''} disabled={ro} placeholder="payment" onCommit={(v) => update({ extensionPoint: orNull(v) })} />
                  );
                })()}
              </Field>
            </div>
          )}
          <Field label="Description" wide>
            <Text multiline rows={2} disabled={ro} value={r.description ?? ''} onCommit={(v) => update({ description: orNull(v) })} />
          </Field>
        </Section>
        {assoc && (
          <Section id="rel-ends" title="Ends">
            {ends('multiplicity', 'Multiplicity', '0..*')}
            {ends('roles', 'Role', 'items')}
            {ends('qualifier', 'Qualifier', 'isbn')}
            <div className="field-grid">
              <label className="check">
                <input type="checkbox" checked={!!r.navigable?.from} disabled={ro} onChange={(ev) => update({ navigable: { ...r.navigable, from: ev.target.checked || undefined } })} /> to {names(r.from)}
              </label>
              <label className="check">
                <input type="checkbox" checked={!!r.navigable?.to} disabled={ro} onChange={(ev) => update({ navigable: { ...r.navigable, to: ev.target.checked || undefined } })} /> to {names(r.to)}
              </label>
            </div>
            <Field label="Association class" wide>
              <select value={r.associationClass ?? ''} disabled={ro} onChange={(ev) => update({ associationClass: ev.target.value || null })}>
                <option value="">(none)</option>
                {model.elements
                  .filter((x) => x.kind === 'class')
                  .map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
              </select>
            </Field>
          </Section>
        )}
        {selection.waypoints > 0 && !ro && (
          <button type="button" className="btn secondary" onClick={() => p.op('set_edge_waypoints', { id: r.id, waypoints: [] })}>
            {p.modern ? 'Automatic route' : 'Straighten'}
          </button>
        )}
        {diagram.edges.find((e) => e.ref === r.id)?.labelOffset && !ro && (
          <button type="button" className="btn secondary" onClick={() => p.op('set_label_offset', { id: r.id, offset: null })}>
            Reset label position
          </button>
        )}
        <Actions ro={ro} remove={p.removeSelected} del={p.deleteSelectedFromModel} />
      </div>
    );
  }

  // ---- a diagram-local edge -----------------------------------------------------------------
  const ed = selection.edge;
  return (
    <div className="inspector">
      <div className="ins-head">
        <span className="ins-kind-icon">{ed.kind === 'anchor' ? <IconAnchor /> : <IconTransition />}</span>
        <div className="ins-head-text">
          <strong>{ed.kind === 'anchor' ? 'Note link' : ed.kind === 'transition' ? 'Transition' : ed.kind === 'interrupt' ? 'Interrupting edge' : 'Flow'}</strong>
        </div>
      </div>
      <Segmented
        value={ed.kind}
        disabled={ro}
        options={[
          { value: 'transition', label: 'Transition', icon: IconTransition },
          { value: 'flow', label: 'Flow', icon: RELATIONSHIP_ICONS.dependency },
          { value: 'interrupt', label: 'Interrupting edge (leaves an interruptible region)', icon: IconInterrupt },
          { value: 'anchor', label: 'Note link', icon: IconAnchor },
        ]}
        onChange={(kind) => p.op('update_local_edge', { id: ed.id, kind })}
      />
      {ed.kind !== 'anchor' && (
        <Field label={ed.kind === 'transition' ? 'trigger [guard] / effect' : '[guard]'} wide>
          <Text value={ed.label ?? ''} disabled={ro} placeholder={ed.kind === 'transition' ? 'paid [amount > 0] / ship' : '[in stock]'} onCommit={(v) => p.op('update_local_edge', { id: ed.id, label: orNull(v) })} />
        </Field>
      )}
      {ed.waypoints.length > 0 && !ro && (
        <button type="button" className="btn secondary" onClick={() => p.op('set_edge_waypoints', { id: ed.id, waypoints: [] })}>
          {p.modern ? 'Automatic route' : 'Straighten'}
        </button>
      )}
      {ed.labelOffset && !ro && (
        <button type="button" className="btn secondary" onClick={() => p.op('set_label_offset', { id: ed.id, offset: null })}>
          Reset label position
        </button>
      )}
      <Actions ro={ro} remove={p.removeSelected} />
    </div>
  );
}

/** Use case scenario: trigger, preconditions, main steps, alternatives, postconditions. */
function ScenarioEditor({ scenario, onCommit, disabled }: { scenario?: Scenario; onCommit(s: Scenario | null): void; disabled?: boolean }) {
  const s = scenario ?? {};
  const commit = (patch: Partial<Scenario>) => {
    const next: Scenario = { ...s, ...patch };
    const clean = Object.fromEntries(
      Object.entries(next).filter(([, v]) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0)),
    ) as Scenario;
    onCommit(Object.keys(clean).length ? clean : null);
  };
  const alts = s.alternatives ?? [];
  return (
    <Section id="el-scenario" title="Scenario" count={(s.steps?.length ?? 0) + alts.length}>
      <Field label="Trigger" wide>
        <Text value={s.trigger ?? ''} disabled={disabled} placeholder="Customer clicks Checkout" onCommit={(v) => commit({ trigger: v.trim() || undefined })} />
      </Field>
      <div className="sub-title">Preconditions</div>
      <ListField items={s.preconditions ?? []} disabled={disabled} placeholder="Cart is not empty" onCommit={(v) => commit({ preconditions: v })} />
      <div className="sub-title">Main steps</div>
      <ListField numbered items={s.steps ?? []} disabled={disabled} placeholder="System shows the cart" onCommit={(v) => commit({ steps: v })} />
      <div className="sub-title">
        Alternatives
        {!disabled && (
          <button type="button" className="icon-btn subtle" title="Add an alternative flow" onClick={() => commit({ alternatives: [...alts, { when: 'Condition', steps: [] }] })}>
            <IconPlus />
          </button>
        )}
      </div>
      {alts.map((a, i) => (
        <div className="alt" key={i}>
          <div className="list-row">
            <span className="list-num">{String.fromCharCode(97 + i)}</span>
            <Text value={a.when} disabled={disabled} placeholder="Payment declined" onCommit={(v) => commit({ alternatives: alts.map((x, j) => (j === i ? { ...x, when: v.trim() || x.when } : x)) })} />
            {!disabled && (
              <button type="button" className="icon-btn subtle" title="Remove the alternative" onClick={() => commit({ alternatives: alts.filter((_, j) => j !== i) })}>
                <IconRemove />
              </button>
            )}
          </div>
          <ListField numbered items={a.steps} disabled={disabled} placeholder="Ask for another card" onCommit={(v) => commit({ alternatives: alts.map((x, j) => (j === i ? { ...x, steps: v } : x)) })} />
        </div>
      ))}
      <div className="sub-title">Postconditions</div>
      <ListField items={s.postconditions ?? []} disabled={disabled} placeholder="Order is stored" onCommit={(v) => commit({ postconditions: v })} />
    </Section>
  );
}

function DiagramRow({ d, open }: { d: DiagramUsage; open(file: string): void }) {
  const I = TYPE_ICONS[d.type];
  return (
    <div className="ins-row clickable" onClick={() => open(d.file)} title="Open">
      <span className="ins-icon">
        <I />
      </span>
      <span className="ins-name">{d.title}</span>
      <span className="ins-rel">
        <IconOpen />
      </span>
    </div>
  );
}

function Actions({ ro, remove, del }: { ro: boolean; remove(): void; del?: () => void }) {
  if (ro) return null;
  return (
    <div className="ins-footer">
      <button type="button" className="icon-text" onClick={remove} title="Remove from this diagram (Delete)">
        <IconRemove /> Remove from diagram
      </button>
      {del && (
        <button type="button" className="icon-text danger" onClick={del} title="Delete from the model and every diagram (Shift+Delete)">
          <IconTrash /> Delete from model
        </button>
      )}
    </div>
  );
}
