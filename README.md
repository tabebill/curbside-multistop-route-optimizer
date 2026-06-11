# Curbside Route Optimizer

A simple, API-free Next.js demo for street-sweep route ordering. Paste a list of addresses, choose a start stop, and compare a normal nearest-neighbor route with a curbside route that finishes one side of a street before crossing to the other side.

This repository has three versions:

| Branch | Best for | External services | Notes |
| --- | --- | --- | --- |
| `main` | Trying the curbside ordering idea quickly | None | API-free demo with a schematic route preview. |
| `multi-stop-pins` | Recommended Google-backed app | Google Maps Platform + Google Cloud | Current successful version. Uses real Google map pins, Google Route Optimization, chunked Directions route lines, and in-app stop navigation. |
| `production` | Older full-stack production experiment | Google Maps Platform + Google Cloud | More complex branch with Cloud Storage and large-route experiments. Useful as a reference, but `multi-stop-pins` is the better starting point for efficient routing. |

The `main` branch keeps the interesting routing idea while avoiding API keys, cloud credentials, user accounts, and paid map services.

## Recommended Branch

Use `multi-stop-pins` if you want the most practical version of this project today.

That branch succeeded better than the older `production` branch for the current routing goal because it focuses on the working flow:

- Preview all stops as numbered pins directly on Google Maps.
- Optimize stop order with Google's Route Optimization API.
- Draw motorable road route lines with Google Directions in manageable chunks.
- Keep navigation inside the web app with Previous / Next stop controls.
- Avoid the extra Cloud Storage batch-job complexity unless you truly need that later.

The `production` branch is still useful as a reference for larger production ideas, but it is heavier and was less efficient for the current multi-stop routing workflow.

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

Use the recommended Google-backed branch:

```bash
git clone -b multi-stop-pins https://github.com/tabebill/curbside-multistop-route-optimizer.git multi-stop-pins
cd multi-stop-pins
npm install
cp .env.example .env.local
npm run dev
```

Then fill `.env.local` with your own Google Maps browser key, server Geocoding key, Google Cloud project ID, and Route Optimization service-account credential path.

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

- The `multi-stop-pins` branch is the recommended production starting point for the current app shape: Google Maps pins, server-side geocoding, Route Optimization API ordering, chunked Google Directions route lines, and in-app navigation.
- The `production` branch includes older experiments for async large-route jobs, Cloud Storage integration, exports, and the curbside street-sweep ordering layer.
- Next production steps include authentication, persistence/database storage, user-owned saved routes, billing controls, and deployment hardening.

## License

MIT
