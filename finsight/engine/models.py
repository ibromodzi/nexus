# from __future__ import annotations

# from datetime import datetime, timezone
# from typing import Any, Literal
# from uuid import uuid4

# from pydantic import BaseModel, Field, field_validator


# Status = Literal["success", "partial", "failed"]
# DataQuality = Literal["full", "partial", "minimal"]


# class ProviderPayload(BaseModel):
#     status: Literal["success", "skipped", "error"]
#     data: dict[str, Any] = Field(default_factory=dict)
#     error_message: str | None = None


# class HeadlineClassification(BaseModel):
#     label: Literal[
#         "catalyst_positive",
#         "catalyst_negative",
#         "regulatory_risk",
#         "noise",
#     ]
#     confidence: str
#     reason: str


# class QuantData(BaseModel):
#     rsi_signal: str | None = None
#     momentum_signal: str | None = None
#     macro_adjusted_signal: str | None = None
#     technical_summary: str | None = None


# class JudgeScore(BaseModel):
#     score: int
#     reasoning: str


# class BiasReport(BaseModel):
#     sentiment_bias_detected: bool
#     reasoning: str


# class HallucinationReport(BaseModel):
#     has_hallucination: bool = False
#     flagged_claims: list[str] = Field(default_factory=list)
#     confidence: Literal["high", "medium", "low"] = "high"
#     deterministic_flags: list[str] = Field(default_factory=list)
#     deterministic_check_passed: bool = True


# class RiskReport(BaseModel):
#     ticker: str
#     risk_level: Literal["low", "moderate", "high"]
#     volatility_pct: float
#     pe_ratio: str = "N/A"
#     summary: str
#     recommendation: Literal[
#         "monitor",
#         "review",
#         "elevated_risk",
#         "high_risk_watch",
#     ]
#     implied_vol_pct: float | None = None
#     debt_to_equity: float | None = None
#     sentiment_score: float | None = None
#     dominant_theme: str | None = None
#     market_regime: str | None = None
#     composite_score: float
#     data_quality: DataQuality
#     composite_trend: str | None = None
#     mda_excerpt: str | None = None

#     @field_validator("pe_ratio", mode="before")
#     @classmethod
#     def coerce_pe_ratio(cls, value: object) -> str:
#         if value is None:
#             return "N/A"
#         if isinstance(value, (int, float)):
#             return str(round(float(value), 2))
#         return str(value)


# class ValidationResult(BaseModel):
#     deterministic_check_passed: bool = True
#     deterministic_flags: list[str] = Field(default_factory=list)
#     has_hallucination: bool = False
#     flagged_claims: list[str] = Field(default_factory=list)
#     confidence: Literal["high", "medium", "low"] = "high"


# class CostSummary(BaseModel):
#     total_cost_usd: float = 0.0
#     total_input_tokens: int = 0
#     total_output_tokens: int = 0
#     budget_exceeded: bool = False
#     budget_message: str = ""


# class SourceRef(BaseModel):
#     name: str
#     url: str | None = None
#     metadata: dict[str, Any] = Field(default_factory=dict)


# class RiskAnalysisResult(BaseModel):
#     run_id: str = Field(default_factory=lambda: str(uuid4()))
#     created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
#     ticker: str
#     status: Status
#     data_quality: DataQuality
#     metrics: dict[str, Any] = Field(default_factory=dict)
#     risk_report: RiskReport | None = None
#     quant_data: QuantData | None = None
#     judge_score: JudgeScore | None = None
#     hallucination_report: HallucinationReport | None = None
#     bias_report: BiasReport | None = None
#     validation: ValidationResult = Field(default_factory=ValidationResult)
#     sources: list[SourceRef] = Field(default_factory=list)
#     provider_payloads: dict[str, ProviderPayload] = Field(default_factory=dict)
#     errors: list[str] = Field(default_factory=list)
#     cost: CostSummary = Field(default_factory=CostSummary)
#     final_report_text: str = ""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Literal
from uuid import uuid4

from pydantic import BaseModel, Field, field_validator


Status = Literal["success", "partial", "failed"]
DataQuality = Literal["full", "partial", "minimal"]


class ProviderPayload(BaseModel):
    status: Literal["success", "skipped", "error"]
    data: dict[str, Any] = Field(default_factory=dict)
    error_message: str | None = None


class HeadlineClassification(BaseModel):
    label: Literal[
        "catalyst_positive",
        "catalyst_negative",
        "regulatory_risk",
        "noise",
    ]
    confidence: str
    reason: str


class QuantData(BaseModel):
    rsi_signal: str | None = None
    momentum_signal: str | None = None
    macro_adjusted_signal: str | None = None
    technical_summary: str | None = None


class JudgeScore(BaseModel):
    score: int
    reasoning: str


class BiasReport(BaseModel):
    sentiment_bias_detected: bool
    reasoning: str


class HallucinationReport(BaseModel):
    has_hallucination: bool = False
    flagged_claims: list[str] = Field(default_factory=list)
    confidence: Literal["high", "medium", "low"] = "high"
    deterministic_flags: list[str] = Field(default_factory=list)
    deterministic_check_passed: bool = True


class PortfolioSynthesis(BaseModel):
    concentration_warnings: list[str] = Field(default_factory=list)
    overall_portfolio_risk: Literal["low", "moderate", "high"] = "moderate"
    correlation_notes: str = ""
    portfolio_summary: str = ""


class RiskReport(BaseModel):
    ticker: str
    risk_level: Literal["low", "moderate", "high"]
    volatility_pct: float
    pe_ratio: str = "N/A"
    summary: str
    recommendation: Literal["hold", "watch", "avoid"]
    implied_vol_pct: float | None = None
    debt_to_equity: float | None = None
    sentiment_score: float | None = None
    dominant_theme: str | None = None
    market_regime: str | None = None
    composite_score: float
    data_quality: DataQuality
    composite_trend: str | None = None
    mda_excerpt: str | None = None

    @field_validator("pe_ratio", mode="before")
    @classmethod
    def coerce_pe_ratio(cls, value: object) -> str:
        if value is None:
            return "N/A"
        if isinstance(value, (int, float)):
            return str(round(float(value), 2))
        return str(value)


class ValidationResult(BaseModel):
    deterministic_check_passed: bool = True
    deterministic_flags: list[str] = Field(default_factory=list)
    has_hallucination: bool = False
    flagged_claims: list[str] = Field(default_factory=list)
    confidence: Literal["high", "medium", "low"] = "high"


class CostSummary(BaseModel):
    total_cost_usd: float = 0.0
    total_input_tokens: int = 0
    total_output_tokens: int = 0
    budget_exceeded: bool = False
    budget_message: str = ""


class SourceRef(BaseModel):
    name: str
    url: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class RiskAnalysisResult(BaseModel):
    run_id: str = Field(default_factory=lambda: str(uuid4()))
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    ticker: str
    status: Status
    data_quality: DataQuality
    metrics: dict[str, Any] = Field(default_factory=dict)
    risk_report: RiskReport | None = None
    quant_data: QuantData | None = None
    judge_score: JudgeScore | None = None
    hallucination_report: HallucinationReport | None = None
    bias_report: BiasReport | None = None
    validation: ValidationResult = Field(default_factory=ValidationResult)
    sources: list[SourceRef] = Field(default_factory=list)
    provider_payloads: dict[str, ProviderPayload] = Field(default_factory=dict)
    errors: list[str] = Field(default_factory=list)
    cost: CostSummary = Field(default_factory=CostSummary)
    final_report_text: str = ""