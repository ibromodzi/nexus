from __future__ import annotations

from finsight.engine.models import ProviderPayload


def get_market_data(ticker: str) -> ProviderPayload:
    try:
        import yfinance as yf

        stock = yf.Ticker(ticker.upper())
        info = stock.info
        price = info.get("currentPrice") or info.get("regularMarketPrice")
        return ProviderPayload(
            status="success",
            data={
                "ticker": ticker.upper(),
                "current_price": price,
                "52_week_high": info.get("fiftyTwoWeekHigh"),
                "52_week_low": info.get("fiftyTwoWeekLow"),
                "market_cap": info.get("marketCap"),
                "pe_ratio": info.get("trailingPE"),
                "volume": info.get("volume"),
                "sector": info.get("sector"),
                "company_name": info.get("longName"),
            },
        )
    except Exception as exc:
        return ProviderPayload(status="error", error_message=str(exc))


def get_options_iv(ticker: str) -> ProviderPayload:
    try:
        import yfinance as yf

        stock = yf.Ticker(ticker.upper())
        expiries = stock.options
        if not expiries:
            return ProviderPayload(status="error", error_message="No options data available.")
        nearest = expiries[0]
        chain = stock.option_chain(nearest)
        calls = chain.calls
        spot = stock.info.get("currentPrice", 0)
        atm = calls.iloc[(calls["strike"] - spot).abs().argsort()[:1]]
        iv = float(atm["impliedVolatility"].values[0]) if not atm.empty else None
        return ProviderPayload(
            status="success",
            data={
                "ticker": ticker.upper(),
                "expiry": nearest,
                "atm_implied_volatility": iv,
                "iv_annualised_pct": round(iv * 100, 2) if iv else None,
            },
        )
    except Exception as exc:
        return ProviderPayload(status="error", error_message=str(exc))
