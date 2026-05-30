from finsight.engine.scoring import (
    compute_composite_score,
    recommendation_from_score,
    risk_level_from_score,
)


def test_composite_score_is_deterministic():
    assert compute_composite_score(50, 35, 1.2, -0.25, "risk-off") == 32.42


def test_risk_level_boundaries():
    assert risk_level_from_score(29.99) == "low"
    assert risk_level_from_score(30) == "moderate"
    assert risk_level_from_score(60) == "moderate"
    assert risk_level_from_score(60.01) == "high"


def test_recommendation_policy_is_operational_not_advice():
    assert recommendation_from_score(20) == "monitor"
    assert recommendation_from_score(45) == "review"
    assert recommendation_from_score(70) == "elevated_risk"
    assert recommendation_from_score(90) == "high_risk_watch"
