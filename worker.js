// ============================================================
// FOREX MACRO ASSISTANT
// Cloudflare Workers — Fundamental Analysis Edition
// Version: 3.0
// ============================================================

const SUPPORTED_CURRENCIES = [
  "USD", "EUR", "GBP", "JPY",
  "CHF", "CAD", "AUD", "NZD"
];

const STANDARD_PAIRS = [
  "EUR/USD", "GBP/USD", "USD/JPY", "USD/CHF",
  "AUD/USD", "USD/CAD", "NZD/USD",
  "EUR/GBP", "EUR/JPY", "EUR/CHF",
  "EUR/AUD", "EUR/CAD", "EUR/NZD",
  "GBP/JPY", "GBP/CHF", "GBP/AUD",
  "GBP/CAD", "GBP/NZD", "CHF/JPY",
  "AUD/JPY", "CAD/JPY", "NZD/JPY",
  "AUD/CHF", "CAD/CHF", "NZD/CHF",
  "AUD/CAD", "NZD/CAD", "NZD/AUD"
];

// ============================================================
// CURRENCY CONFIGURATION
// ============================================================

const MACRO_CONFIG = {
  USD: {
    name: "US Dollar",
    country: "United States",
    source: "FRED",
    target: 2,
    series: {
      interest: "DFF",
      inflation: "CPIAUCSL",
      growth: "GDPC1",
      employment: "UNRATE",
      liquidity: "WALCL"
    }
  },

  EUR: {
    name: "Euro",
    country: "Euro Area",
    source: "FRED",
    target: 2,
    series: {
      interest: "ECBDFR",
      inflation: "CP0000EZ19M086NEST",
      growth: "CLVMNACSCAB1GQEA19"
    }
  },

  GBP: {
    name: "British Pound",
    country: "United Kingdom"
  },

  JPY: {
    name: "Japanese Yen",
    country: "Japan"
  },

  CHF: {
    name: "Swiss Franc",
    country: "Switzerland"
  },

  CAD: {
    name: "Canadian Dollar",
    country: "Canada"
  },

  AUD: {
    name: "Australian Dollar",
    country: "Australia"
  },

  NZD: {
    name: "New Zealand Dollar",
    country: "New Zealand"
  }
};

// ============================================================
// RESPONSE HELPERS
// ============================================================

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json;charset=UTF-8",
      "cache-control": "no-store"
    }
  });
}

function safeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalisePair(pair) {
  if (!pair) return null;

  const clean = String(pair)
    .trim()
    .toUpperCase()
    .replace("-", "/")
    .replace("_", "/");

  const parts = clean.split("/");

  if (parts.length !== 2) return null;

  const [base, quote] = parts;

  if (
    !SUPPORTED_CURRENCIES.includes(base) ||
    !SUPPORTED_CURRENCIES.includes(quote) ||
    base === quote
  ) {
    return null;
  }

  return `${base}/${quote}`;
}

function getPair(request) {
  const url = new URL(request.url);
  return normalisePair(url.searchParams.get("pair"));
}

// ============================================================
// FRED DATA PROVIDER
// ============================================================

async function fredSeries(seriesId, env, limit = 30) {
  const key = env.FRED_API_KEY;

  if (!key) {
    return {
      success: false,
      error: "FRED_API_KEY is not configured."
    };
  }

  const url = new URL(
    "https://api.stlouisfed.org/fred/series/observations"
  );

  url.searchParams.set("series_id", seriesId);
  url.searchParams.set("api_key", key);
  url.searchParams.set("file_type", "json");
  url.searchParams.set("sort_order", "desc");
  url.searchParams.set("limit", String(limit));

  try {
    const response = await fetch(url.toString());

    if (!response.ok) {
      return {
        success: false,
        error: `FRED request failed: ${response.status}`
      };
    }

    const data = await response.json();

    const observations = Array.isArray(data.observations)
      ? data.observations.filter(item =>
          item.value !== "." &&
          Number.isFinite(Number(item.value))
        )
      : [];

    return {
      success: true,
      seriesId,
      observations
    };

  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

// ============================================================
// FUNDAMENTAL SCORING HELPERS
// Scores: -2 to +2
// ============================================================

function unavailable(reason) {
  return {
    score: null,
    available: false,
    reason
  };
}

function pillar(score, reason) {
  return {
    score,
    available: true,
    reason
  };
}

function trendScore(change, positiveIsGood = true) {
  if (change === null) return null;

  if (Math.abs(change) < 0.000001) return 0;

  const positive = change > 0;

  if (positiveIsGood) {
    return positive ? 1 : -1;
  }

  return positive ? -1 : 1;
}

function getChange(observations, periods = 1) {
  if (
    !Array.isArray(observations) ||
    observations.length <= periods
  ) {
    return null;
  }

  const latest = safeNumber(observations[0].value);
  const previous = safeNumber(observations[periods].value);

  if (latest === null || previous === null) return null;

  return latest - previous;
}

function calculateInflation(observations, target) {
  if (!Array.isArray(observations) || observations.length < 14) {
    return unavailable("Insufficient inflation history.");
  }

  const currentIndex = safeNumber(observations[0].value);
  const yearAgoIndex = safeNumber(observations[12].value);

  const previousIndex = safeNumber(observations[1].value);
  const previousYearIndex = safeNumber(observations[13].value);

  if (
    currentIndex === null ||
    yearAgoIndex === null ||
    previousIndex === null ||
    previousYearIndex === null ||
    yearAgoIndex === 0 ||
    previousYearIndex === 0
  ) {
    return unavailable("Invalid inflation observations.");
  }

  const currentInflation =
    ((currentIndex / yearAgoIndex) - 1) * 100;

  const previousInflation =
    ((previousIndex / previousYearIndex) - 1) * 100;

  const currentDistance = Math.abs(currentInflation - target);
  const previousDistance = Math.abs(previousInflation - target);

  let score = 0;
  let reason = "Inflation position is broadly unchanged.";

  if (currentDistance <= 0.2) {
    score = 2;
    reason = "Inflation is close to the configured target.";
  } else if (currentDistance < previousDistance) {
    score = 1;
    reason = "Inflation is moving towards the configured target.";
  } else if (currentDistance > previousDistance) {
    score = -1;
    reason = "Inflation is moving away from the configured target.";
  }

  return {
    ...pillar(score, reason),
    currentInflation,
    previousInflation,
    target
  };
}

// ============================================================
// MACRO TOTAL
// ============================================================

function calculateTotal(pillars) {
  const available = Object.values(pillars)
    .filter(item => item.available && item.score !== null);

  if (!available.length) {
    return {
      score: null,
      coverage: 0,
      availablePillars: 0,
      totalPillars: Object.keys(pillars).length
    };
  }

  const score = available.reduce(
    (sum, item) => sum + item.score,
    0
  );

  return {
    score,
    coverage: Math.round(
      available.length / Object.keys(pillars).length * 100
    ),
    availablePillars: available.length,
    totalPillars: Object.keys(pillars).length
  };
}

// ============================================================
// GENERIC CURRENCY MACRO ENGINE
// ============================================================

async function currencyMacro(currency, env) {
  const config = MACRO_CONFIG[currency];

  if (!config) {
    return {
      success: false,
      error: "Unsupported currency."
    };
  }

  if (!config.series) {
    return {
      success: true,
      currency,
      name: config.name,
      country: config.country,
      available: false,
      scores: {
        total: null
      },
      reason: "Live macro indicators have not yet been configured."
    };
  }

  const entries = Object.entries(config.series);

  const results = await Promise.all(
    entries.map(async ([name, seriesId]) => [
      name,
      await fredSeries(
        seriesId,
        env,
        name === "inflation" ? 30 : 12
      )
    ])
  );

  const data = Object.fromEntries(results);

  const interestChange = data.interest?.success
    ? getChange(data.interest.observations)
    : null;

  const growthChange = data.growth?.success
    ? getChange(data.growth.observations)
    : null;

  const employmentChange = data.employment?.success
    ? getChange(data.employment.observations)
    : null;

  const liquidityChange = data.liquidity?.success
    ? getChange(data.liquidity.observations)
    : null;

  const pillars = {
    interest: interestChange === null
      ? unavailable("Interest-rate data unavailable.")
      : pillar(
          trendScore(interestChange, true),
          "Based on the latest policy-rate movement."
        ),

    inflation: data.inflation?.success
      ? calculateInflation(
          data.inflation.observations,
          config.target
        )
      : unavailable("Inflation data unavailable."),

    growth: growthChange === null
      ? unavailable("Growth data unavailable.")
      : pillar(
          trendScore(growthChange, true),
          "Based on the latest GDP movement; this is a basic trend indicator."
        ),

    employment: employmentChange === null
      ? unavailable("Employment data unavailable.")
      : pillar(
          trendScore(employmentChange, false),
          "Based on the latest unemployment-rate movement."
        ),

    liquidity: liquidityChange === null
      ? unavailable("Central-bank balance-sheet data unavailable.")
      : pillar(
          trendScore(liquidityChange, false),
          "Based on the latest central-bank balance-sheet movement."
        )
  };

  const total = calculateTotal(pillars);

  const latestData = {};

  for (const [name, result] of Object.entries(data)) {
    latestData[name] =
      result.success
        ? result.observations[0]
        : null;
  }

  return {
    success: true,
    currency,
    name: config.name,
    country: config.country,
    source: config.source,
    available: total.availablePillars > 0,

    scoringMethod: "Five-pillar fundamental scoring",

    scores: {
      interest: pillars.interest.score,
      inflation: pillars.inflation.score,
      growth: pillars.growth.score,
      employment: pillars.employment.score,
      liquidity: pillars.liquidity.score,
      total: total.score
    },

    pillars,
    total,
    data: latestData,
    updatedAt: new Date().toISOString()
  };
}

// ============================================================
// INDIVIDUAL CURRENCY ENDPOINT HELPERS
// ============================================================

async function usdMacro(env) {
  return currencyMacro("USD", env);
}

async function eurMacro(env) {
  return currencyMacro("EUR", env);
}

async function allCurrencyMacro(env) {
  const results = await Promise.all(
    SUPPORTED_CURRENCIES.map(async currency => [
      currency,
      await currencyMacro(currency, env)
    ])
  );

  return {
    success: true,
    currencies: Object.fromEntries(results),
    updatedAt: new Date().toISOString()
  };
}

// ============================================================
// FUNDAMENTAL PAIR ANALYSIS
// ============================================================

async function pairAnalysis(pair, env) {
  const [base, quote] = pair.split("/");

  const [baseData, quoteData] = await Promise.all([
    currencyMacro(base, env),
    currencyMacro(quote, env)
  ]);

  if (
    !baseData.available ||
    !quoteData.available ||
    baseData.scores.total === null ||
    quoteData.scores.total === null
  ) {
    return {
      success: true,
      pair,
      available: false,
      base,
      quote,
      baseScore: baseData.scores.total,
      quoteScore: quoteData.scores.total,
      differential: null,
      direction: "UNAVAILABLE",
      reason: "Both currencies need available fundamental data."
    };
  }

  const differential =
    baseData.scores.total - quoteData.scores.total;

  return {
    success: true,
    pair,
    available: true,
    base,
    quote,
    baseScore: baseData.scores.total,
    quoteScore: quoteData.scores.total,
    differential,
    direction:
      differential > 0 ? "BULLISH" :
      differential < 0 ? "BEARISH" :
      "NEUTRAL",
    baseCoverage: baseData.total.coverage,
    quoteCoverage: quoteData.total.coverage
  };
}

// ============================================================
// ALPHA VANTAGE LIVE FX RATE
// ============================================================

async function fxRate(from, to, env) {
  if (
    !SUPPORTED_CURRENCIES.includes(from) ||
    !SUPPORTED_CURRENCIES.includes(to) ||
    from === to
  ) {
    return {
      configured: false,
      error: "Invalid currency pair."
    };
  }

  const key = env.ALPHAVANTAGE_API_KEY;

  if (!key) {
    return {
      configured: false,
      provider: "Alpha Vantage",
      message: "ALPHAVANTAGE_API_KEY is not configured."
    };
  }

  const url = new URL("https://www.alphavantage.co/query");

  url.searchParams.set("function", "CURRENCY_EXCHANGE_RATE");
  url.searchParams.set("from_currency", from);
  url.searchParams.set("to_currency", to);
  url.searchParams.set("apikey", key);

  try {
    const response = await fetch(url.toString());

    const data = await response.json();

    if (!response.ok || data["Error Message"] || data.Note) {
      return {
        configured: true,
        success: false,
        error: data.Note ||
          data["Error Message"] ||
          `Alpha Vantage error: ${response.status}`
      };
    }

    return {
      configured: true,
      success: true,
      provider: "Alpha Vantage",
      data
    };

  } catch (error) {
    return {
      configured: true,
      success: false,
      error: error.message
    };
  }
}

// ============================================================
// PRICE DIRECTION
// Frankfurter daily exchange-rate data
// ============================================================

async function getPriceHistory(pair) {
  const [base, quote] = pair.split("/");

  const end = new Date();
  const start = new Date();

  start.setDate(start.getDate() - 21);

  const startDate = start.toISOString().slice(0, 10);
  const endDate = end.toISOString().slice(0, 10);

  const url =
    `https://api.frankfurter.app/${startDate}..${endDate}` +
    `?from=${base}&to=${quote}`;

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Price data request failed: ${response.status}`);
  }

  const data = await response.json();
  const rates = data.rates || {};
  const dates = Object.keys(rates).sort();

  if (dates.length < 2) {
    throw new Error("Not enough price observations.");
  }

  const firstDate = dates[0];
  const lastDate = dates[dates.length - 1];

  const first = safeNumber(rates[firstDate]?.[quote]);
  const last = safeNumber(rates[lastDate]?.[quote]);

  if (first === null || last === null || first <= 0) {
    throw new Error("Invalid price observations.");
  }

  const change = last - first;

  return {
    startDate: firstDate,
    endDate: lastDate,
    start: first,
    end: last,
    change,
    percentageChange: (change / first) * 100,
    direction:
      change > 0 ? "BULLISH" :
      change < 0 ? "BEARISH" :
      "NEUTRAL"
  };
}

// ============================================================
// PRICE / FUNDAMENTAL DIVERGENCE
// ============================================================

async function priceDivergence(pair, env) {
  const [base, quote] = pair.split("/");

  try {
    const [price, fundamentals] = await Promise.all([
      getPriceHistory(pair),
      pairAnalysis(pair, env)
    ]);

    if (!fundamentals.available) {
      return {
        success: true,
        pair,
        available: false,
        divergence: null,
        priceDirection: price.direction,
        fundamentalDirection: "UNAVAILABLE",
        price,
        reason: fundamentals.reason
      };
    }

    const fundamentalDirection =
      fundamentals.direction;

    const divergence =
      fundamentalDirection !== "NEUTRAL" &&
      price.direction !== "NEUTRAL" &&
      fundamentalDirection !== price.direction;

    return {
      success: true,
      pair,
      base,
      quote,
      available: true,
      divergence,
      direction: divergence
        ? fundamentalDirection
        : null,
      priceDirection: price.direction,
      fundamentalDirection,
      fundamentalDifferential: fundamentals.differential,
      price,
      note: divergence
        ? "Price movement is opposing the fundamental direction."
        : "No opposing price movement is currently detected."
    };

  } catch (error) {
    return {
      success: false,
      pair,
      error: error.message
    };
  }
}

// ============================================================
// MANUAL FUNDAMENTAL SCORES
// ============================================================

async function manualFundamentals(url) {
  const pair = normalisePair(
    url.searchParams.get("pair")
  );

  if (!pair) {
    return {
      success: false,
      error: "Invalid pair."
    };
  }

  const [base, quote] = pair.split("/");

  const scores = {};

  for (const currency of SUPPORTED_CURRENCIES) {
    const value = url.searchParams.get(currency.toLowerCase());

    scores[currency] =
      value === null ? 0 : safeNumber(value);
  }

  const differential =
    scores[base] - scores[quote];

  return {
    success: true,
    pair,
    base,
    quote,
    baseScore: scores[base],
    quoteScore: scores[quote],
    differential,
    direction:
      differential > 0 ? "BULLISH" :
      differential < 0 ? "BEARISH" :
      "NEUTRAL"
  };
}

// ============================================================
// ROUTER
// ============================================================

async function handleRequest(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;

  // USD MACRO
  if (path === "/api/usd-macro") {
    return json(await usdMacro(env));
  }

  // EUR MACRO
  if (path === "/api/eur-macro") {
    return json(await eurMacro(env));
  }

  // ALL EIGHT CURRENCIES
  if (path === "/api/all-macro") {
    return json(await allCurrencyMacro(env));
  }

  // INDIVIDUAL CURRENCY
  const currencyMatch = path.match(
    /^\/api\/macro\/([A-Z]{3})$/
  );

  if (currencyMatch) {
    return json(
      await currencyMacro(currencyMatch[1], env)
    );
  }

  // FRED SERIES
  if (path === "/api/fred") {
    const series = url.searchParams.get("series");

    if (!series) {
      return json({
        success: false,
        error: "Missing series parameter."
      }, 400);
    }

    return json(await fredSeries(series, env));
  }

  // LIVE FX RATE
  if (path === "/api/fx/rate") {
    const from = (
      url.searchParams.get("from") || "EUR"
    ).toUpperCase();

    const to = (
      url.searchParams.get("to") || "USD"
    ).toUpperCase();

    return json(await fxRate(from, to, env));
  }

  // PAIR ANALYSIS
  if (path === "/api/pair-analysis") {
    const pair = getPair(request);

    if (!pair) {
      return json({
        success: false,
        error: "Invalid pair. Example: EUR/USD"
      }, 400);
    }

    return json(await pairAnalysis(pair, env));
  }

  // PRICE DIVERGENCE
  if (path === "/api/price-divergence") {
    const pair = getPair(request);

    if (!pair) {
      return json({
        success: false,
        error: "Invalid pair. Example: EUR/USD"
      }, 400);
    }

    return json(await priceDivergence(pair, env));
  }

  // MANUAL FUNDAMENTAL SCORES
  if (path === "/api/fundamentals") {
    return json(await manualFundamentals(url));
  }

  // HEALTH CHECK
  if (path === "/api/health") {
    return json({
      success: true,
      app: "Forex Macro Assistant",
      version: "3.0 Fundamental Analysis",
      currencies: SUPPORTED_CURRENCIES,
      pairs: STANDARD_PAIRS.length,
      analysis: [
        "Fundamental scoring",
        "Currency strength comparison",
        "Price/fundamental divergence"
      ],
      technicalAnalysis: "Not included",
      tradeSignals: "Not generated",
      providers: {
        fred: Boolean(env.FRED_API_KEY),
        alphaVantage: Boolean(env.ALPHAVANTAGE_API_KEY)
      }
    });
  }

  // STATIC PWA ASSETS
  if (env.ASSETS) {
    return env.ASSETS.fetch(request);
  }

  return new Response(
    "Forex Macro Assistant API is running.",
    {
      status: 200,
      headers: {
        "content-type": "text/plain;charset=UTF-8"
      }
    }
  );
}

// ============================================================
// CLOUDFLARE WORKER ENTRY POINT
// ============================================================

export default {
  async fetch(request, env, ctx) {
    try {
      return await handleRequest(request, env);
    } catch (error) {
      return json({
        success: false,
        error: error.message || "Internal server error"
      }, 500);
    }
  }
};
