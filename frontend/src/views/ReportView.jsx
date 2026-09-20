import { useEffect, useState } from 'react';
import { api } from '../api';

const STRENGTH_COLORS = {
  strong: 'var(--green)',
  moderate: 'var(--orange)',
  weak: 'var(--red)',
};
const STRENGTH_LABELS = { strong: 'Strong', moderate: 'Moderate', weak: 'Weak' };

const MARKER_LABELS = {
  opened_discussion: { label: 'Opened discussion' },
  self_introduction: { label: 'Self-introduction' },
  attempted_summary: { label: 'Attempted summary' },
  asked_question: { label: 'Asked a question' },
  expressed_disagreement: { label: 'Expressed disagreement' },
  redirected_topic: { label: 'Redirected topic' },
};

function EvalCard({ pe, highlight }) {
  return (
    <div className={`eval-card ${highlight ? 'highlight' : ''}`}>
      <div className="eval-card-top">
        <span className="strength-badge" style={{ background: STRENGTH_COLORS[pe.strength] || 'var(--text-dim)' }}>
          {STRENGTH_LABELS[pe.strength] || pe.strength}
        </span>
        <span className="eval-card-speaker">{pe.speaker === 'student' ? 'You' : pe.speaker}</span>
        <span className="eval-card-turn">Turn #{pe.turn_seq}</span>
      </div>
      <blockquote className="eval-card-quote">&ldquo;{pe.excerpt}&rdquo;</blockquote>
      <div className="eval-card-body">
        {pe.what_worked && pe.what_worked !== 'Nothing notable' && (
          <div className="eval-row good"><span className="eval-tag">+</span><span>{pe.what_worked}</span></div>
        )}
        {pe.what_didnt && pe.what_didnt !== 'Solid delivery' && (
          <div className="eval-row bad"><span className="eval-tag">&minus;</span><span>{pe.what_didnt}</span></div>
        )}
        {pe.comparison && (
          <div className="eval-row compare"><span className="eval-tag">vs</span><span>{pe.comparison}</span></div>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, sub, color }) {
  return (
    <div className="stat-card">
      <div className="stat-value" style={{ color: color || 'var(--accent)' }}>{value}</div>
      <div className="stat-label">{label}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

export default function ReportView({ sessionId, onBack }) {
  const [report, setReport] = useState(null);
  const [session, setSession] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);

  function loadReport(regenerate = false) {
    if (regenerate) setRegenerating(true);
    else setLoading(true);
    Promise.all([api.getReport(sessionId, regenerate), api.getSession(sessionId)])
      .then(([r, s]) => { setReport(r); setSession(s); setError(''); })
      .catch((e) => setError(e.message))
      .finally(() => { setLoading(false); setRegenerating(false); });
  }

  useEffect(() => { loadReport(); }, [sessionId]);

  if (error) return <div className="card" style={{ color: 'var(--red)' }}>{error}</div>;
  if (loading || !report || !session) {
    return (
      <div className="report-loading-page">
        <div className="report-loading-spinner" />
        <p className="loading-title">Analysing your performance...</p>
        <p className="loading-sub">The AI coach is reviewing every turn</p>
      </div>
    );
  }

  const { metrics, structural_markers, swot, next_actions, coaching } = report;

  const studentMetrics = metrics.find(m => m.speaker === 'student');
  const studentEvals = coaching?.point_evaluations?.filter(pe => pe.speaker === 'student') || [];
  const agentEvals = coaching?.point_evaluations?.filter(pe => pe.speaker !== 'student') || [];
  const agentsBySpeaker = {};
  agentEvals.forEach(pe => {
    if (!agentsBySpeaker[pe.speaker]) agentsBySpeaker[pe.speaker] = [];
    agentsBySpeaker[pe.speaker].push(pe);
  });

  const strongCount = studentEvals.filter(e => e.strength === 'strong').length;
  const weakCount = studentEvals.filter(e => e.strength === 'weak').length;
  const modCount = studentEvals.length - strongCount - weakCount;

  return (
    <div className="report-page">
      {/* Header */}
      <div className="report-header">
        <div>
          <h2 className="report-title">Session Report</h2>
          <p className="report-topic">{session.topic}</p>
        </div>
        <button className="btn btn-secondary" onClick={onBack}>Back</button>
      </div>

      {/* Quick stats row */}
      {studentMetrics && (
        <div className="stats-row">
          <StatCard label="Your Turns" value={studentMetrics.turns}
            sub={`of ${metrics.reduce((s, m) => s + m.turns, 0)} total`} />
          <StatCard label="Word Share" value={`${(studentMetrics.word_share * 100).toFixed(0)}%`}
            color={studentMetrics.word_share < 0.12 ? 'var(--red)' : 'var(--green)'} />
          <StatCard label="Words Spoken" value={studentMetrics.words} />
          <StatCard label="Questions" value={studentMetrics.questions} color="var(--blue)" />
        </div>
      )}

      {/* ========== COACHING MISSING BANNER ========== */}
      {!coaching && (
        <section className="report-section coaching-missing">
          <div className="coaching-missing-icon">&#9888;</div>
          <h3 className="section-title">AI Analysis Unavailable</h3>
          <p>The AI coach couldn't generate detailed analysis for this session. This can happen due to API rate limits.</p>
          <p>Click below to retry — it usually works on the second attempt.</p>
          <button className="btn btn-primary" onClick={() => loadReport(true)} disabled={regenerating}
            style={{ marginTop: 12 }}>
            {regenerating ? 'Generating...' : 'Generate AI Analysis'}
          </button>
        </section>
      )}

      {/* ========== SECTION 1: VERDICT ========== */}
      {coaching?.judge_verdict && (
        <section className="report-section verdict-section">
          <div className="section-badge">Verdict</div>
          <h3 className="section-title">Did You Pass?</h3>
          <p className="verdict-text">{coaching.judge_verdict}</p>
        </section>
      )}

      {/* ========== SECTION 2: COACH'S NARRATIVE ========== */}
      {coaching?.overall_narrative && (
        <section className="report-section narrative-section">
          <div className="section-badge blue">Coach's Take</div>
          <h3 className="section-title">Overall Assessment</h3>
          {coaching.overall_narrative.split('\n').filter(Boolean).map((para, i) => (
            <p key={i} className="narrative-para">{para}</p>
          ))}
        </section>
      )}

      {/* ========== SECTION 3: YOUR POINTS ========== */}
      {studentEvals.length > 0 && (
        <section className="report-section">
          <div className="section-badge green">Your Performance</div>
          <h3 className="section-title">Your Points Evaluated</h3>
          <div className="eval-summary-bar">
            <span className="eval-summary-chip strong">{strongCount} Strong</span>
            <span className="eval-summary-chip moderate">{modCount} Moderate</span>
            <span className="eval-summary-chip weak">{weakCount} Weak</span>
          </div>
          <div className="eval-list">
            {studentEvals.map((pe, i) => <EvalCard key={i} pe={pe} highlight />)}
          </div>
        </section>
      )}

      {/* ========== SECTION 4: WHAT YOU MISSED ========== */}
      {coaching?.missed_opportunities?.length > 0 && (
        <section className="report-section">
          <div className="section-badge orange">Opportunities</div>
          <h3 className="section-title">What You Could Have Said</h3>
          <p className="section-subtitle">Moments where you stayed silent or could have made a stronger point</p>
          <div className="missed-list">
            {coaching.missed_opportunities.map((mo, i) => (
              <div key={i} className="missed-card">
                <div className="missed-context">{mo.context}</div>
                <div className="missed-suggestion">
                  <span className="missed-label">You could have said:</span>
                  <p className="missed-quote">&ldquo;{mo.what_student_could_have_said}&rdquo;</p>
                </div>
                <div className="missed-why">{mo.why_it_matters}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ========== SECTION 5: HOW OTHERS PERFORMED ========== */}
      {Object.keys(agentsBySpeaker).length > 0 && (
        <section className="report-section">
          <div className="section-badge purple">Comparison</div>
          <h3 className="section-title">How Other Panellists Performed</h3>
          <p className="section-subtitle">Learn from what worked (and didn't) for each participant</p>
          {Object.entries(agentsBySpeaker).map(([speaker, evals]) => {
            const sStrong = evals.filter(e => e.strength === 'strong').length;
            return (
              <div key={speaker} className="agent-group">
                <div className="agent-group-header">
                  <span className="agent-group-name">{speaker}</span>
                  <span className="agent-group-stats">
                    {sStrong}/{evals.length} strong points
                  </span>
                </div>
                <div className="eval-list">
                  {evals.map((pe, i) => <EvalCard key={i} pe={pe} />)}
                </div>
              </div>
            );
          })}
        </section>
      )}

      {/* ========== SECTION 6: KEY MOMENTS ========== */}
      {coaching?.key_moments?.length > 0 && (
        <section className="report-section">
          <div className="section-badge">Timeline</div>
          <h3 className="section-title">Key Moments</h3>
          <div className="moments-timeline">
            {coaching.key_moments.map((km, i) => (
              <div key={i} className="moment-item">
                <div className="moment-marker" />
                <div className="moment-content">
                  <div className="moment-label">{km.label}</div>
                  <div className="moment-commentary">{km.commentary}</div>
                  <span className="moment-turn">Turn #{km.turn_seq}</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ========== SECTION 7: METRICS ========== */}
      <section className="report-section">
        <div className="section-badge">Data</div>
        <h3 className="section-title">Speaker Metrics</h3>
        <div className="metrics-table-wrap">
          <table className="metrics-table">
            <thead>
              <tr>
                <th>Speaker</th><th>Turns</th><th>Words</th><th>Share</th>
                <th>Questions</th><th>Disagree</th><th>Builds</th>
              </tr>
            </thead>
            <tbody>
              {metrics.map((m) => (
                <tr key={m.speaker} className={m.speaker === 'student' ? 'student-row' : ''}>
                  <td>{m.speaker === 'student' ? 'You' : m.speaker}</td>
                  <td>{m.turns}</td>
                  <td>{m.words}</td>
                  <td>
                    <div className="share-bar-wrap">
                      <div className="share-bar" style={{
                        width: `${Math.min(m.word_share * 100, 100)}%`,
                        background: m.speaker === 'student' ? 'var(--accent)' : 'var(--border)',
                      }} />
                      <span>{(m.word_share * 100).toFixed(0)}%</span>
                    </div>
                  </td>
                  <td>{m.questions}</td>
                  <td>{m.disagreements}</td>
                  <td>{m.builds}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Structural markers */}
      <section className="report-section">
        <h3 className="section-title">GD Checklist</h3>
        <div className="marker-grid">
          {Object.entries(structural_markers).map(([key, value]) => {
            const info = MARKER_LABELS[key] || { label: key };
            return (
              <div key={key} className={`marker-chip ${value ? 'done' : 'missed'}`}>
                <span className="marker-icon">{value ? '✓' : '✗'}</span>
                <span>{info.label}</span>
              </div>
            );
          })}
        </div>
      </section>

      {/* ========== SECTION 8: ACTION PLAN ========== */}
      <section className="report-section action-plan-section">
        <div className="section-badge green">Action Plan</div>
        <h3 className="section-title">What to Work On</h3>

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

        {next_actions?.length > 0 && (
          <div className="next-actions">
            <h4>Drills for Next Session</h4>
            <ol>
              {next_actions.map((a, i) => <li key={i}>{a}</li>)}
            </ol>
          </div>
        )}
      </section>

      <div className="report-footer">
        <button className="btn btn-primary" onClick={onBack}>Start New Session</button>
        {coaching && (
          <button className="btn btn-secondary" onClick={() => loadReport(true)} disabled={regenerating}
            style={{ fontSize: '0.75rem' }}>
            {regenerating ? 'Regenerating...' : 'Regenerate Analysis'}
          </button>
        )}
      </div>
    </div>
  );
}
