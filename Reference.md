# RadShield - Project Reference

## What It Is
A browser-based radiation dose rate calculator replacing MicroShield. Uses point-kernel integration with buildup factors, ray-tracing through 3D geometry, and Three.js visualization. Runs as a single portable HTML file — no installation needed.

## What's New (v0.8 - July 2026) — navigation, mates, air gaps, heatmap rings, measure editing
Portable file: `RadShield_Portable_v8.html`. A batch of workflow upgrades from field use on large scenes.

- **Zoom-to-cursor camera** (`src/scene.js`): the built-in OrbitControls dolly is replaced by `onWheelZoom`, which scales the whole camera+target rig about the point under the cursor (raycast against volumes, isodose meshes, then the ground). The orbit pivot follows the zoom, so you can dive into one corner of a 100-ft scene and rotate about *that* spot. `controls.enableZoom=false`, `screenSpacePanning=true`, min/max distance clamps.
- **Persistent relationships (mates)** (`src/editor.js`, `src/geometry.js`): relationships are no longer one-shot. `alignVolumes` now stores `mover.constraint={targetId,mode}`; `resolveConstraints()` re-solves all constrained volumes inside `refreshAll()` (runs before every redraw), so a cover mated **On Top** of a tank follows when the tank is made taller with Smart Dimension. `solveAlign()` is the pure solver (reused by the resolver, no side effects). Constraint is serialized in `Volume.toJSON`/`volumeFromJSON`. Right-click → **Remove relationship (unlink)** clears it. Dangling constraints (deleted target) auto-drop.
- **Air-gap wall/floor layers**: tank layer material dropdown gains **Air (gap)** for lined tanks with a void between liner and shell; renders as a faint pale-blue shell (`isAir` branch in `renderVolume`).
- **Plug outer-Ø override**: `createTankPreset` plug uses `config.plug.outerRadius` when larger than the opening → a cover plate that overlaps the lid. UI field `#plugOuterDia` (diameter; 0 = flush).
- **Isodose rings on the Survey Heat Map**: `#heatRingsOn` + `#heatRings` (comma-separated mrem/hr). `drawHeatRings()` does marching-squares contours on an upscaled display canvas; a ring table lists each level's average + min–max distance from the source. Fill alpha lowered (was muddy) so rings read clearly.
- **Measure tool: multiple + delete + isodose snap**: measurements now stack (array of groups) and persist across tool switches; click a measurement's midpoint dot (or Del / Esc) to remove it (`cancelMeasure`/`deleteLastMeasure` exposed, wired in editor keydown). Measure also snaps to isodose surface grid points (vertices of the ray-fan mesh) via a raycast in `updateHover`.
- Docs: guide updated (persistent relationships note, zoom-to-cursor tip, air-gap/plug-OD tank steps, heat-map ring steps, measure stacking/isodose note); all "SolidEdge" comparisons removed from the User Guide.
- Verified end-to-end headlessly (scratchpad snaptest/verify_v8.js) on index.html and the inlined portable: air layer present, plug 20"Ø→10"r, mate follows target grown to y=90, constraint survives save/load, heatmap ring table populated, camera wheel + measure APIs no-error.

## What's New (v0.7 - July 2026) — animated radiation field + in-app GIF export
Portable file: `RadShield_Portable_v7.html`. The **Simulate** tab can now animate the isodose radiation field across the timeline and export it as an animated GIF — entirely in-browser, no external tools.

- **Radiation field animation** (Simulate ▸ Simulation Results): check **Animate the radiation field over the timeline**, set a frame count, and press **Build field animation**. It precomputes the isodose surfaces at each frame using the sim's per-source activities (`simResults.activities[step]`), so the scrubber/playback now shows the field growing/shrinking as activity builds. Uses the levels & resolution from the Analyze ▸ Isodose panel.
- **Export animated GIF**: renders every frame (captions baked in — time, %, active Ci, per-dose-point readouts) and downloads a self-contained `.gif`. GIF encoding via **gifenc** (MIT, vendored as `gifenc.min.js`, inlined into the portable like three.min.js). Canvas capture uses `Scene.snapshot()`; the renderer now sets `preserveDrawingBuffer:true` so `toDataURL` is reliable.
- This makes the demineralizer-style field-growth demo (previously rendered externally with puppeteer+ffmpeg) reproducible by a user with **just the program**.
- Implementation: `buildFieldAnimation()` / `exportFieldGif()` / `drawGifCaption()` in index.html; `simScrubTo()` renders the nearest field frame; `runSimulation()` invalidates a stale animation. Verified end-to-end headlessly (build → grow → valid GIF89a) against index.html and the inlined portable.

## What's New (v0.6 - July 2026) — smart feature snapping (Measure & Smart Dimension)
Portable file: `RadShield_Portable_v6.html`. SolidEdge-style key-point snapping added to the **Measure (M)** and **Smart Dimension (S)** tools (`src/scene.js`).

- **Hover highlight**: in Measure/Dimension mode, the object under the cursor tints and the *specific face* under the cursor gets a translucent cyan overlay — box faces (planar quad), cylinder/disk/annulus caps (disk/ring), and rim loops for curved sides. Spheres tint only.
- **Key-point snapping**: the cursor locks to the nearest real geometric feature within a 16px screen tolerance, chosen by priority (corner/vertex → edge midpoint/rim quadrant → face/axis center) then pixel distance. A color-coded glyph (amber cube = vertex, cyan octahedron = edge, magenta ring = center/face) marks the point with a text label ("Top center", "Corner", "Rim quadrant", "Axis (top)"…). Falls back to "On surface" then "On floor".
- **Feature sets** are generated per volume type in world coords via `featuresFor(vis)` using `visMatrix(vis)` (a THREE.Matrix4 from position + Euler 'XYZ' — matches geometry.js exactly). Box: 8 corners, 12 edge midpoints, 6 face centers + top/bottom/center. Cylinder/disk: bottom/top/center + 4 rim quadrants each cap. Annulus: axis top/bottom + inner & outer rim quadrants. Sphere: center + poles + 4 equator quadrants. Cache invalidated on every `renderScene` (so live edits stay correct).
- **Measure** clicks now consume the snapped world point (`currentSnap`) instead of a raw raycast hit, with a **dashed rubber-band preview** from the 1st point to the live snap. So "top of plug to bottom of floor" = snap plug **Top center**, then floor **Bottom center** → exact height.
- Hover wired via `pointermove` (suppressed while a mouse button is down so it never fights an orbit/pan drag); cleared on `pointerleave` and on leaving the mode. New read-only `Scene.getSnap()` exposes the active snap (used by the smoke test).
- Verified: 9-check headless-Edge smoke test (snap fires, grabs real key points, two-click measurement runs clean, dimension hover works, snap clears on mode exit) against **both** index.html and the inlined portable. All node regression suites still green.

## What's New (v0.5 - July 2026) — analysis & simulation workflows
Portable file `RadShield_Portable_v5.html`. Sidebar reorganized into **Model | Analyze | Simulate** tabs.

- **Named dose points** (Analyze): any number of named locations, all calculated at once (results table for >1 point), per-point 3D marker labels, pick-in-3D per row, saved with the scene (old single-point files still load). Editor hands picked locations to the app via the `onDosePick` hook.
- **Time simulation** (Simulate, `src/sim.js`): transfers of activity between sources (or in/out of the scene) over a duration with selectable curves, optional carrier ("via" hose holding a transit inventory while flowing), optional per-isotope decay, and spill scenarios (auto-created "spill-puddle" disk grows as √(V/πd), per-step dose since geometry changes). Engine precomputes a dose-per-curie matrix (dose is linear in activity) so timelines/playback are instant. Outputs per dose point: dose-vs-time chart (canvas renderer `drawChart`), peak, **integrated dose** (trapezoid, mrem); playback scrubber animates markers + puddle in 3D. Note: transferred activity adopts destination's isotope; decay applied to post-transfer inventory.
- **Survey heat map** (Analyze): dose rate on a horizontal plane grid painted into the 3D view, fixed log color scale one decade per band (0.1 → 10k mrem/hr), chunked with progress. `Scene.showHeatmap(canvas, area)`.
- **Parameter sweep** (Analyze): vary one dimension of the selected object, chart dose vs value at every dose point; object restored after.
- **Report** (topbar): printable dose-assessment report in a new tab — `Scene.snapshot()` 3D image, fresh per-point results, source/shield inventory tables, method footer, Print/Save-as-PDF. Falls back to download if popup blocked. ⚠ The report template contains a literal `</body>` inside the inline script — any tooling that injects into the page must use `lastIndexOf('</body>')`.
- Tests: `tests/sim_check.js` (18 checks); browser smoke now 28 checks. User Guide expanded to 14 chapters / 21 screenshots.

## What's New (v0.5 - July 2026) — editor/UX overhaul (Phase 2)
Portable build: `RadShield_Portable_v5.html` (now the build script's default output).

- **New primitives**: `BoxVolume` (width/depth/height — covers cubes, rectangles, plates, walls; a "plane" is just a thin box) and `SphereVolume` (position = bottom point, center at +radius, consistent with the bottom-center convention). Full physics support: slab/quadratic ray intersection, rotated source meshing with activity conserved, serialization, rendering, properties. Insert via ribbon, sidebar Insert panel, or right-click menu ("+ Plate / wall" preset is 24×24×0.5").
- **Per-object calculation toggle**: `Volume.enabled` flag. Unchecked objects are excluded from ray-tracing, source meshing, material lookup, and activity totals, and draw as faint ghosts labeled "(excluded)". Toggle via the outliner checkbox, properties panel, or context menu — independent of the visibility eye (which stays display-only).
- **Save/Load tank bug FIXED**: the saved JSON now also carries `tankTemplate` (all tank form fields + wall/floor layer arrays), `calcSettings`, and `isodoseLevels`, and Load restores them. Previously the tank form stayed at defaults after Load, so the next "Build/Rebuild Tank" silently replaced the loaded tank with the default one (and a save made before ever clicking Build captured the default tank).
- **Ribbon toolbar** (SolidEdge-style command groups across the viewport top): Mode (Select/Move/Rotate), Inspect (Smart Dim/Measure/Dose Pt), Relationships (Concentric, On Top, Beneath, Flush, Center In, Parallel), Insert (Box/Plate/Cylinder/Sphere).
- **Relationships workflow**: click a relationship button → click the object to MOVE → click the TARGET (a pre-selected object is used as the mover automatically). Esc cancels. Same `alignVolumes` math as the right-click align menu, which still works.
- **Measure tool** (M): click two points (object surfaces or the floor); draws endpoint markers + a line + a label with total distance in inches/feet and ΔX/ΔY/ΔZ. The status bar repeats the numbers with both endpoint coordinates. Cleared on leaving the mode.
- **Smart Dimension** (S): click an object; a floating editor appears at the cursor with its dimension fields; edits apply live (undoable).
- **Text sprites rewritten**: auto-sized canvas, multiline support, aspect-correct sprite scale — fixes the clipped/stretched labels (the old isodose click label cut off the Y/Z values).
- **Contextual "How to" bar** across the bottom of the viewport: always explains the active tool (what it does, how to use it, its shortcut); during a relationship it shows Step 1/Step 2 instructions with a description of what the mate will do. Driven by `Editor.updateHelp()` (MODE_HELP/MATE_DESC maps in editor.js). Tooltips added across the UI: topbar New/Save/Load, all Insert buttons (with default sizes), tank form fields, dose point, calc settings, isodose controls, properties Role/Priority. Inserting a shape now hints where to edit its size in the status bar.
- **Multi-source isodose FIXED**: surfaces are now generated per source — each enabled source volume gets its own ray-fan vantage at its own centroid, while the dose at every sample still sums ALL sources (so overlap merges naturally into dumbbells). Previously a single combined-centroid vantage meant any level above the midpoint dose rendered NOTHING for separated sources (e.g. two 0.1 Ci sources 10 m apart showed no 25 mrem/hr bubbles at all — dangerous under-reporting). The distance search also now takes the FIRST crossing (outward march ×1.5 then bisect) so a vantage's rays can't tunnel through a low-dose corridor and land on another source's far lobe. Isodose click-inspect reports distance "from nearest source" when there are multiple. Generation time scales with source count (dropdown labels are per-source).
- Tests: `tests/geometry_check.js` extended to 46 checks (box/sphere containment+intersection+meshing+round-trip, enabled-flag exclusion); new `tests/isodose_check.js` (12 checks: reproduces the two-source bug, verifies per-source lobes at the correct radii, surface points within 10% of the requested dose level, dumbbell merge for low levels). 14-check headless-Edge UI smoke test (puppeteer-core) passed, including real two-source isodose generation through the UI path.

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

## Documentation
- **`RadShield_User_Guide.html`** (repo root) — THE user guide: polished self-contained manual (3.7 MB, 16 screenshots embedded as data URIs, print-to-PDF stylesheet). 12 chapters: UI tour, tank quick-start, custom geometry, relationships, measuring, calc-exclude, isodose, pipe builder, save/load, worked examples, troubleshooting. Source: `docs/guide_src.html` (edit this) + `docs/images/`; rebuild with `node tools/build_guide.js`. Screenshots captured from the real app via headless Edge (puppeteer-core, shots_a.js/shots_b.js pattern in session scratchpad) — recapture if the UI changes. `docs/HOW_TO.md` is just a pointer.
- **`docs/DESIGN.md`** — physics: point-kernel equations step by step, GP buildup formula + ANS-6.4.3 provenance, outermost-material multi-layer rule, NIST XCOM data, meshing math per shape, isodose algorithm, full approximations/limitations list, verification summary. This is the terse engineering source; the polished manager-facing version is below.
- **`RadShield_Design_Document.html`** (repo root) — polished, self-contained "Methodology & Validation" document for sharing with supervisors/reviewers: plain-language executive summary, standards emphasis (ANSI/ANS-6.4.3 + NIST), inline SVG figures (method pipeline, layered ray, validation scatter), and technical detail moved into cross-referenced Appendices A–H. Source: `docs/design_src.html` (edit this) + embeds `docs/images/05_isodose_tank.png`; rebuild with `node tools/build_design.js`. Keep in sync with DESIGN.md when physics changes.

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
├── RadShield_Portable_v4.html  # v4 - outdated (pre box/sphere, has Save/Load tank bug)
├── RadShield_Portable_v5.html  # v5 - CURRENT portable version (built, do not edit)
├── RadShield_User_Guide.html   # Polished self-contained user manual (built, do not edit)
├── RadShield_Design_Document.html # Polished "Methodology & Validation" doc for reviewers (built, do not edit)
├── docs/
│   ├── guide_src.html          # User guide SOURCE (edit this, then node tools/build_guide.js)
│   ├── design_src.html         # Design doc SOURCE (edit this, then node tools/build_design.js)
│   ├── HOW_TO.md               # Pointer to the user guide
│   ├── DESIGN.md               # Physics design doc SOURCE-OF-TRUTH (terse); design_src.html is the polished derivative
│   └── images/                 # Tutorial + doc screenshots captured headlessly from the app
├── src/
│   ├── materials.js            # NIST XCOM attenuation data + ANS-6.4.3 GP buildup factors
│   ├── isotopes.js             # Isotope gamma lines (Co-60, Cs-137, etc.)
│   ├── physics.js              # Point-kernel dose calc + isodose surface generation
│   ├── geometry.js             # Volume classes (position+rotation), SceneModel, JSON, tank preset
│   ├── sim.js                  # Time simulation engine (dose-per-curie matrix, transfers, spills)
│   ├── scene.js                # Three.js rendering + picking/highlight/gizmo/interaction modes
│   └── editor.js               # Document+undo, outliner, properties, context menu, keyboard
├── TransformControls.js        # three.js r128 gizmo (cached for offline build)
├── tools/
│   ├── build_portable.js       # node tools/build_portable.js -> rebuilds portable HTML
│   ├── build_guide.js          # node tools/build_guide.js -> rebuilds the user guide
│   └── build_design.js         # node tools/build_design.js -> rebuilds the design document
├── tests/
│   ├── buildup_check.js        # GP buildup regression test vs ANS-6.4.3 Table 3 (node)
│   ├── geometry_check.js       # Transform/ray-trace/serialization regression test (node)
│   ├── isodose_check.js        # Per-source isodose + mixed-isotope regression test (node)
│   └── sim_check.js            # Time simulation engine regression test (node)
├── three.min.js                # Three.js r128 (cached for offline build)
├── OrbitControls.js            # Orbit controls (cached for offline build)
├── ANS 6.4.3 specification.pdf # ANSI/ANS-6.4.3-1991 (source of buildup data)
└── Reference.md                # This file
```

## How to Run
- **At home (development):** `python -m http.server 8080` in the RadShield directory, then open `http://localhost:8080`
- **At work:** Email `RadShield_Portable_v5.html` to yourself, save to desktop, double-click to open in browser
- **Rebuild portable after changing src/:** `node tools/build_portable.js`
- **Tests:** `node tests/buildup_check.js`, `node tests/geometry_check.js`, `node tests/isodose_check.js`, `node tests/sim_check.js`

## Session History
- **Session 4 (July 2026), mixed-isotope fix:** Source mesh elements now carry their source volume's isotopeKey; volumetricSourceDose and isodose generation transport each element with its own gamma lines (previously the first source's isotope was forced onto every source). Unshielded Reference card now sums per source with its own gamma constant and distance. Regression: isodose_check.js section 4 (mixed scene = sum of per-isotope runs; old behavior shown to differ >20%).
- **Session 4 (July 2026), multi-source isodose fix:** User caught that isodose surfaces were generated from a single combined source centroid — for separated sources, levels above the midpoint dose silently drew nothing (missing hot-zone bubbles around each source). Rewrote generation: per-source vantage centers (dose still sums all sources), first-crossing distance search (outward ×1.5 march + bisect, prevents rays tunneling to another source's far lobe), nearest-source click-inspect label, per-source status/resolution labels. New tests/isodose_check.js locks the two-sources-10-m-apart scenario incl. dose accuracy of drawn points.
- **Session 4 (July 2026), Phase 2 — box/sphere primitives + UX overhaul:** BoxVolume + SphereVolume with full physics; per-object calculation enable/disable (ghosted rendering); Save/Load fixed to round-trip the tank template form (+ calc settings + isodose levels); SolidEdge-style ribbon (Mode/Inspect/Relationships/Insert); guided two-click relationship workflow on top of alignVolumes; two-point Measure tool with in-viewport dimension label; Smart Dimension floating editor; text sprites rewritten (multiline, auto-sized, aspect-correct). geometry_check.js → 46 checks; 12-check headless-Edge UI smoke test. Built RadShield_Portable_v5.html.
- **Session 1:** Initial build — tank geometry, physics engine, 3D visualization, UI, portable HTML
- **Session 2:** Added settled source distribution, fixed R/hr→rem/hr label, added air attenuation toggle. Major refactor to volume-based architecture (CylinderVolume, AnnulusVolume, DiskVolume, SceneModel). Added "Additional Volumes" for extra shields/sources on top of tank. Fixed buildup factor method (dominant→outermost material). Corrected NIST XCOM data for all materials. Added isodose surface visualization with icosphere ray-marching, distance labels, and click-to-inspect. User will bring ANS-6.4.3 GP buildup data from work for final accuracy calibration.
- **Session 3 (July 2026), Phase 1.5 — align mates + pipe builder:** One-shot align operations ("mates"): select mover, right-click target → Align submenu (concentric / place on top / underneath / coplanar bottoms / center inside / match rotation) — implemented in the target's local frame so they work on rotated targets; right-clicking a different volume no longer steals the selection. Pipe/Hose Builder modal (Insert panel): start point (or "top-center of selected object"), outer radius + wall thickness/material, contents material, optional radioactive contents (total activity split across legs by volume), ordered legs (±X/±Y/±Z + length); generates rotated content cylinders + wall annuli per leg with corner back-extension (no voids at bends). Editor.buildPipe(cfg) and Editor.alignVolumes(moverId, targetId, mode) are scriptable. Smoke test now 29 checks incl. ray-trace through a built hose. NOT yet done: persistent/parametric constraints (aligns are one-shot snaps).
- **Session 3 (July 2026), Phase 1 — 3D editor:** The scene is now a persistent document (owned by editor.js) instead of being rebuilt from the sidebar form on every calculate. Tank form became a template generator ("Build / Rebuild Tank" merges tank volumes by id, keeps user-added ones). Features: click-to-select with emissive highlight; move/rotate gizmo (TransformControls, 0.25"/15° snap); right-click context menu (duplicate/delete/role/material, add-shape-here on empty space, place-dose-point-here); Selected Object properties panel (inches/degrees, live edit); Scene Objects outliner (color, role badge, view-only eye toggle); click-to-place dose point mode; snapshot undo/redo (Ctrl+Z/Y, 50 deep); keyboard V/G/R/D, Del, Ctrl+D; topbar New/Save/Load (.json scene files incl. dose point). Verified with headless-Edge smoke test (19 checks: load, insert, select, edit, undo/redo, click-pick, context menu, modes, tank rebuild, full dose calculation).
- **Session 3 (July 2026):** Put project under git. User supplied ANSI/ANS-6.4.3-1991 PDF; transcribed Table 5.1 exposure GP buildup coefficients for all five materials from rendered page images (lead incl. K-edge fine grid), verified against Table 3 tabulated buildup factors, replaced the from-memory values in materials.js. Switched GP interpolation to ln(E). Added node-based regression test (tests/buildup_check.js, 28 checks). Plan approved for 3D editor evolution: Phase 0 transforms/serialization → Phase 1 direct manipulation (select/gizmo/right-click materials) → Phase 2 primitives (box/sphere/cone) → Phase 3 sketch+extrude/revolve. **Phase 0 done:** every Volume now has rotation (Euler degrees, three.js 'XYZ' order); subclass geometry math moved to a local frame via base-class world<->local transforms; scene JSON serialization (SceneModel.toJSON / Geometry.sceneFromJSON); renderer refactored to per-volume THREE.Group carrying position+rotation with userData.volumeId (pick-ready for Phase 1); rotation-aware bounds; tests/geometry_check.js (19 checks); tools/build_portable.js build script; built RadShield_Portable_v4.html.
