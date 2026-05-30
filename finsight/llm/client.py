# from __future__ import annotations

# import json
# import re

# from pydantic import BaseModel

# from finsight.config import Settings
# from finsight.engine.cost import CostTracker


# def call_llm_json(
#     system: str,
#     user: str,
#     schema_class: type[BaseModel],
#     settings: Settings,
#     cost: CostTracker,
# ) -> dict:
#     if cost.budget_exceeded or not settings.groq_api_key:
#         return {}

#     from langchain_core.messages import HumanMessage, SystemMessage
#     from langchain_groq import ChatGroq

#     llm = ChatGroq(
#         model=settings.groq_model,
#         api_key=settings.groq_api_key,
#         temperature=0.1,
#     )
#     messages = [
#         SystemMessage(
#             content=system
#             + "\n\nRespond ONLY with valid JSON. No markdown fences, no explanation."
#         ),
#         HumanMessage(content=user),
#     ]
#     response = llm.invoke(messages)
#     usage = getattr(response, "usage_metadata", None)
#     if usage:
#         cost.record(usage.get("input_tokens", 0), usage.get("output_tokens", 0))

#     raw = response.content.strip()
#     raw = re.sub(r"^```(?:json)?\n?", "", raw)
#     raw = re.sub(r"\n?```$", "", raw)
#     parsed = json.loads(raw)
#     return schema_class(**parsed).model_dump()

# """
# Patch to add to finsight/llm/client.py — add this function alongside call_llm_json.

# get_llm_client() returns a ChatGroq instance (or None) that can be passed
# into node_collect_data → get_news_sentiment for Groq semantic headline classification,
# matching the notebook's pattern of passing `llm` directly into tool functions.
# """



# def get_llm_client(settings: Settings) -> object | None:
#     """
#     Return a ChatGroq LLM client if groq_api_key is set, else None.
#     Used to pass a shared client into tool functions (e.g. get_news_sentiment)
#     so they can call the LLM directly without going through call_llm_json.
#     """
#     if not settings.groq_api_key:
#         return None
#     try:
#         from langchain_groq import ChatGroq
#         return ChatGroq(
#             model=getattr(settings, "groq_model", "llama-3.3-70b-versatile"),
#             api_key=settings.groq_api_key,
#             temperature=0.1,
#         )
#     except Exception:
#         return None

from __future__ import annotations

import difflib
import json
import logging
import re

from pydantic import BaseModel

from finsight.config import Settings
from finsight.engine.cost import CostTracker

logger = logging.getLogger(__name__)

# Common LLM synonyms → canonical Pydantic Literal values.
# Extend this table if new synonyms surface; never touch the schema.
_SYNONYMS: dict[str, str] = {
    # data_quality
    "complete": "full",
    "good":     "full",
    # risk_level
    "medium":   "moderate",
    "med":      "moderate",
    "elevated": "high",
    "severe":   "high",
    "critical": "high",
    "safe":     "low",
    # recommendation
    "buy":     "hold",
    "sell":    "avoid",
    "neutral": "hold",
    "monitor": "watch",
}


def _literal_fields(schema_class: type[BaseModel]) -> dict[str, list[str]]:
    """Return {field_name: [allowed_literals]} for every Literal/enum field."""
    schema = schema_class.model_json_schema()
    defs = schema.get("$defs", {})
    result: dict[str, list[str]] = {}

    def _resolve(sub: dict) -> list[str] | None:
        if "enum" in sub:
            return [v for v in sub["enum"] if isinstance(v, str)]
        ref = sub.get("$ref", "")
        if ref.startswith("#/$defs/"):
            return _resolve(defs.get(ref[len("#/$defs/"):], {}))
        for key in ("anyOf", "oneOf"):
            for variant in sub.get(key, []):
                vals = _resolve(variant)
                if vals:
                    return vals
        return None

    for field, field_schema in schema.get("properties", {}).items():
        vals = _resolve(field_schema)
        if vals:
            result[field] = vals
    return result


def _normalise_enums(data: dict, schema_class: type[BaseModel]) -> dict:
    """
    Before Pydantic validation, fix any enum field whose value is a known
    LLM synonym.  Resolution order:
      1. already valid → leave it alone
      2. case-insensitive exact match against allowed values
      3. synonym table lookup
      4. difflib closest match (cutoff 0.6)
    Logs a warning for every remapping so mismatches are visible.
    """
    try:
        literals = _literal_fields(schema_class)
    except Exception:
        return data  # can't introspect; let Pydantic surface the error naturally

    out = dict(data)
    for field, allowed in literals.items():
        raw = out.get(field)
        if not isinstance(raw, str) or raw in allowed:
            continue

        lower_map = {v.lower(): v for v in allowed}
        synonym_hit = _SYNONYMS.get(raw.lower())

        fixed = (
            lower_map.get(raw.lower())                                   # 1. case-insensitive
            or (synonym_hit if synonym_hit in allowed else None)         # 2. synonym table
        )
        if fixed is None:                                                # 3. fuzzy
            matches = difflib.get_close_matches(raw.lower(), lower_map, n=1, cutoff=0.6)
            fixed = lower_map[matches[0]] if matches else None

        if fixed:
            logger.warning(
                "LLM enum mismatch: %s=%r → remapped to %r (allowed: %s)",
                field, raw, fixed, allowed,
            )
            out[field] = fixed
        else:
            logger.error(
                "LLM enum mismatch: %s=%r cannot be remapped to any of %s — Pydantic will reject",
                field, raw, allowed,
            )

    return out


def call_llm_json(
    system: str,
    user: str,
    schema_class: type[BaseModel],
    settings: Settings,
    cost: CostTracker,
) -> dict:
    if cost.budget_exceeded or not settings.groq_api_key:
        return {}

    from langchain_core.messages import HumanMessage, SystemMessage
    from langchain_groq import ChatGroq

    llm = ChatGroq(
        model=settings.groq_model,
        api_key=settings.groq_api_key,
        temperature=0.1,
    )
    messages = [
        SystemMessage(
            content=system
            + "\n\nRespond ONLY with valid JSON. No markdown fences, no explanation."
        ),
        HumanMessage(content=user),
    ]
    response = llm.invoke(messages)
    usage = getattr(response, "usage_metadata", None)
    if usage:
        cost.record(usage.get("input_tokens", 0), usage.get("output_tokens", 0))

    raw = response.content.strip()
    raw = re.sub(r"^```(?:json)?\n?", "", raw)
    raw = re.sub(r"\n?```$", "", raw)
    parsed = json.loads(raw)
    parsed = _normalise_enums(parsed, schema_class)   # ← enum synonym fix
    return schema_class(**parsed).model_dump()


"""
Patch to add to finsight/llm/client.py — add this function alongside call_llm_json.

get_llm_client() returns a ChatGroq instance (or None) that can be passed
into node_collect_data → get_news_sentiment for Groq semantic headline classification,
matching the notebook's pattern of passing `llm` directly into tool functions.
"""


def get_llm_client(settings: Settings) -> object | None:
    """
    Return a ChatGroq LLM client if groq_api_key is set, else None.
    Used to pass a shared client into tool functions (e.g. get_news_sentiment)
    so they can call the LLM directly without going through call_llm_json.
    """
    if not settings.groq_api_key:
        return None
    try:
        from langchain_groq import ChatGroq
        return ChatGroq(
            model=getattr(settings, "groq_model", "llama-3.3-70b-versatile"),
            api_key=settings.groq_api_key,
            temperature=0.1,
        )
    except Exception:
        return None