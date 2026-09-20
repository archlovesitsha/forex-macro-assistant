export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/fx/rate") {
      const from = (url.searchParams.get("from") || "EUR").toUpperCase();
      const to = (url.searchParams.get("to") || "USD").toUpperCase();

      if (!env.ALPHAVANTAGE_API_KEY) {
        return Response.json({
          configured: false,
          message: "Alpha Vantage API key is not configured."
        });
      }

      const apiUrl =
        `https://www.alphavantage.co/query?function=CURRENCY_EXCHANGE_RATE` +
        `&from_currency=${encodeURIComponent(from)}` +
        `&to_currency=${encodeURIComponent(to)}` +
        `&apikey=${encodeURIComponent(env.ALPHAVANTAGE_API_KEY)}`;

      const response = await fetch(apiUrl);
      const data = await response.json();

      return Response.json({
        configured: true,
        provider: "Alpha Vantage",
        pair: `${from}/${to}`,
        data
      });
    }

    return env.ASSETS.fetch(request);
  }
};
