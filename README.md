# Forex Macro Assistant — Major Browser/PWA Build v2

This is the major build of the mobile-first browser application.

## Architecture
Phone browser/PWA → this Node/Express backend → market/economic data providers → analysis engine.

A backend is used so provider API keys are not placed in the public browser JavaScript.

## Live providers
- Alpha Vantage: FX spot/rate and daily FX series.
- Trading Economics: economic calendar and historical/forecast economic data.

Both providers require their own API access. The application never invents missing live data.

## Run locally
1. Install Node.js 20+.
2. Copy `.env.example` to `.env`.
3. Add your provider keys.
4. Run `npm install`.
5. Run `npm start`.
6. Open `http://localhost:3000`.

For phone access, deploy the project to an HTTPS host. Then open it in Android Chrome and choose Add to Home screen/Install.

## Strategy engine
Macro scores → relative differential → post-release fundamental momentum → price/fundamental divergence → daily/4H technical confirmation → action.

The app is decision-support and does not place broker orders.
