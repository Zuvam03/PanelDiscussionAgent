"""SQLite persistence for Phase 0. Sessions and reports are stored as JSON
documents behind a small repository, so moving to Postgres later (PRD §5)
means reimplementing this module, not touching callers."""

from __future__ import annotations

import json
import sqlite3
from typing import Optional

from ..config import DATA_DIR
from ..models import Report, Session

_DB_PATH = DATA_DIR / "panelprep.db"


def _conn() -> sqlite3.Connection:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(_DB_PATH)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY,
            created_at REAL NOT NULL,
            topic TEXT NOT NULL,
            status TEXT NOT NULL,
            body TEXT NOT NULL,
            report TEXT
        )""")
    return conn


class SessionRepository:
    def save(self, session: Session) -> None:
        with _conn() as c:
            c.execute(
                """INSERT INTO sessions (id, created_at, topic, status, body)
                   VALUES (?, ?, ?, ?, ?)
                   ON CONFLICT(id) DO UPDATE SET status=excluded.status, body=excluded.body""",
                (session.id, session.created_at, session.topic,
                 session.status.value, session.model_dump_json()),
            )

    def save_report(self, session_id: str, report: Report) -> None:
        with _conn() as c:
            c.execute("UPDATE sessions SET report=? WHERE id=?",
                      (report.model_dump_json(), session_id))

    def get(self, session_id: str) -> Optional[Session]:
        with _conn() as c:
            row = c.execute("SELECT body FROM sessions WHERE id=?", (session_id,)).fetchone()
        return Session(**json.loads(row[0])) if row else None

    def get_report(self, session_id: str) -> Optional[Report]:
        with _conn() as c:
            row = c.execute("SELECT report FROM sessions WHERE id=?", (session_id,)).fetchone()
        return Report(**json.loads(row[0])) if row and row[0] else None

    def list_summaries(self) -> list[dict]:
        with _conn() as c:
            rows = c.execute(
                "SELECT id, created_at, topic, status, report IS NOT NULL "
                "FROM sessions ORDER BY created_at DESC").fetchall()
        return [
            {"id": r[0], "created_at": r[1], "topic": r[2],
             "status": r[3], "has_report": bool(r[4])}
            for r in rows
        ]

    def delete(self, session_id: str) -> bool:
        """Per-session deletion is a day-one requirement (PRD §6)."""
        with _conn() as c:
            cur = c.execute("DELETE FROM sessions WHERE id=?", (session_id,))
        return cur.rowcount > 0
