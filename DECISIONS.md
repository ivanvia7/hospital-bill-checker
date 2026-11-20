# Decisions

## 2026-11-20 — Compare with one plan, not every plan the payer text matches
**Decided:** `--payer` must name one plan; several matches list them and stop, the web page shows a plan picker.
**Why:** "aetna" matched 29 NYU plans; the highest, Aetna Indemnity, equals the list price, so a $300 lab line paid $26.51 by Aetna PPO never flagged.
**Rules out:** showing the highest rate across plans as "plan".
