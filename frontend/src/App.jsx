import { useState } from 'react';
import './index.css';
import SetupView from './views/SetupView';
import SessionView from './views/SessionView';
import ReportView from './views/ReportView';
import HistoryView from './views/HistoryView';

export default function App() {
  const [view, setView] = useState('setup');
  const [sessionId, setSessionId] = useState(null);

  function goSetup() {
    setSessionId(null);
    setView('setup');
  }

  function goSession(id) {
    setSessionId(id);
    setView('session');
  }

  function goReport(id) {
    setSessionId(id);
    setView('report');
  }

  function goHistory() {
    setView('history');
  }

  return (
    <div className="app">
      <header className="header">
        <h1>⚡ PanelPrep</h1>
        <nav>
          <button
            className={`btn btn-nav ${view === 'setup' ? 'active' : ''}`}
            onClick={goSetup}
          >
            New Session
          </button>
          <button
            className={`btn btn-nav ${view === 'history' ? 'active' : ''}`}
            onClick={goHistory}
          >
            History
          </button>
        </nav>
      </header>
      <main className="main">
        {view === 'setup' && <SetupView onStart={goSession} />}
        {view === 'session' && (
          <SessionView
            sessionId={sessionId}
            onEnd={goReport}
            onBack={goSetup}
          />
        )}
        {view === 'report' && (
          <ReportView sessionId={sessionId} onBack={goSetup} />
        )}
        {view === 'history' && (
          <HistoryView onSelect={goReport} onNew={goSetup} />
        )}
      </main>
    </div>
  );
}
