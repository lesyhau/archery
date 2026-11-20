// Timing diagram editor, canvas style like the sequence editor: participants and tools on the
// left rail, the diagram in the middle, the inspector on the right. Pick the state change tool
// and click a state row at a point in time; drag a change along the time axis (or to another
// state); messages and duration constraints take two clicks. Times snap to half ticks (Alt: free).
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { parseTimingDiagram } from '../../src/model/load';
import type { Element as ModelElement, ElementKind, Model, TimingDiagram, TimingLifeline } from '../../src/model/schema';
import type { Box } from '../../src/render/sequenceLayout';
import { layoutTimingWithHits, statesOf, timeScale, type TimingHits } from '../../src/render/timingLayout';
import { usePanZoom } from '../document/panZoom';
import {
  ELEMENT_ICONS,
  IconActualSize,
  IconCenter,
  IconDuration,
  IconExisting,
  IconExportPng,
  IconExportSvg,
  IconFill,
  IconFit,
  IconSelectTool,
  IconStateChange,
  IconTimeMark,
  IconTimingMessage,
  IconTypeTiming,
  IconZoomIn,
  IconZoomOut,
} from '../diagram/umlIcons';
import { SceneSvg } from '../render/SceneSvg';
import { InlineInput } from '../sequence/SequenceEditor';
import { eventTarget, rootOf, useHostCtx } from '../shared/host';
import { DockPanels } from '../shared/remote';
import { RailResizer } from '../shared/RailResizer';
import { keepInWindow } from '../diagram/Rail';
import { TimingInspector, type TimingSelection } from './TimingInspector';

const EMPTY_MODEL: Model = { elements: [], relationships: [] };
const PARTICIPANT_KINDS = new Set(['actor', 'component', 'externalSystem', 'node', 'class', 'interface', 'artifact', 'instance', 'part']);
const NEW_PARTICIPANTS: { kind: ElementKind; label: string }[] = [
  { kind: 'actor', label: 'Actor' },
  { kind: 'component', label: 'Component' },
  { kind: 'externalSystem', label: 'External system' },
  { kind: 'class', label: 'Object' },
];
type Tool = 'change' | 'message' | 'duration' | 'time';
const TOOLS: { tool: Tool; label: string; icon: () => JSX.Element }[] = [
  { tool: 'change', label: 'State change', icon: IconStateChange },
  { tool: 'message', label: 'Message', icon: IconTimingMessage },
  { tool: 'duration', label: 'Duration constraint', icon: IconDuration },
  { tool: 'time', label: 'Time constraint', icon: IconTimeMark },
];
const twoClicks = (t: Tool) => t === 'message' || t === 'duration';
const inBox = (b: Box, x: number, y: number, pad = 0) => x >= b.x - pad && x <= b.x + b.w + pad && y >= b.y - pad && y <= b.y + b.h + pad;
const area = (b: Box) => b.w * b.h;
const round = (n: number) => Math.round(n * 1000) / 1000;

type Hit =
  | { constraint: number }
  | { message: number }
  | { change: { ref: string; index: number } }
  | { stateLabel: { ref: string; state: string } }
  | { name: string }
  | { lifeline: string };

type Editing = { message: number } | { constraint: number } | { name: string } | { state: { ref: string; state: string } } | { value: { ref: string; index: number } };

/** Removes a lifeline with its messages and constraints. */
export function withoutLifeline(d: TimingDiagram, ref: string): TimingDiagram {
  return {
    ...d,
    lifelines: d.lifelines.filter((l) => l.ref !== ref),
    messages: d.messages.filter((m) => m.from !== ref && m.to !== ref),
    constraints: d.constraints.filter((c) => c.on !== ref),
  };
}

/** Renames a state of a lifeline (its row and every change to it). */
export function renameState(d: TimingDiagram, ref: string, from: string, to: string): TimingDiagram {
  return {
    ...d,
    lifelines: d.lifelines.map((l) =>
      l.ref !== ref
        ? l
        : {
            ...l,
            states: [...new Set(statesOf(l).map((s) => (s === from ? to : s)))],
            changes: l.changes.map((c) => (c.state === from ? { ...c, state: to } : c)),
          },
    ),
  };
}

/** The timing diagram editor. Needs a HostContext around it. */
export function TimingEditor() {
  const host = useHostCtx();
  const sceneRef = host.sceneRef;
  const { text, editable, runOp, post } = host;
  const model = host.model ?? EMPTY_MODEL;
  const parsed = useMemo(() => (text === undefined ? undefined : parseTimingDiagram(text)), [text]);

  const [draft, setDraft] = useState<TimingDiagram | null>(null);
  const pendingWrite = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSent = useRef<string>('');

  // Adopt the document unless the user has unsaved changes in flight.
  useEffect(() => {
    if (!parsed?.value || pendingWrite.current) return;
    if (JSON.stringify(parsed.value) === lastSent.current) return;
    setDraft(parsed.value);
  }, [parsed]);

  const write = useCallback(
    (next: TimingDiagram) => {
      setDraft(next);
      if (!editable) return;
      if (pendingWrite.current) clearTimeout(pendingWrite.current);
      pendingWrite.current = setTimeout(() => {
        pendingWrite.current = null;
        lastSent.current = JSON.stringify(next);
        void runOp('write_timing_diagram', {
          title: next.title || 'Untitled',
          unit: next.unit,
          ...(next.end ? { end: next.end } : {}),
          ...(next.tick ? { tick: next.tick } : {}),
          lifelines: next.lifelines,
          messages: next.messages,
          constraints: next.constraints,
        }).catch(() => undefined);
      }, 400);
    },
    [editable, runOp],
  );

  const ds = host.settings.diagramStyle;
  const laid = useMemo(() => (draft ? layoutTimingWithHits(draft, model, ds) : null), [draft, model, ds]);
  const scene = laid?.scene ?? null;
  const hits = laid?.hits;
  useEffect(() => {
    sceneRef.current = scene && draft ? { scene, title: draft.title } : null;
  }, [scene, draft]);

  const pz = usePanZoom(scene, { maxFit: 1.25, margin: 24, wheel: 'ctrl', panOnWheel: true });
  const stageEl = useRef<HTMLDivElement | null>(null);
  const bindStage = useCallback(
    (el: HTMLDivElement | null) => {
      stageEl.current = el;
      pz.bind(el);
    },
    [pz.bind],
  );

  const [selection, setSelection] = useState<TimingSelection>(null);
  const [tool, setTool] = useState<Tool | null>(null);
  const [pending, setPending] = useState<{ ref: string; t: number } | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [hover, setHover] = useState<{ x: number; y: number; t: number } | null>(null);
  const [dragLl, setDragLl] = useState<{ ref: string; y: number } | null>(null);
  const [flyout, setFlyout] = useState(false);
  const down = useRef<{ x: number; y: number } | null>(null);
  const dragged = useRef(false);

  const names = useMemo(() => new Map(model.elements.map((e) => [e.id, e.name])), [model]);
  const scale = draft ? timeScale(draft) : { end: 1, tick: 1 };
  const step = scale.tick / 2;

  // --- coordinates and hit tests -----------------------------------------------------------
  const toScene = (e: { clientX: number; clientY: number }) => {
    const r = stageEl.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left - pz.view.x) / pz.view.k, y: (e.clientY - r.top - pz.view.y) / pz.view.k };
  };
  const timeAt = (x: number, free = false) => {
    if (!hits) return 0;
    const t = ((x - hits.axis.x0) / (hits.axis.x1 - hits.axis.x0)) * hits.axis.end;
    const clamped = Math.min(Math.max(t, 0), hits.axis.end);
    return round(free ? clamped : Math.round(clamped / step) * step);
  };
  const xAt = (t: number) => (hits ? hits.axis.x0 + (t / hits.axis.end) * (hits.axis.x1 - hits.axis.x0) : 0);
  const lifelineAt = (y: number) => hits?.lifelines.find((l) => y >= l.box.y && y <= l.box.y + l.box.h);
  const nearestRow = (l: TimingHits['lifelines'][number], y: number) => {
    let best: (typeof l.rows)[number] | undefined;
    for (const r of l.rows) if (!best || Math.abs(r.y - y) < Math.abs(best.y - y)) best = r;
    return best;
  };
  const hitTest = (x: number, y: number): Hit | null => {
    if (!hits) return null;
    const c = hits.constraints.filter((h) => inBox(h.box, x, y)).sort((a, b) => area(a.box) - area(b.box))[0];
    if (c) return { constraint: c.index };
    const ch = hits.changes.filter((h) => inBox(h.box, x, y, 2)).sort((a, b) => Math.abs(a.x - x) - Math.abs(b.x - x))[0];
    if (ch) return { change: { ref: ch.ref, index: ch.index } };
    const m = hits.messages.filter((h) => inBox(h.box, x, y)).sort((a, b) => area(a.box) - area(b.box))[0];
    if (m) return { message: m.index };
    for (const l of hits.lifelines) {
      const row = l.rows.find((r) => inBox(r.label, x, y));
      if (row) return { stateLabel: { ref: l.ref, state: row.state } };
      if (inBox(l.name, x, y)) return { name: l.ref };
      if (inBox(l.box, x, y)) return { lifeline: l.ref };
    }
    return null;
  };

  // --- edits ---------------------------------------------------------------------------------
  const lifeline = (ref: string) => draft?.lifelines.find((l) => l.ref === ref);
  const setLifeline = (ref: string, f: (l: TimingLifeline) => TimingLifeline) => draft && write({ ...draft, lifelines: draft.lifelines.map((l) => (l.ref === ref ? f(l) : l)) });

  const deleteSelected = () => {
    if (!draft || !selection) return;
    if (selection.kind === 'lifeline') write(withoutLifeline(draft, selection.ref));
    else if (selection.kind === 'change') setLifeline(selection.ref, (l) => ({ ...l, changes: l.changes.filter((_, i) => i !== selection.index) }));
    else if (selection.kind === 'message') write({ ...draft, messages: draft.messages.filter((_, i) => i !== selection.index) });
    else write({ ...draft, constraints: draft.constraints.filter((_, i) => i !== selection.index) });
    setSelection(null);
  };
  const moveLifeline = (ref: string, delta: number) => {
    if (!draft) return;
    const ls = [...draft.lifelines];
    const i = ls.findIndex((l) => l.ref === ref);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= ls.length) return;
    [ls[i], ls[j]] = [ls[j]!, ls[i]!];
    write({ ...draft, lifelines: ls });
  };

  const addParticipant = async (kind: ElementKind, label: string) => {
    if (!draft) return;
    const taken = new Set(model.elements.map((e) => e.name));
    let name = label;
    for (let i = 1; taken.has(name); i++) name = `${label} ${i}`;
    try {
      const { id } = await runOp<{ id: string }>('add_element', { name, kind });
      write({ ...draft, lifelines: draft.lifelines.some((l) => l.ref === id) ? draft.lifelines : [...draft.lifelines, { ref: id, states: [], changes: [] }] });
      setSelection({ kind: 'lifeline', ref: id });
      setEditing({ name: id });
    } catch {
      // toast
    }
  };
  const addExisting = (id: string) => {
    if (!draft || draft.lifelines.some((l) => l.ref === id)) return;
    write({ ...draft, lifelines: [...draft.lifelines, { ref: id, states: [], changes: [] }] });
    setSelection({ kind: 'lifeline', ref: id });
    setFlyout(false);
  };

  /** A click on the diagram with a tool. */
  const applyTool = (t: Tool, x: number, y: number, free: boolean) => {
    if (!draft || !hits) return;
    const l = lifelineAt(y);
    const time = timeAt(x, free);
    if (!l) return;
    const ll = lifeline(l.ref);
    if (!ll) return;
    if (twoClicks(t) && !pending) return setPending({ ref: l.ref, t: time });
    if (t === 'change') {
      const existing = ll.changes.findIndex((c) => Math.abs(c.at - time) < 1e-9);
      if (ll.form === 'value') {
        const prev = [...ll.changes].sort((a, b) => a.at - b.at).filter((c) => c.at <= time).at(-1);
        const value = prev ? `${prev.state}'` : 'value';
        const index = existing >= 0 ? existing : ll.changes.length;
        setLifeline(l.ref, (x) => ({ ...x, changes: existing >= 0 ? x.changes : [...x.changes, { at: time, state: value }] }));
        setSelection({ kind: 'change', ref: l.ref, index });
        setEditing({ value: { ref: l.ref, index } });
        return;
      }
      const row = nearestRow(l, y);
      if (!row) {
        // No states yet: add the first one and name it.
        setLifeline(l.ref, (x) => ({ ...x, states: ['State 1'], changes: [{ at: time, state: 'State 1' }] }));
        setSelection({ kind: 'change', ref: l.ref, index: 0 });
        setEditing({ state: { ref: l.ref, state: 'State 1' } });
        return;
      }
      if (existing >= 0) {
        setLifeline(l.ref, (x) => ({ ...x, changes: x.changes.map((c, i) => (i === existing ? { ...c, state: row.state } : c)) }));
        setSelection({ kind: 'change', ref: l.ref, index: existing });
      } else {
        setLifeline(l.ref, (x) => ({ ...x, changes: [...x.changes, { at: time, state: row.state }] }));
        setSelection({ kind: 'change', ref: l.ref, index: ll.changes.length });
      }
      return;
    }
    if (t === 'message') {
      const p = pending!;
      const msg = { from: p.ref, to: l.ref, at: p.t, ...(time > p.t ? { arrive: time } : {}), label: '', kind: 'async' as const };
      write({ ...draft, messages: [...draft.messages, msg] });
      setSelection({ kind: 'message', index: draft.messages.length });
      setEditing({ message: draft.messages.length });
    } else if (t === 'duration') {
      const p = pending!;
      const [from, to] = p.t === time ? [p.t, round(p.t + scale.tick)] : [Math.min(p.t, time), Math.max(p.t, time)];
      write({ ...draft, constraints: [...draft.constraints, { on: p.ref, from, to, label: '' }] });
      setSelection({ kind: 'constraint', index: draft.constraints.length });
      setEditing({ constraint: draft.constraints.length });
    } else {
      write({ ...draft, constraints: [...draft.constraints, { on: l.ref, from: time, label: '' }] });
      setSelection({ kind: 'constraint', index: draft.constraints.length });
      setEditing({ constraint: draft.constraints.length });
    }
    setPending(null);
  };

  // --- pointer handling ---------------------------------------------------------------------
  const onPointerDown = (e: ReactPointerEvent) => {
    down.current = { x: e.clientX, y: e.clientY };
    dragged.current = false;
    if (!hits || !draft || e.button !== 0) return;
    const pt = toScene(e);
    const h = !tool && editable ? hitTest(pt.x, pt.y) : null;
    if (h && 'change' in h) {
      // Drag a change along the time axis, or (state timeline) to another state.
      const { ref, index } = h.change;
      const lh = hits.lifelines.find((l) => l.ref === ref)!;
      const base = draft;
      let latest = draft;
      const move = (ev: PointerEvent) => {
        const at = toScene(ev);
        if (!dragged.current && Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 4) return;
        dragged.current = true;
        const time = timeAt(at.x, ev.altKey);
        const row = lh.rows.length ? nearestRow(lh, at.y) : undefined;
        latest = {
          ...base,
          lifelines: base.lifelines.map((l) => (l.ref !== ref ? l : { ...l, changes: l.changes.map((c, i) => (i === index ? { at: time, state: row?.state ?? c.state } : c)) })),
        };
        setDraft(latest);
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        setSelection({ kind: 'change', ref, index });
        if (dragged.current) write(latest);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      return;
    }
    if (h && 'name' in h) {
      // Drag a lifeline's name to reorder the lifelines.
      const start = e.clientY;
      const move = (ev: PointerEvent) => {
        if (!dragged.current && Math.abs(ev.clientY - start) < 4) return;
        dragged.current = true;
        setDragLl({ ref: h.name, y: toScene(ev).y });
      };
      const up = (ev: PointerEvent) => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        setDragLl(null);
        if (!dragged.current) return;
        const y = toScene(ev).y;
        const order = hits.lifelines
          .map((l) => ({ ref: l.ref, y: l.ref === h.name ? y : l.box.y + l.box.h / 2 }))
          .sort((a, b) => a.y - b.y)
          .map((x) => draft.lifelines.find((l) => l.ref === x.ref)!)
          .filter(Boolean);
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
    if (dragged.current || (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4)) return; // a drag or a pan
    const active = rootOf(stageEl.current).activeElement as HTMLElement | null;
    if (active?.closest('.inspector')) active.blur();
    if (!hits) return;
    const pt = toScene(e);
    if (tool && editable) return applyTool(tool, pt.x, pt.y, e.altKey);
    const h = hitTest(pt.x, pt.y);
    if (!h) return setSelection(null);
    if ('constraint' in h) return setSelection({ kind: 'constraint', index: h.constraint });
    if ('message' in h) return setSelection({ kind: 'message', index: h.message });
    if ('change' in h) return setSelection({ kind: 'change', ...h.change });
    if ('stateLabel' in h) return setSelection({ kind: 'lifeline', ref: h.stateLabel.ref });
    if ('name' in h) return setSelection({ kind: 'lifeline', ref: h.name });
    setSelection({ kind: 'lifeline', ref: h.lifeline });
  };

  const onDoubleClick = (e: ReactMouseEvent) => {
    if (!editable || !hits || tool || !draft) return;
    const pt = toScene(e);
    const h = hitTest(pt.x, pt.y);
    if (!h) return;
    if ('constraint' in h) setEditing({ constraint: h.constraint });
    else if ('message' in h) setEditing({ message: h.message });
    else if ('stateLabel' in h) setEditing({ state: h.stateLabel });
    else if ('name' in h && names.has(h.name)) setEditing({ name: h.name });
    else if ('change' in h && lifeline(h.change.ref)?.form === 'value') setEditing({ value: h.change });
  };

  // --- keyboard -------------------------------------------------------------------------------
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
      if (!draft || !editable || !selection) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        return deleteSelected();
      }
      if (e.key === 'F2' || e.key === 'Enter') {
        e.preventDefault();
        if (selection.kind === 'message') setEditing({ message: selection.index });
        else if (selection.kind === 'constraint') setEditing({ constraint: selection.index });
        else if (selection.kind === 'lifeline' && names.has(selection.ref)) setEditing({ name: selection.ref });
        else if (selection.kind === 'change' && lifeline(selection.ref)?.form === 'value') setEditing({ value: { ref: selection.ref, index: selection.index } });
        return;
      }
      if (selection.kind === 'change' && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
        // Left / Right: half a tick earlier / later; Up / Down: the state above / below.
        e.preventDefault();
        const l = lifeline(selection.ref);
        const c = l?.changes[selection.index];
        if (!l || !c) return;
        let next = c;
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') next = { ...c, at: round(Math.max(0, c.at + (e.key === 'ArrowLeft' ? -step : step))) };
        else if (l.form !== 'value') {
          const states = statesOf(l);
          const i = states.indexOf(c.state) + (e.key === 'ArrowUp' ? -1 : 1);
          if (i >= 0 && i < states.length) next = { ...c, state: states[i]! };
        }
        setLifeline(l.ref, (x) => ({ ...x, changes: x.changes.map((y, i) => (i === selection.index ? next : y)) }));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (text === undefined) return <div className="placeholder">Loading…</div>;
  if (!draft || !hits || !scene) {
    return (
      <div className="banner error">
        {'Invalid timing diagram:\n'}
        {parsed?.issues.map((i) => `• ${i.message}`).join('\n')}
      </div>
    );
  }

  const onIt = new Set(draft.lifelines.map((l) => l.ref));
  const candidates = model.elements.filter((e) => PARTICIPANT_KINDS.has(e.kind) && !onIt.has(e.id));
  const pickTool = (t: Tool | null) => {
    setPending(null);
    setTool(t === tool ? null : t);
  };

  // Inline editor (in diagram coordinates, so it scales with the zoom).
  let inline: JSX.Element | null = null;
  if (editing && editable) {
    const done = (apply: (v: string) => void, current: string) => (v: string | null) => {
      setEditing(null);
      if (v !== null && v !== current) apply(v);
    };
    if ('message' in editing) {
      const h = hits.messages.find((m) => m.index === editing.message);
      const m = draft.messages[editing.message];
      if (h && m)
        inline = <InlineInput key={`m${editing.message}`} x={h.label.x} y={h.label.y} middle={h.label.anchor === 'middle'} value={m.label} placeholder="message(args)" onDone={done((v) => write({ ...draft, messages: draft.messages.map((x, i) => (i === editing.message ? { ...x, label: v } : x)) }), m.label)} />;
    } else if ('constraint' in editing) {
      const h = hits.constraints.find((c) => c.index === editing.constraint);
      const c = draft.constraints[editing.constraint];
      if (h && c)
        inline = (
          <InlineInput
            key={`c${editing.constraint}`}
            x={h.label.x}
            y={h.label.y}
            middle={h.label.anchor === 'middle'}
            value={c.label}
            placeholder={c.to === undefined ? 't = now' : '0..2s'}
            onDone={done((v) => write({ ...draft, constraints: draft.constraints.map((x, i) => (i === editing.constraint ? { ...x, label: v.replace(/^\{(.*)\}$/, '$1') } : x)) }), c.label)}
          />
        );
    } else if ('name' in editing) {
      const l = hits.lifelines.find((x) => x.ref === editing.name);
      if (l)
        inline = (
          <InlineInput
            key={`n${editing.name}`}
            x={l.name.x + 8}
            y={l.name.y + l.name.h / 2 + 5}
            middle={false}
            value={names.get(editing.name) ?? ''}
            placeholder="Name"
            onDone={done((v) => v.trim() && void runOp('update_element', { id: editing.name, name: v.trim() }).catch(() => undefined), names.get(editing.name) ?? '')}
          />
        );
    } else if ('state' in editing) {
      const { ref, state } = editing.state;
      const row = hits.lifelines.find((x) => x.ref === ref)?.rows.find((r) => r.state === state);
      if (row)
        inline = <InlineInput key={`s${ref}${state}`} x={row.label.x} y={row.y + 4} middle={false} value={state} placeholder="State" onDone={done((v) => v.trim() && write(renameState(draft, ref, state, v.trim())), state)} />;
    } else {
      const { ref, index } = editing.value;
      const h = hits.changes.find((c) => c.ref === ref && c.index === index);
      const c = lifeline(ref)?.changes[index];
      if (h && c)
        inline = (
          <InlineInput
            key={`v${ref}${index}`}
            x={h.x + 6}
            y={h.y + 4}
            middle={false}
            value={c.state}
            placeholder="Value"
            onDone={done((v) => v.trim() && setLifeline(ref, (l) => ({ ...l, changes: l.changes.map((x, i) => (i === index ? { ...x, state: v.trim() } : x)) })), c.state)}
          />
        );
    }
  }

  const sel = selection;
  const hoverL = tool && hover ? lifelineAt(hover.y) : undefined;
  const hoverRow = tool === 'change' && hover && hoverL ? nearestRow(hoverL, hover.y) : undefined;
  const pendingL = pending ? hits.lifelines.find((l) => l.ref === pending.ref) : undefined;
  const fmtT = (t: number) => `${round(t)}${draft.unit ? ` ${draft.unit}` : ''}`;

  // The palette and inspector, drawn here or docked in the Archery sidebar (webview/shared/remote.ts).
  const railProps: ComponentProps<typeof TimingRail> = { tool, candidates, flyout, setFlyout, addParticipant: (kind, label) => void addParticipant(kind, label), addExisting, pickTool };
  const inspectorProps: ComponentProps<typeof TimingInspector> = {
    diagram: draft,
    model,
    selection,
    editable,
    change: write,
    op: (name, input) => void runOp(name, input).catch(() => undefined),
    select: setSelection,
    moveLifeline,
    deleteSelected,
  };

  return (
    <div className="seq-editor timing-editor">
      <div className="toolbar">
        <span className="meta" title="Timing diagram">
          <IconTypeTiming />
        </span>
        <span className="title">{draft.title || 'Untitled timing diagram'}</span>
        <span className="spacer" />
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
        <DockPanels panels={{ title: draft.title || 'Untitled timing diagram', rail: editable ? { component: 'timingRail', props: railProps } : undefined, inspector: { component: 'timingInspector', props: inspectorProps } }} />
        {editable && !host.docked && <TimingRail {...railProps} />}
        {editable && !host.docked && <RailResizer />}
        <div
          className={`preview${tool ? ' tool-active' : ''}`}
          ref={bindStage}
          onPointerDown={onPointerDown}
          onClick={onClick}
          onDoubleClick={onDoubleClick}
          onPointerMove={(e) => {
            if (!tool) return;
            const p = toScene(e);
            setHover({ ...p, t: timeAt(p.x, e.altKey) });
          }}
          onPointerLeave={() => setHover(null)}
        >
          <div className="stage-canvas" style={{ transform: `translate(${pz.view.x}px, ${pz.view.y}px) scale(${pz.view.k})`, width: scene.width, height: scene.height }}>
            <SceneSvg scene={scene} label={draft.title} />
            <svg className="seq-overlay" width={scene.width} height={scene.height} aria-hidden="true">
              {sel?.kind === 'lifeline' &&
                hits.lifelines
                  .filter((l) => l.ref === sel.ref)
                  .map((l) => <rect key={l.ref} className="hl" x={l.box.x + 2} y={l.box.y + 2} width={l.box.w - 4} height={l.box.h - 4} rx={3} />)}
              {sel?.kind === 'change' &&
                hits.changes
                  .filter((c) => c.ref === sel.ref && c.index === sel.index)
                  .map((c) => (
                    <g key="change">
                      <rect className="hl" x={c.box.x - 1} y={c.box.y - 1} width={c.box.w + 2} height={c.box.h + 2} rx={4} />
                      <circle className="pending-dot" cx={c.x} cy={c.y} r={3.5} />
                    </g>
                  ))}
              {sel?.kind === 'message' &&
                hits.messages
                  .filter((m) => m.index === sel.index)
                  .map((m) => <rect key="m" className="hl" x={m.box.x} y={m.box.y} width={m.box.w} height={m.box.h} rx={4} />)}
              {sel?.kind === 'constraint' &&
                hits.constraints
                  .filter((c) => c.index === sel.index)
                  .map((c) => <rect key="c" className="hl" x={c.box.x - 2} y={c.box.y - 2} width={c.box.w + 4} height={c.box.h + 4} rx={4} />)}
              {hits.lifelines
                .filter((l) => !l.rows.length && !lifeline(l.ref)?.changes.length)
                .map((l) => (
                  <text key={`e${l.ref}`} className="timing-hint" x={hits.axis.x0 + 8} y={l.mid + 4}>
                    {lifeline(l.ref)?.form === 'value' ? 'Click with the state change tool to add a value' : 'Click with the state change tool to add a state'}
                  </text>
                ))}
              {pending && pendingL && <circle className="pending-dot" cx={xAt(pending.t)} cy={pendingL.rows.length ? (nearestRow(pendingL, pendingL.mid)?.y ?? pendingL.mid) : pendingL.mid} r={4} />}
              {tool && hover && (
                <>
                  <line className="guide" x1={xAt(hover.t)} y1={hits.axis.top} x2={xAt(hover.t)} y2={hits.axis.bottom + 12} />
                  <text className="timing-time" x={xAt(hover.t) + 4} y={hits.axis.top - 4}>
                    {fmtT(hover.t)}
                  </text>
                  {hoverRow && <circle className="pending-dot" cx={xAt(hover.t)} cy={hoverRow.y} r={3.5} />}
                  {hoverL && !hoverRow && <rect className="hl pending" x={hoverL.box.x + 2} y={hoverL.box.y + 2} width={hoverL.box.w - 4} height={hoverL.box.h - 4} rx={3} />}
                </>
              )}
              {dragLl && <line className="guide drop" x1={0} y1={dragLl.y} x2={scene.width} y2={dragLl.y} />}
            </svg>
            {inline}
          </div>
          {draft.lifelines.length === 0 && editable && <div className="empty-hint">Add lifelines from the left to start.</div>}
          {tool && (
            <div className="tool-hint" role="status">
              {pending ? (tool === 'message' ? 'Now click the receiver at the arrival time' : 'Now click the end') : twoClicks(tool) ? (tool === 'message' ? 'Click the sender at the send time' : 'Click the start') : 'Click where it goes'} · Alt: no snapping · Esc to stop
            </div>
          )}
        </div>
        {!host.docked && (
          <aside className="properties">
            <TimingInspector {...inspectorProps} />
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

/** The timing editor's palette: new lifelines and the tools (also docked in the sidebar). */
export function TimingRail({ tool, candidates, flyout, setFlyout, addParticipant, addExisting, pickTool }: { tool: Tool | null; candidates: ModelElement[]; flyout: boolean; setFlyout(v: boolean): void; addParticipant(kind: ElementKind, label: string): void; addExisting(id: string): void; pickTool(t: Tool | null): void }) {
  return (
    <aside className="rail" aria-label="Tools">
      <div className="rail-group" aria-label="Lifelines">
        {NEW_PARTICIPANTS.map((p) => {
          const I = ELEMENT_ICONS[p.kind];
          return (
            <button type="button" key={p.kind} className="rail-btn" data-participant={p.kind} title={`New lifeline: ${p.label}`} onClick={() => void addParticipant(p.kind, p.label)}>
              <I />
              <span className="rail-label">{p.label}</span>
            </button>
          );
        })}
        {candidates.length > 0 && (
          <div className="rail-flyout-host">
            <button type="button" className={`rail-btn${flyout ? ' on' : ''}`} title={`Lifelines from the model (${candidates.length})`} aria-expanded={flyout} onClick={() => setFlyout(!flyout)}>
              <IconExisting />
              <span className="rail-label">{'From the model'}</span>
              <span className="rail-badge">{candidates.length}</span>
            </button>
            {flyout && (
              <div className="rail-flyout" role="dialog" aria-label="Lifelines from the model" ref={keepInWindow}>
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
      <div className="rail-group" role="radiogroup" aria-label="Tools">
        <button type="button" role="radio" aria-checked={!tool} className={`rail-btn${!tool ? ' on' : ''}`} title="Select (Esc)" onClick={() => pickTool(null)}>
          <IconSelectTool />
          <span className="rail-label">{'Select'}</span>
        </button>
        {TOOLS.map((t) => (
          <button type="button" key={t.tool} role="radio" aria-checked={tool === t.tool} data-tool={t.tool} className={`rail-btn${tool === t.tool ? ' on' : ''}`} title={t.label} onClick={() => pickTool(t.tool)}>
            <t.icon />
            <span className="rail-label">{t.label.split(':')[0]!.replace(/\s*[({].*$/, '')}</span>
          </button>
        ))}
      </div>
    </aside>
  );
}
