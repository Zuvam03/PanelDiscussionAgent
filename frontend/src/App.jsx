import { useState } from 'react';
import './index.css';
import ModeSelectView from './views/ModeSelectView';
import SetupView from './views/SetupView';
import SessionView from './views/SessionView';
import ReportView from './views/ReportView';
import HistoryView from './views/HistoryView';
import JudgeView from './views/JudgeView';

export default function App() {
  const [view, setView] = useState('modes');
  const [sessionId, setSessionId] = useState(null);
  const [selectedMode, setSelectedMode] = useState(null);

  function goModes() {
    setSessionId(null);
    setSelectedMode(null);
    setView('modes');
  }

  function goSetup(mode) {
    setSelectedMode(mode);
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

  function goJudge(id) {
    setSessionId(id);
    setView('judge');
  }

  return (
    <div className="app">
      <header className="header">
        <h1 onClick={goModes} style={{ cursor: 'pointer' }}>PanelPrep</h1>
        <nav>
          <button
            className={`btn btn-nav ${view === 'modes' || view === 'setup' ? 'active' : ''}`}
            onClick={goModes}
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
        {view === 'modes' && <ModeSelectView onSelect={goSetup} />}
        {view === 'setup' && (
          <SetupView mode={selectedMode} onStart={goSession} onBack={goModes} />
        )}
        {view === 'session' && (
          <SessionView
            sessionId={sessionId}
            onEnd={goReport}
            onBack={goModes}
          />
        )}
        {view === 'report' && (
          <ReportView sessionId={sessionId} onBack={goModes} onJudge={goJudge} />
        )}
        {view === 'history' && (
          <HistoryView onSelect={goReport} onNew={goModes} />
        )}
        {view === 'judge' && (
          <JudgeView sessionId={sessionId} onBack={() => goReport(sessionId)} />
        )}
      </main>
    </div>
  );
}
