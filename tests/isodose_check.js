// ============================================================================
// RadShield - Isodose surface generation regression test
// Run with: node tests/isodose_check.js
//
// Reproduces the two-separated-sources bug: with a single shared centroid
// vantage, isodose levels above the midpoint dose rendered NOTHING (the
// first sample near the centroid read below the level, so every ray
// reported "no surface"), silently hiding the hot zones around each source.
// Per-source vantages must draw a lobe around every source, at distances
// consistent with the actual dose calculation.
// ============================================================================

const fs = require('fs');
const path = require('path');

const load = f => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
const { Materials, Isotopes, Physics, Geometry } = new Function(
    load('materials.js') + '\n' + load('isotopes.js') + '\n' +
    load('physics.js') + '\n' + load('geometry.js') +
    '\nreturn { Materials, Isotopes, Physics, Geometry };'
)();

let failures = 0;
function check(name, cond, detail) {
    if (!cond) failures++;
    console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? '  -- ' + detail : ''}`);
}

// ---------------------------------------------------------------------------
// Scene: two 0.1 Ci Co-60 sources 10 m apart (small water cylinders), no
// shields. Expected 25 mrem/hr boundary around each source: ~2.2-2.4 m.
// ---------------------------------------------------------------------------
const model = new Geometry.SceneModel();
const srcA = new Geometry.CylinderVolume({
    id: 'srcA', role: 'source', materialKey: 'water',
    position: { x: -500, y: 0, z: 0 },
    dimensions: { radius: 3, height: 6 },
    isotopeKey: 'Co-60', activity_Ci: 0.1
});
const srcB = new Geometry.CylinderVolume({
    id: 'srcB', role: 'source', materialKey: 'water',
    position: { x: 500, y: 0, z: 0 },
    dimensions: { radius: 3, height: 6 },
    isotopeKey: 'Co-60', activity_Ci: 0.1
});
model.addVolume(srcA);
model.addVolume(srcB);

// Per-source elements + vantage centers (mirrors index.html generateIsodose)
const elements = [];
const centers = [];
for (const vol of model.volumes) {
    const els = vol.meshSource(3, 8, 4);
    let cx = 0, cy = 0, cz = 0;
    for (const el of els) { cx += el.position.x; cy += el.position.y; cz += el.position.z; }
    centers.push({ x: cx / els.length, y: cy / els.length, z: cz / els.length });
    elements.push(...els);
}

const doseAt = (pos) => {
    let total = 0;
    for (const el of elements) {
        const layers = model.rayTrace(el.position, pos);
        total += Physics.pointSourceDose(el.activity_Ci, 'Co-60',
            el.position, pos, layers, { includeAir: true }).total_mrem_hr;
    }
    return total;
};

const LEVEL = 25;
const midDose = doseAt({ x: 0, y: 3, z: 0 });
check('scenario valid: midpoint dose below the level',
    midDose < LEVEL, `midpoint dose = ${midDose.toFixed(1)} mrem/hr`);

const levels = [{ value_mrem_hr: LEVEL, color: '#f59e0b', label: '25 mrem/hr' }];
const opts = { includeAir: true, subdivisions: 2, minDist: 1, maxDist: 2000, searchSteps: 16 };

// ---------------------------------------------------------------------------
// 1. Old behavior (single shared centroid) hid everything — documented here
// ---------------------------------------------------------------------------
{
    const centroid = { x: 0, y: 3, z: 0 };  // combined centroid = midpoint
    const surfaces = Physics.generateIsodoseSurfaces(
        elements, 'Co-60', model, [centroid], levels, opts);
    const faces = surfaces.reduce((s, x) => s + x.faces.length, 0);
    check('single-centroid vantage misses both hot zones (the old bug)',
        faces === 0, `faces = ${faces}`);
}

// ---------------------------------------------------------------------------
// 2. Per-source vantages: one lobe per source, at the right distance
// ---------------------------------------------------------------------------
{
    const surfaces = Physics.generateIsodoseSurfaces(
        elements, 'Co-60', model, centers, levels, opts);

    check('one surface per (level x source)', surfaces.length === 2);

    surfaces.forEach((surf, i) => {
        const pts = surf.points.filter(p => p);
        check(`source ${i + 1}: lobe has full ray coverage`,
            pts.length === surf.points.length && surf.faces.length > 0,
            `${pts.length}/${surf.points.length} points, ${surf.faces.length} faces`);

        // All surface points should be near this surface's own source,
        // not the midpoint: radii from the vantage in a sane band
        const radii = pts.map(p => Math.sqrt(
            (p.x - surf.center.x) ** 2 +
            (p.y - surf.center.y) ** 2 +
            (p.z - surf.center.z) ** 2));
        const rMin = Math.min(...radii), rMax = Math.max(...radii);
        check(`source ${i + 1}: lobe radius in expected band (1.5-3.5 m)`,
            rMin > 150 && rMax < 350,
            `rMin=${rMin.toFixed(0)}cm rMax=${rMax.toFixed(0)}cm`);

        // Surface points must actually sit at the requested dose level
        const sample = pts.filter((_, k) => k % 7 === 0);
        const worst = Math.max(...sample.map(p => Math.abs(doseAt(p) - LEVEL) / LEVEL));
        check(`source ${i + 1}: sampled surface points within 10% of ${LEVEL} mrem/hr`,
            worst < 0.10, `worst error = ${(worst * 100).toFixed(1)}%`);
    });

    // Both sources covered: one lobe near x=-500, one near x=+500
    const lobeXs = surfaces.map(s => s.center.x).sort((a, b) => a - b);
    check('lobes centered on each source',
        Math.abs(lobeXs[0] + 500) < 5 && Math.abs(lobeXs[1] - 500) < 5,
        JSON.stringify(lobeXs));
}

// ---------------------------------------------------------------------------
// 3. Close sources still work: low level from either vantage encloses both
// ---------------------------------------------------------------------------
{
    const lowLevels = [{ value_mrem_hr: 2, color: '#22c55e', label: '2 mrem/hr' }];
    const surfaces = Physics.generateIsodoseSurfaces(
        elements, 'Co-60', model, centers, lowLevels, opts);
    // 2 mrem/hr boundary: dose at midpoint (~10) is above it, so each
    // vantage's surface must reach past the OTHER source (dumbbell)
    const surfA = surfaces.find(s => s.center.x < 0);
    const maxX = Math.max(...surfA.points.filter(p => p).map(p => p.x));
    check('low level from vantage A reaches beyond source B (dumbbell)',
        maxX > 500, `max x = ${maxX.toFixed(0)}cm`);
    // ...and every drawn point still sits at the level
    const pts = surfA.points.filter(p => p).filter((_, k) => k % 11 === 0);
    const worst = Math.max(...pts.map(p => Math.abs(doseAt(p) - 2) / 2));
    check('dumbbell surface points within 10% of 2 mrem/hr',
        worst < 0.10, `worst error = ${(worst * 100).toFixed(1)}%`);
}

// ---------------------------------------------------------------------------
// 4. Mixed isotopes: each source transports with its OWN gamma lines
// ---------------------------------------------------------------------------
{
    const mixed = new Geometry.SceneModel();
    const co = new Geometry.CylinderVolume({
        id: 'co', role: 'source', materialKey: 'water',
        position: { x: -100, y: 0, z: 0 },
        dimensions: { radius: 5, height: 10 },
        isotopeKey: 'Co-60', activity_Ci: 2
    });
    const cs = new Geometry.CylinderVolume({
        id: 'cs', role: 'source', materialKey: 'water',
        position: { x: 100, y: 0, z: 0 },
        dimensions: { radius: 5, height: 10 },
        isotopeKey: 'Cs-137', activity_Ci: 2
    });
    mixed.addVolume(co);
    mixed.addVolume(cs);

    const dosePos = { x: 0, y: 100, z: 0 };
    const opts = { includeAir: true };
    const els = (v) => v.meshSource(3, 6, 6);

    check('mesh elements carry their isotope',
        els(co).every(e => e.isotopeKey === 'Co-60') &&
        els(cs).every(e => e.isotopeKey === 'Cs-137'));

    const combined = Physics.volumetricSourceDose(
        mixed.meshAllSources(3, 6, 6), mixed.getSourceIsotope(), dosePos, mixed, opts);
    const coOnly = Physics.volumetricSourceDose(els(co), 'Co-60', dosePos, mixed, opts);
    const csOnly = Physics.volumetricSourceDose(els(cs), 'Cs-137', dosePos, mixed, opts);

    check('mixed scene = sum of per-isotope calculations',
        Math.abs(combined.total_mrem_hr - (coOnly.total_mrem_hr + csOnly.total_mrem_hr))
            / combined.total_mrem_hr < 1e-9,
        `combined=${combined.total_mrem_hr}, sum=${coOnly.total_mrem_hr + csOnly.total_mrem_hr}`);

    // The old bug forced the first source's isotope onto everything; that
    // result must differ from the correct one (Cs-137 emits far less than Co-60)
    const buggy = coOnly.total_mrem_hr +
        Physics.volumetricSourceDose(
            els(cs).map(e => ({ position: e.position, activity_Ci: e.activity_Ci })),
            'Co-60', dosePos, mixed, opts).total_mrem_hr;
    check('correct result differs from old single-isotope behavior',
        Math.abs(combined.total_mrem_hr - buggy) / buggy > 0.2,
        `correct=${combined.total_mrem_hr.toFixed(2)}, old=${buggy.toFixed(2)}`);
}

console.log(failures === 0
    ? '\nAll isodose checks passed.'
    : `\n${failures} isodose checks FAILED.`);
process.exit(failures === 0 ? 0 : 1);
