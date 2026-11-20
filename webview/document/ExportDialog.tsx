// Export dialog: text, page, header, footer, page numbers, table of contents and document
// options, each in its own section; a small page preview shows where the header,
// footer and page numbers go. The choices are saved in archery.yaml (`export`) when you export.
import { forwardRef, useEffect, useRef, useState, type SelectHTMLAttributes } from 'react';
import type { DocumentData } from '../../src/doc/protocol';
import { fillPlaceholders, marginSlots, resolveExportSettings, type MarginSlot } from '../../src/export/exportSettings';
import type { ExportSettings } from '../../src/model/schema';
import { IconClose } from './icons';

const FONTS = ['Segoe UI', 'Calibri', 'Arial', 'Helvetica', 'Inter', 'Verdana', 'Tahoma', 'Georgia', 'Cambria', 'Times New Roman', 'Garamond', 'Consolas'];
const SIZES = [9, 10, 10.5, 11, 12, 13, 14];
const TOC: { value: number; label: string }[] = [
  { value: 0, label: 'No table of contents' },
  { value: 1, label: 'Chapters' },
  { value: 2, label: 'Chapters and sections' },
  { value: 3, label: 'Down to subsections' },
  { value: 4, label: 'All headings' },
];
const OTHER = '__other';

/** A native select with the dialog's own chevron, inset from the right edge. */
const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(props, ref) {
  return (
    <span className="xd-select">
      <select ref={ref} {...props} />
    </span>
  );
});

/** A font from the list, or any installed font typed in after choosing "Other font". */
function FontField({ label, value, inherit, onChange, selectRef }: { label: string; value: string | undefined; inherit?: string; onChange(v: string | undefined): void; selectRef?: React.Ref<HTMLSelectElement> }) {
  const custom = !!value && !FONTS.includes(value);
  const [other, setOther] = useState(custom);
  const shown = other ? OTHER : value ?? '';
  return (
    <label className="xd-field">
      <span>{label}</span>
      <Select
        ref={selectRef}
        value={shown}
        onChange={(e) => {
          if (e.target.value === OTHER) return setOther(true);
          setOther(false);
          onChange(e.target.value || undefined);
        }}
      >
        {inherit !== undefined && <option value="">{inherit}</option>}
        {FONTS.map((f) => (
          <option key={f} value={f}>
            {f}
          </option>
        ))}
        <option value={OTHER}>Other font</option>
      </Select>
      {other && <input value={value ?? ''} placeholder="Installed font name, e.g. Aptos" onChange={(e) => onChange(e.target.value || undefined)} />}
    </label>
  );
}

interface Props {
  data: DocumentData;
  onClose(): void;
  onExport(format: 'pdf' | 'html', settings: ExportSettings): void;
}

export function ExportDialog({ data, onClose, onExport }: Props) {
  const [s, setS] = useState<ExportSettings>(() => ({ ...data.exportSettings }));
  const set = (patch: ExportSettings) => setS((cur) => ({ ...cur, ...patch }));
  const r = resolveExportSettings(s);
  const first = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    first.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const values = { title: data.title, system: data.system, version: data.version, date: new Date().toISOString().slice(0, 10) };
  const slots = marginSlots(r);
  const slotText = (slot: MarginSlot) => (slots[slot] ? fillPlaceholders(slots[slot]!, values).replace(/\{page\}/g, '3').replace(/\{pages\}/g, '42') : '');
  const landscape = r.orientation === 'landscape';
  const editorStyle = data.canvasSettings.diagramStyle === 'modern' ? 'Modern' : 'Classic';
  const placeholders = (
    <>
      <code>{'{title}'}</code> <code>{'{system}'}</code> <code>{'{version}'}</code> <code>{'{date}'}</code> <code>{'{page}'}</code> <code>{'{pages}'}</code>
    </>
  );

  return (
    <div className="dw-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="xd" role="dialog" aria-modal="true" aria-labelledby="xd-title">
        <div className="xd-head">
          <h2 id="xd-title">Export document</h2>
          <button type="button" className="icon-btn" title="Close (Esc)" onClick={onClose}>
            <IconClose />
          </button>
        </div>
        <div className="xd-body">
          <div className="xd-form">
            <fieldset>
              <legend>Text</legend>
              <FontField label="Font" value={r.font} selectRef={first} onChange={(font) => set({ font })} />
              <FontField label="Heading font" value={s.headingFont} inherit="Same as the text" onChange={(headingFont) => set({ headingFont })} />
              <label className="xd-field">
                <span>Base size</span>
                <Select value={r.fontSize} onChange={(e) => set({ fontSize: Number(e.target.value) })}>
                  {[...new Set([...SIZES, r.fontSize])].sort((a, b) => a - b).map((n) => (
                    <option key={n} value={n}>
                      {n} pt
                    </option>
                  ))}
                </Select>
              </label>
            </fieldset>

            <fieldset>
              <legend>Page</legend>
              <label className="xd-field">
                <span>Size</span>
                <Select value={r.pageSize} onChange={(e) => set({ pageSize: e.target.value as ExportSettings['pageSize'] })}>
                  {['A4', 'Letter', 'Legal', 'A3', 'A5'].map((p) => (
                    <option key={p}>{p}</option>
                  ))}
                </Select>
              </label>
              <label className="xd-field">
                <span>Orientation</span>
                <Select value={r.orientation} onChange={(e) => set({ orientation: e.target.value as ExportSettings['orientation'] })}>
                  <option value="portrait">Portrait</option>
                  <option value="landscape">Landscape</option>
                </Select>
              </label>
              <label className="xd-field">
                <span>Margins</span>
                <Select value={r.margins} onChange={(e) => set({ margins: e.target.value as ExportSettings['margins'] })}>
                  <option value="narrow">Narrow</option>
                  <option value="normal">Normal</option>
                  <option value="wide">Wide</option>
                </Select>
              </label>
            </fieldset>

            <fieldset>
              <legend>Header</legend>
              <label className="xd-field wide">
                <span>Text</span>
                <input value={r.header} placeholder="No header" onChange={(e) => set({ header: e.target.value })} />
              </label>
              <p className="xd-hint">
                Split into left, center and right parts with <code>|</code>, e.g. <code>{'{system} | Draft | v{version}'}</code>. Placeholders: {placeholders}
              </p>
            </fieldset>

            <fieldset>
              <legend>Footer</legend>
              <label className="xd-field wide">
                <span>Text</span>
                <input value={r.footer} placeholder="No footer" onChange={(e) => set({ footer: e.target.value })} />
              </label>
              <p className="xd-hint">Same parts and placeholders as the header.</p>
            </fieldset>

            <fieldset>
              <legend>Page numbers</legend>
              <label className="xd-field">
                <span>Position</span>
                <Select value={r.pageNumbers} onChange={(e) => set({ pageNumbers: e.target.value as ExportSettings['pageNumbers'] })}>
                  <option value="none">No page numbers</option>
                  <option value="bottom-center">Bottom center</option>
                  <option value="bottom-right">Bottom right</option>
                  <option value="top-right">Top right</option>
                </Select>
              </label>
              <label className="xd-field span2">
                <span>Text</span>
                <input value={r.pageNumberFormat} disabled={r.pageNumbers === 'none'} onChange={(e) => set({ pageNumberFormat: e.target.value || undefined })} />
              </label>
            </fieldset>

            <fieldset>
              <legend>Table of contents</legend>
              <label className="xd-field">
                <span>Headings listed</span>
                <Select value={r.tocDepth} onChange={(e) => set({ tocDepth: Number(e.target.value) })}>
                  {TOC.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </Select>
              </label>
            </fieldset>

            <fieldset>
              <legend>Document</legend>
              <div className="xd-checks">
                <label className="check">
                  <input type="checkbox" checked={r.cover} onChange={(e) => set({ cover: e.target.checked })} /> Cover page
                </label>
                <label className="check">
                  <input type="checkbox" checked={r.numberHeadings} onChange={(e) => set({ numberHeadings: e.target.checked })} /> Numbered headings
                </label>
                <label className="check">
                  <input type="checkbox" checked={r.chapterBreaks} onChange={(e) => set({ chapterBreaks: e.target.checked })} /> Each chapter on a new page
                </label>
                <label className="check">
                  <input type="checkbox" checked={r.changeHistory} onChange={(e) => set({ changeHistory: e.target.checked })} /> Change history chapter
                </label>
              </div>
              <p className="xd-hint">Diagrams are drawn in the {editorStyle} style, as set in the Archery extension settings (Diagram Style).</p>
            </fieldset>
          </div>

          <aside className="xd-preview" aria-label="Page preview">
            <div className={`xd-page${landscape ? ' landscape' : ''}`} style={{ fontFamily: `'${r.font}', var(--vscode-font-family)` }}>
              <div className="xd-margin top">
                <span>{slotText('top-left')}</span>
                <span>{slotText('top-center')}</span>
                <span>{slotText('top-right')}</span>
              </div>
              <div className="xd-sheet" style={{ fontSize: `${r.fontSize * 0.62}px` }}>
                <div className="xd-h" style={{ fontFamily: `'${r.headingFont}', var(--vscode-font-family)` }}>
                  {r.numberHeadings ? '5 ' : ''}Building Block View
                </div>
                <div className="xd-line" />
                <div className="xd-line" />
                <div className="xd-line short" />
                <div className="xd-h2" style={{ fontFamily: `'${r.headingFont}', var(--vscode-font-family)` }}>
                  {r.numberHeadings ? '5.1 ' : ''}Whitebox Overall System
                </div>
                <div className="xd-line" />
                <div className="xd-line" />
                <div className="xd-box" />
                <div className="xd-line short" />
              </div>
              <div className="xd-margin bottom">
                <span>{slotText('bottom-left')}</span>
                <span>{slotText('bottom-center')}</span>
                <span>{slotText('bottom-right')}</span>
              </div>
            </div>
            <p className="xd-caption">
              {r.pageSize} {r.orientation}, {r.fontSize} pt {r.font}
            </p>
          </aside>
        </div>
        <div className="xd-foot">
          <button type="button" className="btn secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn secondary" onClick={() => onExport('html', s)}>
            Export HTML
          </button>
          <button type="button" className="btn" onClick={() => onExport('pdf', s)}>
            Export PDF
          </button>
        </div>
      </div>
    </div>
  );
}
