// Entry of the standalone interaction editors: sequence / communication (*.seq.json) and
// timing (*.timing.json) diagrams share this bundle.
import { createRoot } from 'react-dom/client';
import '../shared/base.css';
import '../diagram/diagram.css';
import { HostContext } from '../shared/host';
import { useHost } from '../shared/vscode';
import { SequenceEditor } from './SequenceEditor';
import { TimingEditor } from '../timing/TimingEditor';
import './sequence.css';
import '../timing/timing.css';

function App() {
  const host = useHost();
  return (
    <HostContext.Provider value={host}>
      {host.fileName?.endsWith('.timing.json') ? <TimingEditor /> : <SequenceEditor />}
    </HostContext.Provider>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
