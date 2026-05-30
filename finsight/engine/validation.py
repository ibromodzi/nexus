from __future__ import annotations

import json
import re
from typing import Any

from pydantic import BaseModel

from finsight.config import Settings
from finsight.engine.cost import CostTracker
from finsight.engine.models import HallucinationReport, ValidationResult
from finsight.engine.scoring import compute_composite_score
from finsight.llm.client import call_llm_json


TOLERANCE_PCT = 0.02


def deterministic_hallucination_check(
    risk_report: dict,
    market_data: dict,
    iv_data: dict,
    fundamentals_data: dict,
    news_sentiment_data: dict,
    macro_data: dict,
) -> ValidationResult:
    flags: list[str] = []
    md = market_data.get("data", {})
    iv = iv_data.get("data", {})
    fund = fundamentals_data.get("data", {})
    news = news_sentiment_data.get("data", {})
    macro = macro_data.get("data", {})

    price = md.get("current_price") or 1
    high = md.get("52_week_high", price)
    low = md.get("52_week_low", price)
    expected_vol = round((high - low) / price * 100, 2) if price else None

    reported_vol = risk_report.get("volatility_pct")
    if expected_vol is not None and reported_vol is not None:
        rel_err = abs(float(reported_vol) - expected_vol) / (abs(expected_vol) + 1e-9)
        if rel_err > TOLERANCE_PCT:
            flags.append(
                f"volatility_pct mismatch: report={reported_vol}, "
                f"recomputed={expected_vol} (err={rel_err:.1%})"
            )

    expected_composite = compute_composite_score(
        expected_vol if expected_vol is not None else float(reported_vol or 0),
        iv.get("iv_annualised_pct"),
        fund.get("debt_to_equity"),
        news.get("sentiment_score"),
        macro.get("market_regime"),
    )
    reported_composite = risk_report.get("composite_score")
    if reported_composite is not None:
        rel_err = abs(float(reported_composite) - expected_composite) / (
            abs(expected_composite) + 1e-9
        )
        if rel_err > TOLERANCE_PCT:
            flags.append(
                f"composite_score mismatch: report={reported_composite}, "
                f"recomputed={expected_composite} (err={rel_err:.1%})"
            )

    _check_exact_numeric(flags, "sentiment_score", risk_report, news)
    _check_exact_numeric(flags, "debt_to_equity", risk_report, fund)

    passed = not flags
    return ValidationResult(
        deterministic_check_passed=passed,
        deterministic_flags=flags,
        has_hallucination=not passed,
        flagged_claims=flags.copy(),
    )


def qualitative_hallucination_check(
    state: dict,
    settings: Settings,
    cost: CostTracker,
) -> dict[str, Any]:
    if cost.budget_exceeded or not settings.groq_api_key:
        return {
            "has_hallucination": False,
            "flagged_claims": [],
            "confidence": "high",
        }

    system = "You are a fact-checking auditor for AI-generated financial risk reports."
    user = f"""
Review the following risk report and the contextual data sources.

Risk report:
{json.dumps(state.get('risk_report', {}), indent=2)}

Market data:
{json.dumps(state.get('market_data', {}).get('data', {}), indent=2)}

Options IV data:
{json.dumps(state.get('iv_data', {}).get('data', {}), indent=2)}

Fundamentals:
{json.dumps(state.get('fundamentals_data', {}).get('data', {}), indent=2)}

News sentiment:
{json.dumps(state.get('news_sentiment_data', {}).get('data', {}), indent=2)}

Macro context:
{json.dumps(state.get('macro_data', {}).get('data', {}), indent=2)}

Return JSON with the following fields:
{{
  "has_hallucination": <true|false>,
  "flagged_claims": ["<claim1>", "<claim2>"],
  "confidence": "high|medium|low"
}}
Do not return any extra text or markdown formatting.
"""
    result = call_llm_json(system, user, HallucinationReport, settings, cost)
    return {
        "has_hallucination": result.get("has_hallucination", False),
        "flagged_claims": result.get("flagged_claims", []),
        "confidence": result.get("confidence", "high"),
    }


def _check_exact_numeric(
    flags: list[str], field_name: str, report: dict, source: dict
) -> None:
    reported = report.get(field_name)
    expected = source.get(field_name)
    if reported is None or expected is None:
        return
    rel_err = abs(float(reported) - float(expected)) / (abs(float(expected)) + 1e-9)
    if rel_err > TOLERANCE_PCT:
        flags.append(
            f"{field_name} mismatch: report={reported}, tool={expected} "
            f"(err={rel_err:.1%})"
        )
