// Right-hand inspector of the timing editor: the diagram (title, time axis, lifelines, messages,
// constraints), a lifeline (name, role, form, states, its changes), a state change, a message or
// a duration / time constraint.
import { useEffect, useState } from 'react';
import type { Element, Model, TimingConstraint, TimingDiagram, TimingMessage } from '../../src/model/schema';
import { constraintText, sortedChanges, statesOf, timeScale } from '../../src/render/timingLayout';
import { Field, ListField, Section, Segmented, Text } from '../diagram/Inspector';
import {
  ELEMENT_ICONS,
  IconDown,
  IconDuration,
  IconLifeline,
  IconRemove,
  IconStateChange,
  IconTimeMark,
  IconTrash,
  IconTypeTiming,
  IconUp,
  IconValueForm,
  MESSAGE_ICONS,
} from '../diagram/umlIcons';

export type TimingSelection =
  | { kind: 'lifeline'; ref: string }
  | { kind: 'change'; ref: string; index: number }
  | { kind: 'message'; index: number }
  | { kind: 'constraint'; index: number }
  | null;

interface Props {
  diagram: TimingDiagram;
  model: Model;
  selection: TimingSelection;
  editable: boolean;
  change(next: TimingDiagram): void;
  op(name: string, input: Record<string, unknown>): void;
  select(sel: TimingSelection): void;
  moveLifeline(ref: string, delta: number): void;
  deleteSelected(): void;
}

const MESSAGE_KINDS = [
  { value: 'sync' as const, label: 'Synchronous call', icon: MESSAGE_ICONS.sync },
  { value: 'async' as const, label: 'Asynchronous message', icon: MESSAGE_ICONS.async },
  { value: 'reply' as const, label: 'Reply', icon: MESSAGE_ICONS.reply },
];

/** A number input that commits on blur / Enter; empty means "not set" when `optional`. */
function NumberField({ value, onCommit, placeholder, disabled, optional }: { value?: number; onCommit(v: number | undefined): void; placeholder?: string; disabled?: boolean; optional?: boolean }) {
  const shown = value === undefined ? '' : String(value);
  const [v, setV] = useState(shown);
  useEffect(() => setV(shown), [shown]);
  const commit = () => {
    const t = v.trim();
    if (!t) {
      if (optional && value !== undefined) onCommit(undefined);
      else setV(shown);
      return;
    }
    const n = Number(t);
    if (Number.isFinite(n) && n >= 0 && n !== value) onCommit(n);
    else setV(shown);
  };
  return <input inputMode="decimal" value={v} placeholder={placeholder} disabled={disabled} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} />;
}

export function TimingInspector(p: Props) {
  const { diagram, model, selection, editable } = p;
  const ro = !editable;
  const byId = new Map(model.elements.map((e) => [e.id, e]));
  const names = (id?: string) => (id ? byId.get(id)?.name ?? id : '?');
  const unit = diagram.unit ? ` ${diagram.unit}` : '';
  const KindIcon = ({ e }: { e?: Element }) => {
    const I = e ? ELEMENT_ICONS[e.kind] : IconLifeline;
    return <I />;
  };
  const lifelineOptions = diagram.lifelines.map((l) => (
    <option key={l.ref} value={l.ref}>
      {names(l.ref)}
    </option>
  ));
  const messageRow = (m: TimingMessage, i: number) => {
    const I = MESSAGE_ICONS[m.kind];
    return (
      <div key={`m${i}`} className="ins-row clickable" onClick={() => p.select({ kind: 'message', index: i })}>
        <span className="ins-icon">
          <I />
        </span>
        <span className="ins-name">
          {m.label || 'message'} · {m.from ? names(m.from) : 'gate'} → {m.to ? names(m.to) : 'gate'} · {m.at}
          {m.arrive !== undefined && m.arrive !== m.at ? `–${m.arrive}` : ''}
          {unit}
        </span>
      </div>
    );
  };
  const constraintRow = (c: TimingConstraint, i: number) => (
    <div key={`c${i}`} className="ins-row clickable" onClick={() => p.select({ kind: 'constraint', index: i })}>
      <span className="ins-icon">{c.to === undefined ? <IconTimeMark /> : <IconDuration />}</span>
      <span className="ins-name">
        {constraintText(c)} · {names(c.on)} · {c.from}
        {c.to !== undefined ? `–${c.to}` : ''}
        {unit}
      </span>
    </div>
  );
  const footer = (extra?: JSX.Element) =>
    ro ? null : (
      <div className="ins-footer">
        {extra}
        <button type="button" className="icon-text danger" title="Delete (Delete)" onClick={p.deleteSelected}>
          <IconTrash /> Delete
        </button>
      </div>
    );

  // ---- the diagram ---------------------------------------------------------------------------
  if (!selection) {
    const auto = timeScale({ ...diagram, end: undefined, tick: undefined });
    const changes = diagram.lifelines.reduce((n, l) => n + l.changes.length, 0);
    return (
      <div className="inspector">
        <div className="ins-head">
          <span className="ins-kind-icon">
            <IconTypeTiming />
          </span>
          <div className="ins-head-text">
            <Text className="ins-title" value={diagram.title} disabled={ro} placeholder="Title" onCommit={(title) => p.change({ ...diagram, title })} />
            <span className="ins-kind">Timing diagram</span>
          </div>
        </div>
        <div className="stat-chips">
          <span className="chip" title="Lifelines">
            <IconLifeline /> {diagram.lifelines.length}
          </span>
          <span className="chip" title="State changes">
            <IconStateChange /> {changes}
          </span>
          <span className="chip" title="Messages">
            <MESSAGE_ICONS.async /> {diagram.messages.length}
          </span>
          <span className="chip" title="Constraints">
            <IconDuration /> {diagram.constraints.length}
          </span>
        </div>
        <Section id="timing-axis" title="Time axis">
          <div className="field-grid">
            <Field label="Unit">
              <Text value={diagram.unit} disabled={ro} placeholder="e.g. ms" onCommit={(v) => p.change({ ...diagram, unit: v.trim() })} />
            </Field>
            <Field label="End">
              <NumberField optional value={diagram.end} disabled={ro} placeholder={`auto (${auto.end})`} onCommit={(v) => p.change({ ...diagram, end: v || undefined })} />
            </Field>
            <Field label="Tick every">
              <NumberField optional value={diagram.tick} disabled={ro} placeholder={`auto (${auto.tick})`} onCommit={(v) => p.change({ ...diagram, tick: v || undefined })} />
            </Field>
          </div>
        </Section>
        <Section id="timing-lifelines" title="Lifelines" count={diagram.lifelines.length}>
          {diagram.lifelines.map((l, i) => (
            <div key={l.ref} className="ins-row clickable" onClick={() => p.select({ kind: 'lifeline', ref: l.ref })}>
              <span className="ins-icon">
                <KindIcon e={byId.get(l.ref)} />
              </span>
              <span className="ins-name">{names(l.ref)}</span>
              {!ro && (
                <>
                  <button type="button" className="icon-btn subtle" title="Move up" disabled={i === 0} onClick={(e) => (e.stopPropagation(), p.moveLifeline(l.ref, -1))}>
                    <IconUp />
                  </button>
                  <button type="button" className="icon-btn subtle" title="Move down" disabled={i === diagram.lifelines.length - 1} onClick={(e) => (e.stopPropagation(), p.moveLifeline(l.ref, 1))}>
                    <IconDown />
                  </button>
                </>
              )}
            </div>
          ))}
        </Section>
        {diagram.messages.length > 0 && (
          <Section id="timing-messages" title="Messages" count={diagram.messages.length}>
            {diagram.messages.map(messageRow)}
          </Section>
        )}
        {diagram.constraints.length > 0 && (
          <Section id="timing-constraints" title="Constraints" count={diagram.constraints.length}>
            {diagram.constraints.map(constraintRow)}
          </Section>
        )}
        <Section id="timing-keys" title="Keys" defaultOpen={false}>
          <dl className="keys">
            <dt>State change tool, click a row</dt>
            <dd>The lifeline enters that state then</dd>
            <dt>Drag a change</dt>
            <dd>Move it in time / to another state</dd>
            <dt>Left / Right, Up / Down</dt>
            <dd>Move the selected change</dd>
            <dt>Alt while clicking / dragging</dt>
            <dd>No snapping to half ticks</dd>
            <dt>Double-click, F2</dt>
            <dd>Edit a label, state, value or name</dd>
            <dt>Drag a lifeline name</dt>
            <dd>Reorder</dd>
            <dt>Del / Esc</dt>
            <dd>Delete / stop</dd>
            <dt>Shift+1 / Shift+2 / Shift+0</dt>
            <dd>Fit / center / 100%</dd>
          </dl>
        </Section>
      </div>
    );
  }

  // ---- a lifeline ----------------------------------------------------------------------------
  if (selection.kind === 'lifeline') {
    const ref = selection.ref;
    const e = byId.get(ref);
    const l = diagram.lifelines.find((x) => x.ref === ref);
    if (!l) return null;
    const i = diagram.lifelines.indexOf(l);
    const set = (patch: Partial<typeof l>) => p.change({ ...diagram, lifelines: diagram.lifelines.map((x) => (x.ref === ref ? { ...x, ...patch } : x)) });
    const value = l.form === 'value';
    return (
      <div className="inspector">
        <div className="ins-head">
          <span className="ins-kind-icon">
            <KindIcon e={e} />
          </span>
          <div className="ins-head-text">
            <Text className="ins-title" value={e?.name ?? ref} disabled={ro || !e} onCommit={(name) => name.trim() && p.op('update_element', { id: ref, name: name.trim() })} />
            <span className="ins-kind">{e ? `Lifeline (${e.kind})` : 'Not in the model'}</span>
          </div>
        </div>
        <Field label="Role (shown as role : Type)" wide>
          <Text value={l.role ?? ''} disabled={ro} placeholder="e.g. buyer" onCommit={(v) => set({ role: v.trim() || undefined })} />
        </Field>
        <Field label="Form" wide>
          <Segmented
            value={value ? 'value' : 'state'}
            disabled={ro}
            options={[
              { value: 'state', label: 'State timeline: one row per state', icon: IconStateChange },
              { value: 'value', label: 'Value lifeline (compact): the value between crossings', icon: IconValueForm },
            ]}
            onChange={(v) => set({ form: v === 'value' ? 'value' : undefined })}
          />
        </Field>
        {!value && (
          <Section id="timing-states" title="States, top to bottom" count={statesOf(l).length}>
            <ListField items={statesOf(l)} placeholder="State, e.g. Idle" disabled={ro} onCommit={(states) => set({ states })} />
          </Section>
        )}
        <Section id="timing-changes" title={value ? 'Values over time' : 'State changes'} count={l.changes.length}>
          {sortedChanges(l).map((c) => (
            <div key={c.index} className="ins-row clickable" onClick={() => p.select({ kind: 'change', ref, index: c.index })}>
              <span className="ins-icon">
                <IconStateChange />
              </span>
              <span className="ins-name">
                {c.at}
                {unit} → {c.state}
              </span>
            </div>
          ))}
        </Section>
        {e && (
          <Section id="timing-ll-details" title="Details">
            <Field label="Description" wide>
              <Text multiline rows={2} disabled={ro} value={e.description ?? ''} placeholder="One or two sentences" onCommit={(v) => p.op('update_element', { id: ref, description: v.trim() || null })} />
            </Field>
          </Section>
        )}
        {!ro && (
          <div className="ins-footer">
            <button type="button" className="icon-text" title="Move up" disabled={i <= 0} onClick={() => p.moveLifeline(ref, -1)}>
              <IconUp />
            </button>
            <button type="button" className="icon-text" title="Move down" disabled={i === diagram.lifelines.length - 1} onClick={() => p.moveLifeline(ref, 1)}>
              <IconDown />
            </button>
            <button type="button" className="icon-text" title="Remove from this diagram (Delete)" onClick={p.deleteSelected}>
              <IconRemove /> Remove from diagram
            </button>
          </div>
        )}
      </div>
    );
  }

  // ---- a state change ----------------------------------------------------------------------
  if (selection.kind === 'change') {
    const l = diagram.lifelines.find((x) => x.ref === selection.ref);
    const c = l?.changes[selection.index];
    if (!l || !c) return null;
    const set = (patch: Partial<typeof c>) =>
      p.change({ ...diagram, lifelines: diagram.lifelines.map((x) => (x.ref !== l.ref ? x : { ...x, changes: x.changes.map((y, i) => (i === selection.index ? { ...y, ...patch } : y)) })) });
    const value = l.form === 'value';
    return (
      <div className="inspector">
        <div className="ins-head">
          <span className="ins-kind-icon">
            <IconStateChange />
          </span>
          <div className="ins-head-text">
            <strong>{value ? 'Value change' : 'State change'}</strong>
            <span className="ins-kind">{names(l.ref)}</span>
          </div>
        </div>
        <div className="field-grid">
          <Field label={`At${unit}`}>
            <NumberField value={c.at} disabled={ro} onCommit={(v) => v !== undefined && set({ at: v })} />
          </Field>
          <Field label={value ? 'Value' : 'State'}>
            {value ? (
              <Text value={c.state} disabled={ro} onCommit={(v) => v.trim() && set({ state: v.trim() })} />
            ) : (
              <select value={c.state} disabled={ro} onChange={(e) => set({ state: e.target.value })}>
                {statesOf(l).map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>
        {footer()}
      </div>
    );
  }

  // ---- a message ---------------------------------------------------------------------------
  if (selection.kind === 'message') {
    const m = diagram.messages[selection.index];
    if (!m) return null;
    const set = (patch: Partial<TimingMessage>) => p.change({ ...diagram, messages: diagram.messages.map((x, i) => (i === selection.index ? { ...x, ...patch } : x)) });
    const I = MESSAGE_ICONS[m.kind];
    return (
      <div className="inspector">
        <div className="ins-head">
          <span className="ins-kind-icon">
            <I />
          </span>
          <div className="ins-head-text">
            <Text className="ins-title" value={m.label} disabled={ro} placeholder="message(args)" onCommit={(label) => set({ label })} />
            <span className="ins-kind">Message</span>
          </div>
        </div>
        <Field label="Kind" wide>
          <Segmented value={m.kind} disabled={ro} options={MESSAGE_KINDS} onChange={(kind) => set({ kind })} />
        </Field>
        <div className="field-grid">
          <Field label="From">
            <select value={m.from ?? ''} disabled={ro} onChange={(e) => (e.target.value || m.to) && set({ from: e.target.value || undefined })}>
              <option value="">(gate on the frame)</option>
              {lifelineOptions}
            </select>
          </Field>
          <Field label="To">
            <select value={m.to ?? ''} disabled={ro} onChange={(e) => (e.target.value || m.from) && set({ to: e.target.value || undefined })}>
              <option value="">(gate on the frame)</option>
              {lifelineOptions}
            </select>
          </Field>
          <Field label={`Sent at${unit}`}>
            <NumberField value={m.at} disabled={ro} onCommit={(v) => v !== undefined && set({ at: v })} />
          </Field>
          <Field label={`Arrives at${unit}`}>
            <NumberField optional value={m.arrive} disabled={ro} placeholder="when sent" onCommit={(v) => set({ arrive: v })} />
          </Field>
        </div>
        {footer()}
      </div>
    );
  }

  // ---- a constraint --------------------------------------------------------------------------
  const c = diagram.constraints[selection.index];
  if (!c) return null;
  const set = (patch: Partial<TimingConstraint>) => p.change({ ...diagram, constraints: diagram.constraints.map((x, i) => (i === selection.index ? { ...x, ...patch } : x)) });
  const duration = c.to !== undefined;
  return (
    <div className="inspector">
      <div className="ins-head">
        <span className="ins-kind-icon">{duration ? <IconDuration /> : <IconTimeMark />}</span>
        <div className="ins-head-text">
          <Text className="ins-title" value={c.label} disabled={ro} placeholder={duration ? 'd..3*d' : 't = now'} onCommit={(label) => set({ label: label.replace(/^\{(.*)\}$/, '$1') })} />
          <span className="ins-kind">{duration ? 'Duration constraint' : 'Time constraint / observation'}</span>
        </div>
      </div>
      <div className="field-grid">
        <Field label="Lifeline">
          <select value={c.on} disabled={ro} onChange={(e) => set({ on: e.target.value })}>
            {lifelineOptions}
          </select>
        </Field>
        <Field label={`${duration ? 'From' : 'At'}${unit}`}>
          <NumberField value={c.from} disabled={ro} onCommit={(v) => v !== undefined && set({ from: v })} />
        </Field>
        <Field label={`To${unit}`}>
          <NumberField optional value={c.to} disabled={ro} placeholder="none: an instant" onCommit={(v) => set({ to: v })} />
        </Field>
      </div>
      {footer()}
    </div>
  );
}
