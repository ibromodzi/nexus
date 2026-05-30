# from __future__ import annotations

# from datetime import datetime, timedelta

# import httpx

# from finsight.config import Settings
# from finsight.engine.cost import CostTracker
# from finsight.engine.models import HeadlineClassification, ProviderPayload
# from finsight.llm.client import call_llm_json


# def get_news_sentiment(
#     ticker: str,
#     settings: Settings,
#     cost: CostTracker | None = None,
# ) -> ProviderPayload:
#     cost = cost or CostTracker(settings.cost_budget_usd)
#     if not settings.gnews_api_key:
#         return ProviderPayload(
#             status="skipped", error_message="GNEWS_API_KEY not set; sentiment skipped."
#         )
#     try:
#         from_date = (datetime.utcnow() - timedelta(days=7)).strftime("%Y-%m-%dT%H:%M:%SZ")
#         url = (
#             "https://gnews.io/api/v4/search?"
#             f"q={ticker}&lang=en&max=10&from={from_date}&apikey={settings.gnews_api_key}"
#         )
#         response = httpx.get(url, timeout=10)
#         response.raise_for_status()
#         articles = response.json().get("articles", [])
#         headlines = [article["title"] for article in articles if article.get("title")]
#         classifications: list[dict] = []
#         scores: list[float] = []
#         label_counts: dict[str, int] = {}
#         dominant_label = "noise"
#         method = "lexicon"

#         if settings.groq_api_key and headlines:
#             classifications = [
#                 _classify_headline_groq(headline, settings, cost) for headline in headlines
#             ]
#             scores = [LABEL_SCORES.get(cls["label"], 0.0) for cls in classifications]
#             for cls in classifications:
#                 label_counts[cls["label"]] = label_counts.get(cls["label"], 0) + 1
#             dominant_label = (
#                 max(label_counts, key=label_counts.get) if label_counts else "noise"
#             )
#             method = "groq_semantic"
#         else:
#             from textblob import TextBlob

#             classifications = [
#                 {"label": "noise", "confidence": "low", "reason": "textblob"}
#                 for _ in headlines
#             ]
#             scores = [TextBlob(headline).sentiment.polarity for headline in headlines]
#             dominant_label = "noise"

#         avg_score = sum(scores) / len(scores) if scores else 0.0
#         return ProviderPayload(
#             status="success",
#             data={
#                 "ticker": ticker.upper(),
#                 "headline_count": len(headlines),
#                 "headlines": headlines,
#                 "classifications": classifications[:10],
#                 "sentiment_score": round(avg_score, 4),
#                 "dominant_label": dominant_label,
#                 "label_counts": label_counts,
#                 "sentiment_label": (
#                     "positive"
#                     if avg_score > 0.1
#                     else "negative"
#                     if avg_score < -0.1
#                     else "neutral"
#                 ),
#                 "method": method,
#                 "source_count": len(
#                     {article.get("source", {}).get("name") for article in articles}
#                 ),
#             },
#         )
#     except Exception as exc:
#         return ProviderPayload(status="error", error_message=str(exc))


# LABEL_SCORES = {
#     "catalyst_positive": +1.0,
#     "catalyst_negative": -1.0,
#     "regulatory_risk": -0.6,
#     "noise": 0.0,
# }


# def _classify_headline_groq(
#     headline: str, settings: Settings, cost: CostTracker | None = None
# ) -> dict:
#     cost = cost or CostTracker(settings.cost_budget_usd)
#     system = (
#         "You are a financial headline classifier. "
#         "Classify each headline as exactly one of: "
#         "catalyst_positive, catalyst_negative, noise, regulatory_risk. "
#         "catalyst_positive = concrete positive event (earnings beat, deal, upgrade). "
#         "catalyst_negative = concrete negative event (miss, downgrade, legal loss). "
#         "regulatory_risk = regulatory, legal, or compliance risk. "
#         "noise = generic mentions with no directional signal. "
#         "Respond ONLY with valid JSON: {\"label\": str, \"confidence\": str, \"reason\": str}"
#     )
#     result = call_llm_json(system, f"Headline: {headline}", HeadlineClassification, settings, cost)
#     if not result or result.get("label") not in LABEL_SCORES:
#         return {"label": "noise", "confidence": "low", "reason": "groq_error"}
#     return result


# POSITIVE_TERMS = {
#     "beat",
#     "beats",
#     "upgrade",
#     "upgraded",
#     "growth",
#     "surge",
#     "rises",
#     "record",
#     "profit",
#     "strong",
#     "raises",
#     "partnership",
#     "approval",
# }

# NEGATIVE_TERMS = {
#     "miss",
#     "misses",
#     "downgrade",
#     "downgraded",
#     "falls",
#     "drop",
#     "drops",
#     "lawsuit",
#     "probe",
#     "investigation",
#     "loss",
#     "weak",
#     "cuts",
#     "warning",
#     "recall",
# }


# def _headline_score(headline: str) -> float:
#     words = {word.strip(".,:;!?()[]{}'\"").lower() for word in headline.split()}
#     positive = len(words & POSITIVE_TERMS)
#     negative = len(words & NEGATIVE_TERMS)
#     if positive == negative:
#         return 0.0
#     return max(min((positive - negative) / 3, 1.0), -1.0)


from __future__ import annotations

from datetime import datetime, timedelta

import httpx

from finsight.config import Settings
from finsight.engine.cost import CostTracker
from finsight.engine.models import HeadlineClassification, ProviderPayload
from finsight.llm.client import call_llm_json


def get_news_sentiment(
    ticker: str,
    settings: Settings,
    cost: CostTracker | None = None,
    llm: object | None = None,
) -> ProviderPayload:
    cost = cost or CostTracker(settings.cost_budget_usd)
    if not settings.gnews_api_key:
        return ProviderPayload(
            status="skipped", error_message="GNEWS_API_KEY not set; sentiment skipped."
        )
    try:
        from_date = (datetime.utcnow() - timedelta(days=7)).strftime("%Y-%m-%dT%H:%M:%SZ")
        url = (
            "https://gnews.io/api/v4/search?"
            f"q={ticker}&lang=en&max=10&from={from_date}&apikey={settings.gnews_api_key}"
        )
        response = httpx.get(url, timeout=10)
        response.raise_for_status()
        articles = response.json().get("articles", [])
        headlines = [article["title"] for article in articles if article.get("title")]
        classifications: list[dict] = []
        scores: list[float] = []
        label_counts: dict[str, int] = {}
        dominant_label = "noise"
        method = "lexicon"

        if settings.groq_api_key and headlines:
            classifications = [
                _classify_headline_groq(headline, settings, cost, llm) for headline in headlines
            ]
            scores = [LABEL_SCORES.get(cls["label"], 0.0) for cls in classifications]
            for cls in classifications:
                label_counts[cls["label"]] = label_counts.get(cls["label"], 0) + 1
            dominant_label = (
                max(label_counts, key=label_counts.get) if label_counts else "noise"
            )
            method = "groq_semantic"
        else:
            from textblob import TextBlob

            classifications = [
                {"label": "noise", "confidence": "low", "reason": "textblob"}
                for _ in headlines
            ]
            scores = [TextBlob(headline).sentiment.polarity for headline in headlines]
            dominant_label = "noise"

        avg_score = sum(scores) / len(scores) if scores else 0.0
        return ProviderPayload(
            status="success",
            data={
                "ticker": ticker.upper(),
                "headline_count": len(headlines),
                "headlines": headlines,
                "classifications": classifications[:10],
                "sentiment_score": round(avg_score, 4),
                "dominant_label": dominant_label,
                "label_counts": label_counts,
                "sentiment_label": (
                    "positive"
                    if avg_score > 0.1
                    else "negative"
                    if avg_score < -0.1
                    else "neutral"
                ),
                "method": method,
                "source_count": len(
                    {article.get("source", {}).get("name") for article in articles}
                ),
            },
        )
    except Exception as exc:
        return ProviderPayload(status="error", error_message=str(exc))


LABEL_SCORES = {
    "catalyst_positive": +1.0,
    "catalyst_negative": -1.0,
    "regulatory_risk": -0.6,
    "noise": 0.0,
}


def _classify_headline_groq(
    headline: str, settings: Settings, cost: CostTracker | None = None, llm: object | None = None,
) -> dict:
    cost = cost or CostTracker(settings.cost_budget_usd)
    system = (
        "You are a financial headline classifier. "
        "Classify each headline as exactly one of: "
        "catalyst_positive, catalyst_negative, noise, regulatory_risk. "
        "catalyst_positive = concrete positive event (earnings beat, deal, upgrade). "
        "catalyst_negative = concrete negative event (miss, downgrade, legal loss). "
        "regulatory_risk = regulatory, legal, or compliance risk. "
        "noise = generic mentions with no directional signal. "
        "Respond ONLY with valid JSON: {\"label\": str, \"confidence\": str, \"reason\": str}"
    )
    result = call_llm_json(system, f"Headline: {headline}", HeadlineClassification, settings, cost)
    if not result or result.get("label") not in LABEL_SCORES:
        return {"label": "noise", "confidence": "low", "reason": "groq_error"}
    return result


POSITIVE_TERMS = {
    "beat",
    "beats",
    "upgrade",
    "upgraded",
    "growth",
    "surge",
    "rises",
    "record",
    "profit",
    "strong",
    "raises",
    "partnership",
    "approval",
}

NEGATIVE_TERMS = {
    "miss",
    "misses",
    "downgrade",
    "downgraded",
    "falls",
    "drop",
    "drops",
    "lawsuit",
    "probe",
    "investigation",
    "loss",
    "weak",
    "cuts",
    "warning",
    "recall",
}


def _headline_score(headline: str) -> float:
    words = {word.strip(".,:;!?()[]{}'\"").lower() for word in headline.split()}
    positive = len(words & POSITIVE_TERMS)
    negative = len(words & NEGATIVE_TERMS)
    if positive == negative:
        return 0.0
    return max(min((positive - negative) / 3, 1.0), -1.0)