# NetScope — Network Monitoring Dashboard

> **DEMO ONLY.** NetScope is a portfolio project. Every metric, device, incident
> and event it shows is **simulated in the browser**. It does **not** connect to,
> scan, or monitor real networks, and it makes no network requests to collect
> data. Nothing here should be used for real monitoring.

A modern, responsive, NOC-style network monitoring dashboard built as a fully
static single-page app. It runs entirely on GitHub Pages with no backend, no API
keys and no paid services.

## Features

- **Dashboard** — device counts, availability/uptime, average latency, packet
  loss and a composite health score, plus live area/line/bar/donut charts, ▲/▼
  **trend deltas** on the fleet KPI cards and a recent-incidents feed.
- **Network Topology** — an interactive D3 force-directed map with zoom, pan,
  draggable nodes, search, type/status filters, a legend and a device detail
  panel. **Site hulls** group devices per location, animated link dashes reflect
  throughput traffic, and **focus (ego) mode** isolates a node and its
  neighbours. Node positions persist to `localStorage`
  (`netscope:topology`), so the layout survives reloads.
- **Device Inventory** — search, filter, sort, add, edit and delete devices, with
  validated **JSON import/export**. Invalid imports are rejected before any state
  changes. Filters are reflected in the URL (`/devices?site=…`) so views are
  shareable. Each device has its own **detail route** (`/#/devices/:id`) with live
  stats, per-device **trend deltas**, a dashed **P95 reference line**, history
  charts, incidents and activity.
- **Performance** — per-device CPU, memory, throughput, latency, packet-loss and
  availability charts with summary statistics and a time-window control.
- **SLA & Uptime** — MTTA/MTTR, fleet/site uptime vs targets, incidents by
  severity and devices falling below the 99.9% target.
- **Incidents** — severity levels, affected devices, timestamps, an
  acknowledgement → resolution workflow, auto-resolution and a resolved history.
  New incidents raise **browser notifications** and **in-app toasts**.
- **Fault simulator** — press `F` to open a chaos playboard that injects
  transient faults: force a device offline or **saturate** it near capacity,
  or sever a whole site. Faults flow through the same metric walk as organic
  events, open correlated incidents and auto-expire on your chosen timer.
- **Event Timeline** — a chronological feed of device status changes, incident
  activity, inventory and configuration events.
- **Command palette** — press `Ctrl/Cmd+K` to fuzzy-search **devices, sites and
  incidents** as well as pages and actions; `?` opens keyboard-shortcut help, `T`
  toggles the theme, `P` toggles the simulation and `F` toggles the fault
  simulator.
- **Settings** — theme, simulation controls (run/pause, speed, refresh interval,
  incident frequency), degradation thresholds and history bounds, plus
  **full-state backup/restore** (JSON) and **CSV export** of the inventory and
  rolling history. Preferences persist to `localStorage`.
- **PWA & offline** — a hand-rolled service worker caches the shell and assets
  (`/netscope/sw.js`), a web manifest enables install, and generated PNG icons
  plus Open Graph/Twitter meta provide social previews.
- **Seeded simulations** — every session is driven by a deterministic PRNG seed.
  A share link (`?seed=…`) reproduces a topology; arbitrary strings are hashed
  into seeds.
- **UX & accessibility** — collapsible sidebar, compact header, mobile drawer,
  keyboard operability, skip-to-content, `prefers-reduced-motion` support,
  accessible Radix primitives, loading skeletons, empty states and error
  boundaries.

---

## Demo walkthrough (10 minutes)

A suggested tour for reviewers. No setup is required — every value is simulated
in the browser.

| Time       | Stop                | What to show                                                                                                                                                          |
| ---------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0:00–1:30  | **Dashboard**       | The header **Live** chip and fleet KPIs ticking over. Point out the ▲/▼ **trend deltas** on Avg Latency, Packet Loss and Uptime.                                      |
| 1:30–3:00  | **Command palette** | Press `Ctrl/Cmd+K`, then type a device name, a site, or an incident title to jump straight there. With an empty box you get navigation + actions.                     |
| 3:00–4:30  | **Device detail**   | Open any device: the **P95** stat card, the dashed red **P95 reference line** on the latency chart, trend deltas, history charts and activity feed.                   |
| 4:30–6:00  | **Performance**     | Per-device CPU/memory/throughput plus **anomaly markers** flagged by the z-score detector, with a capacity/headroom summary.                                          |
| 6:00–8:00  | **Fault simulator** | Press `F` (flask icon). **Saturate** a device or **sever a site**, watch utilisation pin near capacity, incidents open with a toast, and the topology react. Recover. |
| 8:00–9:00  | **Incidents & SLA** | Acknowledge then resolve an incident; review MTTA/MTTR and uptime against target on the SLA page.                                                                     |
| 9:00–9:45  | **Topology**        | Pan/zoom the D3 map, drag nodes, and use focus (ego) mode to isolate a node and its neighbours.                                                                       |
| 9:45–10:00 | **Backup & reset**  | In Settings export a full-state backup, then **Reset demo** to reseed the fleet.                                                                                      |

Handy shortcuts: `Ctrl/Cmd+K` palette · `?` help · `T` theme · `P` pause/resume ·
`F` fault simulator.

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
| PWA         | Hand-rolled service worker + web manifest                 |
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
  unit-testable. The active seed comes from the `?seed=` URL parameter (numeric
  seeds pass through; strings are hashed with FNV-1a) and is written back to the
  store so Settings can build a share link.
- Each device walks toward a **type-specific baseline** (router/switch/firewall/
  server/access point) with its own volatility, so latency, packet loss,
  availability, throughput, CPU and memory move realistically.
- **Maintenance windows** suppress spikes, **flapping detection** flags devices
  that oscillate rapidly, and **correlated site-wide disturbances** degrade the
  devices of a randomly chosen site during severe events.
- A **health score** (0–100) blends latency, loss, availability and CPU. Incidents
  are generated from threshold breaches with a controllable frequency, then
  acknowledged/resolved manually or auto-resolved on recovery.
- The **fault simulator** injects transient, user-driven faults (offline,
  saturation, site outage) that are **never persisted**; they flow through the
  same metric walk as organic events and expire on their timer.
- `runTick()` is a pure function: given devices, thresholds and an RNG it returns
  the next state, samples and events.

### State & persistence

- `useSettingsStore` holds theme, simulation controls and thresholds.
- `useNetworkStore` holds devices, incidents, bounded per-device metric history
  and the event log.
- `useNotificationsStore` tracks read/unread notification IDs for incident
  alerts.
- Persistence uses Zustand `persist` with a **debounced** storage adapter so the
  per-tick simulation does not hammer `localStorage`. Metric history is kept in
  memory and bounded (`maxHistoryPoints`), and is not persisted.
- **D3 layout is deliberately not in the store.** Node positions live in the
  topology hook's state and are saved/restored from `localStorage`
  (`netscope:topology`), so monitoring ticks never disturb the graph and dragging
  never mutates monitoring state.
- **Full-state backups** validate devices, incidents, events and settings
  (settings are normalised with safe fallbacks) before a restore replaces the
  active state.

---

## Testing

```bash
npm run test          # or: npm run test:coverage
```

160+ unit tests across 21 suites cover the pure, high-value logic:

- seeded PRNG determinism, bounds and seed-parameter hashing,
- health-score and severity mapping,
- device filter/sort utilities,
- capacity profiles, the daily traffic curve and utilisation helpers,
- Welford z-score **anomaly detection** and nearest-rank **percentiles**,
- metric **trend** deltas and series windows,
- elapsed-time/age formatting,
- **fault resolution** (forced offline, saturation, site cascades, expiry),
- JSON import/backup validation (valid, invalid, mixed, empty), normalisation
  and round-trips, including per-device **history** coercion,
- the simulation tick (determinism, immutability, sample/incident generation),
  incidence suppression during maintenance, incident auto-resolution and
  **injected faults**,
- CSV serialisation and escaping,
- topology link derivation and focus-group selection,
- Zustand store CRUD, incident workflow, full-state restore, faults and settings,
- notifications store read tracking,
- component rendering (empty states, badges).

Current baseline: **~83% statement coverage / ~86% line coverage** (V8 provider,
`coverage/` output configurable via `vite.config.ts`).

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
rules. Seed share links use the same pattern:
`https://<user>.github.io/netscope/?seed=demo#/topology`.

After the first visit, `/netscope/sw.js` caches the app shell and assets so the
dashboard also loads when the browser is offline.

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
