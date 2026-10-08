import { Hono } from "hono";

const app = new Hono();


/* =========================================================
   CONSTANTS
   ========================================================= */

const SUPPORTED_CURRENCIES = [
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


/* =========================================================
   HELPERS
   ========================================================= */

function json(data, status = 200) {

  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: {
        "content-type": "application/json;charset=UTF-8",
        "cache-control": "no-store"
      }
    }
  );

}


function normalisePair(pair) {

  if (!pair) {
    return null;
  }

  const clean =
    String(pair)
      .trim()
      .toUpperCase()
      .replace("-", "/")
      .replace("_", "/");

  const parts =
    clean.split("/");

  if (
    parts.length !== 2
  ) {
    return null;
  }

  const base =
    parts[0];

  const quote =
    parts[1];

  if (
    !SUPPORTED_CURRENCIES.includes(base) ||
    !SUPPORTED_CURRENCIES.includes(quote) ||
    base === quote
  ) {
    return null;
  }

  return `${base}/${quote}`;

}


function getPairFromRequest(request) {

  const url =
    new URL(request.url);

  return normalisePair(
    url.searchParams.get("pair")
  );

}


function pairSymbol(pair) {

  return pair.replace("/", "/");

}


function safeNumber(value) {

  const n =
    Number(value);

  return Number.isFinite(n)
    ? n
    : 0;

}


/* =========================================================
   FRED
   ========================================================= */

async function fredSeries(
  seriesId,
  env,
  limit = 12
) {

  const key =
    env.FRED_API_KEY;

  if (!key) {

    return {

      success: false,

      error:
        "FRED_API_KEY is not configured."

    };

  }

  const url =
    "https://api.stlouisfed.org/fred/series/observations" +
    `?series_id=${encodeURIComponent(seriesId)}` +
    `&api_key=${encodeURIComponent(key)}` +
    "&file_type=json" +
    `&sort_order=desc` +
    `&limit=${limit}`;

  const response =
    await fetch(url);

  if (!response.ok) {

    return {

      success: false,

      error:
        `FRED request failed: ${response.status}`

    };

  }

  const data =
    await response.json();

  const observations =
    Array.isArray(data.observations)
      ? data.observations
      : [];

  return {

    success: true,

    seriesId,

    observations

  };

}


/* =========================================================
   MACRO SCORING
   ========================================================= */

function changeScore(
  observations,
  direction = "positive"
) {

  if (
    !Array.isArray(observations) ||
    observations.length < 2
  ) {
    return 0;
  }

  const latest =
    Number(observations[0]?.value);

  const previous =
    Number(observations[1]?.value);

  if (
    !Number.isFinite(latest) ||
    !Number.isFinite(previous)
  ) {
    return 0;
  }

  const change =
    latest - previous;

  if (
    Math.abs(change) < 0.000001
  ) {
    return 0;
  }

  if (
    direction === "positive"
  ) {

    return change > 0
      ? 1
      : -1;

  }

  return change < 0
    ? 1
    : -1;

}


function macroTotal(scores) {

  return Object.values(scores)
    .reduce(
      (a, b) =>
        a + safeNumber(b),
      0
    );

}


/* =========================================================
   USD MACRO
   ========================================================= */

app.get(
  "/api/usd-macro",
  async c => {

    try {

      const env =
        c.env;

      const [
        interest,
        inflation,
        growth,
        employment,
        liquidity
      ] =
        await Promise.all([

          fredSeries(
            "DFF",
            env
          ),

          fredSeries(
            "CPIAUCSL",
            env
          ),

          fredSeries(
            "GDPC1",
            env
          ),

          fredSeries(
            "UNRATE",
            env
          ),

          fredSeries(
            "WALCL",
            env
          )

        ]);


      if (
        !interest.success ||
        !inflation.success ||
        !growth.success ||
        !employment.success ||
        !liquidity.success
      ) {

        return c.json({

          success: false,

          error:
            "One or more USD macro data series are unavailable."

        });

      }


      const scores = {

        interest:
          changeScore(
            interest.observations,
            "positive"
          ),

        inflation:
          0,

        growth:
          changeScore(
            growth.observations,
            "positive"
          ),

        employment:
          changeScore(
            employment.observations,
            "negative"
          ),

        liquidity:
          changeScore(
            liquidity.observations,
            "positive"
          )

      };


      return c.json({

        success: true,

        currency: "USD",

        scores: {

          ...scores,

          total:
            macroTotal(scores)

        },

        data: {

          interest:
            interest.observations[0],

          inflation:
            inflation.observations[0],

          growth:
            growth.observations[0],

          employment:
            employment.observations[0],

          liquidity:
            liquidity.observations[0]

        }

      });

    } catch (error) {

      return c.json({

        success: false,

        error:
          error.message

      });

    }

  }
);


/* =========================================================
   EUR MACRO
   ========================================================= */

app.get(
  "/api/eur-macro",
  async c => {

    try {

      const env =
        c.env;

      const [
        interest,
        inflation,
        growth
      ] =
        await Promise.all([

          fredSeries(
            "ECBDFR",
            env
          ),

          fredSeries(
            "CP0000EZ19M086NEST",
            env
          ),

          fredSeries(
            "CLVMNACSCAB1GQEA19",
            env
          )

        ]);


      if (
        !interest.success ||
        !inflation.success ||
        !growth.success
      ) {

        return c.json({

          success: false,

          error:
            "One or more EUR macro data series are unavailable."

        });

      }


      const scores = {

        interest:
          changeScore(
            interest.observations,
            "positive"
          ),

        inflation:
          0,

        growth:
          changeScore(
            growth.observations,
            "positive"
          )

      };


      return c.json({

        success: true,

        currency: "EUR",

        scores: {

          ...scores,

          total:
            macroTotal(scores)

        },

        data: {

          interest:
            interest.observations[0],

          inflation:
            inflation.observations[0],

          growth:
            growth.observations[0]

        }

      });

    } catch (error) {

      return c.json({

        success: false,

        error:
          error.message

      });

    }

  }
);


/* =========================================================
   GENERIC FRED ENDPOINT
   ========================================================= */

app.get(
  "/api/fred",
  async c => {

    try {

      const url =
        new URL(
          c.req.url
        );

      const seriesId =
        url.searchParams.get(
          "series"
        );

      if (!seriesId) {

        return c.json({

          success: false,

          error:
            "Missing series parameter."

        }, 400);

      }

      const result =
        await fredSeries(
          seriesId,
          c.env
        );

      return c.json(
        result
      );

    } catch (error) {

      return c.json({

        success: false,

        error:
          error.message

      }, 500);

    }

  }
);


/* =========================================================
   FX RATE
   ========================================================= */

app.get(
  "/api/fx/rate",
  async c => {

    try {

      const from =
        (
          c.req.query("from") ||
          "EUR"
        )
          .toUpperCase();

      const to =
        (
          c.req.query("to") ||
          "USD"
        )
          .toUpperCase();


      if (
        !SUPPORTED_CURRENCIES.includes(from) ||
        !SUPPORTED_CURRENCIES.includes(to) ||
        from === to
      ) {

        return c.json({

          configured: false,

          error:
            "Invalid currency pair."

        }, 400);

      }


      const key =
        c.env.ALPHAVANTAGE_API_KEY;


      if (!key) {

        return c.json({

          configured: false,

          provider:
            "Alpha Vantage",

          message:
            "Add ALPHAVANTAGE_API_KEY to enable live FX data."

        });

      }


      const url =
        "https://www.alphavantage.co/query" +
        `?function=CURRENCY_EXCHANGE_RATE` +
        `&from_currency=${from}` +
        `&to_currency=${to}` +
        `&apikey=${encodeURIComponent(key)}`;


      const response =
        await fetch(url);

      if (!response.ok) {

        return c.json({

          configured: true,

          success: false,

          error:
            `Alpha Vantage request failed: ${response.status}`

        });

      }


      const data =
        await response.json();


      return c.json({

        configured: true,

        success: true,

        data

      });

    } catch (error) {

      return c.json({

        configured: true,

        success: false,

        error:
          error.message

      }, 500);

    }

  }
);


/* =========================================================
   PAIR ANALYSIS
   ========================================================= */

app.get(
  "/api/pair-analysis",
  async c => {

    const pair =
      getPairFromRequest(
        c.req.raw
      );

    if (!pair) {

      return c.json({

        success: false,

        error:
          "Invalid pair. Example: EUR/USD"

      }, 400);

    }


    const [
      usd,
      eur
    ] =
      await Promise.all([

        fetch(
          new URL(
            "/api/usd-macro",
            c.req.url
          )
        )
          .then(r => r.json())
          .catch(() => ({
            success: false
          })),

        fetch(
          new URL(
            "/api/eur-macro",
            c.req.url
          )
        )
          .then(r => r.json())
          .catch(() => ({
            success: false
          }))

      ]);


    const [base, quote] =
      pair.split("/");


    const scores = {

      USD:
        usd.success
          ? safeNumber(
              usd.scores?.total
            )
          : 0,

      EUR:
        eur.success
          ? safeNumber(
              eur.scores?.total
            )
          : 0

    };


    const baseScore =
      scores[base] ?? 0;

    const quoteScore =
      scores[quote] ?? 0;


    return c.json({

      success: true,

      pair,

      base,

      quote,

      baseScore,

      quoteScore,

      differential:
        baseScore - quoteScore,

      note:
        "Live macro scoring is currently validated for USD and EUR. Other currencies require additional macro mappings."

    });

  }
);


/* =========================================================
   PRICE DIVERGENCE
   ========================================================= */

app.get(
  "/api/price-divergence",
  async c => {

    try {

      const pair =
        getPairFromRequest(
          c.req.raw
        );

      if (!pair) {

        return c.json({

          success: false,

          error:
            "Invalid pair. Example: EUR/USD"

        }, 400);

      }


      const [
        base,
        quote
      ] =
        pair.split("/");


      const end =
        new Date();


      const start =
        new Date();

      start.setDate(
        start.getDate() - 21
      );


      const startDate =
        start
          .toISOString()
          .slice(0, 10);


      const endDate =
        end
          .toISOString()
          .slice(0, 10);


      const priceUrl =
        `https://api.frankfurter.app/${startDate}..${endDate}` +
        `?from=${base}&to=${quote}`;


      const priceResponse =
        await fetch(
          priceUrl
        );


      if (!priceResponse.ok) {

        return c.json({

          success: false,

          error:
            `Price data request failed: ${priceResponse.status}`

        });

      }


      const priceData =
        await priceResponse.json();


      const rates =
        priceData.rates || {};


      const dates =
        Object.keys(rates)
          .sort();


      if (
        dates.length < 2
      ) {

        return c.json({

          success: false,

          error:
            "Not enough price observations for divergence analysis."

        });

      }


      const firstDate =
        dates[0];

      const lastDate =
        dates[dates.length - 1];


      const firstPrice =
        safeNumber(
          rates[firstDate]?.[quote]
        );

      const lastPrice =
        safeNumber(
          rates[lastDate]?.[quote]
        );


      if (
        !firstPrice ||
        !lastPrice
      ) {

        return c.json({

          success: false,

          error:
            "Price observations are invalid."

        });

      }


      const priceChange =
        lastPrice -
        firstPrice;


      const priceDirection =
        priceChange > 0
          ? "BULLISH"
          : priceChange < 0
            ? "BEARISH"
            : "NEUTRAL";


      /*
       * Fundamental direction:
       *
       * USD/EUR use the validated live
       * macro engines.
       *
       * Other currencies currently use
       * a neutral fundamental reference.
       *
       * This prevents the system from
       * pretending unavailable macro data
       * is real.
       */

      let baseFundamental =
        0;

      let quoteFundamental =
        0;


      if (
        base === "USD" ||
        quote === "USD"
      ) {

        try {

          const response =
            await fetch(
              new URL(
                "/api/usd-macro",
                c.req.url
              )
            );

          const data =
            await response.json();

          if (data.success) {

            const score =
              safeNumber(
                data.scores?.total
              );

            if (base === "USD") {
              baseFundamental = score;
            }

            if (quote === "USD") {
              quoteFundamental = score;
            }

          }

        } catch {}

      }


      if (
        base === "EUR" ||
        quote === "EUR"
      ) {

        try {

          const response =
            await fetch(
              new URL(
                "/api/eur-macro",
                c.req.url
              )
            );

          const data =
            await response.json();

          if (data.success) {

            const score =
              safeNumber(
                data.scores?.total
              );

            if (base === "EUR") {
              baseFundamental = score;
            }

            if (quote === "EUR") {
              quoteFundamental = score;
            }

          }

        } catch {}

      }


      const fundamentalDifferential =
        baseFundamental -
        quoteFundamental;


      const fundamentalDirection =
        fundamentalDifferential > 0
          ? "BULLISH"
          : fundamentalDifferential < 0
            ? "BEARISH"
            : "NEUTRAL";


      const divergence =
        (
          fundamentalDirection !==
          "NEUTRAL"
        ) &&
        (
          priceDirection !==
          "NEUTRAL"
        ) &&
        (
          fundamentalDirection !==
          priceDirection
        );


      let direction =
        fundamentalDirection;


      if (
        fundamentalDirection ===
        "NEUTRAL"
      ) {

        direction = null;

      }


      return c.json({

        success: true,

        pair,

        base,

        quote,

        divergence,

        direction,

        priceDirection,

        fundamentalDirection,

        fundamentalDifferential,

        price: {

          startDate:
            firstDate,

          endDate:
            lastDate,

          start:
            firstPrice,

          end:
            lastPrice,

          change:
            priceChange

        },

        note:
          "Divergence is only considered validated when both price direction and fundamental direction are available and opposite."

      });

    } catch (error) {

      return c.json({

        success: false,

        error:
          error.message

      }, 500);

    }

  }
);


/* =========================================================
   MANUAL FUNDAMENTALS
   ========================================================= */

app.get(
  "/api/fundamentals",
  async c => {

    const url =
      new URL(
        c.req.url
      );


    const pair =
      normalisePair(
        url.searchParams.get(
          "pair"
        )
      );


    if (!pair) {

      return c.json({

        success: false,

        error:
          "Invalid pair."

      }, 400);

    }


    const [base, quote] =
      pair.split("/");


    const get =
      name =>
        safeNumber(
          url.searchParams.get(name)
        );


    const scores = {

      USD: get("usd"),

      EUR: get("eur"),

      GBP: get("gbp"),

      JPY: get("jpy"),

      CHF: get("chf"),

      CAD: get("cad"),

      AUD: get("aud"),

      NZD: get("nzd")

    };


    const differential =
      scores[base] -
      scores[quote];


    return c.json({

      success: true,

      pair,

      base,

      quote,

      baseScore:
        scores[base],

      quoteScore:
        scores[quote],

      differential,

      direction:
        differential > 0
          ? "BULLISH"
          : differential < 0
            ? "BEARISH"
            : "NEUTRAL"

    });

  }
);


/* =========================================================
   GENERIC DECISION ENGINE
   ========================================================= */

app.get(
  "/api/analyse",
  async c => {

    const url =
      new URL(
        c.req.url
      );


    const pair =
      normalisePair(
        url.searchParams.get(
          "pair"
        )
      );


    if (!pair) {

      return c.json({

        success: false,

        error:
          "Invalid pair."

      }, 400);

    }


    const differential =
      safeNumber(
        url.searchParams.get(
          "differential"
        )
      );


    const technical =
      safeNumber(
        url.searchParams.get(
          "technical"
        )
      );


    const divergence =
      (
        url.searchParams.get(
          "divergence"
        ) === "true"
      );


    let action =
      "PASS";


    if (
      Math.abs(differential) >= 6 &&
      divergence &&
      technical >= 2
    ) {

      action =
        `BUY ${pair}`;

    } else if (
      Math.abs(differential) >= 6 &&
      divergence &&
      technical <= -2
    ) {

      action =
        `SELL ${pair}`;

    } else if (
      Math.abs(differential) >= 6 &&
      divergence
    ) {

      action =
        "WAIT";

    } else if (
      Math.abs(differential) >= 3
    ) {

      action =
        "WATCH";

    }


    return c.json({

      success: true,

      pair,

      differential,

      divergence,

      technical,

      action

    });

  }
);


/* =========================================================
   TWELVE DATA
   ========================================================= */

async function twelveDataCandles(
  pair,
  interval,
  outputsize,
  env
) {

  const key =
    env.TWELVE_DATA_API_KEY;


  if (!key) {

    return {

      success: false,

      error:
        "TWELVE_DATA_API_KEY is not configured."

    };

  }


  const url =
    "https://api.twelvedata.com/time_series" +
    `?symbol=${encodeURIComponent(pair)}` +
    `&interval=${encodeURIComponent(interval)}` +
    `&outputsize=${outputsize}` +
    `&apikey=${encodeURIComponent(key)}`;


  const response =
    await fetch(url);


  if (!response.ok) {

    return {

      success: false,

      error:
        `Twelve Data request failed: ${response.status}`

    };

  }


  const data =
    await response.json();


  if (
    data.status === "error"
  ) {

    return {

      success: false,

      error:
        data.message ||
        "Twelve Data returned an error."

    };

  }


  const values =
    Array.isArray(data.values)
      ? data.values
      : [];


  return {

    success: true,

    meta:
      data.meta || {},

    values

  };

}


/* =========================================================
   CANDLE NORMALISATION
   ========================================================= */

function normaliseCandles(
  values
) {

  return values
    .map(x => ({

      datetime:
        x.datetime,

      open:
        safeNumber(x.open),

      high:
        safeNumber(x.high),

      low:
        safeNumber(x.low),

      close:
        safeNumber(x.close),

      volume:
        safeNumber(x.volume)

    }))
    .filter(x =>
      x.high > 0 &&
      x.low > 0 &&
      x.close > 0
    )
    .sort(
      (a, b) =>
        new Date(a.datetime) -
        new Date(b.datetime)
    );

}


/* =========================================================
   SWING DETECTION
   ========================================================= */

function findSwingHighs(
  candles,
  left = 2,
  right = 2
) {

  const result = [];


  for (
    let i = left;
    i < candles.length - right;
    i++
  ) {

    const current =
      candles[i].high;


    let valid =
      true;


    for (
      let j = 1;
      j <= left;
      j++
    ) {

      if (
        current <=
        candles[i - j].high
      ) {

        valid = false;
        break;

      }

    }


    if (!valid) {
      continue;
    }


    for (
      let j = 1;
      j <= right;
      j++
    ) {

      if (
        current <
        candles[i + j].high
      ) {

        valid = false;
        break;

      }

    }


    if (valid) {

      result.push({

        index: i,

        price: current,

        datetime:
          candles[i].datetime

      });

    }

  }


  return result;

}


function findSwingLows(
  candles,
  left = 2,
  right = 2
) {

  const result = [];


  for (
    let i = left;
    i < candles.length - right;
    i++
  ) {

    const current =
      candles[i].low;


    let valid =
      true;


    for (
      let j = 1;
      j <= left;
      j++
    ) {

      if (
        current >=
        candles[i - j].low
      ) {

        valid = false;
        break;

      }

    }


    if (!valid) {
      continue;
    }


    for (
      let j = 1;
      j <= right;
      j++
    ) {

      if (
        current >
        candles[i + j].low
      ) {

        valid = false;
        break;

      }

    }


    if (valid) {

      result.push({

        index: i,

        price: current,

        datetime:
          candles[i].datetime

      });

    }

  }


  return result;

}


/* =========================================================
   MARKET STRUCTURE
   ========================================================= */

function marketStructure(
  candles
) {

  const highs =
    findSwingHighs(
      candles
    );

  const lows =
    findSwingLows(
      candles
    );


  let direction =
    "NEUTRAL";


  let context =
    "NEUTRAL";


  if (
    highs.length >= 2 &&
    lows.length >= 2
  ) {

    const h1 =
      highs[highs.length - 2];

    const h2 =
      highs[highs.length - 1];

    const l1 =
      lows[lows.length - 2];

    const l2 =
      lows[lows.length - 1];


    const higherHigh =
      h2.price > h1.price;

    const higherLow =
      l2.price > l1.price;

    const lowerHigh =
      h2.price < h1.price;

    const lowerLow =
      l2.price < l1.price;


    if (
      higherHigh &&
      higherLow
    ) {

      direction =
        "BULLISH";

      context =
        "BULLISH";

    } else if (
      lowerHigh &&
      lowerLow
    ) {

      direction =
        "BEARISH";

      context =
        "BEARISH";

    }

  }


  return {

    direction,

    context,

    swing_highs:
      highs,

    swing_lows:
      lows

  };

}


/* =========================================================
   BREAK OF STRUCTURE
   ========================================================= */

function detectBOS(
  candles,
  structure
) {

  if (
    !candles.length
  ) {

    return {

      confirmed: false,

      direction:
        "NEUTRAL"

    };

  }


  const last =
    candles[candles.length - 1];


  const highs =
    structure.swing_highs || [];

  const lows =
    structure.swing_lows || [];


  const lastHigh =
    highs.length
      ? highs[highs.length - 1]
      : null;


  const lastLow =
    lows.length
      ? lows[lows.length - 1]
      : null;


  if (
    lastHigh &&
    last.close >
      lastHigh.price
  ) {

    return {

      confirmed: true,

      direction:
        "BULLISH",

      level:
        lastHigh.price,

      datetime:
        last.datetime

    };

  }


  if (
    lastLow &&
    last.close <
      lastLow.price
  ) {

    return {

      confirmed: true,

      direction:
        "BEARISH",

      level:
        lastLow.price,

      datetime:
        last.datetime

    };

  }


  return {

    confirmed: false,

    direction:
      "NEUTRAL"

  };

}


/* =========================================================
   AVERAGE RANGE
   ========================================================= */

function averageRange(
  candles,
  count = 20
) {

  const sample =
    candles.slice(
      Math.max(
        0,
        candles.length - count
      )
    );


  if (!sample.length) {
    return 0;
  }


  return sample.reduce(
    (sum, candle) =>
      sum +
      (
        candle.high -
        candle.low
      ),
    0
  ) /
  sample.length;

}


/* =========================================================
   H4 LOCATION
   ========================================================= */

function detectH4Location(
  candles,
  structure
) {

  const avgRange =
    averageRange(
      candles,
      20
    );


  const last =
    candles[candles.length - 1];


  if (
    !last ||
    !avgRange
  ) {

    return {

      found: false,

      type:
        "NONE",

      reason:
        "Insufficient H4 data."

    };

  }


  const recent =
    candles.slice(
      Math.max(
        0,
        candles.length - 12
      )
    );


  const demand =
    recent.some(
      candle =>
        (
          candle.close >
          candle.open
        ) &&
        (
          candle.high -
          candle.low
        ) >=
        avgRange * 1.5
    );


  const supply =
    recent.some(
      candle =>
        (
          candle.close <
          candle.open
        ) &&
        (
          candle.high -
          candle.low
        ) >=
        avgRange * 1.5
    );


  if (
    structure.direction ===
    "BULLISH" &&
    demand
  ) {

    return {

      found: true,

      type:
        "DEMAND",

      reason:
        "Bullish H4 context with recent expansion from a demand area."

    };

  }


  if (
    structure.direction ===
    "BEARISH" &&
    supply
  ) {

    return {

      found: true,

      type:
        "SUPPLY",

      reason:
        "Bearish H4 context with recent expansion from a supply area."

    };

  }


  return {

    found: false,

    type:
      "NONE",

    reason:
      "No sufficiently strong H4 location was identified."

  };

}


/* =========================================================
   H1 RETRACEMENT
   ========================================================= */

function detectRetracement(
  candles,
  direction
) {

  if (
    candles.length < 15
  ) {

    return {

      found: false,

      type:
        "NONE",

      reason:
        "Insufficient H1 data."

    };

  }


  const recent =
    candles.slice(
      Math.max(
        0,
        candles.length - 20
      )
    );


  const first =
    recent[0];

  const last =
    recent[recent.length - 1];


  const impulse =
    last.close -
    first.open;


  const range =
    Math.abs(
      impulse
    );


  const avg =
    averageRange(
      recent,
      10
    );


  if (
    range <
    avg * 2
  ) {

    return {

      found: false,

      type:
        "NONE",

      reason:
        "No meaningful H1 directional impulse."

    };

  }


  if (
    direction ===
    "BULLISH"
  ) {

    const highest =
      Math.max(
        ...recent.map(
          x => x.high
        )
      );


    const lowest =
      Math.min(
        ...recent.map(
          x => x.low
        )
      );


    const pullback =
      highest -
      last.close;


    const impulseSize =
      highest -
      lowest;


    const ratio =
      impulseSize > 0
        ? pullback /
          impulseSize
        : 0;


    if (
      ratio >= 0.15 &&
      ratio <= 0.65
    ) {

      return {

        found: true,

        type:
          "BULLISH_RETRACEMENT",

        ratio,

        reason:
          "Controlled H1 pullback within the bullish structure."

      };

    }

  }


  if (
    direction ===
    "BEARISH"
  ) {

    const highest =
      Math.max(
        ...recent.map(
          x => x.high
        )
      );


    const lowest =
      Math.min(
        ...recent.map(
          x => x.low
        )
      );


    const pullback =
      last.close -
      lowest;


    const impulseSize =
      highest -
      lowest;


    const ratio =
      impulseSize > 0
        ? pullback /
          impulseSize
        : 0;


    if (
      ratio >= 0.15 &&
      ratio <= 0.65
    ) {

      return {

        found: true,

        type:
          "BEARISH_RETRACEMENT",

        ratio,

        reason:
          "Controlled H1 pullback within the bearish structure."

      };

    }

  }


  return {

    found: false,

    type:
      "NONE",

    reason:
      "No valid H1 retracement detected."

  };

}


/* =========================================================
   TECHNICAL CONFIRMATION
   ========================================================= */

async function technicalConfirmation(
  pair,
  env
) {

  const h4Data =
    await twelveDataCandles(
      pair,
      "4h",
      160,
      env
    );


  const h1Data =
    await twelveDataCandles(
      pair,
      "1h",
      220,
      env
    );


  if (
    !h4Data.success ||
    !h1Data.success
  ) {

    return {

      success: false,

      error:
        h4Data.error ||
        h1Data.error ||
        "Technical data unavailable."

    };

  }


  const h4 =
    normaliseCandles(
      h4Data.values
    );


  const h1 =
    normaliseCandles(
      h1Data.values
    );


  if (
    h4.length < 30 ||
    h1.length < 40
  ) {

    return {

      success: false,

      error:
        "Insufficient candle data."

    };

  }


  const h4Structure =
    marketStructure(
      h4
    );


  const h1Structure =
    marketStructure(
      h1
    );


  const h4BOS =
    detectBOS(
      h4,
      h4Structure
    );


  const h1BOS =
    detectBOS(
      h1,
      h1Structure
    );


  const location =
    detectH4Location(
      h4,
      h4Structure
    );


  const retracement =
    detectRetracement(
      h1,
      h4Structure.direction
    );


  const h4Direction =
    h4Structure.direction;


  const h1Direction =
    h1Structure.direction;


  const aligned =
    h4Direction !== "NEUTRAL" &&
    h4Direction === h1Direction;


  const bosAligned =
    h1BOS.confirmed &&
    h1BOS.direction ===
      h4Direction;


  const h4StructureGate =
    h4Direction !==
    "NEUTRAL";


  const h4LocationGate =
    location.found;


  const recentH4BosGate =
    h4BOS.confirmed &&
    h4BOS.direction ===
      h4Direction;


  const h1RetracementGate =
    retracement.found;


  const h1StructureGate =
    h1Direction !==
    "NEUTRAL";


  const h1BosGate =
    bosAligned;


  const confirmed =
    h4StructureGate &&
    h4LocationGate &&
    (
      recentH4BosGate ||
      h4BOS.confirmed
    ) &&
    h1RetracementGate &&
    h1StructureGate &&
    aligned &&
    h1BosGate;


  let technicalStatus =
    confirmed
      ? "CONFIRMED"
      : "NOT_CONFIRMED";


  let direction =
    confirmed
      ? h4Direction
      : h4Direction;


  const reasons = [];


  reasons.push(
    `H4 context: ${h4Direction}`
  );


  reasons.push(
    `H4 location: ${
      location.found
        ? location.type
        : "NONE"
    }`
  );


  reasons.push(
    `H4 BOS: ${
      h4BOS.confirmed
        ? h4BOS.direction
        : "NOT CONFIRMED"
    }`
  );


  reasons.push(
    `H1 retracement: ${
      retracement.found
        ? retracement.type
        : "NOT CONFIRMED"
    }`
  );


  reasons.push(
    `H1 structure: ${h1Direction}`
  );


  reasons.push(
    `H1/H4 alignment: ${
      aligned
        ? "ALIGNED"
        : "NOT ALIGNED"
    }`
  );


  reasons.push(
    `H1 BOS: ${
      h1BOS.confirmed
        ? h1BOS.direction
        : "NOT CONFIRMED"
    }`
  );


  return {

    success: true,

    pair,

    symbol: pair,

    technical_status:
      technicalStatus,

    direction,

    technical_value:
      confirmed
        ? direction === "BULLISH"
          ? 3
          : direction === "BEARISH"
            ? -3
            : 0
        : 0,

    gates: {

      h4_structure:
        h4StructureGate,

      h4_location:
        h4LocationGate,

      recent_h4_bos:
        recentH4BosGate,

      h1_retracement:
        h1RetracementGate,

      h1_structure:
        h1StructureGate,

      h1_bos:
        h1BosGate,

      continuation_diagnostics: {

        reason:
          location.reason

      }

    },

    h4: {

      market_structure:
        h4Structure,

      break_of_structure:
        h4BOS,

      location

    },

    h1: {

      market_structure:
        h1Structure,

      break_of_structure:
        h1BOS,

      retracement

    },

    latest: {

      h4:
        h4[h4.length - 1],

      h1:
        h1[h1.length - 1]

    },

    reasons

  };

}


/* =========================================================
   TECHNICAL CONFIRMATION API
   ========================================================= */

app.get(
  "/api/technical-confirmation",
  async c => {

    try {

      const pair =
        getPairFromRequest(
          c.req.raw
        );


      if (!pair) {

        return c.json({

          success: false,

          error:
            "Invalid or missing pair. Example: EUR/USD"

        }, 400);

      }


      const result =
        await technicalConfirmation(
          pair,
          c.env
        );


      return c.json(
        result
      );

    } catch (error) {

      return c.json({

        success: false,

        error:
          error.message

      }, 500);

    }

  }
);


/* =========================================================
   TECHNICAL ANALYSIS
   ========================================================= */

app.get(
  "/api/technical-analysis",
  async c => {

    try {

      const pair =
        getPairFromRequest(
          c.req.raw
        );


      if (!pair) {

        return c.json({

          success: false,

          error:
            "Invalid or missing pair."

        }, 400);

      }


      const result =
        await technicalConfirmation(
          pair,
          c.env
        );


      return c.json(
        result
      );

    } catch (error) {

      return c.json({

        success: false,

        error:
          error.message

      }, 500);

    }

  }
);


/* =========================================================
   TECHNICAL DATA TEST
   ========================================================= */

app.get(
  "/api/technical-data-test",
  async c => {

    try {

      const pair =
        getPairFromRequest(
          c.req.raw
        ) ||
        "EUR/USD";


      const interval =
        c.req.query("interval") ||
        "1h";


      if (
        !["1h", "4h"].includes(
          interval
        )
      ) {

        return c.json({

          success: false,

          error:
            "Interval must be 1h or 4h."

        }, 400);

      }


      const result =
        await twelveDataCandles(
          pair,
          interval,
          20,
          c.env
        );


      return c.json({

        success:
          result.success,

        pair,

        interval,

        data:
          result.values || [],

        error:
          result.error || null

      });

    } catch (error) {

      return c.json({

        success: false,

        error:
          error.message

      }, 500);

    }

  }
);


/* =========================================================
   HEALTH CHECK
   ========================================================= */

app.get(
  "/api/health",
  c => {

    return c.json({

      success: true,

      app:
        "Forex Macro Assistant",

      version:
        "Multi-Pair Pipeline",

      pairs:
        STANDARD_PAIRS.length,

      technical:
        "Dynamic pair",

      divergence:
        "Dynamic pair",

      macro:
        "USD/EUR live + dashboard scores for other currencies"

    });

  }
);


/* =========================================================
   DEFAULT ASSETS
   ========================================================= */

app.all(
  "*",
  async c => {

    return c.env.ASSETS.fetch(
      c.req.raw
    );

  }
);


export default app;
