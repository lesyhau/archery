// The architecture decision record editor: a modal over the document, opened from the decision list.
// Its parts follow Michael Nygard's ADR (Context, Decision, Consequences), as arc42 chapter 9 recommends,
// plus the optional parts of MADR 4.0 (decision drivers, considered options, confirmation) and its
// metadata (decision-makers, supersedes). Saved with the create_decision / update_decision operations.
import { Placeholder } from '@tiptap/extensions';
import { EditorContent, useEditor } from '@tiptap/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ADR_STATUSES, type AdrPart } from '../../src/doc/adr';
import { sectionExtensions } from '../../src/doc/extensions';
import { jsonToMarkdown, markdownToJson } from '../../src/doc/markdown';
import type { DocDecision, DocumentData } from '../../src/doc/protocol';
import { tableFor } from '../../src/doc/tables';
import { runOp } from './context';
import { IconClose, IconPlusSmall } from './icons';
import { useModalScrollLock } from './modal';

interface Draft {
  title: string;
  status: string;
  date: string;
  deciders: string;
  supersedes: string;
  qualityGoals: string[];
  constraints: string[];
  requirements: string[];
  parts: Record<AdrPart, string>;
}

const PARTS: { key: AdrPart; label: string; placeholder: string; optional: boolean }[] = [
  { key: 'context', label: 'Context', placeholder: 'The issue that motivates this decision and the forces at play', optional: false },
  { key: 'drivers', label: 'Decision drivers', placeholder: 'The concerns and qualities that shaped the choice', optional: true },
  { key: 'options', label: 'Considered options', placeholder: 'The alternatives that were looked at, with their pros and cons', optional: true },
  { key: 'decision', label: 'Decision', placeholder: 'The option chosen, and why', optional: false },
  { key: 'consequences', label: 'Consequences', placeholder: 'What becomes easier or harder because of this decision', optional: false },
  { key: 'confirmation', label: 'Confirmation', placeholder: 'How compliance with the decision is checked', optional: true },
];

const today = () => new Date().toISOString().slice(0, 10);

function draftOf(d: DocDecision | undefined): Draft {
  return {
    title: d?.title ?? '',
    status: d?.status ?? 'proposed',
    date: d?.date ?? today(),
    deciders: d?.deciders.join(', ') ?? '',
    supersedes: d?.supersedes ?? '',
    qualityGoals: d?.qualityGoals ?? [],
    constraints: d?.constraints ?? [],
    requirements: d?.requirements ?? [],
    parts: Object.fromEntries(PARTS.map((p) => [p.key, d?.parts[p.key] ?? ''])) as Record<AdrPart, string>,
  };
}

/** A small WYSIWYG editor for one part of the record; reports its content as Markdown. */
function RichField({ id, value, placeholder, onChange, autoFocus }: { id: string; value: string; placeholder: string; onChange(markdown: string): void; autoFocus?: boolean }) {
  const change = useRef(onChange);
  change.current = onChange;
  const editor = useEditor(
    {
      extensions: [...sectionExtensions(), Placeholder.configure({ placeholder, showOnlyCurrent: false })],
      content: markdownToJson(value),
      autofocus: autoFocus ? 'end' : false,
      editorProps: { attributes: { class: 'dd-rich-body', id, spellcheck: 'true' } },
      onUpdate: ({ editor: e }) => change.current(jsonToMarkdown(e.getJSON() as Record<string, unknown>).trim()),
    },
    [],
  );
  return <EditorContent editor={editor} className="dd-rich" data-link-base="decisions" />;
}

/** Items picked from a data list (quality goals, constraints): a checkbox, the ID, the text under it. */
function Picks({ label, items, value, onChange }: { label: string; items: { id: string; text: string }[]; value: string[]; onChange(v: string[]): void }) {
  const known = new Set(items.map((i) => i.id));
  const all = [...items, ...value.filter((v) => !known.has(v)).map((id) => ({ id, text: '' }))];
  if (all.length === 0) return null;
  return (
    <div className="xd-field wide">
      <span>{label}</span>
      <div className="dd-picks" role="group" aria-label={label}>
        {all.map((item) => {
          const on = value.includes(item.id);
          return (
            <label key={item.id} className={`dd-pick${on ? ' on' : ''}`}>
              <input type="checkbox" checked={on} onChange={() => onChange(on ? value.filter((v) => v !== item.id) : [...value, item.id])} />
              <span className="dd-pick-text">
                <span className="dd-pick-id">{item.id}</span>
                {item.text && <span className="dd-pick-body">{item.text}</span>}
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((v, i) => v === b[i]);
const splitNames = (s: string) => s.split(',').map((v) => v.trim()).filter(Boolean);

export function DecisionDialog({ data, file, onClose }: { data: DocumentData; file: string | null; onClose(): void }) {
  useModalScrollLock();
  const existing = file ? data.decisions.find((d) => d.file === file) : undefined;
  const initial = useMemo(() => draftOf(existing), [file]); // eslint-disable-line react-hooks/exhaustive-deps
  const [draft, setDraft] = useState<Draft>(initial);
  const [shown, setShown] = useState<Set<AdrPart>>(() => new Set(PARTS.filter((p) => !p.optional || initial.parts[p.key]).map((p) => p.key)));
  const [focusPart, setFocusPart] = useState<AdrPart | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const setPart = (key: AdrPart, text: string) => setDraft((d) => ({ ...d, parts: { ...d.parts, [key]: text } }));

  const dirty =
    draft.title !== initial.title ||
    draft.status !== initial.status ||
    draft.date !== initial.date ||
    !sameList(splitNames(draft.deciders), splitNames(initial.deciders)) ||
    draft.supersedes !== initial.supersedes ||
    !sameList(draft.qualityGoals, initial.qualityGoals) ||
    !sameList(draft.constraints, initial.constraints) ||
    !sameList(draft.requirements, initial.requirements) ||
    PARTS.some((p) => draft.parts[p.key] !== initial.parts[p.key]);
  const canSave = !!draft.title.trim() && (dirty || !existing) && !saving;

  const goals = useMemo(() => (tableFor(data.tables, 'data/quality-goals.yaml')?.rows ?? []).filter((r) => r.id).map((r) => ({ id: r.id!, text: r.goal || r.quality || r.id! })), [data.tables]);
  const constraints = useMemo(() => (tableFor(data.tables, 'data/constraints.yaml')?.rows ?? []).filter((r) => r.id).map((r) => ({ id: r.id!, text: r.constraint || r.id! })), [data.tables]);
  const requirements = useMemo(
    () =>
      (tableFor(data.tables, 'data/requirements.yaml')?.rows ?? [])
        .filter((r) => r.id && (r.text || r.title))
        .map((r) => ({ id: r.id!, text: r.title || (r.text!.length > 140 ? `${r.text!.slice(0, 140)}…` : r.text!) })),
    [data.tables],
  );
  const others = data.decisions.filter((d) => d.file !== file);

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    const common = {
      title: draft.title.trim(),
      status: draft.status,
      date: draft.date,
      deciders: splitNames(draft.deciders),
      qualityGoals: draft.qualityGoals,
      constraints: draft.constraints,
      requirements: draft.requirements,
      context: draft.parts.context,
      consequences: draft.parts.consequences,
      drivers: draft.parts.drivers,
      options: draft.parts.options,
      confirmation: draft.parts.confirmation,
    };
    try {
      if (existing) {
        await runOp('update_decision', { ...common, decision: existing.number, decision_text: draft.parts.decision, supersedes: draft.supersedes });
      } else {
        await runOp('create_decision', { ...common, decision: draft.parts.decision, ...(draft.supersedes ? { supersedes: draft.supersedes } : {}) });
      }
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  };
  const saveRef = useRef(save);
  saveRef.current = save;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  useEffect(() => {
    if (!existing) titleRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !dirtyRef.current) onClose();
      else if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'Enter')) {
        e.preventDefault();
        void saveRef.current();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]); // eslint-disable-line react-hooks/exhaustive-deps

  const hidden = PARTS.filter((p) => !shown.has(p.key));

  return (
    <div className="dw-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !dirty && onClose()}>
      <div className="xd dd" role="dialog" aria-modal="true" aria-labelledby="dd-title">
        <div className="xd-head">
          <h2 id="dd-title">
            {existing ? (
              <>
                <span className="dd-num">ADR-{existing.number}</span> Architecture decision
              </>
            ) : (
              'New architecture decision'
            )}
          </h2>
          <button type="button" className="icon-btn" title="Close (Esc)" onClick={onClose}>
            <IconClose />
          </button>
        </div>
        <div className="dd-body">
          <label className="xd-field wide">
            <span>Title</span>
            <input ref={titleRef} className="dd-title" value={draft.title} placeholder="e.g. Use PostgreSQL for order data" onChange={(e) => set({ title: e.target.value })} />
          </label>
          <div className="dd-meta">
            <label className="xd-field">
              <span>Status</span>
              <span className="xd-select">
                <select value={draft.status} onChange={(e) => set({ status: e.target.value })}>
                  {ADR_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s.charAt(0).toUpperCase() + s.slice(1)}
                    </option>
                  ))}
                </select>
              </span>
            </label>
            <label className="xd-field">
              <span>Date</span>
              <input type="date" value={draft.date} onChange={(e) => set({ date: e.target.value })} />
            </label>
            <label className="xd-field">
              <span>Supersedes</span>
              <span className="xd-select">
                <select value={draft.supersedes} onChange={(e) => set({ supersedes: e.target.value })}>
                  <option value="">None</option>
                  {others.map((d) => (
                    <option key={d.file} value={d.number}>
                      ADR-{d.number} {d.title}
                    </option>
                  ))}
                </select>
              </span>
            </label>
          </div>
          <label className="xd-field wide">
            <span>Decision-makers</span>
            <input value={draft.deciders} placeholder="Names or roles, separated by commas" onChange={(e) => set({ deciders: e.target.value })} />
          </label>
          <Picks label="Quality goals addressed" items={goals} value={draft.qualityGoals} onChange={(qualityGoals) => set({ qualityGoals })} />
          <Picks label="Constraints addressed" items={constraints} value={draft.constraints} onChange={(c) => set({ constraints: c })} />
          <Picks label="Requirements addressed" items={requirements} value={draft.requirements} onChange={(r) => set({ requirements: r })} />
          {PARTS.filter((p) => shown.has(p.key)).map((p) => (
            <div key={p.key} className="xd-field wide dd-part">
              <span className="dd-part-head">
                <label htmlFor={`dd-${p.key}`}>{p.label}</label>
                {p.optional && (
                  <button
                    type="button"
                    className="icon-btn dd-part-remove"
                    title={`Remove ${p.label.toLowerCase()}`}
                    onClick={() => {
                      setPart(p.key, '');
                      setShown((s) => new Set([...s].filter((k) => k !== p.key)));
                    }}
                  >
                    <IconClose />
                  </button>
                )}
              </span>
              <RichField id={`dd-${p.key}`} value={draft.parts[p.key]} placeholder={p.placeholder} onChange={(v) => setPart(p.key, v)} autoFocus={focusPart === p.key} />
            </div>
          ))}
          {hidden.length > 0 && (
            <div className="dd-add">
              {hidden.map((p) => (
                <button
                  type="button"
                  key={p.key}
                  className="link-btn"
                  onClick={() => {
                    setFocusPart(p.key);
                    setShown((s) => new Set([...s, p.key]));
                  }}
                >
                  <IconPlusSmall /> {p.label}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="xd-foot">
          {error ? <span className="xd-note dd-error">{error}</span> : dirty && existing ? <span className="xd-note">Unsaved changes</span> : null}
          <button type="button" className="btn secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn" disabled={!canSave} onClick={() => void save()} title="Save (Ctrl+S)">
            {existing ? 'Save' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}
