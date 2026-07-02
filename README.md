# RadShield

A browser-based gamma dose-rate calculator with an interactive 3D scene editor.
Point-kernel integration with ANSI/ANS-6.4.3-1991 buildup factors, analytic
ray-tracing through arbitrarily rotated volumes, isodose surface visualization,
and a SolidWorks-lite editing workflow (select / move / rotate gizmo, align
mates, pipe/hose builder, tank template).

## Download / Run

**Just want to use it?** Download the single self-contained file — no install,
no internet needed, double-click to open in any modern browser:

**[RadShield_Portable_v4.html](https://github.com/dealmeaces-art/RadShield/releases/latest)** (see Releases)

## Development

No build system, no dependencies — plain JavaScript + Three.js r128.

```
python -m http.server 8080     # then open http://localhost:8080
node tests/buildup_check.js    # physics regression tests
node tests/geometry_check.js   # geometry/transform regression tests
node tools/build_portable.js   # rebuild the portable single-file HTML
```

See `Reference.md` for architecture, physics notes, and session history.

## Physics

- Point-kernel integration with geometric-progression (GP) buildup factors
  transcribed from ANSI/ANS-6.4.3-1991 (exposure coefficients), verified
  against the standard's tabulated buildup factors (see `tests/`).
- Mass attenuation / energy-absorption coefficients from NIST XCOM.
- Isotope gamma-line libraries: Co-60, Cs-137, Ir-192, I-131, Na-24.

**Disclaimer:** This is an engineering estimation tool. Verify independently
before using results for radiological protection decisions.
