import { useEffect, useState } from 'react';
import { api } from '../api';

const MARKER_LABELS = {
  opened_discussion: { label: 'Opened discussion', yes: '🎯', no: '—' },
  self_introduction: { label: 'Self-introduction', yes: '✅', no: '❌' },
  attempted_summary: { label: 'Attempted summary', yes: '✅', no: '❌' },
  asked_question: { label: 'Asked a question', yes: '✅', no: '❌' },
  expressed_disagreement: { label: 'Expressed disagreement', yes: '✅', no: '—' },
  redirected_topic: { label: 'Redirected topic', yes: '✅', no: '—' },
};

const STRENGTH_COLORS = {
  strong: 'var(--green)',
  moderate: 'var(--orange)',
  weak: 'var(--red)',
};

const STRENGTH_LABELS = {
  strong: 'Strong',
  moderate: 'Moderate',
  weak: 'Weak',
};

export default function ReportView({ sessionId, onBack }) {
  const [report, setReport] = useState(null);
  const [session, setSession] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [evalFilter, setEvalFilter] = useState('all');

  useEffect(() => {
    setLoading(true);
    Promise.all([api.getReport(sessionId), api.getSession(sessionId)])
      .then(([r, s]) => {
        setReport(r);
        setSession(s);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [sessionId]);

  if (error) return <div className="card" style={{ color: 'var(--red)' }}>{error}</div>;
  if (loading || !report || !session) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: '48px 24px' }}>
        <div className="report-loading-spinner" />
        <p style={{ marginTop: 16, color: 'var(--text-dim)' }}>
          {loading ? 'Analysing your performance…' : 'Generating report…'}
        </p>
        <p style={{ fontSize: '0.75rem', color: 'var(--text-dim)', marginTop: 4 }}>
          The AI judge is reviewing every turn
        </p>
      </div>
    );
  }

  const { metrics, structural_markers, swot, next_actions, coaching } = report;

  return (
    <>
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ fontSize: '1.1rem', marginBottom: 4 }}>Session Report</h2>
          <p style={{ color: 'var(--text-dim)', fontSize: '0.8rem' }}>{session.topic}</p>
          {coaching && (
            <span className="coaching-badge">AI Coach Analysis</span>
          )}
        </div>
        <button className="btn btn-secondary" onClick={onBack}>
          ← Back
        </button>
      </div>

      {/* Judge Verdict — the headline */}
      {coaching?.judge_verdict && (
        <div className="card coaching-verdict-card">
          <h3>Judge's Verdict</h3>
          <p className="coaching-verdict-text">{coaching.judge_verdict}</p>
        </div>
      )}

      {/* Overall Coaching Narrative */}
      {coaching?.overall_narrative && (
        <div className="card coaching-narrative-card">
          <h3>Coach's Notes</h3>
          {coaching.overall_narrative.split('\n').filter(Boolean).map((para, i) => (
            <p key={i} className="coaching-narrative-para">{para}</p>
          ))}
        </div>
      )}

      {/* Point-by-Point Evaluations — all participants */}
      {coaching?.point_evaluations?.length > 0 && (() => {
        const speakers = [...new Set(coaching.point_evaluations.map(pe => pe.speaker))];
        const filtered = evalFilter === 'all'
          ? coaching.point_evaluations
          : coaching.point_evaluations.filter(pe => pe.speaker === evalFilter);
        const studentCount = coaching.point_evaluations.filter(pe => pe.speaker === 'student').length;
        const agentCount = coaching.point_evaluations.length - studentCount;

        return (
          <div className="card">
            <div className="eval-header-row">
              <h3>Point-by-Point Evaluation</h3>
              <span className="eval-count">
                {studentCount} your turns, {agentCount} agent turns
              </span>
            </div>
            <div className="eval-filter-bar">
              <button
                className={`eval-filter-btn ${evalFilter === 'all' ? 'active' : ''}`}
                onClick={() => setEvalFilter('all')}
              >
                All ({coaching.point_evaluations.length})
              </button>
              {speakers.map(sp => (
                <button
                  key={sp}
                  className={`eval-filter-btn ${evalFilter === sp ? 'active' : ''} ${sp === 'student' ? 'student-btn' : ''}`}
                  onClick={() => setEvalFilter(sp)}
                >
                  {sp === 'student' ? 'You' : sp} ({coaching.point_evaluations.filter(pe => pe.speaker === sp).length})
                </button>
              ))}
            </div>
            <div className="point-evaluations">
              {filtered.map((pe, i) => (
                <div key={i} className={`point-eval-item ${pe.speaker === 'student' ? 'is-student' : ''}`}>
                  <div className="point-eval-header">
                    <span
                      className="strength-badge"
                      style={{ background: STRENGTH_COLORS[pe.strength] || 'var(--text-dim)' }}
                    >
                      {STRENGTH_LABELS[pe.strength] || pe.strength}
                    </span>
                    <span className="point-eval-speaker">
                      {pe.speaker === 'student' ? 'You' : pe.speaker}
                    </span>
                    <span className="point-eval-seq">Turn #{pe.turn_seq}</span>
                  </div>
                  <blockquote className="point-eval-excerpt">"{pe.excerpt}"</blockquote>
                  <div className="point-eval-details">
                    {pe.what_worked && pe.what_worked !== 'Nothing notable' && (
                      <div className="eval-detail good">
                        <span className="eval-icon">+</span>
                        <span>{pe.what_worked}</span>
                      </div>
                    )}
                    {pe.what_didnt && pe.what_didnt !== 'Solid delivery' && (
                      <div className="eval-detail bad">
                        <span className="eval-icon">-</span>
                        <span>{pe.what_didnt}</span>
                      </div>
                    )}
                    {pe.comparison && (
                      <div className="eval-detail compare">
                        <span className="eval-icon">vs</span>
                        <span>{pe.comparison}</span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* Key Moments */}
      {coaching?.key_moments?.length > 0 && (
        <div className="card">
          <h3>Key Moments</h3>
          <div className="key-moments">
            {coaching.key_moments.map((km, i) => (
              <div key={i} className="key-moment-item">
                <div className="key-moment-label">{km.label}</div>
                <div className="key-moment-commentary">{km.commentary}</div>
                <span className="key-moment-seq">Turn #{km.turn_seq}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Missed Opportunities */}
      {coaching?.missed_opportunities?.length > 0 && (
        <div className="card">
          <h3>Missed Opportunities</h3>
          <div className="missed-opportunities">
            {coaching.missed_opportunities.map((mo, i) => (
              <div key={i} className="missed-opp-item">
                <div className="missed-opp-context">{mo.context}</div>
                <div className="missed-opp-suggestion">
                  <span className="missed-opp-label">You could have said:</span>
                  <p>"{mo.what_student_could_have_said}"</p>
                </div>
                <div className="missed-opp-why">{mo.why_it_matters}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Metrics */}
      <div className="card">
        <h3>Speaker Metrics</h3>
        <table className="metrics-table">
          <thead>
            <tr>
              <th>Speaker</th>
              <th>Turns</th>
              <th>Words</th>
              <th>Share</th>
              <th>Questions</th>
              <th>Disagree</th>
              <th>Builds</th>
              <th>Int. Given</th>
              <th>Int. Recv</th>
            </tr>
          </thead>
          <tbody>
            {metrics.map((m) => (
              <tr key={m.speaker} className={m.speaker === 'student' ? 'student-row' : ''}>
                <td>{m.speaker === 'student' ? '⭐ You' : m.speaker}</td>
                <td>{m.turns}</td>
                <td>{m.words}</td>
                <td>{(m.word_share * 100).toFixed(1)}%</td>
                <td>{m.questions}</td>
                <td>{m.disagreements}</td>
                <td>{m.builds}</td>
                <td>{m.interruptions_given}</td>
                <td>{m.interruptions_received}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Structural Markers */}
      <div className="card">
        <h3>Structural Markers</h3>
        <div className="marker-grid">
          {Object.entries(structural_markers).map(([key, value]) => {
            const info = MARKER_LABELS[key] || { label: key, yes: '✅', no: '❌' };
            return (
              <div key={key} className="marker-item">
                <span className="marker-icon">{value ? info.yes : info.no}</span>
                <span>{info.label}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* SWOT */}
      <div className="card">
        <h3>SWOT Analysis</h3>
        <div className="swot-grid">
          {['strengths', 'weaknesses', 'opportunities', 'threats'].map((key) => (
            <div key={key} className={`swot-box ${key}`}>
              <h4>{key}</h4>
              <ul>
                {(swot[key] || []).length > 0 ? (
                  swot[key].map((item, i) => <li key={i}>{item}</li>)
                ) : (
                  <li style={{ color: 'var(--text-dim)' }}>None identified</li>
                )}
              </ul>
            </div>
          ))}
        </div>
      </div>

      {/* Next Actions */}
      <div className="card">
        <h3>What to Work On Next</h3>
        <ol className="actions-list">
          {next_actions.map((a, i) => (
            <li key={i}>{a}</li>
          ))}
        </ol>
      </div>

      <div style={{ paddingTop: 8 }}>
        <button className="btn btn-primary" onClick={onBack}>
          Start New Session
        </button>
      </div>
    </>
  );
}
