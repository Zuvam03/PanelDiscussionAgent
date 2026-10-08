import { useEffect, useState } from 'react';
import { api } from '../api';

export default function SetupView({ mode, onStart, onBack }) {
  const [config, setConfig] = useState(null);
  const [topic, setTopic] = useState('');
  const [customTopic, setCustomTopic] = useState('');
  const [selected, setSelected] = useState([]);
  const [duration, setDuration] = useState(8);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Mode-specific state
  const [studentNation, setStudentNation] = useState('');
  const [studentSide, setStudentSide] = useState('');
  const [studentRole, setStudentRole] = useState('');

  useEffect(() => {
    api.getConfig(mode || 'gd').then((c) => {
      setConfig(c);
      const names = Object.keys(c.personas);
      setSelected(names.slice(0, c.mode.defaults.num_agents));
      setDuration(c.mode.defaults.duration_minutes);
    }).catch(() => setError('Could not load config — is the backend running?'));
  }, [mode]);

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
      const data = {
        mode: mode || 'gd',
        topic: finalTopic || undefined,
        persona_names: selected.length ? selected : undefined,
        duration_minutes: duration,
      };
      if (mode === 'mun' && studentNation) {
        data.student_nation = studentNation;
      }
      if (mode === 'parliamentary' && studentSide && studentRole) {
        data.student_side = studentSide;
        data.student_role = studentRole;
      }
      const session = await api.createSession(data);
      onStart(session.id);
    } catch (e) {
      setError(e.message);
      setLoading(false);
    }
  }

  if (!config) {
    return <div className="card">{error || 'Loading config...'}</div>;
  }

  const modeConfig = config.mode;
  const topics = modeConfig.topics || [];
  const personas = config.personas;
  const nations = modeConfig.nations || [];
  const roles = modeConfig.roles || {};
  const sides = Object.keys(roles);

  const rolesForSide = studentSide ? (roles[studentSide] || []) : [];

  return (
    <>
      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <button className="btn btn-secondary" onClick={onBack}
            style={{ padding: '4px 10px', fontSize: '0.75rem' }}>
            Back
          </button>
          <h2>{modeConfig.display_name} Setup</h2>
        </div>

        {modeConfig.description && (
          <p style={{ color: 'var(--text-dim)', fontSize: '0.85rem', marginBottom: 16 }}>
            {modeConfig.description}
          </p>
        )}

        <div className="form-group">
          <label htmlFor="topic-select">Topic</label>
          <select
            id="topic-select"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
          >
            <option value="">Random</option>
            {topics.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
            <option value="__custom__">Custom...</option>
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

        {/* MUN: nation selection */}
        {mode === 'mun' && nations.length > 0 && (
          <div className="form-group">
            <label htmlFor="nation-select">Your Nation (optional)</label>
            <select
              id="nation-select"
              value={studentNation}
              onChange={(e) => setStudentNation(e.target.value)}
            >
              <option value="">Random assignment</option>
              {nations.map((n) => (
                <option key={n.code} value={n.name}>
                  {n.name} ({n.code}) {n.bloc ? `— ${n.bloc}` : ''}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Parliamentary: side & role selection */}
        {mode === 'parliamentary' && sides.length > 0 && (
          <>
            <div className="form-group">
              <label htmlFor="side-select">Your Side (optional)</label>
              <select
                id="side-select"
                value={studentSide}
                onChange={(e) => { setStudentSide(e.target.value); setStudentRole(''); }}
              >
                <option value="">Random assignment</option>
                {sides.map((s) => (
                  <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
                ))}
              </select>
            </div>
            {studentSide && rolesForSide.length > 0 && (
              <div className="form-group">
                <label htmlFor="role-select">Your Role</label>
                <select
                  id="role-select"
                  value={studentRole}
                  onChange={(e) => setStudentRole(e.target.value)}
                >
                  <option value="">Select a role</option>
                  {rolesForSide.map((r) => (
                    <option key={r.code} value={r.title}>
                      {r.title} ({r.code}) — {r.duty}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </>
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
              max={30}
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
            />
          </div>
        </div>

        {/* Scoring preview for competition modes */}
        {modeConfig.scoring && modeConfig.scoring.categories.length > 0 && (
          <div className="scoring-preview">
            <label>Scoring Categories</label>
            <div className="scoring-cats">
              {modeConfig.scoring.categories.map((c) => (
                <div key={c.name} className="scoring-cat-chip">
                  <span className="scoring-cat-name">{c.name}</span>
                  <span className="scoring-cat-weight">{(c.weight * 100).toFixed(0)}%</span>
                </div>
              ))}
            </div>
          </div>
        )}

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
          {loading ? 'Creating...' : `Start ${modeConfig.display_name}`}
        </button>
      </div>
    </>
  );
}
