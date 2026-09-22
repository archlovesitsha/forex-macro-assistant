const C = ["USD","EUR","GBP","JPY","CHF","CAD","AUD","NZD"];

const state = {
  scores: Object.fromEntries(C.map(c => [c, 0])),
  previous: Object.fromEntries(C.map(c => [c, 0])),
  quotes: {},
  calendar: [],
  analysis: null
};

const $ = x => document.getElementById(x);

// ============================================================
// PAIR LIST
// ============================================================

for (const a of C) {
  for (const b of C) {
    if (a !== b) {
      const o = document.createElement("option");
      o.value = a + "/" + b;
      o.textContent = a + "/" + b;
      $("pair").append(o);
    }
  }
}

// ============================================================
// MACRO DISPLAY
// ============================================================

function renderMacro() {
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

  document.querySelectorAll("[data-c]").forEach(e => {
    e.oninput = () => {
      state.scores[e.dataset.c] = +e.value;
      e.nextElementSibling.textContent = e.value;
      analyse();
    };
  });

  $("momentum").innerHTML = C.map(c => {
    const change =
      state.scores[c] - state.previous[c];

    return `
      <div class="momentum">
        <b>${c}</b>
        <span>${state.previous[c]} → ${state.scores[c]}</span>
        <span>${change > 0 ? "↑" : change < 0 ? "↓" : "→"}</span>
        <span>${change}</span>
      </div>
    `;
  }).join("");
}

// ============================================================
// API HELPER
// ============================================================

async function api(url) {
  const r = await fetch(url);

  if (!r.ok) {
    throw new Error(
      `API request failed: ${r.status}`
    );
  }

  return r.json();
}

// ============================================================
// LOAD REAL MACRO DATA
// ============================================================

async function loadMacro(b, q) {

  // At this stage our validated macro backend is
  // specifically USD/EUR.

  if (
    !(
      (b === "USD" && q === "EUR") ||
      (b === "EUR" && q === "USD")
    )
  ) {
    return {
      available: false,
      differential: null,
      baseScore: null,
      quoteScore: null
    };
  }

  const usd = await api("/api/usd-macro");
  const eur = await api("/api/eur-macro");

  if (
    !usd.success ||
    !eur.success
  ) {
    return {
      available: false,
      differential: null,
      baseScore: null,
      quoteScore: null
    };
  }

  const usdScore =
    Number(usd.score ?? 0);

  const eurScore =
    Number(eur.score ?? 0);

  const baseScore =
    b === "USD"
      ? usdScore
      : eurScore;

  const quoteScore =
    q === "USD"
      ? usdScore
      : eurScore;

  return {
    available: true,
    differential:
      baseScore - quoteScore,
    baseScore,
    quoteScore,
    usd,
    eur
  };
}

// ============================================================
// LOAD PRICE / FUNDAMENTAL DIVERGENCE
// ============================================================

async function loadDivergence(b, q) {

  // The current validated divergence endpoint
  // is EUR/USD.

  if (
    !(
      (b === "EUR" && q === "USD") ||
      (b === "USD" && q === "EUR")
    )
  ) {
    return {
      available: false,
      present: false,
      direction: null
    };
  }

  const result =
    await api(
      `/api/price-divergence?base=${b}&quote=${q}`
    );

  if (!result.success) {
    return {
      available: false,
      present: false,
      direction: null
    };
  }

  return {
    available: true,
    present:
      result.divergence === true ||
      result.divergence === "YES" ||
      result.divergence === "present",
    direction:
      result.direction ?? null,
    raw: result
  };
}

// ============================================================
// LOAD REAL TECHNICAL CONFIRMATION
// ============================================================

async function loadTechnical(b, q) {

  // The technical confirmation engine is currently
  // validated for EUR/USD.

  if (b !== "EUR" || q !== "USD") {
    return {
      available: false,
      confirmed: false,
      direction: null,
      value: 0,
      raw: null
    };
  }

  const result =
    await api(
      "/api/technical-confirmation"
    );

  if (!result.success) {
    return {
      available: false,
      confirmed: false,
      direction: null,
      value: 0,
      raw: result
    };
  }

  const confirmed =
    result.technical_status ===
      "CONFIRMED" ||
    result.technical_status ===
      "TECHNICAL_CONFIRMED";

  let value = 0;

  if (confirmed) {
    if (result.direction === "BULLISH") {
      value = 3;
    }

    if (result.direction === "BEARISH") {
      value = -3;
    }
  }

  return {
    available: true,
    confirmed,
    direction:
      result.direction ?? null,
    value,
    raw: result
  };
}

// ============================================================
// FINAL RULE-BASED DECISION
// ============================================================

function buildDecision(
  pair,
  macro,
  divergence,
  technical
) {

  const [b, q] =
    pair.split("/");

  // ----------------------------------------------------------
  // DATA AVAILABILITY
  // ----------------------------------------------------------

  if (!macro.available) {
    return {
      action: "PASS",
      summary:
        "Macro data is not available for this pair in the current validated framework.",
      differential: null,
      technicalValue: 0
    };
  }

  if (!divergence.available) {
    return {
      action: "PASS",
      summary:
        "Price/fundamental divergence is not available for this pair.",
      differential:
        macro.differential,
      technicalValue: 0
    };
  }

  if (!technical.available) {
    return {
      action: "PASS",
      summary:
        "Technical confirmation is not available for this pair.",
      differential:
        macro.differential,
      technicalValue: 0
    };
  }

  const differential =
    macro.differential;

  // ----------------------------------------------------------
  // DIVERGENCE-FIRST FRAMEWORK
  // ----------------------------------------------------------
  //
  // We do NOT require the fundamental differential
  // itself to point in the same direction as the trade.
  //
  // Instead:
  //
  // Fundamental view
  //       ↓
  // Price divergence
  //       ↓
  // Technical reversal confirmation
  //       ↓
  // Action
  //
  // This follows the strategy we designed.

  if (!divergence.present) {
    return {
      action: "PASS",
      summary:
        "No fundamental price divergence is currently detected.",
      differential,
      technicalValue:
        technical.value
    };
  }

  if (!technical.confirmed) {
    return {
      action: "WAIT",
      summary:
        "Fundamental divergence is present, but technical confirmation is incomplete.",
      differential,
      technicalValue:
        technical.value
    };
  }

  // ----------------------------------------------------------
  // CONFIRMED DIRECTION
  // ----------------------------------------------------------

  if (
    technical.direction ===
    "BULLISH"
  ) {
    return {
      action:
        "BUY " + pair,
      summary:
        "Fundamental divergence is present and bullish technical confirmation has been completed.",
      differential,
      technicalValue: 3
    };
  }

  if (
    technical.direction ===
    "BEARISH"
  ) {
    return {
      action:
        "SELL " + pair,
      summary:
        "Fundamental divergence is present and bearish technical confirmation has been completed.",
      differential,
      technicalValue: -3
    };
  }

  return {
    action: "WAIT",
    summary:
      "The framework has not produced a confirmed directional technical signal.",
    differential,
    technicalValue: 0
  };
}

// ============================================================
// DISPLAY DECISION
// ============================================================

function renderDecision(
  pair,
  macro,
  divergence,
  technical,
  decision
) {

  const [b, q] =
    pair.split("/");

  const differential =
    decision.differential;

  $("action").textContent =
    decision.action;

  $("summary").textContent =
    decision.summary;

  $("differential").textContent =
    differential === null
      ? "Differential N/A"
      : `Differential ${differential}`;

  $("divergence").textContent =
    divergence.available
      ? `Divergence ${
          divergence.present
            ? "YES"
            : "NO"
        }`
      : "Divergence N/A";

  $("technical").textContent =
    technical.available
      ? `Technical ${
          Math.abs(
            technical.value
          )
        }/3`
      : "Technical N/A";

  $("why").innerHTML = [
    `Base ${b}: ${
      macro.baseScore === null
        ? "N/A"
        : macro.baseScore
    }`,

    `Quote ${q}: ${
      macro.quoteScore === null
        ? "N/A"
        : macro.quoteScore
    }`,

    `Relative differential: ${
      differential === null
        ? "N/A"
        : differential
    }`,

    `Price/fundamental divergence: ${
      divergence.available
        ? divergence.present
          ? "present"
          : "not detected"
        : "data unavailable"
    }`,

    `Technical confirmation: ${
      technical.available
        ? technical.confirmed
          ? "CONFIRMED"
          : "NOT CONFIRMED"
        : "data unavailable"
    }`,

    "Action is rule-based decision support, not a guaranteed forecast."
  ]
    .map(x => `<li>${x}</li>`)
    .join("");

  $("plan").innerHTML = `
    <div class="setup">

      <div>
        <b>Direction</b><br>
        ${decision.action}
      </div>

      <div>
        <b>Invalidation</b><br>
        Set beyond the technical structure
        that invalidates the thesis.
      </div>

      <div>
        <b>Entry</b><br>
        Wait for the confirmed H1 candle-close
        structure break after the H4 setup.
      </div>

      <div>
        <b>Target</b><br>
        Use the next meaningful higher-timeframe
        level and maintain defined risk.
      </div>

    </div>
  `;
}

// ============================================================
// MAIN ANALYSIS
// ============================================================

async function analyse() {

  const pair =
    $("pair").value;

  const [b, q] =
    pair.split("/");

  $("action").textContent =
    "ANALYSING...";

  $("summary").textContent =
    "Loading macro, divergence and technical data...";

  try {

    const [
      macro,
      divergence,
      technical
    ] = await Promise.all([
      loadMacro(b, q),
      loadDivergence(b, q),
      loadTechnical(b, q)
    ]);

    state.analysis = {
      pair,
      macro,
      divergence,
      technical
    };

    const decision =
      buildDecision(
        pair,
        macro,
        divergence,
        technical
      );

    renderDecision(
      pair,
      macro,
      divergence,
      technical,
      decision
    );

    if (
      technical.raw &&
      technical.raw.latest &&
      technical.raw.latest.h1
    ) {
      $("quote").textContent =
        `${pair}: ${
          technical.raw.latest.h1.close
        }`;
    }

  } catch (e) {

    console.error(e);

    $("action").textContent =
      "PASS";

    $("summary").textContent =
      "Analysis data could not be loaded.";

    $("dataStatus").textContent =
      "Some live analysis data is unavailable.";

    $("providerStatus").textContent =
      e.message;

    $("differential").textContent =
      "Differential N/A";

    $("divergence").textContent =
      "Divergence N/A";

    $("technical").textContent =
      "Technical N/A";
  }
}

// ============================================================
// REFRESH LIVE DATA
// ============================================================

async function refresh() {

  const [b, q] =
    $("pair").value.split("/");

  try {

    const fx =
      await api(
        `/api/fx/rate?from=${b}&to=${q}`
      );

    if (
      fx.configured
    ) {

      const x =
        fx.data[
          "Realtime Currency Exchange Rate"
        ];

      if (x) {

        const price =
          +x["5. Exchange Rate"];

        state.quotes[
          `${b}/${q}`
        ] = {
          price
        };

        $("quote").textContent =
          `${b}/${q}: ${price}`;
      }

      $("dataStatus").textContent =
        "Live FX provider connected.";

      $("providerStatus").textContent =
        "Alpha Vantage connection detected.";

    } else {

      $("dataStatus").textContent =
        "FX provider not configured; analysis data may be limited.";

      $("providerStatus").textContent =
        "FX provider is not configured.";
    }

  } catch (e) {

    $("dataStatus").textContent =
      "Live FX rate unavailable; analysis will use available backend data.";

    $("providerStatus").textContent =
      "Live FX rate request failed.";
  }

  await analyse();
}

// ============================================================
// NAVIGATION
// ============================================================

document
  .querySelectorAll("nav button")
  .forEach(b => {

    b.onclick = () => {

      document
        .querySelectorAll("nav button")
        .forEach(x =>
          x.classList.remove(
            "active"
          )
        );

      document
        .querySelectorAll(".panel")
        .forEach(x =>
          x.classList.remove(
            "active"
          )
        );

      b.classList.add(
        "active"
      );

      $(b.dataset.p)
        .classList.add(
          "active"
        );

      if (
        b.dataset.p ===
        "macro"
      ) {
        renderMacro();
      }
    };
  });

// ============================================================
// BUTTONS
// ============================================================

$("scan").onclick =
  analyse;

$("refresh").onclick =
  refresh;

$("pair").onchange =
  refresh;

// ============================================================
// RISK CALCULATOR
// ============================================================

$("calc").onclick = () => {

  const balance =
    +$("bal").value;

  const riskPercent =
    +$("rp").value;

  const stop =
    +$("stop").value;

  const pipValue =
    +$("pv").value;

  if (
    !balance ||
    !riskPercent ||
    !stop ||
    !pipValue
  ) {
    $("lot").textContent =
      "Enter valid risk values.";

    return;
  }

  const riskAmount =
    balance *
    riskPercent /
    100;

  const n =
    riskAmount /
    (stop * pipValue);

  $("lot").textContent =
    `Lot size ${n.toFixed(2)} lots`;
};

// ============================================================
// JOURNAL
// ============================================================

function logs() {

  const a =
    JSON.parse(
      localStorage.getItem(
        "fma2"
      ) || "[]"
    );

  $("logs").innerHTML =
    a.map(x => `
      <article class="card">
        <b>${x.p}</b>
        <p>${x.n}</p>
        <small>${x.t}</small>
      </article>
    `).join("");
}

$("save").onclick = () => {

  let a =
    JSON.parse(
      localStorage.getItem(
        "fma2"
      ) || "[]"
    );

  a.unshift({
    p: $("jp").value,
    n: $("jn").value,
    t: new Date()
      .toLocaleString()
  });

  localStorage.setItem(
    "fma2",
    JSON.stringify(a)
  );

  $("jp").value = "";
  $("jn").value = "";

  logs();
};

// ============================================================
// SERVICE WORKER
// ============================================================

if (
  "serviceWorker" in navigator
) {
  navigator.serviceWorker
    .register("sw.js")
    .catch(() => {});
}

// ============================================================
// INITIAL LOAD
// ============================================================

renderMacro();

analyse();

logs();

refresh();
