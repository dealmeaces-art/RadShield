# RadShield — sample scenarios

Ready-to-load example scenes built with RadShield, with a rendered demonstration.

## Demineralizer behind a 6 ft concrete shield

**Scenario.** A cylindrical demineralizer (24" diameter × 48" tall, water-filled)
sits inside a solid concrete cube 6 ft on a side, with a 3 ft × 3 ft × 5 ft cavity
machined into the top — so there is **18" of concrete on every side**, a **12"
concrete floor**, and the cavity is **open at the top**.

Reactor-plant water at **0.1 µCi/mL** of Co-60 is pumped through the bed at
**10 GPM**; **5,000 gallons** are processed and **100 % of the activity is
captured** in the demineralizer. That works out to:

| Quantity | Value |
|---|---|
| Total water processed | 5,000 gal = 18,927,059 mL |
| Total activity captured | 0.1 µCi/mL × 18.93 M mL = **1.89 Ci** Co-60 |
| Pumping duration | 5,000 gal ÷ 10 GPM = **500 min (8.3 hr)** |
| Accumulation | linear (constant concentration, constant flow, full capture) |

**What the model shows.** As the bed loads, the dose climbs in proportion to the
captured activity. The 18" concrete walls hold the **side-wall contact** dose to a
low level, but the **open top streams** — the dose 1 ft above the opening is more
than an order of magnitude higher than at the shielded wall:

| Time | Captured | Side wall (contact) | 1 ft above open top |
|---:|---:|---:|---:|
| 15 min | 0.06 Ci | 0.5 mrem/hr | 25 mrem/hr |
| 100 min | 0.38 Ci | 3.2 mrem/hr | 165 mrem/hr |
| 300 min | 1.14 Ci | 9.5 mrem/hr | 494 mrem/hr |
| 500 min (full) | 1.89 Ci | 16 mrem/hr | 824 mrem/hr |

The takeaway a shielding review wants at a glance: **the concrete does its job on
the sides; the streaming path is the open top.** Cap or plug the opening and the
dominant exposure route closes.

### Files
- **`demineralizer.json`** — the scene. In RadShield click **Load** and pick this
  file. You'll get the concrete shield, the cavity, the demineralizer source
  (Co-60, set to the full 1.89 Ci end-state), three dose points, and isodose
  levels (100 / 20 / 2 mrem/hr) preconfigured. Click **Generate Isodose Surfaces**
  (Analyze tab) to draw the field.
- **`demineralizer_field_growth.gif`** — the rendered time-lapse of the radiation
  field expanding as the bed loads from 0 to 1.89 Ci over the 500-minute run.
- **`demineralizer_full_load.png`** — the fully-loaded end state (still image).

### Reproduce the time simulation yourself
1. **Load** `demineralizer.json`.
2. Select the **Demineralizer** and set its **Activity** to **0 Ci** (it starts empty).
3. Go to the **Simulate** tab. Set **Duration = 500 min**, **Time Steps = 50**.
4. Add a **Transfer**: From **(outside scene)** → To **Demineralizer**, **1.89 Ci**,
   curve **Linear**.
5. Press **Run Simulation**, then play the scrubber. Read the **peak** and
   **integrated dose** per dose point in the summary table.

*Generated with RadShield v0.6. Dose rates are point-kernel estimates
(ANSI/ANS-6.4.3 buildup, NIST attenuation data) — see the Design Document.*
