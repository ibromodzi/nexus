from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    groq_api_key: str = os.getenv("GROQ_API_KEY", "")
    groq_model: str = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")
    gnews_api_key: str = os.getenv("GNEWS_API_KEY", "")
    cost_budget_usd: float = float(os.getenv("FINSIGHT_COST_BUDGET_USD", "0.05"))
    sec_user_agent: str = os.getenv("SEC_USER_AGENT", "FinSight research@finsight.dev")
    cache_ttl_seconds: int = int(os.getenv("FINSIGHT_CACHE_TTL_SECONDS", "900"))
