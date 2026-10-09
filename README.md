# NetScope — Network Monitoring Dashboard

> **DEMO ONLY.** NetScope is a portfolio project. Every metric, device, incident
> and event it shows is **simulated in the browser**. It does **not** connect to,
> scan, or monitor real networks, and it makes no network requests to collect
> data. Nothing here should be used for real monitoring.

A modern, responsive, NOC-style network monitoring dashboard built as a fully
static single-page app. It runs entirely on GitHub Pages with no backend, no API
keys and no paid services.

![NetScope dashboard](docs/screenshots/dashboard.png)
![Interactive D3 topology](docs/screenshots/topology.png)

> Screenshots are placeholders. Run the app locally and replace the files in
> `docs/screenshots/` with your own captures.

---

## Features

- **Dashboard** — device counts, availability/uptime, average latency, packet
  loss and a composite health score, plus live area/line/bar/donut charts and a
  recent-incidents feed.
- **Network Topology** — an interactive D3 force-directed map with zoom, pan,
  draggable nodes, search, type/status filters, a legend and a device detail
  panel. Layout state is intentionally isolated from monitoring state.
- **Device Inventory** — search, filter, sort, add, edit and delete devices, with
  validated **JSON import/export**. Invalid imports are rejected before any state
  changes.
- **Performance** — historical latency, packet-loss and availability charts with
  a device selector and time-window control.
- **Incidents** — severity levels, affected devices, timestamps, an
  acknowledgement → resolution workflow, auto-resolution and a resolved history.
- **Event Timeline** — a chronological feed of device status changes, incident
  activity, inventory and configuration events.
- **Settings** — theme, simulation controls (run/pause, speed, refresh interval,
  incident frequency), degradation thresholds and history bounds. Preferences
  persist to `localStorage`.
- **UX** — collapsible sidebar, compact header, mobile drawer navigation,
  accessible Radix primitives, loading skeletons, empty states and error
  boundaries.

---

## Tech stack

| Area        | Choice                                                    |
| ----------- | --------------------------------------------------------- |
| Framework   | React 19 + TypeScript (strict)                            |
| Build       | Vite 8 (base `/netscope/`)                                |
| Styling     | Tailwind CSS 3.4 + shadcn/ui-style components on Radix UI |
| Topology    | D3 (`d3-force`, `d3-zoom`)                                |
| Charts      | Recharts                                                  |
| State       | Zustand (+ `persist`)                                     |
| Icons       | Lucide React                                              |
| Routing     | React Router (`HashRouter`)                               |
| Testing     | Vitest + Testing Library                                  |
| Lint/format | ESLint (flat config) + Prettier                           |

---

## Getting started

Requires **Node 20.19+** (Node 22 recommended).

```bash
git clone https://github.com/<your-username>/netscope.git
cd netscope
npm install
npm run dev
```

### Scripts

| Script                  | Description                          |
| ----------------------- | ------------------------------------ |
| `npm run dev`           | Start the Vite dev server            |
| `npm run build`         | Type-check and build to `dist/`      |
| `npm run preview`       | Preview the production build locally |
| `npm run lint`          | Run ESLint                           |
| `npm run typecheck`     | Run `tsc --noEmit`                   |
| `npm run test`          | Run the Vitest suite once            |
| `npm run test:watch`    | Run Vitest in watch mode             |
| `npm run test:coverage` | Run tests with V8 coverage           |
| `npm run format`        | Format the codebase with Prettier    |
| `npm run format:check`  | Verify formatting                    |

---

## Architecture

The app separates concerns so the simulation, state, storage and UI can evolve
(and be tested) independently.

```
src/
├── components/
│   ├── ui/            # shadcn-style Radix primitives (button, dialog, ...)
│   ├── common/        # EmptyState, ErrorState, Badges, StatCard, ErrorBoundary
│   ├── charts/        # ChartCard + shared Recharts tooltip
│   ├── layout/        # AppShell, Header, SidebarNav
│   ├── topology/      # D3 canvas, link derivation, node sizing
│   └── {dashboard,devices,...}/
├── config/            # navigation definition
├── hooks/             # useSimulation, useTheme, useMediaQuery, useTopologyLayout
├── lib/               # format, health/severity math, device filter/sort, aggregate
├── pages/             # one component per route (lazily loaded)
├── simulation/        # seeded PRNG, seed data, metric walk, incident engine
├── storage/           # debounced localStorage + JSON import/export validation
├── store/             # Zustand stores (settings, network)
├── test/              # setup + unit tests
└── types/             # shared domain types
```

### Simulation

- A **seeded PRNG** (`mulberry32`) makes the telemetry deterministic and
  unit-testable.
- Each device random-walks latency, packet loss, availability, throughput, CPU
  and memory, with occasional spikes and outages.
- A **health score** (0–100) blends latency, loss, availability and CPU. Incidents
  are generated from threshold breaches with a controllable frequency, then
  acknowledged/resolved manually or auto-resolved on recovery.
- `runTick()` is a pure function: given devices, thresholds and an RNG it returns
  the next state, samples and events.

### State & persistence

- `useSettingsStore` holds theme, simulation controls and thresholds.
- `useNetworkStore` holds devices, incidents, bounded per-device metric history
  and the event log.
- Persistence uses Zustand `persist` with a **debounced** storage adapter so the
  per-tick simulation does not hammer `localStorage`. Metric history is kept in
  memory and bounded (`maxHistoryPoints`), and is not persisted.
- **D3 layout is deliberately not in the store.** Node positions live in the
  topology hook's refs/local state, so monitoring ticks never disturb the graph
  and dragging never mutates monitoring state.

---

## Testing

```bash
npm run test          # or: npm run test:coverage
```

49+ unit tests cover the pure, high-value logic:

- seeded PRNG determinism and bounds,
- health-score and severity mapping,
- device filter/sort utilities,
- JSON import validation (valid, invalid, mixed, empty) and export round-trips,
- the simulation tick (determinism, immutability, sample/incident generation),
- Zustand store CRUD and incident workflow,
- component rendering (empty states, badges).

---

## Deploying to GitHub Pages

The app is designed for GitHub Pages at the `/netscope/` base path.

1. Push the repository to GitHub with the name **`netscope`**
   (the base path must match the repository name; if you use a different name,
   change `base` in `vite.config.ts`).
2. In **Settings → Pages**, set **Source** to **GitHub Actions**.
3. Push to `main`. The workflow in `.github/workflows/deploy.yml` installs,
   lints, type-checks, tests, builds and deploys `dist/` automatically.

Because the app uses `HashRouter`, deep links such as
`https://<user>.github.io/netscope/#/topology` work without any server rewrite
rules.

---

## Limitations

- **No real monitoring.** All telemetry is simulated in-browser and labelled
  **DEMO** throughout the UI.
- Data lives in the browser's `localStorage`; it is per-device and cleared if the
  user clears site data. There is no multi-user or cross-device sync.
- The topology layout is derived heuristically from the inventory (site hubs +
  a global core), not from real link discovery.
- Bundle size is moderate (Recharts + D3); heavy routes are code-split.

---

## License

[MIT](./LICENSE) © 2026 NetScope contributors
