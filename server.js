import express from "express";
import "dotenv/config";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static("."));

/* =========================================================
   ALPHA VANTAGE
   ========================================================= */

async function av(path) {
  const key = process.env.ALPHAVANTAGE_API_KEY;

  if (!key) {
    return {
      configured: false,
      provider: "Alpha Vantage",
      message:
        "Add ALPHAVANTAGE_API_KEY to enable live FX data."
    };
  }

  const url =
    `https://www.alphavantage.co/query?${path}` +
    `&apikey=${encodeURIComponent(key)}`;

  const r = await fetch(url);
  const data = await r.json();

  return {
    configured: true,
    provider: "Alpha Vantage",
    data
  };
}


/* =========================================================
   DAILY FX DATA
   ========================================================= */

app.get("/api/fx/daily", async (req, res) => {
  try {
    const from =
      (req.query.from || "EUR").toUpperCase();

    const to =
      (req.query.to || "USD").toUpperCase();

    res.json(
      await av(
        `function=FX_DAILY` +
        `&from_symbol=${from}` +
        `&to_symbol=${to}` +
        `&outputsize=compact`
      )
    );

  } catch (e) {
    res.status(502).json({
      error: e.message
    });
  }
});


/* =========================================================
   LIVE FX RATE
   ========================================================= */

app.get("/api/fx/rate", async (req, res) => {
  try {
    const from =
      (req.query.from || "EUR").toUpperCase();

    const to =
      (req.query.to || "USD").toUpperCase();

    res.json(
      await av(
        `function=CURRENCY_EXCHANGE_RATE` +
        `&from_currency=${from}` +
        `&to_currency=${to}`
      )
    );

  } catch (e) {
    res.status(502).json({
      error: e.message
    });
  }
});


/* =========================================================
   ECONOMIC CALENDAR
   ========================================================= */

app.get("/api/calendar", async (req, res) => {

  const key =
    process.env.TRADINGECONOMICS_API_KEY;

  if (!key) {
    return res.json({
      configured: false,
      provider: "Trading Economics",
      message:
        "Add TRADINGECONOMICS_API_KEY to enable economic-calendar data."
    });
  }

  try {

    const country =
      req.query.country ||
      "united states";

    const url =
      `https://api.tradingeconomics.com/calendar/country/` +
      `${encodeURIComponent(country)}` +
      `?c=${encodeURIComponent(key)}&f=json`;

    const r = await fetch(url);
    const data = await r.json();

    res.json({
      configured: true,
      provider: "Trading Economics",
      data
    });

  } catch (e) {

    res.status(502).json({
      error: e.message
    });

  }
});


/* =========================================================
   RISK CALCULATOR API
   =========================================================
   
   This endpoint performs the same calculation as the
   Risk calculator inside the app.

   Formula:

   Risk amount =
   account balance × risk % ÷ 100

   Lot size =
   risk amount ÷
   (stop pips × pip value)

   Reward/Risk =
   target pips ÷ stop pips
   ========================================================= */

app.get("/api/risk/calculate", async (req, res) => {

  try {

    const balance =
      Number(req.query.balance);

    const riskPercent =
      Number(req.query.risk);

    const stop =
      Number(req.query.stop);

    const target =
      Number(req.query.target);

    const pipValue =
      Number(req.query.pipValue);


    /* Validate inputs */

    if (
      !Number.isFinite(balance) ||
      balance <= 0 ||

      !Number.isFinite(riskPercent) ||
      riskPercent <= 0 ||

      !Number.isFinite(stop) ||
      stop <= 0 ||

      !Number.isFinite(target) ||
      target <= 0 ||

      !Number.isFinite(pipValue) ||
      pipValue <= 0
    ) {

      return res.status(400).json({
        error: "Invalid risk calculation values."
      });

    }


    /* Risk amount */

    const riskAmount =
      balance *
      riskPercent /
      100;


    /* Position size */

    const lotSize =
      riskAmount /
      (stop * pipValue);


    /* Risk / Reward */

    const rewardRisk =
      target /
      stop;


    /* Potential profit */

    const potentialProfit =
      target *
      pipValue *
      lotSize;


    /* Maximum loss */

    const maximumLoss =
      stop *
      pipValue *
      lotSize;


    /* Warning */

    let warning = "";

    if (riskPercent >= 5) {

      warning =
        "High risk per trade.";

    }


    res.json({

      success: true,

      inputs: {
        balance,
        riskPercent,
        stop,
        target,
        pipValue
      },

      results: {

        riskAmount:
          Number(riskAmount.toFixed(2)),

        lotSize:
          Number(lotSize.toFixed(3)),

        rewardRisk:
          Number(rewardRisk.toFixed(2)),

        potentialProfit:
          Number(potentialProfit.toFixed(2)),

        maximumLoss:
          Number(maximumLoss.toFixed(2))

      },

      warning

    });

  } catch (e) {

    res.status(500).json({
      error: e.message
    });

  }

});


/* =========================================================
   HEALTH CHECK
   ========================================================= */

app.get("/api/health", (req, res) => {

  res.json({

    ok: true,

    app:
      "Forex Macro Assistant",

    version:
      "v2",

    services: {

      fx:
        "available",

      risk:
        "available",

      calendar:
        process.env.TRADINGECONOMICS_API_KEY
          ? "configured"
          : "not configured"

    }

  });

});


/* =========================================================
   START SERVER
   ========================================================= */

app.listen(PORT, () => {

  console.log(
    `Forex Macro Assistant running on http://localhost:${PORT}`
  );

});
