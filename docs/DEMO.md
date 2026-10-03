# ForgeGuard AI — Demo & Pitch

## 30-second pitch

Unplanned downtime costs manufacturers far more than planned maintenance. ForgeGuard AI watches every machine's temperature, vibration, current, speed and workload, learns what *healthy under this load* looks like, and spots slow degradation days before a breakdown. It doesn't just say "risk 77 %": it says *bearing wear, driven by vibration +140 % over baseline, about 5 hours to failure — inspect the spindle bearing this shift*, and then tracks the repair until recovery is verified. It runs entirely in the browser, offline, with models we trained and evaluated ourselves.

## Setup before presenting

1. `npm run build && npm run preview` (or `npm run dev`). Open the app full-screen.
2. Optional: open **Model & evaluation** in a second tab.
3. The judge demo clears local history to start a clean story.

## 3-minute judge script

| Time | Action | Say |
| --- | --- | --- |
| 0:00 | Fleet overview | "Ten simulated machines streaming telemetry every simulated minute. Three are already degrading — the priority queue ranks them by risk, time-to-failure and trend." |
| 0:20 | Click **Judge demo**, tick **Autopilot** | "Let's follow CNC Mill 01 from healthy to failure and back." |
| 0:30 | Step 1–2 | "Read the risk index and health from the screen (both should be low and high respectively). We now start hidden bearing wear — nothing a threshold alarm would catch yet." |
| 0:50 | Step 3 (abnormal pattern) | "The isolation forest flags the pattern as abnormal before the risk class changes." |
| 1:05 | Step 4 (warning) | "Warning: the model has seen vibration trending up relative to the load-adjusted baseline for hours. Note the time-to-failure range." |
| 1:30 | Step 5 (critical) | Scroll to **Why this prediction?** — "Exact attribution: base rate plus each sensor's points equals the risk. Vibration dominates; diagnosis is bearing wear; the playbook says inspect this shift." |
| 1:55 | Step 6 → click **Schedule maintenance** if not on autopilot | "One click creates a P1 work order with the failure mode and checks." |
| 2:10 | Step 7–8 | "Repair recorded; ForgeGuard collects fresh telemetry and *verifies* recovery — read the risk index before and after on the Machine page banner." |
| 2:30 | Step 9 (impact) | "We caught it ~9 hours ahead, avoiding an estimated 15 hours of unplanned downtime — simulated figures, clearly labelled." |
| 2:45 | **Model & evaluation** | "Trained on 22,000 simulated machine-hours, split by machine to avoid leakage; critical ROC-AUC 0.98, warnings ~25 h before failure, zero false alarms on healthy machines. All synthetic, and we say so." |

## 5-minute extended script

Add after the 3-minute flow:

1. **What-if (45 s)** — choose CNC Mill 04, apply "Overload shift (95% load)" preset: risk barely moves (load-adjusted). Apply "Bearing defect developing": risk jumps and vibration becomes the top factor. "The model reacts to *abnormal* behaviour, not just high numbers."
2. **Compare (20 s)** — select three machines; show different failure modes and drivers.
3. **Alert center & maintenance (30 s)** — acknowledge an alert, show the kanban and verified repair with before/after.
4. **Copilot (20 s)** — ask "Which machine needs attention first?" — answers come from live state.
5. **Exports (15 s)** — download the incident report for the critical machine.
6. **How it works (30 s)** — pipeline and production architecture (sensors → gateway → stream → model → CMMS).

## Likely judge questions

- *Is it real ML?* Yes — random forests and an isolation forest implemented in TypeScript, trained by `npm run train`, evaluated on held-out trajectories, executed live in the browser. A rule-based fallback is labelled as such.
- *Why trees, not deep learning?* Tabular temporal features, small data, need for exact explanations and in-browser inference.
- *How would it work on real machines?* Replace the generator with OPC UA/MQTT ingestion, fit baselines per machine, retrain on labelled maintenance history.
- *Weakest point?* Warning recall (~0.48) and synthetic data; we show both openly.

## Problem 8 checklist

| Requirement | Where |
| --- | --- |
| Collect machine sensor data (temperature, vibration, current, RPM, workload, hours) | Machine page telemetry charts, CSV export |
| Normal / degrading / near-failure / failed states | Fleet, simulator controls, failure events |
| Detect abnormal behaviour | Isolation-forest anomaly score |
| Predict failure risk & classify Normal / Warning / Critical | Risk ring, alerts, fleet queue |
| Temporal analysis, not single thresholds | 21 windowed features, trend per hour |
| Explain causes | "Why this prediction?" additive attribution |
| Identify failure type | Failure-mode classifier with probabilities |
| Estimate time to failure | TTF regressor with range |
| Maintenance recommendations | Playbook card with window, actions, checks |
| Automatic alerts | Debounced alerts, toasts, alert center |
| Maintenance workflow & history | Work orders, timeline, recovery verification, persistence |
| Fleet prioritisation & comparison | Priority queue, risk map, compare page |
| Model transparency | Model & evaluation page |
| Works offline | All inference client-side; localStorage history |
