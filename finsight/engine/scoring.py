# from __future__ import annotations


# def compute_composite_score(
#     volatility_pct: float,
#     implied_vol_pct: float | None,
#     debt_to_equity: float | None,
#     sentiment_score: float | None,
#     market_regime: str | None,
# ) -> float:
#     weights = {
#         "hist_vol": 0.30,
#         "impl_vol": 0.25,
#         "leverage": 0.20,
#         "sentiment": 0.15,
#         "macro": 0.10,
#     }
#     hist_component = min(volatility_pct / 2.0, 100)
#     iv_component = min(implied_vol_pct or 30.0, 100)
#     leverage_component = min(debt_to_equity or 1.0, 5) / 5 * 100
#     sentiment_component = (-(sentiment_score or 0.0)) * 50 + 50
#     macro_component = {"risk-off": 20, "neutral": 10, "risk-on": 0}.get(
#         market_regime or "neutral", 10
#     )
#     score = (
#         weights["hist_vol"] * hist_component
#         + weights["impl_vol"] * iv_component
#         + weights["leverage"] * leverage_component
#         + weights["sentiment"] * sentiment_component
#         + weights["macro"] * macro_component
#     )
#     return round(min(score, 100), 2)


# def score_breakdown(
#     volatility_pct: float,
#     implied_vol_pct: float | None,
#     debt_to_equity: float | None,
#     sentiment_score: float | None,
#     market_regime: str | None,
# ) -> list[dict[str, object]]:
#     factors = [
#         {
#             "key": "historical_volatility",
#             "label": "Historical Volatility",
#             "raw_value": volatility_pct,
#             "display_value": f"{volatility_pct:.2f}%",
#             "normalized_risk": min(volatility_pct / 2.0, 100),
#             "weight": 0.30,
#             "status": "actual",
#             "source": "Yahoo Finance",
#         },
#         {
#             "key": "implied_volatility",
#             "label": "Implied Volatility",
#             "raw_value": implied_vol_pct,
#             "display_value": f"{implied_vol_pct:.2f}%" if implied_vol_pct is not None else "N/A",
#             "normalized_risk": min(implied_vol_pct or 30.0, 100),
#             "weight": 0.25,
#             "status": "actual" if implied_vol_pct is not None else "defaulted",
#             "source": "Yahoo Finance Options",
#         },
#         {
#             "key": "leverage",
#             "label": "Leverage",
#             "raw_value": debt_to_equity,
#             "display_value": f"{debt_to_equity:.4f}" if debt_to_equity is not None else "N/A",
#             "normalized_risk": min(debt_to_equity or 1.0, 5) / 5 * 100,
#             "weight": 0.20,
#             "status": "actual" if debt_to_equity is not None else "defaulted",
#             "source": "SEC EDGAR / Yahoo Finance",
#         },
#         {
#             "key": "sentiment",
#             "label": "Sentiment",
#             "raw_value": sentiment_score,
#             "display_value": f"{sentiment_score:.4f}" if sentiment_score is not None else "N/A",
#             "normalized_risk": (-(sentiment_score or 0.0)) * 50 + 50,
#             "weight": 0.15,
#             "status": "actual" if sentiment_score is not None else "defaulted",
#             "source": "GNews",
#         },
#         {
#             "key": "macro_regime",
#             "label": "Macro Regime",
#             "raw_value": market_regime,
#             "display_value": market_regime or "Neutral default",
#             "normalized_risk": {"risk-off": 20, "neutral": 10, "risk-on": 0}.get(
#                 market_regime or "neutral", 10
#             ),
#             "weight": 0.10,
#             "status": "actual" if market_regime is not None else "defaulted",
#             "source": "Yahoo Finance Macro",
#         },
#     ]
#     for factor in factors:
#         factor["contribution"] = round(
#             float(factor["normalized_risk"]) * float(factor["weight"]), 2
#         )
#         factor["weight_pct"] = round(float(factor["weight"]) * 100)
#     return factors


# def risk_level_from_score(score: float) -> str:
#     if score < 30:
#         return "low"
#     if score <= 60:
#         return "moderate"
#     return "high"


# def recommendation_from_score(score: float) -> str:
#     if score < 30:
#         return "monitor"
#     if score <= 60:
#         return "review"
#     if score < 80:
#         return "elevated_risk"
#     return "high_risk_watch"


from __future__ import annotations


def compute_composite_score(
    volatility_pct: float,
    implied_vol_pct: float | None,
    debt_to_equity: float | None,
    sentiment_score: float | None,
    market_regime: str | None,
) -> float:
    weights = {
        "hist_vol": 0.30,
        "impl_vol": 0.25,
        "leverage": 0.20,
        "sentiment": 0.15,
        "macro": 0.10,
    }
    hist_component = min(volatility_pct / 2.0, 100)
    iv_component = min(implied_vol_pct or 30.0, 100)
    leverage_component = min(debt_to_equity or 1.0, 5) / 5 * 100
    sentiment_component = (-(sentiment_score or 0.0)) * 50 + 50
    macro_component = {"risk-off": 20, "neutral": 10, "risk-on": 0}.get(
        market_regime or "neutral", 10
    )
    score = (
        weights["hist_vol"] * hist_component
        + weights["impl_vol"] * iv_component
        + weights["leverage"] * leverage_component
        + weights["sentiment"] * sentiment_component
        + weights["macro"] * macro_component
    )
    return round(min(score, 100), 2)


def score_breakdown(
    volatility_pct: float,
    implied_vol_pct: float | None,
    debt_to_equity: float | None,
    sentiment_score: float | None,
    market_regime: str | None,
) -> list[dict[str, object]]:
    factors = [
        {
            "key": "historical_volatility",
            "label": "Historical Volatility",
            "raw_value": volatility_pct,
            "display_value": f"{volatility_pct:.2f}%",
            "normalized_risk": min(volatility_pct / 2.0, 100),
            "weight": 0.30,
            "status": "actual",
            "source": "Yahoo Finance",
        },
        {
            "key": "implied_volatility",
            "label": "Implied Volatility",
            "raw_value": implied_vol_pct,
            "display_value": f"{implied_vol_pct:.2f}%" if implied_vol_pct is not None else "N/A",
            "normalized_risk": min(implied_vol_pct or 30.0, 100),
            "weight": 0.25,
            "status": "actual" if implied_vol_pct is not None else "defaulted",
            "source": "Yahoo Finance Options",
        },
        {
            "key": "leverage",
            "label": "Leverage",
            "raw_value": debt_to_equity,
            "display_value": f"{debt_to_equity:.4f}" if debt_to_equity is not None else "N/A",
            "normalized_risk": min(debt_to_equity or 1.0, 5) / 5 * 100,
            "weight": 0.20,
            "status": "actual" if debt_to_equity is not None else "defaulted",
            "source": "SEC EDGAR / Yahoo Finance",
        },
        {
            "key": "sentiment",
            "label": "Sentiment",
            "raw_value": sentiment_score,
            "display_value": f"{sentiment_score:.4f}" if sentiment_score is not None else "N/A",
            "normalized_risk": (-(sentiment_score or 0.0)) * 50 + 50,
            "weight": 0.15,
            "status": "actual" if sentiment_score is not None else "defaulted",
            "source": "GNews",
        },
        {
            "key": "macro_regime",
            "label": "Macro Regime",
            "raw_value": market_regime,
            "display_value": market_regime or "Neutral default",
            "normalized_risk": {"risk-off": 20, "neutral": 10, "risk-on": 0}.get(
                market_regime or "neutral", 10
            ),
            "weight": 0.10,
            "status": "actual" if market_regime is not None else "defaulted",
            "source": "Yahoo Finance Macro",
        },
    ]
    for factor in factors:
        factor["contribution"] = round(
            float(factor["normalized_risk"]) * float(factor["weight"]), 2
        )
        factor["weight_pct"] = round(float(factor["weight"]) * 100)
    return factors


def risk_level_from_score(score: float) -> str:
    if score < 30:
        return "low"
    if score <= 60:
        return "moderate"
    return "high"


def recommendation_from_score(score: float) -> str:
    if score < 30:
        return "hold"
    if score <= 60:
        return "watch"
    return "avoid"