import { useEffect, useState } from 'react';
import { api } from '../api';

export default function HistoryView({ onSelect, onNew }) {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.listSessions()
      .then(setSessions)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function handleDelete(e, id) {
    e.stopPropagation();
    if (!confirm('Delete this session and its report? This cannot be undone.')) return;
    await api.deleteSession(id);
    setSessions((prev) => prev.filter((s) => s.id !== id));
  }

  function formatDate(ts) {
    return new Date(ts * 1000).toLocaleString();
  }

  if (loading) return <div className="card">Loading…</div>;

  return (
    <>
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ fontSize: '1.1rem' }}>Session History</h2>
        <button className="btn btn-primary" onClick={onNew}>
          + New Session
        </button>
      </div>

      {sessions.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', color: 'var(--text-dim)' }}>
          <p>No sessions yet. Start your first GD practice!</p>
        </div>
      ) : (
        sessions.map((s) => (
          <div
            key={s.id}
            className="history-item"
            onClick={() => s.status === 'ended' && onSelect(s.id)}
          >
            <div>
              <div className="history-topic">{s.topic}</div>
              <div className="history-meta">
                {formatDate(s.created_at)} · {s.status}
                {s.has_report && ' · 📊 Report available'}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {s.status === 'ended' && (
                <span style={{ fontSize: '0.75rem', color: 'var(--accent)' }}>View →</span>
              )}
              <button
                className="btn btn-danger"
                onClick={(e) => handleDelete(e, s.id)}
                style={{ padding: '4px 10px', fontSize: '0.7rem' }}
              >
                Delete
              </button>
            </div>
          </div>
        ))
      )}
    </>
  );
}
