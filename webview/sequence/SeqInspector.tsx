// Right-hand inspector of the sequence editor: the diagram (participants, outline of the steps), a
// participant (name, description, its messages, order), a message (kind, ends, label), a combined
// fragment (operator, operands and guards), a ref / note / constraint, or several steps.
import type { Element, FragmentOperator, Message, MessageKind, Model, SequenceDiagram, SequenceStep } from '../../src/model/schema';
import { FragmentOperators, MessageKinds } from '../../src/model/schema';
import { Field, Section, Segmented, Text } from '../diagram/Inspector';
import {
  ELEMENT_ICONS,
  IconConstraint,
  IconDown,
  IconFragment,
  IconLeft,
  IconLifeline,
  IconNote,
  IconRef,
  IconRemove,
  IconRight,
  IconTrash,
  IconTypeCommunication,
  IconTypeSequence,
  IconUnwrap,
  IconUp,
  IconWrap,
  MESSAGE_ICONS,
} from '../diagram/umlIcons';
import { allPaths, samePath, stepAt, type Path } from './steps';

export type SeqSelection = { kind: 'lifeline'; ref: string } | { kind: 'steps'; paths: Path[] } | null;

const MULTI_OPERAND = new Set<FragmentOperator>(['alt', 'par', 'strict', 'seq', 'critical']);
export const MESSAGE_LABELS: Record<MessageKind, string> = {
  sync: 'Synchronous call',
  async: 'Asynchronous message',
  reply: 'Reply',
  create: 'Create',
  destroy: 'Destroy',
  self: 'Self call',
  lost: 'Lost message (no receiver)',
  found: 'Found message (no sender)',
};
const FRAGMENT_HINTS: Record<FragmentOperator, string> = {
  alt: 'alternatives',
  opt: 'optional',
  loop: 'loop',
  par: 'parallel',
  break: 'break out',
  critical: 'critical region',
  neg: 'invalid',
  strict: 'strict order',
  seq: 'weak order',
  ignore: 'ignore messages',
  consider: 'consider messages',
  assert: 'assertion',
};

interface Props {
  diagram: SequenceDiagram;
  model: Model;
  selection: SeqSelection;
  editable: boolean;
  /** Lifelines in order, including participants only used by messages. */
  lifelines: string[];
  change(next: SequenceDiagram): void;
  updateStep(path: Path, step: SequenceStep): void;
  op(name: string, input: Record<string, unknown>): void;
  select(sel: SeqSelection): void;
  moveStep(path: Path, delta: number): void;
  moveLifeline(ref: string, delta: number): void;
  removeLifeline(ref: string): void;
  deleteSelected(): void;
  wrapSelected(): void;
  unwrap(path: Path): void;
}

/** A one-line description of a step, with its icon. */
export function describe(step: SequenceStep, names: (id?: string) => string): { icon: () => JSX.Element; text: string } {
  if ('msg' in step) {
    const m = step.msg;
    const gate = m.gate ? 'gate ' : '';
    const ends = m.kind === 'found' ? `${gate}→ ${names(m.to)}` : m.kind === 'lost' ? `${names(m.from)} → ${gate}` : m.kind === 'self' ? names(m.from) : `${names(m.from)} → ${names(m.to)}`;
    return { icon: MESSAGE_ICONS[m.kind], text: `${m.label || MESSAGE_LABELS[m.kind]}  ·  ${ends}` };
  }
  if ('note' in step) return { icon: IconNote, text: step.note || 'Note' };
  if ('constraint' in step) return { icon: IconConstraint, text: `{${step.constraint}}` };
  if (step.fragment === 'ref') return { icon: IconRef, text: `ref ${step.label}` };
  const op = step.fragment === 'loop' && (step.min !== undefined || step.max !== undefined) ? `loop(${step.min ?? 0}${step.max !== undefined ? `,${step.max}` : ''})` : step.fragment;
  return { icon: IconFragment, text: `${op}${step.branches[0]?.guard ? ` [${step.branches[0].guard}]` : ''}` };
}

function Over({ over, lifelines, names, onChange, disabled }: { over: string[]; lifelines: string[]; names: (id?: string) => string; onChange(v: string[]): void; disabled: boolean }) {
  return (
    <div className="chip-toggles">
      {lifelines.map((l) => (
        <button
          type="button"
          key={l}
          className={`chip toggle${over.includes(l) ? ' on' : ''}`}
          aria-pressed={over.includes(l)}
          disabled={disabled}
          onClick={() => {
            const next = over.includes(l) ? over.filter((x) => x !== l) : lifelines.filter((x) => x === l || over.includes(x));
            if (next.length) onChange(next);
          }}
        >
          {names(l)}
        </button>
      ))}
    </div>
  );
}

function StepActions({ p, path, ro, extra }: { p: Props; path: Path; ro: boolean; extra?: JSX.Element }) {
  if (ro) return null;
  return (
    <div className="ins-footer">
      <button type="button" className="icon-text" title="Move up (Alt+Up)" onClick={() => p.moveStep(path, -1)}>
        <IconUp />
      </button>
      <button type="button" className="icon-text" title="Move down (Alt+Down)" onClick={() => p.moveStep(path, 1)}>
        <IconDown />
      </button>
      <button type="button" className="icon-text" title="Put it in a combined fragment" onClick={p.wrapSelected}>
        <IconWrap />
      </button>
      {extra}
      <button type="button" className="icon-text danger" title="Delete (Delete)" onClick={p.deleteSelected}>
        <IconTrash /> Delete
      </button>
    </div>
  );
}

export function SeqInspector(p: Props) {
  const { diagram, model, selection, editable } = p;
  const ro = !editable;
  const byId = new Map(model.elements.map((e) => [e.id, e]));
  const names = (id?: string) => (id ? byId.get(id)?.name ?? id : '?');
  const KindIcon = ({ e }: { e?: Element }) => {
    const I = e ? ELEMENT_ICONS[e.kind] : IconLifeline;
    return <I />;
  };

  // ---- the diagram ---------------------------------------------------------------------
  if (!selection) {
    const paths = allPaths(diagram.steps);
    const steps = paths.map((path) => ({ path, step: stepAt(diagram.steps, path)! }));
    const messages = steps.filter((s) => 'msg' in s.step).length;
    const fragments = steps.filter((s) => 'branches' in s.step).length;
    return (
      <div className="inspector">
        <div className="ins-head">
          <span className="ins-kind-icon">{diagram.notation === 'communication' ? <IconTypeCommunication /> : <IconTypeSequence />}</span>
          <div className="ins-head-text">
            <Text className="ins-title" value={diagram.title} disabled={ro} placeholder="Scenario title" onCommit={(title) => p.change({ ...diagram, title })} />
            <span className="ins-kind">{diagram.notation === 'communication' ? 'Communication diagram' : 'Sequence diagram'}</span>
          </div>
        </div>
        <div className="stat-chips">
          <span className="chip" title="Participants">
            <IconLifeline /> {p.lifelines.length}
          </span>
          <span className="chip" title="Messages">
            <MESSAGE_ICONS.sync /> {messages}
          </span>
          <span className="chip" title="Combined fragments">
            <IconFragment /> {fragments}
          </span>
        </div>
        <Section id="seq-participants" title="Participants" count={p.lifelines.length}>
          {p.lifelines.map((ref, i) => (
            <div key={ref} className="ins-row clickable" onClick={() => p.select({ kind: 'lifeline', ref })}>
              <span className="ins-icon">
                <KindIcon e={byId.get(ref)} />
              </span>
              <span className="ins-name">{names(ref)}</span>
              {!ro && (
                <>
                  <button type="button" className="icon-btn subtle" title="Move left" disabled={i === 0} onClick={(e) => (e.stopPropagation(), p.moveLifeline(ref, -1))}>
                    <IconLeft />
                  </button>
                  <button type="button" className="icon-btn subtle" title="Move right" disabled={i === p.lifelines.length - 1} onClick={(e) => (e.stopPropagation(), p.moveLifeline(ref, 1))}>
                    <IconRight />
                  </button>
                </>
              )}
            </div>
          ))}
        </Section>
        <Section id="seq-steps" title="Steps" count={paths.length}>
          {steps.map(({ path, step }) => {
            const d = describe(step, names);
            return (
              <div key={path.join('.')} className="ins-row clickable" style={{ paddingLeft: 4 + (path.length - 1) * 6 }} onClick={() => p.select({ kind: 'steps', paths: [path] })}>
                <span className="ins-icon">
                  <d.icon />
                </span>
                <span className="ins-name">{d.text}</span>
              </div>
            );
          })}
        </Section>
        <Section id="seq-keys" title="Keys" defaultOpen={false}>
          <dl className="keys">
            <dt>Pick a message, click two lifelines</dt>
            <dd>Add it there</dd>
            <dt>Double-click, F2</dt>
            <dd>Edit the label / rename</dd>
            <dt>Up / Down</dt>
            <dd>Previous / next step</dd>
            <dt>Alt+Up / Alt+Down</dt>
            <dd>Move the step</dd>
            <dt>Shift+click</dt>
            <dd>Select several steps</dd>
            <dt>Drag a participant</dt>
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

  // ---- a participant ------------------------------------------------------------------
  if (selection.kind === 'lifeline') {
    const ref = selection.ref;
    const e = byId.get(ref);
    const i = p.lifelines.indexOf(ref);
    const mine = allPaths(diagram.steps)
      .map((path) => ({ path, step: stepAt(diagram.steps, path)! }))
      .filter(({ step }) => 'msg' in step && (step.msg.from === ref || step.msg.to === ref));
    return (
      <div className="inspector">
        <div className="ins-head">
          <span className="ins-kind-icon">
            <KindIcon e={e} />
          </span>
          <div className="ins-head-text">
            <Text className="ins-title" value={e?.name ?? ref} disabled={ro || !e} onCommit={(name) => name.trim() && p.op('update_element', { id: ref, name: name.trim() })} />
            <span className="ins-kind">{e ? `Participant (${e.kind})` : 'Not in the model'}</span>
          </div>
        </div>
        {diagram.lifelines.some((l) => l.ref === ref) && (
          <Field label="Role (shown as role : Type)" wide>
            <Text
              value={diagram.lifelines.find((l) => l.ref === ref)?.role ?? ''}
              disabled={ro}
              placeholder="e.g. buyer"
              onCommit={(v) => p.change({ ...diagram, lifelines: diagram.lifelines.map((l) => (l.ref === ref ? (v.trim() ? { ...l, role: v.trim() } : { ref: l.ref }) : l)) })}
            />
          </Field>
        )}
        {e && (
          <Section id="seq-ll-details" title="Details">
            <Field label="Description" wide>
              <Text multiline rows={2} disabled={ro} value={e.description ?? ''} placeholder="One or two sentences" onCommit={(v) => p.op('update_element', { id: ref, description: v.trim() || null })} />
            </Field>
          </Section>
        )}
        <Section id="seq-ll-messages" title="Messages" count={mine.length}>
          {mine.map(({ path, step }) => {
            const d = describe(step, names);
            return (
              <div key={path.join('.')} className="ins-row clickable" onClick={() => p.select({ kind: 'steps', paths: [path] })}>
                <span className="ins-icon">
                  <d.icon />
                </span>
                <span className="ins-name">{d.text}</span>
              </div>
            );
          })}
        </Section>
        {!ro && (
          <div className="ins-footer">
            <button type="button" className="icon-text" title="Move left" disabled={i <= 0} onClick={() => p.moveLifeline(ref, -1)}>
              <IconLeft />
            </button>
            <button type="button" className="icon-text" title="Move right" disabled={i < 0 || i === p.lifelines.length - 1} onClick={() => p.moveLifeline(ref, 1)}>
              <IconRight />
            </button>
            <button type="button" className="icon-text" title="Remove from this diagram (Delete)" onClick={() => p.removeLifeline(ref)}>
              <IconRemove /> Remove from diagram
            </button>
          </div>
        )}
      </div>
    );
  }

  // ---- several steps -----------------------------------------------------------------
  if (selection.paths.length > 1) {
    return (
      <div className="inspector">
        <div className="ins-head">
          <div className="ins-head-text">
            <strong>{selection.paths.length} steps selected</strong>
          </div>
        </div>
        {!ro && (
          <div className="ins-footer">
            <button type="button" className="icon-text" title="Put them in a combined fragment" onClick={p.wrapSelected}>
              <IconWrap /> Group in a fragment
            </button>
            <button type="button" className="icon-text danger" title="Delete (Delete)" onClick={p.deleteSelected}>
              <IconTrash /> Delete
            </button>
          </div>
        )}
      </div>
    );
  }

  const path = selection.paths[0]!;
  const step = stepAt(diagram.steps, path);
  if (!step) return null;
  const set = (s: SequenceStep) => p.updateStep(path, s);
  const lifelineOptions = p.lifelines.map((l) => (
    <option key={l} value={l}>
      {names(l)}
    </option>
  ));

  // ---- a message ---------------------------------------------------------------------
  if ('msg' in step) {
    const m = step.msg;
    const update = (patch: Partial<Message>) => {
      const next: Message = { ...m, ...patch };
      if (next.kind === 'lost') delete next.to;
      if (next.kind === 'found') delete next.from;
      if (next.kind !== 'lost' && !next.to) next.to = next.from ?? p.lifelines[0];
      if (next.kind !== 'found' && !next.from) next.from = next.to ?? p.lifelines[0];
      if (next.kind === 'self') next.to = next.from;
      if (next.kind !== 'self' && next.kind !== 'lost' && next.kind !== 'found') delete next.async;
      if (next.kind !== 'lost' && next.kind !== 'found') delete next.gate;
      set({ msg: next });
    };
    const I = MESSAGE_ICONS[m.kind];
    return (
      <div className="inspector">
        <div className="ins-head">
          <span className="ins-kind-icon">
            <I />
          </span>
          <div className="ins-head-text">
            <Text className="ins-title" value={m.label} disabled={ro} placeholder="placeOrder(cart)" onCommit={(label) => update({ label })} />
            <span className="ins-kind">{MESSAGE_LABELS[m.kind]}</span>
          </div>
        </div>
        <Segmented value={m.kind} disabled={ro} options={MessageKinds.map((k) => ({ value: k, label: MESSAGE_LABELS[k], icon: MESSAGE_ICONS[k] }))} onChange={(kind) => update({ kind })} />
        <Section id="seq-msg-ends" title="From and to">
          <div className="field-grid">
            {m.kind !== 'found' && (
              <Field label="From">
                <select value={m.from ?? ''} disabled={ro} onChange={(e) => update({ from: e.target.value })}>
                  {lifelineOptions}
                </select>
              </Field>
            )}
            {m.kind !== 'lost' && m.kind !== 'self' && (
              <Field label="To">
                <select value={m.to ?? ''} disabled={ro} onChange={(e) => update({ to: e.target.value })}>
                  {lifelineOptions}
                </select>
              </Field>
            )}
          </div>
          {(m.kind === 'self' || m.kind === 'lost' || m.kind === 'found') && (
            <label className="check">
              <input type="checkbox" checked={!!m.async} disabled={ro} onChange={(ev) => update({ async: ev.target.checked || undefined })} /> Asynchronous (open arrowhead)
            </label>
          )}
          {(m.kind === 'lost' || m.kind === 'found') && (
            <label className="check">
              <input type="checkbox" checked={!!m.gate} disabled={ro} onChange={(ev) => update({ gate: ev.target.checked || undefined })} /> {m.kind === 'found' ? 'From a gate on the frame' : 'To a gate on the frame'}
            </label>
          )}
          {m.kind !== 'lost' && m.kind !== 'found' && m.kind !== 'self' && !ro && (
            <button type="button" className="add-row" title="Swap sender and receiver" onClick={() => update({ from: m.to, to: m.from })}>
              ⇄ Swap
            </button>
          )}
        </Section>
        <StepActions p={p} path={path} ro={ro} />
      </div>
    );
  }

  // ---- note / constraint ---------------------------------------------------------------
  if ('note' in step || 'constraint' in step) {
    const isNote = 'note' in step;
    return (
      <div className="inspector">
        <div className="ins-head">
          <span className="ins-kind-icon">{isNote ? <IconNote /> : <IconConstraint />}</span>
          <div className="ins-head-text">
            <strong>{isNote ? 'Note' : 'Constraint'}</strong>
            <span className="ins-kind">{isNote ? 'Comment across participants' : 'State invariant or timing'}</span>
          </div>
        </div>
        <Field label={isNote ? 'Text' : 'Constraint'} wide>
          <Text value={isNote ? step.note : step.constraint} disabled={ro} placeholder={isNote ? 'Note' : 'response < 2s'} onCommit={(v) => set(isNote ? { note: v, over: step.over } : { constraint: v, over: step.over })} />
        </Field>
        <Field label="Over" wide>
          <Over over={step.over} lifelines={p.lifelines} names={names} disabled={ro} onChange={(over) => set({ ...step, over } as SequenceStep)} />
        </Field>
        <StepActions p={p} path={path} ro={ro} />
      </div>
    );
  }

  // ---- interaction use (ref) -----------------------------------------------------------
  if (step.fragment === 'ref') {
    return (
      <div className="inspector">
        <div className="ins-head">
          <span className="ins-kind-icon">
            <IconRef />
          </span>
          <div className="ins-head-text">
            <Text className="ins-title" value={step.label} disabled={ro} placeholder="Authenticate user" onCommit={(label) => set({ ...step, label })} />
            <span className="ins-kind">Interaction use (ref)</span>
          </div>
        </div>
        <Field label="Over" wide>
          <Over over={step.over} lifelines={p.lifelines} names={names} disabled={ro} onChange={(over) => set({ ...step, over })} />
        </Field>
        <StepActions p={p} path={path} ro={ro} />
      </div>
    );
  }

  // ---- combined fragment ---------------------------------------------------------------
  const f = step;
  return (
    <div className="inspector">
      <div className="ins-head">
        <span className="ins-kind-icon">
          <IconFragment />
        </span>
        <div className="ins-head-text">
          <strong>{f.fragment}</strong>
          <span className="ins-kind">Combined fragment: {FRAGMENT_HINTS[f.fragment]}</span>
        </div>
      </div>
      <div className="op-chips">
        {FragmentOperators.map((o) => (
          <button
            type="button"
            key={o}
            className={`chip toggle${o === f.fragment ? ' on' : ''}`}
            title={FRAGMENT_HINTS[o]}
            disabled={ro}
            onClick={() =>
              o !== f.fragment &&
              set(
                MULTI_OPERAND.has(o) || f.branches.length === 1
                  ? { ...f, fragment: o }
                  : // Single-operand operators keep one operand with all steps.
                    { fragment: o, branches: [{ guard: f.branches[0]!.guard === 'else' ? '' : f.branches[0]!.guard, steps: f.branches.flatMap((b) => b.steps) }] },
              )
            }
          >
            {o}
          </button>
        ))}
      </div>
      {f.fragment === 'loop' && (
        <div className="field-grid">
          <Field label="Minimum iterations">
            <Text
              value={f.min === undefined ? '' : String(f.min)}
              disabled={ro}
              placeholder="0"
              onCommit={(v) => {
                const n = Number.parseInt(v, 10);
                set({ ...f, min: v.trim() === '' || Number.isNaN(n) ? undefined : Math.max(0, n) });
              }}
            />
          </Field>
          <Field label="Maximum (* = unlimited)">
            <Text
              value={f.max === undefined ? '' : String(f.max)}
              disabled={ro}
              placeholder="*"
              onCommit={(v) => {
                const t = v.trim();
                const n = Number.parseInt(t, 10);
                set({ ...f, max: t === '' ? undefined : t === '*' ? '*' : Number.isNaN(n) ? f.max : Math.max(0, n) });
              }}
            />
          </Field>
        </div>
      )}
      <Section id="seq-frag-operands" title={MULTI_OPERAND.has(f.fragment) ? 'Operands' : 'Guard'} count={f.branches.length}>
        {f.branches.map((b, i) => (
          <div className="list-row" key={i}>
            <span className="list-num">{i + 1}</span>
            <Text
              value={b.guard ?? ''}
              disabled={ro}
              placeholder={f.fragment === 'loop' ? '1..3, for each item' : i > 0 ? 'else' : 'condition'}
              onCommit={(guard) => set({ ...f, branches: f.branches.map((x, j) => (j === i ? { ...x, guard } : x)) })}
            />
            {!ro && f.branches.length > 1 && (
              <button type="button" className="icon-btn subtle" title="Remove operand" onClick={() => set({ ...f, branches: f.branches.filter((_, j) => j !== i) })}>
                <IconRemove />
              </button>
            )}
          </div>
        ))}
        {!ro && MULTI_OPERAND.has(f.fragment) && (
          <button type="button" className="add-row" title="Add an operand" onClick={() => set({ ...f, branches: [...f.branches, { guard: f.fragment === 'alt' ? 'else' : '', steps: [] }] })}>
            + operand
          </button>
        )}
      </Section>
      <StepActions
        p={p}
        path={path}
        ro={ro}
        extra={
          <button type="button" className="icon-text" title="Remove the frame, keep its steps" onClick={() => p.unwrap(path)}>
            <IconUnwrap />
          </button>
        }
      />
    </div>
  );
}

export { samePath };
