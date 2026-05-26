# Curbside Route Optimizer

A simple, API-free Next.js demo for street-sweep route ordering. Paste a list of addresses, choose a start stop, and compare a normal nearest-neighbor route with a curbside route that finishes one side of a street before crossing to the other side.

This repository has two versions:

| Branch | Best for | External services | Notes |
| --- | --- | --- | --- |
| `main` | Trying the curbside ordering idea quickly | None | API-free demo with a schematic route preview. |
| `production` | Building a real Google-backed multi-stop app | Google Maps Platform + Google Cloud | Requires your own API keys, service account, billing, and Cloud Storage bucket. |

The `main` branch keeps the interesting routing idea while avoiding API keys, cloud credentials, user accounts, and paid map services.

## Features

- Paste newline-separated street addresses.
- Load a Tulsa sample route.
- Detect duplicate and unparseable rows.
- Choose round-trip or open-route mode.
- Choose nearest-neighbor or curbside street-sweep ordering.
- Pick the starting stop.
- Preview the route on a schematic map.
- Export the ordered route to CSV.

## How the Curbside Mode Works

1. Parse each stop into a house number, normalized street name, and curb side.
2. Group stops by street.
3. Split each street into odd and even house-number sides.
4. Sequence one curb face in house-number order.
5. Sequence the opposite curb face before moving to the next nearby street.

This is a local heuristic, not a replacement for production routing APIs. A production version should pair this ordering layer with real geocoding, road-network routing, turn restrictions, and route geometry from a provider such as Google Route Optimization API.

## Getting Started

Use the API-free demo:

```bash
git clone https://github.com/tabebill/curbside-multistop-route-optimizer.git
cd curbside-multistop-route-optimizer
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser.

Use the production branch:

```bash
git clone -b production https://github.com/tabebill/curbside-multistop-route-optimizer.git
cd curbside-multistop-route-optimizer
npm install
cp .env.example .env.local
npm run dev
```

Then fill `.env.local` with your own Google credentials. Do not commit `.env.local` or service account JSON files.

## Scripts

- `npm run dev` starts the local app.
- `npm run build` creates a production build.
- `npm run lint` runs ESLint.

## Tech Stack

- Next.js App Router
- React
- TypeScript
- Tailwind CSS

## Production Ideas

- The `production` branch includes Google Maps rendering, server-side geocoding, Route Optimization API calls, async large-route jobs, Cloud Storage integration, exports, and the curbside street-sweep ordering layer.
- Next production steps include authentication, persistence/database storage, user-owned saved routes, billing controls, and deployment hardening.

## License

MIT
