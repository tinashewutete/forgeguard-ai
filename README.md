# ForgeGuard AI — Explainable Predictive Maintenance

**Hackathon Problem Statement 8: Intelligent Predictive Maintenance and Machine Failure Detection**

ForgeGuard AI is a browser-based predictive maintenance platform for a simulated university fabrication laboratory operating CNC machines, 3D printers, and induction motors. It analyses simulated telemetry — temperature, vibration, motor current, RPM, workload, and service hours — to detect gradual degradation patterns, estimate failure risk, identify the likely failure mode, and generate actionable maintenance recommendations before unplanned failures occur.

Everything runs **in the browser, offline**: models are trained ahead of time into a JSON artifact and executed client-side via pure TypeScript. Supabase is optional for shared history.

> **Honesty note:** All telemetry is **simulated** by a physics-inspired generator. All evaluation metrics are computed on **synthetic held-out trajectories**. They demonstrate that the pipeline works end-to-end; they are not industrial validation on real machines.

---

## Quick start

```bash
cd forgeguard-ai
npm install
npm run dev          # http://localhost:5173
```

Open in a browser. Click **Judge Demo** (top right) and enable **Autopilot** for the ~2-minute guided story.

| Command | Purpose |
|---|---|
| `npm run dev` | Development server (hot reload) |
| `npm run build` | Typecheck + production build → `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run test` | Vitest unit/integration tests (20 tests: ML, fleet engine, demo script, persistence) |
| `npm run typecheck` / `npm run lint` | Strict TypeScript check (no output = pass) |
| `npm run train` | Regenerate the synthetic dataset, retrain all models, write `public/models/forgeguard-model.json` |
| `npm run analyze` | Detection-by-horizon analysis script |

Optional cloud history: copy `.env.example` to `.env` and set `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`, then apply the migration in `supabase/migrations/`. Without it the sidebar shows "Offline mode" and history is stored in `localStorage`.

---

## What it does

| Area | Feature |
|---|---|
| **Fleet** | 10 simulated machines: CNC mills (Haas VF-2SS, DMG Mori CMX), CNC lathes (Haas ST-20, Okuma LB3000), 3D printers (Markforged X7, Ultimaker S5, Prusa XL), induction motors (Siemens 1LE1, ABB M3BP, WEG W22) |
| **Telemetry** | Machine-specific baselines, shift job cycles, thermal inertia, sensor noise & drift, progressive degradation, hard failure |
| **AI models** | Random-forest risk classifier, failure-mode classifier, time-to-failure regressor, isolation-forest anomaly detector — all in a single ~1 MB JSON artifact |
| **Features** | 21 temporal features over 30-min and 3-h windows: load-adjusted baseline deviation, slopes, rate of change, volatility, impulse rate, % time above threshold, RPM jitter, current-per-load, service age |
| **Risk output** | Risk index 0–100 (severity-weighted forest class votes, **not** a calibrated probability of failure) · Normal < 40 · Warning < 70 · Critical ≥ 70 |
| **Other outputs** | Class vote shares, heuristic model-agreement score, risk trend /h, health index (0–100), subsystem health breakdown, failure mode, TTF estimate + uncertainty range, anomaly score |
| **Explainability** | Exact additive tree-path attribution: `base rate ± factor points = risk index`, grouped by sensor with human-readable evidence |
| **Recommendations** | Failure-mode playbooks → recommended action, maintenance window, checks, consequence if ignored, estimated downtime |
| **Workflow** | Debounced alerts → acknowledge → schedule work order → start inspection → record findings/repair → automatic recovery verification on fresh telemetry |
| **Fleet ops** | Priority queue (risk + TTF + trend + anomaly), risk scatter map, machine comparison (up to 5) |
| **What-if** | Adjust temperature, vibration, current, RPM instability, workload, service age — re-runs the real model on modified telemetry |
| **Transparency** | Model page: dataset, split, confusion matrices, precision/recall/F1, ROC-AUC, anomaly FPR, TTF MAE & coverage, warning lead time, permutation importance, fixed-threshold comparison table |
| **Extras** | Judge demo with autopilot, offline maintenance copilot, print-ready incident report (PDF via browser print), Markdown + CSV export, selectable telemetry windows, responsive layout, error boundaries, rule-based fallback |

---

## Judge demo script (~2 minutes)

1. **Load the app** at `http://localhost:5173`
2. Click **Judge Demo** (top-right button or on the hero banner) — this clears any stale records and starts fresh
3. Enable **Autopilot** in the demo bar — the simulation auto-advances through each step
4. The demo bar shows the current step and narration. Watch:
   - **Step 1 — Healthy baseline:** CNC Mill 01 running normally; risk index low, health high
   - **Step 2 — Hidden bearing wear begins:** Degradation silently injected by the simulator — the model must discover it from telemetry
   - **Step 3 — Anomaly detected:** Isolation forest flags the vibration window as unusual; risk starts climbing
   - **Step 4 — Warning:** Risk index crosses 40/100; debounced warning alert raised with failure mode and TTF estimate
   - **Step 5 — Critical / Schedule:** Risk crosses 70/100; click **Schedule maintenance** (or let autopilot do it)
   - **Step 6 — Repair:** Autopilot completes the work order with realistic findings and repair notes
   - **Step 7 — Recovery verified:** Fresh telemetry confirms risk is back in the normal band
   - **Step 8 — Impact:** Simulated downtime and cost estimates (labelled as simulated)
5. Navigate to **Machine CNC Mill 01** to see telemetry charts, the "Why this prediction?" explanation, and the maintenance timeline
6. Open **Model & evaluation** → scroll to the **threshold comparison** table to explain why temporal analysis matters vs a fixed vibration alarm
7. Press **Reset** (↺ icon in the top bar) to replay the demo from scratch

---

## Synthetic evaluation results (held-out test trajectories)

> These metrics are from synthetic data generated by the same simulator — they show the pipeline is working, not real-world industrial validation.

| Metric | Result |
|---|---|
| Risk class accuracy | From model artifact (see Model & evaluation page) |
| ROC-AUC (at-risk vs normal) | From model artifact |
| Failures caught in advance | From model artifact |
| False alarms per 1,000 h | From model artifact |
| Median warning lead time | From model artifact |

Run `npm run train` to see the full training log and regenerate the model artifact with fresh metrics.

---

## Architecture

```
src/
  components/    Layout, charts, DemoBar, Copilot, work-order dialog, UI primitives
  lib/           Router, formatting, fleet-view helpers, exports
  ml/
    data/        Machine definitions (FLEET), synthetic data generator
    models/      Random forest, isolation forest, model bundle type
    features/    Feature engineering (21 features, rolling windows)
    inference/   Inference engine, knowledge base (failure playbooks)
    training/    Training pipeline (run via npm run train)
    evaluation/  Metrics (confusion matrix, ROC-AUC, quantile)
  pages/         Overview, MachinePage, AlertsPage, MaintenancePage, WhatIfPage,
                 ComparePage, ModelPage, HowItWorks
  sim/           FleetEngine (simulation tick, degradation, alerts), WhatIfEngine
  state/         AppContext (model loading, simulation loop, demo logic), RecordsStore, demo steps
scripts/         train.ts, detection-by-horizon.ts
supabase/        migrations/
public/models/   forgeguard-model.json (pre-trained artifact)
```

---

## Known limitations

- **Synthetic data only.** Training and evaluation are performed on simulator-generated trajectories. Real deployment requires retraining on historian exports and site-specific validation.
- **Time-to-failure is an estimate.** The range (10th–90th percentile of tree outputs, widened by fixed factors) is a spread of model estimates, not a validated confidence interval or certified remaining useful life.
- **Five failure modes.** Unseen failure mechanisms will surface through the anomaly detector rather than a named diagnosis.
- **Risk index ≠ probability.** The 0–100 risk index is severity-weighted forest class votes. It is not a calibrated probability of failure within a defined time window.
- **Model agreement ≠ calibrated confidence.** It is a heuristic combining top class vote share and vote entropy.
- **Fixed-threshold comparison is illustrative.** The comparison table in Model & evaluation shows qualitative differences based on the simulated scenario. It is not a controlled trial on real machines.
- **No real sensor ingestion.** The "Real-world deployment architecture" section on the How it works page describes future scope; it is not implemented.
