const C = [
  "USD",
  "EUR",
  "GBP",
  "JPY",
  "CHF",
  "CAD",
  "AUD",
  "NZD"
];

const STANDARD_PAIRS = [
  "EUR/USD",
  "GBP/USD",
  "USD/JPY",
  "USD/CHF",
  "AUD/USD",
  "USD/CAD",
  "NZD/USD",

  "EUR/GBP",
  "EUR/JPY",
  "EUR/CHF",
  "EUR/AUD",
  "EUR/CAD",
  "EUR/NZD",

  "GBP/JPY",
  "GBP/CHF",
  "GBP/AUD",
  "GBP/CAD",
  "GBP/NZD",

  "CHF/JPY",

  "AUD/JPY",
  "CAD/JPY",
  "NZD/JPY",

  "AUD/CHF",
  "CAD/CHF",
  "NZD/CHF",

  "AUD/CAD",
  "NZD/CAD",

  "NZD/AUD"
];

const state = {

  scores:
    Object.fromEntries(
      C.map(c => [c, 0])
    ),

  previous:
    Object.fromEntries(
      C.map(c => [c, 0])
    ),

  quotes: {},

  calendar: [],

  analysis: null

};


const $ = x =>
  document.getElementById(x);


/* =========================================================
   PAIR LIST
   ========================================================= */

if ($("pair")) {

  $("pair").innerHTML = "";

  STANDARD_PAIRS.forEach(pair => {

    const option =
      document.createElement("option");

    option.value = pair;

    option.textContent = pair;

    $("pair").append(option);

  });

}


/* =========================================================
   MACRO DASHBOARD
   ========================================================= */

function renderMacro() {

  if (!$("currencies")) {
    return;
  }

  $("currencies").innerHTML =
    C.map(c => `

      <div class="currency">

        <b>${c}</b>

        <input
          data-c="${c}"
          type="range"
          min="-10"
          max="10"
          value="${state.scores[c]}"
        >

        <span class="score">
          ${state.scores[c]}
        </span>

      </div>

    `).join("");


  document
    .querySelectorAll("[data-c]")
    .forEach(e => {

      e.oninput = () => {

        state.scores[e.dataset.c] =
          +e.value;

        e.nextElementSibling.textContent =
          e.value;

        renderMacro();

        analyse();

        renderOpportunityScanner();

      };

    });


  if ($("momentum")) {

    $("momentum").innerHTML =
      C.map(c => {

        const change =
          state.scores[c] -
          state.previous[c];

        return `

          <div class="momentum">

            <b>${c}</b>

            <span>
              ${state.previous[c]}
              →
              ${state.scores[c]}
            </span>

            <span>
              ${
                change > 0
                  ? "↑"
                  : change < 0
                    ? "↓"
                    : "→"
              }
            </span>

            <span>
              ${change}
            </span>

          </div>

        `;

      }).join("");

  }

}


/* =========================================================
   API
   ========================================================= */

async function api(url) {

  const r =
    await fetch(url);

  if (!r.ok) {

    throw new Error(
      `API request failed: ${r.status}`
    );

  }

  return r.json();

}


/* =========================================================
   MACRO DATA
   ========================================================= */

async function loadMacro(b, q) {

  /*
   * USD and EUR have live macro engines.
   *
   * For other currencies we use the
   * current dashboard scores until their
   * live macro engines are connected.
   */

  let baseScore =
    Number(state.scores[b] ?? 0);

  let quoteScore =
    Number(state.scores[q] ?? 0);

  let usd = null;

  let eur = null;

  /*
   * Load validated live USD/EUR macro data
   * whenever one of those currencies is involved.
   */

  try {

    if (b === "USD" || q === "USD") {

      usd =
        await api(
          "/api/usd-macro"
        );

      if (usd.success) {

        const live =
          Number(
            usd.scores?.total ?? 0
          );

        state.previous.USD =
          state.scores.USD;

        state.scores.USD =
          live;

        baseScore =
          b === "USD"
            ? live
            : baseScore;

        quoteScore =
          q === "USD"
            ? live
            : quoteScore;

      }

    }

  } catch (e) {

    console.warn(
      "USD macro unavailable:",
      e.message
    );

  }


  try {

    if (b === "EUR" || q === "EUR") {

      eur =
        await api(
          "/api/eur-macro"
        );

      if (eur.success) {

        const live =
          Number(
            eur.scores?.total ?? 0
          );

        state.previous.EUR =
          state.scores.EUR;

        state.scores.EUR =
          live;

        baseScore =
          b === "EUR"
            ? live
            : baseScore;

        quoteScore =
          q === "EUR"
            ? live
            : quoteScore;

      }

    }

  } catch (e) {

    console.warn(
      "EUR macro unavailable:",
      e.message
    );

  }


  return {

    available: true,

    differential:
      baseScore - quoteScore,

    baseScore,

    quoteScore,

    usd,

    eur,

    source:
      (usd || eur)
        ? "LIVE + DASHBOARD"
        : "DASHBOARD"

  };

}


/* =========================================================
   DIVERGENCE
   ========================================================= */

async function loadDivergence(b, q) {

  const pair =
    `${b}/${q}`;

  try {

    const result =
      await api(
        `/api/price-divergence?base=${encodeURIComponent(b)}&quote=${encodeURIComponent(q)}`
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

      direction:
        result.direction ?? null,

      raw: result

    };

  } catch (e) {

    return {

      available: false,

      present: false,

      direction: null,

      raw: {

        success: false,

        error: e.message,

        pair

      }

    };

  }

}


/* =========================================================
   TECHNICAL CONFIRMATION
   ========================================================= */

async function loadTechnical(b, q) {

  const pair =
    `${b}/${q}`;

  try {

    const result =
      await api(
        `/api/technical-confirmation?pair=${encodeURIComponent(pair)}`
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

      if (
        result.direction ===
        "BULLISH"
      ) {

        value = 3;

      }

      if (
        result.direction ===
        "BEARISH"
      ) {

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

  } catch (e) {

    return {

      available: false,

      confirmed: false,

      direction: null,

      value: 0,

      raw: {

        success: false,

        error: e.message,

        pair

      }

    };

  }

}


/* =========================================================
   DECISION ENGINE
   ========================================================= */

function buildDecision(
  pair,
  macro,
  divergence,
  technical
) {

  if (!macro.available) {

    return {

      action: "PASS",

      summary:
        "Macro data is not available for this pair.",

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


/* =========================================================
   TECHNICAL HELPERS
   ========================================================= */

function getH4Context(t) {

  const h4 =
    t?.h4 || {};

  const structure =
    h4.market_structure || {};


  if (structure.context) {

    return structure.context;

  }


  if (
    structure.direction &&
    structure.direction !== "NEUTRAL"
  ) {

    return structure.direction;

  }


  const reasons =
    Array.isArray(t?.reasons)
      ? t.reasons
      : [];


  const contextReason =
    reasons.find(x =>
      x.startsWith("H4 context:")
    );


  if (contextReason) {

    return contextReason
      .replace(
        "H4 context:",
        ""
      )
      .trim();

  }


  return structure.direction ||
    "N/A";

}


function getH1Alignment(t) {

  const h4Context =
    getH4Context(t);


  const h1Direction =
    t?.h1?.market_structure
      ?.direction ||
    "N/A";


  const h4Bearish =
    String(h4Context)
      .toUpperCase()
      .includes("BEARISH");


  const h4Bullish =
    String(h4Context)
      .toUpperCase()
      .includes("BULLISH");


  const h1Bearish =
    String(h1Direction)
      .toUpperCase()
      .includes("BEARISH");


  const h1Bullish =
    String(h1Direction)
      .toUpperCase()
      .includes("BULLISH");


  if (
    (h4Bearish && h1Bearish) ||
    (h4Bullish && h1Bullish)
  ) {

    return "ALIGNED";

  }


  if (
    (h4Bearish && h1Bullish) ||
    (h4Bullish && h1Bearish)
  ) {

    return "CONFLICT";

  }


  return "UNCONFIRMED";

}


/* =========================================================
   DECISION DISPLAY
   ========================================================= */

function gateSymbol(value) {

  return value
    ? "✅"
    : "❌";

}


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


  const whyItems = [

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

    `<strong>Macro source:</strong>
     ${macro.source || "N/A"}`

  ];


  if (
    technical.available &&
    technical.raw
  ) {

    const t =
      technical.raw;

    const gates =
      t.gates || {};

    const h4 =
      t.h4 || {};

    const h1 =
      t.h1 || {};

    const continuation =
      gates.continuation_diagnostics ||
      {};

    const reasons =
      Array.isArray(t.reasons)
        ? t.reasons
        : [];

    const h4Context =
      getH4Context(t);

    const h1Alignment =
      getH1Alignment(t);


    let alignmentText =
      h1Alignment;


    if (
      h1Alignment ===
      "CONFLICT"
    ) {

      alignmentText =
        "CONFLICT — H1 structure does not match H4 context";

    }


    whyItems.push(

      `<strong>Technical direction:</strong>
       ${t.direction || "N/A"}`,

      `<strong>H4 context:</strong>
       ${gateSymbol(gates.h4_structure)}
       ${h4Context}`,

      `<strong>H4 location:</strong>
       ${gateSymbol(gates.h4_location)}
       ${gates.h4_location_type || "NONE"}`,

      `<strong>Recent H4 BOS:</strong>
       ${gateSymbol(gates.recent_h4_bos)}
       ${h4.break_of_structure?.direction || "N/A"}`,

      `<strong>H1 retracement:</strong>
       ${gateSymbol(gates.h1_retracement)}
       ${h1.retracement?.type || "NONE"}`,

      `<strong>H1 structure:</strong>
       ${gateSymbol(gates.h1_structure)}
       ${h1.market_structure?.direction || "N/A"}`,

      `<strong>H4/H1 alignment:</strong>
       ${alignmentText}`,

      `<strong>H1 BOS:</strong>
       ${gateSymbol(gates.h1_bos)}
       ${
         h1.break_of_structure?.confirmed
           ? h1.break_of_structure.direction
           : "NOT CONFIRMED"
       }`

    );


    if (
      continuation.reason
    ) {

      whyItems.push(

        `<strong>H4 location diagnostic:</strong>
         ${continuation.reason}`

      );

    }


    if (
      reasons.length
    ) {

      whyItems.push(

        `<strong>Technical reasoning:</strong>
         ${reasons.join(" ")}`

      );

    }

  }


  whyItems.push(

    `<strong>Technical confirmation:</strong>
     ${
       technical.available
         ? technical.confirmed
           ? "CONFIRMED"
           : "NOT CONFIRMED"
         : "data unavailable"
     }`,

    `Action is rule-based decision support, not a guaranteed forecast.`

  );


  $("why").innerHTML =
    whyItems
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


/* =========================================================
   MULTI-PAIR OPPORTUNITY SCANNER
   ========================================================= */

function getMacroPairs() {

  return STANDARD_PAIRS.slice();

}


function macroStrengthLabel(
  differential
) {

  const absolute =
    Math.abs(differential);


  if (absolute >= 6) {
    return "VERY STRONG";
  }

  if (absolute >= 4) {
    return "STRONG";
  }

  if (absolute >= 2) {
    return "MODERATE";
  }

  if (absolute >= 1) {
    return "WEAK";
  }

  return "NEUTRAL";

}


function macroBias(
  differential
) {

  if (differential > 0) {
    return "BULLISH";
  }

  if (differential < 0) {
    return "BEARISH";
  }

  return "NEUTRAL";

}


function renderOpportunityScanner() {

  const container =
    $("opportunityScanner");

  if (!container) {
    return;
  }


  const rows =
    getMacroPairs()
      .map(pair => {

        const [base, quote] =
          pair.split("/");


        const differential =
          Number(state.scores[base] ?? 0) -
          Number(state.scores[quote] ?? 0);


        const absolute =
          Math.abs(differential);


        let status =
          "MACRO SCREEN";


        let action =
          differential > 0
            ? "BUY BIAS"
            : differential < 0
              ? "SELL BIAS"
              : "NEUTRAL";


        let technical =
          "Not checked";


        /*
         * If this is the pair currently being analysed,
         * display the actual technical result.
         */

        if (
          state.analysis &&
          state.analysis.pair === pair
        ) {

          const t =
            state.analysis.technical;


          if (t && t.available) {

            if (t.confirmed) {

              action =
                t.direction ===
                "BULLISH"
                  ? `BUY ${pair}`
                  : t.direction ===
                    "BEARISH"
                      ? `SELL ${pair}`
                      : "WAIT";

              technical =
                t.direction ||
                "CONFIRMED";

              status =
                "FULL PIPELINE";

            } else {

              action =
                "WAIT";

              technical =
                "INCOMPLETE";

              status =
                "TECHNICAL CHECKED";

            }

          }

        }


        return {

          pair,

          differential,

          absolute,

          strength:
            macroStrengthLabel(
              differential
            ),

          bias:
            macroBias(
              differential
            ),

          action,

          technical,

          status

        };

      })

      .sort(
        (a, b) =>
          b.absolute -
          a.absolute
      );


  const top =
    rows.slice(0, 12);


  container.innerHTML = `

    <div class="scanner-note">

      <b>How to read this:</b>

      The scanner ranks the 28 standard
      forex pairs by the difference between
      their current currency scores.

      <br><br>

      A positive differential means the
      base currency currently has the
      stronger score.

      <br>

      A negative differential means the
      quote currency currently has the
      stronger score.

      <br><br>

      Technical confirmation is checked
      when a pair is analysed.

    </div>

    <div class="scanner-table">

      <div class="scanner-row scanner-header">

        <span>Pair</span>
        <span>Diff</span>
        <span>Strength</span>
        <span>Bias</span>
        <span>Technical</span>
        <span>Status</span>

      </div>

      ${
        top.map(x => `

          <div
            class="scanner-row"
            data-pair="${x.pair}"
          >

            <span>
              <b>${x.pair}</b>
            </span>

            <span>
              ${x.differential}
            </span>

            <span>
              ${x.strength}
            </span>

            <span>
              ${x.action}
            </span>

            <span>
              ${x.technical}
            </span>

            <span>
              ${x.status}
            </span>

          </div>

        `).join("")
      }

    </div>

    <p class="scanner-footer">

      Showing the strongest 12 of the
      28 standard forex pairs.

      This is a screening tool, not a
      trade signal by itself.

    </p>

  `;


  document
    .querySelectorAll(
      ".scanner-row[data-pair]"
    )
    .forEach(row => {

      row.onclick = () => {

        const pair =
          row.dataset.pair;

        $("pair").value =
          pair;

        analyse();

        window.scrollTo({
          top: 0,
          behavior: "smooth"
        });

      };

    });

}


/* =========================================================
   MAIN ANALYSIS
   ========================================================= */

async function analyse() {

  const pair =
    $("pair").value;


  if (!pair) {
    return;
  }


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
    ] =
      await Promise.all([

        loadMacro(
          b,
          q
        ),

        loadDivergence(
          b,
          q
        ),

        loadTechnical(
          b,
          q
        )

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


    renderOpportunityScanner();


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


    if ($("dataStatus")) {

      $("dataStatus").textContent =
        "Some live analysis data is unavailable.";

    }


    if ($("providerStatus")) {

      $("providerStatus").textContent =
        e.message;

    }


    $("differential").textContent =
      "Differential N/A";


    $("divergence").textContent =
      "Divergence N/A";


    $("technical").textContent =
      "Technical N/A";

  }

}


/* =========================================================
   REFRESH
   ========================================================= */

async function refresh() {

  const [b, q] =
    $("pair")
      .value
      .split("/");


  try {

    const fx =
      await api(
        `/api/fx/rate?from=${encodeURIComponent(b)}&to=${encodeURIComponent(q)}`
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


/* =========================================================
   NAVIGATION
   ========================================================= */

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


/* =========================================================
   BUTTONS
   ========================================================= */

if ($("scan")) {

  $("scan").onclick =
    analyse;

}


if ($("refresh")) {

  $("refresh").onclick =
    refresh;

}


if ($("pair")) {

  $("pair").onchange =
    refresh;

}


if ($("scanAll")) {

  $("scanAll").onclick = () => {

    $("scannerStatus").textContent =
      "Scanning 28 standard currency pairs...";


    renderOpportunityScanner();


    $("scannerStatus").textContent =
      "Scan complete — ranked by fundamental differential.";

  };

}


/* =========================================================
   RISK CALCULATOR
   ========================================================= */

if ($("calc")) {

  $("calc").onclick = () => {

    const balance =
      +$("bal").value;


    const riskPercent =
      +$("rp").value;


    const stop =
      +$("stop").value;


    const target =
      +$("target").value;


    const pipValue =
      +$("pv").value;


    if (
      !balance ||
      balance <= 0 ||
      !riskPercent ||
      riskPercent <= 0 ||
      !stop ||
      stop <= 0 ||
      !target ||
      target <= 0 ||
      !pipValue ||
      pipValue <= 0
    ) {

      $("lot").textContent =
        "Enter valid risk values.";


      $("rrResult").textContent =
        "Enter valid risk/reward values.";


      return;

    }


    const riskAmount =
      balance *
      riskPercent /
      100;


    const lotSize =
      riskAmount /
      (stop * pipValue);


    const rewardRisk =
      target / stop;


    const potentialProfit =
      target *
      pipValue *
      lotSize;


    const maximumLoss =
      stop *
      pipValue *
      lotSize;


    let warning = "";


    if (
      riskPercent >= 5
    ) {

      warning =
        " ⚠️ High risk per trade.";

    }


    $("lot").innerHTML = `

      <strong>
        Lot size: ${lotSize.toFixed(3)} lots
      </strong><br>

      Risk amount:
      $${riskAmount.toFixed(2)}
      ${warning}<br>

      Maximum loss:
      $${maximumLoss.toFixed(2)}

    `;


    $("rrResult").innerHTML = `

      <strong>
        Risk / Reward:
        1:${rewardRisk.toFixed(2)}
      </strong><br>

      Stop:
      ${stop} pips<br>

      Target:
      ${target} pips<br>

      Potential profit:
      $${potentialProfit.toFixed(2)}<br>

      Potential loss:
      $${maximumLoss.toFixed(2)}

    `;

  };

}


/* =========================================================
   JOURNAL
   ========================================================= */

function logs() {

  const a =
    JSON.parse(
      localStorage.getItem(
        "fma2"
      ) || "[]"
    );


  if (!$("logs")) {
    return;
  }


  $("logs").innerHTML =
    a.map(x => `

      <article class="card">

        <b>${x.p}</b>

        <p>${x.n}</p>

        <small>${x.t}</small>

      </article>

    `).join("");

}


if ($("save")) {

  $("save").onclick = () => {

    let a =
      JSON.parse(
        localStorage.getItem(
          "fma2"
        ) || "[]"
      );


    a.unshift({

      p:
        $("jp").value,

      n:
        $("jn").value,

      t:
        new Date()
          .toLocaleString()

    });


    localStorage.setItem(
      "fma2",
      JSON.stringify(a)
    );


    $("jp").value =
      "";

    $("jn").value =
      "";


    logs();

  };

}


/* =========================================================
   SERVICE WORKER
   ========================================================= */

if (
  "serviceWorker" in navigator
) {

  navigator.serviceWorker
    .register("sw.js")
    .catch(() => {});

}


/* =========================================================
   INITIALISE
   ========================================================= */

renderMacro();

renderOpportunityScanner();

logs();

analyse();

refresh();
