from finsight.engine.models import ProviderPayload
from finsight.engine.pipeline import run_finsight_analysis


def test_pipeline_returns_structured_result(monkeypatch):
    import finsight.engine.pipeline as pipeline

    monkeypatch.setattr(
        pipeline,
        "get_market_data",
        lambda ticker: ProviderPayload(
            status="success",
            data={
                "ticker": ticker,
                "current_price": 100,
                "52_week_high": 140,
                "52_week_low": 80,
                "pe_ratio": 25,
                "company_name": "Example Inc.",
            },
        ),
    )
    monkeypatch.setattr(
        pipeline,
        "get_options_iv",
        lambda ticker: ProviderPayload(status="success", data={"iv_annualised_pct": 30}),
    )
    monkeypatch.setattr(
        pipeline,
        "get_sec_filings",
        lambda ticker, settings, form_type, extract_mda: ProviderPayload(
            status="success",
            data={
                "debt_to_equity": 1.0,
                "mda_excerpt": "Management discusses demand, liquidity, and operating risk.",
                "filing_url": "https://www.sec.gov/example",
                "cik": "0000000000",
                "accession_number": "0000000000-26-000001",
            },
        ),
    )
    monkeypatch.setattr(
        pipeline,
        "get_news_sentiment",
        lambda ticker, settings, cost=None: ProviderPayload(
            status="skipped", data={}, error_message="No key"
        ),
    )
    monkeypatch.setattr(
        pipeline,
        "get_macro_context",
        lambda: ProviderPayload(status="success", data={"market_regime": "neutral"}),
    )

    result = run_finsight_analysis("XYZ")

    assert result.ticker == "XYZ"
    assert result.status == "success"
    assert result.risk_report is not None
    assert result.risk_report.composite_score == 29.0
    assert result.validation.deterministic_check_passed is True
    assert result.sources[1].name == "SEC EDGAR"
