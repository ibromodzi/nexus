from finsight.engine.scoring import compute_composite_score
from finsight.engine.validation import deterministic_hallucination_check


def test_deterministic_check_passes_matching_report():
    market = {"data": {"current_price": 100, "52_week_high": 140, "52_week_low": 80}}
    iv = {"data": {"iv_annualised_pct": 30}}
    fund = {"data": {"debt_to_equity": 1.0}}
    news = {"data": {"sentiment_score": 0.1}}
    macro = {"data": {"market_regime": "neutral"}}
    vol = 60.0
    report = {
        "volatility_pct": vol,
        "composite_score": compute_composite_score(vol, 30, 1.0, 0.1, "neutral"),
        "sentiment_score": 0.1,
        "debt_to_equity": 1.0,
    }

    result = deterministic_hallucination_check(report, market, iv, fund, news, macro)

    assert result.deterministic_check_passed is True
    assert result.deterministic_flags == []


def test_deterministic_check_flags_changed_composite():
    market = {"data": {"current_price": 100, "52_week_high": 140, "52_week_low": 80}}
    iv = {"data": {"iv_annualised_pct": 30}}
    fund = {"data": {"debt_to_equity": 1.0}}
    news = {"data": {"sentiment_score": 0.1}}
    macro = {"data": {"market_regime": "neutral"}}
    report = {
        "volatility_pct": 60.0,
        "composite_score": 99.0,
        "sentiment_score": 0.1,
        "debt_to_equity": 1.0,
    }

    result = deterministic_hallucination_check(report, market, iv, fund, news, macro)

    assert result.deterministic_check_passed is False
    assert any("composite_score mismatch" in flag for flag in result.deterministic_flags)
