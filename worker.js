export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // ==========================================
    // LIVE FX RATE — ALPHA VANTAGE
    // ==========================================
    if (url.pathname === "/api/fx/rate") {
      const from = (url.searchParams.get("from") || "EUR").toUpperCase();
      const to = (url.searchParams.get("to") || "USD").toUpperCase();

      if (!env.ALPHAVANTAGE_API_KEY) {
        return Response.json({
          configured: false,
          provider: "Alpha Vantage",
          message: "Alpha Vantage API key is not configured."
        });
      }

      const apiUrl =
        `https://www.alphavantage.co/query?function=CURRENCY_EXCHANGE_RATE` +
        `&from_currency=${encodeURIComponent(from)}` +
        `&to_currency=${encodeURIComponent(to)}` +
        `&apikey=${encodeURIComponent(env.ALPHAVANTAGE_API_KEY)}`;

      try {
        const response = await fetch(apiUrl);
        const data = await response.json();

        return Response.json({
          configured: true,
          provider: "Alpha Vantage",
          pair: `${from}/${to}`,
          data
        });
      } catch (error) {
        return Response.json({
          configured: false,
          provider: "Alpha Vantage",
          error: error.message
        });
      }
    }

    // ==========================================
    // FRED ECONOMIC DATA
    // ==========================================
    if (url.pathname === "/api/fred") {
      const series = url.searchParams.get("series");

      if (!series) {
        return Response.json({
          success: false,
          provider: "FRED",
          error: "Missing FRED series ID."
        });
      }

      if (!env.FRED_API_KEY) {
        return Response.json({
          success: false,
          provider: "FRED",
          error: "FRED API key is not configured."
        });
      }

      const limit = Number(
        url.searchParams.get("limit") || 10
      );

      const apiUrl =
        `https://api.stlouisfed.org/fred/series/observations` +
        `?series_id=${encodeURIComponent(series)}` +
        `&api_key=${encodeURIComponent(env.FRED_API_KEY)}` +
        `&file_type=json` +
        `&sort_order=desc` +
        `&limit=${limit}`;

      try {
        const response = await fetch(apiUrl);
        const data = await response.json();

        return Response.json({
          success: true,
          provider: "FRED",
          series,
          data
        });
      } catch (error) {
        return Response.json({
          success: false,
          provider: "FRED",
          series,
          error: error.message
        });
      }
    }

    // ==========================================
    // USD MACRO FUNDAMENTAL ENGINE
    // ==========================================
    if (url.pathname === "/api/usd-macro") {

      if (!env.FRED_API_KEY) {
        return Response.json({
          success: false,
          error: "FRED API key is not configured."
        });
      }

      const seriesMap = {
        interest: "DFF",
        inflation: "CPIAUCSL",
        growth: "GDPC1",
        employment: "UNRATE",
        liquidity: "WALCL"
      };

      async function getFredSeries(series) {
        const apiUrl =
          `https://api.stlouisfed.org/fred/series/observations` +
          `?series_id=${series}` +
          `&api_key=${encodeURIComponent(env.FRED_API_KEY)}` +
          `&file_type=json` +
          `&sort_order=desc` +
          `&limit=5`;

        const response = await fetch(apiUrl);
        const data = await response.json();

        if (!data.observations) {
          throw new Error(`No observations returned for ${series}`);
        }

        return data.observations
          .filter(x => x.value !== ".")
          .map(x => ({
            date: x.date,
            value: Number(x.value)
          }));
      }

      function change(data) {
        if (!data || data.length < 2) return null;
        return data[0].value - data[1].value;
      }

      try {
        const raw = {};

        for (const [factor, series] of Object.entries(seriesMap)) {
          raw[factor] = await getFredSeries(series);
        }

        const changes = {
          interest: change(raw.interest),
          inflation: change(raw.inflation),
          growth: change(raw.growth),
          employment: change(raw.employment),
          liquidity: change(raw.liquidity)
        };

        let interestScore = 0;
        let growthScore = 0;
        let employmentScore = 0;
        let inflationScore = 0;
        let liquidityScore = 0;

        if (changes.interest >= 0.25) {
          interestScore = 2;
        } else if (changes.interest > 0) {
          interestScore = 1;
        } else if (changes.interest <= -0.25) {
          interestScore = -2;
        } else if (changes.interest < 0) {
          interestScore = -1;
        }

        if (changes.growth >= 100) {
          growthScore = 2;
        } else if (changes.growth > 0) {
          growthScore = 1;
        } else if (changes.growth <= -100) {
          growthScore = -2;
        } else if (changes.growth < 0) {
          growthScore = -1;
        }

        if (changes.employment <= -0.2) {
          employmentScore = 2;
        } else if (changes.employment < 0) {
          employmentScore = 1;
        } else if (changes.employment >= 0.2) {
          employmentScore = -2;
        } else if (changes.employment > 0) {
          employmentScore = -1;
        }

        inflationScore = 0;

        if (changes.liquidity <= -10000) {
          liquidityScore = 1;
        } else if (changes.liquidity >= 10000) {
          liquidityScore = -1;
        }

        const totalScore =
          interestScore +
          growthScore +
          employmentScore +
          inflationScore +
          liquidityScore;

        let regime = "NEUTRAL";

        if (totalScore >= 5) {
          regime = "STRONG";
        } else if (totalScore >= 2) {
          regime = "POSITIVE";
        } else if (totalScore <= -5) {
          regime = "WEAK";
        } else if (totalScore <= -2) {
          regime = "NEGATIVE";
        }

        return Response.json({
          success: true,
          currency: "USD",
          provider: "FRED",
          series: seriesMap,

          latest: {
            interest: raw.interest[0],
            inflation: raw.inflation[0],
            growth: raw.growth[0],
            employment: raw.employment[0],
            liquidity: raw.liquidity[0]
          },

          changes,

          scores: {
            interest: interestScore,
            growth: growthScore,
            employment: employmentScore,
            inflation: inflationScore,
            liquidity: liquidityScore,
            total: totalScore
          },

          regime,

          methodology: {
            interest:
              "Higher effective federal funds rate changes are treated as tighter monetary policy.",

            inflation:
              "Inflation is currently neutral because CPI direction alone is insufficient to determine USD strength.",

            growth:
              "Positive real GDP changes contribute positively; large changes receive stronger weighting.",

            employment:
              "Falling unemployment is treated as stronger labour-market momentum.",

            liquidity:
              "Changes in Federal Reserve total assets are treated as a secondary liquidity input."
          }
        });

      } catch (error) {
        return Response.json({
          success: false,
          currency: "USD",
          provider: "FRED",
          error: error.message
        });
      }
    }

    // ==========================================
    // EUR MACRO FUNDAMENTAL ENGINE
    // ==========================================
    if (url.pathname === "/api/eur-macro") {

      if (!env.FRED_API_KEY) {
        return Response.json({
          success: false,
          error: "FRED API key is not configured."
        });
      }

      const seriesMap = {
        interest: "ECBDFR",
        inflation: "CP0000EZ19M086NEST",
        growth: "CLVMNACSCAB1GQEA19"
      };

      async function getFredSeries(series) {
        const apiUrl =
          `https://api.stlouisfed.org/fred/series/observations` +
          `?series_id=${series}` +
          `&api_key=${encodeURIComponent(env.FRED_API_KEY)}` +
          `&file_type=json` +
          `&sort_order=desc` +
          `&limit=5`;

        const response = await fetch(apiUrl);
        const data = await response.json();

        if (!data.observations) {
          throw new Error(`No observations returned for ${series}`);
        }

        return data.observations
          .filter(x => x.value !== ".")
          .map(x => ({
            date: x.date,
            value: Number(x.value)
          }));
      }

      function change(data) {
        if (!data || data.length < 2) return null;
        return data[0].value - data[1].value;
      }

      try {

        const raw = {};

        for (const [factor, series] of Object.entries(seriesMap)) {
          raw[factor] = await getFredSeries(series);
        }

        const changes = {
          interest: change(raw.interest),
          inflation: change(raw.inflation),
          growth: change(raw.growth)
        };

        // ==========================================
        // EUR SCORING
        // ==========================================

        let interestScore = 0;
        let inflationScore = 0;
        let growthScore = 0;

        // Interest rate
        if (changes.interest >= 0.25) {
          interestScore = 2;
        } else if (changes.interest > 0) {
          interestScore = 1;
        } else if (changes.interest <= -0.25) {
          interestScore = -2;
        } else if (changes.interest < 0) {
          interestScore = -1;
        }

        // Growth
        if (changes.growth >= 10000) {
          growthScore = 2;
        } else if (changes.growth > 0) {
          growthScore = 1;
        } else if (changes.growth <= -10000) {
          growthScore = -2;
        } else if (changes.growth < 0) {
          growthScore = -1;
        }

        // Inflation remains neutral until we compare
        // inflation against ECB policy and growth.
        inflationScore = 0;

        const totalScore =
          interestScore +
          inflationScore +
          growthScore;

        let regime = "NEUTRAL";

        if (totalScore >= 4) {
          regime = "STRONG";
        } else if (totalScore >= 2) {
          regime = "POSITIVE";
        } else if (totalScore <= -4) {
          regime = "WEAK";
        } else if (totalScore <= -2) {
          regime = "NEGATIVE";
        }

        return Response.json({

          success: true,

          currency: "EUR",

          provider: "FRED",

          series: seriesMap,

          latest: {
            interest: raw.interest[0],
            inflation: raw.inflation[0],
            growth: raw.growth[0]
          },

          changes,

          scores: {
            interest: interestScore,
            inflation: inflationScore,
            growth: growthScore,
            total: totalScore
          },

          regime,

          limitations: {
            employment:
              "Current live Euro Area unemployment was not included because the readily available FRED unemployment series located during implementation are outdated OECD series.",

            inflation:
              "HICP direction alone is not used as a bullish or bearish EUR signal.",

            growth:
              "Real GDP is quarterly and should be interpreted as an economic-growth input rather than a short-term trading signal."
          },

          methodology: {
            interest:
              "ECB Deposit Facility Rate direction is used as a monetary-policy input.",

            inflation:
              "Euro Area HICP is monitored but currently receives a neutral score until policy context is incorporated.",

            growth:
              "Positive changes in real Euro Area GDP contribute positively."
          }

        });

      } catch (error) {

        return Response.json({

          success: false,

          currency: "EUR",

          provider: "FRED",

          error: error.message

        });

      }
    }

    // ==========================================
    // FUNDAMENTAL SCORING ENGINE
    // ==========================================
    if (url.pathname === "/api/fundamentals") {

      const currencies = [
        "USD",
        "EUR",
        "GBP",
        "JPY",
        "CHF",
        "CAD",
        "AUD",
        "NZD"
      ];

      const scores = {};

      for (const currency of currencies) {

        const interest =
          Number(
            url.searchParams.get(`${currency}_interest`) || 0
          );

        const inflation =
          Number(
            url.searchParams.get(`${currency}_inflation`) || 0
          );

        const growth =
          Number(
            url.searchParams.get(`${currency}_growth`) || 0
          );

        const employment =
          Number(
            url.searchParams.get(`${currency}_employment`) || 0
          );

        const centralBank =
          Number(
            url.searchParams.get(`${currency}_centralbank`) || 0
          );

        const total =
          interest +
          inflation +
          growth +
          employment +
          centralBank;

        scores[currency] = {
          interest,
          inflation,
          growth,
          employment,
          centralBank,
          total
        };
      }

      return Response.json({

        success: true,

        scores,

        methodology: {

          interest:
            "Interest-rate direction",

          inflation:
            "Inflation trend",

          growth:
            "Economic growth",

          employment:
            "Labour-market conditions",

          centralBank:
            "Central-bank stance"

        }

      });
    }

    // ==========================================
    // MACRO ANALYSIS ENGINE
    // ==========================================
    if (url.pathname === "/api/analyse") {

      const pair = (
        url.searchParams.get("pair") || "EUR/USD"
      ).toUpperCase();

      const base = Number(
        url.searchParams.get("base") || 0
      );

      const quote = Number(
        url.searchParams.get("quote") || 0
      );

      const technical = Number(
        url.searchParams.get("technical") || 0
      );

      const divergence =
        url.searchParams.get("divergence") === "true";

      const differential = base - quote;

      let action = "PASS";

      let summary =
        "Fundamental differential is too weak for this framework.";

      if (
        differential >= 6 &&
        divergence &&
        technical >= 2
      ) {

        action = `BUY ${pair}`;

        summary =
          "Strong macro differential, price/fundamental divergence and technical confirmation.";

      } else if (
        differential <= -6 &&
        divergence &&
        technical <= -2
      ) {

        action = `SELL ${pair}`;

        summary =
          "Strong negative macro differential, price/fundamental divergence and technical confirmation.";

      } else if (
        Math.abs(differential) >= 6 &&
        divergence
      ) {

        action = "WAIT";

        summary =
          "Strong macro differential and divergence, but technical confirmation is incomplete.";

      } else if (
        Math.abs(differential) >= 3
      ) {

        action = "WATCH";

        summary =
          "Moderate fundamental differential; wait for stronger divergence and confirmation.";
      }

      return Response.json({

        pair,

        base_score: base,

        quote_score: quote,

        differential,

        divergence,

        technical,

        action,

        summary,

        framework: [

          "Fundamentals",

          "Fundamental differential",

          "Price divergence",

          "Technical confirmation",

          "Rule-based action"

        ]

      });
    }

    // ==========================================
    // SERVE THE APP
    // ==========================================
    return env.ASSETS.fetch(request);
  }
};
