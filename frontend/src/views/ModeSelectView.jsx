import { useEffect, useState } from 'react';
import { api } from '../api';

const MODE_META = {
  gd: { icon: '💬', color: 'var(--accent)', tag: 'Classic' },
  mun: { icon: '🌐', color: 'var(--blue)', tag: 'Formal' },
  parliamentary: { icon: '🏛️', color: 'var(--orange)', tag: 'Competitive' },
  tv_debate: { icon: '📺', color: 'var(--red)', tag: 'Audience' },
};

export default function ModeSelectView({ onSelect }) {
  const [modes, setModes] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.getModes()
      .then(setModes)
      .catch(() => setError('Could not load modes — is the backend running?'));
  }, []);

  if (error) return <div className="card" style={{ color: 'var(--red)' }}>{error}</div>;
  if (!modes) return <div className="card">Loading formats...</div>;

  const modeList = Object.entries(modes);

  return (
    <div className="mode-select">
      <div className="mode-select-header">
        <h2>Choose Your Format</h2>
        <p className="mode-select-sub">
          Practice debates, discussions, and competitions in multiple formats
        </p>
      </div>
      <div className="mode-grid">
        {modeList.map(([key, mode]) => {
          const meta = MODE_META[key] || { icon: '🎤', color: 'var(--accent)', tag: 'Custom' };
          return (
            <button
              key={key}
              className="mode-card"
              onClick={() => onSelect(key)}
              style={{ '--mode-color': meta.color }}
            >
              <div className="mode-card-icon">{meta.icon}</div>
              <div className="mode-card-tag" style={{ background: meta.color }}>{meta.tag}</div>
              <h3 className="mode-card-title">{mode.display_name}</h3>
              <p className="mode-card-desc">{mode.description}</p>
              <div className="mode-card-details">
                <span>{mode.defaults.num_agents} AI peers</span>
                <span>{mode.defaults.duration_minutes} min</span>
                {mode.scoring && <span>{mode.scoring.categories.length} scoring categories</span>}
                {mode.vote_mechanics?.influence_tracking && <span>Vote tracking</span>}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
