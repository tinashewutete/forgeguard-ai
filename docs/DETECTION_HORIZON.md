# Detection horizon — how early does ForgeGuard catch degradation?

**All numbers: simulated machines, held-out test trajectories (24 machines, never seen in training). Reproduce with `npm run analyze`.**

Overall Warning recall (0.48) looks weak, but it mixes two very different situations. Labels are defined by *time-to-failure* (Warning ≤ 36 h, Critical ≤ 8 h), so the earliest Warning windows are machines that are still barely degraded. Splitting the same predictions by horizon:

| Time before failure | Windows | Flagged Warning-or-worse | Flagged Critical |
| --- | --- | --- | --- |
| Healthy machines (no failure) | 1,232 | **0 %** | 0 % |
| 36–24 h | 1,360 | 29 % | 0 % |
| 24–16 h | 908 | 56 % | 1 % |
| 16–8 h | 907 | **92 %** | 23 % |
| ≤ 8 h | 905 | **100 %** | 79 % |

## How to say it in the pitch
- "On simulated held-out machines, ForgeGuard raised no false flags on healthy machines, flagged 92 % of windows by 16 h before failure, and 100 % inside the last 8 h."
- "Confidence grows as the degradation trajectory becomes visible — it does not guess at day-old, near-invisible drift."

## Honest caveats (say these before a judge asks)
- Synthetic data: this shows the pipeline works, not industrial accuracy.
- The 36–24 h band is mostly undetectable *by design* — the simulated sensors have barely moved. Lowering the Warning threshold would catch more of it but would start flagging healthy machines; the trade-off is a tuning choice that real maintenance data should settle.
- Healthy-machine row covers machines that never failed in the test set; early healthy stretches of failing machines are labelled Normal in the main confusion matrix.
