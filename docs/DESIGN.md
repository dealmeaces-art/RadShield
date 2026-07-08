# RadShield — Design Document: Radiological & Shielding Calculations

*For RadShield v0.6. This document describes exactly how the code computes dose rates — the method, the equations, the data and its provenance, and the approximations. File references point at the modules in `src/`. This is the terse engineering source-of-truth; for a polished, manager-facing version of the same material (executive summary, figures, standards emphasis, cross-references) see **`RadShield_Design_Document.html`** in the repo root, built from `docs/design_src.html` via `node tools/build_design.js`.*

---

## 1. Method overview

RadShield implements the classical **point-kernel method with buildup factors** — the same family of method used by MicroShield and similar codes:

1. Every **source volume** is subdivided ("meshed") into hundreds of small elements, each treated as an isotropic point source carrying its share of the total activity (`geometry.js → meshSource`).
2. For each element × each gamma line of the isotope, a **ray is traced** from the element to the dose point through the 3D scene, producing an ordered list of material layers and their thicknesses (`geometry.js → SceneModel.rayTrace`).
3. The **uncollided photon fluence** at the dose point is computed from the inverse-square law and exponential attenuation through those layers (`physics.js → pointSourceDose`).
4. Scattered radiation is accounted for by multiplying by an energy- and depth-dependent **buildup factor** (ANS-6.4.3 Geometric-Progression form, `materials.js → getBuildup`).
5. Fluence is converted to **exposure/dose rate** using the mass energy-absorption coefficient of air, and summed over all gamma lines and all source elements.

It is a deterministic method: no Monte Carlo, no random numbers, fully repeatable.

---

## 2. Units and conventions

| Quantity | Internal unit | UI unit |
|----------|--------------|---------|
| Length | cm | inches (ft in some labels) |
| Activity | Ci (converted to Bq internally) | Ci |
| Energy | MeV | — |
| Dose rate | mrem/hr (mrad/hr with QF = 1) | mrem/hr or mSv/hr |

- Coordinate system: right-handed, **Y up**. The scene origin is wherever you put it — for the tank template it's the center of the tank at floor level.
- A volume's `position` is its **bottom center** (sphere: bottom point). `rotation` is Euler angles in degrees, applied in three.js `'XYZ'` order; `geometry.js` builds the identical rotation matrix so physics and rendering always agree.
- Dose equivalence: for gamma rays the quality factor is 1, so mrad ≈ mrem is used directly; mSv = mrem / 100.

---

## 3. Geometry engine (`geometry.js`)

### 3.1 Volumes

Every object is a `Volume` subclass with an analytic shape in its own local frame (axis along +Y, bottom center at origin). World↔local transforms handle position and rotation, so shape math never sees rotation:

| Class | Shape | Ray intersection |
|-------|-------|------------------|
| `CylinderVolume` | Solid cylinder (radius, height) | Quadratic for the side wall + two cap planes |
| `AnnulusVolume` | Hollow cylinder (inner/outer radius, height) | Quadratics for both walls + annular caps |
| `DiskVolume` | Thin cylinder (radius, thickness) | Same as cylinder |
| `BoxVolume` | Rectangular solid (width X, depth Z, height Y) | Slab method (three axis-aligned slab intervals intersected) |
| `SphereVolume` | Solid sphere (radius; center at +radius above position) | Quadratic |

Each volume carries: `role` (`source` / `shield` / `container`), `materialKey`, `priority`, `visible` (display only), and `enabled` — **a volume with `enabled = false` is excluded from every physics query** (ray-trace, material lookup, meshing, activity totals).

### 3.2 Material at a point — the priority rule

`getMaterialAt(x, y, z)` asks every enabled volume whether it contains the point; among the containers, the **highest `priority` wins**; if none contain it, the material is **air**. This is how overlapping shapes compose: a plug (priority 55) inside a lid opening (lid priority 50) reads as plug material; a source disk (priority 20) inside the water column (priority 10) reads as source.

### 3.3 Ray tracing

`rayTrace(from, to)`:

1. Normalize the ray; collect the parametric distances `t` of every surface crossing of every **enabled** volume (each shape's analytic `rayIntersect`), plus the two endpoints.
2. Sort the boundary set. Between each consecutive pair of boundaries the material cannot change, so the **midpoint** of each segment is sampled with `getMaterialAt` (priority rule applied).
3. Adjacent segments with the same material are merged. The result is an ordered list `[{materialKey, thickness_cm}]` from source to dose point — including air gaps and including the source's own material (self-absorption is therefore included naturally).

### 3.4 Source meshing

Sources are subdivided so the finite extent of the source (and self-shielding within it) is integrated rather than treated as one point. Each element gets activity proportional to its volume, positions at cell centroids, all mapped through the volume's rotation:

- **Cylinder/Disk** — cylindrical grid: `nr` radial shells × `nθ` angular sectors × `nz` axial slabs. Element volume `= ½ (r_o² − r_i²) Δθ Δz`.
- **Box** — Cartesian grid (`nθ` → X and Z counts, `nz` → Y count). Element volume `= Δx Δy Δz`.
- **Sphere** — spherical grid: `nr` radial shells × `nθ` azimuthal sectors × equal-`cos φ` polar bands (equal solid angle). Element volume `= ⅓ (r_o³ − r_i³)(cos φ₁ − cos φ₂) Δθ`.

Activity is exactly conserved: Σ element activities = source activity (regression-tested). Mesh density presets (dose-point calculation): Coarse 3×6×6, Medium 5×8×10, Fine 8×12×16, Very Fine 12×16×24 (per source). Isodose generation uses a fixed 5×16×8 = 640 elements per source.

---

## 4. Point-kernel dose calculation (`physics.js → pointSourceDose`)

For one source element (activity `A` Ci) and one gamma line (energy `E` MeV, yield `y` photons/disintegration), at distance `r` cm through layers `i`:

**Step 1 — emission rate**

```
S = A × 3.7×10¹⁰ × y            [photons/s]
```

**Step 2 — uncollided fluence rate** (inverse square)

```
φ_unc = S / (4π r²)              [photons/(cm²·s)]
```

**Step 3 — attenuation: total mean free paths along the ray**

```
x = Σᵢ μᵢ(E) · tᵢ                [dimensionless, "mfp"]
μᵢ(E) = (μ/ρ)ᵢ(E) · ρᵢ           [cm⁻¹]
```

`(μ/ρ)ᵢ(E)` is the **total mass attenuation coefficient** from NIST XCOM (§6.1), log-log interpolated in energy; `ρᵢ` is the material density. If *Include air attenuation* is off, air layers are skipped in this sum.

**Step 4 — buildup factor** `B(E, x)` — see §5. Applied using the GP coefficients of the **outermost significant material** (§5.3).

**Step 5 — attenuated fluence with buildup**

```
φ = φ_unc · B(E, x) · e⁻ˣ
```

**Step 6 — fluence → dose rate.** Using the mass energy-absorption coefficient of **air** (exposure-type response):

```
Ḋ = φ · E · (μ_en/ρ)_air(E) · C
```

with the conversion constant

```
C = 1.602×10⁻⁶ [erg/MeV] × 3600 [s/hr] × 1000 [mrad/rad] ÷ 100 [erg/(g·rad)]
  = 5.767×10⁻²   [mrad/hr per (photon/(cm²·s)) · MeV · (cm²/g)]
```

With QF = 1 for photons, mrad/hr is reported as mrem/hr; mSv/hr = mrem/hr ÷ 100.

**Step 7 — summation.** The scene dose rate is the double sum over all source elements and all gamma lines (`volumetricSourceDose`), each element with its own ray-trace. **Each element carries the isotope of the source volume it was meshed from**, so mixed-isotope scenes (e.g., a Co-60 tank plus a Cs-137 bottle) transport every source with its own gamma lines. Guard: if `r < 0.01 cm` (dose point inside a source element) the result is reported as infinite.

### 4.1 Unshielded quick-reference

The results panel also shows a bare point-source check using the isotope's **specific gamma-ray constant** Γ:

```
Ẋ [R/hr] = Γ · A / d²      (A in Ci, d in meters)
```

summed per enabled source, each with its own Γ and its own center-to-dose-point distance. This is *not* used in the main calculation — it's a sanity check and the basis of the displayed "Shielding Factor" (unshielded ÷ calculated).

---

## 5. Buildup factors (`materials.js → getBuildup`)

Exponential attenuation alone counts only photons that arrive *uncollided*. In thick shields, photons that Compton-scatter one or more times still reach the dose point with degraded energy. The **buildup factor** `B ≥ 1` corrects for this scattered component.

### 5.1 The Geometric-Progression (GP) form

RadShield uses the GP fitting form standardized in **ANSI/ANS-6.4.3-1991** (point isotropic source, infinite homogeneous medium):

```
B(E, x) = 1 + (b − 1)(Kˣ − 1)/(K − 1)        if K ≠ 1
B(E, x) = 1 + (b − 1)·x                       if K = 1

K(x) = c·xᵃ + d · [tanh(x/X_k − 2) − tanh(−2)] / [1 − tanh(−2)]
```

where `x` is the depth in mean free paths and `{b, c, a, d, X_k}` are the tabulated GP coefficients per material per energy. `b` is the 1-mfp buildup factor; `K(x)` is the dose-multiplication ratio per mfp. The fits are valid to **x ≤ 40 mfp**, energies 0.015–15 MeV.

### 5.2 Coefficient provenance

The GP coefficient tables in `materials.js` were transcribed from the actual **ANSI/ANS-6.4.3-1991 standard, Table 5.1** (the PDF is in the repo root):

- **Exposure** buildup coefficient sets for **water, iron (used for carbon steel), concrete** — full 0.015–15 MeV grids (25 energies), and **lead** — 0.03–15 MeV including the K-edge fine structure (31 energies, with the 0.088/0.089 MeV discontinuity).
- **Air** uses the standard's **energy-absorption** GP set — the 1991 standard publishes no exposure set for air; for low-Z media the two differ by <~2%, and air is never the dominant buildup medium here.
- Coefficients are interpolated between grid energies **linearly in ln E** (each of b, c, a, d, X_k independently); the lead K-edge is handled by the dense grid rather than special-casing.
- **Verification**: `tests/buildup_check.js` recomputes 28 buildup factors and compares against the standard's own tabulated Table 3 values — all within 2% (e.g., lead B(1 MeV, 10 mfp) = 3.50 vs 3.51 table; iron B(1 MeV, 10 mfp) = 15.7 vs 15.8; water B(1 MeV, 10 mfp) = 26.4 vs 26.1).

### 5.3 Multi-layer shields — the "outermost material" method

GP data is defined for a single homogeneous medium; real shield stacks (water → steel → lead → air) need an engineering rule. RadShield uses the standard MicroShield-style approximation:

> Compute the total mfp `x` through **all** layers, then evaluate `B(E, x)` with the GP coefficients of the **last significant material** along the ray — the material nearest the dose point with a non-negligible optical thickness (mfp > 0.001), air excluded.

Physical rationale: the scattered-photon spectrum arriving at the dose point is shaped predominantly by the last shield it traversed. This is exact for a single material, good when the outer layer is ≥~2 mfp, and least accurate for thin high-Z outer liners over thick low-Z shields (it will typically *underestimate* buildup in that configuration). Alternatives from the literature (Kalos/Broder iterative formulas, weighted schemes) are not implemented.

If **no** significant non-air layer exists (bare source in air with air attenuation off), B = 1.

---

## 6. Nuclear and material data

### 6.1 Attenuation coefficients (`materials.js`)

For each material, two 26-point tables over the energy grid 0.01–10 MeV:

- `μ/ρ` — **total** mass attenuation coefficient (with coherent scattering), NIST **XCOM** database, verified against XCOM (March 2026 correction pass: earlier iron values were 15–35% low; water/air/lead `μ_en/ρ` above 0.5 MeV also corrected).
- `μ_en/ρ` — mass **energy-absorption** coefficient (air's is what converts fluence → dose).

Interpolation is **log-log** in energy; outside the grid the endpoint value is clamped (relevant only below 10 keV or above 10 MeV — no bundled isotope emits there).

Materials and densities:

| Key | Name | ρ (g/cm³) | Notes |
|-----|------|-----------|-------|
| `lead` | Lead | 11.35 | Z = 82; K-edge structure in both μ/ρ and GP data |
| `steel` | Carbon steel | 7.874 | Pure-iron data (Z = 26), adequate for carbon steel; **not** stainless-specific |
| `water` | Water | 1.00 | Also used for aqueous sludge |
| `air` | Dry air | 0.001205 | STP |
| `concrete` | Ordinary concrete | 2.30 | NIST ordinary concrete composition |

### 6.2 Isotopes (`isotopes.js`)

Discrete gamma lines with absolute yields; every line is transported independently through steps 1–6:

| Isotope | Half-life | Lines used (MeV @ yield) | Γ (R·m²/Ci·hr) |
|---------|-----------|--------------------------|----------------|
| Co-60 | 5.27 y | 1.173 @ 0.9985, 1.333 @ 0.9998 | 1.30 |
| Cs-137 | 30.17 y | 0.662 @ 0.851 | 0.33 |
| Ir-192 | 73.8 d | 7 lines, 0.206–0.613 | 0.48 |
| I-131 | 8.02 d | 0.364 @ 0.812, 0.637 @ 0.072, 0.284 @ 0.061 | 0.22 |
| Na-24 | 15.0 h | 1.369 @ 0.9999, 2.754 @ 0.9986 | 1.84 |

Bremsstrahlung, X-ray, and beta contributions are not modeled — gamma lines only. (Cs-137's 0.662 MeV line is technically Ba-137m's; the standard treatment.)

---

## 7. Isodose surface generation (`physics.js → generateIsodoseSurfaces`)

Draws surfaces of constant dose rate as triangle meshes:

1. **Per-source vantages.** Each enabled source volume is meshed (640 elements) and contributes one ray-cast **vantage** at its element centroid. Dose evaluated anywhere always sums **all** sources' elements with full ray-traced shielding — the vantage only controls the search topology. (One shared centroid was a v0.4 bug: for separated sources, levels above the midpoint dose rendered nothing, hiding each source's hot zone.)
2. **Ray directions** come from a subdivided icosahedron ("icosphere"): 162 / 642 / 2562 nearly-uniform directions per vantage, which also provides the triangulation of the resulting surface.
3. **Distance search** along each ray finds where dose = level: march outward from 1 cm in ×1.5 steps until the dose first drops below the level, then bisect (12 steps) inside that bracket. Taking the **first crossing** keeps each vantage's surface on its own dose lobe — a naive global bisection could tunnel through a low-dose corridor and land on another source's far lobe. If the dose at 1 cm is already below the level, that ray reports no surface; if the dose at Max Range is still above it, the point clamps to Max Range.
4. **Assembly.** Icosphere faces whose three rays all found a crossing become surface triangles; each (level × source) pair renders as its own translucent mesh with distance labels (top, bottom, four cardinals — distances from that surface's own source) and a double-click inspector (distance from the *nearest* source).

Properties and caveats: each per-vantage surface is star-shaped about its source, so strongly non-convex single-source shapes (e.g., a deep shadow notch behind a small thick shield) are rendered approximately at the resolution of the ray fan; overlapping surfaces from nearby sources visually merge (drawn on top of each other) rather than being boolean-unioned; cost scales as rays × levels × sources × ~25 dose evaluations, each of which is a full all-elements ray-traced sum — hence minutes at high resolution.

Isodose is a **visualization aid**: the dose-point calculation (with its finer, user-selected mesh) is the number of record.

---

## 8. Time simulation, survey maps, and sweeps

### 8.1 Time simulation engine (`sim.js`)

With fixed geometry, dose rate is **linear in each source's activity**. The engine exploits this: it precomputes a **dose-per-curie matrix** `D[source][point]` (one full ray-traced calculation per enabled source per dose point, meshed at 3×8×6), after which the dose at any time is

```
dose_j(t) = Σ_i A_i(t) · D[i][j]
```

and an entire timeline — any number of steps — evaluates in microseconds. Activity bookkeeping per timestep:

- **Transfers**: `A_from -= F(t)·Q`, `A_to += F(t)·Q` where `Q` is the transfer quantity and `F(t)` the cumulative curve — linear `t`, S-curve `t²(3−2t)`, front-loaded `1−(1−t)²`, or back-loaded `t²`. Either end may be "outside the scene". Inventories clamp at ≥ 0.
- **Carrier (hose)**: while `0 < t < 1` the carrier source holds an additional fixed *transit inventory*; it flushes to zero at the end.
- **Decay** (optional): every inventory is multiplied by `2^(−t/T½)` of its own isotope. Applied to the post-transfer amount — exact for pure decay, slightly conservative for activity transferred late in the evolution.
- **Spill**: a `DiskVolume` puddle grows as `r(t) = √(V·F(t)/(π·depth))`. Because its geometry changes, its per-curie dose is recomputed per timestep (coarse 3×8×2 mesh); the static sources keep their matrix entries. The puddle's own (negligible) shielding effect on *other* sources' rays is not re-traced per step.

Outputs per dose point: the dose-rate time series, peak (value and time), and **integrated dose** by trapezoidal integration (mrem over the evolution). Transferred activity adopts the destination source's isotope — keep a transfer chain to one isotope.

### 8.2 Survey heat map

Straightforward brute force: the current source mesh (coarse 3×6×6) is evaluated with the full ray-traced point-kernel at every node of a horizontal grid (user height/spacing/extent, capped at 121×121), and the values are painted onto a plane texture with a fixed logarithmic color scale (one decade per band, 0.1 → 10⁴ mrem/hr) so maps are comparable between scenes. It is exactly the dose-point calculation repeated ~10³ times — no additional approximation beyond the coarser mesh.

### 8.3 Parameter sweep

Sets the chosen dimension to each value in the range, re-meshes the sources, and runs the standard calculation at every dose point; the original dimension is restored afterward. No caching — each step is an honest full calculation.

## 9. Approximations & limitations (read before trusting a number)

1. **Point-kernel + buildup, not transport.** No explicit scatter geometry: buildup factors assume an infinite homogeneous medium. Finite/lopsided shields, streaming paths, skyshine, corner effects, and maze scatter are *not* modeled. Near such features, results can err in either direction.
2. **Outermost-material buildup** for layered shields (§5.3) — the dominant remaining approximation now that the GP data matches the standard. Worst case: thin high-Z outer layer over thick low-Z shield.
3. **Coherent-scattering inconsistency (small).** ANS-6.4.3 buildup factors were computed neglecting coherent scattering, so the mfp argument should strictly use μ-without-coherent (standard's Table 1a). RadShield uses XCOM totals throughout: <1% effect above ~0.3 MeV, a few percent at very low energies.
4. **Gamma only, QF = 1.** No beta, neutron, bremsstrahlung, or X-ray components; exposure-in-air response (mrad ≈ mrem for photons), not organ/effective dose per ICRP conversion.
5. **Mesh discretization.** Very close to a source surface (within ~1 element size), finite meshing over/under-shoots; increase mesh density for near-contact dose points.
6. **No decay** during a session — activities are what you type (a `decayActivity` helper exists in `isotopes.js` but is not wired to the UI).
7. **Materials are the bundled five** at fixed density/composition; steel is pure-iron data.
8. **Energy range** 0.01–10 MeV for attenuation data, 0.015–15 MeV for buildup; bundled isotopes stay inside both.
9. **Simulation bookkeeping** (§8.1): decay applied to post-transfer inventories; transferred activity adopts the destination's isotope; the spill puddle's self-shielding effect on other sources is not re-traced per step.

## 10. Verification

- `tests/buildup_check.js` — 28 GP buildup factors vs the standard's tabulated Table 3 values (< 2%).
- `tests/geometry_check.js` — 46 checks: analytic ray intersections vs hand-computed path lengths for every shape (including rotated), mesh activity conservation & containment, priority/enabled behavior, JSON round-trips.
- `tests/isodose_check.js` — 15 checks: two-separated-sources scenario (documents the fixed v0.4 bug), lobe radii, drawn surface points within 10% of the requested level, dumbbell merging, mixed-isotope transport.
- `tests/sim_check.js` — 18 checks: dose matrix vs direct calculation, transfer conservation/clamping/carrier/curves, half-life decay, integrated dose, spill radius law and end-state dose, model restoration.
- Cross-check habit: the "Unshielded Reference" card (Γ-based) should exceed the calculated value by a plausible shielding factor; a MicroShield side-by-side on a reference tank case is the recommended acceptance test after any physics-data change.

## 11. References

1. ANSI/ANS-6.4.3-1991, *Gamma-Ray Attenuation Coefficients and Buildup Factors for Engineering Materials* (GP coefficients: Table 5.1; verification values: Table 3).
2. NIST XCOM: Photon Cross Sections Database (μ/ρ); NIST *Tables of X-Ray Mass Attenuation Coefficients and Mass Energy-Absorption Coefficients* (μ_en/ρ).
3. Harima, Y., "An historical review and current status of buildup factor calculations and applications," *Radiat. Phys. Chem.* 41, 631 (1993) — GP form background.
4. Standard point-kernel practice as implemented in MicroShield (Grove Software) — method family and the outermost-material buildup convention.
