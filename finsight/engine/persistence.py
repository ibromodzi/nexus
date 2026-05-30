from __future__ import annotations

import json
import os
import sqlite3
from datetime import datetime

DB_PATH = os.getenv("FINSIGHT_HISTORY_DB_PATH", "finsight_history.sqlite")
CHROMA_PATH = os.getenv("FINSIGHT_CHROMA_PATH", "./chroma_finsight")


def init_db(path: str = DB_PATH) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True) if os.path.dirname(path) else None
    with sqlite3.connect(path, timeout=10) as conn:
        conn.execute(
            "CREATE TABLE IF NOT EXISTS reports ("
            "ticker TEXT, run_at TEXT, risk_report TEXT, judge_score TEXT, composite REAL, token_cost INTEGER"
            ")"
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_reports_ticker ON reports(ticker)"
        )


def save_report(
    ticker: str,
    risk_report: dict,
    judge_score: dict | None = None,
    token_cost: int = 0,
    path: str = DB_PATH,
) -> int:
    judge_score = judge_score or {}
    with sqlite3.connect(path, timeout=10) as conn:
        cur = conn.execute(
            "INSERT INTO reports (ticker, run_at, risk_report, judge_score, composite, token_cost) "
            "VALUES (?,?,?,?,?,?)",
            (
                ticker,
                datetime.utcnow().isoformat(),
                json.dumps(risk_report),
                json.dumps(judge_score),
                risk_report.get("composite_score"),
                token_cost,
            ),
        )
        return cur.lastrowid


def get_report_history(ticker: str, limit: int = 5, path: str = DB_PATH) -> list[dict]:
    with sqlite3.connect(path, timeout=10) as conn:
        rows = conn.execute(
            "SELECT run_at, risk_report, judge_score, composite FROM reports "
            "WHERE ticker=? ORDER BY run_at DESC LIMIT ?",
            (ticker, limit),
        ).fetchall()
    return [
        {
            "run_at": row[0],
            "risk_report": json.loads(row[1]),
            "judge_score": json.loads(row[2]),
            "composite": row[3],
        }
        for row in rows
    ]


def compute_composite_trend(
    ticker: str, current_composite: float, lookback: int = 5, path: str = DB_PATH
) -> str:
    history = get_report_history(ticker, limit=lookback, path=path)
    if not history:
        return "No prior data — first run for this ticker."

    prior = history[0]
    prior_composite = prior.get("composite")
    if prior_composite is None:
        return "Prior run had no composite score."

    try:
        prior_dt = datetime.fromisoformat(prior["run_at"])
        now_dt = datetime.utcnow()
        days_diff = max((now_dt - prior_dt).days, 1)
    except Exception:
        days_diff = 0
        now_dt = datetime.utcnow()

    delta = round(current_composite - prior_composite, 2)
    direction = "rising risk" if delta > 0 else "improving" if delta < 0 else "stable"
    sign = "+" if delta >= 0 else ""

    if len(history) >= 3:
        oldest = history[-1]
        oldest_composite = oldest.get("composite")
        if oldest_composite is not None:
            try:
                oldest_dt = datetime.fromisoformat(oldest["run_at"])
                span_days = max((now_dt - oldest_dt).days, 1)
            except Exception:
                span_days = 0
            long_delta = round(current_composite - oldest_composite, 2)
            long_sign = "+" if long_delta >= 0 else ""
            return (
                f"{sign}{delta} pts vs last run ({days_diff}d ago, {direction}); "
                f"{long_sign}{long_delta} pts over {len(history)} runs / {span_days}d"
            )

    return f"{sign}{delta} pts in {days_diff} days ({direction})"


init_db()


def get_chroma_collection(path: str | None = None, collection_name: str = "finsight_reports"):
    """Return a persistent Chroma collection or None if chromadb is unavailable."""
    try:
        import chromadb
        from chromadb.utils import embedding_functions
    except Exception:
        return None

    db_path = path or CHROMA_PATH
    try:
        client = chromadb.PersistentClient(path=db_path)
        ef = embedding_functions.DefaultEmbeddingFunction()
        coll = client.get_or_create_collection(
            name=collection_name,
            embedding_function=ef,
            metadata={"hnsw:space": "cosine"},
        )
        return coll
    except Exception:
        return None


def chroma_store_report(ticker: str, risk_report: dict, path: str | None = None) -> bool:
    """Store a short summary + embedding for `risk_report` in ChromaDB. Returns True on success."""
    coll = get_chroma_collection(path)
    if coll is None:
        return False
    try:
        # richer document + metadata for semantic search and filtering
        run_at = datetime.utcnow().isoformat()
        summary = (
            risk_report.get("summary")
            or f"{ticker} {risk_report.get('recommendation', '')} {risk_report.get('composite_score', '')}"
        )
        metadata = {
            "ticker": ticker,
            "risk_level": risk_report.get("risk_level"),
            "composite_score": risk_report.get("composite_score"),
            "recommendation": risk_report.get("recommendation"),
            "data_quality": risk_report.get("data_quality"),
            "dominant_theme": risk_report.get("dominant_theme"),
            "run_at": run_at,
        }
        # keep documents concise to speed embedding
        text = (summary[:1200]) if summary else f"{ticker} summary"
        coll.add(
            documents=[text],
            metadatas=[metadata],
            ids=[f"{ticker}-{int(datetime.utcnow().timestamp())}"],
        )
        return True
    except Exception:
        return False


def chroma_search(query: str, n_results: int = 5, path: str | None = None) -> list[dict]:
    coll = get_chroma_collection(path)
    if coll is None:
        return []
    try:
        results = coll.query(query_texts=[query], n_results=n_results)
        hits = []
        for idx, doc in enumerate(results.get("documents", [[]])[0]):
            hits.append({
                "document": doc,
                "metadata": results.get("metadatas", [[]])[0][idx],
                "distance": results.get("distances", [[]])[0][idx] if results.get("distances") else None,
            })
        return hits
    except Exception:
        return []
