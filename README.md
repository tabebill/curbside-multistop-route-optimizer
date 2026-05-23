# Curbside Route Optimizer

A simple, API-free Next.js demo for street-sweep route ordering. Paste a list of addresses, choose a start stop, and compare a normal nearest-neighbor route with a curbside route that finishes one side of a street before crossing to the other side.

The demo was extracted from a larger multi-stop route planning concept. This public version keeps the interesting routing idea while avoiding API keys, cloud credentials, user accounts, and paid map services.

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

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser.

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

- Add geocoding and address validation.
- Add real map rendering and route polylines.
- Add blocked-road or preferred-turn controls.
- Support very large routes through async optimization jobs.
- Store route projects and previous optimization results.

## License

MIT
