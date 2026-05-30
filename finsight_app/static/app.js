const state = {
  result: null,
  history: JSON.parse(localStorage.getItem("finsightRuns") || "[]"),
  watchlist: JSON.parse(localStorage.getItem("finsightWatchlist") || "[]"),
  alertRules: JSON.parse(localStorage.getItem("finsightAlertRules") || "[]"),
  notifications: JSON.parse(localStorage.getItem("finsightNotifications") || "[]"),
  // tracks which tickers are currently being re-analyzed in the watchlist
  analyzing: new Set(),
  // modal editing state
  _editingRuleId: null,
  // interval handles keyed by ruleId
  _schedIntervals: {},
  // daily schedule: { ruleId -> last fired date string }
  _dailyFired: JSON.parse(localStorage.getItem("finsightDailyFired") || "{}"),
};

const providerLabels = {
  market_data: "Market Data",
  iv_data: "Options IV",
  fundamentals_data: "SEC Filing / MD&A",
  news_sentiment_data: "News Sentiment",
  macro_data: "Macro Context",
};

// TailAdmin-matching blue palette
const factorColors = ["#465fff", "#6b7fff", "#93a4ff", "#bdc7ff", "#dde3ff"];

document.addEventListener("DOMContentLoaded", () => {
  bindTabs();
  bindForm();
  bindWatchlist();
  bindCompare();
  bindBacktest();
  bindAlerts();
  bindPortfolio();
  bindNotifBell();
  renderHistory();
  renderWatchlist();
  renderAlerts();
  updateNotifBadge();
  startScheduler();
  analyze("AAPL");
});

function bindTabs() {
  document.querySelectorAll(".nav-item").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".nav-item").forEach((item) => item.classList.remove("active"));
      document.querySelectorAll(".tab-view").forEach((view) => view.classList.remove("active"));
      button.classList.add("active");
      document.getElementById(button.dataset.tab).classList.add("active");
    });
  });
}

function bindForm() {
  document.getElementById("analysisForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const ticker = document.getElementById("tickerInput").value.trim().toUpperCase();
    if (ticker) analyze(ticker);
  });
  document.getElementById("exportButton").addEventListener("click", exportJson);
  document.getElementById("exportPdfButton").addEventListener("click", exportPdf);
  document.getElementById("watchlistButton").addEventListener("click", () => {
    if (!state.result) return;
    addToWatchlist(state.result);
  });
}

async function analyze(ticker) {
  setLoading(true);
  try {
    const response = await fetch(`/api/analyze/${encodeURIComponent(ticker)}`);
    if (!response.ok) throw new Error(await response.text());
    state.result = await response.json();
    pushHistory(state.result);
    renderAll();
  } catch (error) {
    renderError(ticker, error);
  } finally {
    setLoading(false);
  }
}

function setLoading(isLoading) {
  document.getElementById("loadingState").classList.toggle("hidden", !isLoading);
  document.querySelector(".primary-button").disabled = isLoading;
}

function renderAll() {
  renderSnapshot();
  renderCaveats();
  renderBreakdown();
  renderTrend();
  renderDrivers();
  renderQuality();
  renderNews();
  renderProgress();
  renderDriversTable();
  renderEvidence();
  renderValidation();
  renderBiasPanel();
  renderSourcesPanel();
  renderAgenticPanel();
  renderQuantPanel();
  renderHeadlineClassifications();
  renderReport();
  renderJson();
  renderHistory();
  renderWatchlist();
}

function renderSnapshot() {
  const result = state.result;
  const rr = result.risk_report || {};
  const market = provider("market_data");
  const score = Number(rr.composite_score || 0);

  // Page header
  document.getElementById("pageTitle").textContent =
    `${result.ticker} — Risk Overview`;
  document.getElementById("pageSubtitle").textContent =
    `${market.company_name || "—"} · ${market.sector || "—"} · ${market.exchange || "—"}`;

  // KPI 1: Price
  document.getElementById("currentPrice").textContent = money(market.current_price);
  document.getElementById("priceMeta").textContent =
    market.volume ? `Vol ${compact(market.volume)}` : "Current quote";
  document.getElementById("tickerBadge").textContent = result.ticker;

  // KPI 2: Score — dominant card with risk-level border accent
  const scoreEl = document.getElementById("scoreValue");
  scoreEl.textContent = score.toFixed(2);
  scoreEl.style.color = riskColor(rr.risk_level);
  document.getElementById("scoreNeedle").style.left = `${Math.max(0, Math.min(100, score))}%`;
  const scoreCard = document.getElementById("scoreCard");
  if (scoreCard) {
    scoreCard.className = "kpi-card kpi-dominant kpi-risk-" + (rr.risk_level || "unknown");
  }

  const lvl = rr.risk_level;

  // KPI 3: Risk level + recommendation
  const riskEl = document.getElementById("riskLevel");
  riskEl.textContent = title(rr.risk_level);
  riskEl.style.color = riskColor(rr.risk_level);

  const recBadge = document.getElementById("recommendationBadge");
  recBadge.textContent = labelRecommendation(rr.recommendation);
  recBadge.className = "kpi-badge " + recBadgeClass(rr.recommendation);

  // KPI 4: Validation + quality
  const valEl = document.getElementById("validationStatus");
  const passed = result.validation?.deterministic_check_passed;
  valEl.textContent = passed ? "Passed" : "Failed";
  valEl.style.color = passed ? "var(--green)" : "var(--red)";

  const qualBadge = document.getElementById("qualityBadge");
  qualBadge.textContent = `${title(result.data_quality)} Quality`;
  qualBadge.className = "kpi-badge " + (result.data_quality === "full" ? "up" : "neutral");

  document.getElementById("lastRun").textContent =
    `Last run: ${new Date(result.created_at).toLocaleString()}`;
}

function renderCaveats() {
  const caveat = document.getElementById("caveatStrip");
  const alerts = []; // { severity: "critical"|"warn"|"info", title, detail }

  // Provider hard failures → critical
  for (const [key, payload] of Object.entries(state.result.provider_payloads || {})) {
    if (payload.status === "error") {
      alerts.push({ severity: "critical", icon: "⛔",
        title: `${providerLabels[key]} Failed`,
        detail: payload.error_message || "No details available." });
    }
  }

  // Non-success analysis status → warn (if not already flagged as critical)
  if (state.result.status !== "success" && state.result.status !== "partial") {
    alerts.push({ severity: "critical", icon: "🚨",
      title: `Analysis status: ${state.result.status}`,
      detail: "Results may be unreliable. Inspect provider errors." });
  }

  // Skipped providers → warn
  for (const [key, payload] of Object.entries(state.result.provider_payloads || {})) {
    if (payload.status === "skipped") {
      alerts.push({ severity: "warn", icon: "⚠️",
        title: `${providerLabels[key]} Skipped`,
        detail: payload.error_message || "" });
    }
  }

  // Partial data quality → warn
  if (state.result.data_quality === "partial") {
    alerts.push({ severity: "warn", icon: "⚠️",
      title: "Partial Data Quality",
      detail: "One or more data providers returned incomplete data. Risk scores may be less accurate." });
  } else if (state.result.data_quality === "minimal") {
    alerts.push({ severity: "critical", icon: "⛔",
      title: "Minimal Data Quality",
      detail: "Most providers failed. This report should not be used for investment decisions." });
  }

  // Defaulted factors → info
  const defaults = breakdown().filter((f) => f.status === "defaulted").map((f) => f.label);
  if (defaults.length) {
    alerts.push({ severity: "info", icon: "ℹ️",
      title: "Defaulted Factors",
      detail: `Using fallback values for: ${defaults.join(", ")}.` });
  }

  if (alerts.length === 0) {
    caveat.classList.add("hidden");
    caveat.innerHTML = "";
    return;
  }

  caveat.classList.remove("hidden");
  caveat.innerHTML = alerts.map(a => `
    <div class="alert-item ${a.severity}">
      <span class="alert-item-icon">${a.icon}</span>
      <div class="alert-item-body">
        <span class="alert-item-title">${escapeHtml(a.title)}</span>
        ${a.detail ? `<span class="alert-item-detail">${escapeHtml(a.detail)}</span>` : ""}
      </div>
    </div>`).join("");
}

function renderBreakdown() {
  const rr = state.result.risk_report || {};
  const score = Number(rr.composite_score || 0);
  document.getElementById("donutScore").textContent = score.toFixed(2);
  document.getElementById("donutRisk").textContent = `${title(rr.risk_level)} Risk`;
  document.getElementById("scoreDonut").style.background =
    donutGradient(breakdown().map((f) => f.contribution));

  document.getElementById("breakdownList").innerHTML = breakdown().map((f, i) => `
    <div class="breakdown-row">
      <span class="breakdown-name">
        <i class="dot" style="background:${factorColors[i]}"></i>${f.label}
      </span>
      <span>${f.weight_pct}%</span>
      <strong>${number(f.contribution)}</strong>
    </div>
  `).join("");
}

function renderTrend() {
  const chart = document.getElementById("trendChart");
  const runs = [...state.history].slice(0, 18).reverse();
  if (runs.length < 2) {
    chart.innerHTML = `<text x="24" y="110" fill="#94a3b8" font-size="12"
      font-family="'DM Mono',monospace">Run more analyses to build a trend.</text>`;
    return;
  }
  const W = 640, H = 210, pad = { t: 16, b: 30, l: 32, r: 16 };
  const cW = W - pad.l - pad.r, cH = H - pad.t - pad.b;

  const points = runs.map((run, i) => ({
    x: pad.l + (i / Math.max(1, runs.length - 1)) * cW,
    y: pad.t + (1 - Number(run.score) / 100) * cH,
    run,
  }));

  const linePath  = points.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const areaPath  = linePath
    + ` L${points[points.length-1].x.toFixed(1)},${(pad.t+cH).toFixed(1)}`
    + ` L${points[0].x.toFixed(1)},${(pad.t+cH).toFixed(1)} Z`;

  const gridTicks = [0, 25, 50, 75, 100];
  const gridLines = gridTicks.map(v => {
    const y = (pad.t + (1 - v / 100) * cH).toFixed(1);
    return `<line x1="${pad.l}" y1="${y}" x2="${W-pad.r}" y2="${y}"
              stroke="#e2e8f0" stroke-width="1"/>
            <text x="${pad.l - 6}" y="${Number(y)+4}" text-anchor="end"
              fill="#94a3b8" font-size="10" font-family="'DM Mono',monospace">${v}</text>`;
  }).join("");

  // x axis tick labels (ticker names)
  const xLabels = points.map(p =>
    `<text x="${p.x.toFixed(1)}" y="${H-4}" text-anchor="middle"
      fill="#94a3b8" font-size="9" font-family="'DM Mono',monospace">${p.run.ticker}</text>`
  ).join("");

  chart.innerHTML = `
    <defs>
      <linearGradient id="trendGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#465fff" stop-opacity="0.12"/>
        <stop offset="100%" stop-color="#465fff" stop-opacity="0"/>
      </linearGradient>
    </defs>
    ${gridLines}
    ${xLabels}
    <path d="${areaPath}" fill="url(#trendGrad)"/>
    <path d="${linePath}" fill="none" stroke="#465fff" stroke-width="2.5"
      stroke-linejoin="round" stroke-linecap="round"/>
    ${points.map(p =>
      `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="4" fill="#465fff"
        stroke="#fff" stroke-width="2">
        <title>${p.run.ticker}: ${Number(p.run.score).toFixed(2)}</title>
       </circle>`
    ).join("")}
  `;
}

function renderDrivers() {
  const sorted = [...breakdown()].sort((a, b) => b.contribution - a.contribution).slice(0, 4);
  document.getElementById("keyDrivers").innerHTML = sorted.map((f) => `
    <div class="driver-item">
      <span>${f.label}
        <small class="muted">${f.display_value} · ${f.source}</small>
      </span>
      <span class="badge ${f.status === "actual" ? "success" : "warn"}">${impactLabel(f.contribution)}</span>
    </div>
  `).join("");
}

function renderQuality() {
  const payloads = Object.values(state.result.provider_payloads || {});
  const complete = payloads.filter((p) => p.status === "success").length;
  const skipped  = payloads.filter((p) => p.status === "skipped").length;
  const errors   = payloads.filter((p) => p.status === "error").length;
  document.getElementById("sourceCount").textContent = payloads.length;
  document.getElementById("qualityLegend").innerHTML = `
    <div class="quality-row">
      <span><i class="dot" style="background:var(--green)"></i>Complete</span>
      <strong>${complete}</strong>
    </div>
    <div class="quality-row">
      <span><i class="dot" style="background:var(--amber)"></i>Skipped</span>
      <strong>${skipped}</strong>
    </div>
    <div class="quality-row">
      <span><i class="dot" style="background:var(--red)"></i>Error</span>
      <strong>${errors}</strong>
    </div>
  `;
}

function renderNews() {
  const news  = provider("news_sentiment_data");
  const score = news.sentiment_score;
  const val   = score == null ? 0 : Math.max(-1, Math.min(1, Number(score)));

  // ── SVG gauge geometry ──────────────────────────────────
  // Semicircle: centre (80, 72), r=52
  // Angles in SVG: 180°=left, 0°=right, arc goes 180→0 (top half)
  const cx = 80, cy = 72, r = 52;
  const toRad = deg => deg * Math.PI / 180;

  function pt(deg) {
    return [cx + r * Math.cos(toRad(deg)), cy + r * Math.sin(toRad(deg))];
  }

  function arc(startDeg, endDeg) {
    const [sx, sy] = pt(startDeg);
    const [ex, ey] = pt(endDeg);
    const large = Math.abs(endDeg - startDeg) > 180 ? 1 : 0;
    // always sweep clockwise (1) going from 180→0 means we need sweep=0
    return `M ${sx.toFixed(2)} ${sy.toFixed(2)} A ${r} ${r} 0 ${large} 0 ${ex.toFixed(2)} ${ey.toFixed(2)}`;
  }

  // score -1 → 180°, 0 → 90° (top), +1 → 0°
  const angleDeg = 180 - ((val + 1) / 2) * 180;

  // Track: full arc 180→0
  document.getElementById("gaugeTrack").setAttribute("d", arc(180, 0));
  document.getElementById("gaugeTrack").setAttribute("stroke", "var(--border-2)");

  // Fill: 180 → angleDeg (clamp so arc never degenerates)
  const clampedAngle = Math.max(0.5, Math.min(179.5, angleDeg));
  document.getElementById("gaugeFill").setAttribute("d", arc(180, clampedAngle));
  const fillColor = val > 0.1 ? "var(--green)" : val < -0.1 ? "var(--red)" : "var(--amber)";
  document.getElementById("gaugeFill").setAttribute("stroke", fillColor);

  // Needle: from centre to point on arc at angleDeg
  const [nx, ny] = pt(angleDeg);
  const needle = document.getElementById("gaugeNeedle");
  needle.setAttribute("x1", cx);
  needle.setAttribute("y1", cy);
  needle.setAttribute("x2", nx.toFixed(2));
  needle.setAttribute("y2", ny.toFixed(2));
  needle.setAttribute("stroke", "var(--text-1)");

  // Centre dot
  document.getElementById("gaugeDot").setAttribute("cx", cx);
  document.getElementById("gaugeDot").setAttribute("cy", cy);

  // Score + label
  const sentEl = document.getElementById("sentimentScore");
  sentEl.textContent = score == null ? "N/A" : Number(score).toFixed(4);
  sentEl.style.color = score == null ? "var(--text-4)" : fillColor;

  const labelEl = document.getElementById("sentimentLabel");
  labelEl.textContent = val > 0.1 ? "Bullish" : val < -0.1 ? "Bearish" : "Neutral";
  labelEl.style.color = fillColor;

  // Headlines
  const headlines = news.headlines || [];
  document.getElementById("headlineList").innerHTML = headlines.length
    ? headlines.slice(0, 4).map(h =>
        `<div class="headline-item"><span>${escapeHtml(h)}</span></div>`).join("")
    : `<div class="headline-item"><span>No headlines available.</span></div>`;
}

function renderProgress() {
  const entries = Object.entries(state.result.provider_payloads || {});
  const complete = entries.filter(([, p]) => p.status !== "error").length;
  document.getElementById("progressCount").textContent = `${complete} / ${entries.length}`;
  document.getElementById("progressSteps").innerHTML = entries.map(([key, p], i) => `
    <div class="step">
      <span class="step-number" style="background:${
        p.status === "error"   ? "var(--red)"   :
        p.status === "skipped" ? "var(--amber)"  : "var(--green)"}">${i + 1}</span>
      <span>${providerLabels[key]}</span>
      <strong>${p.status === "error" ? "✕" : "✓"}</strong>
    </div>
  `).join("");
}

function renderDriversTable() {
  document.getElementById("driversTable").innerHTML = breakdown().map((f) => `
    <tr>
      <td>${f.label}</td>
      <td>${f.display_value}</td>
      <td>${number(f.normalized_risk)}</td>
      <td>${f.weight_pct}%</td>
      <td><strong>${number(f.contribution)}</strong></td>
      <td><span class="badge ${f.status === "actual" ? "success" : "warn"}">${f.status}</span></td>
      <td>${f.source}</td>
    </tr>
  `).join("");
}

function renderEvidence() {
  const payloads = state.result.provider_payloads || {};
  document.getElementById("evidenceGrid").innerHTML = Object.entries(payloads).map(([key, p]) => `
    <article class="panel evidence-card">
      <div class="panel-head">
        <h2>${providerLabels[key]}</h2>
        <span class="badge ${badgeClass(p.status)}">${p.status}</span>
      </div>
      ${evidenceDetails(p)}
    </article>
  `).join("");
}

function evidenceDetails(payload) {
  const data = payload.data || {};
  const rows = Object.entries(data)
    .filter(([, v]) => v !== null && v !== undefined && typeof v !== "object")
    .slice(0, 10);
  if (payload.error_message && !rows.length)
    return `<p class="muted">${escapeHtml(payload.error_message)}</p>`;
  return `<dl>${rows.map(([k, v]) =>
    `<dt>${humanize(k)}</dt><dd>${escapeHtml(String(v))}</dd>`).join("")}</dl>`;
}

function renderValidation() {
  const v = state.result.validation || {};
  const flags = v.deterministic_flags || [];
  document.getElementById("validationPanel").innerHTML = `
    <div class="validation-row">
      <span>Deterministic numeric check</span>
      <span class="badge ${v.deterministic_check_passed ? "success" : "error"}">
        ${v.deterministic_check_passed ? "Passed" : "Failed"}</span>
    </div>
    <div class="validation-row">
      <span>Hallucination flag</span>
      <span class="badge ${v.has_hallucination ? "error" : "success"}">
        ${v.has_hallucination ? "Detected" : "None"}</span>
    </div>
    <div class="validation-row">
      <span>Confidence</span>
      <span>${title(v.confidence || "high")}</span>
    </div>
    <div>
      <strong>Flags</strong>
      <p class="muted">${flags.length
        ? flags.map(escapeHtml).join("; ")
        : "No deterministic mismatches found."}</p>
    </div>
  `;
}

function renderReport() {
  document.getElementById("reportText").textContent = state.result.final_report_text || "";
}

/* ── Agentic Loop panel ─────────────────────────────────── */
function renderAgenticPanel() {
  const el = document.getElementById("agenticPanel");
  if (!el) return;
  const result  = state.result;
  const jsc     = result.judge_score || {};
  const hr      = result.hallucination_report || {};
  const br      = result.bias_report || {};
  const iters   = result.refinement_iter ?? 0;
  const score   = jsc.score;
  const scoreColor = score >= 4 ? "var(--green)" : score >= 3 ? "var(--amber)" : "var(--red)";
  const hasBias = br.sentiment_bias_detected;
  const hasHalluc = hr.has_hallucination;
  const costSummary = result.cost || {};

  el.innerHTML = `
    <div class="agentic-row">
      <span class="agentic-label">Judge Score</span>
      <span class="agentic-value" style="color:${scoreColor};font-weight:700">${score != null ? score + "/5" : "—"}</span>
    </div>
    <div class="agentic-reasoning">${escapeHtml(jsc.reasoning || "—")}</div>
    <div class="agentic-row ${hasHalluc ? "has-error" : ""}" style="margin-top:10px">
      <span class="agentic-label">Hallucination</span>
      <span class="badge ${hasHalluc ? "error" : "success"}">${hasHalluc ? "⚠ Detected" : "✓ None"}</span>
    </div>
    <div class="agentic-row ${hasBias ? "has-warn" : ""}">
      <span class="agentic-label">Bias Audit</span>
      <span class="badge ${hasBias ? "warn" : "success"}">${hasBias ? "⚠ Bias Detected" : "✓ No Bias"}</span>
    </div>
    <div class="agentic-row">
      <span class="agentic-label">Data Quality</span>
      <span class="badge ${result.data_quality === "full" ? "success" : result.data_quality === "minimal" ? "error" : "warn"}">${title(result.data_quality)}</span>
    </div>
    <button class="debug-toggle" onclick="this.classList.toggle('open');this.nextElementSibling.classList.toggle('open')">
      <span>Pipeline Debug</span>
      <span class="debug-toggle-icon">▾</span>
    </button>
    <div class="debug-body">
      <div class="debug-row">
        <span class="debug-key">Refinement Iters</span>
        <span class="debug-val">${iters}</span>
      </div>
      <div class="debug-row">
        <span class="debug-key">Input Tokens</span>
        <span class="debug-val">${costSummary.input_tokens ?? "—"}</span>
      </div>
      <div class="debug-row">
        <span class="debug-key">Output Tokens</span>
        <span class="debug-val">${costSummary.output_tokens ?? "—"}</span>
      </div>
      <div class="debug-row">
        <span class="debug-key">Est. Cost</span>
        <span class="debug-val">${costSummary.estimated_cost_usd != null ? "$" + Number(costSummary.estimated_cost_usd).toFixed(4) : "—"}</span>
      </div>
    </div>
  `;
}

/* ── Quant Signals panel ────────────────────────────────── */
function renderQuantPanel() {
  const el = document.getElementById("quantPanel");
  if (!el) return;
  const qd  = state.result.quant_data || {};
  const mac = provider("macro_data");
  const signalColor = s => {
    if (!s) return "var(--text-4)";
    s = s.toLowerCase();
    if (s === "overbought" || s === "negative" || s === "avoid") return "var(--red)";
    if (s === "oversold" || s === "positive" || s === "strong")  return "var(--green)";
    return "var(--amber)";
  };
  el.innerHTML = `
    <div class="agentic-row">
      <span class="agentic-label">RSI Signal</span>
      <span class="agentic-value" style="color:${signalColor(qd.rsi_signal)}">${title(qd.rsi_signal || "—")}</span>
    </div>
    <div class="agentic-row">
      <span class="agentic-label">Momentum</span>
      <span class="agentic-value" style="color:${signalColor(qd.momentum_signal)}">${title(qd.momentum_signal || "—")}</span>
    </div>
    <div class="agentic-row">
      <span class="agentic-label">Macro-Adjusted</span>
      <span class="agentic-value" style="color:${signalColor(qd.macro_adjusted_signal)}">${title(qd.macro_adjusted_signal || "—")}</span>
    </div>
    <div class="agentic-reasoning" style="margin-top:8px">${escapeHtml(qd.technical_summary || "—")}</div>
    <div class="agentic-row" style="margin-top:10px">
      <span class="agentic-label">VIX</span>
      <span class="agentic-value">${mac.vix ?? "—"}</span>
    </div>
    <div class="agentic-row">
      <span class="agentic-label">10Y Yield</span>
      <span class="agentic-value">${mac.ten_year_yield_pct != null ? mac.ten_year_yield_pct + "%" : "—"}</span>
    </div>
    <div class="agentic-row">
      <span class="agentic-label">S&amp;P 30d Return</span>
      <span class="agentic-value">${mac.sp500_30d_return_pct != null ? mac.sp500_30d_return_pct + "%" : "—"}</span>
    </div>
  `;
}

/* ── Headline Classifications panel ────────────────────── */
function renderHeadlineClassifications() {
  const el = document.getElementById("headlineClassifications");
  if (!el) return;
  const news = provider("news_sentiment_data");
  const classifications = news.classifications || [];
  const headlines = news.headlines || [];
  const labelColors = {
    catalyst_positive: "var(--green)",
    catalyst_negative: "var(--red)",
    regulatory_risk:   "var(--amber)",
    noise:             "var(--text-4)",
  };
  const method = news.method || "—";
  const labelCounts = news.label_counts || {};
  const dominant = news.dominant_label || "—";

  const summaryHtml = `
    <div style="display:flex;gap:20px;flex-wrap:wrap;margin-bottom:14px;padding-bottom:12px;border-bottom:1px solid var(--border-1);">
      <div><span style="font-size:11px;color:var(--text-4);text-transform:uppercase;letter-spacing:.08em;">Method</span><br><strong style="font-size:13px">${escapeHtml(method)}</strong></div>
      <div><span style="font-size:11px;color:var(--text-4);text-transform:uppercase;letter-spacing:.08em;">Dominant Label</span><br><strong style="font-size:13px;color:${labelColors[dominant] || "var(--text-1)"}">${escapeHtml(title(dominant))}</strong></div>
      ${Object.entries(labelCounts).map(([lbl, cnt]) =>
        `<div><span style="font-size:11px;color:${labelColors[lbl] || "var(--text-4)"};text-transform:uppercase;letter-spacing:.08em;">${escapeHtml(title(lbl))}</span><br><strong style="font-size:13px">${cnt}</strong></div>`
      ).join("")}
    </div>
  `;

  if (!classifications.length) {
    el.innerHTML =
      summaryHtml + `<p class="muted" style="padding:8px 0">No headline classifications available.</p>`;
    return;
  }

  const rows = classifications.map((c, i) => `
    <div class="headline-classification-row">
      <div class="hc-headline">${escapeHtml(headlines[i] || "—")}</div>
      <div class="hc-meta">
        <span class="hc-label" style="color:${labelColors[c.label] || "var(--text-4)"}">● ${escapeHtml(title(c.label || "—"))}</span>
        <span class="hc-confidence muted">${escapeHtml(c.confidence || "—")}</span>
        <span class="hc-reason muted">${escapeHtml(c.reason || "")}</span>
      </div>
    </div>
  `).join("");

  el.innerHTML = summaryHtml + rows;
}

/* ── Bias panel ─────────────────────────────────────────── */
function renderBiasPanel() {
  const el = document.getElementById("biasPanel");
  if (!el) return;
  const br = state.result.bias_report || {};
  const rr = state.result.risk_report || {};
  el.innerHTML = `
    <div class="validation-row">
      <span>Sentiment Bias Detected</span>
      <span class="badge ${br.sentiment_bias_detected ? "error" : "success"}">
        ${br.sentiment_bias_detected ? "⚠ Yes" : "✓ No"}</span>
    </div>
    <div class="validation-row">
      <span>Reasoning</span>
      <span style="font-size:12px;color:var(--text-3);max-width:320px;text-align:right">${escapeHtml(br.reasoning || "—")}</span>
    </div>
    <div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--border-1);">
      <strong style="font-size:12px;color:var(--text-3);text-transform:uppercase;letter-spacing:.08em">Compliance</strong>
      <p class="muted" style="margin-top:4px;font-size:12px">
        All reports are filtered for prohibited phrases (guaranteed return, risk-free, certain to, will definitely) and appended with a disclaimer.
        Recommendation values: <strong>hold</strong> · <strong>watch</strong> · <strong>avoid</strong>.
      </p>
    </div>
  `;
}

/* ── Sources panel ──────────────────────────────────────── */
function renderSourcesPanel() {
  const el = document.getElementById("sourcesPanel");
  if (!el) return;
  const sources = state.result.sources || [];
  if (!sources.length) {
    el.innerHTML = `<p class="muted" style="padding:8px 0">No source data available.</p>`;
    return;
  }
  el.innerHTML = `<div style="display:flex;flex-direction:column;gap:10px;padding:4px 0">${
    sources.map(s => `
      <div style="display:flex;align-items:flex-start;gap:12px;">
        <span style="font-weight:600;font-size:13px;min-width:130px">${escapeHtml(s.name)}</span>
        ${s.url ? `<a href="${escapeHtml(s.url)}" target="_blank" rel="noopener" style="font-size:12px;color:var(--blue);word-break:break-all">${escapeHtml(s.url)}</a>` : ""}
        ${Object.entries(s.metadata || {}).filter(([,v]) => v).map(([k,v]) =>
          `<span style="font-size:11px;color:var(--text-4)">${escapeHtml(k)}: ${escapeHtml(String(v))}</span>`
        ).join(" · ")}
      </div>
    `).join("")
  }</div>`;
}

/* ── PDF Export ─────────────────────────────────────────── */
async function exportPdf() {
  if (!state.result) return;
  const ticker = state.result.ticker;
  try {
    const resp = await fetch(`/api/export/pdf/${encodeURIComponent(ticker)}`);
    if (!resp.ok) throw new Error(await resp.text());
    const blob = await resp.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `finsight-${ticker}-${Date.now()}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    showToast(`PDF export failed: ${err.message}`, "error");
  }
}

/* ── PORTFOLIO ──────────────────────────────────────────── */
function bindPortfolio() {
  document.getElementById("portfolioRunBtn").addEventListener("click", runPortfolio);
  document.getElementById("portfolioTickersInput").addEventListener("keydown", e => {
    if (e.key === "Enter") { e.preventDefault(); runPortfolio(); }
  });
}

async function runPortfolio() {
  const raw     = document.getElementById("portfolioTickersInput").value;
  const tickers = raw.split(/[,\s]+/).map(t => t.trim().toUpperCase()).filter(Boolean);
  if (!tickers.length) { showToast("Enter at least one ticker.", "error"); return; }

  const empty   = document.getElementById("portfolioEmpty");
  const loading = document.getElementById("portfolioLoading");
  const errEl   = document.getElementById("portfolioError");
  const synPanel= document.getElementById("portfolioSynthesisPanel");
  const msg     = document.getElementById("portfolioLoadingMsg");

  empty.classList.add("hidden");
  synPanel.classList.add("hidden");
  errEl.classList.add("hidden");
  loading.classList.remove("hidden");
  msg.textContent = `Analyzing ${tickers.join(", ")} in parallel…`;

  try {
    const resp = await fetch("/api/portfolio", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tickers }),
    });
    if (!resp.ok) throw new Error(await resp.text());
    const data = await resp.json();
    renderPortfolioResult(data);
  } catch (err) {
    errEl.textContent = `Portfolio analysis failed: ${err.message}`;
    errEl.classList.remove("hidden");
    empty.classList.remove("hidden");
  } finally {
    loading.classList.add("hidden");
  }
}

function renderPortfolioResult(data) {
  const syn       = data.portfolio_synthesis || {};
  const results   = data.ticker_results || {};
  const tickers   = data.tickers || Object.keys(results);
  const riskEmoji = { low: "🟢", moderate: "🟡", high: "🔴" };
  const overallRisk = syn.overall_portfolio_risk || "—";

  // KPI row
  const scored = Object.values(results).filter(r => r?.risk_report?.composite_score != null);
  const avgScore = scored.length
    ? (scored.reduce((s, r) => s + Number(r.risk_report.composite_score), 0) / scored.length).toFixed(1)
    : "—";

  document.getElementById("portfolioKpiRow").innerHTML = `
    <div class="kpi-card">
      <div class="kpi-body">
        <div class="kpi-label">Overall Portfolio Risk</div>
        <div class="kpi-value" style="font-size:20px;font-weight:800;color:${riskColor(overallRisk)}">${(riskEmoji[overallRisk] || "⚪") + " " + title(overallRisk)}</div>
      </div>
    </div>
    <div class="kpi-card">
      <div class="kpi-body">
        <div class="kpi-label">Holdings Analyzed</div>
        <div class="kpi-value">${tickers.length}</div>
      </div>
    </div>
    <div class="kpi-card">
      <div class="kpi-body">
        <div class="kpi-label">Avg Risk Score</div>
        <div class="kpi-value" style="color:var(--blue)">${avgScore}</div>
      </div>
    </div>
    <div class="kpi-card">
      <div class="kpi-body">
        <div class="kpi-label">High Risk Tickers</div>
        <div class="kpi-value" style="color:var(--red)">${Object.values(results).filter(r => r?.risk_report?.risk_level === "high").length}</div>
      </div>
    </div>
  `;

  // Concentration warnings
  const warnings = syn.concentration_warnings || [];
  document.getElementById("portfolioWarnings").innerHTML = warnings.length
    ? warnings.map(w => `<div class="driver-item"><span>${escapeHtml(w)}</span></div>`).join("")
    : `<p class="muted" style="padding:6px 0">No concentration warnings detected.</p>`;

  document.getElementById("portfolioCorrelation").textContent = syn.correlation_notes || "—";
  document.getElementById("portfolioSummaryText").textContent = syn.portfolio_summary || "—";
  document.getElementById("portfolioHoldingCount").textContent = `${tickers.length} holdings`;

  // Holdings table
  document.getElementById("portfolioHoldingsBody").innerHTML = tickers.map(t => {
    const res = results[t];
    if (!res) return `<tr><td style="font-family:'DM Mono',monospace;font-weight:600">${escapeHtml(t)}</td><td colspan="8"><span class="badge error">Error</span></td></tr>`;
    const rr = res.risk_report || {};
    const js = res.judge_score || {};
    const br = res.bias_report || {};
    return `
      <tr>
        <td style="font-family:'DM Mono',monospace;font-weight:600">${escapeHtml(t)}</td>
        <td><span class="badge ${rr.risk_level === "low" ? "success" : rr.risk_level === "high" ? "error" : "warn"}">${title(rr.risk_level || "—")}</span></td>
        <td style="font-family:'DM Mono',monospace;color:${riskColor(rr.risk_level)}">${rr.composite_score != null ? Number(rr.composite_score).toFixed(2) : "—"}</td>
        <td><span class="badge ${recBadgeClass(rr.recommendation)}">${labelRecommendation(rr.recommendation)}</span></td>
        <td style="font-size:12px;color:var(--text-3);max-width:180px">${escapeHtml(rr.composite_trend || "—")}</td>
        <td style="color:${js.score >= 4 ? "var(--green)" : js.score >= 3 ? "var(--amber)" : "var(--red)"}">${js.score != null ? js.score + "/5" : "—"}</td>
        <td><span class="badge ${br.sentiment_bias_detected ? "error" : "success"}">${br.sentiment_bias_detected ? "⚠" : "✓"}</span></td>
        <td><span class="badge ${res.data_quality === "full" ? "success" : "warn"}">${title(res.data_quality || "—")}</span></td>
        <td><button class="btn-sm primary" onclick="loadPortfolioTicker('${escapeHtml(t)}')">View</button></td>
      </tr>
    `;
  }).join("");

  document.getElementById("portfolioReportText").textContent = data.portfolio_summary_text || "";
  document.getElementById("portfolioSynthesisPanel").classList.remove("hidden");
}

function loadPortfolioTicker(ticker) {
  document.querySelectorAll(".nav-item").forEach(b => b.classList.remove("active"));
  document.querySelectorAll(".tab-view").forEach(v => v.classList.remove("active"));
  document.querySelector("[data-tab='overview']").classList.add("active");
  document.getElementById("overview").classList.add("active");
  document.getElementById("tickerInput").value = ticker;
  analyze(ticker);
}

function renderJson() {
  document.getElementById("jsonText").textContent = JSON.stringify(state.result, null, 2);
}

function renderHistory() {
  const runs = state.history.slice(0, 8);
  document.getElementById("recentRuns").innerHTML = runs.length
    ? runs.map((r) => `
        <div class="recent-item">
          <strong>${r.ticker}</strong>
          <span>${new Date(r.created_at).toLocaleDateString()}</span>
          <span>
            <i class="recent-dot" style="background:${riskColor(r.level)}"></i>
            ${Number(r.score).toFixed(2)}
          </span>
        </div>`)
      .join("")
    : `<span class="muted" style="padding:0 8px;font-size:12px;">No runs yet</span>`;
}

function renderError(ticker, error) {
  const strip = document.getElementById("caveatStrip");
  strip.classList.remove("hidden");
  strip.innerHTML = `
    <div class="alert-item critical">
      <span class="alert-item-icon">🚨</span>
      <div class="alert-item-body">
        <span class="alert-item-title">Analysis Failed — ${ticker}</span>
        <span class="alert-item-detail">${escapeHtml(String(error.message || "Internal Server Error"))}</span>
      </div>
    </div>`;
}

function pushHistory(result) {
  const score = result.risk_report?.composite_score;
  if (score == null) return;
  state.history = [
    { ticker: result.ticker, score, level: result.risk_report.risk_level, created_at: result.created_at },
    ...state.history,
  ].slice(0, 30);
  localStorage.setItem("finsightRuns", JSON.stringify(state.history));
}

function exportJson() {
  if (!state.result) return;
  const blob = new Blob([JSON.stringify(state.result, null, 2)], { type: "application/json" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = `finsight-${state.result.ticker}-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/* ── WATCHLIST ─────────────────────────────────────────── */

function bindWatchlist() {
  const addBtn   = document.getElementById("watchlistAddBtn");
  const addInput = document.getElementById("watchlistAddInput");

  addBtn.addEventListener("click", () => {
    const ticker = addInput.value.trim().toUpperCase();
    if (!ticker) return;
    addToWatchlist({ ticker, risk_report: null, provider_payloads: {} });
    addInput.value = "";
    analyzeWatchlistTicker(ticker);
  });

  addInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); addBtn.click(); }
  });
}

function addToWatchlist(result) {
  const ticker = result.ticker;
  const exists = state.watchlist.find(w => w.ticker === ticker);
  if (exists) {
    // update in place with fresh data if available
    if (result.risk_report) {
      Object.assign(exists, watchlistEntry(result));
      saveWatchlist();
      renderWatchlist();
    }
    showToast(`${ticker} is already on your watchlist.`);
    return;
  }
  state.watchlist.unshift(watchlistEntry(result));
  saveWatchlist();
  renderWatchlist();
  showToast(`${ticker} added to watchlist.`);
}

function watchlistEntry(result) {
  const rr     = result.risk_report || {};
  const market = result.provider_payloads?.market_data?.data || {};
  return {
    ticker:         result.ticker,
    company:        market.company_name || "—",
    price:          market.current_price ?? null,
    score:          rr.composite_score  ?? null,
    level:          rr.risk_level       ?? null,
    recommendation: rr.recommendation  ?? null,
    analyzed_at:    result.created_at   ?? new Date().toISOString(),
  };
}

function saveWatchlist() {
  localStorage.setItem("finsightWatchlist", JSON.stringify(state.watchlist));
}

function removeFromWatchlist(ticker) {
  state.watchlist = state.watchlist.filter(w => w.ticker !== ticker);
  saveWatchlist();
  renderWatchlist();
  showToast(`${ticker} removed from watchlist.`);
}

async function analyzeWatchlistTicker(ticker) {
  if (state.analyzing.has(ticker)) return;
  state.analyzing.add(ticker);
  renderWatchlist(); // show spinner

  try {
    const response = await fetch(`/api/analyze/${encodeURIComponent(ticker)}`);
    if (!response.ok) throw new Error(await response.text());
    const result = await response.json();
    pushHistory(result);

    // update or add watchlist entry
    const idx = state.watchlist.findIndex(w => w.ticker === ticker);
    if (idx !== -1) state.watchlist[idx] = watchlistEntry(result);
    else state.watchlist.unshift(watchlistEntry(result));

    saveWatchlist();

    // check alert rules for this ticker
    checkAlertsForTicker(ticker, result);

    // if this is the currently viewed result, refresh the overview too
    if (state.result?.ticker === ticker) {
      state.result = result;
      renderAll();
    }
  } catch (e) {
    showToast(`Failed to analyze ${ticker}: ${e.message}`, "error");
  } finally {
    state.analyzing.delete(ticker);
    renderWatchlist();
    renderHistory();
  }
}

function loadWatchlistTicker(ticker) {
  // switch to overview and run analysis for that ticker
  document.getElementById("tickerInput").value = ticker;
  document.querySelectorAll(".nav-item").forEach(b => b.classList.remove("active"));
  document.querySelectorAll(".tab-view").forEach(v => v.classList.remove("active"));
  document.querySelector("[data-tab='overview']").classList.add("active");
  document.getElementById("overview").classList.add("active");
  analyze(ticker);
}

function renderWatchlist() {
  const list  = state.watchlist;
  const count = list.length;

  // nav badge
  const badge = document.getElementById("watchlistCount");
  if (count > 0) {
    badge.textContent = count;
    badge.style.display = "inline-grid";
  } else {
    badge.style.display = "none";
  }

  // summary stats
  const scored = list.filter(w => w.score != null);
  const low    = scored.filter(w => w.level === "low").length;
  const mod    = scored.filter(w => w.level === "moderate").length;
  const high   = scored.filter(w => w.level === "high").length;
  const avgScore = scored.length
    ? (scored.reduce((s, w) => s + Number(w.score), 0) / scored.length).toFixed(1)
    : "—";

  document.getElementById("watchlistSummary").innerHTML = `
    <div class="ws-stat">
      <div class="ws-stat-label">Total Monitored</div>
      <div class="ws-stat-value">${count}</div>
    </div>
    <div class="ws-stat">
      <div class="ws-stat-label">Avg Risk Score</div>
      <div class="ws-stat-value" style="color:var(--blue)">${avgScore}</div>
    </div>
    <div class="ws-stat">
      <div class="ws-stat-label">Low Risk</div>
      <div class="ws-stat-value" style="color:var(--green)">${low}</div>
    </div>
    <div class="ws-stat">
      <div class="ws-stat-label">High Risk</div>
      <div class="ws-stat-value" style="color:var(--red)">${high}</div>
    </div>
  `;

  // empty state
  const empty = document.getElementById("watchlistEmpty");
  const table = document.getElementById("watchlistTable");
  if (count === 0) {
    empty.classList.remove("hidden");
    table.style.display = "none";
    return;
  }
  empty.classList.add("hidden");
  table.style.display = "";

  // table rows
  document.getElementById("watchlistBody").innerHTML = list.map(w => {
    const spinning = state.analyzing.has(w.ticker);
    const scoreStr = w.score != null ? Number(w.score).toFixed(2) : "—";
    const priceStr = w.price != null ? `$${Number(w.price).toFixed(2)}` : "—";
    const date     = w.analyzed_at
      ? new Date(w.analyzed_at).toLocaleString([], { dateStyle: "short", timeStyle: "short" })
      : "—";

    return `
      <tr data-ticker="${escapeHtml(w.ticker)}">
        <td><strong style="font-family:'DM Mono',monospace;letter-spacing:.04em">${escapeHtml(w.ticker)}</strong></td>
        <td style="color:var(--text-3)">${escapeHtml(w.company)}</td>
        <td style="font-family:'DM Mono',monospace">${priceStr}</td>
        <td>
          <span class="wl-score" style="color:${riskColor(w.level)}">${scoreStr}</span>
        </td>
        <td>
          ${w.level
            ? `<span class="badge ${w.level === 'low' ? 'success' : w.level === 'high' ? 'error' : 'warn'}">${title(w.level)}</span>`
            : '<span class="badge">—</span>'}
        </td>
        <td style="color:var(--text-2)">${w.recommendation ? title(w.recommendation) : "—"}</td>
        <td style="color:var(--text-4);font-size:12px">${date}</td>
        <td>
          ${spinning
            ? `<span style="color:var(--text-4);font-size:12px"><span class="wl-spinner"></span>Analyzing…</span>`
            : w.score != null
              ? `<span class="badge success">Ready</span>`
              : `<span class="badge warn">Pending</span>`}
        </td>
        <td class="wl-actions">
          <button class="btn-sm primary" onclick="analyzeWatchlistTicker('${escapeHtml(w.ticker)}')"
            ${spinning ? "disabled" : ""}>↻ Re-run</button>
          <button class="btn-sm ghost" onclick="loadWatchlistTicker('${escapeHtml(w.ticker)}')"
            ${spinning ? "disabled" : ""}>View</button>
          <button class="btn-sm ghost" onclick="removeFromWatchlist('${escapeHtml(w.ticker)}')"
            ${spinning ? "disabled" : ""}>✕</button>
        </td>
      </tr>`;
  }).join("");
}

/* ── TOAST ─────────────────────────────────────────────── */
function showToast(msg, type = "info") {
  const existing = document.getElementById("finsightToast");
  if (existing) existing.remove();
  const toast = document.createElement("div");
  toast.id = "finsightToast";
  toast.textContent = msg;
  Object.assign(toast.style, {
    position: "fixed", bottom: "24px", right: "28px", zIndex: 9999,
    padding: "12px 18px", borderRadius: "8px", fontSize: "13px", fontWeight: "500",
    background: type === "error" ? "var(--red)" : "var(--text-1)",
    color: "#fff", boxShadow: "0 4px 16px rgba(0,0,0,0.2)",
    animation: "fadeInUp .2s ease",
  });
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

/* ── helpers ── */
function breakdown() { return state.result?.metrics?.score_breakdown || []; }
function provider(key) { return state.result?.provider_payloads?.[key]?.data || {}; }

function donutGradient(values) {
  const total = values.reduce((s, v) => s + Number(v), 0) || 1;
  let cur = 0;
  return `conic-gradient(${values.map((v, i) => {
    const start = cur;
    cur += (Number(v) / total) * 360;
    return `${factorColors[i]} ${start}deg ${cur}deg`;
  }).join(", ")})`;
}

function money(v)   { return v == null ? "$--" : `$${Number(v).toFixed(2)}`; }
function compact(v) { return Intl.NumberFormat("en", { notation: "compact" }).format(v); }
function number(v)  { return Number(v).toFixed(2); }
function title(v)   { return String(v || "--").replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()); }
function humanize(v){ return title(v); }
function labelRecommendation(v) {
  const map = {
    hold: "Hold", watch: "Watch", avoid: "Avoid",
    // legacy values from old backend — shown until redeployment
    monitor: "Hold", review: "Watch",
    elevated_risk: "Avoid", high_risk_watch: "Avoid",
  };
  return map[v] || title(v || "--");
}

function recBadgeClass(v) {
  if (v === "hold"  || v === "monitor")                      return "up";
  if (v === "avoid" || v === "elevated_risk" || v === "high_risk_watch") return "down";
  return "neutral";
}

function riskColor(level) {
  if (level === "low")      return "var(--green)";
  if (level === "moderate") return "var(--amber)";
  if (level === "high")     return "var(--red)";
  return "var(--text-4)";
}

function impactLabel(v) {
  if (v >= 7) return "High impact";
  if (v >= 3) return "Med impact";
  return "Low impact";
}

function badgeClass(s) {
  if (s === "success") return "success";
  if (s === "skipped") return "warn";
  return "error";
}

function escapeHtml(v) {
  return v.replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[c]));
}

/* ═══════════════════════════════════════════════════════════
   COMPARISON MODE ENGINE
═══════════════════════════════════════════════════════════ */

function bindCompare() {
  document.getElementById("cmpRunBtn").addEventListener("click", runComparison);
  document.getElementById("cmpTickerA").addEventListener("keydown", e => { if (e.key === "Enter") runComparison(); });
  document.getElementById("cmpTickerB").addEventListener("keydown", e => { if (e.key === "Enter") runComparison(); });
}

async function runComparison() {
  const tickerA = document.getElementById("cmpTickerA").value.trim().toUpperCase();
  const tickerB = document.getElementById("cmpTickerB").value.trim().toUpperCase();
  if (!tickerA || !tickerB) { showToast("Enter both ticker symbols to compare.", "error"); return; }
  if (tickerA === tickerB) { showToast("Enter two different tickers.", "error"); return; }

  // hide empty, show loading
  document.getElementById("cmpEmpty").style.display = "none";
  document.getElementById("cmpVerdict").classList.add("hidden");
  document.getElementById("cmpKpiRow").classList.add("hidden");
  document.getElementById("cmpChartsRow").classList.add("hidden");
  document.getElementById("cmpFactorPanel").classList.add("hidden");
  document.getElementById("cmpSentRow").classList.add("hidden");
  const loadingBar = document.getElementById("cmpLoadingBar");
  const loadingMsg = document.getElementById("cmpLoadingMsg");
  loadingBar.classList.remove("hidden");
  loadingMsg.textContent = `Analyzing ${tickerA} and ${tickerB} in parallel…`;

  document.getElementById("cmpRunBtn").disabled = true;

  try {
    const [resA, resB] = await Promise.all([
      fetchAnalysis(tickerA),
      fetchAnalysis(tickerB),
    ]);
    renderComparison(resA, resB);
  } catch (err) {
    showToast(`Comparison failed: ${err.message}`, "error");
    document.getElementById("cmpEmpty").style.display = "";
  } finally {
    loadingBar.classList.add("hidden");
    document.getElementById("cmpRunBtn").disabled = false;
  }
}

async function fetchAnalysis(ticker) {
  const r = await fetch(`/api/analyze/${encodeURIComponent(ticker)}`);
  if (!r.ok) throw new Error(`${ticker}: ${await r.text()}`);
  return r.json();
}

function renderComparison(resA, resB) {
  const rrA = resA.risk_report || {};
  const rrB = resB.risk_report || {};
  const mktA = resA.provider_payloads?.market_data?.data || {};
  const mktB = resB.provider_payloads?.market_data?.data || {};
  const scoreA = Number(rrA.composite_score ?? 0);
  const scoreB = Number(rrB.composite_score ?? 0);
  const bdA = resA.metrics?.score_breakdown || [];
  const bdB = resB.metrics?.score_breakdown || [];

  // ── Verdict ──
  const diff = Math.abs(scoreA - scoreB).toFixed(2);
  const winnerIsA = scoreA < scoreB;
  const tie = diff < 1;
  const winTicker = winnerIsA ? resA.ticker : resB.ticker;
  const loseTicker = winnerIsA ? resB.ticker : resA.ticker;
  const verdictEl = document.getElementById("cmpVerdict");
  verdictEl.className = `cmp-verdict ${tie ? "tie" : winnerIsA ? "winner-a" : "winner-b"}`;
  verdictEl.innerHTML = `
    <div class="cmp-verdict-badge ${tie ? "" : winnerIsA ? "a" : "b"}">${tie ? "≈ TIE" : winTicker}</div>
    <div class="cmp-verdict-text">
      <h3>${tie ? "Near-identical risk profiles" : `${winTicker} carries lower overall risk`}</h3>
      <p>${tie
        ? `Both tickers score within 1 point of each other (${scoreA.toFixed(2)} vs ${scoreB.toFixed(2)}). Consider factor-level differences below.`
        : `${winTicker} scores ${diff} points lower than ${loseTicker} (${Math.min(scoreA,scoreB).toFixed(2)} vs ${Math.max(scoreA,scoreB).toFixed(2)}). ${title(winnerIsA ? rrA.recommendation : rrB.recommendation)} vs ${title(winnerIsA ? rrB.recommendation : rrA.recommendation)}.`
      }</p>
    </div>
    <div class="cmp-verdict-stats">
      <div class="cmp-verdict-stat">
        <div class="cmp-verdict-stat-val" style="color:var(--blue)">${scoreA.toFixed(1)}</div>
        <div class="cmp-verdict-stat-lbl">${resA.ticker} score</div>
      </div>
      <div class="cmp-verdict-stat">
        <div class="cmp-verdict-stat-val" style="color:#7c3aed">${scoreB.toFixed(1)}</div>
        <div class="cmp-verdict-stat-lbl">${resB.ticker} score</div>
      </div>
      <div class="cmp-verdict-stat">
        <div class="cmp-verdict-stat-val">${diff}</div>
        <div class="cmp-verdict-stat-lbl">Δ Difference</div>
      </div>
    </div>
  `;
  verdictEl.classList.remove("hidden");

  // ── KPI columns ──
  document.getElementById("cmpHeaderA").textContent = resA.ticker;
  document.getElementById("cmpHeaderB").textContent = resB.ticker;

  const aWinsScore = scoreA < scoreB;
  document.getElementById("cmpKpiA").innerHTML = `
    <div class="cmp-kpi-cell">
      <div class="cmp-kpi-val">${money(mktA.current_price)}</div>
      <div class="cmp-kpi-sub">${mktA.volume ? "Vol " + compact(mktA.volume) : "—"}</div>
    </div>
    <div class="cmp-kpi-cell ${aWinsScore ? "cmp-win" : ""}">
      <div class="cmp-kpi-val" style="color:${riskColor(rrA.risk_level)}">${scoreA.toFixed(2)}</div>
      <div class="risk-scale" style="width:100%;max-width:160px"><i style="left:${Math.max(0,Math.min(100,scoreA))}%"></i></div>
    </div>
    <div class="cmp-kpi-cell">
      <div class="cmp-kpi-val" style="font-size:16px;font-weight:800;color:${riskColor(rrA.risk_level)}">${title(rrA.risk_level)}</div>
      <div class="cmp-kpi-sub">${title(rrA.recommendation)}</div>
    </div>
    <div class="cmp-kpi-cell">
      <div class="cmp-kpi-val" style="font-size:16px;font-weight:800;color:${resA.validation?.deterministic_check_passed ? "var(--green)" : "var(--red)"}">
        ${resA.validation?.deterministic_check_passed ? "Passed" : "Failed"}
      </div>
      <div class="cmp-kpi-sub">${title(resA.data_quality)} Quality</div>
    </div>
  `;
  document.getElementById("cmpKpiB").innerHTML = `
    <div class="cmp-kpi-cell">
      <div class="cmp-kpi-val">${money(mktB.current_price)}</div>
      <div class="cmp-kpi-sub">${mktB.volume ? "Vol " + compact(mktB.volume) : "—"}</div>
    </div>
    <div class="cmp-kpi-cell ${!aWinsScore ? "cmp-win" : ""}">
      <div class="cmp-kpi-val" style="color:${riskColor(rrB.risk_level)}">${scoreB.toFixed(2)}</div>
      <div class="risk-scale" style="width:100%;max-width:160px"><i style="left:${Math.max(0,Math.min(100,scoreB))}%"></i></div>
    </div>
    <div class="cmp-kpi-cell">
      <div class="cmp-kpi-val" style="font-size:16px;font-weight:800;color:${riskColor(rrB.risk_level)}">${title(rrB.risk_level)}</div>
      <div class="cmp-kpi-sub">${title(rrB.recommendation)}</div>
    </div>
    <div class="cmp-kpi-cell">
      <div class="cmp-kpi-val" style="font-size:16px;font-weight:800;color:${resB.validation?.deterministic_check_passed ? "var(--green)" : "var(--red)"}">
        ${resB.validation?.deterministic_check_passed ? "Passed" : "Failed"}
      </div>
      <div class="cmp-kpi-sub">${title(resB.data_quality)} Quality</div>
    </div>
  `;
  document.getElementById("cmpKpiRow").classList.remove("hidden");

  // ── Bar chart ──
  const allLabels = [...new Set([...bdA.map(f=>f.label), ...bdB.map(f=>f.label)])];
  const maxContrib = Math.max(...bdA.map(f=>Number(f.contribution)), ...bdB.map(f=>Number(f.contribution)), 1);
  document.getElementById("cmpBreakdownChart").innerHTML = allLabels.map(label => {
    const fA = bdA.find(f => f.label === label);
    const fB = bdB.find(f => f.label === label);
    const vA = fA ? Number(fA.contribution) : 0;
    const vB = fB ? Number(fB.contribution) : 0;
    const pA = (vA / maxContrib * 100).toFixed(1);
    const pB = (vB / maxContrib * 100).toFixed(1);
    return `
      <div class="cmp-bar-row">
        <div class="cmp-bar-label">${label}</div>
        <div class="cmp-bar-track a"><div class="cmp-bar-fill" style="width:${pA}%"></div></div>
        <div class="cmp-bar-val-a">${vA.toFixed(2)}</div>
        <div class="cmp-bar-val-b">${vB.toFixed(2)}</div>
        <div class="cmp-bar-track b"><div class="cmp-bar-fill" style="width:${pB}%"></div></div>
      </div>`;
  }).join("");

  // ── Radar chart ──
  renderCmpRadar(bdA, bdB, resA.ticker, resB.ticker);

  document.getElementById("cmpChartsRow").classList.remove("hidden");

  // ── Factor table ──
  document.getElementById("cmpThA").textContent = resA.ticker;
  document.getElementById("cmpThB").textContent = resB.ticker;
  document.getElementById("cmpFactorBody").innerHTML = allLabels.map(label => {
    const fA = bdA.find(f => f.label === label);
    const fB = bdB.find(f => f.label === label);
    const cA = fA ? Number(fA.contribution) : null;
    const cB = fB ? Number(fB.contribution) : null;
    const delta = cA != null && cB != null ? (cA - cB) : null;
    const edgeA = cA != null && cB != null && cA < cB;
    const edgeB = cA != null && cB != null && cB < cA;
    const tied  = delta != null && Math.abs(delta) < 0.5;

    let deltaHtml = '<span class="cmp-delta-nil">—</span>';
    if (delta != null) {
      const sign = delta > 0 ? "+" : "";
      deltaHtml = `<span class="${delta > 0.5 ? "cmp-delta-pos" : delta < -0.5 ? "cmp-delta-neg" : "cmp-delta-nil"}">${sign}${delta.toFixed(2)}</span>`;
    }

    return `<tr>
      <td><strong>${label}</strong><br><small style="color:var(--text-4)">${fA?.source || fB?.source || "—"}</small></td>
      <td style="font-family:'DM Mono',monospace;font-weight:600;color:${edgeA?"var(--blue-d)":"var(--text-2)"}">${cA != null ? cA.toFixed(2) : "—"}</td>
      <td>${deltaHtml}</td>
      <td style="font-family:'DM Mono',monospace;font-weight:600;color:${edgeB?"#5b21b6":"var(--text-2)"}">${cB != null ? cB.toFixed(2) : "—"}</td>
      <td>${tied ? '<span class="cmp-edge-tie">Tie</span>' : edgeA ? `<span class="cmp-edge-a">${resA.ticker} ▲</span>` : `<span class="cmp-edge-b">${resB.ticker} ▲</span>`}</td>
    </tr>`;
  }).join("");
  document.getElementById("cmpFactorPanel").classList.remove("hidden");

  // ── Sentiment + Drivers ──
  const newsA = resA.provider_payloads?.news_sentiment_data?.data || {};
  const newsB = resB.provider_payloads?.news_sentiment_data?.data || {};
  const sentA = newsA.sentiment_score;
  const sentB = newsB.sentiment_score;

  document.getElementById("cmpSentiment").innerHTML = `
    <div class="cmp-sent-col">
      <div class="cmp-sent-ticker a">${resA.ticker}</div>
      <div class="cmp-sent-score" style="color:${sentA==null?"var(--text-4)":Number(sentA)>=0?"var(--green)":"var(--red)"}">${sentA==null?"N/A":Number(sentA).toFixed(4)}</div>
      <div class="sentiment-scale" style="margin-top:8px"><i style="left:${sentA==null?50:((Number(sentA)+1)/2)*100}%"></i></div>
      <div style="margin-top:10px;display:flex;flex-direction:column;gap:4px">
        ${(newsA.headlines||[]).slice(0,3).map(h=>`<div class="headline-item"><span>${escapeHtml(h)}</span></div>`).join("")}
      </div>
    </div>
    <div class="cmp-sent-col">
      <div class="cmp-sent-ticker b">${resB.ticker}</div>
      <div class="cmp-sent-score" style="color:${sentB==null?"var(--text-4)":Number(sentB)>=0?"var(--green)":"var(--red)"}">${sentB==null?"N/A":Number(sentB).toFixed(4)}</div>
      <div class="sentiment-scale" style="margin-top:8px"><i style="left:${sentB==null?50:((Number(sentB)+1)/2)*100}%"></i></div>
      <div style="margin-top:10px;display:flex;flex-direction:column;gap:4px">
        ${(newsB.headlines||[]).slice(0,3).map(h=>`<div class="headline-item"><span>${escapeHtml(h)}</span></div>`).join("")}
      </div>
    </div>`;

  const topA = [...bdA].sort((a,b)=>b.contribution-a.contribution).slice(0,4);
  const topB = [...bdB].sort((a,b)=>b.contribution-a.contribution).slice(0,4);
  document.getElementById("cmpDrivers").innerHTML = `
    <div class="cmp-drivers-col">
      <div class="cmp-sent-ticker a">${resA.ticker}</div>
      ${topA.map(f=>`<div class="driver-item"><span>${f.label}<small class="muted"> ${f.display_value}</small></span><span class="badge ${f.status==="actual"?"success":"warn"}">${impactLabel(f.contribution)}</span></div>`).join("")}
    </div>
    <div class="cmp-drivers-col">
      <div class="cmp-sent-ticker b">${resB.ticker}</div>
      ${topB.map(f=>`<div class="driver-item"><span>${f.label}<small class="muted"> ${f.display_value}</small></span><span class="badge ${f.status==="actual"?"success":"warn"}">${impactLabel(f.contribution)}</span></div>`).join("")}
    </div>`;

  document.getElementById("cmpSentRow").classList.remove("hidden");
}

function renderCmpRadar(bdA, bdB, tickerA, tickerB) {
  const svg = document.getElementById("cmpRadar");
  const factors = [...new Set([...bdA.map(f=>f.label), ...bdB.map(f=>f.label)])].slice(0, 6);
  const N = factors.length;
  if (N < 3) { svg.innerHTML = `<text x="200" y="170" text-anchor="middle" fill="#94a3b8" font-size="12">Not enough factors</text>`; return; }

  const cx = 200, cy = 155, R = 110;
  const maxVal = Math.max(
    ...bdA.map(f=>Number(f.normalized_risk||0)),
    ...bdB.map(f=>Number(f.normalized_risk||0)), 1
  );

  const angle = i => (Math.PI * 2 * i / N) - Math.PI / 2;
  const pt = (i, r) => ({ x: cx + r * Math.cos(angle(i)), y: cy + r * Math.sin(angle(i)) });

  // grid circles
  let grid = "";
  [0.25, 0.5, 0.75, 1].forEach(pct => {
    const r = R * pct;
    const pts = factors.map((_,i) => pt(i, r));
    grid += `<polygon points="${pts.map(p=>`${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ")}" fill="none" stroke="#e2e8f0" stroke-width="1"/>`;
    // ring labels at 25/50/75/100
    const lp = pt(0, r);
    grid += `<text x="${(lp.x+4).toFixed(1)}" y="${(lp.y-3).toFixed(1)}" fill="#94a3b8" font-size="9" font-family="'DM Mono',monospace">${Math.round(pct*100)}</text>`;
  });

  // spokes + labels
  let spokes = "", labels = "";
  factors.forEach((f, i) => {
    const outer = pt(i, R);
    spokes += `<line x1="${cx}" y1="${cy}" x2="${outer.x.toFixed(1)}" y2="${outer.y.toFixed(1)}" stroke="#e2e8f0" stroke-width="1"/>`;
    const lp = pt(i, R + 18);
    labels += `<text x="${lp.x.toFixed(1)}" y="${lp.y.toFixed(1)}" text-anchor="middle" fill="#64748b" font-size="10" font-family="'Plus Jakarta Sans',sans-serif" font-weight="600">${f}</text>`;
  });

  // polygon for each ticker
  const polyPts = (bd) => factors.map((f,i) => {
    const factor = bd.find(b => b.label === f);
    const v = factor ? Math.min(Number(factor.normalized_risk||0) / maxVal, 1) : 0;
    return pt(i, R * v);
  });

  const toPath = pts => pts.map((p,i) => `${i?"L":"M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ") + "Z";
  const ptsA = polyPts(bdA);
  const ptsB = polyPts(bdB);

  svg.innerHTML = `
    <defs>
      <radialGradient id="radarGradA"><stop offset="0%" stop-color="#465fff" stop-opacity=".18"/><stop offset="100%" stop-color="#465fff" stop-opacity=".04"/></radialGradient>
      <radialGradient id="radarGradB"><stop offset="0%" stop-color="#7c3aed" stop-opacity=".18"/><stop offset="100%" stop-color="#7c3aed" stop-opacity=".04"/></radialGradient>
    </defs>
    ${grid}${spokes}
    <path d="${toPath(ptsA)}" fill="url(#radarGradA)" stroke="#465fff" stroke-width="2" stroke-linejoin="round"/>
    <path d="${toPath(ptsB)}" fill="url(#radarGradB)" stroke="#7c3aed" stroke-width="2" stroke-linejoin="round"/>
    ${ptsA.map(p=>`<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3.5" fill="#465fff" stroke="#fff" stroke-width="1.5"/>`).join("")}
    ${ptsB.map(p=>`<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3.5" fill="#7c3aed" stroke="#fff" stroke-width="1.5"/>`).join("")}
    ${labels}
  `;

  document.getElementById("cmpRadarLegend").innerHTML = `
    <span><i style="background:#465fff"></i>${tickerA}</span>
    <span><i style="background:#7c3aed"></i>${tickerB}</span>
  `;
}

/* ═══════════════════════════════════════════════════════════
   ALERTS & SCHEDULING ENGINE
═══════════════════════════════════════════════════════════ */

/* ── bind alert UI ───────────────────────────────────────── */
function bindAlerts() {
  // open modal for new rule
  document.getElementById("addAlertBtn").addEventListener("click", () => openAlertModal(null));

  // modal controls
  document.getElementById("alertModalClose").addEventListener("click", closeAlertModal);
  document.getElementById("alertModalCancel").addEventListener("click", closeAlertModal);
  document.getElementById("alertModalSave").addEventListener("click", saveAlertRule);
  document.getElementById("alertModal").addEventListener("click", e => {
    if (e.target === e.currentTarget) closeAlertModal();
  });

  // toggle show/hide sub-configs
  document.getElementById("alertScoreEnabled").addEventListener("change", e => {
    document.getElementById("alertScoreConfig").classList.toggle("hidden", !e.target.checked);
  });
  document.getElementById("alertIntervalEnabled").addEventListener("change", e => {
    document.getElementById("alertIntervalConfig").classList.toggle("hidden", !e.target.checked);
  });
  document.getElementById("alertTimeEnabled").addEventListener("change", e => {
    document.getElementById("alertTimeConfig").classList.toggle("hidden", !e.target.checked);
  });

  // notification log controls
  document.getElementById("clearNotifBtn").addEventListener("click", () => {
    state.notifications = [];
    saveNotifications();
    renderAlerts();
    updateNotifBadge();
    renderNotifCentre();
  });
}

/* ── modal open/close ────────────────────────────────────── */
function openAlertModal(ruleId) {
  state._editingRuleId = ruleId;
  const rule = ruleId ? state.alertRules.find(r => r.id === ruleId) : null;

  // populate fields
  const tickerEl   = document.getElementById("alertTicker");
  const scoreEn    = document.getElementById("alertScoreEnabled");
  const scoreDir   = document.getElementById("alertScoreDir");
  const scoreVal   = document.getElementById("alertScoreVal");
  const levelEn    = document.getElementById("alertLevelEnabled");
  const intervalEn = document.getElementById("alertIntervalEnabled");
  const intervalV  = document.getElementById("alertIntervalVal");
  const timeEn     = document.getElementById("alertTimeEnabled");
  const timeV      = document.getElementById("alertTimeVal");

  if (rule) {
    tickerEl.value       = rule.ticker;
    tickerEl.disabled    = true;
    scoreEn.checked      = rule.scoreEnabled;
    scoreDir.value       = rule.scoreDir || "above";
    scoreVal.value       = rule.scoreThreshold ?? 60;
    levelEn.checked      = rule.levelEnabled;
    intervalEn.checked   = rule.intervalEnabled;
    intervalV.value      = rule.intervalMinutes ?? 15;
    timeEn.checked       = rule.timeEnabled;
    timeV.value          = rule.scheduledTime || "09:00";
    document.getElementById("alertModalTitle").textContent = `Edit Alert — ${rule.ticker}`;
  } else {
    tickerEl.value       = state.result?.ticker || "";
    tickerEl.disabled    = false;
    scoreEn.checked      = true;
    scoreDir.value       = "above";
    scoreVal.value       = 60;
    levelEn.checked      = false;
    intervalEn.checked   = false;
    intervalV.value      = 15;
    timeEn.checked       = false;
    timeV.value          = "09:00";
    document.getElementById("alertModalTitle").textContent = "Configure Alert Rule";
  }

  // sync visibility
  document.getElementById("alertScoreConfig").classList.toggle("hidden", !scoreEn.checked);
  document.getElementById("alertIntervalConfig").classList.toggle("hidden", !intervalEn.checked);
  document.getElementById("alertTimeConfig").classList.toggle("hidden", !timeEn.checked);

  document.getElementById("alertModal").classList.remove("hidden");
  tickerEl.focus();
}

function closeAlertModal() {
  document.getElementById("alertModal").classList.add("hidden");
  state._editingRuleId = null;
}

/* ── save rule ───────────────────────────────────────────── */
function saveAlertRule() {
  const ticker = document.getElementById("alertTicker").value.trim().toUpperCase();
  if (!ticker) { showToast("Please enter a ticker symbol.", "error"); return; }

  const scoreEnabled    = document.getElementById("alertScoreEnabled").checked;
  const levelEnabled    = document.getElementById("alertLevelEnabled").checked;
  const intervalEnabled = document.getElementById("alertIntervalEnabled").checked;
  const timeEnabled     = document.getElementById("alertTimeEnabled").checked;

  if (!scoreEnabled && !levelEnabled && !intervalEnabled && !timeEnabled) {
    showToast("Enable at least one trigger condition or schedule.", "error"); return;
  }

  const rule = {
    id:               state._editingRuleId || `rule_${Date.now()}`,
    ticker,
    scoreEnabled,
    scoreDir:         document.getElementById("alertScoreDir").value,
    scoreThreshold:   Number(document.getElementById("alertScoreVal").value),
    levelEnabled,
    intervalEnabled,
    intervalMinutes:  Number(document.getElementById("alertIntervalVal").value),
    timeEnabled,
    scheduledTime:    document.getElementById("alertTimeVal").value,
    enabled:          true,
    lastTriggered:    null,
    nextRun:          null,
    prevLevel:        null,
    createdAt:        state._editingRuleId
      ? (state.alertRules.find(r => r.id === state._editingRuleId)?.createdAt || new Date().toISOString())
      : new Date().toISOString(),
  };

  if (state._editingRuleId) {
    const idx = state.alertRules.findIndex(r => r.id === state._editingRuleId);
    if (idx !== -1) state.alertRules[idx] = rule;
    stopRuleSchedule(state._editingRuleId);
  } else {
    // check for duplicate ticker
    const exists = state.alertRules.find(r => r.ticker === ticker);
    if (exists) { showToast(`An alert rule for ${ticker} already exists. Edit it instead.`, "error"); return; }
    state.alertRules.unshift(rule);
    // auto-add to watchlist so scheduling has a refresh path
    if (!state.watchlist.find(w => w.ticker === ticker)) {
      addToWatchlist({ ticker, risk_report: null, provider_payloads: {} });
    }
  }

  saveAlertRules();
  startRuleSchedule(rule);
  closeAlertModal();
  renderAlerts();
  showToast(`Alert rule for ${ticker} saved.`);
}

function saveAlertRules() {
  localStorage.setItem("finsightAlertRules", JSON.stringify(state.alertRules));
}

/* ── delete / toggle rule ────────────────────────────────── */
function deleteAlertRule(id) {
  stopRuleSchedule(id);
  state.alertRules = state.alertRules.filter(r => r.id !== id);
  saveAlertRules();
  renderAlerts();
  showToast("Alert rule deleted.");
}

function toggleAlertRule(id) {
  const rule = state.alertRules.find(r => r.id === id);
  if (!rule) return;
  rule.enabled = !rule.enabled;
  if (rule.enabled) startRuleSchedule(rule);
  else stopRuleSchedule(id);
  saveAlertRules();
  renderAlerts();
}

/* ── scheduler ───────────────────────────────────────────── */
function startScheduler() {
  state.alertRules.forEach(rule => { if (rule.enabled) startRuleSchedule(rule); });
  // check daily schedules every minute
  setInterval(checkDailySchedules, 60_000);
}

function startRuleSchedule(rule) {
  if (!rule.enabled || !rule.intervalEnabled) return;
  stopRuleSchedule(rule.id);
  const ms = rule.intervalMinutes * 60 * 1000;
  const handle = setInterval(() => runScheduledAnalysis(rule.id), ms);
  state._schedIntervals[rule.id] = handle;
  // set nextRun
  rule.nextRun = new Date(Date.now() + ms).toISOString();
  saveAlertRules();
}

function stopRuleSchedule(id) {
  if (state._schedIntervals[id]) {
    clearInterval(state._schedIntervals[id]);
    delete state._schedIntervals[id];
  }
}

function checkDailySchedules() {
  const now = new Date();
  const hhmm = `${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}`;
  const today = now.toDateString();
  state.alertRules.forEach(rule => {
    if (!rule.enabled || !rule.timeEnabled) return;
    if (rule.scheduledTime !== hhmm) return;
    if (state._dailyFired[rule.id] === today) return;
    state._dailyFired[rule.id] = today;
    localStorage.setItem("finsightDailyFired", JSON.stringify(state._dailyFired));
    runScheduledAnalysis(rule.id);
  });
}

async function runScheduledAnalysis(ruleId) {
  const rule = state.alertRules.find(r => r.id === ruleId);
  if (!rule || !rule.enabled) return;

  // update nextRun
  if (rule.intervalEnabled) {
    rule.nextRun = new Date(Date.now() + rule.intervalMinutes * 60 * 1000).toISOString();
  }

  await analyzeWatchlistTicker(rule.ticker);
  // alert checking happens inside analyzeWatchlistTicker via checkAlertsForTicker
  pushNotification({
    type: "sched",
    ticker: rule.ticker,
    title: `Scheduled refresh — ${rule.ticker}`,
    msg: `Auto-analysis completed. Check overview for updated risk score.`,
  });
  renderAlerts();
}

/* ── alert checking ──────────────────────────────────────── */
function checkAlertsForTicker(ticker, result) {
  const rr    = result.risk_report || {};
  const score = Number(rr.composite_score ?? 0);
  const level = rr.risk_level || null;

  state.alertRules.forEach(rule => {
    if (rule.ticker !== ticker || !rule.enabled) return;

    // score threshold
    if (rule.scoreEnabled) {
      const breached = rule.scoreDir === "above"
        ? score > rule.scoreThreshold
        : score < rule.scoreThreshold;
      if (breached) {
        rule.lastTriggered = new Date().toISOString();
        pushNotification({
          type: "breach",
          ticker,
          title: `⚠ Score alert — ${ticker}`,
          msg: `Risk score ${score.toFixed(2)} is ${rule.scoreDir} threshold ${rule.scoreThreshold}. Level: ${title(level)}.`,
        });
        showAlertBanner(`${ticker} score ${score.toFixed(2)} ${rule.scoreDir} ${rule.scoreThreshold} — threshold breached!`, "error");
      }
    }

    // level change
    if (rule.levelEnabled && rule.prevLevel && rule.prevLevel !== level) {
      rule.lastTriggered = new Date().toISOString();
      pushNotification({
        type: "level",
        ticker,
        title: `Risk level changed — ${ticker}`,
        msg: `Level moved from ${title(rule.prevLevel)} to ${title(level)}.`,
      });
      showAlertBanner(`${ticker} risk level changed: ${title(rule.prevLevel)} → ${title(level)}`, "warn");
    }
    rule.prevLevel = level;
  });

  saveAlertRules();
  renderAlerts();
  updateNotifBadge();
  renderNotifCentre();
}

/* ── notifications ───────────────────────────────────────── */
function pushNotification(notif) {
  state.notifications.unshift({
    id:        `notif_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,
    type:      notif.type,
    ticker:    notif.ticker,
    title:     notif.title,
    msg:       notif.msg,
    time:      new Date().toISOString(),
    read:      false,
  });
  state.notifications = state.notifications.slice(0, 100);
  saveNotifications();
  updateNotifBadge();
  renderNotifCentre();
}

function saveNotifications() {
  localStorage.setItem("finsightNotifications", JSON.stringify(state.notifications));
}

function updateNotifBadge() {
  const unread = state.notifications.filter(n => !n.read).length;
  const badge  = document.getElementById("notifBadge");
  const count  = document.getElementById("alertsCount");
  if (unread > 0) {
    badge.textContent = unread > 99 ? "99+" : unread;
    badge.classList.remove("hidden");
    count.textContent = unread;
    count.style.display = "inline-grid";
  } else {
    badge.classList.add("hidden");
    count.style.display = "none";
  }
}

/* ── notification bell & centre ─────────────────────────── */
function bindNotifBell() {
  document.getElementById("notifBell").addEventListener("click", () => {
    document.getElementById("notifCentre").classList.toggle("hidden");
    renderNotifCentre();
  });
  document.getElementById("notifCentreClose").addEventListener("click", () => {
    document.getElementById("notifCentre").classList.add("hidden");
  });
  document.getElementById("notifMarkAll").addEventListener("click", () => {
    state.notifications.forEach(n => { n.read = true; });
    saveNotifications();
    updateNotifBadge();
    renderNotifCentre();
    renderAlerts();
  });
}

function renderNotifCentre() {
  const list = document.getElementById("notifCentreList");
  if (!state.notifications.length) {
    list.innerHTML = `<div style="padding:24px;text-align:center;color:var(--text-4);font-size:12px;">No notifications yet</div>`;
    return;
  }
  list.innerHTML = state.notifications.slice(0, 30).map(n => `
    <div class="notif-centre-item ${n.read ? "" : "unread"}" onclick="markNotifRead('${n.id}')">
      <div class="notif-centre-dot ${n.type}"></div>
      <div class="notif-centre-text">
        <div class="notif-centre-title">${escapeHtml(n.title)}</div>
        <div class="notif-centre-msg">${escapeHtml(n.msg)}</div>
        <div class="notif-centre-time">${timeAgo(n.time)}</div>
      </div>
    </div>
  `).join("");
}

function markNotifRead(id) {
  const n = state.notifications.find(n => n.id === id);
  if (n) { n.read = true; saveNotifications(); updateNotifBadge(); renderNotifCentre(); }
}

/* ── render alerts tab ───────────────────────────────────── */
function renderAlerts() {
  const rules = state.alertRules;
  const notifs = state.notifications;

  // summary
  const active   = rules.filter(r => r.enabled).length;
  const total    = rules.length;
  const breaches = notifs.filter(n => n.type === "breach").length;
  const unread   = notifs.filter(n => !n.read).length;

  document.getElementById("alertSummary").innerHTML = `
    <div class="ws-stat"><div class="ws-stat-label">Total Rules</div><div class="ws-stat-value">${total}</div></div>
    <div class="ws-stat"><div class="ws-stat-label">Active</div><div class="ws-stat-value" style="color:var(--green)">${active}</div></div>
    <div class="ws-stat"><div class="ws-stat-label">Breaches</div><div class="ws-stat-value" style="color:var(--red)">${breaches}</div></div>
    <div class="ws-stat"><div class="ws-stat-label">Unread</div><div class="ws-stat-value" style="color:var(--blue)">${unread}</div></div>
  `;

  // rules count
  document.getElementById("alertRulesCount").textContent = `${total} rule${total !== 1 ? "s" : ""}`;

  // rules table
  const empty = document.getElementById("alertRulesEmpty");
  const table = document.getElementById("alertRulesTable");
  if (!total) {
    empty.classList.remove("hidden");
    table.style.display = "none";
  } else {
    empty.classList.add("hidden");
    table.style.display = "";
    document.getElementById("alertRulesBody").innerHTML = rules.map(r => {
      const conditions = [];
      if (r.scoreEnabled) conditions.push(`<span class="alert-cond-tag">Score ${r.scoreDir} ${r.scoreThreshold}</span>`);
      if (r.levelEnabled) conditions.push(`<span class="alert-cond-tag level">Level change</span>`);

      const schedParts = [];
      if (r.intervalEnabled) schedParts.push(`Every ${r.intervalMinutes}m`);
      if (r.timeEnabled) schedParts.push(`Daily ${r.scheduledTime}`);

      const lastTrig = r.lastTriggered
        ? new Date(r.lastTriggered).toLocaleString([], { dateStyle:"short", timeStyle:"short" })
        : "Never";
      const nextRun  = r.nextRun && r.intervalEnabled
        ? new Date(r.nextRun).toLocaleString([], { dateStyle:"short", timeStyle:"short" })
        : (r.timeEnabled ? `Daily ${r.scheduledTime}` : "—");

      return `
        <tr>
          <td><strong style="font-family:'DM Mono',monospace;letter-spacing:.04em">${escapeHtml(r.ticker)}</strong></td>
          <td style="display:flex;gap:4px;flex-wrap:wrap;padding:10px 14px">${conditions.join("") || "<span style='color:var(--text-4)'>—</span>"}</td>
          <td style="font-family:'DM Mono',monospace">${r.scoreEnabled ? r.scoreThreshold : "—"}</td>
          <td>${schedParts.length ? schedParts.map(s => `<span class="alert-cond-tag sched">${s}</span>`).join(" ") : "<span style='color:var(--text-4)'>Manual only</span>"}</td>
          <td>
            <span class="badge ${r.enabled ? "success" : "warn"}" style="cursor:pointer" onclick="toggleAlertRule('${r.id}')">
              ${r.enabled ? "Active" : "Paused"}
            </span>
          </td>
          <td style="font-size:12px;color:var(--text-4)">${lastTrig}</td>
          <td style="font-size:12px;color:var(--text-4)">${nextRun}</td>
          <td class="wl-actions">
            <button class="btn-sm primary" onclick="openAlertModal('${r.id}')">Edit</button>
            <button class="btn-sm ghost" onclick="runScheduledAnalysis('${r.id}')">Run</button>
            <button class="btn-sm ghost" onclick="deleteAlertRule('${r.id}')">✕</button>
          </td>
        </tr>`;
    }).join("");
  }

  // notification log
  const logEl    = document.getElementById("notifLog");
  const logEmpty = document.getElementById("notifLogEmpty");
  if (!notifs.length) {
    logEl.innerHTML = "";
    logEmpty.classList.remove("hidden");
  } else {
    logEmpty.classList.add("hidden");
    const icons = { breach: "⚠", level: "↕", sched: "↻", info: "ℹ" };
    logEl.innerHTML = notifs.slice(0, 50).map(n => `
      <div class="notif-log-item ${n.read ? "" : "notif-log-unread"}" onclick="markNotifRead('${n.id}')">
        <div class="notif-log-icon ${n.type}">${icons[n.type] || "•"}</div>
        <div class="notif-log-body">
          <div class="notif-log-title">${escapeHtml(n.title)}</div>
          <div class="notif-log-msg">${escapeHtml(n.msg)}</div>
          <div class="notif-log-time">${timeAgo(n.time)}</div>
        </div>
      </div>
    `).join("");
  }
}

/* ── in-app alert banner ─────────────────────────────────── */
function showAlertBanner(msg, type = "info") {
  const existing = document.getElementById("finsightAlertBanner");
  if (existing) existing.remove();
  const banner = document.createElement("div");
  banner.id = "finsightAlertBanner";
  const bg = type === "error" ? "var(--red)" : type === "warn" ? "var(--amber)" : "var(--blue)";
  Object.assign(banner.style, {
    position: "fixed", top: "16px", left: "50%", transform: "translateX(-50%)",
    zIndex: 9999, padding: "12px 20px", borderRadius: "8px",
    fontSize: "13px", fontWeight: "600", background: bg, color: "#fff",
    boxShadow: "0 4px 20px rgba(0,0,0,0.25)", maxWidth: "520px", textAlign: "center",
    animation: "fadeInUp .25s ease",
  });
  banner.textContent = `🔔 ${msg}`;
  document.body.appendChild(banner);
  setTimeout(() => banner.remove(), 6000);
}

/* ── utility ─────────────────────────────────────────────── */
function timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1)  return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  return new Date(iso).toLocaleDateString();
}

/* ═══════════════════════════════════════════════════════════
   BACKTEST ENGINE
═══════════════════════════════════════════════════════════ */

function bindBacktest() {
  document.getElementById("btRunBtn").addEventListener("click", runBacktest);
  document.getElementById("btTicker").addEventListener("keydown", e => { if (e.key === "Enter") runBacktest(); });
}

function switchToBacktest() {
  const ticker = state.result?.ticker;
  if (ticker) document.getElementById("btTicker").value = ticker;
  document.querySelectorAll(".nav-item").forEach(b => b.classList.remove("active"));
  document.querySelectorAll(".tab-view").forEach(v => v.classList.remove("active"));
  document.querySelector('[data-tab="backtest"]').classList.add("active");
  document.getElementById("backtest").classList.add("active");
  if (ticker) runBacktest();
}

// Pre-fill backtest ticker whenever a new analysis completes
function syncBacktestTicker(ticker) {
  const btEl = document.getElementById("btTicker");
  if (!btEl.dataset.userSet) btEl.value = ticker;
}

async function runBacktest() {
  const ticker   = document.getElementById("btTicker").value.trim().toUpperCase();
  const period   = document.getElementById("btPeriod").value;
  const interval = document.getElementById("btInterval").value;

  if (!ticker) { showToast("Enter a ticker to backtest.", "error"); return; }

  // hide everything
  document.getElementById("btEmpty").style.display = "none";
  document.getElementById("btStatsStrip").classList.add("hidden");
  document.getElementById("btChartPanel").classList.add("hidden");
  document.getElementById("btSignalPanel").classList.add("hidden");
  document.getElementById("btDistRow").classList.add("hidden");
  document.getElementById("btError").classList.add("hidden");

  const loadingEl = document.getElementById("btLoading");
  const loadMsg   = document.getElementById("btLoadingMsg");
  loadingEl.classList.remove("hidden");
  loadMsg.textContent = `Fetching ${ticker} price history…`;
  document.getElementById("btRunBtn").disabled = true;

  try {
    const priceData = await fetchYahooPrice(ticker, period, interval);
    loadMsg.textContent = "Aligning risk scores…";
    const runHistory = state.history.filter(r => r.ticker === ticker);
    renderBacktest(ticker, priceData, runHistory, period);
  } catch (err) {
    const errEl = document.getElementById("btError");
    errEl.textContent = `Could not load price data for ${ticker}: ${err.message}. Try a different ticker or period.`;
    errEl.classList.remove("hidden");
    document.getElementById("btEmpty").style.display = "";
  } finally {
    loadingEl.classList.add("hidden");
    document.getElementById("btRunBtn").disabled = false;
  }
}

/* ── Yahoo Finance price fetch via public chart API ─────── */
async function fetchYahooPrice(ticker, period, interval) {
  // Yahoo Finance v8 chart endpoint — no API key required
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}` +
    `?range=${period}&interval=${interval}&includePrePost=false&events=div%2Csplit`;

  const proxy = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
  const r = await fetch(proxy);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const json = await r.json();

  const result = json?.chart?.result?.[0];
  if (!result) throw new Error("No data returned");

  const timestamps = result.timestamp || [];
  const closes     = result.indicators?.quote?.[0]?.close || [];
  const highs      = result.indicators?.quote?.[0]?.high  || [];
  const lows       = result.indicators?.quote?.[0]?.low   || [];

  const bars = [];
  for (let i = 0; i < timestamps.length; i++) {
    if (closes[i] == null) continue;
    bars.push({
      date:  new Date(timestamps[i] * 1000),
      close: closes[i],
      high:  highs[i]  ?? closes[i],
      low:   lows[i]   ?? closes[i],
    });
  }
  if (!bars.length) throw new Error("Empty price series");
  return bars;
}

/* ── main render ────────────────────────────────────────── */
function renderBacktest(ticker, bars, runs, period) {
  // ── align risk scores to price dates ──────────────────
  // For each bar, find any run logged within ±12 hours
  const scored = bars.map(bar => {
    const match = runs.find(r => {
      const rd = new Date(r.ts);
      return Math.abs(rd - bar.date) < 12 * 3600 * 1000;
    });
    return { ...bar, score: match ? Number(match.score) : null, runTicker: match?.ticker };
  });

  // synthetic fallback: if no run history, generate plausible synthetic scores
  // from price volatility so the chart is always meaningful
  const hasRealScores = scored.some(b => b.score != null);
  if (!hasRealScores) {
    injectSyntheticScores(scored);
  }

  // ── stats ──────────────────────────────────────────────
  const prices   = bars.map(b => b.close);
  const minP     = Math.min(...prices);
  const maxP     = Math.max(...prices);
  const firstP   = prices[0];
  const lastP    = prices[prices.length - 1];
  const priceChg = ((lastP - firstP) / firstP * 100).toFixed(1);
  const maxDD    = maxDrawdown(prices);
  const scores   = scored.filter(b => b.score != null).map(b => b.score);
  const avgScore = scores.length ? (scores.reduce((a,b)=>a+b,0)/scores.length).toFixed(1) : "—";
  const peakScore = scores.length ? Math.max(...scores).toFixed(1) : "—";

  // signal events: runs where score ≥ 50
  const signals = buildSignalEvents(scored, bars);
  const hitRate = calcHitRate(signals);

  // ── stats strip ────────────────────────────────────────
  const periodLabel = { "3mo":"3M","6mo":"6M","1y":"1Y","2y":"2Y" }[period] || period;
  document.getElementById("btStatsStrip").innerHTML = `
    <div class="bt-stat">
      <div class="bt-stat-label">Price Change (${periodLabel})</div>
      <div class="bt-stat-value" style="color:${Number(priceChg)>=0?"var(--green)":"var(--red)"}">${Number(priceChg)>=0?"+":""}${priceChg}%</div>
      <div class="bt-stat-sub">$${firstP.toFixed(2)} → $${lastP.toFixed(2)}</div>
    </div>
    <div class="bt-stat">
      <div class="bt-stat-label">Max Drawdown</div>
      <div class="bt-stat-value" style="color:var(--red)">-${maxDD.toFixed(1)}%</div>
      <div class="bt-stat-sub">Peak-to-trough in period</div>
    </div>
    <div class="bt-stat">
      <div class="bt-stat-label">Avg Risk Score</div>
      <div class="bt-stat-value" style="color:${scoreColor(Number(avgScore))}">${avgScore}</div>
      <div class="bt-stat-sub">Peak: ${peakScore}</div>
    </div>
    <div class="bt-stat">
      <div class="bt-stat-label">Signal Events</div>
      <div class="bt-stat-value">${signals.length}</div>
      <div class="bt-stat-sub">Score ≥ 50 triggers</div>
    </div>
    <div class="bt-stat">
      <div class="bt-stat-label">Hit Rate (30d)</div>
      <div class="bt-stat-value" style="color:${hitRate>=60?"var(--green)":hitRate>=40?"var(--amber)":"var(--red)"}">${hitRate != null ? hitRate+"%" : "—"}</div>
      <div class="bt-stat-sub">High-score → drawdown</div>
    </div>
    <div class="bt-stat">
      <div class="bt-stat-label">Data Source</div>
      <div class="bt-stat-value" style="font-size:13px;font-weight:700">Yahoo Finance</div>
      <div class="bt-stat-sub">${hasRealScores ? runs.length+" scored runs" : "Synthetic scores"}</div>
    </div>
  `;
  document.getElementById("btStatsStrip").classList.remove("hidden");

  // ── main dual-axis chart ───────────────────────────────
  document.getElementById("btChartTitle").textContent = `${ticker} — Risk Score vs Price`;
  renderBtChart(scored, hasRealScores);
  document.getElementById("btChartPanel").classList.remove("hidden");

  // ── signal table ───────────────────────────────────────
  renderSignalTable(signals, ticker);
  document.getElementById("btSignalPanel").classList.remove("hidden");

  // ── distribution + accuracy ────────────────────────────
  renderDistribution(scored);
  renderAccuracy(signals, hitRate, maxDD, avgScore);
  document.getElementById("btDistRow").classList.remove("hidden");

  // ── update overview trend chart to show score+price ───
  renderTrendWithPrice(scored, ticker, hasRealScores);
}

/* ── SVG dual-axis chart ────────────────────────────────── */
function renderBtChart(bars, hasReal) {
  const svg   = document.getElementById("btChart");
  const xAxis = document.getElementById("btXAxis");
  const W = svg.clientWidth  || 900;
  const H = 320;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);

  const pad = { t: 20, b: 10, l: 52, r: 52 };
  const cW  = W - pad.l - pad.r;
  const cH  = H - pad.t - pad.b;

  const prices = bars.map(b => b.close);
  const minP   = Math.min(...prices) * 0.99;
  const maxP   = Math.max(...prices) * 1.01;

  const xOf  = i  => pad.l + (i / Math.max(1, bars.length - 1)) * cW;
  const yP   = p  => pad.t + (1 - (p - minP) / (maxP - minP)) * cH;
  const yS   = s  => pad.t + (1 - s / 100) * cH;

  // ── grid lines (score axis, left) ──
  let gridSvg = "";
  [0, 25, 50, 75, 100].forEach(v => {
    const y = yS(v).toFixed(1);
    const isRisk = v === 50;
    gridSvg += `<line x1="${pad.l}" y1="${y}" x2="${W-pad.r}" y2="${y}"
      stroke="${isRisk ? "#fca5a5" : "#e2e8f0"}" stroke-width="${isRisk ? 1.5 : 1}"
      stroke-dasharray="${isRisk ? "4 3" : ""}"/>
    <text x="${pad.l-8}" y="${(Number(y)+4).toFixed(1)}" text-anchor="end"
      fill="${isRisk?"#f87171":"#94a3b8"}" font-size="10"
      font-family="'DM Mono',monospace">${v}</text>`;
  });

  // ── risk zone shading ── (score ≥ 50 = high risk band)
  const riskY = yS(100).toFixed(1);
  const midY  = yS(50).toFixed(1);
  gridSvg += `<rect x="${pad.l}" y="${riskY}" width="${cW}" height="${(midY - riskY).toFixed(1)}"
    fill="#fca5a5" opacity=".07"/>`;

  // ── price axis labels (right) ──
  const pTicks = 5;
  for (let i = 0; i <= pTicks; i++) {
    const p = minP + (maxP - minP) * (i / pTicks);
    const y = (yP(p)).toFixed(1);
    gridSvg += `<text x="${W - pad.r + 8}" y="${(Number(y)+4).toFixed(1)}"
      fill="#94a3b8" font-size="10" font-family="'DM Mono',monospace">$${p.toFixed(0)}</text>`;
  }

  // ── price area + line ──
  const pricePts = bars.map((b,i) => ({ x: xOf(i), y: yP(b.close) }));
  const priceLine = pricePts.map((p,i) => `${i?"L":"M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const priceArea = priceLine
    + ` L${pricePts[pricePts.length-1].x.toFixed(1)},${(pad.t+cH).toFixed(1)}`
    + ` L${pricePts[0].x.toFixed(1)},${(pad.t+cH).toFixed(1)} Z`;

  // ── score line (only where scores exist) ──
  let scoreSvg = "";
  let segStart = null;
  const scoredBars = bars.map((b,i) => ({ ...b, x: xOf(i), y: b.score != null ? yS(b.score) : null }));

  // build connected segments
  let curPath = "";
  scoredBars.forEach((b, i) => {
    if (b.y != null) {
      curPath += `${curPath ? "L" : "M"}${b.x.toFixed(1)},${b.y.toFixed(1)}`;
    } else if (curPath) {
      scoreSvg += `<path d="${curPath}" fill="none" stroke="#465fff" stroke-width="2.5"
        stroke-linejoin="round" stroke-linecap="round"/>`;
      curPath = "";
    }
  });
  if (curPath) scoreSvg += `<path d="${curPath}" fill="none" stroke="#465fff" stroke-width="2.5"
    stroke-linejoin="round" stroke-linecap="round"/>`;

  // score dots (only real scored points)
  scoredBars.filter(b => b.score != null).forEach(b => {
    const col = b.score >= 70 ? "#ef4444" : b.score >= 50 ? "#f59e0b" : "#22c55e";
    scoreSvg += `<circle cx="${b.x.toFixed(1)}" cy="${b.y.toFixed(1)}" r="4"
      fill="${col}" stroke="#fff" stroke-width="1.5"/>`;
  });

  // ── x-axis labels ──
  const step  = Math.ceil(bars.length / 8);
  let xLabels = "";
  bars.forEach((b, i) => {
    if (i % step !== 0 && i !== bars.length - 1) return;
    xLabels += `<span style="left:${((xOf(i)-pad.l)/cW*100).toFixed(1)}%">
      ${b.date.toLocaleDateString([], {month:"short",day:"numeric"})}
    </span>`;
  });
  xAxis.innerHTML = xLabels;

  // ── legend ──
  document.getElementById("btLegend").innerHTML = `
    <div class="bt-legend-item"><span class="bt-legend-line" style="background:#94a3b8"></span>Price</div>
    <div class="bt-legend-item"><span class="bt-legend-line" style="background:#465fff"></span>Risk Score ${hasReal?"":"(synthetic)"}</div>
    <div class="bt-legend-item"><span class="bt-legend-line" style="background:#fca5a5;opacity:.5"></span>High-Risk Zone (≥50)</div>
  `;

  svg.innerHTML = `
    <defs>
      <linearGradient id="btPriceGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%"   stop-color="#94a3b8" stop-opacity=".15"/>
        <stop offset="100%" stop-color="#94a3b8" stop-opacity="0"/>
      </linearGradient>
      <linearGradient id="btScoreGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%"   stop-color="#465fff" stop-opacity=".12"/>
        <stop offset="100%" stop-color="#465fff" stop-opacity="0"/>
      </linearGradient>
      <clipPath id="btClip"><rect x="${pad.l}" y="${pad.t}" width="${cW}" height="${cH}"/></clipPath>
    </defs>
    ${gridSvg}
    <g clip-path="url(#btClip)">
      <path d="${priceArea}" fill="url(#btPriceGrad)"/>
      <path d="${priceLine}" fill="none" stroke="#94a3b8" stroke-width="2" stroke-linejoin="round"/>
      ${scoreSvg}
    </g>
  `;

  // ── hover tooltip ──────────────────────────────────────
  const tooltip = document.getElementById("btTooltip");
  const wrap    = document.getElementById("btChartWrap") || svg.parentElement;

  svg.addEventListener("mousemove", e => {
    const rect   = svg.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const frac   = (mouseX - pad.l) / cW;
    const idx    = Math.round(frac * (bars.length - 1));
    if (idx < 0 || idx >= bars.length) { tooltip.classList.add("hidden"); return; }
    const b   = bars[idx];
    const pct = ((b.close - bars[0].close) / bars[0].close * 100).toFixed(1);
    const scoreStr = b.score != null ? b.score.toFixed(1) : "—";
    const lvlStr   = b.score != null ? ` · ${title(scoreToLevel(b.score))} Risk` : "";
    tooltip.innerHTML = `
      <strong>${b.date.toLocaleDateString([], {month:"short",day:"numeric",year:"numeric"})}</strong><br>
      Price: <strong>$${b.close.toFixed(2)}</strong> (${Number(pct)>=0?"+":""}${pct}%)<br>
      Risk Score: <strong>${scoreStr}</strong>${lvlStr}
    `;
    const tx = Math.max(60, Math.min(W - 60, xOf(idx)));
    tooltip.style.left = `${(tx/W*100).toFixed(1)}%`;
    tooltip.style.top  = "8px";
    tooltip.classList.remove("hidden");
  });
  svg.addEventListener("mouseleave", () => tooltip.classList.add("hidden"));
}

/* ── synthetic scores from rolling vol ─────────────────── */
function injectSyntheticScores(bars) {
  // 14-day rolling annualised vol → mapped to 0–100 risk score
  for (let i = 0; i < bars.length; i++) {
    if (i < 2) { bars[i].score = 20; continue; }
    const window = bars.slice(Math.max(0, i - 14), i + 1);
    const rets   = [];
    for (let j = 1; j < window.length; j++) {
      rets.push(Math.log(window[j].close / window[j-1].close));
    }
    const mean = rets.reduce((a,b)=>a+b,0) / rets.length;
    const variance = rets.reduce((s,r)=>s+(r-mean)**2, 0) / rets.length;
    const annVol = Math.sqrt(variance * 252) * 100; // annualised %
    // map 0–80% ann vol → 5–95 risk score
    bars[i].score = Math.min(95, Math.max(5, annVol * 1.1 + 8));
    bars[i].synthetic = true;
  }
}

/* ── signal event builder ───────────────────────────────── */
function buildSignalEvents(scored, bars) {
  const signals = [];
  let inSignal  = false;

  scored.forEach((b, i) => {
    if (b.score == null) return;
    const wasHigh = b.score >= 50;

    if (wasHigh && !inSignal) {
      inSignal = true;
      const priceAt = b.close;

      // look-forward 7d and 30d
      const d7  = lookForward(bars, i, 7);
      const d30 = lookForward(bars, i, 30);
      const r7  = d7  != null ? ((d7  - priceAt) / priceAt * 100) : null;
      const r30 = d30 != null ? ((d30 - priceAt) / priceAt * 100) : null;

      signals.push({
        date:    b.date,
        score:   b.score,
        level:   scoreToLevel(b.score),
        priceAt,
        price7d: d7,
        price30d: d30,
        ret7:    r7,
        ret30:   r30,
        // "correct" if high risk score preceded a decline within 30d
        correct: r30 != null ? r30 < -2 : null,
      });
    }

    if (!wasHigh) inSignal = false;
  });

  return signals;
}

function lookForward(bars, fromIdx, days) {
  const targetDate = new Date(bars[fromIdx].date);
  targetDate.setDate(targetDate.getDate() + days);
  // find closest bar at or after target
  for (let j = fromIdx + 1; j < bars.length; j++) {
    if (bars[j].date >= targetDate) return bars[j].close;
  }
  return null;
}

/* ── hit rate ───────────────────────────────────────────── */
function calcHitRate(signals) {
  const resolved = signals.filter(s => s.correct != null);
  if (!resolved.length) return null;
  return Math.round(resolved.filter(s => s.correct).length / resolved.length * 100);
}

/* ── max drawdown ───────────────────────────────────────── */
function maxDrawdown(prices) {
  let peak = prices[0], maxDD = 0;
  for (const p of prices) {
    if (p > peak) peak = p;
    const dd = (peak - p) / peak * 100;
    if (dd > maxDD) maxDD = dd;
  }
  return maxDD;
}

/* ── signal table render ────────────────────────────────── */
function renderSignalTable(signals, ticker) {
  const empty = document.getElementById("btSignalEmpty");
  const tbody = document.getElementById("btSignalBody");

  if (!signals.length) {
    empty.classList.remove("hidden");
    tbody.innerHTML = "";
    return;
  }
  empty.classList.add("hidden");

  tbody.innerHTML = signals.map(s => {
    const fmt = d => d ? `$${d.toFixed(2)}` : "—";
    const retFmt = r => {
      if (r == null) return `<span class="bt-return-nil">—</span>`;
      const cls = r < 0 ? "bt-return-neg" : "bt-return-pos";
      return `<span class="${cls}">${r >= 0 ? "+" : ""}${r.toFixed(1)}%</span>`;
    };
    const predBadge = s.correct == null
      ? `<span class="bt-pred-pending">Pending</span>`
      : s.correct
        ? `<span class="bt-pred-correct">✓ Correct</span>`
        : `<span class="bt-pred-incorrect">✗ Missed</span>`;

    return `<tr>
      <td style="font-family:'DM Mono',monospace">${s.date.toLocaleDateString([], {year:"numeric",month:"short",day:"numeric"})}</td>
      <td><strong style="font-family:'DM Mono',monospace;color:${scoreColor(s.score)}">${s.score.toFixed(1)}</strong></td>
      <td><span class="badge ${s.level==="low"?"success":s.level==="medium"?"warn":"danger"}">${title(s.level)}</span></td>
      <td style="font-family:'DM Mono',monospace">$${s.priceAt.toFixed(2)}</td>
      <td style="font-family:'DM Mono',monospace">${fmt(s.price7d)}</td>
      <td style="font-family:'DM Mono',monospace">${fmt(s.price30d)}</td>
      <td>${retFmt(s.ret7)}</td>
      <td>${retFmt(s.ret30)}</td>
      <td>${predBadge}</td>
    </tr>`;
  }).join("");
}

/* ── score distribution ─────────────────────────────────── */
function renderDistribution(bars) {
  const bands = [
    { label:"Low (0–25)",    min:0,  max:25,  color:"#22c55e" },
    { label:"Med (25–50)",   min:25, max:50,  color:"#f59e0b" },
    { label:"High (50–75)",  min:50, max:75,  color:"#f97316" },
    { label:"Crit (75–100)", min:75, max:100, color:"#ef4444" },
  ];
  const scored = bars.filter(b => b.score != null);
  const total  = scored.length || 1;
  const counts = bands.map(bd => scored.filter(b => b.score >= bd.min && b.score < bd.max).length);
  const maxC   = Math.max(...counts, 1);

  document.getElementById("btDistChart").innerHTML = bands.map((bd, i) => `
    <div class="bt-dist-row">
      <div class="bt-dist-label" style="color:${bd.color}">${bd.label}</div>
      <div class="bt-dist-track">
        <div class="bt-dist-fill" style="width:${(counts[i]/maxC*100).toFixed(1)}%;background:${bd.color}"></div>
      </div>
      <div class="bt-dist-count">${counts[i]}d</div>
    </div>
  `).join("");
}

/* ── accuracy panel ─────────────────────────────────────── */
function renderAccuracy(signals, hitRate, maxDD, avgScore) {
  const resolved   = signals.filter(s => s.correct != null);
  const correct    = resolved.filter(s => s.correct).length;
  const avgLead30  = resolved.length
    ? (resolved.reduce((s, sig) => s + (sig.ret30 ?? 0), 0) / resolved.length).toFixed(1)
    : null;

  document.getElementById("btAccuracy").innerHTML = `
    <div class="bt-acc-row">
      <span class="bt-acc-label">Signal events detected</span>
      <span class="bt-acc-value">${signals.length}</span>
    </div>
    <div class="bt-acc-row">
      <span class="bt-acc-label">Resolved (30d elapsed)</span>
      <span class="bt-acc-value">${resolved.length}</span>
    </div>
    <div class="bt-acc-row">
      <span class="bt-acc-label">Correct predictions</span>
      <span class="bt-acc-value" style="color:var(--green)">${correct}</span>
    </div>
    <div class="bt-acc-row">
      <span class="bt-acc-label">Hit rate (30d drawdown)</span>
      <span class="bt-acc-value" style="color:${hitRate>=60?"var(--green)":hitRate>=40?"var(--amber)":"var(--red)"}">${hitRate != null ? hitRate+"%" : "—"}</span>
    </div>
    <div class="bt-acc-row">
      <span class="bt-acc-label">Avg 30d return after signal</span>
      <span class="bt-acc-value" style="color:${avgLead30<0?"var(--green)":"var(--red)"}">${avgLead30 != null ? (Number(avgLead30)>=0?"+":"")+avgLead30+"%" : "—"}</span>
    </div>
    <div class="bt-acc-row">
      <span class="bt-acc-label">Max period drawdown</span>
      <span class="bt-acc-value" style="color:var(--red)">-${maxDD.toFixed(1)}%</span>
    </div>
  `;
}

/* ── update overview trend chart to dual-axis ───────────── */
function renderTrendWithPrice(scored, ticker, hasReal) {
  const hint = document.getElementById("trendBacktestHint");
  // Only enrich the mini trend chart if the current overview ticker matches
  if (state.result?.ticker !== ticker) return;

  const chart    = document.getElementById("trendChart");
  const subtitle = document.getElementById("trendSubtitle");
  subtitle.textContent = `Score vs price · ${ticker}`;
  hint.classList.remove("hidden");

  // slim version of the dual-axis chart for the overview panel
  const bars  = scored.slice(-30); // last 30 bars for readability
  if (bars.length < 2) return;

  const W = 640, H = 210, pad = { t: 16, b: 30, l: 32, r: 36 };
  const cW = W - pad.l - pad.r, cH = H - pad.t - pad.b;

  const prices = bars.map(b => b.close);
  const minP   = Math.min(...prices) * 0.98;
  const maxP   = Math.max(...prices) * 1.02;

  const xOf = i => pad.l + (i / Math.max(1, bars.length - 1)) * cW;
  const yP  = p => pad.t + (1 - (p - minP) / (maxP - minP)) * cH;
  const yS  = s => pad.t + (1 - s / 100) * cH;

  const priceLine = bars.map((b,i) => `${i?"L":"M"}${xOf(i).toFixed(1)},${yP(b.close).toFixed(1)}`).join(" ");
  const priceArea = priceLine
    + ` L${xOf(bars.length-1).toFixed(1)},${(pad.t+cH).toFixed(1)}`
    + ` L${xOf(0).toFixed(1)},${(pad.t+cH).toFixed(1)} Z`;

  // score segments
  let scorePath = "", scoreSegs = "";
  bars.forEach((b, i) => {
    if (b.score != null) scorePath += `${scorePath?"L":"M"}${xOf(i).toFixed(1)},${yS(b.score).toFixed(1)}`;
    else if (scorePath) { scoreSegs += `<path d="${scorePath}" fill="none" stroke="#465fff" stroke-width="2" stroke-linejoin="round"/>`; scorePath = ""; }
  });
  if (scorePath) scoreSegs += `<path d="${scorePath}" fill="none" stroke="#465fff" stroke-width="2" stroke-linejoin="round"/>`;

  // grid
  const gridLines = [0,25,50,75,100].map(v => {
    const y = yS(v).toFixed(1);
    return `<line x1="${pad.l}" y1="${y}" x2="${W-pad.r}" y2="${y}" stroke="${v===50?"#fca5a5":"#e2e8f0"}" stroke-width="1"/>
    <text x="${pad.l-6}" y="${(Number(y)+4).toFixed(1)}" text-anchor="end" fill="#94a3b8" font-size="10" font-family="'DM Mono',monospace">${v}</text>`;
  }).join("");

  // x labels
  const step = Math.ceil(bars.length / 6);
  const xLabels = bars.map((b,i) => i % step === 0
    ? `<text x="${xOf(i).toFixed(1)}" y="${H-4}" text-anchor="middle" fill="#94a3b8" font-size="9" font-family="'DM Mono',monospace">${b.date.toLocaleDateString([],{month:"short",day:"numeric"})}</text>`
    : "").join("");

  chart.innerHTML = `
    <defs>
      <linearGradient id="trendPriceGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#94a3b8" stop-opacity=".12"/>
        <stop offset="100%" stop-color="#94a3b8" stop-opacity="0"/>
      </linearGradient>
    </defs>
    ${gridLines}${xLabels}
    <rect x="${pad.l}" y="${yS(100).toFixed(1)}" width="${cW}" height="${(yS(50)-yS(100)).toFixed(1)}" fill="#fca5a5" opacity=".07"/>
    <path d="${priceArea}" fill="url(#trendPriceGrad)"/>
    <path d="${priceLine}" fill="none" stroke="#94a3b8" stroke-width="1.5" stroke-linejoin="round"/>
    ${scoreSegs}
    ${bars.filter(b=>b.score!=null).map(b=>{
      const col = b.score>=70?"#ef4444":b.score>=50?"#f59e0b":"#22c55e";
      return `<circle cx="${xOf(bars.indexOf(b)).toFixed(1)}" cy="${yS(b.score).toFixed(1)}" r="3" fill="${col}" stroke="#fff" stroke-width="1.2"/>`;
    }).join("")}
  `;
}

/* ── helpers ────────────────────────────────────────────── */
function scoreToLevel(s) {
  if (s < 25)  return "low";
  if (s < 50)  return "medium";
  if (s < 75)  return "high";
  return "critical";
}
function scoreColor(s) {
  if (s == null || isNaN(s)) return "var(--text-1)";
  if (s < 25)  return "var(--green)";
  if (s < 50)  return "var(--amber)";
  if (s < 75)  return "var(--red)";
  return "#7f1d1d";
}