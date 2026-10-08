import { useEffect, useState } from 'react';
import { api } from '../api';

export default function JudgeView({ sessionId, onBack }) {
  const [session, setSession] = useState(null);
  const [modes, setModes] = useState(null);
  const [scores, setScores] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([api.getSession(sessionId), api.getModes()])
      .then(([s, m]) => { setSession(s); setModes(m); })
      .catch((e) => setError(e.message));
  }, [sessionId]);

  if (error) return <div className="card" style={{ color: 'var(--red)' }}>{error}</div>;
  if (!session || !modes) return <div className="card">Loading...</div>;

  const modeConfig = modes[session.mode];
  const categories = modeConfig?.scoring?.categories || [];
  const speakers = [...new Set(session.turns.map(t => t.speaker))];

  if (categories.length === 0) {
    return (
      <div className="card">
        <p>This mode does not have scoring categories.</p>
        <button className="btn btn-secondary" onClick={onBack}>Back to Report</button>
      </div>
    );
  }

  function setScore(speaker, category, value) {
    const key = `${speaker}__${category}`;
    setScores(prev => ({ ...prev, [key]: value }));
  }

  function getScore(speaker, category) {
    return scores[`${speaker}__${category}`] ?? 5;
  }

  async function handleSubmit() {
    setSubmitting(true);
    setError('');
    try {
      const judgeId = `human_${Date.now().toString(36)}`;
      const scoreList = [];
      for (const speaker of speakers) {
        for (const cat of categories) {
          scoreList.push({
            judge_id: judgeId,
            speaker,
            category: cat.name,
            score: getScore(speaker, cat.name),
            comment: '',
          });
        }
      }
      await api.submitJudgeScores(sessionId, { judge_id: judgeId, scores: scoreList });
      setSubmitted(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <div className="card" style={{ textAlign: 'center' }}>
        <div style={{ fontSize: '2rem', marginBottom: 8 }}>&#10003;</div>
        <h3>Scores Submitted</h3>
        <p style={{ color: 'var(--text-dim)', marginBottom: 16 }}>
          Your judge scores have been recorded. Regenerate the report to see updated rankings.
        </p>
        <button className="btn btn-primary" onClick={onBack}>Back to Report</button>
      </div>
    );
  }

  return (
    <div className="judge-view">
      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <button className="btn btn-secondary" onClick={onBack}
            style={{ padding: '4px 10px', fontSize: '0.75rem' }}>Back</button>
          <h2>Judge Scoring</h2>
        </div>
        <p style={{ color: 'var(--text-dim)', fontSize: '0.85rem', marginBottom: 20 }}>
          Score each participant on every category (0-10). Your scores will be averaged with AI judge scores.
        </p>

        {speakers.map(speaker => (
          <div key={speaker} className="judge-speaker-section">
            <h3 className="judge-speaker-name">
              {speaker === 'student' ? 'You (Student)' : speaker}
            </h3>
            <div className="judge-categories">
              {categories.map(cat => (
                <div key={cat.name} className="judge-cat-row">
                  <div className="judge-cat-info">
                    <span className="judge-cat-name">{cat.name}</span>
                    <span className="judge-cat-weight">{(cat.weight * 100).toFixed(0)}%</span>
                  </div>
                  <div className="judge-slider-wrap">
                    <input
                      type="range"
                      min="0"
                      max="10"
                      step="0.5"
                      value={getScore(speaker, cat.name)}
                      onChange={(e) => setScore(speaker, cat.name, parseFloat(e.target.value))}
                      className="judge-slider"
                    />
                    <span className="judge-score-val">{getScore(speaker, cat.name)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}

        {error && (
          <p style={{ color: 'var(--red)', fontSize: '0.8rem', marginBottom: 12 }}>{error}</p>
        )}

        <button
          className="btn btn-primary"
          onClick={handleSubmit}
          disabled={submitting}
          style={{ marginTop: 16 }}
        >
          {submitting ? 'Submitting...' : 'Submit Scores'}
        </button>
      </div>
    </div>
  );
}
