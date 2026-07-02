# RadShield - Project Reference

## What It Is
A browser-based radiation dose rate calculator replacing MicroShield. Uses point-kernel integration with buildup factors, ray-tracing through 3D geometry, and Three.js visualization. Runs as a single portable HTML file — no installation needed.

## Current State (v0.3 - March 2026)

### Architecture
- **Volume-based scene model** — replaced the rigid TankGeometry class with composable volumes:
  - CylinderVolume, AnnulusVolume, DiskVolume classes
  - SceneModel holds all volumes, provides unified ray-tracing across everything
  - Priority system handles overlapping volumes (sources inside water, plug inside lid opening)
- **Tank Preset** mode creates the right volumes from familiar tank parameters (radius, height, wall layers, lid, plug, source)
- **Additional Volumes** can be added on top of the tank — extra shields or custom source positions at any location
- Single portable HTML file (~743 KB, fully offline with Three.js embedded)

### Features
- Co-60 primary isotope (Cs-137, Ir-192, I-131, Na-24 also included)
- Source distribution: uniform, settled (sludge on bottom), custom layer height
- Multi-layer walls (steel, lead, concrete, water), floor, donut lid with opening, plug
- "Include air attenuation" toggle (default ON)
- 3D visualization with translucent color-coded materials, labels, dose point marker
- Dose calculation results overlay (mrem/hr and mSv/hr)
- **Isodose surface visualization** — 3D translucent blobs showing dose rate boundaries
  - Multiple simultaneous levels with user-defined colors
  - Icosphere-based ray-marching for smooth surfaces
  - Auto-distance labels at key points (top, bottom, 4 cardinal directions) in feet/inches
  - Double-click to inspect any surface point — shows distance and X/Y/Z coordinates
  - Configurable resolution (162 / 642 / 2562 rays) and max search range

## Real-World Use Case
The user works with **reactor plant waste processing**:
- Tanks of water mixed with gross sludge/contamination from a reactor plant
- Cobalt-60 is the isotope of concern — it sinks to the bottom; water floats on top
- Tanks have steel + lead shielding walls, thick steel lids with access openings and plugs
- Key scenario: tank has a **filter media bed** that catches contamination and suspends it above the tank bottom (sludge caught in top 3" of filter, clean media below, water above)
- Also: smaller vent path collection bottles (~10 gal) receiving contaminated water, where activity settles over time
- The "Additional Volumes" feature now allows modeling the filter bed scenario by placing a custom source disk at an arbitrary Y position within the tank

## Key Physics
- Point-kernel integration with GP buildup factors (ANS-6.4.3 formula form)
- **NIST XCOM mass attenuation coefficients — VERIFIED** from actual NIST database (March 2026)
- Mass energy-absorption coefficients for air (dose calculation)
- **"Outermost material" method** for multi-layer buildup — uses GP parameters of the last significant non-air shield material, applied to total mean free paths
- Source volume meshed in cylindrical coordinates, each element ray-traced independently
- Self-shielding from source material (water) IS included in ray-trace
- Isodose surfaces: icosphere directions + binary search for target dose distance

## Known Issues / TODO

### Physics Accuracy
- **NIST XCOM attenuation data: CORRECTED** — Iron/steel mu/rho was 15-35% too low. Water/air/lead mu_en/rho were wrong above 0.5 MeV. All fixed with verified NIST values.
- **GP buildup factor parameters: DONE (July 2026)** — Replaced from-memory values with ANSI/ANS-6.4.3-1991 Table 5.1 **exposure** GP coefficients transcribed from the standard (PDF in repo root): full 0.015–15 MeV grids for water/iron/concrete (25 points), lead 0.03–15 MeV incl. K-edge structure (31 points). Air uses the energy-absorption set (standard publishes no exposure set for air; <2% difference for low-Z). GP parameter interpolation switched to linear-in-ln(E). Verified against the standard's tabulated Table 3 exposure buildup factors — `node tests/buildup_check.js`, 28 checks, all within 2%.
- **Coherent scattering subtlety (ANS-6.4.3 sec. 4.1)**: the standard's buildup factors neglect coherent scattering, so mfp should strictly use mu-without-coherent (Table 1a) rather than XCOM totals. Effect <1% above ~0.3 MeV, a few % at very low energies. Documented in materials.js; refine only if low-energy sources matter.
- **Multi-material buildup method** — "outermost material" GP applied to total mfp is the standard MicroShield-style approximation; with correct GP data this is now the remaining approximation, not the data. Re-run the MicroShield side-by-side comparison case (old from-memory GP params were the prime suspect for low results — e.g. lead b(1 MeV) was 1.528 vs correct 1.367, water b(0.5 MeV) 3.192 vs correct 2.500).
- **Isodose vs dose point discrepancy** was observed (~7x off). Root cause: coarse source mesh for isodose (nr=3). Fixed to nr=5, ntheta=16, nz=8 = 640 elements. May still need tuning — isodose is approximate visualization, dose point is the accurate calculation.

### Source Geometry Flexibility
The Additional Volumes feature enables many of these, but dedicated UI workflows would be better:
- **Filter bed model**: Source disk at arbitrary height with water above and below (NOW POSSIBLE via Additional Volumes)
- **Time-dependent settling**: Activity starts uniform, transitions to settled over time
- **Arbitrary source profile**: Activity concentration as a function of height
- **Partial fill of a smaller container**: e.g., 5 gallons in a 10-gallon bottle

### Geometry Expansion (Future)
- Pipe/hose geometry with 3D routing and bends
- Multiple containers in a scene
- CAD import (.STEP/.IGES) — long-term goal

### UI Improvements (Future)
- Cross-section drawing editor (2D profile → revolve to 3D)
- Click in 3D viewport to place dose points
- Parameter sweeps (dose vs. shield thickness)
- Save/load configurations
- Export results to PDF or spreadsheet

## File Structure
```
RadShield/
├── index.html                  # Development version (needs local server)
├── RadShield_Portable.html     # v1 - needs internet for Three.js CDN
├── RadShield_Portable_v2.html  # v2 - fully offline (outdated)
├── RadShield_Portable_v3.html  # v3 - outdated (pre ANS-6.4.3 data)
├── RadShield_Portable_v4.html  # v4 - CURRENT portable version (built, do not edit)
├── src/
│   ├── materials.js            # NIST XCOM attenuation data + ANS-6.4.3 GP buildup factors
│   ├── isotopes.js             # Isotope gamma lines (Co-60, Cs-137, etc.)
│   ├── physics.js              # Point-kernel dose calc + isodose surface generation
│   ├── geometry.js             # Volume classes (position+rotation), SceneModel, JSON, tank preset
│   ├── scene.js                # Three.js rendering + picking/highlight/gizmo/interaction modes
│   └── editor.js               # Document+undo, outliner, properties, context menu, keyboard
├── TransformControls.js        # three.js r128 gizmo (cached for offline build)
├── tools/
│   └── build_portable.js       # node tools/build_portable.js -> rebuilds portable HTML
├── tests/
│   ├── buildup_check.js        # GP buildup regression test vs ANS-6.4.3 Table 3 (node)
│   └── geometry_check.js       # Transform/ray-trace/serialization regression test (node)
├── three.min.js                # Three.js r128 (cached for offline build)
├── OrbitControls.js            # Orbit controls (cached for offline build)
├── ANS 6.4.3 specification.pdf # ANSI/ANS-6.4.3-1991 (LOCAL ONLY - licensed standard, not in repo)
└── Reference.md                # This file
```

## How to Run
- **At home (development):** `python -m http.server 8080` in the RadShield directory, then open `http://localhost:8080`
- **At work:** Email `RadShield_Portable_v4.html` to yourself, save to desktop, double-click to open in browser
- **Rebuild portable after changing src/:** `node tools/build_portable.js`
- **Tests:** `node tests/buildup_check.js` and `node tests/geometry_check.js`

## Session History
- **Session 1:** Initial build — tank geometry, physics engine, 3D visualization, UI, portable HTML
- **Session 2:** Added settled source distribution, fixed R/hr→rem/hr label, added air attenuation toggle. Major refactor to volume-based architecture (CylinderVolume, AnnulusVolume, DiskVolume, SceneModel). Added "Additional Volumes" for extra shields/sources on top of tank. Fixed buildup factor method (dominant→outermost material). Corrected NIST XCOM data for all materials. Added isodose surface visualization with icosphere ray-marching, distance labels, and click-to-inspect. User will bring ANS-6.4.3 GP buildup data from work for final accuracy calibration.
- **Session 3 (July 2026), Phase 1.5 — align mates + pipe builder:** One-shot align operations ("mates"): select mover, right-click target → Align submenu (concentric / place on top / underneath / coplanar bottoms / center inside / match rotation) — implemented in the target's local frame so they work on rotated targets; right-clicking a different volume no longer steals the selection. Pipe/Hose Builder modal (Insert panel): start point (or "top-center of selected object"), outer radius + wall thickness/material, contents material, optional radioactive contents (total activity split across legs by volume), ordered legs (±X/±Y/±Z + length); generates rotated content cylinders + wall annuli per leg with corner back-extension (no voids at bends). Editor.buildPipe(cfg) and Editor.alignVolumes(moverId, targetId, mode) are scriptable. Smoke test now 29 checks incl. ray-trace through a built hose. NOT yet done: persistent/parametric constraints (aligns are one-shot snaps).
- **Session 3 (July 2026), Phase 1 — 3D editor:** The scene is now a persistent document (owned by editor.js) instead of being rebuilt from the sidebar form on every calculate. Tank form became a template generator ("Build / Rebuild Tank" merges tank volumes by id, keeps user-added ones). Features: click-to-select with emissive highlight; move/rotate gizmo (TransformControls, 0.25"/15° snap); right-click context menu (duplicate/delete/role/material, add-shape-here on empty space, place-dose-point-here); Selected Object properties panel (inches/degrees, live edit); Scene Objects outliner (color, role badge, view-only eye toggle); click-to-place dose point mode; snapshot undo/redo (Ctrl+Z/Y, 50 deep); keyboard V/G/R/D, Del, Ctrl+D; topbar New/Save/Load (.json scene files incl. dose point). Verified with headless-Edge smoke test (19 checks: load, insert, select, edit, undo/redo, click-pick, context menu, modes, tank rebuild, full dose calculation).
- **Session 3 (July 2026):** Put project under git. User supplied ANSI/ANS-6.4.3-1991 PDF; transcribed Table 5.1 exposure GP buildup coefficients for all five materials from rendered page images (lead incl. K-edge fine grid), verified against Table 3 tabulated buildup factors, replaced the from-memory values in materials.js. Switched GP interpolation to ln(E). Added node-based regression test (tests/buildup_check.js, 28 checks). Plan approved for 3D editor evolution: Phase 0 transforms/serialization → Phase 1 direct manipulation (select/gizmo/right-click materials) → Phase 2 primitives (box/sphere/cone) → Phase 3 sketch+extrude/revolve. **Phase 0 done:** every Volume now has rotation (Euler degrees, three.js 'XYZ' order); subclass geometry math moved to a local frame via base-class world<->local transforms; scene JSON serialization (SceneModel.toJSON / Geometry.sceneFromJSON); renderer refactored to per-volume THREE.Group carrying position+rotation with userData.volumeId (pick-ready for Phase 1); rotation-aware bounds; tests/geometry_check.js (19 checks); tools/build_portable.js build script; built RadShield_Portable_v4.html.
