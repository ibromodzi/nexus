from __future__ import annotations

from finsight.engine.models import ProviderPayload


def get_macro_context() -> ProviderPayload:
    try:
        import yfinance as yf

        vix = yf.Ticker("^VIX").history(period="5d")["Close"].iloc[-1]
        tnx = yf.Ticker("^TNX").history(period="5d")["Close"].iloc[-1]
        spx = yf.Ticker("^GSPC").history(period="35d")["Close"]
        sp_return = (spx.iloc[-1] / spx.iloc[0] - 1) * 100
        regime = "risk-off" if vix > 25 else "neutral" if vix > 15 else "risk-on"
        return ProviderPayload(
            status="success",
            data={
                "vix": round(float(vix), 2),
                "ten_year_yield_pct": round(float(tnx), 2),
                "sp500_30d_return_pct": round(float(sp_return), 2),
                "market_regime": regime,
            },
        )
    except Exception as exc:
        return ProviderPayload(status="error", error_message=str(exc))
