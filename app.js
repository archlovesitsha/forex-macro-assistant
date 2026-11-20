/* =========================================================
   FOREX MACRO ASSISTANT
   FUNDAMENTAL-ONLY VERSION
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
  analysis: null
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
   MACRO DATA
   ========================================================= */

async function loadMacro(base, quote) {
  let usd = null;
  let eur = null;

  const initialBaseScore = Number(state.scores[base] ?? 0);
  const initialQuoteScore = Number(state.scores[quote] ?? 0);

  let baseScore = initialBaseScore;
  let quoteScore = initialQuoteScore;

  const liveSources = [];

  if (base === "USD" || quote === "USD") {
    try {
      usd = await api("/api/usd-macro");

      if (
        usd.success &&
        Number.isFinite(Number(usd.scores?.total))
      ) {
        state.previous.USD = state.scores.USD;
        state.scores.USD = Number(usd.scores.total);

        if (base === "USD") {
          baseScore = state.scores.USD;
        }

        if (quote === "USD") {
          quoteScore = state.scores.USD;
        }

        liveSources.push("USD");
      }
    } catch (error) {
      console.warn("USD macro unavailable:", error.message);
    }
  }

  if (base === "EUR" || quote === "EUR") {
    try {
      eur = await api("/api/eur-macro");

      if (
        eur.success &&
        Number.isFinite(Number(eur.scores?.total))
      ) {
        state.previous.EUR = state.scores.EUR;
        state.scores.EUR = Number(eur.scores.total);

        if (base === "EUR") {
          baseScore = state.scores.EUR;
        }

        if (quote === "EUR") {
          quoteScore = state.scores.EUR;
        }

        liveSources.push("EUR");
      }
    } catch (error) {
      console.warn("EUR macro unavailable:", error.message);
    }
  }

  renderMacro();

  return {
    available: true,

    differential: baseScore - quoteScore,

    baseScore,
    quoteScore,

    usd,
    eur,

    source: liveSources.length
      ? `LIVE: ${liveSources.join(", ")} + DASHBOARD`
      : "DASHBOARD SCORES"
  };
}


/* =========================================================
   FUNDAMENTAL DIVERGENCE
   ========================================================= */

async function loadDivergence(base, quote) {
  const pair = `${base}/${quote}`;

  try {
    const result = await api(
      `/api/price-divergence?base=${encodeURIComponent(base)}&quote=${encodeURIComponent(quote)}`
    );

    if (!result.success) {
      return {
        available: false,
        present: false,
        direction: null,
        raw: result
      };
    }

    return {
      available: true,

      present:
        result.divergence === true ||
        result.divergence === "YES" ||
        result.divergence === "present",

      direction: result.direction ?? null,

      priceDirection: result.priceDirection ?? null,

      fundamentalDirection:
        result.fundamentalDirection ?? null,

      raw: result
    };

  } catch (error) {
    return {
      available: false,
      present: false,
      direction: null,
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
      summary: "Fundamental data is unavailable.",
      differential: null
    };
  }

  const differential = Number(macro.differential);

  if (!Number.isFinite(differential)) {
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

  if (!divergence.available) {
    return {
      action: `${bias} FUNDAMENTAL BIAS`,
      summary:
        "Fundamental bias calculated, but price divergence data is unavailable.",
      differential,
      divergence: "UNAVAILABLE"
    };
  }

  if (divergence.present) {
    return {
      action: `${bias} FUNDAMENTAL DIVERGENCE — WATCH`,
      summary:
        "Price movement is diverging from the fundamental outlook. Monitor the pair for a potential opportunity.",
      differential,
      divergence: "PRESENT"
    };
  }

  return {
    action: `${bias} FUNDAMENTAL BIAS`,
    summary:
      "Fundamental direction identified. No opposing price movement has been detected.",
    differential,
    divergence: "NOT DETECTED"
  };
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
      divergence.available
        ? `Divergence ${divergence.present ? "YES" : "NO"}`
        : "Divergence N/A";
  }

  if ($("technical")) {
    $("technical").textContent = "Manual technical analysis";
  }

  const items = [
    `Base currency: ${base}`,
    `Base score: ${macro.baseScore}`,
    `Quote currency: ${quote}`,
    `Quote score: ${macro.quoteScore}`,
    `Fundamental differential: ${decision.differential ?? "N/A"}`,
    `Fundamental bias: ${decision.action}`,

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
      divergence.available
        ? divergence.present ? "PRESENT" : "NOT DETECTED"
        : "UNAVAILABLE"
    }`,

    `Data source: ${macro.source}`,

    "Technical analysis: To be performed manually using TradingView."
  ];

  if ($("why")) {
    $("why").innerHTML = items
      .map(item => `<li>${item}</li>`)
      .join("");
  }

  if ($("plan")) {
    $("plan").innerHTML = `
      <div class="setup">

        <div>
          <b>Fundamental direction</b><br>
          ${decision.action}
        </div>

        <div>
          <b>Fundamental differential</b><br>
          ${decision.differential ?? "N/A"}
        </div>

        <div>
          <b>Price divergence</b><br>
          ${
            divergence.available
              ? divergence.present
                ? "Present — monitor"
                : "Not detected"
              : "Data unavailable"
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

    const differential =
      Number(state.scores[base] ?? 0) -
      Number(state.scores[quote] ?? 0);

    return {
      pair,
      differential,
      absolute: Math.abs(differential),
      strength: macroStrengthLabel(differential),
      bias: macroBias(differential)
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
          <span>${item.differential}</span>
          <span>${item.strength}</span>
          <span>${item.bias}</span>
        </div>
      `).join("")}

    </div>

    <p class="scanner-footer">
      Showing the strongest 12 of 28 pairs.
      Rankings are based on available currency scores.
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
        "Scan complete — ranked by fundamental differential.";
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
      <b>${entry.p}</b>
      <p>${entry.n}</p>
      <small>${entry.t}</small>
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
