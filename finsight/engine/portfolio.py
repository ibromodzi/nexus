"""Portfolio mode — parallel fan-out + cross-ticker synthesis.

Faithfully ported from Section 11 of the FinSight v2 Enhanced notebook.
"""
from __future__ import annotations

import concurrent.futures
import json
import time
from typing import Any

from finsight.config import Settings
from finsight.engine.models import PortfolioSynthesis
from finsight.engine.pipeline import run_finsight_analysis
from finsight.llm.client import call_llm_json, get_llm_client


def run_portfolio(
    tickers: list[str],
    settings: Settings | None = None,
    max_workers: int = 3,
) -> dict[str, Any]:
    """
    Run the FinSight pipeline for each ticker in parallel, then synthesise a
    portfolio-level correlation/concentration report.

    Returns:
        {
            "ticker_results":        { ticker: RiskAnalysisResult | None },
            "portfolio_synthesis":   PortfolioSynthesis dict,
            "portfolio_summary_text": str,
        }
    """
    settings = settings or Settings()
    print(f"\n{'='*55}")
    print(f"  FinSight v2 Portfolio Mode — {tickers}")
    print(f"{'='*55}")

    ticker_results: dict[str, Any] = {}

    def run_single(ticker: str):
        t0 = time.time()
        try:
            result = run_finsight_analysis(ticker, settings)
            elapsed = time.time() - t0
            rr = result.risk_report
            print(
                f"  ✓ {ticker} done in {elapsed:.1f}s | "
                f"composite={rr.composite_score if rr else 'N/A'} | "
                f"{rr.risk_level if rr else 'N/A'}"
            )
            return ticker, result
        except Exception as exc:
            print(f"  ✗ {ticker} failed: {exc}")
            return ticker, None

    with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {executor.submit(run_single, t): t for t in tickers}
        for future in concurrent.futures.as_completed(futures):
            ticker, result = future.result()
            ticker_results[ticker] = result

    # ── Portfolio synthesis pass ──────────────────────────────────────────
    ticker_summaries = []
    for t, result in ticker_results.items():
        if result is None:
            ticker_summaries.append(f"{t}: [pipeline error — no data]")
            continue
        rr = result.risk_report
        market = result.provider_payloads.get("market_data")
        sector = market.data.get("sector", "N/A") if market else "N/A"
        ticker_summaries.append(
            f"{t}: risk_level={rr.risk_level if rr else 'N/A'}, "
            f"composite={rr.composite_score if rr else 'N/A'}, "
            f"recommendation={rr.recommendation if rr else 'N/A'}, "
            f"sector={sector}, "
            f"market_regime={rr.market_regime if rr else 'N/A'}, "
            f"sentiment={rr.sentiment_score if rr else 'N/A'}, "
            f"trend={rr.composite_trend if rr else 'N/A'}"
        )

    print("\n  [portfolio] Running cross-ticker synthesis...")
    synthesis: dict = {}
    try:
        if settings.groq_api_key:
            llm = get_llm_client(settings)
            from finsight.engine.cost import CostTracker
            cost = CostTracker(settings.cost_budget_usd)
            system = "You are a portfolio risk analyst. Synthesise risk signals across multiple holdings."
            user = f"""
Portfolio holdings analysis:
{chr(10).join(ticker_summaries)}

Identify:
1. concentration_warnings: sector or regime concentration alerts (list of strings)
2. overall_portfolio_risk: aggregate risk level ('low', 'moderate', or 'high')
3. correlation_notes: key observations about how these holdings may move together
4. portfolio_summary: two-sentence portfolio-level risk assessment and action item

Return JSON: {{
  "concentration_warnings": [...],
  "overall_portfolio_risk": "low|moderate|high",
  "correlation_notes": "...",
  "portfolio_summary": "..."
}}
"""
            synthesis = call_llm_json(system, user, PortfolioSynthesis, settings, cost) or {}
    except Exception as exc:
        print(f"  ⚠ Portfolio synthesis failed: {exc}")

    if not synthesis:
        synthesis = {
            "concentration_warnings": [],
            "overall_portfolio_risk": "moderate",
            "correlation_notes": "Synthesis unavailable — no Groq API key or call failed.",
            "portfolio_summary": f"Portfolio of {len(tickers)} tickers analyzed. Manual review recommended.",
        }

    # ── Format portfolio summary text ────────────────────────────────────
    risk_emoji = {"low": "🟢", "moderate": "🟡", "high": "🔴"}.get(
        synthesis.get("overall_portfolio_risk", ""), "⚪"
    )
    lines = [
        f"\nFinSight v2 Portfolio Analysis",
        "=" * 55,
        f"Holdings:          {', '.join(tickers)}",
        f"Overall Risk:      {risk_emoji} {synthesis.get('overall_portfolio_risk', '').upper()}",
        "",
        "Concentration Warnings",
        "-" * 40,
    ]
    for w in synthesis.get("concentration_warnings", []):
        lines.append(f"  • {w}")
    if not synthesis.get("concentration_warnings"):
        lines.append("  None detected.")
    lines += [
        "",
        "Correlation Notes",
        "-" * 40,
        synthesis.get("correlation_notes", "N/A"),
        "",
        "Portfolio Summary",
        "-" * 40,
        synthesis.get("portfolio_summary", "N/A"),
        "",
        "Individual Holdings",
        "-" * 40,
    ]
    for t, result in ticker_results.items():
        if result and result.risk_report:
            rr = result.risk_report
            e = {"low": "🟢", "moderate": "🟡", "high": "🔴"}.get(rr.risk_level, "⚪")
            lines.append(
                f"  {t}: {e} {rr.risk_level.upper()} | "
                f"score={rr.composite_score} | "
                f"{rr.recommendation.upper()} | "
                f"trend={rr.composite_trend or 'N/A'}"
            )
        else:
            lines.append(f"  {t}: ✗ error")

    portfolio_text = "\n".join(lines)
    print(portfolio_text)

    return {
        "ticker_results": {
            t: result.model_dump() if result else None
            for t, result in ticker_results.items()
        },
        "portfolio_synthesis": synthesis,
        "portfolio_summary_text": portfolio_text,
        "tickers": tickers,
    }