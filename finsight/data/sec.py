from __future__ import annotations

import html
import re

import httpx

from finsight.config import Settings
from finsight.data.cache import ttl_cache
from finsight.engine.models import ProviderPayload


MDA_PATTERNS = [
    r"(?is)item\s+7\.?\s*management['’`s\s]+discussion\s+and\s+analysis.*?(?=item\s+7a\.?|item\s+8\.?|\Z)",
    r"(?is)management['’`s\s]+discussion\s+and\s+analysis\s+of\s+financial\s+condition.*?(?=quantitative\s+and\s+qualitative|item\s+8\.?|\Z)",
]


def get_sec_filings(
    ticker: str, settings: Settings, form_type: str = "10-K", extract_mda: bool = True
) -> ProviderPayload:
    try:
        headers = _headers(settings)
        cik_padded = resolve_cik_for_ticker(ticker, settings)
        cik_int = str(int(cik_padded))
        submissions_url = f"https://data.sec.gov/submissions/CIK{cik_padded}.json"
        submissions = _get_json(submissions_url, headers, settings)
        filing = find_latest_filing(submissions, form_type)
        accession = filing["accession"]
        accession_clean = accession.replace("-", "")
        primary_doc = get_primary_document_from_index(
            cik_padded, accession, filing.get("primary_document"), headers, settings
        )
        document_url = (
            f"https://www.sec.gov/Archives/edgar/data/{cik_int}/"
            f"{accession_clean}/{primary_doc}"
        )
        mda_text = extract_mda_from_document(document_url, headers) if extract_mda else ""

        fundamentals = _fundamentals_from_yfinance(ticker)
        return ProviderPayload(
            status="success",
            data={
                "ticker": ticker.upper(),
                "cik": cik_padded,
                "form_type": form_type,
                "entity_name": submissions.get("name", ticker),
                "accession_number": accession,
                "primary_document": primary_doc,
                "filing_url": document_url,
                "period_of_report": filing.get("report_date", "unknown"),
                "file_date": filing.get("filing_date", "unknown"),
                "mda_excerpt": mda_text[:2000] if mda_text else None,
                **fundamentals,
            },
        )
    except Exception as exc:
        return ProviderPayload(status="error", error_message=str(exc))


def resolve_cik_for_ticker(ticker: str, settings: Settings) -> str:
    data = _get_json(
        "https://www.sec.gov/files/company_tickers.json", _headers(settings), settings
    )
    lookup = ticker.upper().replace(".", "-")
    for row in data.values():
        if row.get("ticker", "").upper() == lookup:
            return str(row["cik_str"]).zfill(10)
    raise ValueError(f"Ticker {ticker} not found in SEC company_tickers.json")


def find_latest_filing(submissions: dict, form_type: str = "10-K") -> dict:
    recent = submissions.get("filings", {}).get("recent", {})
    for idx, form in enumerate(recent.get("form", [])):
        if form == form_type:
            return {
                "accession": recent.get("accessionNumber", [])[idx],
                "primary_document": recent.get("primaryDocument", [None])[idx],
                "filing_date": recent.get("filingDate", ["unknown"])[idx],
                "report_date": recent.get("reportDate", ["unknown"])[idx],
            }
    raise ValueError(f"No recent {form_type} filing found")


def get_primary_document_from_index(
    cik: str,
    accession: str,
    preferred: str | None,
    headers: dict[str, str],
    settings: Settings,
) -> str:
    cik_int = str(int(cik))
    accession_clean = accession.replace("-", "")
    index_url = (
        f"https://www.sec.gov/Archives/edgar/data/{cik_int}/"
        f"{accession_clean}/index.json"
    )
    index_json = _get_json(index_url, headers, settings)
    names = [
        item.get("name")
        for item in index_json.get("directory", {}).get("item", [])
        if item.get("name")
    ]
    if preferred and preferred in names:
        return preferred
    for name in names:
        lower = name.lower()
        if lower.endswith((".htm", ".html", ".txt")) and "exhibit" not in lower:
            if not lower.startswith("ex") and not lower.endswith("-index.html"):
                return name
    raise ValueError("Could not identify primary SEC filing document from index JSON")


def extract_mda_from_document(
    document_url: str, headers: dict[str, str], max_chars: int = 4000
) -> str:
    response = httpx.get(document_url, headers=headers, timeout=20, follow_redirects=True)
    response.raise_for_status()
    text = _plain_text_from_html(response.text)
    normalized = re.sub(r"\s+", " ", text)
    for pattern in MDA_PATTERNS:
        match = re.search(pattern, normalized)
        if match:
            return match.group(0)[:max_chars].strip()
    idx = normalized.lower().find("management's discussion and analysis")
    if idx < 0:
        idx = normalized.lower().find("management’s discussion and analysis")
    return normalized[idx : idx + max_chars].strip() if idx >= 0 else ""


def _plain_text_from_html(raw: str) -> str:
    raw = re.sub(r"(?is)<(script|style).*?>.*?</\1>", " ", raw)
    raw = re.sub(r"(?is)<br\s*/?>", "\n", raw)
    raw = re.sub(r"(?is)</p>|</div>|</tr>|</h[1-6]>", "\n", raw)
    text = re.sub(r"<[^>]+>", " ", raw)
    text = html.unescape(text)
    text = re.sub(r"\xa0", " ", text)
    text = re.sub(r"[ \t]{2,}", " ", text)
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def _fundamentals_from_yfinance(ticker: str) -> dict:
    try:
        import yfinance as yf

        info = yf.Ticker(ticker.upper()).info
        total_debt = info.get("totalDebt", 0) or 0
        total_equity = info.get("bookValue", 1) * info.get("sharesOutstanding", 1) or 1
        return {
            "total_debt": total_debt,
            "total_equity": total_equity,
            "debt_to_equity": round(total_debt / total_equity, 4) if total_equity else None,
            "return_on_equity": info.get("returnOnEquity"),
        }
    except Exception:
        return {
            "total_debt": None,
            "total_equity": None,
            "debt_to_equity": None,
            "return_on_equity": None,
        }


def _get_json(url: str, headers: dict[str, str], settings: Settings) -> dict:
    return ttl_cache(
        f"sec-json:{url}",
        settings.cache_ttl_seconds,
        lambda: _fetch_json(url, headers),
    )


def _fetch_json(url: str, headers: dict[str, str]) -> dict:
    response = httpx.get(url, headers=headers, timeout=15, follow_redirects=True)
    response.raise_for_status()
    return response.json()


def _headers(settings: Settings) -> dict[str, str]:
    return {
        "User-Agent": settings.sec_user_agent,
        "Accept-Encoding": "gzip, deflate",
    }
