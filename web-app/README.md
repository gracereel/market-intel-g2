# Market Intel G2 — Live Market App for Even Realities G2

Real-time crypto prices, futures, stocks, and oil with AI-powered market sentiment. Built for the **Even Realities G2 smart glasses**.

## Features
- Live Binance WebSocket prices (zero delay)
- AI market sentiment (70%+ accuracy) with buy/sell pressure %
- Top 10 coins on load — search any coin or pair instantly
- Breaking news alerts that pop directly on your G2 display
- Crypto, futures, stocks (SPY, QQQ), and crude oil (WTI)
- Even Hub G2 plugin (.ehpk) included

## Live Demo
[market-intel-g2.pplx.app](https://g1-market-intel-6dny4xaltbk4o2tuyjd.pq.pplx.app)

## Stack
- **Backend:** Node.js + Express + Drizzle ORM + SQLite
- **Frontend:** React + Vite + Tailwind CSS + shadcn/ui
- **G2 Plugin:** Vanilla JS + Even Hub SDK (@evenrealities/even_hub_sdk)
- **Data:** Binance WebSocket, NewsAPI, Finnhub

## Project Structure
```
g1-market-news/          ← Main web app (Express + React)
g1-even-hub-plugin/      ← Even Hub G2 plugin (.ehpk)
g2-simulator/            ← Browser simulator for G2 display preview
g2-screenshots/          ← Submission screenshots (576x288 RGBA PNG)
```

## Setup
```bash
cd g1-market-news
npm install
npm run dev
```

## G2 Plugin
```bash
cd g1-even-hub-plugin
npm install
npm run build
npx @evenrealities/evenhub-cli pack app.json dist --output market-intel-g2.ehpk
```

## Author
Grace Reel — Sales / Market Trader, Los Angeles CA
