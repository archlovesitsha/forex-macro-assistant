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
        } else if (bullishStructure && bearishStructure) {
          structure = "TRANSITION";
        }

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
    // H1 TECHNICAL CONFIRMATION ENGINE
    // H4 CONTEXT + H1 RETRACEMENT + H1 BOS
    // ==========================================
    if (url.pathname === "/api/technical-confirmation") {

      if (!env.TWELVE_DATA_API_KEY) {
        return Response.json({
          success: false,
          provider: "Twelve Data",
          error: "TWELVE_DATA_API_KEY is not configured."
        });
      }

      const symbol = "EUR/USD";
      const outputsize = 100;

      async function getCandles(interval) {

        const apiUrl =
          `https://api.twelvedata.com/time_series` +
          `?symbol=EUR%2FUSD` +
          `&interval=${interval}` +
          `&outputsize=${outputsize}` +
          `&timezone=UTC` +
          `&apikey=${encodeURIComponent(env.TWELVE_DATA_API_KEY)}`;

        const response = await fetch(apiUrl);
        const data = await response.json();

        if (!response.ok || data.status === "error") {
          throw new Error(
            data.message ||
            `Twelve Data ${interval} request failed: HTTP ${response.status}`
          );
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

        return candles;
      }

      function findSwings(candles) {

        const highs = [];
        const lows = [];

        for (let i = 2; i < candles.length - 2; i++) {

          const c = candles[i];

          const isHigh =
            c.high > candles[i - 1].high &&
            c.high > candles[i - 2].high &&
            c.high > candles[i + 1].high &&
            c.high > candles[i + 2].high;

          const isLow =
            c.low < candles[i - 1].low &&
            c.low < candles[i - 2].low &&
            c.low < candles[i + 1].low &&
            c.low < candles[i + 2].low;

          if (isHigh) {
            highs.push({
              index: i,
              datetime: c.datetime,
              price: c.high
            });
          }

          if (isLow) {
            lows.push({
              index: i,
              datetime: c.datetime,
              price: c.low
            });
          }
        }

        return {
          highs,
          lows
        };
      }

      function classifySwings(swings) {

        const highs = [];
        const lows = [];

        for (let i = 0; i < swings.highs.length; i++) {

          const current = swings.highs[i];

          let type = "FIRST";

          if (i > 0) {

            const previous = swings.highs[i - 1];

            if (current.price > previous.price) {
              type = "HH";
            } else if (current.price < previous.price) {
              type = "LH";
            } else {
              type = "EH";
            }
          }

          highs.push({
            ...current,
            type
          });
        }

        for (let i = 0; i < swings.lows.length; i++) {

          const current = swings.lows[i];

          let type = "FIRST";

          if (i > 0) {

            const previous = swings.lows[i - 1];

            if (current.price > previous.price) {
              type = "HL";
            } else if (current.price < previous.price) {
              type = "LL";
            } else {
              type = "EL";
            }
          }

          lows.push({
            ...current,
            type
          });
        }

        return {
          highs,
          lows
        };
      }

      function determineStructure(classified) {

        const highs =
          classified.highs.slice(-5);

        const lows =
          classified.lows.slice(-5);

        if (
          highs.length < 2 ||
          lows.length < 2
        ) {
          return "NEUTRAL";
        }

        const lastHigh =
          highs[highs.length - 1];

        const previousHigh =
          highs[highs.length - 2];

        const lastLow =
          lows[lows.length - 1];

        const previousLow =
          lows[lows.length - 2];

        const bullish =
          lastHigh.price > previousHigh.price &&
          lastLow.price > previousLow.price;

        const bearish =
          lastHigh.price < previousHigh.price &&
          lastLow.price < previousLow.price;

        if (bullish) {
          return "BULLISH";
        }

        if (bearish) {
          return "BEARISH";
        }

        return "NEUTRAL";
      }

      function findLatestBOS(candles, swings) {

        if (candles.length < 10) {
          return {
            direction: "NONE",
            level: null,
            datetime: null
          };
        }

        let bullishEvent = null;
        let bearishEvent = null;

        for (let i = 0; i < candles.length; i++) {

          const candle = candles[i];

          const priorHighs =
            swings.highs.filter(
              s => s.index < i
            );

          const priorLows =
            swings.lows.filter(
              s => s.index < i
            );

          const lastHigh =
            priorHighs.length
              ? priorHighs[priorHighs.length - 1]
              : null;

          const lastLow =
            priorLows.length
              ? priorLows[priorLows.length - 1]
              : null;

          if (
            lastHigh &&
            candle.close > lastHigh.price
          ) {
            bullishEvent = {
              direction: "BULLISH",
              level: lastHigh.price,
              datetime: candle.datetime,
              index: i
            };
          }

          if (
            lastLow &&
            candle.close < lastLow.price
          ) {
            bearishEvent = {
              direction: "BEARISH",
              level: lastLow.price,
              datetime: candle.datetime,
              index: i
            };
          }
        }

        if (!bullishEvent && !bearishEvent) {
          return {
            direction: "NONE",
            level: null,
            datetime: null
          };
        }

        if (
          bullishEvent &&
          !bearishEvent
        ) {
          return bullishEvent;
        }

        if (
          bearishEvent &&
          !bullishEvent
        ) {
          return bearishEvent;
        }

        const bullishTime =
          new Date(bullishEvent.datetime).getTime();

        const bearishTime =
          new Date(bearishEvent.datetime).getTime();

        return bullishTime > bearishTime
          ? bullishEvent
          : bearishEvent;
      }

      function calculateAverageRange(candles, lookback = 20) {

        const selected =
          candles.slice(-lookback);

        if (!selected.length) {
          return 0;
        }

        return selected.reduce(
          (sum, candle) =>
            sum + (candle.high - candle.low),
          0
        ) / selected.length;
      }

      function detectZones(candles, averageRange) {

        const demand = [];
        const supply = [];

        if (candles.length < 10) {
          return {
            demand,
            supply
          };
        }

        for (
          let i = 4;
          i < candles.length - 1;
          i++
        ) {

          // Three-candle base
          const base =
            candles.slice(i - 2, i + 1);

          const baseHigh =
            Math.max(
              ...base.map(c => c.high)
            );

          const baseLow =
            Math.min(
              ...base.map(c => c.low)
            );

          const baseRange =
            baseHigh - baseLow;

          const departure =
            candles[i + 1];

          const bullishDeparture =
            departure.close - baseHigh;

          const bearishDeparture =
            baseLow - departure.close;

          if (
            baseRange > 0 &&
            bullishDeparture >= averageRange * 1.5
          ) {

            demand.push({
              type: "DEMAND",
              from: baseLow,
              to: baseHigh,
              createdAt: candles[i].datetime,
              departureAt: departure.datetime,
              departure: Number(
                bullishDeparture.toFixed(5)
              ),
              strength: "CANDIDATE"
            });
          }

          if (
            baseRange > 0 &&
            bearishDeparture >= averageRange * 1.5
          ) {

            supply.push({
              type: "SUPPLY",
              from: baseLow,
              to: baseHigh,
              createdAt: candles[i].datetime,
              departureAt: departure.datetime,
              departure: Number(
                bearishDeparture.toFixed(5)
              ),
              strength: "CANDIDATE"
            });
          }
        }

        return {
          demand: demand.slice(-10),
          supply: supply.slice(-10)
        };
      }

      function priceInsideZone(price, zone) {

        if (!zone) {
          return false;
        }

        return (
          price >= zone.from &&
          price <= zone.to
        );
      }

      function priceNearZone(
        price,
        zone,
        tolerance
      ) {

        if (!zone) {
          return false;
        }

        return (
          price >= zone.from - tolerance &&
          price <= zone.to + tolerance
        );
      }

      function findNearestSupport(
        price,
        swings
      ) {

        const supports =
          swings.lows
            .filter(x => x.price <= price)
            .sort(
              (a, b) =>
                price - a.price -
                (price - b.price)
            );

        return supports.length
          ? supports[0]
          : null;
      }

      function findNearestResistance(
        price,
        swings
      ) {

        const resistances =
          swings.highs
            .filter(x => x.price >= price)
            .sort(
              (a, b) =>
                a.price - price -
                (b.price - price)
            );

        return resistances.length
          ? resistances[0]
          : null;
      }

      function detectRetracement(
        h1Candles,
        h1Swings,
        direction
      ) {

        if (
          h1Candles.length < 12 ||
          !h1Swings.highs.length ||
          !h1Swings.lows.length
        ) {
          return {
            present: false,
            type: "NONE"
          };
        }

        const recent =
          h1Candles.slice(-12);

        const first =
          recent[0].close;

        const latest =
          recent[recent.length - 1].close;

        const recentHigh =
          Math.max(
            ...recent.map(c => c.high)
          );

        const recentLow =
          Math.min(
            ...recent.map(c => c.low)
          );

        const range =
          recentHigh - recentLow;

        if (range <= 0) {
          return {
            present: false,
            type: "NONE"
          };
        }

        if (direction === "BULLISH") {

          const netMove =
            latest - first;

          const pullbackFromHigh =
            recentHigh - latest;

          const controlled =
            pullbackFromHigh <
            range * 0.65;

          const notStronglyBearish =
            netMove > -range * 0.65;

          if (
            controlled &&
            notStronglyBearish
          ) {
            return {
              present: true,
              type: "BULLISH_PULLBACK",
              description:
                "Recent H1 price action shows a controlled pullback/sideways retracement within the bullish context."
            };
          }
        }

        if (direction === "BEARISH") {

          const netMove =
            latest - first;

          const pullbackFromLow =
            latest - recentLow;

          const controlled =
            pullbackFromLow <
            range * 0.65;

          const notStronglyBullish =
            netMove < range * 0.65;

          if (
            controlled &&
            notStronglyBullish
          ) {
            return {
              present: true,
              type: "BEARISH_PULLBACK",
              description:
                "Recent H1 price action shows a controlled pullback/sideways retracement within the bearish context."
            };
          }
        }

        return {
          present: false,
          type: "NONE",
          description:
            "No sufficiently controlled H1 retracement detected."
        };
      }

      function findRecentConfirmationBOS(
        candles,
        swings,
        direction
      ) {

        const recentStart =
          Math.max(0, candles.length - 15);

        for (
          let i = candles.length - 1;
          i >= recentStart;
          i--
        ) {

          const candle = candles[i];

          const priorHighs =
            swings.highs.filter(
              s => s.index < i
            );

          const priorLows =
            swings.lows.filter(
              s => s.index < i
            );

          if (direction === "BULLISH") {

            const relevantHigh =
              priorHighs.length
                ? priorHighs[priorHighs.length - 1]
                : null;

            if (
              relevantHigh &&
              candle.close > relevantHigh.price
            ) {
              return {
                confirmed: true,
                direction: "BULLISH",
                level: relevantHigh.price,
                datetime: candle.datetime,
                close: candle.close
              };
            }
          }

          if (direction === "BEARISH") {

            const relevantLow =
              priorLows.length
                ? priorLows[priorLows.length - 1]
                : null;

            if (
              relevantLow &&
              candle.close < relevantLow.price
            ) {
              return {
                confirmed: true,
                direction: "BEARISH",
                level: relevantLow.price,
                datetime: candle.datetime,
                close: candle.close
              };
            }
          }
        }

        return {
          confirmed: false,
          direction: "NONE",
          level: null,
          datetime: null,
          close: null
        };
      }

      try {

        const h4Candles =
          await getCandles("4h");

        const h1Candles =
          await getCandles("1h");

        if (
          h4Candles.length < 30 ||
          h1Candles.length < 30
        ) {
          return Response.json({
            success: false,
            provider: "Twelve Data",
            pair: symbol,
            error:
              "Not enough H4/H1 candles for technical confirmation.",
            h4_candle_count: h4Candles.length,
            h1_candle_count: h1Candles.length
          });
        }

        // ------------------------------------------
        // H4 ANALYSIS
        // ------------------------------------------

        const h4Swings =
          findSwings(h4Candles);

        const h4Classified =
          classifySwings(h4Swings);

        const h4Structure =
          determineStructure(h4Classified);

        const h4AverageRange =
          calculateAverageRange(
            h4Candles,
            20
          );

        const h4Zones =
          detectZones(
            h4Candles,
            h4AverageRange
          );

        const h4Latest =
          h4Candles[h4Candles.length - 1];

        const h4Demand =
          h4Zones.demand.length
            ? h4Zones.demand[
                h4Zones.demand.length - 1
              ]
            : null;

        const h4Supply =
          h4Zones.supply.length
            ? h4Zones.supply[
                h4Zones.supply.length - 1
              ]
            : null;

        const h4Support =
          findNearestSupport(
            h4Latest.close,
            h4Swings
          );

        const h4Resistance =
          findNearestResistance(
            h4Latest.close,
            h4Swings
          );

        // ------------------------------------------
        // H1 ANALYSIS
        // ------------------------------------------

        const h1Swings =
          findSwings(h1Candles);

        const h1Classified =
          classifySwings(h1Swings);

        const h1Structure =
          determineStructure(h1Classified);

        const h1Latest =
          h1Candles[h1Candles.length - 1];

        // ------------------------------------------
        // DETERMINE TECHNICAL CONTEXT
        // ------------------------------------------

        let context = "NEUTRAL";

        if (h4Structure === "BULLISH") {
          context = "BULLISH";
        } else if (h4Structure === "BEARISH") {
          context = "BEARISH";
        }

        // If H4 is neutral, a fresh H4 BOS can
        // provide a possible transition context.
        const h4BOS =
          findLatestBOS(
            h4Candles,
            h4Swings
          );

        if (
          context === "NEUTRAL" &&
          h4BOS.direction === "BULLISH"
        ) {
          context = "BULLISH_TRANSITION";
        }

        if (
          context === "NEUTRAL" &&
          h4BOS.direction === "BEARISH"
        ) {
          context = "BEARISH_TRANSITION";
        }

        // ------------------------------------------
        // H1 RETRACEMENT
        // ------------------------------------------

        const retracementDirection =
          context.includes("BULLISH")
            ? "BULLISH"
            : context.includes("BEARISH")
              ? "BEARISH"
              : "NEUTRAL";

        const h1Retracement =
          retracementDirection === "NEUTRAL"
            ? {
                present: false,
                type: "NONE",
                description:
                  "H4 context is neutral, so directional H1 retracement confirmation is not active."
              }
            : detectRetracement(
                h1Candles,
                h1Swings,
                retracementDirection
              );

        // ------------------------------------------
        // H1 BOS CONFIRMATION
        // ------------------------------------------

        const h1BOS =
          retracementDirection === "NEUTRAL"
            ? {
                confirmed: false,
                direction: "NONE",
                level: null,
                datetime: null,
                close: null
              }
            : findRecentConfirmationBOS(
                h1Candles,
                h1Swings,
                retracementDirection
              );

        // ------------------------------------------
        // H4 ZONE / SUPPORT-RESISTANCE GATE
        // ------------------------------------------

        const zoneTolerance =
          h4AverageRange * 0.50;

        let zoneGate = false;
        let zoneType = "NONE";
        let activeZone = null;

        if (retracementDirection === "BULLISH") {

          if (
            h4Demand &&
            priceNearZone(
              h4Latest.close,
              h4Demand,
              zoneTolerance
            )
          ) {
            zoneGate = true;
            zoneType = "DEMAND";
            activeZone = h4Demand;
          } else if (
            h4Support &&
            Math.abs(
              h4Latest.close -
              h4Support.price
            ) <= zoneTolerance
          ) {
            zoneGate = true;
            zoneType = "SUPPORT";
            activeZone = {
              type: "SUPPORT",
              price: h4Support.price,
              datetime: h4Support.datetime
            };
          }
        }

        if (retracementDirection === "BEARISH") {

          if (
            h4Supply &&
            priceNearZone(
              h4Latest.close,
              h4Supply,
              zoneTolerance
            )
          ) {
            zoneGate = true;
            zoneType = "SUPPLY";
            activeZone = h4Supply;
          } else if (
            h4Resistance &&
            Math.abs(
              h4Latest.close -
              h4Resistance.price
            ) <= zoneTolerance
          ) {
            zoneGate = true;
            zoneType = "RESISTANCE";
            activeZone = {
              type: "RESISTANCE",
              price: h4Resistance.price,
              datetime: h4Resistance.datetime
            };
          }
        }

        // ------------------------------------------
        // FINAL TECHNICAL GATES
        // ------------------------------------------

        const structureGate =
          retracementDirection === "BULLISH"
            ? (
                h4Structure === "BULLISH" ||
                h4Structure === "BULLISH_TRANSITION" ||
                context === "BULLISH_TRANSITION"
              )
            : retracementDirection === "BEARISH"
              ? (
                  h4Structure === "BEARISH" ||
                  h4Structure === "BEARISH_TRANSITION" ||
                  context === "BEARISH_TRANSITION"
                )
              : false;

        const retracementGate =
          h1Retracement.present;

        const h1StructureGate =
          retracementDirection === "BULLISH"
            ? (
                h1Structure === "BULLISH" ||
                h1BOS.direction === "BULLISH"
              )
            : retracementDirection === "BEARISH"
              ? (
                  h1Structure === "BEARISH" ||
                  h1BOS.direction === "BEARISH"
                )
              : false;

        const bosGate =
          h1BOS.confirmed &&
          h1BOS.direction === retracementDirection;

        const technicalConfirmed =
          structureGate &&
          zoneGate &&
          retracementGate &&
          h1StructureGate &&
          bosGate;

        // ------------------------------------------
        // TECHNICAL STATUS
        // ------------------------------------------

        let technicalStatus =
          "NOT_CONFIRMED";

        let direction =
          "NONE";

        if (technicalConfirmed) {

          if (retracementDirection === "BULLISH") {
            technicalStatus =
              "TECHNICAL_CONFIRMED";
            direction = "BULLISH";
          }

          if (retracementDirection === "BEARISH") {
            technicalStatus =
              "TECHNICAL_CONFIRMED";
            direction = "BEARISH";
          }

        } else {

          if (
            retracementDirection === "BULLISH"
          ) {
            direction = "BULLISH_SETUP";
          }

          if (
            retracementDirection === "BEARISH"
          ) {
            direction = "BEARISH_SETUP";
          }
        }

        // ------------------------------------------
        // REASONS
        // ------------------------------------------

        const reasons = [];

        if (!structureGate) {
          reasons.push(
            "H4 directional structure gate is not confirmed."
          );
        } else {
          reasons.push(
            `H4 context: ${context}.`
          );
        }

        if (!zoneGate) {
          reasons.push(
            "Price is not currently confirmed at a qualifying H4 supply/demand or nearby support/resistance zone."
          );
        } else {
          reasons.push(
            `H4 location gate confirmed using ${zoneType}.`
          );
        }

        if (!retracementGate) {
          reasons.push(
            "Required H1 retracement/pullback is not clearly detected."
          );
        } else {
          reasons.push(
            `H1 retracement detected: ${h1Retracement.type}.`
          );
        }

        if (!h1StructureGate) {
          reasons.push(
            "H1 directional structure is not yet aligned."
          );
        } else {
          reasons.push(
            `H1 structure/context: ${h1Structure}.`
          );
        }

        if (!bosGate) {
          reasons.push(
            "Required H1 candle-close break of structure has not been confirmed."
          );
        } else {
          reasons.push(
            `H1 ${h1BOS.direction} BOS confirmed by candle close.`
          );
        }

        if (technicalConfirmed) {
          reasons.push(
            "All core technical gates are satisfied."
          );
        } else {
          reasons.push(
            "Technical confirmation is incomplete; no trade action is generated."
          );
        }

        // ------------------------------------------
        // COMPATIBILITY TECHNICAL VALUE
        // ------------------------------------------

        let technicalValue = 0;

        if (
          technicalConfirmed &&
          direction === "BULLISH"
        ) {
          technicalValue = 2;
        }

        if (
          technicalConfirmed &&
          direction === "BEARISH"
        ) {
          technicalValue = -2;
        }

        // ------------------------------------------
        // RETURN
        // ------------------------------------------

        return Response.json({

          success: true,

          provider: "Twelve Data",

          pair: symbol,

          technical_status: technicalStatus,

          direction,

          technical_value: technicalValue,

          latest: {
            h4: h4Latest,
            h1: h1Latest
          },

          h4: {

            timeframe: "H4",

            candle_count:
              h4Candles.length,

            market_structure: {
              direction: h4Structure,
              context
            },

            swing_points: {
              highs:
                h4Classified.highs.slice(-10),

              lows:
                h4Classified.lows.slice(-10)
            },

            break_of_structure: h4BOS,

            zones: {
              demand:
                h4Zones.demand.slice(-5),

              supply:
                h4Zones.supply.slice(-5)
            },

            support: h4Support,

            resistance: h4Resistance,

            average_range:
              Number(
                h4AverageRange.toFixed(5)
              )
          },

          h1: {

            timeframe: "H1",

            candle_count:
              h1Candles.length,

            market_structure: {
              direction: h1Structure
            },

            swing_points: {
              highs:
                h1Classified.highs.slice(-10),

              lows:
                h1Classified.lows.slice(-10)
            },

            retracement:
              h1Retracement,

            break_of_structure:
              h1BOS
          },

          gates: {

            h4_structure:
              structureGate,

            h4_location:
              zoneGate,

            h4_location_type:
              zoneType,

            active_zone:
              activeZone,

            h1_retracement:
              retracementGate,

            h1_structure:
              h1StructureGate,

            h1_bos:
              bosGate,

            all_required_gates:
              technicalConfirmed
          },

          reasons,

          methodology: {

            timeframe_sequence:
              "H4 context -> H1 retracement -> H1 structure break -> technical confirmation.",

            swing:
              "Swing high/low requires two candles on the left and two candles on the right.",

            bos:
              "BOS requires a candle close beyond the relevant swing level. A wick alone does not confirm BOS.",

            h4_structure:
              "H4 is the primary technical context timeframe.",

            location:
              "Confirmation should occur near a qualifying H4 supply/demand zone or nearby H4 support/resistance.",

            retracement:
              "H1 should show a controlled pullback or sideways retracement rather than an uncontrolled move against the H4 context.",

            h1_confirmation:
              "The H1 candle must close beyond the relevant H1 swing level in the direction of the H4 context.",

            final_gate:
              "Technical confirmation requires all core gates. One strong condition cannot compensate for a missing critical condition.",

            indicators:
              "No RSI, moving averages or other indicator-based signal is used.",

            trade_signal:
              "This endpoint provides technical confirmation only. It does not independently create a final BUY or SELL trading decision."
          },

          framework: [
            "Macro fundamentals",
            "Fundamental differential",
            "Price divergence",
            "H4 market structure",
            "H4 supply/demand",
            "H4 support/resistance",
            "H1 retracement",
            "H1 structure",
            "H1 BOS",
            "Technical confirmation",
            "Rule-based action"
          ]

        });

      } catch (error) {

        return Response.json({

          success: false,

          provider: "Twelve Data",

          pair: symbol,

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
