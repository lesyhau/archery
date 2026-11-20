// Sequence diagram editor, canvas style: icon rail on the left (participants, message kinds,
// fragments / refs / notes / constraints), the diagram in the middle (click to select, double-click
// to edit a label, pick a tool and click the lifelines to add a step where you click, drag a
// participant to reorder), the inspector on the right. The layout stays automatic
// (src/render/sequenceLayout.ts); hit areas come from the same layout.
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { parseSequenceDiagram } from '../../src/model/load';
import type { Element as ModelElement, ElementKind, Message, MessageKind, Model, SequenceDiagram, SequenceStep } from '../../src/model/schema';
import { layoutCommunicationWithHits } from '../../src/render/communicationLayout';
import { layoutSequenceWithHits, type Box, type SequenceHits } from '../../src/render/sequenceLayout';
import { SceneSvg } from '../render/SceneSvg';
import { usePanZoom } from '../document/panZoom';
import {
  ELEMENT_ICONS,
  IconActualSize,
  IconCenter,
  IconConstraint,
  IconExisting,
  IconExportPng,
  IconExportSvg,
  IconFill,
  IconFit,
  IconFragment,
  IconNote,
  IconRef,
  IconSelectTool,
  IconTypeCommunication,
  IconTypeSequence,
  IconZoomIn,
  IconZoomOut,
  MESSAGE_ICONS,
} from '../diagram/umlIcons';
import { eventTarget, rootOf, useHostCtx } from '../shared/host';
import { DockPanels } from '../shared/remote';
import { RailResizer } from '../shared/RailResizer';
import { keepInWindow } from '../diagram/Rail';
import { MESSAGE_LABELS, SeqInspector, type SeqSelection } from './SeqInspector';
import { allPaths, insertAt, moveWithin, removeMany, replaceAt, samePath, stepAt, unwrap, wrap, type Path } from './steps';

const EMPTY_MODEL: Model = { elements: [], relationships: [] };
const PARTICIPANT_KINDS = new Set(['actor', 'component', 'externalSystem', 'usecase', 'node', 'class', 'interface', 'artifact']);
const NEW_PARTICIPANTS: { kind: ElementKind; label: string }[] = [
  { kind: 'actor', label: 'Actor' },
  { kind: 'component', label: 'Component' },
  { kind: 'externalSystem', label: 'External system' },
  { kind: 'class', label: 'Object' },
];
const MESSAGE_ORDER: MessageKind[] = ['sync', 'async', 'reply', 'create', 'destroy', 'self', 'lost', 'found'];
type Block = 'fragment' | 'ref' | 'note' | 'constraint';
type SeqTool = { msg: MessageKind } | { block: Block };
const BLOCKS: { block: Block; label: string; icon: () => JSX.Element }[] = [
  { block: 'fragment', label: 'Combined fragment', icon: IconFragment },
  { block: 'ref', label: 'Interaction use', icon: IconRef },
  { block: 'note', label: 'Note', icon: IconNote },
  { block: 'constraint', label: 'Constraint', icon: IconConstraint },
];
const twoClicks = (t: SeqTool) => ('msg' in t ? !['self', 'lost', 'found'].includes(t.msg) : t.block === 'ref');
const inBox = (b: Box, x: number, y: number, pad = 0) => x >= b.x - pad && x <= b.x + b.w + pad && y >= b.y - pad && y <= b.y + b.h + pad;

/** Where a new step goes for a click at height y: after the last step above it, in the innermost operand there. */
function insertion(hits: SequenceHits, y: number): { container: Path; index: number } {
  const ops = hits.operands.filter((o) => y >= o.box.y && y <= o.box.y + o.box.h).sort((a, b) => b.path.length - a.path.length);
  const container = ops[0]?.path ?? [];
  let index = 0;
  for (const s of hits.steps) {
    if (s.path.length !== container.length + 1 || !samePath(s.path.slice(0, -1), container)) continue;
    if (s.y < y) index = Math.max(index, s.path.at(-1)! + 1);
  }
  return { container, index };
}

/** The text a step's inline editor edits. */
function labelOf(step: SequenceStep): string {
  if ('msg' in step) return step.msg.label;
  if ('note' in step) return step.note;
  if ('constraint' in step) return step.constraint;
  if (step.fragment === 'ref') return step.label;
  return step.branches[0]?.guard ?? '';
}
function withLabel(step: SequenceStep, text: string): SequenceStep {
  if ('msg' in step) return { msg: { ...step.msg, label: text } };
  if ('note' in step) return { ...step, note: text };
  if ('constraint' in step) return { ...step, constraint: text };
  if (step.fragment === 'ref') return { ...step, label: text };
  return { ...step, branches: step.branches.map((b, i) => (i === 0 ? { ...b, guard: text } : b)) };
}

/** The sequence diagram editor. Needs a HostContext around it. */
export function SequenceEditor() {
  const host = useHostCtx();
  const sceneRef = host.sceneRef;
  const { text, editable, runOp, post } = host;
  const model = host.model ?? EMPTY_MODEL;
  const parsed = useMemo(() => (text === undefined ? undefined : parseSequenceDiagram(text)), [text]);

  const [draft, setDraft] = useState<SequenceDiagram | null>(null);
  const pendingWrite = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSent = useRef<string>('');

  // Adopt the document unless the user has unsaved changes in flight.
  useEffect(() => {
    if (!parsed?.value || pendingWrite.current) return;
    if (JSON.stringify(parsed.value) === lastSent.current) return;
    setDraft(parsed.value);
  }, [parsed]);

  const write = useCallback(
    (next: SequenceDiagram) => {
      setDraft(next);
      if (!editable) return;
      if (pendingWrite.current) clearTimeout(pendingWrite.current);
      pendingWrite.current = setTimeout(() => {
        pendingWrite.current = null;
        lastSent.current = JSON.stringify(next);
        const roles = Object.fromEntries(next.lifelines.filter((l) => l.role).map((l) => [l.ref, l.role!]));
        void runOp('write_sequence_diagram', {
          title: next.title || 'Untitled',
          lifelines: next.lifelines.map((l) => l.ref),
          roles,
          steps: next.steps,
          ...(next.notation === 'communication' ? { notation: 'communication', ...(next.positions ? { positions: next.positions } : {}) } : {}),
        }).catch(() => undefined);
      }, 400);
    },
    [editable, runOp],
  );

  const comm = draft?.notation === 'communication';
  const laid = useMemo(() => {
    if (!draft) return null;
    const ds = host.settings.diagramStyle;
    if (draft.notation !== 'communication') return layoutSequenceWithHits(draft, model, ds);
    // Communication notation: boxes stand in for lifelines, message labels for steps.
    const { scene, hits: ch } = layoutCommunicationWithHits(draft, model, ds);
    const hits: SequenceHits = {
      lifelines: ch.lifelines.map((l) => ({ ref: l.ref, x: l.box.x + l.box.w / 2, head: l.box, y1: l.box.y, y2: l.box.y + l.box.h })),
      steps: ch.messages.map((m) => ({ path: m.path, kind: 'msg' as const, box: m.box, y: m.box.y, label: m.label })),
      operands: [],
      bottom: scene.height,
    };
    return { scene, hits };
  }, [draft, model, host.settings.diagramStyle]);
  const scene = laid?.scene ?? null;
  const hits = laid?.hits;
  useEffect(() => {
    sceneRef.current = scene && draft ? { scene, title: draft.title } : null;
  }, [scene, draft]);

  const pz = usePanZoom(scene, { maxFit: 1.25, margin: 24, wheel: 'ctrl', panOnWheel: true });
  // A different notation is a different drawing: fit it.
  useEffect(() => {
    if (draft) pz.fit();
  }, [comm]); // eslint-disable-line react-hooks/exhaustive-deps
  const stageEl = useRef<HTMLDivElement | null>(null);
  const bindStage = useCallback(
    (el: HTMLDivElement | null) => {
      stageEl.current = el;
      pz.bind(el);
    },
    [pz.bind],
  );

  const [selection, setSelection] = useState<SeqSelection>(null);
  const [tool, setTool] = useState<SeqTool | null>(null);
  const [pending, setPending] = useState<{ ref: string; y: number } | null>(null);
  const [editing, setEditing] = useState<{ path: Path } | { ref: string } | null>(null);
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const [dragLl, setDragLl] = useState<{ ref: string; x: number } | null>(null);
  const [flyout, setFlyout] = useState(false);
  const down = useRef<{ x: number; y: number } | null>(null);

  const names = useMemo(() => new Map(model.elements.map((e) => [e.id, e.name])), [model]);
  const lifelines = hits?.lifelines.map((l) => l.ref) ?? [];

  // --- coordinates and hit tests ---------------------------------------------------------
  const toScene = (e: { clientX: number; clientY: number }) => {
    const r = stageEl.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left - pz.view.x) / pz.view.k, y: (e.clientY - r.top - pz.view.y) / pz.view.k };
  };
  const nearestLifeline = (x: number, y = 0) => {
    let best: SequenceHits['lifelines'][number] | undefined;
    if (comm) {
      // Communication: the box under the pointer, else the nearest box.
      const inside = hits?.lifelines.find((l) => inBox(l.head, x, y, 4));
      if (inside) return inside.ref;
      const d = (l: SequenceHits['lifelines'][number]) => Math.hypot(l.x - x, l.head.y + l.head.h / 2 - y);
      for (const l of hits?.lifelines ?? []) if (!best || d(l) < d(best)) best = l;
      return best?.ref;
    }
    for (const l of hits?.lifelines ?? []) if (!best || Math.abs(l.x - x) < Math.abs(best.x - x)) best = l;
    return best?.ref;
  };
  const hitTest = (x: number, y: number): { head: string } | { step: Path } | { line: string } | null => {
    if (!hits) return null;
    const head = hits.lifelines.find((l) => inBox(l.head, x, y, 2));
    if (head) return { head: head.ref };
    const inner = hits.steps.filter((s) => s.kind !== 'fragment' && inBox(s.box, x, y, 2)).sort((a, b) => a.box.w * a.box.h - b.box.w * b.box.h)[0];
    if (inner) return { step: inner.path };
    const line = hits.lifelines.find((l) => Math.abs(l.x - x) < 10 && y >= l.y1 && y <= l.y2);
    if (line) return { line: line.ref };
    const frame = hits.steps.filter((s) => s.kind === 'fragment' && inBox(s.box, x, y)).sort((a, b) => b.path.length - a.path.length)[0];
    if (frame) return { step: frame.path };
    return null;
  };

  // --- edits ---------------------------------------------------------------------------
  const setSteps = (steps: SequenceStep[]) => draft && write({ ...draft, steps });
  const addStep = (step: SequenceStep, y: number, edit = true) => {
    if (!draft || !hits) return;
    // Sequence: where you click. Communication: after the selected message, else at the end.
    const selected = selection?.kind === 'steps' && selection.paths.length === 1 ? selection.paths[0]! : null;
    const { container, index } = comm ? (selected ? { container: selected.slice(0, -1), index: selected.at(-1)! + 1 } : { container: [], index: draft.steps.length }) : insertion(hits, y);
    const path = [...container, index];
    setSteps(insertAt(draft.steps, container, index, step));
    setSelection({ kind: 'steps', paths: [path] });
    if (edit) setEditing({ path });
  };
  const deleteSelected = () => {
    if (!draft || !selection) return;
    if (selection.kind === 'lifeline') return removeLifeline(selection.ref);
    setSteps(removeMany(draft.steps, selection.paths));
    setSelection(null);
  };
  const removeLifeline = (ref: string) => {
    if (!draft) return;
    write({ ...draft, lifelines: draft.lifelines.filter((l) => l.ref !== ref) });
    setSelection(null);
  };
  const moveLifeline = (ref: string, delta: number) => {
    if (!draft) return;
    const refs = draft.lifelines.map((l) => l.ref);
    const i = refs.indexOf(ref);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= refs.length) return;
    [refs[i], refs[j]] = [refs[j]!, refs[i]!];
    write({ ...draft, lifelines: refs.map((r) => ({ ref: r })) });
  };
  const moveStep = (path: Path, delta: number) => {
    if (!draft) return;
    const r = moveWithin(draft.steps, path, delta);
    setSteps(r.steps);
    setSelection({ kind: 'steps', paths: [r.path] });
  };
  const wrapSelected = () => {
    if (!draft || selection?.kind !== 'steps') return;
    const r = wrap(draft.steps, selection.paths, 'opt');
    if (!r) return host.post({ type: 'error', message: 'Select steps next to each other (same level) to group them.' });
    setSteps(r.steps);
    setSelection({ kind: 'steps', paths: [r.path] });
  };

  const addParticipant = async (kind: ElementKind, label: string) => {
    if (!draft) return;
    const taken = new Set(model.elements.map((e) => e.name));
    let name = label;
    for (let i = 1; taken.has(name); i++) name = `${label} ${i}`;
    try {
      const { id } = await runOp<{ id: string }>('add_element', { name, kind });
      write({ ...draft, lifelines: draft.lifelines.some((l) => l.ref === id) ? draft.lifelines : [...draft.lifelines, { ref: id }] });
      setSelection({ kind: 'lifeline', ref: id });
      setEditing({ ref: id });
    } catch {
      // toast
    }
  };
  const addExisting = (id: string) => {
    if (!draft || draft.lifelines.some((l) => l.ref === id)) return;
    write({ ...draft, lifelines: [...draft.lifelines, { ref: id }] });
    setSelection({ kind: 'lifeline', ref: id });
    setFlyout(false);
  };

  /** A click on the diagram with a tool: adds the step there. */
  const applyTool = (t: SeqTool, x: number, y: number) => {
    const ll = nearestLifeline(x, y);
    if (!ll || !draft) return;
    if (twoClicks(t) && !pending) return setPending({ ref: ll, y });
    if ('msg' in t) {
      const kind = t.msg;
      let msg: Message;
      if (kind === 'lost') msg = { from: ll, label: '', kind };
      else if (kind === 'found') msg = { to: ll, label: '', kind };
      else if (kind === 'self' || pending?.ref === ll) msg = { from: ll, to: ll, label: '', kind: 'self' };
      else msg = { from: pending!.ref, to: ll, label: '', kind };
      addStep({ msg }, pending?.y ?? y);
    } else if (t.block === 'ref') {
      const a = lifelines.indexOf(pending!.ref);
      const b = lifelines.indexOf(ll);
      addStep({ fragment: 'ref', label: '', over: lifelines.slice(Math.min(a, b), Math.max(a, b) + 1) }, pending!.y);
    } else if (t.block === 'note') addStep({ note: '', over: [ll] }, y);
    else if (t.block === 'constraint') addStep({ constraint: '', over: [ll] }, y);
    else addStep({ fragment: 'alt', branches: [{ guard: '', steps: [] }, { guard: 'else', steps: [] }] }, y);
    setPending(null);
  };

  // --- pointer handling on the diagram ----------------------------------------------------------
  const onPointerDown = (e: ReactPointerEvent) => {
    down.current = { x: e.clientX, y: e.clientY };
    if (!hits || e.button !== 0) return;
    const pt = toScene(e);
    const head = hits.lifelines.find((l) => inBox(l.head, pt.x, pt.y, 2));
    if (head && !tool && editable && comm && draft) {
      // Communication: drag a box to place it; all boxes keep their place from then on.
      const start = toScene(e);
      const base = Object.fromEntries(hits.lifelines.map((l) => [l.ref, { x: Math.round(l.head.x), y: Math.round(l.head.y) }]));
      let moved = false;
      let latest = base;
      const move = (ev: PointerEvent) => {
        const at = toScene(ev);
        if (!moved && Math.hypot(at.x - start.x, at.y - start.y) < 3) return;
        moved = true;
        latest = { ...base, [head.ref]: { x: Math.round(base[head.ref]!.x + at.x - start.x), y: Math.round(base[head.ref]!.y + at.y - start.y) } };
        setDraft((d) => (d ? { ...d, positions: latest } : d));
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        if (moved) write({ ...draft, positions: latest });
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      return;
    }
    // Dragging a participant's header reorders the participants.
    if (head && !tool && editable && draft?.lifelines.some((l) => l.ref === head.ref)) {
      const start = e.clientX;
      let moved = false;
      const move = (ev: PointerEvent) => {
        if (!moved && Math.abs(ev.clientX - start) < 4) return;
        moved = true;
        setDragLl({ ref: head.ref, x: toScene(ev).x });
      };
      const up = (ev: PointerEvent) => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        setDragLl(null);
        if (!moved || !draft) return;
        const x = toScene(ev).x;
        const order = hits.lifelines
          .filter((l) => draft.lifelines.some((d) => d.ref === l.ref))
          .map((l) => ({ ref: l.ref, x: l.ref === head.ref ? x : l.x }))
          .sort((a, b) => a.x - b.x)
          .map((l) => ({ ref: l.ref }));
        write({ ...draft, lifelines: order });
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      return;
    }
    pz.startPan(e);
  };

  const onClick = (e: ReactMouseEvent) => {
    const d = down.current;
    if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4) return; // a pan, not a click
    const active = rootOf(stageEl.current).activeElement as HTMLElement | null;
    if (active?.closest('.inspector')) active.blur();
    if (!hits) return;
    const pt = toScene(e);
    if (tool && editable) return applyTool(tool, pt.x, pt.y);
    const h = hitTest(pt.x, pt.y);
    if (!h) return setSelection(null);
    if ('head' in h) return setSelection({ kind: 'lifeline', ref: h.head });
    if ('line' in h) return setSelection({ kind: 'lifeline', ref: h.line });
    if (e.shiftKey && selection?.kind === 'steps' && samePath(selection.paths[0]!.slice(0, -1), h.step.slice(0, -1))) {
      // Shift+click: the range of siblings between the first selected step and this one.
      const base = selection.paths[0]!;
      const [a, b] = [base.at(-1)!, h.step.at(-1)!].sort((p, q) => p - q);
      const parent = base.slice(0, -1);
      return setSelection({ kind: 'steps', paths: Array.from({ length: b! - a! + 1 }, (_, k) => [...parent, a! + k]) });
    }
    setSelection({ kind: 'steps', paths: [h.step] });
  };

  const onDoubleClick = (e: ReactMouseEvent) => {
    if (!editable || !hits || tool) return;
    const pt = toScene(e);
    const h = hitTest(pt.x, pt.y);
    if (h && 'step' in h) {
      setSelection({ kind: 'steps', paths: [h.step] });
      setEditing({ path: h.step });
    } else if (h && 'head' in h && names.has(h.head)) {
      setSelection({ kind: 'lifeline', ref: h.head });
      setEditing({ ref: h.head });
    }
  };

  // --- keyboard ----------------------------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = eventTarget(e);
      if (stageEl.current && !rootOf(stageEl.current).contains(t)) return;
      if (t.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (e.shiftKey && (e.code === 'Digit1' || e.key === '!')) return pz.fit();
      if (e.shiftKey && (e.code === 'Digit2' || e.key === '@')) return pz.center();
      if (e.shiftKey && (e.code === 'Digit0' || e.key === ')')) return pz.actualSize();
      if (!e.ctrlKey && !e.metaKey && (e.key === '+' || e.key === '=')) return pz.zoomCenter(1.25);
      if (!e.ctrlKey && !e.metaKey && (e.key === '-' || e.key === '_')) return pz.zoomCenter(1 / 1.25);
      if (e.key === 'Escape') {
        setTool(null);
        setPending(null);
        setEditing(null);
        setSelection(null);
        setFlyout(false);
        return;
      }
      if (!draft) return;
      if (editable && (e.key === 'Delete' || e.key === 'Backspace') && selection) {
        e.preventDefault();
        return deleteSelected();
      }
      if (editable && (e.key === 'F2' || e.key === 'Enter') && selection) {
        e.preventDefault();
        if (selection.kind === 'lifeline') setEditing({ ref: selection.ref });
        else if (selection.paths.length === 1) setEditing({ path: selection.paths[0]! });
        return;
      }
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        const delta = e.key === 'ArrowUp' ? -1 : 1;
        const current = selection?.kind === 'steps' ? selection.paths.at(-1) : undefined;
        if (e.altKey && current && editable) return moveStep(current, delta);
        const order = allPaths(draft.steps);
        if (!order.length) return;
        const i = current ? order.findIndex((p) => samePath(p, current)) : -1;
        const next = order[Math.min(order.length - 1, Math.max(0, i < 0 ? 0 : i + delta))]!;
        setSelection({ kind: 'steps', paths: [next] });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (text === undefined) return <div className="placeholder">Loading…</div>;
  if (!draft || !hits || !scene) {
    return (
      <div className="banner error">
        {'Invalid sequence diagram:\n'}
        {parsed?.issues.map((i) => `• ${i.message}`).join('\n')}
      </div>
    );
  }

  const onIt = new Set(draft.lifelines.map((l) => l.ref));
  const candidates = model.elements.filter((e) => PARTICIPANT_KINDS.has(e.kind) && !onIt.has(e.id));
  const toolKey = tool ? ('msg' in tool ? tool.msg : tool.block) : 'select';
  const pickTool = (t: SeqTool | null) => {
    setPending(null);
    if (t && 'block' in t && t.block === 'fragment' && selection?.kind === 'steps') {
      // With steps selected, the fragment tool groups them at once.
      wrapSelected();
      return;
    }
    setTool(t && toolKey === ('msg' in t ? t.msg : t.block) ? null : t);
  };

  // Inline editor (in diagram coordinates, so it scales with the zoom).
  let inline: JSX.Element | null = null;
  if (editing && editable) {
    if ('path' in editing) {
      const h = hits.steps.find((s) => samePath(s.path, editing.path));
      const step = stepAt(draft.steps, editing.path);
      if (h && step) {
        const at = h.label ?? { x: h.box.x + h.box.w / 2, y: h.box.y + h.box.h / 2, anchor: 'middle' as const };
        inline = (
          <InlineInput
            key={editing.path.join('.')}
            x={at.x}
            y={at.y}
            middle={at.anchor === 'middle'}
            value={labelOf(step)}
            placeholder={'msg' in step ? 'message(args)' : 'note' in step ? 'Note' : 'constraint' in step ? 'response < 2s' : 'branches' in step ? 'condition' : 'Interaction'}
            onDone={(v) => {
              setEditing(null);
              if (v !== null && v !== labelOf(step)) setSteps(replaceAt(draft.steps, editing.path, withLabel(step, v)));
            }}
          />
        );
      }
    } else {
      const l = hits.lifelines.find((x) => x.ref === editing.ref);
      if (l) {
        inline = (
          <InlineInput
            key={editing.ref}
            x={l.x}
            y={l.head.y + l.head.h / 2 + 5}
            middle
            value={names.get(editing.ref) ?? ''}
            placeholder="Name"
            onDone={(v) => {
              setEditing(null);
              if (v && v.trim() && v.trim() !== names.get(editing.ref)) void runOp('update_element', { id: editing.ref, name: v.trim() }).catch(() => undefined);
            }}
          />
        );
      }
    }
  }

  const sel = selection;
  const left = Math.min(...hits.lifelines.map((l) => l.head.x)) - 20;
  const right = Math.max(...hits.lifelines.map((l) => l.head.x + l.head.w)) + 20;
  const hoverLl = tool && hover ? hits.lifelines.find((l) => l.ref === nearestLifeline(hover.x, hover.y)) : undefined;

  // The palette and inspector, drawn here or docked in the Archery sidebar (webview/shared/remote.ts).
  const railProps: ComponentProps<typeof SeqRail> = { comm, toolKey, candidates, flyout, setFlyout, addParticipant: (kind, label) => void addParticipant(kind, label), addExisting, pickTool };
  const inspectorProps: ComponentProps<typeof SeqInspector> = {
    diagram: draft,
    model,
    selection,
    editable,
    lifelines,
    change: write,
    updateStep: (path, step) => setSteps(replaceAt(draft.steps, path, step)),
    op: (name, input) => void runOp(name, input).catch(() => undefined),
    select: setSelection,
    moveStep,
    moveLifeline,
    removeLifeline,
    deleteSelected,
    wrapSelected,
    unwrap: (path) => {
      setSteps(unwrap(draft.steps, path));
      setSelection(null);
    },
  };

  return (
    <div className="seq-editor">
      <div className="toolbar">
        <span className="meta" title="Sequence diagram">
          <IconTypeSequence />
        </span>
        <span className="title">{draft.title || 'Untitled sequence'}</span>
        <span className="spacer" />
        <span className="notation" role="radiogroup" aria-label="Notation">
          <button
            type="button"
            role="radio"
            aria-checked={!comm}
            className={`tb icon${!comm ? ' on' : ''}`}
            title="Sequence notation"
            disabled={!editable}
            onClick={() => comm && (write({ ...draft, notation: undefined }), setTool(null))}
          >
            <IconTypeSequence />
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={comm}
            className={`tb icon${comm ? ' on' : ''}`}
            title="Communication notation"
            disabled={!editable}
            onClick={() => !comm && (write({ ...draft, notation: 'communication' }), setTool(null))}
          >
            <IconTypeCommunication />
          </button>
        </span>
        <span className="tb-sep" />
        <button type="button" className="tb icon" title="Zoom out (-)" onClick={() => pz.zoomCenter(1 / 1.25)}>
          <IconZoomOut />
        </button>
        <button type="button" className="tb zoom" title="Actual size (Shift+0)" onClick={pz.actualSize}>
          {Math.round(pz.view.k * 100)}%
        </button>
        <button type="button" className="tb icon" title="Zoom in (+)" onClick={() => pz.zoomCenter(1.25)}>
          <IconZoomIn />
        </button>
        <button type="button" className="tb icon" title="Fit: show the whole diagram (Shift+1)" onClick={pz.fit}>
          <IconFit />
        </button>
        <button type="button" className="tb icon" title="Fill: cover the view" onClick={pz.fill}>
          <IconFill />
        </button>
        <button type="button" className="tb icon" title="Actual size, 100% (Shift+0)" onClick={pz.actualSize}>
          <IconActualSize />
        </button>
        <button type="button" className="tb icon" title="Center the diagram (Shift+2)" onClick={pz.center}>
          <IconCenter />
        </button>
        <span className="tb-sep" />
        <button type="button" className="tb icon" title="Export as SVG" onClick={() => post({ type: 'export', format: 'svg' })}>
          <IconExportSvg />
        </button>
        <button type="button" className="tb icon" title="Export as PNG" onClick={() => post({ type: 'export', format: 'png' })}>
          <IconExportPng />
        </button>
      </div>
      {!editable && <div className="banner warning">Read-only</div>}
      {host.modelIssues.length > 0 && <div className="banner warning">{host.modelIssues.join('\n')}</div>}
      <div className="workspace">
        <DockPanels panels={{ title: draft.title || 'Untitled sequence', rail: editable ? { component: 'seqRail', props: railProps } : undefined, inspector: { component: 'seqInspector', props: inspectorProps } }} />
        {editable && !host.docked && <SeqRail {...railProps} />}
        {editable && !host.docked && <RailResizer />}
        <div
          className={`preview${tool ? ' tool-active' : ''}`}
          ref={bindStage}
          onPointerDown={onPointerDown}
          onClick={onClick}
          onDoubleClick={onDoubleClick}
          onPointerMove={(e) => tool && setHover(toScene(e))}
          onPointerLeave={() => setHover(null)}
        >
          <div className="stage-canvas" style={{ transform: `translate(${pz.view.x}px, ${pz.view.y}px) scale(${pz.view.k})`, width: scene.width, height: scene.height }}>
            <SceneSvg scene={scene} label={draft.title} />
            <svg className="seq-overlay" width={scene.width} height={scene.height} aria-hidden="true">
              {sel?.kind === 'steps' &&
                sel.paths.map((p) => {
                  const h = hits.steps.find((s) => samePath(s.path, p));
                  return h ? <rect key={p.join('.')} className="hl" x={h.box.x - 3} y={h.box.y - 3} width={h.box.w + 6} height={h.box.h + 6} rx={4} /> : null;
                })}
              {sel?.kind === 'lifeline' &&
                hits.lifelines
                  .filter((l) => l.ref === sel.ref)
                  .map((l) => (
                    <g key={l.ref}>
                      <rect className="hl" x={l.head.x - 3} y={l.head.y - 3} width={l.head.w + 6} height={l.head.h + 6} rx={4} />
                      <line className="hl-line" x1={l.x} y1={l.y1} x2={l.x} y2={l.y2} />
                    </g>
                  ))}
              {pending &&
                hits.lifelines
                  .filter((l) => l.ref === pending.ref)
                  .map((l) => (
                    <g key="pending">
                      <rect className="hl pending" x={l.head.x - 4} y={l.head.y - 4} width={l.head.w + 8} height={l.head.h + 8} rx={5} />
                      <circle className="pending-dot" cx={l.x} cy={pending.y} r={4} />
                    </g>
                  ))}
              {tool && hover && !comm && (
                <>
                  <line className="guide" x1={left} y1={pending?.y ?? hover.y} x2={right} y2={pending?.y ?? hover.y} />
                  {hoverLl && <line className="hl-line hover" x1={hoverLl.x} y1={hoverLl.y1} x2={hoverLl.x} y2={hoverLl.y2} />}
                </>
              )}
              {dragLl && <line className="guide drop" x1={dragLl.x} y1={0} x2={dragLl.x} y2={scene.height} />}
            </svg>
            {inline}
          </div>
          {lifelines.length === 0 && editable && <div className="empty-hint">Add participants from the left to start.</div>}
          {tool && (
            <div className="tool-hint" role="status">
              {pending ? ('msg' in tool ? 'Now click the receiver' : 'Now click the last participant') : twoClicks(tool) ? ('msg' in tool ? 'Click the sender' : 'Click the first participant') : 'Click where it goes'} · Esc to stop
            </div>
          )}
        </div>
        {!host.docked && (
          <aside className="properties">
            <SeqInspector {...inspectorProps} />
          </aside>
        )}
      </div>
      {host.error && (
        <div className="toast" role="alert" onClick={host.clearError}>
          {host.error}
        </div>
      )}
    </div>
  );
}

/** A label editor placed on the diagram; Enter / blur saves, Esc cancels. */
export function InlineInput({ x, y, middle, value, placeholder, onDone }: { x: number; y: number; middle: boolean; value: string; placeholder: string; onDone(v: string | null): void }) {
  const [v, setV] = useState(value);
  const done = useRef(false);
  const finish = (result: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(result);
  };
  return (
    <input
      className="inline-edit"
      autoFocus
      value={v}
      placeholder={placeholder}
      style={{ left: x, top: y - 15, transform: middle ? 'translateX(-50%)' : undefined }}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setV(e.target.value)}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onBlur={() => finish(v)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') finish(v);
        if (e.key === 'Escape') finish(null);
      }}
    />
  );
}

/** The sequence editor's palette: new participants, messages, blocks (also docked in the sidebar). */
export function SeqRail({ comm, toolKey, candidates, flyout, setFlyout, addParticipant, addExisting, pickTool }: { comm: boolean; toolKey: string; candidates: ModelElement[]; flyout: boolean; setFlyout(v: boolean): void; addParticipant(kind: ElementKind, label: string): void; addExisting(id: string): void; pickTool(t: SeqTool | null): void }) {
  return (
    <aside className="rail" aria-label="Tools">
      <div className="rail-group" aria-label="Participants">
        {NEW_PARTICIPANTS.map((p) => {
          const I = ELEMENT_ICONS[p.kind];
          return (
            <button type="button" key={p.kind} className="rail-btn" data-participant={p.kind} title={`New participant: ${p.label}`} onClick={() => void addParticipant(p.kind, p.label)}>
              <I />
              <span className="rail-label">{p.label}</span>
            </button>
          );
        })}
        {candidates.length > 0 && (
          <div className="rail-flyout-host">
            <button type="button" className={`rail-btn${flyout ? ' on' : ''}`} title={`Participants from the model (${candidates.length})`} aria-expanded={flyout} onClick={() => setFlyout(!flyout)}>
              <IconExisting />
              <span className="rail-label">{'From the model'}</span>
              <span className="rail-badge">{candidates.length}</span>
            </button>
            {flyout && (
              <div className="rail-flyout" role="dialog" aria-label="Participants from the model" ref={keepInWindow}>
                <div className="rail-flyout-list">
                  {candidates.map((e) => {
                    const I = ELEMENT_ICONS[e.kind];
                    return (
                      <button type="button" key={e.id} className="flyout-item" onClick={() => addExisting(e.id)}>
                        <I />
                        <span>{e.name}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
      <div className="rail-group" role="radiogroup" aria-label="Messages">
        <button type="button" role="radio" aria-checked={toolKey === 'select'} className={`rail-btn${toolKey === 'select' ? ' on' : ''}`} title="Select (Esc)" onClick={() => pickTool(null)}>
          <IconSelectTool />
          <span className="rail-label">{'Select'}</span>
        </button>
        {MESSAGE_ORDER.map((k) => {
          const I = MESSAGE_ICONS[k];
          return (
            <button
              type="button"
              key={k}
              role="radio"
              aria-checked={toolKey === k}
              data-tool={k}
              className={`rail-btn${toolKey === k ? ' on' : ''}`}
              title={MESSAGE_LABELS[k]}
              onClick={() => pickTool({ msg: k })}
            >
              <I />
              <span className="rail-label">{MESSAGE_LABELS[k]}</span>
            </button>
          );
        })}
      </div>
      <div className="rail-group" role="radiogroup" aria-label="Blocks">
        {BLOCKS.map((b) => (
          <button
            type="button"
            key={b.block}
            role="radio"
            aria-checked={toolKey === b.block}
            data-tool={b.block}
            className={`rail-btn${toolKey === b.block ? ' on' : ''}`}
            disabled={comm}
            title={comm ? `${b.label.split(':')[0]}: only in the sequence notation` : b.label}
            onClick={() => pickTool({ block: b.block })}
          >
            <b.icon />
            <span className="rail-label">{b.label.split(':')[0]!.replace(/\s*[({].*$/, '')}</span>
          </button>
        ))}
      </div>
    </aside>
  );
}
