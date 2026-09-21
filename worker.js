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

        let interestScore = 0;
        let inflationScore = 0;
        let growthScore = 0;

        if (changes.interest >= 0.25) {
          interestScore = 2;
        } else if (changes.interest > 0) {
          interestScore = 1;
        } else if (changes.interest <= -0.25) {
          interestScore = -2;
        } else if (changes.interest < 0) {
          interestScore = -1;
        }

        if (changes.growth >= 10000) {
          growthScore = 2;
        } else if (changes.growth > 0) {
          growthScore = 1;
        } else if (changes.growth <= -10000) {
          growthScore = -2;
        } else if (changes.growth < 0) {
          growthScore = -1;
        }

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
    // EUR/USD PAIR ANALYSIS ENGINE
    // ==========================================
    if (url.pathname === "/api/pair-analysis") {

      if (!env.FRED_API_KEY) {
        return Response.json({
          success: false,
          pair: "EUR/USD",
          error: "FRED API key is not configured."
        });
      }

      const eurSeries = {
        interest: "ECBDFR",
        inflation: "CP0000EZ19M086NEST",
        growth: "CLVMNACSCAB1GQEA19"
      };

      const usdSeries = {
        interest: "DFF",
        inflation: "CPIAUCSL",
        growth: "GDPC1",
        employment: "UNRATE",
        liquidity: "WALCL"
      };

      async function getPairFredSeries(series) {
        const apiUrl =
          `https://api.stlouisfed.org/fred/series/observations` +
          `?series_id=${series}` +
          `&api_key=${encodeURIComponent(env.FRED_API_KEY)}` +
          `&file_type=json` +
          `&sort_order=desc` +
          `&limit=5`;

        const response = await fetch(apiUrl);

        if (!response.ok) {
          throw new Error(
            `FRED request failed for ${series}: HTTP ${response.status}`
          );
        }

        const data = await response.json();

        if (!data.observations) {
          throw new Error(
            `No observations returned for ${series}`
          );
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

        const eurRaw = {};

        for (const [factor, series] of Object.entries(eurSeries)) {
          eurRaw[factor] = await getPairFredSeries(series);
        }

        const usdRaw = {};

        for (const [factor, series] of Object.entries(usdSeries)) {
          usdRaw[factor] = await getPairFredSeries(series);
        }

        const eurChanges = {
          interest: change(eurRaw.interest),
          inflation: change(eurRaw.inflation),
          growth: change(eurRaw.growth)
        };

        const usdChanges = {
          interest: change(usdRaw.interest),
          inflation: change(usdRaw.inflation),
          growth: change(usdRaw.growth),
          employment: change(usdRaw.employment),
          liquidity: change(usdRaw.liquidity)
        };

        let eurInterestScore = 0;
        let eurInflationScore = 0;
        let eurGrowthScore = 0;

        if (eurChanges.interest >= 0.25) {
          eurInterestScore = 2;
        } else if (eurChanges.interest > 0) {
          eurInterestScore = 1;
        } else if (eurChanges.interest <= -0.25) {
          eurInterestScore = -2;
        } else if (eurChanges.interest < 0) {
          eurInterestScore = -1;
        }

        if (eurChanges.growth >= 10000) {
          eurGrowthScore = 2;
        } else if (eurChanges.growth > 0) {
          eurGrowthScore = 1;
        } else if (eurChanges.growth <= -10000) {
          eurGrowthScore = -2;
        } else if (eurChanges.growth < 0) {
          eurGrowthScore = -1;
        }

        eurInflationScore = 0;

        const eurScore =
          eurInterestScore +
          eurInflationScore +
          eurGrowthScore;

        let usdInterestScore = 0;
        let usdGrowthScore = 0;
        let usdEmploymentScore = 0;
        let usdInflationScore = 0;
        let usdLiquidityScore = 0;

        if (usdChanges.interest >= 0.25) {
          usdInterestScore = 2;
        } else if (usdChanges.interest > 0) {
          usdInterestScore = 1;
        } else if (usdChanges.interest <= -0.25) {
          usdInterestScore = -2;
        } else if (usdChanges.interest < 0) {
          usdInterestScore = -1;
        }

        if (usdChanges.growth >= 100) {
          usdGrowthScore = 2;
        } else if (usdChanges.growth > 0) {
          usdGrowthScore = 1;
        } else if (usdChanges.growth <= -100) {
          usdGrowthScore = -2;
        } else if (usdChanges.growth < 0) {
          usdGrowthScore = -1;
        }

        if (usdChanges.employment <= -0.2) {
          usdEmploymentScore = 2;
        } else if (usdChanges.employment < 0) {
          usdEmploymentScore = 1;
        } else if (usdChanges.employment >= 0.2) {
          usdEmploymentScore = -2;
        } else if (usdChanges.employment > 0) {
          usdEmploymentScore = -1;
        }

        usdInflationScore = 0;

        if (usdChanges.liquidity <= -10000) {
          usdLiquidityScore = 1;
        } else if (usdChanges.liquidity >= 10000) {
          usdLiquidityScore = -1;
        }

        const usdScore =
          usdInterestScore +
          usdGrowthScore +
          usdEmploymentScore +
          usdInflationScore +
          usdLiquidityScore;

        const differential = eurScore - usdScore;

        let bias = "NEUTRAL";

        if (differential > 0) {
          bias = "EUR/USD POSITIVE";
        } else if (differential < 0) {
          bias = "EUR/USD NEGATIVE";
        }

        let eurRegime = "NEUTRAL";

        if (eurScore >= 4) {
          eurRegime = "STRONG";
        } else if (eurScore >= 2) {
          eurRegime = "POSITIVE";
        } else if (eurScore <= -4) {
          eurRegime = "WEAK";
        } else if (eurScore <= -2) {
          eurRegime = "NEGATIVE";
        }

        let usdRegime = "NEUTRAL";

        if (usdScore >= 5) {
          usdRegime = "STRONG";
        } else if (usdScore >= 2) {
          usdRegime = "POSITIVE";
        } else if (usdScore <= -5) {
          usdRegime = "WEAK";
        } else if (usdScore <= -2) {
          usdRegime = "NEGATIVE";
        }

        return Response.json({

          success: true,

          pair: "EUR/USD",

          provider: "FRED",

          eur: {
            score: eurScore,
            regime: eurRegime,
            changes: eurChanges,
            scores: {
              interest: eurInterestScore,
              inflation: eurInflationScore,
              growth: eurGrowthScore
            }
          },

          usd: {
            score: usdScore,
            regime: usdRegime,
            changes: usdChanges,
            scores: {
              interest: usdInterestScore,
              inflation: usdInflationScore,
              growth: usdGrowthScore,
              employment: usdEmploymentScore,
              liquidity: usdLiquidityScore
            }
          },

          differential,

          bias,

          explanation:
            `EUR score (${eurScore}) - USD score (${usdScore}) = differential (${differential})`,

          next_stage:
            "Price divergence",

          framework: [
            "Macro fundamentals",
            "Currency scores",
            "Fundamental differential",
            "Price divergence",
            "Technical confirmation",
            "Rule-based action"
          ]

        });

      } catch (error) {

        return Response.json({

          success: false,

          pair: "EUR/USD",

          provider: "FRED",

          error: error.message

        });

      }
    }

    // ==========================================
    // PRICE DIVERGENCE ENGINE
    // ==========================================
    if (url.pathname === "/api/price-divergence") {

      const pair = (
        url.searchParams.get("pair") || "EUR/USD"
      ).toUpperCase();

      const fromDate =
        url.searchParams.get("from") || "2026-09-01";

      const toDate =
        url.searchParams.get("to") || "2026-09-18";

      if (pair !== "EUR/USD") {
        return Response.json({
          success: false,
          pair,
          provider: "Frankfurter",
          error:
            "Price divergence currently supports EUR/USD only."
        });
      }

      try {

        const priceUrl =
          `https://api.frankfurter.dev/v2/rates` +
          `?from=${encodeURIComponent(fromDate)}` +
          `&to=${encodeURIComponent(toDate)}` +
          `&base=EUR` +
          `&quotes=USD`;

        const response = await fetch(priceUrl);

        if (!response.ok) {
          throw new Error(
            `Frankfurter request failed: HTTP ${response.status}`
          );
        }

        const prices = await response.json();

        if (!Array.isArray(prices) || prices.length < 2) {
          throw new Error(
            "Not enough historical EUR/USD price data returned."
          );
        }

        prices.sort(
          (a, b) =>
            new Date(a.date) - new Date(b.date)
        );

        const first = prices[0];
        const latest = prices[prices.length - 1];

        const firstPrice = Number(first.rate);
        const latestPrice = Number(latest.rate);

        if (
          !Number.isFinite(firstPrice) ||
          !Number.isFinite(latestPrice) ||
          firstPrice <= 0
        ) {
          throw new Error(
            "Invalid EUR/USD price data returned."
          );
        }

        const priceChange =
          latestPrice - firstPrice;

        const priceChangePercent =
          (priceChange / firstPrice) * 100;

        let priceDirection = "FLAT";

        if (priceChangePercent > 0.05) {
          priceDirection = "UP";
        } else if (priceChangePercent < -0.05) {
          priceDirection = "DOWN";
        }

        if (!env.FRED_API_KEY) {
          return Response.json({
            success: false,
            pair,
            provider: "Frankfurter + FRED",
            error:
              "FRED API key is not configured."
          });
        }

        const eurSeries = {
          interest: "ECBDFR",
          inflation: "CP0000EZ19M086NEST",
          growth: "CLVMNACSCAB1GQEA19"
        };

        const usdSeries = {
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

          const fredResponse =
            await fetch(apiUrl);

          if (!fredResponse.ok) {
            throw new Error(
              `FRED request failed for ${series}: HTTP ${fredResponse.status}`
            );
          }

          const data =
            await fredResponse.json();

          if (!data.observations) {
            throw new Error(
              `No observations returned for ${series}`
            );
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

        const eurRaw = {};
        const usdRaw = {};

        for (
          const [factor, series]
          of Object.entries(eurSeries)
        ) {
          eurRaw[factor] =
            await getFredSeries(series);
        }

        for (
          const [factor, series]
          of Object.entries(usdSeries)
        ) {
          usdRaw[factor] =
            await getFredSeries(series);
        }

        const eurChanges = {
          interest: change(eurRaw.interest),
          inflation: change(eurRaw.inflation),
          growth: change(eurRaw.growth)
        };

        const usdChanges = {
          interest: change(usdRaw.interest),
          inflation: change(usdRaw.inflation),
          growth: change(usdRaw.growth),
          employment: change(usdRaw.employment),
          liquidity: change(usdRaw.liquidity)
        };

        let eurInterestScore = 0;
        let eurGrowthScore = 0;

        if (eurChanges.interest >= 0.25) {
          eurInterestScore = 2;
        } else if (eurChanges.interest > 0) {
          eurInterestScore = 1;
        } else if (eurChanges.interest <= -0.25) {
          eurInterestScore = -2;
        } else if (eurChanges.interest < 0) {
          eurInterestScore = -1;
        }

        if (eurChanges.growth >= 10000) {
          eurGrowthScore = 2;
        } else if (eurChanges.growth > 0) {
          eurGrowthScore = 1;
        } else if (eurChanges.growth <= -10000) {
          eurGrowthScore = -2;
        } else if (eurChanges.growth < 0) {
          eurGrowthScore = -1;
        }

        const eurScore =
          eurInterestScore +
          eurGrowthScore;

        let usdInterestScore = 0;
        let usdGrowthScore = 0;
        let usdEmploymentScore = 0;
        let usdLiquidityScore = 0;

        if (usdChanges.interest >= 0.25) {
          usdInterestScore = 2;
        } else if (usdChanges.interest > 0) {
          usdInterestScore = 1;
        } else if (usdChanges.interest <= -0.25) {
          usdInterestScore = -2;
        } else if (usdChanges.interest < 0) {
          usdInterestScore = -1;
        }

        if (usdChanges.growth >= 100) {
          usdGrowthScore = 2;
        } else if (usdChanges.growth > 0) {
          usdGrowthScore = 1;
        } else if (usdChanges.growth <= -100) {
          usdGrowthScore = -2;
        } else if (usdChanges.growth < 0) {
          usdGrowthScore = -1;
        }

        if (usdChanges.employment <= -0.2) {
          usdEmploymentScore = 2;
        } else if (usdChanges.employment < 0) {
          usdEmploymentScore = 1;
        } else if (usdChanges.employment >= 0.2) {
          usdEmploymentScore = -2;
        } else if (usdChanges.employment > 0) {
          usdEmploymentScore = -1;
        }

        if (usdChanges.liquidity <= -10000) {
          usdLiquidityScore = 1;
        } else if (usdChanges.liquidity >= 10000) {
          usdLiquidityScore = -1;
        }

        const usdScore =
          usdInterestScore +
          usdGrowthScore +
          usdEmploymentScore +
          usdLiquidityScore;

        const differential =
          eurScore - usdScore;

        let fundamentalDirection = "FLAT";

        if (differential > 0) {
          fundamentalDirection = "UP";
        } else if (differential < 0) {
          fundamentalDirection = "DOWN";
        }

        let divergence = false;

        if (
          fundamentalDirection === "UP" &&
          priceDirection === "DOWN"
        ) {
          divergence = true;
        }

        if (
          fundamentalDirection === "DOWN" &&
          priceDirection === "UP"
        ) {
          divergence = true;
        }

        let relationship = "ALIGNED";

        if (divergence) {
          relationship = "DIVERGENCE";
        }

        if (
          fundamentalDirection === "FLAT" ||
          priceDirection === "FLAT"
        ) {
          relationship = "INCONCLUSIVE";
        }

        return Response.json({

          success: true,

          pair,

          provider: "Frankfurter + FRED",

          period: {
            from: first.date,
            to: latest.date,
            observations: prices.length
          },

          price: {
            first: {
              date: first.date,
              value: firstPrice
            },

            latest: {
              date: latest.date,
              value: latestPrice
            },

            change: priceChange,

            changePercent:
              Number(priceChangePercent.toFixed(4)),

            direction: priceDirection
          },

          fundamentals: {
            eurScore,
            usdScore,
            differential,
            direction: fundamentalDirection
          },

          divergence,

          relationship,

          explanation:
            `Fundamental direction ${fundamentalDirection}; ` +
            `price direction ${priceDirection}; ` +
            `relationship ${relationship}.`,

          nextStage:
            divergence
              ? "Technical confirmation"
              : "Continue monitoring",

          framework: [
            "Macro fundamentals",
            "Currency scores",
            "Fundamental differential",
            "Price divergence",
            "Technical confirmation",
            "Rule-based action"
          ],

          historicalPrices: prices

        });

      } catch (error) {

        return Response.json({

          success: false,

          pair,

          provider: "Frankfurter + FRED",

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
    // H4 TECHNICAL ANALYSIS ENGINE
    // ==========================================
    if (url.pathname === "/api/technical-analysis") {

      if (!env.TWELVE_DATA_API_KEY) {
        return Response.json({
          success: false,
          provider: "Twelve Data",
          error: "TWELVE_DATA_API_KEY is not configured."
        });
      }

      const interval = "4h";
      const outputsize = 100;

      const apiUrl =
        `https://api.twelvedata.com/time_series` +
        `?symbol=EUR%2FUSD` +
        `&interval=${interval}` +
        `&outputsize=${outputsize}` +
        `&timezone=UTC` +
        `&apikey=${encodeURIComponent(env.TWELVE_DATA_API_KEY)}`;

      try {

        const response = await fetch(apiUrl);
        const data = await response.json();

        if (!response.ok || data.status === "error") {
          return Response.json({
            success: false,
            provider: "Twelve Data",
            interval,
            error:
              data.message ||
              `HTTP ${response.status}`
          });
        }

        const candles = (data.values || [])
          .map(c => ({
            datetime: c.datetime,
            open: Number(c.open),
            high: Number(c.high),
            low: Number(c.low),
            close: Number(c.close)
          }))
          .filter(c =>
            Number.isFinite(c.open) &&
            Number.isFinite(c.high) &&
            Number.isFinite(c.low) &&
            Number.isFinite(c.close)
          )
          .reverse();

        if (candles.length < 20) {
          return Response.json({
            success: false,
            provider: "Twelve Data",
            error:
              "Not enough H4 candles for technical analysis.",
            candle_count: candles.length
          });
        }

        // ------------------------------------------
        // 1. SWING HIGH / SWING LOW DETECTION
        // ------------------------------------------

        const swingHighs = [];
        const swingLows = [];

        for (let i = 2; i < candles.length - 2; i++) {

          const current = candles[i];

          const isSwingHigh =
            current.high > candles[i - 1].high &&
            current.high > candles[i - 2].high &&
            current.high > candles[i + 1].high &&
            current.high > candles[i + 2].high;

          const isSwingLow =
            current.low < candles[i - 1].low &&
            current.low < candles[i - 2].low &&
            current.low < candles[i + 1].low &&
            current.low < candles[i + 2].low;

          if (isSwingHigh) {
            swingHighs.push({
              index: i,
              datetime: current.datetime,
              price: current.high
            });
          }

          if (isSwingLow) {
            swingLows.push({
              index: i,
              datetime: current.datetime,
              price: current.low
            });
          }
        }

        // ------------------------------------------
        // 2. CLASSIFY SWING STRUCTURE
        // ------------------------------------------

        const classifiedHighs = [];

        for (let i = 1; i < swingHighs.length; i++) {

          const current = swingHighs[i];
          const previous = swingHighs[i - 1];

          let type = "EH";

          if (current.price > previous.price) {
            type = "HH";
          } else if (current.price < previous.price) {
            type = "LH";
          }

          classifiedHighs.push({
            ...current,
            type
          });
        }

        const classifiedLows = [];

        for (let i = 1; i < swingLows.length; i++) {

          const current = swingLows[i];
          const previous = swingLows[i - 1];

          let type = "EL";

          if (current.price > previous.price) {
            type = "HL";
          } else if (current.price < previous.price) {
            type = "LL";
          }

          classifiedLows.push({
            ...current,
            type
          });
        }

        // ------------------------------------------
        // 3. CURRENT MARKET STRUCTURE
        // ------------------------------------------

        const recentHighs =
          classifiedHighs.slice(-4);

        const recentLows =
          classifiedLows.slice(-4);

        let bullishStructure = false;
        let bearishStructure = false;

        if (
          recentHighs.length >= 2 &&
          recentLows.length >= 2
        ) {

          const highTypes =
            recentHighs.map(x => x.type);

          const lowTypes =
            recentLows.map(x => x.type);

          bullishStructure =
            highTypes.includes("HH") &&
            lowTypes.includes("HL");

          bearishStructure =
            highTypes.includes("LH") &&
            lowTypes.includes("LL");
        }

        let structure = "NEUTRAL";

        if (bullishStructure && !bearishStructure) {
          structure = "BULLISH";
        } else if (bearishStructure && !bullishStructure) {
          structure = "BEARISH";
        }

        // ------------------------------------------
        // 4. BREAK OF STRUCTURE
        // ------------------------------------------

        const latestCandle =
          candles[candles.length - 1];

        const previousSwingHigh =
          swingHighs.length > 0
            ? swingHighs[swingHighs.length - 1]
            : null;

        const previousSwingLow =
          swingLows.length > 0
            ? swingLows[swingLows.length - 1]
            : null;

        let bullishBOS = false;
        let bearishBOS = false;

        let bosLevel = null;

        if (
          previousSwingHigh &&
          latestCandle.close > previousSwingHigh.price
        ) {
          bullishBOS = true;
          bosLevel = previousSwingHigh.price;
        }

        if (
          previousSwingLow &&
          latestCandle.close < previousSwingLow.price
        ) {
          bearishBOS = true;
          bosLevel = previousSwingLow.price;
        }

        let bos = "NONE";

        if (bullishBOS && !bearishBOS) {
          bos = "BULLISH";
        } else if (bearishBOS && !bullishBOS) {
          bos = "BEARISH";
        }

        // ------------------------------------------
        // 5. RECENT AVERAGE RANGE
        // ------------------------------------------

        const rangeLookback =
          Math.min(20, candles.length);

        const recentCandles =
          candles.slice(-rangeLookback);

        const averageRange =
          recentCandles.reduce(
            (sum, candle) =>
              sum + (candle.high - candle.low),
            0
          ) / recentCandles.length;

        // ------------------------------------------
        // 6. DEMAND ZONE CANDIDATES
        // ------------------------------------------

        const demandZones = [];

        for (let i = 4; i < candles.length - 1; i++) {

          const baseStart = i - 2;

          const baseCandles = candles.slice(
            baseStart,
            i + 1
          );

          const baseHigh =
            Math.max(
              ...baseCandles.map(c => c.high)
            );

          const baseLow =
            Math.min(
              ...baseCandles.map(c => c.low)
            );

          const baseRange =
            baseHigh - baseLow;

          const departure =
            candles[i + 1].close - baseHigh;

          if (
            baseRange > 0 &&
            departure >= averageRange * 1.5
          ) {

            demandZones.push({
              type: "DEMAND",
              from: baseLow,
              to: baseHigh,
              createdAt: candles[i].datetime,
              departure: Number(
                departure.toFixed(5)
              ),
              strength: "CANDIDATE"
            });
          }
        }

        // ------------------------------------------
        // 7. SUPPLY ZONE CANDIDATES
        // ------------------------------------------

        const supplyZones = [];

        for (let i = 4; i < candles.length - 1; i++) {

          const baseStart = i - 2;

          const baseCandles = candles.slice(
            baseStart,
            i + 1
          );

          const baseHigh =
            Math.max(
              ...baseCandles.map(c => c.high)
            );

          const baseLow =
            Math.min(
              ...baseCandles.map(c => c.low)
            );

          const baseRange =
            baseHigh - baseLow;

          const departure =
            baseLow - candles[i + 1].close;

          if (
            baseRange > 0 &&
            departure >= averageRange * 1.5
          ) {

            supplyZones.push({
              type: "SUPPLY",
              from: baseLow,
              to: baseHigh,
              createdAt: candles[i].datetime,
              departure: Number(
                departure.toFixed(5)
              ),
              strength: "CANDIDATE"
            });
          }
        }

        // ------------------------------------------
        // 8. SUPPORT / RESISTANCE
        // ------------------------------------------

        const supportLevels =
          swingLows
            .slice(-5)
            .map(x => ({
              price: x.price,
              datetime: x.datetime,
              timeframe: "H4"
            }));

        const resistanceLevels =
          swingHighs
            .slice(-5)
            .map(x => ({
              price: x.price,
              datetime: x.datetime,
              timeframe: "H4"
            }));

        // ------------------------------------------
        // 9. TECHNICAL STATUS
        // ------------------------------------------

        let technicalStatus = "NOT_CONFIRMED";

        if (
          bos === "BULLISH" &&
          structure === "BULLISH"
        ) {
          technicalStatus = "BULLISH_STRUCTURE";
        }

        if (
          bos === "BEARISH" &&
          structure === "BEARISH"
        ) {
          technicalStatus = "BEARISH_STRUCTURE";
        }

        // ------------------------------------------
        // RETURN ANALYSIS
        // ------------------------------------------

        return Response.json({

          success: true,

          provider: "Twelve Data",

          pair: "EUR/USD",

          timeframe: "H4",

          candle_count: candles.length,

          latest: latestCandle,

          market_structure: {
            direction: structure,
            bullish: bullishStructure,
            bearish: bearishStructure
          },

          swing_points: {
            highs: classifiedHighs.slice(-10),
            lows: classifiedLows.slice(-10)
          },

          break_of_structure: {
            direction: bos,
            level: bosLevel
          },

          zones: {
            demand: demandZones.slice(-5),
            supply: supplyZones.slice(-5)
          },

          support: supportLevels,

          resistance: resistanceLevels,

          volatility: {
            averageRange: Number(
              averageRange.toFixed(5)
            )
          },

          technical_status: technicalStatus,

          methodology: {
            swing:
              "Swing high/low requires two candles on the left and two on the right.",

            bos:
              "Break of structure requires a candle close beyond the relevant swing level.",

            demand:
              "Demand candidates use a compact three-candle base followed by a bullish departure of at least 1.5 times recent average H4 range.",

            supply:
              "Supply candidates use a compact three-candle base followed by a bearish departure of at least 1.5 times recent average H4 range.",

            confirmation:
              "H4 technical analysis is descriptive at this stage. It does not create a BUY or SELL signal."
          }

        });

      } catch (error) {

        return Response.json({

          success: false,

          provider: "Twelve Data",

          pair: "EUR/USD",

          interval: "4h",

          error: error.message

        });

      }
    }

    // ==========================================
    // TWELVE DATA — TECHNICAL DATA TEST
    // ==========================================
    if (url.pathname === "/api/technical-data-test") {

      if (!env.TWELVE_DATA_API_KEY) {
        return Response.json({
          success: false,
          provider: "Twelve Data",
          error: "TWELVE_DATA_API_KEY is not configured."
        });
      }

      const interval =
        url.searchParams.get("interval") || "1h";

      if (!["1h", "4h"].includes(interval)) {
        return Response.json({
          success: false,
          provider: "Twelve Data",
          error: "Interval must be 1h or 4h."
        });
      }

      const outputsize = 100;

      const apiUrl =
        `https://api.twelvedata.com/time_series` +
        `?symbol=EUR%2FUSD` +
        `&interval=${encodeURIComponent(interval)}` +
        `&outputsize=${outputsize}` +
        `&timezone=UTC` +
        `&apikey=${encodeURIComponent(env.TWELVE_DATA_API_KEY)}`;

      try {

        const response = await fetch(apiUrl);
        const data = await response.json();

        if (!response.ok) {
          return Response.json({
            success: false,
            provider: "Twelve Data",
            interval,
            error: `HTTP ${response.status}`,
            data
          });
        }

        if (data.status === "error") {
          return Response.json({
            success: false,
            provider: "Twelve Data",
            interval,
            error: data.message || "Twelve Data returned an error.",
            code: data.code || null
          });
        }

        return Response.json({
          success: true,
          provider: "Twelve Data",
          pair: "EUR/USD",
          interval,
          candles: data.values || [],
          candle_count: (data.values || []).length,
          meta: data.meta || null
        });

      } catch (error) {

        return Response.json({
          success: false,
          provider: "Twelve Data",
          interval,
          error: error.message
        });

      }
    }

    // ==========================================
    // SERVE THE APP
    // ==========================================
    return env.ASSETS.fetch(request);
  }
};
