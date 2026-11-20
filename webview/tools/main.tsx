// The Archery sidebar's "Diagram Tools" view: the palette and inspector of the active diagram
// editor tab. The editor keeps all state and sends the panels' props; calls go back to it
// (see webview/shared/remote.ts).
import { useEffect, useMemo, useState, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import '../shared/base.css';
import '../diagram/diagram.css';
import '../sequence/sequence.css';
import '../timing/timing.css';
import './tools.css';
import { Inspector } from '../diagram/Inspector';
import { Rail } from '../diagram/Rail';
import { SeqInspector } from '../sequence/SeqInspector';
import { SeqRail } from '../sequence/SequenceEditor';
import { TimingInspector } from '../timing/TimingInspector';
import { TimingRail } from '../timing/TimingEditor';
import { decodePanels, type DockedPanels, type PanelComponent, type PanelSpec } from '../shared/remote';
import { reportUserActivity } from '../shared/activity';

interface VsCodeApi {
  postMessage(message: unknown): void;
}
declare function acquireVsCodeApi(): VsCodeApi;
const api = acquireVsCodeApi();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const COMPONENTS: Record<PanelComponent, ComponentType<any>> = {
  canvasRail: Rail,
  canvasInspector: Inspector,
  seqRail: SeqRail,
  seqInspector: SeqInspector,
  timingRail: TimingRail,
  timingInspector: TimingInspector,
};

const call = (fn: string, args: unknown[]) => api.postMessage({ type: 'panelCall', fn, args });

function Panel({ spec }: { spec: PanelSpec }) {
  const props = useMemo(() => decodePanels(spec.props, call) as Record<string, unknown>, [spec]);
  const C = COMPONENTS[spec.component];
  return C ? <C {...props} /> : null;
}

function App() {
  const [panels, setPanels] = useState<DockedPanels | null>(null);
  useEffect(() => {
    const onMessage = (event: MessageEvent<{ type?: string; panels?: DockedPanels | null }>) => {
      if (event.data?.type === 'panels') setPanels(event.data.panels ?? null);
    };
    window.addEventListener('message', onMessage);
    const stopReporting = reportUserActivity(() => api.postMessage({ type: 'activity' }));
    api.postMessage({ type: 'ready' });
    return () => {
      window.removeEventListener('message', onMessage);
      stopReporting();
    };
  }, []);

  if (!panels) return <div className="tools-empty">No diagram open</div>;
  return (
    <div className="tools">
      {panels.rail && (
        <section className="tools-palette" aria-label="Palette">
          <Panel spec={panels.rail} />
        </section>
      )}
      {panels.inspector && (
        <aside className="properties" aria-label="Properties">
          <Panel spec={panels.inspector} />
        </aside>
      )}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
