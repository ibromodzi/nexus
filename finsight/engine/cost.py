from __future__ import annotations

from dataclasses import dataclass

from finsight.engine.models import CostSummary


COST_PER_1K_INPUT = 0.00059
COST_PER_1K_OUTPUT = 0.00079


@dataclass
class CostTracker:
    budget_usd: float
    input_tokens: int = 0
    output_tokens: int = 0
    total_usd: float = 0.0
    budget_exceeded: bool = False
    budget_message: str = ""

    def record(self, input_tokens: int, output_tokens: int) -> None:
        self.input_tokens += input_tokens
        self.output_tokens += output_tokens
        self.total_usd += (
            input_tokens / 1000 * COST_PER_1K_INPUT
            + output_tokens / 1000 * COST_PER_1K_OUTPUT
        )
        if self.total_usd > self.budget_usd and not self.budget_exceeded:
            self.budget_exceeded = True
            self.budget_message = (
                f"Pipeline budget exceeded: ${self.total_usd:.4f} > "
                f"${self.budget_usd:.4f}. Finalized with partial results."
            )

    def summary(self) -> CostSummary:
        return CostSummary(
            total_cost_usd=round(self.total_usd, 6),
            total_input_tokens=self.input_tokens,
            total_output_tokens=self.output_tokens,
            budget_exceeded=self.budget_exceeded,
            budget_message=self.budget_message,
        )
