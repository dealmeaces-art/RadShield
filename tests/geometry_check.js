// ============================================================================
// RadShield - Geometry engine regression test
// Run with: node tests/geometry_check.js
//
// Checks the volume transform system (position + Euler rotation), analytic
// ray intersections, source meshing under rotation, and scene JSON
// round-tripping. All expected values are computed by hand from geometry.
// ============================================================================

const fs = require('fs');
const path = require('path');

const load = f => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
const { Materials, Geometry } = new Function(
    load('materials.js') + '\n' + load('geometry.js') +
    '\nreturn { Materials, Geometry };'
)();

let failures = 0;
function check(name, cond, detail) {
    if (!cond) failures++;
    console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? '  -- ' + detail : ''}`);
}
function close(a, b, tol) { return Math.abs(a - b) <= (tol || 1e-6); }
function layerOf(layers, mat) {
    return layers.filter(l => l.materialKey === mat)
                 .reduce((s, l) => s + l.thickness_cm, 0);
}

// ---------------------------------------------------------------------------
// 1. Unrotated cylinder: ray through the axis sees the full diameter
// ---------------------------------------------------------------------------
{
    const m = new Geometry.SceneModel();
    m.addVolume(new Geometry.CylinderVolume({
        id: 'c', role: 'shield', materialKey: 'steel',
        position: { x: 0, y: 0, z: 0 },
        dimensions: { radius: 10, height: 100 }
    }));
    const layers = m.rayTrace({ x: -50, y: 50, z: 0 }, { x: 50, y: 50, z: 0 });
    check('unrotated cylinder: steel path = 2R',
        close(layerOf(layers, 'steel'), 20, 1e-6), JSON.stringify(layers));
    check('unrotated cylinder: air path = 80',
        close(layerOf(layers, 'air'), 80, 1e-6));
}

// ---------------------------------------------------------------------------
// 2. Cylinder rotated 90 deg about Z: axis +Y -> -X
// ---------------------------------------------------------------------------
{
    const m = new Geometry.SceneModel();
    const cyl = new Geometry.CylinderVolume({
        id: 'c', role: 'shield', materialKey: 'steel',
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 90 },
        dimensions: { radius: 10, height: 100 }
    });
    m.addVolume(cyl);

    const top = cyl.localToWorld(0, 100, 0);
    check('rz=90: local top (0,100,0) maps to (-100,0,0)',
        close(top.x, -100, 1e-9) && close(top.y, 0, 1e-9) && close(top.z, 0, 1e-9),
        JSON.stringify(top));

    check('rz=90: containsPoint mid-axis', cyl.containsPoint(-50, 0, 0));
    check('rz=90: containsPoint near wall inside', cyl.containsPoint(-50, 9.9, 0));
    check('rz=90: point outside radius', !cyl.containsPoint(-50, 10.1, 0));
    check('rz=90: point beyond bottom cap', !cyl.containsPoint(5, 0, 0));

    // Perpendicular ray through the axis: 2R of steel
    const perp = m.rayTrace({ x: -50, y: -50, z: 0 }, { x: -50, y: 50, z: 0 });
    check('rz=90: perpendicular ray steel path = 2R',
        close(layerOf(perp, 'steel'), 20, 1e-6), JSON.stringify(perp));

    // Ray along the axis: full height of steel
    const axial = m.rayTrace({ x: 10, y: 0, z: 0 }, { x: -110, y: 0, z: 0 });
    check('rz=90: axial ray steel path = height',
        close(layerOf(axial, 'steel'), 100, 1e-6), JSON.stringify(axial));
}

// ---------------------------------------------------------------------------
// 3. Annulus rotated 90 deg about X: axis +Y -> +Z
// ---------------------------------------------------------------------------
{
    const m = new Geometry.SceneModel();
    const ann = new Geometry.AnnulusVolume({
        id: 'a', role: 'shield', materialKey: 'lead',
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 90, y: 0, z: 0 },
        dimensions: { innerRadius: 5, outerRadius: 10, height: 20 }
    });
    m.addVolume(ann);

    check('rx=90: containsPoint in ring wall', ann.containsPoint(7.5, 0, 10));
    check('rx=90: hole is empty', !ann.containsPoint(0, 0, 10));

    // Ray along X through the ring: crosses both walls = 2*(outer-inner)
    const layers = m.rayTrace({ x: -50, y: 0, z: 10 }, { x: 50, y: 0, z: 10 });
    check('rx=90: ray crosses both ring walls, lead path = 10',
        close(layerOf(layers, 'lead'), 10, 1e-6), JSON.stringify(layers));
}

// ---------------------------------------------------------------------------
// 4. Source meshing under rotation: elements inside volume, activity conserved
// ---------------------------------------------------------------------------
{
    const src = new Geometry.CylinderVolume({
        id: 's', role: 'source', materialKey: 'water',
        position: { x: 20, y: 5, z: -30 },
        rotation: { x: 30, y: 45, z: 60 },
        dimensions: { radius: 8, height: 40 },
        isotopeKey: 'Co-60', activity_Ci: 12.5
    });
    const elems = src.meshSource(4, 8, 6);
    const total = elems.reduce((s, e) => s + e.activity_Ci, 0);
    const allInside = elems.every(e =>
        src.containsPoint(e.position.x, e.position.y, e.position.z));
    check('rotated source mesh: all elements inside volume', allInside);
    check('rotated source mesh: activity conserved',
        close(total, 12.5, 1e-9), `total=${total}`);
}

// ---------------------------------------------------------------------------
// 5. Scene JSON round-trip: tank preset survives serialize/deserialize
// ---------------------------------------------------------------------------
{
    const model = Geometry.createTankPreset({
        innerRadius: 30, innerHeight: 90,
        wallLayers: [{ materialKey: 'steel', thickness: 1.0 }],
        floorLayers: [{ materialKey: 'steel', thickness: 1.0 }],
        lid: { materialKey: 'steel', thickness: 1.0, openingRadius: 10 },
        plug: { materialKey: 'lead', thickness: 5 },
        source: {
            distribution: 'uniform', liquidLevel: 60,
            activity_Ci: 2.0, isotope: 'Cs-137', liquidMaterial: 'water'
        }
    });

    const restored = Geometry.sceneFromJSON(JSON.parse(JSON.stringify(model.toJSON())));
    check('round-trip: volume count preserved',
        restored.volumes.length === model.volumes.length);

    const rays = [
        [{ x: 0, y: 30, z: 0 }, { x: 200, y: 30, z: 0 }],   // through side wall
        [{ x: 0, y: 30, z: 0 }, { x: 0, y: -100, z: 0 }],   // through floor
        [{ x: 15, y: 30, z: 0 }, { x: 15, y: 200, z: 0 }],  // up through lid ring? (r=15 > opening)
    ];
    let same = true;
    for (const [a, b] of rays) {
        const l1 = JSON.stringify(model.rayTrace(a, b));
        const l2 = JSON.stringify(restored.rayTrace(a, b));
        if (l1 !== l2) { same = false; break; }
    }
    check('round-trip: identical ray-trace results', same);

    const pts = [[0, 30, 0], [30.5, 45, 0], [0, -0.5, 0], [0, 95, 20]];
    const sameMat = pts.every(p =>
        model.getMaterialAt(...p) === restored.getMaterialAt(...p));
    check('round-trip: identical getMaterialAt results', sameMat);

    // Sanity: expected layer thicknesses through the side wall at liquid height
    const layers = model.rayTrace({ x: 0, y: 30, z: 0 }, { x: 200, y: 30, z: 0 });
    check('tank preset: water path = inner radius',
        close(layerOf(layers, 'water'), 30, 1e-6), JSON.stringify(layers));
    check('tank preset: steel wall path = 1 cm',
        close(layerOf(layers, 'steel'), 1, 1e-6));
}

console.log(failures === 0
    ? '\nAll geometry checks passed.'
    : `\n${failures} geometry checks FAILED.`);
process.exit(failures === 0 ? 0 : 1);
