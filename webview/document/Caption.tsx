// Numbered, editable captions: "Table 3: Quality goals", "Diagram 2: ...", "Figure 1: ...".
// The number is a CSS counter over the whole document (all chapters, in reading order), so it
// follows every insert, move and delete without being stored. Only the title is stored.
import { useState } from 'react';

export type CaptionKind = 'table' | 'diagram' | 'figure';

interface Props {
  kind: CaptionKind;
  /** The stored caption (null / '' = none). */
  value: string | null;
  /** Shown when there is no caption (e.g. the data list's or the diagram's name). */
  fallback?: string;
  editable: boolean;
  onChange(value: string | null): void;
}

export function Caption({ kind, value, fallback, editable, onChange }: Props) {
  const [editing, setEditing] = useState(false);
  const text = value || fallback || '';
  const commit = (raw: string) => {
    setEditing(false);
    const next = raw.trim();
    // Typing the fallback (or nothing) means "no own caption".
    const stored = !next || next === fallback ? null : next;
    if (stored !== (value || null)) onChange(stored);
  };
  return (
    <span className={`cap${text ? '' : ' empty'}`}>
      <span className={`cap-num cap-${kind}`} aria-hidden="true" />
      {editing ? (
        <input
          className="cap-input"
          autoFocus
          defaultValue={text}
          aria-label="Caption"
          onFocus={(e) => e.currentTarget.select()}
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onBlur={(e) => commit(e.currentTarget.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') e.currentTarget.blur();
            if (e.key === 'Escape') setEditing(false);
          }}
        />
      ) : (
        <span
          className={`cap-text${editable ? ' editable' : ''}`}
          title={editable ? 'Click to edit the caption' : undefined}
          onClick={(e) => {
            if (!editable) return;
            e.stopPropagation();
            setEditing(true);
          }}
        >
          {text || (editable ? <span className="cap-placeholder">Add a caption</span> : null)}
        </span>
      )}
    </span>
  );
}

/** The same caption as plain DOM, for widgets inside the ProseMirror view (Markdown tables). */
export function captionElement(kind: CaptionKind, value: string | null, onChange: (value: string | null) => void): HTMLElement {
  const el = document.createElement('div');
  el.className = `cap cap-block${value ? '' : ' empty'}`;
  el.contentEditable = 'false';
  const num = document.createElement('span');
  num.className = `cap-num cap-${kind}`;
  num.setAttribute('aria-hidden', 'true');
  const text = document.createElement('span');
  text.className = 'cap-text editable';
  text.title = 'Click to edit the caption';
  const show = () => {
    text.replaceChildren(value ? document.createTextNode(value) : Object.assign(document.createElement('span'), { className: 'cap-placeholder', textContent: 'Add a caption' }));
  };
  show();
  text.addEventListener('mousedown', (e) => e.preventDefault());
  text.addEventListener('click', () => {
    const input = document.createElement('input');
    input.className = 'cap-input';
    input.value = value ?? '';
    input.setAttribute('aria-label', 'Caption');
    let done = false;
    const finish = (save: boolean) => {
      if (done) return;
      done = true;
      const next = input.value.trim() || null;
      input.replaceWith(text);
      if (save && next !== value) onChange(next);
    };
    input.addEventListener('blur', () => finish(true));
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') input.blur();
      if (e.key === 'Escape') finish(false);
    });
    text.replaceWith(input);
    input.focus();
    input.select();
  });
  el.append(num, text);
  return el;
}
