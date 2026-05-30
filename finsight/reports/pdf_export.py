"""PDF export via reportlab. Ported from Section 10 of the FinSight v2 notebook."""
from __future__ import annotations

from datetime import datetime


def export_pdf(result_dict: dict, output_path: str | None = None) -> str:
    """
    Generate a formatted PDF report for a single ticker result.
    result_dict is the serialised RiskAnalysisResult dict from the API.
    Returns the output file path.
    """
    try:
        from reportlab.lib import colors
        from reportlab.lib.pagesizes import A4
        from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
        from reportlab.lib.units import cm
        from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
    except ImportError as exc:
        raise RuntimeError("reportlab is not installed. Run: pip install reportlab") from exc

    ticker = result_dict.get("ticker", "UNKNOWN")
    rr = result_dict.get("risk_report") or {}
    js = result_dict.get("judge_score") or {}
    qd = result_dict.get("quant_data") or {}
    hr = result_dict.get("hallucination_report") or {}
    br = result_dict.get("bias_report") or {}
    payloads = result_dict.get("provider_payloads") or {}
    md = (payloads.get("market_data") or {}).get("data") or {}
    mac = (payloads.get("macro_data") or {}).get("data") or {}

    if output_path is None:
        output_path = f"finsight_{ticker}_{datetime.utcnow().strftime('%Y%m%d_%H%M')}.pdf"

    doc = SimpleDocTemplate(
        output_path, pagesize=A4,
        leftMargin=2 * cm, rightMargin=2 * cm,
        topMargin=2 * cm, bottomMargin=2 * cm,
    )
    styles = getSampleStyleSheet()
    story = []

    title_style = ParagraphStyle(
        "FinsightTitle", parent=styles["Title"],
        textColor=colors.HexColor("#465fff"), fontSize=20,
    )
    story.append(Paragraph(f"FinSight v2 Enhanced — Risk Report: {ticker}", title_style))
    story.append(Spacer(1, 0.4 * cm))

    risk_color_map = {
        "low": colors.HexColor("#22c55e"),
        "moderate": colors.HexColor("#f59e0b"),
        "high": colors.HexColor("#ef4444"),
    }
    level = rr.get("risk_level", "unknown")
    rc = risk_color_map.get(level, colors.black)
    story.append(Paragraph(
        f"<b>Risk Level:</b> <font color='{rc.hexval()}'>{level.upper()}</font>  |  "
        f"<b>Composite Score:</b> {rr.get('composite_score', 'N/A')}/100  |  "
        f"<b>Recommendation:</b> {rr.get('recommendation', '').upper()}",
        styles["Normal"],
    ))
    story.append(Spacer(1, 0.2 * cm))

    trend_style = ParagraphStyle(
        "Trend", parent=styles["Normal"],
        textColor=colors.HexColor("#465fff"), fontSize=9,
    )
    story.append(Paragraph(
        f"<b>Composite Trend:</b> {rr.get('composite_trend', 'N/A')}", trend_style
    ))
    story.append(Spacer(1, 0.3 * cm))
    story.append(Paragraph(f"<i>{rr.get('summary', '')}</i>", styles["Normal"]))

    if rr.get("mda_excerpt"):
        story.append(Spacer(1, 0.3 * cm))
        mda_style = ParagraphStyle(
            "MDA", parent=styles["Normal"], fontSize=8,
            textColor=colors.HexColor("#374151"), leftIndent=12,
        )
        story.append(Paragraph(
            f"<b>MD&amp;A:</b> {rr['mda_excerpt'][:400]}...", mda_style
        ))

    story.append(Spacer(1, 0.5 * cm))

    table_data = [
        ["Field", "Value"],
        ["Current Price",   f"${md.get('current_price', 'N/A')}"],
        ["52W High / Low",  f"${md.get('52_week_high', 'N/A')} / ${md.get('52_week_low', 'N/A')}"],
        ["Historical Vol",  f"{rr.get('volatility_pct', 'N/A')}%"],
        ["Implied Vol",     f"{rr.get('implied_vol_pct', 'N/A')}%"],
        ["P/E Ratio",       str(rr.get("pe_ratio", "N/A"))],
        ["Debt/Equity",     str(rr.get("debt_to_equity", "N/A"))],
        ["Sentiment Score", str(rr.get("sentiment_score", "N/A"))],
        ["Sentiment Method",str((payloads.get("news_sentiment_data") or {}).get("data", {}).get("method", "N/A"))],
        ["Dominant Theme",  str(rr.get("dominant_theme", "N/A"))],
        ["Market Regime",   str(rr.get("market_regime", "N/A"))],
        ["VIX",             str(mac.get("vix", "N/A"))],
        ["10Y Yield",       f"{mac.get('ten_year_yield_pct', 'N/A')}%"],
        ["RSI Signal",      str(qd.get("rsi_signal", "N/A"))],
        ["Momentum",        str(qd.get("momentum_signal", "N/A"))],
        ["Macro-Adjusted",  str(qd.get("macro_adjusted_signal", "N/A"))],
        ["Judge Score",     f"{js.get('score', 'N/A')}/5"],
        ["Judge Reasoning", str(js.get("reasoning", "N/A"))],
        ["Det. Pre-check",  "✓ Passed" if hr.get("deterministic_check_passed", True) else "⚠ Failed"],
        ["Hallucination",   "⚠ Detected" if hr.get("has_hallucination") else "✓ None"],
        ["Bias Audit",      "⚠ Detected" if br.get("sentiment_bias_detected") else "✓ None"],
        ["Data Quality",    rr.get("data_quality", "N/A")],
        ["Refinement Iters",str(result_dict.get("refinement_iter", 0))],
    ]
    t = Table(table_data, colWidths=[6 * cm, 10 * cm])
    t.setStyle(TableStyle([
        ("BACKGROUND",    (0, 0), (-1, 0), colors.HexColor("#465fff")),
        ("TEXTCOLOR",     (0, 0), (-1, 0), colors.white),
        ("FONTNAME",      (0, 0), (-1, 0), "Helvetica-Bold"),
        ("ROWBACKGROUNDS",(0, 1), (-1, -1), [colors.HexColor("#f0f3ff"), colors.white]),
        ("GRID",          (0, 0), (-1, -1), 0.5, colors.HexColor("#dde3ff")),
        ("FONTSIZE",      (0, 0), (-1, -1), 9),
        ("TOPPADDING",    (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    story.append(t)
    story.append(Spacer(1, 0.5 * cm))

    story.append(Paragraph("<b>Quant Technical Signals</b>", styles["Heading2"]))
    story.append(Paragraph(
        f"{qd.get('technical_summary', 'N/A')}",
        styles["Normal"],
    ))
    story.append(Spacer(1, 0.5 * cm))

    story.append(Paragraph("<b>Evaluation Summary</b>", styles["Heading2"]))
    story.append(Paragraph(
        f"Judge: {js.get('reasoning', 'N/A')} | "
        f"Det. Pre-check: {'✓ Passed' if hr.get('deterministic_check_passed', True) else '⚠ Failed'} | "
        f"Hallucination: {'⚠ Detected' if hr.get('has_hallucination') else '✓ None'} | "
        f"Bias: {'⚠ Detected' if br.get('sentiment_bias_detected') else '✓ None — ' + str(br.get('reasoning', ''))}",
        styles["Normal"],
    ))
    story.append(Spacer(1, 0.5 * cm))

    disc_style = ParagraphStyle(
        "Disc", parent=styles["Normal"],
        fontSize=7, textColor=colors.grey,
    )
    story.append(Paragraph(
        "DISCLAIMER: This report is generated by FinSight AI for informational purposes only. "
        "It does not constitute financial advice or a recommendation to buy, hold, or sell any "
        "security. Always consult a qualified financial adviser.",
        disc_style,
    ))

    doc.build(story)
    print(f"  PDF exported → {output_path}")
    return output_path