from __future__ import annotations

import os
import tempfile
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from finsight import run_finsight_analysis
from finsight.config import Settings
from finsight.engine.persistence import chroma_search


APP_DIR = Path(__file__).resolve().parent
STATIC_DIR = APP_DIR / "static"

app = FastAPI(title="FinSight API", version="0.2.0")
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


# ── Static ─────────────────────────────────────────────────────────────────
@app.get("/")
def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


# ── Health ─────────────────────────────────────────────────────────────────
@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


# ── Single ticker analysis ─────────────────────────────────────────────────
@app.get("/api/analyze/{ticker}")
def analyze_ticker(ticker: str) -> dict:
    cleaned = ticker.upper().strip()
    if not cleaned or len(cleaned) > 12:
        raise HTTPException(status_code=400, detail="Ticker must be 1–12 characters.")
    result = run_finsight_analysis(cleaned)
    return result.model_dump(mode="json")


# ── Portfolio analysis ─────────────────────────────────────────────────────
class PortfolioRequest(BaseModel):
    tickers: list[str]


@app.post("/api/portfolio")
def portfolio(body: PortfolioRequest) -> dict:
    tickers = [t.strip().upper() for t in body.tickers if t.strip()]
    if not tickers:
        raise HTTPException(status_code=400, detail="tickers must be a non-empty list.")
    if len(tickers) > 10:
        raise HTTPException(status_code=400, detail="Maximum 10 tickers per portfolio request.")
    try:
        from finsight.engine.portfolio import run_portfolio
        settings = Settings()
        return run_portfolio(tickers, settings=settings)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


# ── PDF export ─────────────────────────────────────────────────────────────
@app.get("/api/export/pdf/{ticker}")
def export_pdf_route(ticker: str):
    cleaned = ticker.upper().strip()
    if not cleaned or len(cleaned) > 12:
        raise HTTPException(status_code=400, detail="Invalid ticker.")
    try:
        from finsight.reports.pdf_export import export_pdf
        settings = Settings()
        result = run_finsight_analysis(cleaned, settings)
        result_dict = result.model_dump(mode="json")

        tmp_fd, tmp_path = tempfile.mkstemp(suffix=".pdf")
        os.close(tmp_fd)
        export_pdf(result_dict, output_path=tmp_path)

        def iterfile():
            try:
                with open(tmp_path, "rb") as f:
                    yield from f
            finally:
                try:
                    os.unlink(tmp_path)
                except Exception:
                    pass

        return StreamingResponse(
            iterfile(),
            media_type="application/pdf",
            headers={"Content-Disposition": f"attachment; filename=finsight-{cleaned}.pdf"},
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


# ── Semantic search (ChromaDB) ─────────────────────────────────────────────
@app.get("/api/search")
def semantic_search(q: str, n: int = 5) -> dict:
    if not q.strip():
        raise HTTPException(status_code=400, detail="q parameter is required.")
    n = min(n, 20)
    try:
        hits = chroma_search(q.strip(), n_results=n)
        return {"query": q, "results": hits}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))