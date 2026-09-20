import { useEffect, useState } from 'react';
import { api } from '../api';

export default function SetupView({ onStart }) {
  const [config, setConfig] = useState(null);
  const [topic, setTopic] = useState('');
  const [customTopic, setCustomTopic] = useState('');
  const [selected, setSelected] = useState([]);
  const [duration, setDuration] = useState(8);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.getConfig().then((c) => {
      setConfig(c);
      const names = Object.keys(c.personas);
      setSelected(names.slice(0, c.mode.defaults.num_agents));
      setDuration(c.mode.defaults.duration_minutes);
    }).catch(() => setError('Could not load config — is the backend running?'));
  }, []);

  function togglePersona(name) {
    setSelected((prev) =>
      prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]
    );
  }

  async function handleStart() {
    setLoading(true);
    setError('');
    try {
      const finalTopic = topic === '__custom__' ? customTopic : topic;
      const session = await api.createSession({
        topic: finalTopic || undefined,
        persona_names: selected.length ? selected : undefined,
        duration_minutes: duration,
      });
      onStart(session.id);
    } catch (e) {
      setError(e.message);
      setLoading(false);
    }
  }

  if (!config) {
    return <div className="card">{error || 'Loading config…'}</div>;
  }

  const topics = config.mode.topics || [];
  const personas = config.personas;

  return (
    <>
      <div className="card">
        <h2>New Group Discussion</h2>

        <div className="form-group">
          <label htmlFor="topic-select">Topic</label>
          <select
            id="topic-select"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
          >
            <option value="">Random</option>
            {topics.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
            <option value="__custom__">Custom…</option>
          </select>
        </div>

        {topic === '__custom__' && (
          <div className="form-group">
            <label htmlFor="custom-topic">Your Topic</label>
            <input
              id="custom-topic"
              type="text"
              value={customTopic}
              onChange={(e) => setCustomTopic(e.target.value)}
              placeholder="Enter your own topic"
              style={{
                width: '100%',
                padding: '8px 12px',
                fontSize: '0.875rem',
                background: 'var(--surface2)',
                color: 'var(--text)',
                border: '1px solid var(--border)',
                borderRadius: '6px',
                fontFamily: 'var(--font)',
              }}
            />
          </div>
        )}

        <div className="form-group">
          <label>AI Peers ({selected.length} selected)</label>
          <div className="persona-grid">
            {Object.values(personas).map((p) => (
              <button
                key={p.name}
                type="button"
                className={`persona-chip ${selected.includes(p.name) ? 'selected' : ''}`}
                onClick={() => togglePersona(p.name)}
                title={p.style}
              >
                {p.display}
              </button>
            ))}
          </div>
        </div>

        <div className="form-row">
          <div>
            <label htmlFor="duration">Duration (minutes)</label>
            <input
              id="duration"
              type="number"
              min={2}
              max={20}
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
            />
          </div>
        </div>

        {error && (
          <p style={{ color: 'var(--red)', fontSize: '0.8rem', marginBottom: 12 }}>
            {error}
          </p>
        )}

        <button
          className="btn btn-primary"
          onClick={handleStart}
          disabled={loading || selected.length === 0}
        >
          {loading ? 'Creating…' : 'Start Discussion'}
        </button>
      </div>
    </>
  );
}
