# RadShield — User Guide

The user guide is the polished, self-contained **[`RadShield_User_Guide.html`](../RadShield_User_Guide.html)**
in the repository root — a single file with all 16 screenshots embedded, structured as a real manual:

1. Getting started
2. A tour of the screen (annotated)
3. Quick start: your first dose calculation
4. Building custom geometry
5. Positioning with Relationships
6. Measuring distances
7. Controlling what is calculated
8. Isodose maps of the radiation field
9. The Pipe / Hose Builder
10. Saving and loading scenes
11. Worked examples (filter bed, shield-wall study, two containers)
12. Reference: shortcuts & troubleshooting

Open it in any browser (double-click), or print it to PDF from the browser — the print stylesheet
paginates chapters cleanly.

**To update the guide:** edit `docs/guide_src.html` (images referenced from `docs/images/`), then run
`node tools/build_guide.js` to regenerate the self-contained file. Screenshots were captured from the
running app headlessly; regenerate them with the puppeteer-core pattern noted in `Reference.md` if the
UI changes.

For the physics — equations, data provenance, approximations — see [`DESIGN.md`](DESIGN.md).
