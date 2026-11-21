// The architecture document: every section on one page, rendered and edited in place.
import type { Editor } from '@tiptap/core';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createRoot } from 'react-dom/client';
import type { DiagramKind, DocumentData, ToDocument } from '../../src/doc/protocol';
import type { Scene } from '../../src/render/scene';
import { createDiagramRequest, DocContext, resolveRequest, vscodeApi, type DocContextValue } from './context';
import './document.css';
import { DecisionDialog } from './DecisionDialog';
import { ExportDialog } from './ExportDialog';
import { installHelpPopups } from './editorTools';
import { expectEdit, itemFor, showChange } from './follow';
import { reportUserActivity } from '../shared/activity';
import { Lightbox } from './Lightbox';
import { headingSlug, installLinkHandler } from './links';
import { showDetail } from './nodeViews';
import { SectionEditor } from './SectionEditor';
import { Toc } from './Toc';
import { Toolbar } from './Toolbar';

/** The outline headings (## and ###) of a section, in order: index i = outline item i. */
const outlineHeadings = (section: Element) => [...section.querySelectorAll<HTMLElement>('.section-body > h2, .section-body > h3')];

function scrollToSection(sectionId: string, heading?: string, index?: number, slug?: string) {
  const section = document.getElementById(`sec-${sectionId}`);
  if (!section) return;
  let target: Element = section;
  if (index !== undefined) target = outlineHeadings(section)[index] ?? section;
  else if (heading) {
    const match = [...section.querySelectorAll('h2, h3')].find((h) => h.textContent?.trim() === heading.trim());
    if (match) target = match;
  } else if (slug) {
    const match = [...section.querySelectorAll('h1, h2, h3, h4, h5, h6')].find((h) => headingSlug(h.textContent ?? '') === slug.toLowerCase());
    if (match) target = match;
  }
  target.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/** The change history is the chapter after the last numbered arc42 section (13 in a full document). */
function historyNumber(data: DocumentData): number {
  return Math.max(0, ...data.sections.map((s) => s.number ?? 0)) + 1;
}

const TOC_WIDTH = 260;
function savedTocWidth(): number {
  try {
    const w = Number(localStorage.getItem('archery.tocWidth'));
    return w >= 180 && w <= 560 ? w : TOC_WIDTH;
  } catch {
    return TOC_WIDTH;
  }
}

/** Read-only change history: one row per release, filled in by "Release" (which asks for the change log). */
function ChangeHistory({ data }: { data: DocumentData }) {
  const released = data.changeHistory.at(-1)?.version;
  const status = released === data.version ? `v${data.version}` : `v${data.version} (unreleased changes${released ? ` since v${released}` : ''})`;
  return (
    <section className="generated change-history" aria-label="Change history">
      <div className="generated-head">
        <span>
          Current version {status}
        </span>
        <button type="button" className="link-btn" disabled={!data.canRelease} onClick={() => vscodeApi.postMessage({ type: 'release' })} title="Release a new version">
          Release
        </button>
      </div>
      {data.changeHistory.length === 0 ? (
        <div className="generated-empty">No releases yet.</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Version</th>
                <th>Date</th>
                <th>Author</th>
                <th>Changes</th>
              </tr>
            </thead>
            <tbody>
              {data.changeHistory.map((row) => (
                <tr key={row.version}>
                  <td className="nowrap">{row.version}</td>
                  <td className="nowrap">{row.date}</td>
                  <td className="nowrap">{row.author ?? ''}</td>
                  <td>{row.changes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function App() {
  const [data, setData] = useState<DocumentData | null>(null);
  const [activeEditor, setActiveEditor] = useState<Editor | null>(null);
  const [lightbox, setLightbox] = useState<{ scene: Scene; title: string; src: string } | null>(null);
  /** The decision record being edited: its file, or null for a new one. */
  const [decision, setDecision] = useState<{ file: string | null } | null>(null);
  const [activeSection, setActiveSection] = useState<string>();
  const editors = useRef(new Map<string, Editor>());
  const [error, setError] = useState<string | null>(null);
  const pendingReveal = useRef<{ sectionId: string; heading?: string; index?: number; decision?: string } | null>(null);
  /** Scrolls to a decision's row in the decision list and opens the decision over the document. */
  const showDecision = useCallback((file: string) => {
    const row = [...document.querySelectorAll<HTMLElement>('tr[data-decision]')].find((r) => r.dataset.decision === file);
    row?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    setDecision({ file });
  }, []);
  const reveal = (target: { sectionId: string; heading?: string; index?: number; decision?: string }) => {
    if (target.decision) showDecision(target.decision);
    else scrollToSection(target.sectionId, target.heading, target.index);
  };
  const revealRef = useRef(reveal);
  revealRef.current = reveal;
  // A clicked contents entry stays active until the user scrolls by hand (short chapters near the
  // end can never reach the top of the page).
  const pinned = useRef<{ section: string; heading: number | null } | null>(null);
  const [activeHeading, setActiveHeading] = useState<number | null>(null);
  const [tocWidth, setTocWidth] = useState(savedTocWidth);
  // Re-render the contents panel when a section's headings change (typing, outline edits).
  const [, setOutlineTick] = useState(0);

  // arc42 guidance pop-ups stay open until a click outside them.
  useEffect(() => installHelpPopups(), []);
  // Links go to their place in the document (or open outside it), never to the browser as a resource URL.
  const dataRef = useRef(data);
  dataRef.current = data;
  useEffect(
    () =>
      installLinkHandler({
        data: () => dataRef.current,
        showSection: (sectionId, slug) => {
          setDecision(null);
          pinned.current = null;
          scrollToSection(sectionId, undefined, undefined, slug);
        },
        openDecision: (file) => setDecision({ file }),
        showDiagram: (src) => {
          setDecision(null);
          showDetail(src, (s) => vscodeApi.postMessage({ type: 'openDiagram', src: s }));
        },
        openOutside: (href, base) => vscodeApi.postMessage({ type: 'openLink', href, base }),
      }),
    [],
  );
  useEffect(() => {
    const onMessage = (event: MessageEvent<ToDocument>) => {
      const msg = event.data;
      if (resolveRequest(msg)) return;
      switch (msg.type) {
        case 'load':
          setData(msg.data);
          break;
        case 'reveal':
          if (document.getElementById(`sec-${msg.sectionId}`)) revealRef.current(msg);
          else pendingReveal.current = msg;
          break;
        case 'follow': {
          // Live view: an agent is about to change this chapter / diagram / table.
          if (msg.edit) expectEdit(msg.sectionId);
          const item = msg.src ? itemFor(msg.src) : null;
          if (item) showChange(item);
          else if (document.getElementById(`sec-${msg.sectionId}`)) scrollToSection(msg.sectionId, undefined, msg.index);
          else pendingReveal.current = { sectionId: msg.sectionId, index: msg.index };
          break;
        }
      }
    };
    window.addEventListener('message', onMessage);
    const stopReporting = reportUserActivity(() => vscodeApi.postMessage({ type: 'activity' }));
    vscodeApi.postMessage({ type: 'ready' });
    return () => {
      window.removeEventListener('message', onMessage);
      stopReporting();
    };
  }, []);

  // Relative image paths in sections resolve against the sections folder.
  useEffect(() => {
    if (!data) return;
    let base = document.querySelector('base');
    if (!base) {
      base = document.createElement('base');
      document.head.prepend(base);
    }
    base.href = data.sectionsBaseUri.endsWith('/') ? data.sectionsBaseUri : `${data.sectionsBaseUri}/`;
    if (pendingReveal.current) {
      const target = pendingReveal.current;
      pendingReveal.current = null;
      setTimeout(() => revealRef.current(target), 50);
    }
  }, [data]);

  // Scroll spy for the contents panel: the last section whose top has passed the toolbar.
  useEffect(() => {
    if (!data) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      if (pinned.current) return;
      const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
      if (atBottom && window.scrollY > 0) {
        const all = document.querySelectorAll<HTMLElement>('.doc-section');
        const last = all[all.length - 1];
        if (last) {
          setActiveSection(last.id.slice(4));
          setActiveHeading(null);
          return;
        }
      }
      let current: HTMLElement | undefined;
      for (const el of document.querySelectorAll<HTMLElement>('.doc-section')) {
        if (el.getBoundingClientRect().top <= 120) current = el;
        else break;
      }
      // The subsection heading the reader is in (the last one that passed the toolbar).
      let heading: number | null = null;
      if (current) {
        outlineHeadings(current).forEach((h, i) => {
          if (h.getBoundingClientRect().top <= 120) heading = i;
        });
      }
      setActiveSection(current ? current.id.slice(4) : data.sections[0]?.id);
      setActiveHeading(heading);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    const unpin = () => {
      if (!pinned.current) return;
      pinned.current = null;
      onScroll();
    };
    const unpinKey = (e: KeyboardEvent) => ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(e.key) && unpin();
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('wheel', unpin, { passive: true });
    window.addEventListener('touchstart', unpin, { passive: true });
    window.addEventListener('keydown', unpinKey);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('wheel', unpin);
      window.removeEventListener('touchstart', unpin);
      window.removeEventListener('keydown', unpinKey);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [data?.sections.map((s) => s.id).join()]);

  // Tell the sidebar's contents where the reader is.
  useEffect(() => {
    if (activeSection) vscodeApi.postMessage({ type: 'activeSection', sectionId: activeSection, index: activeHeading });
  }, [activeSection, activeHeading]);

  const onEditor = useCallback((id: string, editor: Editor | null) => {
    if (editor) {
      editors.current.set(id, editor);
      let last = '';
      const check = () => {
        const sig = editor.state.doc.content.content
          .filter((n) => n.type.name === 'heading')
          .map((n) => `${n.attrs.level}:${n.textContent}`)
          .join('|');
        if (sig !== last) {
          last = sig;
          setOutlineTick((t) => t + 1);
        }
      };
      editor.on('update', check);
      check();
    } else editors.current.delete(id);
  }, []);

  const navigate = useCallback((sectionId: string, index?: number) => {
    pinned.current = { section: sectionId, heading: index ?? null };
    setActiveSection(sectionId);
    setActiveHeading(index ?? null);
    scrollToSection(sectionId, undefined, index);
  }, []);

  const ctx = useMemo<DocContextValue | null>(
    () =>
      data && {
        data,
        post: (msg) => vscodeApi.postMessage(msg),
        maximize: (scene, title, src) => setLightbox({ scene, title, src }),
        createDiagram: (kind: DiagramKind) => createDiagramRequest(kind),
        activeEditor,
        setActiveEditor,
        showError: setError,
        // Diagrams open in their own editor tab.
        editDiagram: (src: string) => {
          setLightbox(null);
          vscodeApi.postMessage({ type: 'openDiagram', src });
        },
        openDecision: (file) => setDecision({ file }),
      },
    [data, activeEditor],
  );

  const [exporting, setExporting] = useState(false);
  if (!data || !ctx) return <div className="loading">Loading the documentation…</div>;

  return (
    <DocContext.Provider value={ctx}>
      <div className="layout">
        <Toc
          data={data}
          active={activeSection}
          activeHeading={activeHeading}
          editors={editors.current}
          historyNumber={historyNumber(data)}
          width={tocWidth}
          onWidth={(w) => {
            setTocWidth(w);
            try {
              localStorage.setItem('archery.tocWidth', String(w));
            } catch {
              /* per-viewer convenience only */
            }
          }}
          onNavigate={navigate}
          onExport={() => setExporting(true)}
          onDecision={showDecision}
        />
        <main className="content">
          <Toolbar />
          <header className="doc-header">
            <h1 className="doc-title">{data.title}</h1>
          </header>
          {data.sections.map((s) => (
            <section key={s.id} id={`sec-${s.id}`} className="doc-section" style={{ '--num': `"${s.number ?? ''}"` } as CSSProperties} data-numbered={s.number !== undefined} data-link-base={s.file.split('/').slice(0, -1).join('/')}>
              <SectionEditor section={s} onEditor={onEditor} />
            </section>
          ))}
          <section id="sec-change-history" className="doc-section history-section" style={{ '--num': `"${historyNumber(data)}"` } as CSSProperties} data-numbered>
            <div className="section-body static">
              <h1>Change history</h1>
              <ChangeHistory data={data} />
            </div>
          </section>
        </main>
      </div>
      {exporting && (
        <ExportDialog
          data={data}
          onClose={() => setExporting(false)}
          onExport={(format, settings) => {
            setExporting(false);
            vscodeApi.postMessage({ type: 'export', format, settings });
          }}
        />
      )}
      {error && (
        <div className="toast" role="alert" onClick={() => setError(null)}>
          {error}
        </div>
      )}
      {decision && <DecisionDialog key={decision.file ?? 'new'} data={data} file={decision.file} onClose={() => setDecision(null)} />}
      {lightbox && (
        <Lightbox
          scene={lightbox.scene}
          title={lightbox.title}
          onClose={() => setLightbox(null)}
          onEdit={() => {
            vscodeApi.postMessage({ type: 'openDiagram', src: lightbox.src });
            setLightbox(null);
          }}
          onLink={(file) => {
            setLightbox(null);
            showDetail(file, (src) => vscodeApi.postMessage({ type: 'openDiagram', src }));
          }}
        />
      )}
    </DocContext.Provider>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
