# ForgeGuard AI — Architecture

## System overview

```
                OFFLINE (npm run train)                                   BROWSER (runtime, offline-capable)
┌──────────────────────────────────────────┐        ┌──────────────────────────────────────────────────────────────────┐
│ Seeded telemetry generator               │        │ FleetEngine (1 sim-minute steps, 10 machines)                    │
│  240 trajectories, 5 failure modes       │        │   generator → rolling buffers → features (30 min / 3 h)          │
│        ↓                                 │        │        ↓                                                         │
│ Temporal feature extraction (21)         │        │ InferenceEngine ── risk RF ─ mode RF ─ TTF RF ─ isolation forest │
│        ↓                                 │  JSON  │        ↓                     ↘ path attribution → factors        │
│ Train RF ×3 + isolation forest           │ ─────► │ Prediction → playbook recommendation                             │
│ Trajectory split, depth tuned on val     │ model  │        ↓                                                         │
│ Evaluate on held-out test trajectories   │        │ Debounced alerts → RecordsStore (localStorage ⇄ Supabase)        │
└──────────────────────────────────────────┘        │        ↓                                                         │
                                                    │ React UI: fleet, machine, alerts, work orders, what-if, model    │
                                                    └──────────────────────────────────────────────────────────────────┘
```

If the model artifact cannot be loaded or inference throws, a rule-based predictor (baseline-deviation scoring) takes over and every view is labelled "Rule-based".

## Synthetic data generation (`src/ml/data/generator.ts`)

Each machine type (CNC, lathe, printer, motor) has nominal temperature, vibration, current and RPM, plus the failure modes it can exhibit. Per simulated minute:

- **Workload**: jobs of random length and intensity, shift pattern; RPM set-point follows the job.
- **Thermal inertia**: temperature relaxes toward a load- and ambient-dependent target (first-order lag); ambient follows a daily cycle.
- **Sensor realism**: Gaussian noise, slow random-walk drift, occasional spikes.
- **Degradation**: a hidden progress variable `p` rises along a power curve (`shape` ≈ 2) toward failure at `hoursToFailure`. Each mode affects signals differently:
  - bearing wear → vibration amplitude and spikes, later heat;
  - overheating → temperature rise disproportionate to load;
  - motor overload → current per unit load and heat;
  - electrical anomaly → current volatility and spikes;
  - RPM instability → speed jitter and vibration.
- **Failure**: at `p = 1` the machine trips; telemetry collapses to idle.

Labels come from ground-truth time-to-failure: Critical ≤ 8 h, Warning ≤ 36 h, otherwise Normal.

## Features (`src/ml/features.ts`)

Signals are first normalised against a **load-adjusted baseline** (`expected = a·load + b`, fitted on healthy data per sensor) so a heavy job is not mistaken for a fault. Over a 3-h window with a 30-min short window: deviation from baseline, slope per hour, rate of change, volatility, % of time beyond 3σ, vibration spike rate, RPM jitter and its trend, mean/volatility of load, thermal-to-load ratio, current-per-load and service age.

## Models (`src/ml/models`, `src/ml/training`)

All models are implemented in dependency-free TypeScript so the same code trains in Node and infers in the browser.

| Model | Purpose | Notes |
| --- | --- | --- |
| Random forest classifier (48 trees) | Normal / Warning / Critical vote shares (uncalibrated) | Risk = Σ p(class) × {0, 55, 100}; depth chosen on validation macro-F1 |
| Random forest classifier (32 trees) | Failure mode | Trained on degrading windows only |
| Random forest regressor (32 trees) | Hours to failure | Median of tree estimates; range = 10th percentile ×0.8 to 90th percentile ×1.25 |
| Isolation forest | Anomaly score | Trained on healthy windows; threshold = healthy validation 99th percentile |

Splits are **by trajectory** (train 168 / validation 48 / test 24) so overlapping windows from one machine never leak across sets. Training is seeded and deterministic.

## Explainability

For each tree, the prediction is decomposed along the decision path: the change in node value at each split is attributed to the split feature (Saabas-style path attribution). Averaged across the forest and mapped through the risk weights, this gives an exact additive explanation:

```
risk = fleet base rate + Σ_features contribution
```

Contributions are aggregated into vibration, temperature, current, RPM, workload and service groups and shown with human-readable evidence (e.g. "+93 % vs load-adjusted baseline · trend +4 %/h · 100 % of last 3 h abnormal"). Global importance on the model page is permutation importance on the test set.

## Health index

Health (0–100) is a **rule-based** condition index separate from risk: each subsystem (vibration, thermal, electrical, rotational, load/service) is scored from its baseline deviation; overall health blends the average with the weakest subsystem and subtracts an anomaly penalty. Risk is the model's probability-weighted failure risk.

## Alerting and workflow (`src/sim/fleet.ts`, `src/state/AppContext.tsx`)

- Alerts fire when a machine's condition worsens and stays there for consecutive predictions (debounce), one alert per escalation level.
- Alert lifecycle: open → acknowledged → scheduled → resolved.
- Work-order lifecycle: scheduled → in progress (machine taken offline) → completed (findings + action recorded, machine repaired).
- After repair the window restarts; ForgeGuard collects 45 min of fresh telemetry and records **recovery verified** (or flags that risk is still elevated) with before/after risk and health.

## Data model

Local records (`src/state/records.ts`) — authoritative, stored in `localStorage`:

| Record | Key fields |
| --- | --- |
| AlertRecord | id, machineId, severity, risk, confidence, failureMode, factors, trendPerHour, recommendation, status, source (model/rules) |
| WorkOrder | id, machineId, failureMode, priority P1–P3, status, technician, scheduledFor, riskBefore/After, healthBefore/After, findings, actionTaken, verified |
| TimelineEvent | id, machineId, kind (alert, acknowledged, scheduled, inspection, repair, verified, failure), title, detail, createdAt |

Supabase mirror (`supabase/migrations/`): `machine_alerts` and `maintenance_events` with RLS enabled. Writes are best-effort; failures surface as "Sync error" without blocking the UI.

## Service boundaries (for a production deployment)

| Today (browser) | Production equivalent |
| --- | --- |
| `generator.ts` | Sensors / PLC / CNC controller via OPC UA or MQTT through an edge gateway |
| `FleetEngine` buffers | Stream ingestion (Kafka / IoT Hub) + time-series DB |
| `InferenceEngine` (JSON model) | Same model served at the edge or as a scoring service; retrained on labelled maintenance history |
| `RecordsStore` | Supabase/Postgres + CMMS integration (SAP PM, Maximo, Fiix) |
| Toasts | SMS / Teams / e-mail escalation |

## Limitations

- Telemetry and metrics are synthetic; real deployment needs per-site baselines and labelled failure history.
- TTF is a model estimate with a range, not certified remaining useful life.
- Warning-class recall (~0.48) is the weakest metric — borderline windows are inherently ambiguous.
- Path attribution is an approximation of feature influence, not causal proof.
- No authentication; the Supabase policies are for a shared single-tenant demo.
