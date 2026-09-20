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
    // MACRO ANALYSIS ENGINE
    // ==========================================
    if (url.pathname === "/api/analyse") {
      const pair = (
        url.searchParams.get("pair") || "EUR/USD"
      ).toUpperCase();

      const base = Number(url.searchParams.get("base") || 0);
      const quote = Number(url.searchParams.get("quote") || 0);
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
      } else if (Math.abs(differential) >= 3) {
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
