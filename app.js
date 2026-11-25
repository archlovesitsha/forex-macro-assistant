/* =========================================================
   FOREX MACRO ASSISTANT
   FUNDAMENTAL-ONLY VERSION 3.1
   ========================================================= */

/* =========================================================
   CURRENCIES AND PAIRS
   ========================================================= */

const C = [
  "USD", "EUR", "GBP", "JPY",
  "CHF", "CAD", "AUD", "NZD"
];

const STANDARD_PAIRS = [
  "EUR/USD", "GBP/USD", "USD/JPY",
  "USD/CHF", "AUD/USD", "USD/CAD",
  "NZD/USD", "EUR/GBP", "EUR/JPY",
  "EUR/CHF", "EUR/AUD", "EUR/CAD",
  "EUR/NZD", "GBP/JPY", "GBP/CHF",
  "GBP/AUD", "GBP/CAD", "GBP/NZD",
  "CHF/JPY", "AUD/JPY", "CAD/JPY",
  "NZD/JPY", "AUD/CHF", "CAD/CHF",
  "NZD/CHF", "AUD/CAD", "NZD/CAD",
  "NZD/AUD"
];

const state = {
  scores: Object.fromEntries(C.map(c => [c, 0])),
  previous: Object.fromEntries(C.map(c => [c, 0])),
  quotes: {},
  calendar: [],
  analysis: null,
  currencyData: {},
  pairData: {}
};

const $ = id => document.getElementById(id);


/* =========================================================
   PAIR LIST
   ========================================================= */

if ($("pair")) {
  $("pair").innerHTML = "";

  STANDARD_PAIRS.forEach(pair => {
    const option = document.createElement("option");
    option.value = pair;
    option.textContent = pair;
    $("pair").append(option);
  });
}


/* =========================================================
   GENERAL HELPERS
   ========================================================= */

function safeNumber(value) {
  const number = Number(value);

  return Number.isFinite(number) ? number : null;
}


function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[character]);
}


function coverageStatus(coverage) {
  if (!Number.isFinite(Number(coverage))) {
    return "INSUFFICIENT DATA";
  }

  if (coverage >= 80) return "CONFIRMED";
  if (coverage >= 60) return "PROVISIONAL";

  return "INSUFFICIENT DATA";
}


function statusClass(status) {
  if (status === "CONFIRMED") return "quality-confirmed";
  if (status === "PROVISIONAL") return "quality-provisional";

  return "quality-insufficient";
}


function formatCoverage(value) {
  const coverage = safeNumber(value);

  return coverage === null
    ? "N/A"
    : `${coverage}%`;
}


function getCurrencyWarnings(data) {
  if (!data) return [];

  const warnings = [];

  if (Array.isArray(data.warnings)) {
    warnings.push(...data.warnings);
  }

  if (Array.isArray(data.dataQuality?.warnings)) {
    warnings.push(...data.dataQuality.warnings);
  }

  return [...new Set(warnings)];
}


/* =========================================================
   MACRO DASHBOARD
   ========================================================= */

function renderMacro() {
  if (!$("currencies")) return;

  $("currencies").innerHTML = C.map(c => `
    <div class="currency">
      <b>${c}</b>

      <input
        data-c="${c}"
        type="range"
        min="-10"
        max="10"
        value="${state.scores[c]}"
      >

      <span class="score">${state.scores[c]}</span>
    </div>
  `).join("");

  document.querySelectorAll("[data-c]").forEach(input => {
    input.oninput = () => {
      const currency = input.dataset.c;

      state.scores[currency] = Number(input.value);

      input.nextElementSibling.textContent = input.value;

      renderMomentum();
      renderOpportunityScanner();
    };
  });

  renderMomentum();
}


function renderMomentum() {
  if (!$("momentum")) return;

  $("momentum").innerHTML = C.map(c => {
    const change = state.scores[c] - state.previous[c];

    return `
      <div class="momentum">
        <b>${c}</b>

        <span>
          ${state.previous[c]} → ${state.scores[c]}
        </span>

        <span>
          ${change > 0 ? "↑" : change < 0 ? "↓" : "→"}
        </span>

        <span>${change}</span>
      </div>
    `;
  }).join("");
}


/* =========================================================
   API HELPER
   ========================================================= */

async function api(url) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`API request failed: ${response.status}`);
  }

  return response.json();
}


/* =========================================================
   CURRENCY MACRO DATA
   ========================================================= */

async function loadCurrency(currency) {
  if (state.currencyData[currency]) {
    return state.currencyData[currency];
  }

  try {
    const data = await api(
      `/api/macro/${encodeURIComponent(currency)}`
    );

    if (data.success) {
      state.currencyData[currency] = data;

      const score = safeNumber(data.scores?.total);

      if (score !== null) {
        state.previous[currency] = state.scores[currency];
        state.scores[currency] = score;
      }

      return data;
    }
  } catch (error) {
    console.warn(`${currency} macro unavailable:`, error.message);
  }

  return null;
}


/* =========================================================
   SELECTED PAIR ANALYSIS
   ========================================================= */

async function loadMacro(base, quote) {
  let pairResult = null;

  try {
    pairResult = await api(
      `/api/pair-analysis?pair=${encodeURIComponent(`${base}/${quote}`)}`
    );
  } catch (error) {
    console.error("Pair analysis unavailable:", error.message);
  }

  const baseData = await loadCurrency(base);
  const quoteData = await loadCurrency(quote);

  let baseScore = safeNumber(pairResult?.baseScore);
  let quoteScore = safeNumber(pairResult?.quoteScore);

  if (baseScore === null) {
    baseScore = safeNumber(baseData?.scores?.total);
  }

  if (quoteScore === null) {
    quoteScore = safeNumber(quoteData?.scores?.total);
  }

  const baseCoverage =
    safeNumber(pairResult?.baseCoverage) ??
    safeNumber(baseData?.dataQuality?.coverage);

  const quoteCoverage =
    safeNumber(pairResult?.quoteCoverage) ??
    safeNumber(quoteData?.dataQuality?.coverage);

  const differential = safeNumber(pairResult?.differential);

  const status = pairResult?.status ??
    coverageStatus(
      Math.min(baseCoverage ?? 0, quoteCoverage ?? 0)
    );

  const available =
    pairResult?.available === true &&
    differential !== null;

  const warnings = [
    ...(Array.isArray(pairResult?.warnings)
      ? pairResult.warnings
      : []),

    ...getCurrencyWarnings(baseData),
    ...getCurrencyWarnings(quoteData)
  ];

  if (baseScore !== null) {
    state.previous[base] = state.scores[base];
    state.scores[base] = baseScore;
  }

  if (quoteScore !== null) {
    state.previous[quote] = state.scores[quote];
    state.scores[quote] = quoteScore;
  }

  renderMacro();

  const liveSources = [];

  if (baseData?.success) liveSources.push(base);
  if (quoteData?.success) liveSources.push(quote);

  return {
    available,
    differential,

    baseScore,
    quoteScore,

    baseCoverage,
    quoteCoverage,

    status,
    confirmed: pairResult?.confirmed === true,

    warnings: [...new Set(warnings)],

    baseData,
    quoteData,

    raw: pairResult,

    source: liveSources.length
      ? `LIVE: ${[...new Set(liveSources)].join(", ")}`
      : "LIVE DATA UNAVAILABLE"
  };
}


/* =========================================================
   FUNDAMENTAL DIVERGENCE
   ========================================================= */

async function loadDivergence(base, quote) {
  const pair = `${base}/${quote}`;

  try {
    const result = await api(
      `/api/price-divergence?pair=${encodeURIComponent(pair)}`
    );

    if (!result || result.success !== true) {
      return {
        available: false,
        present: null,
        direction: null,
        priceDirection: null,
        fundamentalDirection: null,
        status: "INSUFFICIENT DATA",
        confirmed: false,
        warnings: [],
        raw: result
      };
    }

    return {
      available: result.available === true,

      present: typeof result.divergence === "boolean"
        ? result.divergence
        : null,

      direction: result.direction ?? null,

      priceDirection: result.priceDirection ?? null,

      fundamentalDirection:
        result.fundamentalDirection ?? null,

      status: result.status ?? "INSUFFICIENT DATA",

      confirmed: result.confirmed === true,

      warnings: Array.isArray(result.dataQuality?.warnings)
        ? result.dataQuality.warnings
        : [],

      raw: result
    };

  } catch (error) {
    console.error("Divergence request failed:", error);

    return {
      available: false,
      present: null,
      direction: null,
      priceDirection: null,
      fundamentalDirection: null,
      status: "INSUFFICIENT DATA",
      confirmed: false,
      warnings: [],
      raw: {
        success: false,
        error: error.message,
        pair
      }
    };
  }
}


/* =========================================================
   FUNDAMENTAL DECISION ENGINE
   ========================================================= */

function buildDecision(pair, macro, divergence) {
  if (!macro.available) {
    return {
      action: "INSUFFICIENT DATA",
      summary: "A reliable fundamental comparison cannot be calculated.",
      differential: null
    };
  }

  const differential = safeNumber(macro.differential);

  if (differential === null) {
    return {
      action: "INSUFFICIENT DATA",
      summary: "Unable to calculate the fundamental differential.",
      differential: null
    };
  }

  let bias = "NEUTRAL";

  if (differential >= 2) {
    bias = "BULLISH";
  } else if (differential <= -2) {
    bias = "BEARISH";
  }

  if (macro.status === "INSUFFICIENT DATA") {
    return {
      action: "INSUFFICIENT DATA",
      summary: "Currency data coverage is too low for a meaningful comparison.",
      differential,
      divergence: "UNAVAILABLE"
    };
  }

  const provisional = macro.status === "PROVISIONAL";

  if (!divergence.available) {
    return {
      action: `${bias} FUNDAMENTAL BIAS`,
      summary:
        "Fundamental direction is available, but price divergence data is unavailable.",

      differential,
      divergence: "UNAVAILABLE",
      provisional
    };
  }

  if (divergence.present === true) {
    return {
      action: `${bias} FUNDAMENTAL DIVERGENCE — WATCH`,
      summary:
        "Price movement is opposing the fundamental direction. Monitor the pair for a possible opportunity.",

      differential,
      divergence: "PRESENT",
      provisional
    };
  }

  return {
    action: `${bias} FUNDAMENTAL BIAS`,
    summary:
      divergence.present === false
        ? "Price and fundamentals are currently moving in the same direction."
        : "Fundamental direction identified, but divergence is not yet established.",

    differential,
    divergence: divergence.present === false
      ? "NOT DETECTED"
      : "UNAVAILABLE",

    provisional
  };
}


/* =========================================================
   DATA QUALITY DISPLAY
   ========================================================= */

function renderDataQuality(macro, divergence) {
  const container = $("dataQuality");

  const status = macro.status ?? "INSUFFICIENT DATA";

  const baseCoverage = formatCoverage(macro.baseCoverage);
  const quoteCoverage = formatCoverage(macro.quoteCoverage);

  const warnings = [
    ...(macro.warnings ?? []),
    ...(divergence.warnings ?? [])
  ];

  const uniqueWarnings = [...new Set(warnings)];

  const warningHTML = uniqueWarnings.length
    ? `
      <ul class="quality-warnings">
        ${uniqueWarnings.map(warning =>
          `<li>${escapeHTML(warning)}</li>`
        ).join("")}
      </ul>
    `
    : "<p>No missing-data warnings reported.</p>";

  const html = `
    <div class="quality-card ${statusClass(status)}">

      <h3>Fundamental data quality</h3>

      <p>
        <strong>Status:</strong>
        ${escapeHTML(status)}
      </p>

      <p>
        <strong>Base currency coverage:</strong>
        ${baseCoverage}
      </p>

      <p>
        <strong>Quote currency coverage:</strong>
        ${quoteCoverage}
      </p>

      <p>
        <strong>Divergence assessment:</strong>
        ${escapeHTML(divergence.status ?? "UNAVAILABLE")}
      </p>

      <h4>Data warnings</h4>

      ${warningHTML}

      ${
        status === "PROVISIONAL"
          ? "<p><strong>Warning:</strong> This assessment is provisional because some indicators are missing or incomplete.</p>"
          : ""
      }

      ${
        status === "INSUFFICIENT DATA"
          ? "<p><strong>Warning:</strong> Do not rely on this comparison. More data is required.</p>"
          : ""
      }

    </div>
  `;

  if (container) {
    container.innerHTML = html;
  } else if ($("why")) {
    $("why").insertAdjacentHTML("afterend", html);
  }
}


/* =========================================================
   FUNDAMENTAL ANALYSIS DISPLAY
   ========================================================= */

function renderDecision(pair, macro, divergence, decision) {
  const [base, quote] = pair.split("/");

  if ($("action")) {
    $("action").textContent = decision.action;
  }

  if ($("summary")) {
    $("summary").textContent = decision.summary;
  }

  if ($("differential")) {
    $("differential").textContent =
      decision.differential === null
        ? "Differential N/A"
        : `Differential ${decision.differential}`;
  }

  if ($("divergence")) {
    $("divergence").textContent =
      divergence.available && divergence.present !== null
        ? `Divergence ${divergence.present ? "YES" : "NO"}`
        : "Divergence N/A";
  }

  if ($("technical")) {
    $("technical").textContent = "Manual technical analysis";
  }

  const items = [
    `Base currency: ${base}`,
    `Base score: ${macro.baseScore ?? "N/A"}`,
    `Base coverage: ${formatCoverage(macro.baseCoverage)}`,

    `Quote currency: ${quote}`,
    `Quote score: ${macro.quoteScore ?? "N/A"}`,
    `Quote coverage: ${formatCoverage(macro.quoteCoverage)}`,

    `Fundamental differential: ${decision.differential ?? "N/A"}`,
    `Fundamental bias: ${decision.action}`,

    `Data quality status: ${macro.status}`,

    `Price direction: ${
      divergence.available
        ? divergence.priceDirection ?? "N/A"
        : "UNAVAILABLE"
    }`,

    `Fundamental direction: ${
      divergence.available
        ? divergence.fundamentalDirection ?? "N/A"
        : "UNAVAILABLE"
    }`,

    `Price divergence: ${
      divergence.available && divergence.present !== null
        ? divergence.present ? "PRESENT" : "NOT DETECTED"
        : "UNAVAILABLE"
    }`,

    `Divergence status: ${divergence.status ?? "UNAVAILABLE"}`,

    `Data source: ${macro.source}`,

    "Technical analysis: To be performed manually using TradingView."
  ];

  if ($("why")) {
    $("why").innerHTML = items
      .map(item => `<li>${escapeHTML(item)}</li>`)
      .join("");
  }

  renderDataQuality(macro, divergence);

  if ($("plan")) {
    $("plan").innerHTML = `
      <div class="setup">

        <div>
          <b>Fundamental direction</b><br>
          ${escapeHTML(decision.action)}
        </div>

        <div>
          <b>Fundamental differential</b><br>
          ${decision.differential ?? "N/A"}
        </div>

        <div>
          <b>Data quality</b><br>
          ${escapeHTML(macro.status)}
        </div>

        <div>
          <b>Price divergence</b><br>
          ${
            divergence.available && divergence.present !== null
              ? divergence.present
                ? "Present — monitor"
                : "Not detected"
              : "Unavailable"
          }
        </div>

        <div>
          <b>Next step</b><br>
          Conduct independent technical analysis before considering a trade.
        </div>

      </div>
    `;
  }
}


/* =========================================================
   OPPORTUNITY SCANNER
   ========================================================= */

function macroStrengthLabel(differential) {
  const value = Math.abs(differential);

  if (value >= 6) return "VERY STRONG";
  if (value >= 4) return "STRONG";
  if (value >= 2) return "MODERATE";
  if (value >= 1) return "WEAK";

  return "NEUTRAL";
}


function macroBias(differential) {
  if (differential >= 2) return "BULLISH";
  if (differential <= -2) return "BEARISH";

  return "NEUTRAL";
}


function renderOpportunityScanner() {
  const container = $("opportunityScanner");

  if (!container) return;

  const rows = STANDARD_PAIRS.map(pair => {
    const [base, quote] = pair.split("/");

    const baseData = state.currencyData[base];
    const quoteData = state.currencyData[quote];

    const baseScore = safeNumber(baseData?.scores?.total);
    const quoteScore = safeNumber(quoteData?.scores?.total);

    const baseCoverage =
      safeNumber(baseData?.dataQuality?.coverage);

    const quoteCoverage =
      safeNumber(quoteData?.dataQuality?.coverage);

    const differential =
      baseScore !== null && quoteScore !== null
        ? baseScore - quoteScore
        : null;

    const minimumCoverage =
      baseCoverage !== null && quoteCoverage !== null
        ? Math.min(baseCoverage, quoteCoverage)
        : 0;

    const status = coverageStatus(minimumCoverage);

    return {
      pair,
      differential,
      absolute: differential === null
        ? -1
        : Math.abs(differential),

      strength: differential === null
        ? "N/A"
        : macroStrengthLabel(differential),

      bias: differential === null
        ? "UNAVAILABLE"
        : macroBias(differential),

      status,
      baseCoverage,
      quoteCoverage
    };

  }).sort((a, b) => b.absolute - a.absolute);

  const top = rows.slice(0, 12);

  container.innerHTML = `
    <div class="scanner-note">
      <b>Fundamental scanner</b><br><br>

      The scanner ranks the 28 standard forex pairs
      according to the difference between their
      currency scores.

      <br><br>

      Positive differential: stronger base currency.

      <br>

      Negative differential: stronger quote currency.

      <br><br>

      Data quality is shown separately. Provisional
      comparisons should not be treated as confirmed.

      <br><br>

      These are fundamental screening results,
      not automatic trade instructions.
    </div>

    <div class="scanner-table">

      <div class="scanner-row scanner-header">
        <span>Pair</span>
        <span>Diff</span>
        <span>Strength</span>
        <span>Bias</span>
      </div>

      ${top.map(item => `
        <div class="scanner-row" data-pair="${item.pair}">
          <span><b>${item.pair}</b></span>

          <span>
            ${item.differential ?? "N/A"}
          </span>

          <span>${item.strength}</span>

          <span>
            ${item.bias}
            <br>
            <small class="${statusClass(item.status)}">
              ${item.status}
            </small>
          </span>
        </div>
      `).join("")}

    </div>

    <p class="scanner-footer">
      Showing the strongest 12 of 28 pairs.
      Rankings are based on available currency scores.
      Missing data is not treated as a zero score.
    </p>
  `;

  container.querySelectorAll("[data-pair]").forEach(row => {
    row.onclick = () => {
      $("pair").value = row.dataset.pair;

      refresh();

      window.scrollTo({
        top: 0,
        behavior: "smooth"
      });
    };
  });
}


/* =========================================================
   MAIN FUNDAMENTAL ANALYSIS
   ========================================================= */

async function analyse() {
  const pair = $("pair")?.value;

  if (!pair) return;

  const [base, quote] = pair.split("/");

  if ($("action")) {
    $("action").textContent = "ANALYSING FUNDAMENTALS...";
  }

  if ($("summary")) {
    $("summary").textContent =
      "Loading macroeconomic and divergence data...";
  }

  try {
    const [macro, divergence] = await Promise.all([
      loadMacro(base, quote),
      loadDivergence(base, quote)
    ]);

    state.analysis = {
      pair,
      macro,
      divergence
    };

    state.pairData[pair] = macro;

    const decision = buildDecision(
      pair,
      macro,
      divergence
    );

    renderDecision(
      pair,
      macro,
      divergence,
      decision
    );

    renderOpportunityScanner();

  } catch (error) {
    console.error(error);

    if ($("action")) {
      $("action").textContent = "INSUFFICIENT DATA";
    }

    if ($("summary")) {
      $("summary").textContent =
        "Fundamental analysis could not be completed.";
    }

    if ($("differential")) {
      $("differential").textContent = "Differential N/A";
    }

    if ($("divergence")) {
      $("divergence").textContent = "Divergence N/A";
    }

    if ($("technical")) {
      $("technical").textContent = "Manual technical analysis";
    }
  }
}


/* =========================================================
   MARKET DATA REFRESH
   ========================================================= */

async function refresh() {
  const pair = $("pair")?.value;

  if (!pair) return;

  const [base, quote] = pair.split("/");

  try {
    const fx = await api(
      `/api/fx/rate?from=${encodeURIComponent(base)}&to=${encodeURIComponent(quote)}`
    );

    if (fx.configured) {
      const exchangeRate =
        fx.data?.["Realtime Currency Exchange Rate"];

      if (exchangeRate) {
        const price =
          Number(exchangeRate["5. Exchange Rate"]);

        if (Number.isFinite(price)) {
          state.quotes[pair] = { price };

          if ($("quote")) {
            $("quote").textContent = `${pair}: ${price}`;
          }
        }
      }

      if ($("dataStatus")) {
        $("dataStatus").textContent =
          "Live FX provider connected.";
      }

      if ($("providerStatus")) {
        $("providerStatus").textContent =
          "Alpha Vantage connection detected.";
      }

    } else {
      if ($("dataStatus")) {
        $("dataStatus").textContent =
          "FX provider not configured.";
      }
    }

  } catch (error) {
    console.warn("FX rate unavailable:", error.message);

    if ($("dataStatus")) {
      $("dataStatus").textContent =
        "Live FX rate unavailable.";
    }
  }

  await analyse();
}


/* =========================================================
   NAVIGATION
   ========================================================= */

document.querySelectorAll("nav button").forEach(button => {
  button.onclick = () => {

    document.querySelectorAll("nav button").forEach(item => {
      item.classList.remove("active");
    });

    document.querySelectorAll(".panel").forEach(panel => {
      panel.classList.remove("active");
    });

    button.classList.add("active");

    const panel = $(button.dataset.p);

    if (panel) {
      panel.classList.add("active");
    }

    if (button.dataset.p === "macro") {
      renderMacro();
    }

    if (button.dataset.p === "scanner") {
      renderOpportunityScanner();
    }
  };
});


/* =========================================================
   BUTTONS
   ========================================================= */

if ($("scan")) {
  $("scan").onclick = analyse;
}

if ($("refresh")) {
  $("refresh").onclick = refresh;
}

if ($("pair")) {
  $("pair").onchange = refresh;
}

if ($("scanAll")) {
  $("scanAll").onclick = () => {
    renderOpportunityScanner();

    if ($("scannerStatus")) {
      $("scannerStatus").textContent =
        "Scan complete — ranked by available fundamental data.";
    }
  };
}


/* =========================================================
   RISK CALCULATOR
   ========================================================= */

if ($("calc")) {
  $("calc").onclick = () => {

    const balance = Number($("bal").value);
    const riskPercent = Number($("rp").value);
    const stop = Number($("stop").value);
    const target = Number($("target").value);
    const pipValue = Number($("pv").value);

    if (
      !Number.isFinite(balance) ||
      balance <= 0 ||
      !Number.isFinite(riskPercent) ||
      riskPercent <= 0 ||
      !Number.isFinite(stop) ||
      stop <= 0 ||
      !Number.isFinite(target) ||
      target <= 0 ||
      !Number.isFinite(pipValue) ||
      pipValue <= 0
    ) {
      $("lot").textContent = "Enter valid risk values.";
      $("rrResult").textContent =
        "Enter valid risk/reward values.";

      return;
    }

    const riskAmount =
      balance * riskPercent / 100;

    const lotSize =
      riskAmount / (stop * pipValue);

    const rewardRisk =
      target / stop;

    const potentialProfit =
      target * pipValue * lotSize;

    const maximumLoss =
      stop * pipValue * lotSize;

    const warning =
      riskPercent >= 5
        ? " ⚠️ High risk per trade."
        : "";

    $("lot").innerHTML = `
      <strong>
        Lot size: ${lotSize.toFixed(3)} lots
      </strong><br>

      Risk amount: $${riskAmount.toFixed(2)}
      ${warning}<br>

      Maximum loss: $${maximumLoss.toFixed(2)}
    `;

    $("rrResult").innerHTML = `
      <strong>
        Risk / Reward: 1:${rewardRisk.toFixed(2)}
      </strong><br>

      Stop: ${stop} pips<br>

      Target: ${target} pips<br>

      Potential profit: $${potentialProfit.toFixed(2)}<br>

      Potential loss: $${maximumLoss.toFixed(2)}
    `;
  };
}


/* =========================================================
   JOURNAL
   ========================================================= */

function logs() {
  const entries = JSON.parse(
    localStorage.getItem("fma2") || "[]"
  );

  if (!$("logs")) return;

  $("logs").innerHTML = entries.map(entry => `
    <article class="card">
      <b>${escapeHTML(entry.p)}</b>
      <p>${escapeHTML(entry.n)}</p>
      <small>${escapeHTML(entry.t)}</small>
    </article>
  `).join("");
}


if ($("save")) {
  $("save").onclick = () => {

    const entries = JSON.parse(
      localStorage.getItem("fma2") || "[]"
    );

    entries.unshift({
      p: $("jp").value,
      n: $("jn").value,
      t: new Date().toLocaleString()
    });

    localStorage.setItem(
      "fma2",
      JSON.stringify(entries)
    );

    $("jp").value = "";
    $("jn").value = "";

    logs();
  };
}


/* =========================================================
   SERVICE WORKER
   ========================================================= */

if ("serviceWorker" in navigator) {
  navigator.serviceWorker
    .register("sw.js")
    .catch(error => {
      console.warn("Service worker unavailable:", error);
    });
}


/* =========================================================
   INITIALISE APPLICATION
   ========================================================= */

renderMacro();

renderOpportunityScanner();

logs();

analyse();

refresh();
