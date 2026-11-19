// Entry of the standalone canvas diagram editor (custom editor for *.uml.json).
import { ReactFlowProvider } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { createRoot } from 'react-dom/client';
import '../shared/base.css';
import { HostContext } from '../shared/host';
import { useHost } from '../shared/vscode';
import { CanvasEditor } from './CanvasEditor';
import './diagram.css';

function App() {
  const host = useHost();
  return (
    <HostContext.Provider value={host}>
      <ReactFlowProvider>
        <CanvasEditor />
      </ReactFlowProvider>
    </HostContext.Provider>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
