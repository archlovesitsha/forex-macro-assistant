export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // ============================================================
    // LIVE FX RATE — ALPHA VANTAGE
    // ============================================================
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

    // ============================================================
    // FRED ECONOMIC DATA
    // ============================================================
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

      const limit = Number(url.searchParams.get("limit") || 10);

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

    // ============================================================
    // USD MACRO FUNDAMENTAL ENGINE
    // ============================================================
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

        if (changes.interest >= 0.25) interestScore = 2;
        else if (changes.interest > 0) interestScore = 1;
        else if (changes.interest <= -0.25) interestScore = -2;
        else if (changes.interest < 0) interestScore = -1;

        if (changes.growth >= 100) growthScore = 2;
        else if (changes.growth > 0) growthScore = 1;
        else if (changes.growth <= -100) growthScore = -2;
        else if (changes.growth < 0) growthScore = -1;

        if (changes.employment <= -0.2) employmentScore = 2;
        else if (changes.employment < 0) employmentScore = 1;
        else if (changes.employment >= 0.2) employmentScore = -2;
        else if (changes.employment > 0) employmentScore = -1;

        inflationScore = 0;

        if (changes.liquidity <= -10000) liquidityScore = 1;
        else if (changes.liquidity >= 10000) liquidityScore = -1;

        const totalScore =
          interestScore +
          growthScore +
          employmentScore +
          inflationScore +
          liquidityScore;

        let regime = "NEUTRAL";

        if (totalScore >= 5) regime = "STRONG";
        else if (totalScore >= 2) regime = "POSITIVE";
        else if (totalScore <= -5) regime = "WEAK";
        else if (totalScore <= -2) regime = "NEGATIVE";

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

    // ============================================================
    // EUR MACRO FUNDAMENTAL ENGINE
    // ============================================================
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

        if (changes.interest >= 0.25) interestScore = 2;
        else if (changes.interest > 0) interestScore = 1;
        else if (changes.interest <= -0.25) interestScore = -2;
        else if (changes.interest < 0) interestScore = -1;

        if (changes.growth >= 10000) growthScore = 2;
        else if (changes.growth > 0) growthScore = 1;
        else if (changes.growth <= -10000) growthScore = -2;
        else if (changes.growth < 0) growthScore = -1;

        inflationScore = 0;

        const totalScore =
          interestScore +
          inflationScore +
          growthScore;

        let regime = "NEUTRAL";

        if (totalScore >= 4) regime = "STRONG";
        else if (totalScore >= 2) regime = "POSITIVE";
        else if (totalScore <= -4) regime = "WEAK";
        else if (totalScore <= -2) regime = "NEGATIVE";

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

    // ============================================================
    // EUR/USD PAIR ANALYSIS ENGINE
    // ============================================================
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
        const eurRaw = {};
        const usdRaw = {};

        for (const [factor, series] of Object.entries(eurSeries)) {
          eurRaw[factor] = await getPairFredSeries(series);
        }

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
        let eurGrowthScore = 0;

        if (eurChanges.interest >= 0.25) eurInterestScore = 2;
        else if (eurChanges.interest > 0) eurInterestScore = 1;
        else if (eurChanges.interest <= -0.25) eurInterestScore = -2;
        else if (eurChanges.interest < 0) eurInterestScore = -1;

        if (eurChanges.growth >= 10000) eurGrowthScore = 2;
        else if (eurChanges.growth > 0) eurGrowthScore = 1;
        else if (eurChanges.growth <= -10000) eurGrowthScore = -2;
        else if (eurChanges.growth < 0) eurGrowthScore = -1;

        const eurScore =
          eurInterestScore +
          eurGrowthScore;

        let usdInterestScore = 0;
        let usdGrowthScore = 0;
        let usdEmploymentScore = 0;
        let usdLiquidityScore = 0;

        if (usdChanges.interest >= 0.25) usdInterestScore = 2;
        else if (usdChanges.interest > 0) usdInterestScore = 1;
        else if (usdChanges.interest <= -0.25) usdInterestScore = -2;
        else if (usdChanges.interest < 0) usdInterestScore = -1;

        if (usdChanges.growth >= 100) usdGrowthScore = 2;
        else if (usdChanges.growth > 0) usdGrowthScore = 1;
        else if (usdChanges.growth <= -100) usdGrowthScore = -2;
        else if (usdChanges.growth < 0) usdGrowthScore = -1;

        if (usdChanges.employment <= -0.2) usdEmploymentScore = 2;
        else if (usdChanges.employment < 0) usdEmploymentScore = 1;
        else if (usdChanges.employment >= 0.2) usdEmploymentScore = -2;
        else if (usdChanges.employment > 0) usdEmploymentScore = -1;

        if (usdChanges.liquidity <= -10000) usdLiquidityScore = 1;
        else if (usdChanges.liquidity >= 10000) usdLiquidityScore = -1;

        const usdScore =
          usdInterestScore +
          usdGrowthScore +
          usdEmploymentScore +
          usdLiquidityScore;

        const differential =
          eurScore - usdScore;

        let bias = "NEUTRAL";

        if (differential > 0) bias = "EUR/USD POSITIVE";
        else if (differential < 0) bias = "EUR/USD NEGATIVE";

        let eurRegime = "NEUTRAL";

        if (eurScore >= 4) eurRegime = "STRONG";
        else if (eurScore >= 2) eurRegime = "POSITIVE";
        else if (eurScore <= -4) eurRegime = "WEAK";
        else if (eurScore <= -2) eurRegime = "NEGATIVE";

        let usdRegime = "NEUTRAL";

        if (usdScore >= 5) usdRegime = "STRONG";
        else if (usdScore >= 2) usdRegime = "POSITIVE";
        else if (usdScore <= -5) usdRegime = "WEAK";
        else if (usdScore <= -2) usdRegime = "NEGATIVE";

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
              inflation: 0,
              growth: eurGrowthScore
            }
          },

          usd: {
            score: usdScore,
            regime: usdRegime,
            changes: usdChanges,
            scores: {
              interest: usdInterestScore,
              inflation: 0,
              growth: usdGrowthScore,
              employment: usdEmploymentScore,
              liquidity: usdLiquidityScore
            }
          },

          differential,
          bias,

          explanation:
            `EUR score (${eurScore}) - USD score (${usdScore}) = differential (${differential})`,

          next_stage: "Price divergence",

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

    // ============================================================
    // PRICE DIVERGENCE ENGINE
    // ============================================================
    if (url.pathname === "/api/price-divergence") {
      const pair =
        (url.searchParams.get("pair") || "EUR/USD").toUpperCase();

      const fromDate =
        url.searchParams.get("from") || "2026-09-01";

      const toDate =
        url.searchParams.get("to") || "2026-09-18";

      if (pair !== "EUR/USD") {
        return Response.json({
          success: false,
          pair,
          provider: "Frankfurter",
          error: "Price divergence currently supports EUR/USD only."
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
          throw new Error("Invalid EUR/USD price data returned.");
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

        for (const [factor, series] of Object.entries(eurSeries)) {
          eurRaw[factor] =
            await getFredSeries(series);
        }

        for (const [factor, series] of Object.entries(usdSeries)) {
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

        if (eurChanges.interest >= 0.25) eurInterestScore = 2;
        else if (eurChanges.interest > 0) eurInterestScore = 1;
        else if (eurChanges.interest <= -0.25) eurInterestScore = -2;
        else if (eurChanges.interest < 0) eurInterestScore = -1;

        if (eurChanges.growth >= 10000) eurGrowthScore = 2;
        else if (eurChanges.growth > 0) eurGrowthScore = 1;
        else if (eurChanges.growth <= -10000) eurGrowthScore = -2;
        else if (eurChanges.growth < 0) eurGrowthScore = -1;

        const eurScore =
          eurInterestScore +
          eurGrowthScore;

        let usdInterestScore = 0;
        let usdGrowthScore = 0;
        let usdEmploymentScore = 0;
        let usdLiquidityScore = 0;

        if (usdChanges.interest >= 0.25) usdInterestScore = 2;
        else if (usdChanges.interest > 0) usdInterestScore = 1;
        else if (usdChanges.interest <= -0.25) usdInterestScore = -2;
        else if (usdChanges.interest < 0) usdInterestScore = -1;

        if (usdChanges.growth >= 100) usdGrowthScore = 2;
        else if (usdChanges.growth > 0) usdGrowthScore = 1;
        else if (usdChanges.growth <= -100) usdGrowthScore = -2;
        else if (usdChanges.growth < 0) usdGrowthScore = -1;

        if (usdChanges.employment <= -0.2) usdEmploymentScore = 2;
        else if (usdChanges.employment < 0) usdEmploymentScore = 1;
        else if (usdChanges.employment >= 0.2) usdEmploymentScore = -2;
        else if (usdChanges.employment > 0) usdEmploymentScore = -1;

        if (usdChanges.liquidity <= -10000) usdLiquidityScore = 1;
        else if (usdChanges.liquidity >= 10000) usdLiquidityScore = -1;

        const usdScore =
          usdInterestScore +
          usdGrowthScore +
          usdEmploymentScore +
          usdLiquidityScore;

        const differential =
          eurScore - usdScore;

        let fundamentalDirection = "FLAT";

        if (differential > 0) fundamentalDirection = "UP";
        else if (differential < 0) fundamentalDirection = "DOWN";

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
              Number(
                priceChangePercent.toFixed(4)
              ),
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

    // ============================================================
    // FUNDAMENTAL SCORING ENGINE
    // ============================================================
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
            url.searchParams.get(
              `${currency}_interest`
            ) || 0
          );

        const inflation =
          Number(
            url.searchParams.get(
              `${currency}_inflation`
            ) || 0
          );

        const growth =
          Number(
            url.searchParams.get(
              `${currency}_growth`
            ) || 0
          );

        const employment =
          Number(
            url.searchParams.get(
              `${currency}_employment`
            ) || 0
          );

        const centralBank =
          Number(
            url.searchParams.get(
              `${currency}_centralbank`
            ) || 0
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
          interest: "Interest-rate direction",
          inflation: "Inflation trend",
          growth: "Economic growth",
          employment: "Labour-market conditions",
          centralBank: "Central-bank stance"
        }
      });
    }

    // ============================================================
    // MACRO ANALYSIS ENGINE
    // ============================================================
    if (url.pathname === "/api/analyse") {
      const pair =
        (url.searchParams.get("pair") || "EUR/USD").toUpperCase();

      const base =
        Number(
          url.searchParams.get("base") || 0
        );

      const quote =
        Number(
          url.searchParams.get("quote") || 0
        );

      const technical =
        Number(
          url.searchParams.get("technical") || 0
        );

      const divergence =
        url.searchParams.get("divergence") === "true";

      const differential =
        base - quote;

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

    // ============================================================
    // H4 TECHNICAL ANALYSIS ENGINE
    // ============================================================
    if (url.pathname === "/api/technical-analysis") {
      if (!env.TWELVE_DATA_API_KEY) {
        return Response.json({
          success: false,
          provider: "Twelve Data",
          error:
            "TWELVE_DATA_API_KEY is not configured."
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
        `&apikey=${encodeURIComponent(
          env.TWELVE_DATA_API_KEY
        )}`;

      try {
        const response =
          await fetch(apiUrl);

        const data =
          await response.json();

        if (
          !response.ok ||
          data.status === "error"
        ) {
          return Response.json({
            success: false,
            provider: "Twelve Data",
            interval,
            error:
              data.message ||
              `HTTP ${response.status}`
          });
        }

        let candles =
          (data.values || [])
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
            candle_count:
              candles.length
          });
        }

        const analysisCandles =
          candles.length > 3
            ? candles.slice(0, -1)
            : candles;

        const swingHighs = [];
        const swingLows = [];

        for (
          let i = 2;
          i < analysisCandles.length - 2;
          i++
        ) {
          const current =
            analysisCandles[i];

          const isSwingHigh =
            current.high >
              analysisCandles[i - 1].high &&
            current.high >
              analysisCandles[i - 2].high &&
            current.high >
              analysisCandles[i + 1].high &&
            current.high >
              analysisCandles[i + 2].high;

          const isSwingLow =
            current.low <
              analysisCandles[i - 1].low &&
            current.low <
              analysisCandles[i - 2].low &&
            current.low <
              analysisCandles[i + 1].low &&
            current.low <
              analysisCandles[i + 2].low;

          if (isSwingHigh) {
            swingHighs.push({
              index: i,
              datetime:
                current.datetime,
              price: current.high
            });
          }

          if (isSwingLow) {
            swingLows.push({
              index: i,
              datetime:
                current.datetime,
              price: current.low
            });
          }
        }

        function classify(list, high) {
          return list.map(
            (current, i) => {
              if (i === 0) {
                return {
                  ...current,
                  type: "FIRST"
                };
              }

              const previous =
                list[i - 1];

              let type =
                high
                  ? "EH"
                  : "EL";

              if (
                current.price >
                previous.price
              ) {
                type =
                  high
                    ? "HH"
                    : "HL";
              } else if (
                current.price <
                previous.price
              ) {
                type =
                  high
                    ? "LH"
                    : "LL";
              }

              return {
                ...current,
                type
              };
            }
          );
        }

        const classifiedHighs =
          classify(
            swingHighs,
            true
          );

        const classifiedLows =
          classify(
            swingLows,
            false
          );

        function determineStructure() {
          if (
            swingHighs.length < 2 ||
            swingLows.length < 2
          ) {
            return "NEUTRAL";
          }

          const previousHigh =
            swingHighs[
              swingHighs.length - 2
            ];

          const latestHigh =
            swingHighs[
              swingHighs.length - 1
            ];

          const previousLow =
            swingLows[
              swingLows.length - 2
            ];

          const latestLow =
            swingLows[
              swingLows.length - 1
            ];

          const bullish =
            latestHigh.price >
              previousHigh.price &&
            latestLow.price >
              previousLow.price;

          const bearish =
            latestHigh.price <
              previousHigh.price &&
            latestLow.price <
              previousLow.price;

          if (bullish) return "BULLISH";
          if (bearish) return "BEARISH";

          return "TRANSITION";
        }

        const structure =
          determineStructure();

        const latestCandle =
          candles[candles.length - 1];

        const lastCompletedCandle =
          analysisCandles[
            analysisCandles.length - 1
          ];

        let bos = "NONE";
        let bosLevel = null;
        let bosDatetime = null;

        if (swingHighs.length) {
          const lastHigh =
            swingHighs[
              swingHighs.length - 1
            ];

          if (
            lastCompletedCandle.close >
            lastHigh.price
          ) {
            bos = "BULLISH";
            bosLevel =
              lastHigh.price;
            bosDatetime =
              lastCompletedCandle.datetime;
          }
        }

        if (swingLows.length) {
          const lastLow =
            swingLows[
              swingLows.length - 1
            ];

          if (
            lastCompletedCandle.close <
            lastLow.price
          ) {
            bos = "BEARISH";
            bosLevel =
              lastLow.price;
            bosDatetime =
              lastCompletedCandle.datetime;
          }
        }

        const recentCandles =
          analysisCandles.slice(-20);

        const averageRange =
          recentCandles.reduce(
            (sum, candle) =>
              sum +
              candle.high -
              candle.low,
            0
          ) /
          recentCandles.length;

        function detectZones() {
          const demand = [];
          const supply = [];

          for (
            let baseLength = 1;
            baseLength <= 4;
            baseLength++
          ) {
            for (
              let i = baseLength;
              i <
                analysisCandles.length - 1;
              i++
            ) {
              const base =
                analysisCandles.slice(
                  i -
                    baseLength +
                    1,
                  i + 1
                );

              const baseHigh =
                Math.max(
                  ...base.map(
                    c => c.high
                  )
                );

              const baseLow =
                Math.min(
                  ...base.map(
                    c => c.low
                  )
                );

              const baseRange =
                baseHigh - baseLow;

              if (
                baseRange <= 0
              ) {
                continue;
              }

              const departure =
                analysisCandles[
                  i + 1
                ];

              const bullishMove =
                departure.close -
                baseHigh;

              const bearishMove =
                baseLow -
                departure.close;

              const compact =
                baseRange <=
                averageRange * 1.5;

              if (
                compact &&
                bullishMove >=
                  averageRange * 1.5
              ) {
                demand.push({
                  type: "DEMAND",
                  from: baseLow,
                  to: baseHigh,
                  createdAt:
                    base[0].datetime,
                  departureAt:
                    departure.datetime,
                  departure:
                    Number(
                      bullishMove.toFixed(
                        5
                      )
                    ),
                  baseCandles:
                    baseLength,
                  strength:
                    "CANDIDATE"
                });
              }

              if (
                compact &&
                bearishMove >=
                  averageRange * 1.5
              ) {
                supply.push({
                  type: "SUPPLY",
                  from: baseLow,
                  to: baseHigh,
                  createdAt:
                    base[0].datetime,
                  departureAt:
                    departure.datetime,
                  departure:
                    Number(
                      bearishMove.toFixed(
                        5
                      )
                    ),
                  baseCandles:
                    baseLength,
                  strength:
                    "CANDIDATE"
                });
              }
            }
          }

          return {
            demand:
              demand.slice(-10),
            supply:
              supply.slice(-10)
          };
        }

        const zones =
          detectZones();

        const support =
          swingLows
            .slice(-5)
            .map(x => ({
              price: x.price,
              datetime:
                x.datetime,
              timeframe: "H4"
            }));

        const resistance =
          swingHighs
            .slice(-5)
            .map(x => ({
              price: x.price,
              datetime:
                x.datetime,
              timeframe: "H4"
            }));

        let technicalStatus =
          "NOT_CONFIRMED";

        if (
          structure ===
            "BULLISH" &&
          bos === "BULLISH"
        ) {
          technicalStatus =
            "BULLISH_STRUCTURE";
        } else if (
          structure ===
            "BEARISH" &&
          bos === "BEARISH"
        ) {
          technicalStatus =
            "BEARISH_STRUCTURE";
        } else if (
          structure ===
          "TRANSITION"
        ) {
          technicalStatus =
            "TRANSITION";
        }

        return Response.json({
          success: true,
          provider:
            "Twelve Data",
          pair: "EUR/USD",
          timeframe: "H4",
          candle_count:
            candles.length,
          latest:
            latestCandle,
          last_completed_candle:
            lastCompletedCandle,

          market_structure: {
            direction:
              structure,
            bullish:
              structure ===
              "BULLISH",
            bearish:
              structure ===
              "BEARISH"
          },

          swing_points: {
            highs:
              classifiedHighs.slice(
                -10
              ),
            lows:
              classifiedLows.slice(
                -10
              )
          },

          break_of_structure: {
            direction: bos,
            level: bosLevel,
            datetime:
              bosDatetime
          },

          zones: {
            demand:
              zones.demand.slice(
                -5
              ),
            supply:
              zones.supply.slice(
                -5
              )
          },

          support,
          resistance,

          volatility: {
            averageRange:
              Number(
                averageRange.toFixed(
                  5
                )
              )
          },

          technical_status:
            technicalStatus,

          methodology: {
            swing:
              "Swing high/low requires two candles on the left and two candles on the right.",

            structure:
              "Bullish structure requires the latest swing high and swing low to both be higher than their previous counterparts. Bearish structure requires both to be lower. Otherwise structure is TRANSITION.",

            bos:
              "BOS requires a completed candle close beyond the relevant swing level. A wick alone does not confirm BOS.",

            demand:
              "Demand candidates use 1 to 4 compact base candles followed by a bullish departure of at least 1.5 times recent average H4 range.",

            supply:
              "Supply candidates use 1 to 4 compact base candles followed by a bearish departure of at least 1.5 times recent average H4 range.",

            confirmation:
              "H4 analysis describes market structure and location. It does not independently create a BUY or SELL signal."
          }
        });

      } catch (error) {
        return Response.json({
          success: false,
          provider:
            "Twelve Data",
          pair: "EUR/USD",
          interval: "4h",
          error:
            error.message
        });
      }
    }

    // ============================================================
    // H1 TECHNICAL CONFIRMATION ENGINE
    // H4 CONTEXT → H1 RETRACEMENT → H1 BOS
    // ============================================================
    if (
      url.pathname ===
      "/api/technical-confirmation"
    ) {
      if (!env.TWELVE_DATA_API_KEY) {
        return Response.json({
          success: false,
          provider:
            "Twelve Data",
          error:
            "TWELVE_DATA_API_KEY is not configured."
        });
      }

      const symbol =
        "EUR/USD";

      const outputsize =
        100;

      async function getCandles(
        interval
      ) {
        const apiUrl =
          `https://api.twelvedata.com/time_series` +
          `?symbol=EUR%2FUSD` +
          `&interval=${interval}` +
          `&outputsize=${outputsize}` +
          `&timezone=UTC` +
          `&apikey=${encodeURIComponent(
            env.TWELVE_DATA_API_KEY
          )}`;

        const response =
          await fetch(apiUrl);

        const data =
          await response.json();

        if (
          !response.ok ||
          data.status ===
            "error"
        ) {
          throw new Error(
            data.message ||
              `Twelve Data ${interval} request failed: HTTP ${response.status}`
          );
        }

        return (
          data.values || []
        )
          .map(c => ({
            datetime:
              c.datetime,
            open: Number(
              c.open
            ),
            high: Number(
              c.high
            ),
            low: Number(
              c.low
            ),
            close: Number(
              c.close
            )
          }))
          .filter(c =>
            Number.isFinite(
              c.open
            ) &&
            Number.isFinite(
              c.high
            ) &&
            Number.isFinite(
              c.low
            ) &&
            Number.isFinite(
              c.close
            )
          )
          .reverse();
      }

      function findSwings(
        candles
      ) {
        const highs = [];
        const lows = [];

        for (
          let i = 2;
          i <
            candles.length - 2;
          i++
        ) {
          const c =
            candles[i];

          const isHigh =
            c.high >
              candles[i - 1]
                .high &&
            c.high >
              candles[i - 2]
                .high &&
            c.high >
              candles[i + 1]
                .high &&
            c.high >
              candles[i + 2]
                .high;

          const isLow =
            c.low <
              candles[i - 1]
                .low &&
            c.low <
              candles[i - 2]
                .low &&
            c.low <
              candles[i + 1]
                .low &&
            c.low <
              candles[i + 2]
                .low;

          if (isHigh) {
            highs.push({
              index: i,
              datetime:
                c.datetime,
              price:
                c.high
            });
          }

          if (isLow) {
            lows.push({
              index: i,
              datetime:
                c.datetime,
              price:
                c.low
            });
          }
        }

        return {
          highs,
          lows
        };
      }

      function classifySwings(
        swings
      ) {
        const highs = [];
        const lows = [];

        for (
          let i = 0;
          i <
            swings.highs.length;
          i++
        ) {
          const current =
            swings.highs[i];

          let type =
            "FIRST";

          if (i > 0) {
            const previous =
              swings.highs[
                i - 1
              ];

            if (
              current.price >
              previous.price
            ) {
              type = "HH";
            } else if (
              current.price <
              previous.price
            ) {
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

        for (
          let i = 0;
          i <
            swings.lows.length;
          i++
        ) {
          const current =
            swings.lows[i];

          let type =
            "FIRST";

          if (i > 0) {
            const previous =
              swings.lows[
                i - 1
              ];

            if (
              current.price >
              previous.price
            ) {
              type = "HL";
            } else if (
              current.price <
              previous.price
            ) {
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

      function determineStructure(
        swings
      ) {
        if (
          swings.highs.length <
            2 ||
          swings.lows.length <
            2
        ) {
          return "NEUTRAL";
        }

        const previousHigh =
          swings.highs[
            swings.highs.length - 2
          ];

        const latestHigh =
          swings.highs[
            swings.highs.length - 1
          ];

        const previousLow =
          swings.lows[
            swings.lows.length - 2
          ];

        const latestLow =
          swings.lows[
            swings.lows.length - 1
          ];

        const bullish =
          latestHigh.price >
            previousHigh.price &&
          latestLow.price >
            previousLow.price;

        const bearish =
          latestHigh.price <
            previousHigh.price &&
          latestLow.price <
            previousLow.price;

        if (bullish)
          return "BULLISH";

        if (bearish)
          return "BEARISH";

        return "NEUTRAL";
      }

      function findLatestBOS(
        candles,
        swings
      ) {
        if (
          candles.length < 10
        ) {
          return {
            direction:
              "NONE",
            level: null,
            datetime: null,
            close: null
          };
        }

        const completed =
          candles.slice(0, -1);

        let latestEvent =
          null;

        for (
          let i = 0;
          i <
            completed.length;
          i++
        ) {
          const candle =
            completed[i];

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
              ? priorHighs[
                  priorHighs.length -
                    1
                ]
              : null;

          const lastLow =
            priorLows.length
              ? priorLows[
                  priorLows.length -
                    1
                ]
              : null;

          if (
            lastHigh &&
            candle.close >
              lastHigh.price
          ) {
            latestEvent = {
              direction:
                "BULLISH",
              level:
                lastHigh.price,
              datetime:
                candle.datetime,
              close:
                candle.close,
              index: i
            };
          }

          if (
            lastLow &&
            candle.close <
              lastLow.price
          ) {
            latestEvent = {
              direction:
                "BEARISH",
              level:
                lastLow.price,
              datetime:
                candle.datetime,
              close:
                candle.close,
              index: i
            };
          }
        }

        return (
          latestEvent || {
            direction:
              "NONE",
            level: null,
            datetime: null,
            close: null
          }
        );
      }

      function averageRange(
        candles,
        lookback = 20
      ) {
        const selected =
          candles.slice(
            -lookback
          );

        if (
          !selected.length
        ) {
          return 0;
        }

        return (
          selected.reduce(
            (sum, candle) =>
              sum +
              candle.high -
              candle.low,
            0
          ) /
          selected.length
        );
      }

      function detectZones(
        candles,
        avgRange
      ) {
        const demand = [];
        const supply = [];

        for (
          let length = 1;
          length <= 4;
          length++
        ) {
          for (
            let i = length;
            i <
              candles.length - 1;
            i++
          ) {
            const base =
              candles.slice(
                i -
                  length +
                  1,
                i + 1
              );

            const baseHigh =
              Math.max(
                ...base.map(
                  c => c.high
                )
              );

            const baseLow =
              Math.min(
                ...base.map(
                  c => c.low
                )
              );

            const baseRange =
              baseHigh -
              baseLow;

            if (
              baseRange <= 0
            ) {
              continue;
            }

            const departure =
              candles[i + 1];

            const bullishMove =
              departure.close -
              baseHigh;

            const bearishMove =
              baseLow -
              departure.close;

            const compact =
              baseRange <=
              avgRange * 1.5;

            if (
              compact &&
              bullishMove >=
                avgRange * 1.5
            ) {
              demand.push({
                type:
                  "DEMAND",
                from:
                  baseLow,
                to:
                  baseHigh,
                createdAt:
                  base[0]
                    .datetime,
                departureAt:
                  departure.datetime,
                departure:
                  Number(
                    bullishMove.toFixed(
                      5
                    )
                  ),
                baseCandles:
                  length,
                strength:
                  "CANDIDATE"
              });
            }

            if (
              compact &&
              bearishMove >=
                avgRange * 1.5
            ) {
              supply.push({
                type:
                  "SUPPLY",
                from:
                  baseLow,
                to:
                  baseHigh,
                createdAt:
                  base[0]
                    .datetime,
                departureAt:
                  departure.datetime,
                departure:
                  Number(
                    bearishMove.toFixed(
                      5
                    )
                  ),
                baseCandles:
                  length,
                strength:
                  "CANDIDATE"
              });
            }
          }
        }

        return {
          demand:
            demand.slice(-10),
          supply:
            supply.slice(-10)
        };
      }

      function nearestSupport(
        price,
        swings
      ) {
        const levels =
          swings.lows.filter(
            x =>
              x.price <= price
          );

        if (
          !levels.length
        ) {
          return null;
        }

        return levels.reduce(
          (
            nearest,
            current
          ) =>
            Math.abs(
              price -
                current.price
            ) <
            Math.abs(
              price -
                nearest.price
            )
              ? current
              : nearest
        );
      }

      function nearestResistance(
        price,
        swings
      ) {
        const levels =
          swings.highs.filter(
            x =>
              x.price >= price
          );

        if (
          !levels.length
        ) {
          return null;
        }

        return levels.reduce(
          (
            nearest,
            current
          ) =>
            Math.abs(
              price -
                current.price
            ) <
            Math.abs(
              price -
                nearest.price
            )
              ? current
              : nearest
        );
      }

      function nearZone(
        price,
        zone,
        tolerance
      ) {
        if (!zone)
          return false;

        return (
          price >=
            zone.from -
              tolerance &&
          price <=
            zone.to +
              tolerance
        );
      }

      // ==========================================================
      // IMPROVED H1 RETRACEMENT DETECTOR
      // ==========================================================
      function detectRetracement(
        candles,
        direction
      ) {
        const completed =
          candles.slice(0, -1);

        if (
          completed.length <
          20
        ) {
          return {
            present: false,
            type: "NONE",
            description:
              "Not enough completed H1 candles."
          };
        }

        const recent =
          completed.slice(-20);

        const ranges =
          recent.map(
            c =>
              c.high - c.low
          );

        const averageRange =
          ranges.reduce(
            (sum, value) =>
              sum + value,
            0
          ) /
          ranges.length;

        if (
          !Number.isFinite(
            averageRange
          ) ||
          averageRange <= 0
        ) {
          return {
            present: false,
            type: "NONE",
            description:
              "Unable to calculate H1 average range."
          };
        }

        // --------------------------------------------------------
        // BULLISH IMPULSE -> CONTROLLED PULLBACK
        // --------------------------------------------------------
        if (
          direction ===
          "BULLISH"
        ) {
          let bestCandidate =
            null;

          for (
            let highIndex = 6;
            highIndex <
              recent.length - 2;
            highIndex++
          ) {
            const impulseHigh =
              recent[
                highIndex
              ].high;

            const originWindow =
              recent.slice(
                Math.max(
                  0,
                  highIndex - 6
                ),
                highIndex
              );

            if (
              !originWindow.length
            ) {
              continue;
            }

            const originLow =
              Math.min(
                ...originWindow.map(
                  c => c.low
                )
              );

            const impulseSize =
              impulseHigh -
              originLow;

            if (
              impulseSize <
              averageRange * 1.5
            ) {
              continue;
            }

            const pullbackCandles =
              recent.slice(
                highIndex + 1
              );

            if (
              pullbackCandles.length <
              2
            ) {
              continue;
            }

            const pullbackLow =
              Math.min(
                ...pullbackCandles.map(
                  c => c.low
                )
              );

            const currentClose =
              recent[
                recent.length - 1
              ].close;

            const retracementSize =
              impulseHigh -
              pullbackLow;

            if (
              retracementSize <= 0
            ) {
              continue;
            }

            const retracementRatio =
              retracementSize /
              impulseSize;

            const controlled =
              retracementRatio >=
                0.15 &&
              retracementRatio <=
                0.65;

            const structureHeld =
              pullbackLow >
              originLow;

            const currentPosition =
              (currentClose -
                pullbackLow) /
              retracementSize;

            const pullbackStillRelevant =
              currentPosition >=
                0 &&
              currentPosition <=
                1.25;

            const bullishCandles =
              pullbackCandles.filter(
                c =>
                  c.close >
                  c.open
              ).length;

            const bearishCandles =
              pullbackCandles.filter(
                c =>
                  c.close <
                  c.open
              ).length;

            const actualPullback =
              bearishCandles >= 1 ||
              pullbackCandles.length <=
                3;

            if (
              controlled &&
              structureHeld &&
              pullbackStillRelevant &&
              actualPullback
            ) {
              bestCandidate = {
                impulseHigh,
                originLow,
                pullbackLow,
                impulseSize,
                retracementSize,
                retracementRatio,
                bullishCandles,
                bearishCandles
              };
            }
          }

          if (
            bestCandidate
          ) {
            return {
              present: true,
              type:
                "BULLISH_PULLBACK",
              description:
                "H1 shows a meaningful bullish impulse followed by a controlled pullback that has not broken the impulse origin.",
              details: {
                impulseHigh:
                  Number(
                    bestCandidate.impulseHigh.toFixed(
                      5
                    )
                  ),
                originLow:
                  Number(
                    bestCandidate.originLow.toFixed(
                      5
                    )
                  ),
                pullbackLow:
                  Number(
                    bestCandidate.pullbackLow.toFixed(
                      5
                    )
                  ),
                impulseSize:
                  Number(
                    bestCandidate.impulseSize.toFixed(
                      5
                    )
                  ),
                retracementSize:
                  Number(
                    bestCandidate.retracementSize.toFixed(
                      5
                    )
                  ),
                retracementPercent:
                  Number(
                    (
                      bestCandidate.retracementRatio *
                      100
                    ).toFixed(1)
                  )
              }
            };
          }
        }

        // --------------------------------------------------------
        // BEARISH IMPULSE -> CONTROLLED PULLBACK
        // --------------------------------------------------------
        if (
          direction ===
          "BEARISH"
        ) {
          let bestCandidate =
            null;

          for (
            let lowIndex = 6;
            lowIndex <
              recent.length - 2;
            lowIndex++
          ) {
            const impulseLow =
              recent[
                lowIndex
              ].low;

            const originWindow =
              recent.slice(
                Math.max(
                  0,
                  lowIndex - 6
                ),
                lowIndex
              );

            if (
              !originWindow.length
            ) {
              continue;
            }

            const originHigh =
              Math.max(
                ...originWindow.map(
                  c => c.high
                )
              );

            const impulseSize =
              originHigh -
              impulseLow;

            if (
              impulseSize <
              averageRange * 1.5
            ) {
              continue;
            }

            const pullbackCandles =
              recent.slice(
                lowIndex + 1
              );

            if (
              pullbackCandles.length <
              2
            ) {
              continue;
            }

            const pullbackHigh =
              Math.max(
                ...pullbackCandles.map(
                  c => c.high
                )
              );

            const currentClose =
              recent[
                recent.length - 1
              ].close;

            const retracementSize =
              pullbackHigh -
              impulseLow;

            if (
              retracementSize <= 0
            ) {
              continue;
            }

            const retracementRatio =
              retracementSize /
              impulseSize;

            const controlled =
              retracementRatio >=
                0.15 &&
              retracementRatio <=
                0.65;

            const structureHeld =
              pullbackHigh <
              originHigh;

            const currentPosition =
              (pullbackHigh -
                currentClose) /
              retracementSize;

            const pullbackStillRelevant =
              currentPosition >=
                0 &&
              currentPosition <=
                1.25;

            const bullishCandles =
              pullbackCandles.filter(
                c =>
                  c.close >
                  c.open
              ).length;

            const bearishCandles =
              pullbackCandles.filter(
                c =>
                  c.close <
                  c.open
              ).length;

            const actualPullback =
              bullishCandles >= 1 ||
              pullbackCandles.length <=
                3;

            if (
              controlled &&
              structureHeld &&
              pullbackStillRelevant &&
              actualPullback
            ) {
              bestCandidate = {
                impulseLow,
                originHigh,
                pullbackHigh,
                impulseSize,
                retracementSize,
                retracementRatio,
                bullishCandles,
                bearishCandles
              };
            }
          }

          if (
            bestCandidate
          ) {
            return {
              present: true,
              type:
                "BEARISH_PULLBACK",
              description:
                "H1 shows a meaningful bearish impulse followed by a controlled upward pullback that has not broken the impulse origin.",
              details: {
                impulseLow:
                  Number(
                    bestCandidate.impulseLow.toFixed(
                      5
                    )
                  ),
                originHigh:
                  Number(
                    bestCandidate.originHigh.toFixed(
                      5
                    )
                  ),
                pullbackHigh:
                  Number(
                    bestCandidate.pullbackHigh.toFixed(
                      5
                    )
                  ),
                impulseSize:
                  Number(
                    bestCandidate.impulseSize.toFixed(
                      5
                    )
                  ),
                retracementSize:
                  Number(
                    bestCandidate.retracementSize.toFixed(
                      5
                    )
                  ),
                retracementPercent:
                  Number(
                    (
                      bestCandidate.retracementRatio *
                      100
                    ).toFixed(1)
                  )
              }
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

      function findConfirmationBOS(
        candles,
        swings,
        direction
      ) {
        const completed =
          candles.slice(0, -1);

        const start =
          Math.max(
            0,
            completed.length - 15
          );

        let event = null;

        for (
          let i = start;
          i <
            completed.length;
          i++
        ) {
          const candle =
            completed[i];

          if (
            direction ===
            "BULLISH"
          ) {
            const priorHighs =
              swings.highs.filter(
                s => s.index < i
              );

            if (
              !priorHighs.length
            ) {
              continue;
            }

            const level =
              priorHighs[
                priorHighs.length - 1
              ];

            if (
              candle.close >
              level.price
            ) {
              event = {
                confirmed: true,
                direction:
                  "BULLISH",
                level:
                  level.price,
                datetime:
                  candle.datetime,
                close:
                  candle.close,
                index: i
              };
            }
          }

          if (
            direction ===
            "BEARISH"
          ) {
            const priorLows =
              swings.lows.filter(
                s => s.index < i
              );

            if (
              !priorLows.length
            ) {
              continue;
            }

            const level =
              priorLows[
                priorLows.length - 1
              ];

            if (
              candle.close <
              level.price
            ) {
              event = {
                confirmed: true,
                direction:
                  "BEARISH",
                level:
                  level.price,
                datetime:
                  candle.datetime,
                close:
                  candle.close,
                index: i
              };
            }
          }
        }

        return (
          event || {
            confirmed: false,
            direction:
              "NONE",
            level: null,
            datetime: null,
            close: null,
            index: null
          }
        );
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
            provider:
              "Twelve Data",
            pair: symbol,
            error:
              "Not enough H4/H1 candles for technical confirmation.",
            h4_candle_count:
              h4Candles.length,
            h1_candle_count:
              h1Candles.length
          });
        }

        // ========================================================
        // H4
        // ========================================================

        const h4Analysis =
          h4Candles.slice(0, -1);

        const h4Swings =
          findSwings(
            h4Analysis
          );

        const h4Classified =
          classifySwings(
            h4Swings
          );

        const h4Structure =
          determineStructure(
            h4Swings
          );

        const h4BOS =
          findLatestBOS(
            h4Candles,
            h4Swings
          );

        const h4AverageRange =
          averageRange(
            h4Analysis,
            20
          );

        const h4Zones =
          detectZones(
            h4Analysis,
            h4AverageRange
          );

        // IMPORTANT:
        // Use the LAST COMPLETED H4 candle
        // for location analysis.
        const h4Latest =
          h4Analysis[
            h4Analysis.length - 1
          ];

        const h4Support =
          nearestSupport(
            h4Latest.close,
            h4Swings
          );

        const h4Resistance =
          nearestResistance(
            h4Latest.close,
            h4Swings
          );

        // ========================================================
        // H1
        // ========================================================

        const h1Analysis =
          h1Candles.slice(0, -1);

        const h1Swings =
          findSwings(
            h1Analysis
          );

        const h1Classified =
          classifySwings(
            h1Swings
          );

        const h1Structure =
          determineStructure(
            h1Swings
          );

        const h1Latest =
          h1Candles[
            h1Candles.length - 1
          ];

        // ========================================================
        // H4 CONTEXT
        // ========================================================

        let context =
          "NEUTRAL";

        if (
          h4Structure ===
          "BULLISH"
        ) {
          context =
            "BULLISH";
        } else if (
          h4Structure ===
          "BEARISH"
        ) {
          context =
            "BEARISH";
        } else if (
          h4BOS.direction ===
          "BULLISH"
        ) {
          context =
            "BULLISH_TRANSITION";
        } else if (
          h4BOS.direction ===
          "BEARISH"
        ) {
          context =
            "BEARISH_TRANSITION";
        }

        const direction =
          context.includes(
            "BULLISH"
          )
            ? "BULLISH"
            : context.includes(
                "BEARISH"
              )
              ? "BEARISH"
              : "NONE";

        // ========================================================
        // H1 RETRACEMENT
        // ========================================================

        const h1Retracement =
          direction ===
          "NONE"
            ? {
                present: false,
                type: "NONE",
                description:
                  "H4 context is neutral."
              }
            : detectRetracement(
                h1Candles,
                direction
              );

        // ========================================================
        // H1 BOS
        // ========================================================

        const h1BOS =
          direction ===
          "NONE"
            ? {
                confirmed: false,
                direction:
                  "NONE",
                level: null,
                datetime: null,
                close: null,
                index: null
              }
            : findConfirmationBOS(
                h1Candles,
                h1Swings,
                direction
              );

        // ========================================================
        // IMPROVED H4 LOCATION GATE
        // ========================================================

        const tolerance =
          h4AverageRange * 0.50;

        let locationGate =
          false;

        let locationType =
          "NONE";

        let activeZone =
          null;

        // --------------------------------------------------------
        // CONTINUATION PARAMETERS
        // --------------------------------------------------------

        // A BOS older than this number of completed H4 candles
        // is not treated as a continuation setup.
        const continuationLookback =
          40;

        // Do not chase price after it has travelled too far
        // from the H4 BOS.
        //
        // Maximum continuation distance:
        // 4 average H4 ranges.
        const maxContinuationDistance =
          h4AverageRange * 4;

        const recentH4BOS =
          h4BOS &&
          h4BOS.direction ===
            direction &&
          h4BOS.index !== null &&
          h4BOS.index >=
            Math.max(
              0,
              h4Analysis.length -
                continuationLookback
            );

        // --------------------------------------------------------
        // CONTINUATION DIAGNOSTICS
        // --------------------------------------------------------

        let continuationDiagnostics = {
          eligible: false,
          reason:
            "No valid directional H4 BOS continuation candidate.",
          brokenLevel:
            h4BOS &&
            h4BOS.level !== null
              ? h4BOS.level
              : null,
          currentPrice:
            h4Latest.close,
          distanceFromBreak: null,
          maxContinuationDistance:
            Number(
              maxContinuationDistance.toFixed(
                5
              )
            ),
          distanceInAverageRanges:
            null,
          opposingLevel: null,
          opposingDistance: null,
          opposingDistanceInAverageRanges:
            null
        };

        // --------------------------------------------------------
        // CHECK WHETHER A RECENT H4 BOS EXISTS
        // --------------------------------------------------------

        if (!recentH4BOS) {
          continuationDiagnostics.reason =
            "No recent H4 BOS in the continuation lookback window.";
        }

        // ========================================================
        // BULLISH LOCATION
        // ========================================================

        if (
          direction ===
          "BULLISH"
        ) {
          // 1. DEMAND
          const demand =
            h4Zones.demand
              .slice()
              .reverse()
              .find(
                zone =>
                  nearZone(
                    h4Latest.close,
                    zone,
                    tolerance
                  )
              );

          if (demand) {
            locationGate =
              true;

            locationType =
              "DEMAND";

            activeZone =
              demand;
          }

          // 2. SUPPORT
          else if (
            h4Support &&
            Math.abs(
              h4Latest.close -
                h4Support.price
            ) <=
              tolerance
          ) {
            locationGate =
              true;

            locationType =
              "SUPPORT";

            activeZone = {
              type:
                "SUPPORT",
              price:
                h4Support.price,
              datetime:
                h4Support.datetime
            };
          }

          // 3. BULLISH CONTINUATION
          else if (
            recentH4BOS
          ) {
            const distanceFromBreak =
              h4Latest.close -
              h4BOS.level;

            const distanceInAverageRanges =
              h4AverageRange > 0
                ? distanceFromBreak /
                  h4AverageRange
                : null;

            const opposingLevel =
              h4Resistance
                ? h4Resistance.price
                : null;

            const opposingDistance =
              opposingLevel !== null
                ? opposingLevel -
                  h4Latest.close
                : null;

            const opposingDistanceInAverageRanges =
              opposingDistance !== null &&
              h4AverageRange > 0
                ? opposingDistance /
                  h4AverageRange
                : null;

            continuationDiagnostics = {
              eligible: false,

              reason:
                "Continuation candidate evaluated.",

              brokenLevel:
                h4BOS.level,

              currentPrice:
                h4Latest.close,

              distanceFromBreak:
                Number(
                  distanceFromBreak.toFixed(
                    5
                  )
                ),

              maxContinuationDistance:
                Number(
                  maxContinuationDistance.toFixed(
                    5
                  )
                ),

              distanceInAverageRanges:
                distanceInAverageRanges !==
                null
                  ? Number(
                      distanceInAverageRanges.toFixed(
                        2
                      )
                    )
                  : null,

              opposingLevel:
                opposingLevel,

              opposingDistance:
                opposingDistance !== null
                  ? Number(
                      opposingDistance.toFixed(
                        5
                      )
                    )
                  : null,

              opposingDistanceInAverageRanges:
                opposingDistanceInAverageRanges !==
                null
                  ? Number(
                      opposingDistanceInAverageRanges.toFixed(
                        2
                      )
                    )
                  : null
            };

            if (
              distanceFromBreak <=
              0
            ) {
              continuationDiagnostics.reason =
                "Price has not closed above the bullish H4 BOS level.";
            } else if (
              distanceFromBreak >
              maxContinuationDistance
            ) {
              continuationDiagnostics.reason =
                "Price has travelled too far beyond the bullish H4 BOS; continuation would risk chasing the move.";
            } else if (
              h4Resistance &&
              h4Latest.close >=
                h4Resistance.price -
                  tolerance
            ) {
              continuationDiagnostics.reason =
                "Price is too close to opposing H4 resistance.";
            } else {
              continuationDiagnostics.eligible =
                true;

              continuationDiagnostics.reason =
                "Bullish H4 continuation remains within the allowed distance from BOS and is not too close to opposing resistance.";

              locationGate =
                true;

              locationType =
                "CONTINUATION";

              activeZone = {
                type:
                  "BULLISH_CONTINUATION",

                brokenLevel:
                  h4BOS.level,

                breakDatetime:
                  h4BOS.datetime,

                breakClose:
                  h4BOS.close,

                distanceFromBreak:
                  Number(
                    distanceFromBreak.toFixed(
                      5
                    )
                  )
              };
            }
          }
        }

        // ========================================================
        // BEARISH LOCATION
        // ========================================================

        if (
          direction ===
          "BEARISH"
        ) {
          // 1. SUPPLY
          const supply =
            h4Zones.supply
              .slice()
              .reverse()
              .find(
                zone =>
                  nearZone(
                    h4Latest.close,
                    zone,
                    tolerance
                  )
              );

          if (supply) {
            locationGate =
              true;

            locationType =
              "SUPPLY";

            activeZone =
              supply;
          }

          // 2. RESISTANCE
          else if (
            h4Resistance &&
            Math.abs(
              h4Latest.close -
                h4Resistance.price
            ) <=
              tolerance
          ) {
            locationGate =
              true;

            locationType =
              "RESISTANCE";

            activeZone = {
              type:
                "RESISTANCE",
              price:
                h4Resistance.price,
              datetime:
                h4Resistance.datetime
            };
          }

          // 3. BEARISH CONTINUATION
          else if (
            recentH4BOS
          ) {
            const distanceFromBreak =
              h4BOS.level -
              h4Latest.close;

            const distanceInAverageRanges =
              h4AverageRange > 0
                ? distanceFromBreak /
                  h4AverageRange
                : null;

            const opposingLevel =
              h4Support
                ? h4Support.price
                : null;

            const opposingDistance =
              opposingLevel !== null
                ? h4Latest.close -
                  opposingLevel
                : null;

            const opposingDistanceInAverageRanges =
              opposingDistance !== null &&
              h4AverageRange > 0
                ? opposingDistance /
                  h4AverageRange
                : null;

            continuationDiagnostics = {
              eligible: false,

              reason:
                "Continuation candidate evaluated.",

              brokenLevel:
                h4BOS.level,

              currentPrice:
                h4Latest.close,

              distanceFromBreak:
                Number(
                  distanceFromBreak.toFixed(
                    5
                  )
                ),

              maxContinuationDistance:
                Number(
                  maxContinuationDistance.toFixed(
                    5
                  )
                ),

              distanceInAverageRanges:
                distanceInAverageRanges !==
                null
                  ? Number(
                      distanceInAverageRanges.toFixed(
                        2
                      )
                    )
                  : null,

              opposingLevel:
                opposingLevel,

              opposingDistance:
                opposingDistance !== null
                  ? Number(
                      opposingDistance.toFixed(
                        5
                      )
                    )
                  : null,

              opposingDistanceInAverageRanges:
                opposingDistanceInAverageRanges !==
                null
                  ? Number(
                      opposingDistanceInAverageRanges.toFixed(
                        2
                      )
                    )
                  : null
            };

            if (
              distanceFromBreak <=
              0
            ) {
              continuationDiagnostics.reason =
                "Price has not closed below the bearish H4 BOS level.";
            } else if (
              distanceFromBreak >
              maxContinuationDistance
            ) {
              continuationDiagnostics.reason =
                "Price has travelled too far beyond the bearish H4 BOS; continuation would risk chasing the move.";
            } else if (
              h4Support &&
              h4Latest.close <=
                h4Support.price +
                  tolerance
            ) {
              continuationDiagnostics.reason =
                "Price is too close to opposing H4 support.";
            } else {
              continuationDiagnostics.eligible =
                true;

              continuationDiagnostics.reason =
                "Bearish H4 continuation remains within the allowed distance from BOS and is not too close to opposing support.";

              locationGate =
                true;

              locationType =
                "CONTINUATION";

              activeZone = {
                type:
                  "BEARISH_CONTINUATION",

                brokenLevel:
                  h4BOS.level,

                breakDatetime:
                  h4BOS.datetime,

                breakClose:
                  h4BOS.close,

                distanceFromBreak:
                  Number(
                    distanceFromBreak.toFixed(
                      5
                    )
                  )
              };
            }
          }
        }

        // ========================================================
        // STRUCTURE GATES
        // ========================================================

        const h4StructureGate =
          direction !==
          "NONE";

        const h1StructureGate =
          direction ===
          "BULLISH"
            ? (
                h1Structure ===
                  "BULLISH" ||
                h1BOS.direction ===
                  "BULLISH"
              )
            : direction ===
                "BEARISH"
              ? (
                  h1Structure ===
                    "BEARISH" ||
                  h1BOS.direction ===
                    "BEARISH"
                )
              : false;

        const retracementGate =
          h1Retracement.present;

        const bosGate =
          h1BOS.confirmed &&
          h1BOS.direction ===
            direction;

        // ========================================================
        // FINAL TECHNICAL GATE
        // ========================================================

        const technicalConfirmed =
          h4StructureGate &&
          locationGate &&
          retracementGate &&
          h1StructureGate &&
          bosGate;

        let technicalStatus =
          "NOT_CONFIRMED";

        let setupDirection =
          direction ===
          "BULLISH"
            ? "BULLISH_SETUP"
            : direction ===
                "BEARISH"
              ? "BEARISH_SETUP"
              : "NONE";

        if (
          technicalConfirmed
        ) {
          technicalStatus =
            "TECHNICAL_CONFIRMED";

          setupDirection =
            direction;
        }

        // ========================================================
        // REASONS
        // ========================================================

        const reasons = [];

        if (
          !h4StructureGate
        ) {
          reasons.push(
            "No valid H4 directional context."
          );
        } else {
          reasons.push(
            `H4 context: ${context}.`
          );
        }

        if (
          !locationGate
        ) {
          reasons.push(
            `H4 location not confirmed: ${continuationDiagnostics.reason}`
          );
        } else {
          reasons.push(
            `H4 location confirmed using ${locationType}.`
          );
        }

        if (
          !retracementGate
        ) {
          reasons.push(
            "Required controlled H1 retracement/pullback is not detected."
          );
        } else {
          reasons.push(
            `H1 retracement detected: ${h1Retracement.type}.`
          );
        }

        if (
          !h1StructureGate
        ) {
          reasons.push(
            "H1 structure is not aligned with the H4 context."
          );
        } else {
          reasons.push(
            `H1 structure: ${h1Structure}.`
          );
        }

        if (!bosGate) {
          reasons.push(
            "Required H1 candle-close BOS has not been confirmed."
          );
        } else {
          reasons.push(
            `H1 ${h1BOS.direction} BOS confirmed by candle close.`
          );
        }

        if (
          technicalConfirmed
        ) {
          reasons.push(
            "All required technical gates are satisfied."
          );
        } else {
          reasons.push(
            "Technical confirmation is incomplete; no trade action is generated."
          );
        }

        return Response.json({
          success: true,
          provider:
            "Twelve Data",
          pair: symbol,

          technical_status:
            technicalStatus,

          direction:
            setupDirection,

          technical_value:
            technicalConfirmed
              ? direction ===
                "BULLISH"
                ? 2
                : -2
              : 0,

          latest: {
            h4:
              h4Latest,
            h1:
              h1Latest
          },

          h4: {
            timeframe:
              "H4",

            candle_count:
              h4Candles.length,

            market_structure: {
              direction:
                h4Structure,
              context
            },

            swing_points: {
              highs:
                h4Classified.highs.slice(
                  -10
                ),
              lows:
                h4Classified.lows.slice(
                  -10
                )
            },

            break_of_structure:
              h4BOS,

            zones: {
              demand:
                h4Zones.demand.slice(
                  -5
                ),
              supply:
                h4Zones.supply.slice(
                  -5
                )
            },

            support:
              h4Support,

            resistance:
              h4Resistance,

            average_range:
              Number(
                h4AverageRange.toFixed(
                  5
                )
              )
          },

          h1: {
            timeframe:
              "H1",

            candle_count:
              h1Candles.length,

            market_structure: {
              direction:
                h1Structure
            },

            swing_points: {
              highs:
                h1Classified.highs.slice(
                  -10
                ),
              lows:
                h1Classified.lows.slice(
                  -10
                )
            },

            retracement:
              h1Retracement,

            break_of_structure:
              h1BOS
          },

          gates: {
            h4_structure:
              h4StructureGate,

            h4_location:
              locationGate,

            h4_location_type:
              locationType,

            active_zone:
              activeZone,

            recent_h4_bos:
              recentH4BOS,

            continuation_diagnostics:
              continuationDiagnostics,

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
            sequence:
              "H4 context -> H4 location -> H1 controlled retracement -> H1 structure -> H1 candle-close BOS -> technical confirmation.",

            swing:
              "Swing high/low requires two candles on the left and two candles on the right.",

            structure:
              "Bullish structure requires both the latest swing high and latest swing low to be higher than their previous counterparts. Bearish structure requires both to be lower.",

            bos:
              "BOS requires a completed candle close beyond the relevant swing level. A wick alone does not confirm BOS.",

            location:
              "Location can be established by H4 supply/demand, nearby H4 support/resistance, or a recent H4 structure-break continuation that is not immediately running into opposing support/resistance.",

            continuation:
              "A continuation location requires a recent directional H4 BOS, price remaining beyond the broken level, price remaining within a maximum continuation distance of 4 average H4 ranges, and sufficient distance from opposing H4 support/resistance. The purpose is to avoid chasing an already extended move.",

            retracement:
              "H1 retracement requires a meaningful directional impulse followed by a controlled pullback that does not destroy the impulse origin.",

            confirmation:
              "The H1 candle must close beyond the relevant H1 swing level in the direction of the H4 context.",

            final_gate:
              "All core technical gates are required. One strong condition cannot compensate for a missing critical condition.",

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
            "H4 continuation location",
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
          provider:
            "Twelve Data",
          pair: symbol,
          error:
            error.message
        });
      }
    }

    // ============================================================
    // TWELVE DATA — TECHNICAL DATA TEST
    // ============================================================
    if (
      url.pathname ===
      "/api/technical-data-test"
    ) {
      if (!env.TWELVE_DATA_API_KEY) {
        return Response.json({
          success: false,
          provider:
            "Twelve Data",
          error:
            "TWELVE_DATA_API_KEY is not configured."
        });
      }

      const interval =
        url.searchParams.get(
          "interval"
        ) || "1h";

      if (
        !["1h", "4h"].includes(
          interval
        )
      ) {
        return Response.json({
          success: false,
          provider:
            "Twelve Data",
          error:
            "Interval must be 1h or 4h."
        });
      }

      const outputsize =
        100;

      const apiUrl =
        `https://api.twelvedata.com/time_series` +
        `?symbol=EUR%2FUSD` +
        `&interval=${encodeURIComponent(
          interval
        )}` +
        `&outputsize=${outputsize}` +
        `&timezone=UTC` +
        `&apikey=${encodeURIComponent(
          env.TWELVE_DATA_API_KEY
        )}`;

      try {
        const response =
          await fetch(apiUrl);

        const data =
          await response.json();

        if (!response.ok) {
          return Response.json({
            success: false,
            provider:
              "Twelve Data",
            interval,
            error:
              `HTTP ${response.status}`,
            data
          });
        }

        if (
          data.status ===
          "error"
        ) {
          return Response.json({
            success: false,
            provider:
              "Twelve Data",
            interval,
            error:
              data.message ||
              "Twelve Data returned an error.",
            code:
              data.code || null
          });
        }

        return Response.json({
          success: true,
          provider:
            "Twelve Data",
          pair: "EUR/USD",
          interval,
          candles:
            data.values || [],
          candle_count:
            (
              data.values ||
              []
            ).length,
          meta:
            data.meta || null
        });

      } catch (error) {
        return Response.json({
          success: false,
          provider:
            "Twelve Data",
          interval,
          error:
            error.message
        });
      }
    }

    // ============================================================
    // SERVE THE APP
    // ============================================================
    return env.ASSETS.fetch(request);
  }
};
