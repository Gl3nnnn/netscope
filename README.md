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
- **Path tracer** — pick a source and destination to trace the hop-by-hop route
  over the derived topology, with an animated packet along the path, per-hop
  latency/loss/utilisation breakdown, a highlighted **critical hop**, and a
  healthy **detour** suggestion when a hop is down.
- **What-if planner** — a sandboxed digital twin that projects the fleet forward
  under hypothetical changes (add devices, scale traffic, upgrade capacity, fail a
  node or a whole site) using the real simulation engine on a cloned snapshot. It
  compares **baseline vs projected** utilisation, headroom and saturation and flags
  the devices that would saturate — without touching the live fleet.
- **Resilience & chaos** — static analysis finds **single points of failure**
  (articulation points whose failure strands other devices from the core), measures
  path **redundancy** and rolls it into a 0-100 **resilience score**. A **chaos lab**
  then injects combined faults (core/site outages, link saturation, traffic surges)
  on a cloned, seeded fleet and reports how each **business service** fares.
- **Compliance & hardening audit** — a dependency-free rule engine grades the fleet
  against hardening, segmentation, availability and hygiene benchmarks (telnet off,
  encrypted secrets, blocked root SSH, default-deny firewall, no legacy remote
  ports, healthy devices…), rolls findings up by severity and category into a
  compliance score and a weighted risk score, and supports **documented waivers**
  per rule and device.
- **Change management (CAB)** — raise, review, approve, schedule, implement and
  verify change requests through a full workflow (draft → review → approved →
  scheduled → implementing → verifying → closed, with rejected/cancelled/rollback
  branches). Deterministic **risk scoring** blends scope, change type and impacted
  service tier; the CAB queue, **schedule-conflict** detection, overdue tracking and
  **drift-based post-implementation verification** keep changes safe.
- **Geographic operations map** — a dependency-free world map that projects every
  site equirectangularly (curated coordinates for the seeded sites, deterministic
  hash fallback for custom ones), draws **cross-site topology arcs coloured by
  latency**, and rolls live health, device counts and worst status into markers.
  A site roster adds health bars and nearest-site distance (haversine), plus
  longest-link and nearest-pair panels for capacity planning.
- **Flow & application analytics** — a NetFlow-style engine that deterministically
  splits each device's throughput across applications, peers and directions.
  Surface **top talkers**, an **application mix**, top **conversations**, an
  **east-west vs north-south** split, **heavy hitters** (>2× an application's
  mean) and a **site-to-site traffic-matrix heatmap**.
- **Interface / port inventory** — every device is broken into per-port state
  (name, line speed, admin/oper status, duplex, VLAN, error/CRC counters and
  connected peer) derived deterministically from its type profile. The device
  detail page shows an **Interfaces** card with up/err-disabled/down badges and a
  utilisation bar per port.
- **IP address management (IPAM)** — a CIDR-aware ledger of **subnets, VLANs and
  IP allocations** with pure arithmetic helpers (`ipToLong`/`longToIp`,
  `parseCidr`, `cidrOverlaps`). It computes per-subnet **utilisation** and
  **free-space**, flags **overlapping address ranges** as conflicts, and joins a
  **VLAN catalog** to its subnet with a live utilisation badge. The seeded ledger
  derives two `/24`s (user + server) per site and persists edits to
  `netscope:ipam`.
- **Environment** — deterministic power, heat, carbon and energy-cost modelling.
  Each device's draw is interpolated between an idle and a peak wattage from its
  type profile using a live CPU/throughput **load factor**, then rolled up into
  **IT vs facility power** (PUE 1.45), **cooling overhead**, **BTU heat**, **kg
  CO2/day** and **$/day**. Per-site and per-device tables plus an efficiency
  **score/grade** (balanced 30-70% load scores highest).
- **Asset lifecycle** — deterministic end-of-life, end-of-support and warranty
  tracking. Each device's acquisition date is derived from its id hash and its
  type's support/warranty window, producing **age**, **days-to-EOL** and
  **days-to-warranty**, a **status** (active / approaching EOL / EOL), a
  **risk score** (EOL + warranty weighted) and a **refresh queue**. The assets
  table is sorted by risk with a status badge and a per-device risk bar.
- **Security operations** — a deterministic SOC engine that derives MITRE
  ATT&CK detections (brute force, port scans, DoS, C2, exfiltration, sniffing)
  from the live fleet, flows and geography, each with a confidence, kill-chain
  phase and severity. The Security page shows an **ATT&CK heat map**, a
  **threat feed** with per-event **Contain** / **False positive** triage
  (containment raises a real timeline incident), a **top-targeted** panel and a
  **security score/grade** rollup.
- **Routing intelligence** — a deterministic control plane over the derived
  topology: **autonomous systems** (local + peer), **BGP peering sessions** with
  per-session state and prefix counts, **OSPF areas** and adjacency state, and a
  **shortest-path routing table** per router (Dijkstra over the OSPF graph) with
  connected/OSPF/BGP/static prefixes, admin distance and metrics. The Routing
  page surfaces **control-plane issues** (downed BGP, degraded OSPF, suboptimal
  paths, flaps, blackholes), a **convergence timeline** and a **health score**.
- **Quality of Service** — a class-based marking engine that sorts every flow
  into **realtime / interactive / transactional / bulk / best-effort** with
  **DSCP codepoints** (EF, AF41, AF21, CS1, BE) and weighted-fair **queue
  allocations**. The QoS page reports per-class **share, utilisation-vs-allocation
  and tail drops**, detects **starved classes** and **priority inversion**, and
  offers a **clone-only what-if reshaper** that evaluates candidate weight
  policies (voice-first, batch-friendly, equal-share) without touching state.
- **Device Inventory** — search, filter, sort, add, edit and delete devices, with
  validated **JSON import/export**. Invalid imports are rejected before any state
  changes. Filters are reflected in the URL (`/devices?site=…`) so views are
  shareable, and each row shows a colour-coded **latency sparkline**. Each device
  has its own **detail route** (`/#/devices/:id`) with live stats, per-device
  **trend deltas**, a dashed **P95 reference line**, history charts, incidents and
  activity.
- **Performance** — per-device CPU, memory, throughput, latency, packet-loss and
  availability charts with summary statistics, a time-window control, and a
  **read-only history replay scrubber** that previews any retained sample.
- **SLA & Uptime** — MTTA/MTTR, fleet/site uptime vs targets, incidents by
  severity and devices falling below the 99.9% target.
- **Business services (BSM)** — map customer-visible **business services** onto
  the devices and sites that deliver them, each with a criticality tier (P1–P4)
  and an impact kind (revenue / regulatory / productivity / internal). The page
  derives live **service health** and uptime, ranks the **business impact** of an
  incident (weighted by tier, impact and severity), and feeds a **business-risk**
  rollup into the dashboard-style summary and the incident **War Room**.
- **Incidents** — severity levels, affected devices, timestamps, an
  acknowledgement → resolution workflow, auto-resolution and a resolved history.
  New incidents raise **browser notifications** and **in-app toasts**.
- **SLO error budget & burn rate** — a 99.9%/30-day budget with one- and
  six-hour burn-rate windows. The SLO page shows budget consumed/remaining and
  the header carries a live **burn badge** (warning at 6×, critical at 14.4×).
- **Capacity forecasting** — linear regression over rolling throughput projects
  each device forward; the Performance page plots the dashed projection, the
  Dashboard ranks devices by **time-to-saturation**, and device pages show an
  **ETA to saturation**.
- **Dependency & root cause** — the inventory-derived graph powers a cycle-safe
  **blast radius** (highlighted on the topology map and in device details) and a
  ranked **probable root cause** panel on the Incidents page.
- **Remediation runbooks** — each incident gets a matched runbook (offline,
  saturation, degradation or investigation) with step-by-step guidance and a
  one-click **Apply runbook** that clears faults and recovers the fleet.
- **Incident postmortems** — export a generated report (Markdown or JSON) with
  impact, key metrics, chronological timeline, probable cause and recommended
  actions, from the Incidents page or the command palette.
- **Alert rules engine** — define custom threshold rules (metric, operator,
  value, _for_ duration, severity and optional site/type/tag scope). A pure,
  testable engine evaluates every device each tick, moving alerts through
  **pending → firing → resolved**, surfacing toasts, a header firing count and a
  dedicated **Alerts** page with active, rule and history views.
- **NOC wallboard** — press `W` for a full-screen, chrome-less kiosk view that
  auto-rotates between fleet KPIs, a throughput trend, top utilisation and the
  live incident/alert queue, with a rotation progress bar and click-to-pin dots.
- **Metric explorer** — the **Explorer** page filters devices with a small query
  language (`site:DC-A`, `type:router`, `latency>50`, `util>80`, free text) and
  overlays up to eight historical series plus the fleet average across any
  metric and time window, with a ranked results table.
- **Synthetic monitors** — probes check a device, site or the whole fleet on an
  interval, deriving an operational posture from simulated latency, loss and
  availability while they roll into uptime. The chrome-less **Status** page
  (`/status`) renders them as a public-facing status board.
- **Notification channels & escalation** — route firing alerts to email, Slack,
  webhook or pager channels filtered by minimum severity, then re-notify and
  page still-open critical alerts on a configurable escalation ladder. Every
  delivery is logged with its escalation level.
- **Automation playbooks & maintenance windows** — react to firing alerts or raw
  conditions (offline, saturation) with orchestrated actions (note, acknowledge,
  apply a runbook, enter maintenance, tag) under per-device cooldowns.
  **Maintenance windows** scope a site or device set and quiet alerting and
  automation for their duration. Every execution is logged on the **Automation**
  page.
- **Time Machine** — a bounded, in-memory recording of the fleet (≤240 frames)
  captures a snapshot every tick so you can scrub back, play an incident frame by
  frame, jump to when a known incident opened, and **diff any two moments** to
  see status changes and the biggest metric movers. Nothing is persisted.
- **Ask NetScope** — a deterministic, offline natural-language assistant. Ask
  about fleet health, a device, a site, incident counts, capacity, a route or
  uptime and get a cited, structured answer built from the same engines as the
  rest of the app — no network calls, no LLM.
- **Incident command center (War Room)** — open any incident into a dedicated
  room (`/incidents/:id`) that fuses its matched **runbook**, ranked **probable
  root causes**, the downstream **blast radius**, incident **key metrics** and a
  merged **causal timeline** of events and operator notes. Apply the runbook,
  jump straight to that moment in the **Time Machine**, post a comms update and
  export the postmortem — all from one screen.
- **Policy & reachability** — author an ordered, default-deny **ACL** where each
  rule matches a source/destination by device, site, type or wildcard on a
  port/protocol. The page statically **analyses the policy** for shadowed,
  redundant and unused rules, renders an all-pairs **reachability matrix** over
  the live topology, **explains a flow path** hop-by-hop, and lets you **what-if**
  a proposed rule to preview exactly which flows it opens or closes.
- **On-call & escalation** — define **teams** and cycle their rosters through
  **rotations** (daily to bi-weekly). The page shows who is on call **right
  now**, the upcoming **handoff schedule**, the ordered **escalation chain**,
  and the header carries a live **on-call badge** that links straight there.
- **Configuration drift** — every device carries an approved **baseline** and a
  running config. A deterministic, dependency-free **line diff** highlights
  added/removed lines, a filter surfaces drifted devices, and you can **edit the
  running config**, **accept** it as the new baseline, or **roll back** to any of
  the retained **version history** — each action logging a config event.
- **Executive reports** — assemble a report from live telemetry using presets
  (fleet health, SLA & SLO, capacity, incidents, on-call or a full executive
  summary) and per-section toggles over a 24h/7d/30d window. The previews cover
  health, error budget, site SLA, capacity outlook, ranked incidents, the change
  log and on-call coverage, and export as **Markdown** or a self-contained,
  print-ready **HTML** document (inline styles + inline SVG sparkline).
- **Fault simulator** — press `F` to open a chaos playboard that injects
  transient faults: force a device offline or **saturate** it near capacity,
  or sever a whole site. Faults flow through the same metric walk as organic
  events, open correlated incidents and auto-expire on your chosen timer.
- **Event Timeline** — a chronological feed of device status changes, incident
  activity, inventory and configuration events.
- **Command palette** — press `Ctrl/Cmd+K` to fuzzy-search **devices, sites and
  incidents** as well as pages and actions; `?` opens keyboard-shortcut help, `T`
  toggles the theme, `P` toggles the simulation, `F` toggles the fault
  simulator, `A` jumps to the Alerts page and `W` opens the NOC wallboard.
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
- **UX & accessibility** — a **grouped, collapsible sidebar** (Overview, Deep
  Dive, Plan & Test, Governance, Security, Operations, Response and Insights)
  that keeps the
  nav scroll-contained instead of overflowing the page, auto-expands the active
  section and collapses to an icon rail; plus a compact header, mobile drawer,
  keyboard operability, skip-to-content, `prefers-reduced-motion` support,
  accessible Radix primitives, loading skeletons, empty states and error
  boundaries.

---

## Demo walkthrough (19 minutes)

A suggested tour for reviewers. No setup is required — every value is simulated
in the browser.

| Time        | Stop                           | What to show                                                                                                                                                                                                                                                                                                                                                          |
| ----------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0:00–1:30   | **Dashboard**                  | The header **Live** chip and fleet KPIs ticking over. Point out the ▲/▼ **trend deltas** on Avg Latency, Packet Loss and Uptime.                                                                                                                                                                                                                                      |
| 1:30–3:00   | **Command palette**            | Press `Ctrl/Cmd+K`, then type a device name, a site, or an incident title to jump straight there. With an empty box you get navigation + actions.                                                                                                                                                                                                                     |
| 3:00–4:30   | **Device detail**              | Open any device: the **P95** stat card, the dashed red **P95 reference line** on the latency chart, trend deltas, history charts and activity feed.                                                                                                                                                                                                                   |
| 4:30–6:00   | **Performance**                | Per-device CPU/memory/throughput plus **anomaly markers** flagged by the z-score detector, capacity/headroom, and the **history replay scrubber**.                                                                                                                                                                                                                    |
| 6:00–8:00   | **Fault simulator**            | Press `F` (flask icon). **Saturate** a device or **sever a site**, watch utilisation pin near capacity, incidents open with a toast, and the topology react. Recover.                                                                                                                                                                                                 |
| 8:00–9:00   | **Incidents & SLO**            | Acknowledge an incident, open its matched **runbook**, then **Apply runbook** to auto-recover the fleet. Check the SLA page's **error-budget** card and the header **burn badge**.                                                                                                                                                                                    |
| 9:00–9:30   | **RCA & postmortem**           | On Incidents read the ranked **probable root cause** and **Export postmortem** (Markdown/JSON). On Performance toggle the **forecast** projection.                                                                                                                                                                                                                    |
| 9:30–10:15  | **Alerts, channels & on-call** | Create a threshold rule with **New rule**, watch it go **Pending → Firing**, see severity-routed **deliveries** on **Notifications**, then set up a team and **rotation** on **On-Call** and read the header on-call badge.                                                                                                                                           |
| 10:15–10:50 | **Monitors & status**          | Add a synthetic monitor on **Monitors**, then open the public **Status** page (`/status`) to show the chrome-less uptime board.                                                                                                                                                                                                                                       |
| 10:50–11:20 | **Explorer & wallboard**       | On **Explorer** run `type:router latency>50` and overlay series, then press `W` to leave it on the rotating **NOC wallboard**.                                                                                                                                                                                                                                        |
| 11:20–12:20 | **Trace, plan & policy**       | On **Path Tracer** trace a route and read the **critical hop** and detour, on **Planner** scale traffic **+100%** and watch utilisation jump, then on **Policy** flip a rule and watch the **reachability matrix** and path explainer update, and on **Resilience** run a chaos experiment against a business service, and on **Compliance** waive a failing finding. |
| 12:20–13:20 | **Automation**                 | On **Automation** create a playbook (e.g. offline → apply runbook), fault a device and watch the run appear in **Recent runs**, then add a **maintenance window** and see the device quiet down, and on **Changes** raise a request, approve it and take it through to verification.                                                                                  |
| 13:20–14:20 | **Time Machine**               | On **Replay** scrub the fleet timeline, **play** back through a fault, **jump to** when an incident opened, and read the **change vs previous frame** diff and biggest metric movers.                                                                                                                                                                                 |
| 14:20–15:20 | **Ask NetScope**               | On **Ask NetScope** (or `Ctrl/Cmd+K` → Ask NetScope) type “which devices are the worst?” then “how do I get from … to …” and follow the cited devices and route.                                                                                                                                                                                                      |
| 15:20–16:20 | **War Room**                   | On **Incidents** open an incident’s **War Room**: read the ranked root cause, **business impact**, blast radius and merged **causal timeline**, post a comms update, **Apply runbook**, then **Time Machine** jumps to when it opened.                                                                                                                                |
| 16:20–17:20 | **Config drift**               | On **Config Drift** toggle **Drifted only**, read the baseline → running **line diff**, **Edit** the running config, then **Accept as baseline** and roll back a version.                                                                                                                                                                                             |
| 17:20–18:20 | **Executive report**           | On **Reports** choose the **Executive summary** preset, scan the sections, then **Print** it or export **Markdown**/**HTML**.                                                                                                                                                                                                                                         |
| 18:20–19:00 | **Topology, geo & reset**      | On **Geo Map** pick a site marker on the world map and read its health, then pan/zoom the **Topology** map, select a node to see its **blast radius**, and **Reset demo** in Settings to reseed the fleet.                                                                                                                                                            |

Handy shortcuts: `Ctrl/Cmd+K` palette · `?` help · `T` theme · `P` pause/resume ·
`F` fault simulator · `A` alerts · `W` wallboard.

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
│   └── {alerts,monitors,channels,automation,dashboard,devices,...}/
├── config/            # navigation definition
├── hooks/             # useSimulation, useTheme, useAlertToasts, useHotkeys
├── lib/               # format, health, tracer, planner, resilience, policy, reachability, oncall, configdiff, configs, compliance, changes, geo, flow, interfaces, ipam, environment, lifecycle, security, routing, qos, reports, services, playbooks, replay, copilot, warroom, alerts, monitors, channels
├── pages/             # one component per route (lazily loaded)
├── simulation/        # seeded PRNG, seed data, metric walk, incident engine
├── storage/           # debounced localStorage + JSON import/export validation
├── store/             # Zustand stores (settings, network, alerts, monitors, channels, automation, policy, oncall, notes, configs, services, compliance, changes, security)
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

658 unit tests across 59 suites cover the pure, high-value logic:

- seeded PRNG determinism, bounds and seed-parameter hashing,
- health-score and severity mapping,
- device filter/sort utilities,
- capacity profiles, the daily traffic curve and utilisation helpers,
- Welford z-score **anomaly detection**, nearest-rank **percentiles** and
  sparkline geometry,
- metric **trend** deltas and series windows,
- **SLO error-budget** and multi-window **burn-rate** maths,
- **linear-regression forecasting** and time-to-saturation projections,
- dependency **blast radius** / **root-cause correlation** on the derived graph,
- **path tracing** (BFS shortest path, alternate/detour routes, per-hop latency
  summing and loss survival-product scoring),
- the **what-if planner** (scenario overlays, sandboxed engine projection
  determinism, baseline-vs-projected deltas and saturation flagging),
- **resilience analysis** (Tarjan articulation points, core selection, stranded
  isolation sets, redundancy ratio and the blended resilience score) and the
  **chaos sandbox** (clone-only combined-fault simulation, service-outcome
  diffing and preset generation),
- the **compliance rule engine** (per-type applicability, config/policy/health
  predicates, category and severity rollups, scoring, waiver keys and weighted
  risk),
- the **change workflow** (state-transition legality, approver stamping, risk
  scoring from scope/type/service tier, window states, overdue detection, schedule
  conflicts, the approval queue and drift-based verification),
- the **geographic projection** (equirectangular site coordinates with a
  deterministic hash fallback, cross-site link rollup, haversine distances and
  the worst-region / slowest-link summary),
- the **flow engine** (deterministic per-device flow generation, application and
  conversation aggregation, east-west vs north-south split, the site×site traffic
  matrix and heavy-hitter detection),
- the **interface inventory** (per-port layout by device type, admin/oper state,
  error counters, throughput distribution and utilisation),
- **IPAM** (CIDR parsing, address-range overlap detection, subnet utilisation and
  free-space maths, VLAN catalog joining and deterministic ledger seeding),
- **environment** power/heat/carbon/cost modelling (load-driven wattage, PUE
  facility rollup, per-site carbon ranking and the efficiency score/grade),
- **asset lifecycle** (age/EOL/warranty day counters, status thresholds, the
  EOL+warranty risk score, refresh-queue filtering and summary rollups),
- the **security detection engine** (MITRE ATT&CK technique detectors over
  fleet/flow/geo, confidence and severity scoring, disposition merging,
  the ATT&CK heat map, top-target ranking and the score/grade rollup),
- the **routing intelligence engine** (deterministic BGP sessions, OSPF areas
  and adjacency state, Dijkstra-derived routing tables, suboptimal-path and
  blackhole detection, convergence timelines and control-plane health),
- the **QoS engine** (application→class classification, DSCP marking and
  weighted-fair allocation, tail-drop maths, starvation and priority-inversion
  detection, policy scoring and the clone-only what-if reshaper),
- **runbook** matching plus the auto-remediation store action,
- incident **postmortem** assembly and Markdown/JSON rendering,
- the **alert rules engine** (operator comparison, scope matching, metric
  derivation and pending → firing → resolved transitions),
- **wallboard panel rotation** indexing and progress,
- the **explorer query language** (token parsing, alias resolution, field and
  metric-comparison matching) and time-window **series alignment**,
- **synthetic monitor targeting** (device, site or fleet), status derivation,
  per-check averaging and rolling uptime,
- **channel routing and escalation** (severity thresholds, escalation levels and
  final-page targeting),
- **automation playbooks** (trigger/scope matching, severity floors, per-device
  cooldowns and run planning) and **maintenance-window** activity, scoping and
  suppression,
- **Time Machine replay** (frame capture and aggregates, bounded ring-buffer
  trimming, nearest-frame seeking, incident-open detection and frame-to-frame
  status/metric diffing),
- **Ask NetScope intent parsing** (fleet/device/site status, counts, ranking by
  metric or health, incidents, capacity, routing and SLO answers),
- **War Room assembly** (incident runner, causal event/note merge and ordering,
  root-cause correlation and dependent blast-radius exclusion),
- the **firewall policy model** (selector/port/proto matching, first-match
  evaluation with default-deny and rule coverage/shadow/redundancy analysis),
- **reachability** (undirected physical pathing, all-pairs and path-explanation
  under policy, offline-hop detection and what-if impact diffing),
- **on-call scheduling** (slot indexing before/after the anchor, member cycling,
  handoff windows and the wrap-around escalation chain),
- **configuration diffing** (LCS line diffing, change summary and collapsed
  unified output) and **drift detection** (deterministic baseline generation,
  CRLF-tolerant comparison and fleet-wide drift summaries),
- **executive report assembly** (canonical section ordering and filtering,
  headline/health rollups, incident ranking, change-log scoping and on-call
  coverage) and Markdown/HTML rendering (self-contained inline-styled document
  with HTML-escaped content and inline SVG sparklines),
- **business service mapping** (device/site resolution and coverage, tier/impact
  weighting, live service health and uptime, per-incident business impact and the
  ranked business-risk rollup),
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
