export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // ==========================================
    // ALPHA VANTAGE - CURRENT FX RATE
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
    // FREE HISTORICAL FX DATA
    // ==========================================
    if (url.pathname === "/api/fx/history") {
      const pair = (
        url.searchParams.get("pair") || "EUR/USD"
      ).toUpperCase();

      const parts = pair.split("/");

      if (parts.length !== 2) {
        return Response.json({
          configured: false,
          message: "Pair must be in the format EUR/USD."
        });
      }

      const from = parts[0];
      const to = parts[1];
      const symbol = `${from}${to}=X`;

      const apiUrl =
        `https://query1.finance.yahoo.com/v8/finance/chart/` +
        `${encodeURIComponent(symbol)}?range=3mo&interval=1d`;

      try {
        const response = await fetch(apiUrl);
        const data = await response.json();

        return Response.json({
          configured: true,
          provider: "Yahoo Finance",
          pair,
          data
        });
      } catch (error) {
        return Response.json({
          configured: false,
          provider: "Yahoo Finance",
          error: error.message
        });
      }
    }

    // ==========================================
    // SERVE THE FOREX MACRO ASSISTANT APP
    // ==========================================
    return env.ASSETS.fetch(request);
  }
};
