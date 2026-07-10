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

// ---------------------------------------------------------------------------
// 6. BoxVolume: containment, slab ray intersection, rotation
// ---------------------------------------------------------------------------
{
    const m = new Geometry.SceneModel();
    const box = new Geometry.BoxVolume({
        id: 'b', role: 'shield', materialKey: 'steel',
        position: { x: 0, y: 0, z: 0 },
        dimensions: { width: 20, depth: 40, height: 10 }
    });
    m.addVolume(box);

    check('box: contains center', box.containsPoint(0, 5, 0));
    check('box: outside +X face', !box.containsPoint(10.1, 5, 0));
    check('box: outside top face', !box.containsPoint(0, 10.1, 0));

    const alongX = m.rayTrace({ x: -50, y: 5, z: 0 }, { x: 50, y: 5, z: 0 });
    check('box: X ray steel path = width (20)',
        close(layerOf(alongX, 'steel'), 20, 1e-6), JSON.stringify(alongX));

    const alongZ = m.rayTrace({ x: 0, y: 5, z: -100 }, { x: 0, y: 5, z: 100 });
    check('box: Z ray steel path = depth (40)',
        close(layerOf(alongZ, 'steel'), 40, 1e-6));

    const alongY = m.rayTrace({ x: 0, y: -20, z: 0 }, { x: 0, y: 30, z: 0 });
    check('box: Y ray steel path = height (10)',
        close(layerOf(alongY, 'steel'), 10, 1e-6));

    check('box: volume = w*d*h', close(box.getVolume_cm3(), 8000, 1e-9));

    // Rotate 90 about Y: width (X) and depth (Z) swap in the world
    box.setRotation({ x: 0, y: 90, z: 0 });
    const rotX = m.rayTrace({ x: -100, y: 5, z: 0 }, { x: 100, y: 5, z: 0 });
    check('box ry=90: X ray now sees depth (40)',
        close(layerOf(rotX, 'steel'), 40, 1e-6), JSON.stringify(rotX));
}

// ---------------------------------------------------------------------------
// 7. Box source meshing: elements inside, activity conserved (rotated)
// ---------------------------------------------------------------------------
{
    const src = new Geometry.BoxVolume({
        id: 'bs', role: 'source', materialKey: 'water',
        position: { x: 10, y: -5, z: 20 },
        rotation: { x: 20, y: 40, z: 10 },
        dimensions: { width: 30, depth: 12, height: 8 },
        isotopeKey: 'Co-60', activity_Ci: 4.5
    });
    const elems = src.meshSource(4, 6, 5);
    const total = elems.reduce((s, e) => s + e.activity_Ci, 0);
    const allInside = elems.every(e =>
        src.containsPoint(e.position.x, e.position.y, e.position.z));
    check('box source mesh: all elements inside', allInside);
    check('box source mesh: activity conserved', close(total, 4.5, 1e-9), `total=${total}`);
}

// ---------------------------------------------------------------------------
// 8. SphereVolume: containment, chord lengths, meshing
// ---------------------------------------------------------------------------
{
    const m = new Geometry.SceneModel();
    const sph = new Geometry.SphereVolume({
        id: 's', role: 'shield', materialKey: 'lead',
        position: { x: 0, y: 0, z: 0 },   // bottom point at origin, center (0,10,0)
        dimensions: { radius: 10 }
    });
    m.addVolume(sph);

    check('sphere: contains center', sph.containsPoint(0, 10, 0));
    check('sphere: contains near bottom', sph.containsPoint(0, 0.5, 0));
    check('sphere: outside top', !sph.containsPoint(0, 20.1, 0));
    check('sphere: outside side', !sph.containsPoint(10.1, 10, 0));

    const diam = m.rayTrace({ x: -50, y: 10, z: 0 }, { x: 50, y: 10, z: 0 });
    check('sphere: ray through center, lead path = 2R',
        close(layerOf(diam, 'lead'), 20, 1e-6), JSON.stringify(diam));

    const chord = m.rayTrace({ x: -50, y: 15, z: 0 }, { x: 50, y: 15, z: 0 });
    check('sphere: offset chord = 2*sqrt(R^2-25)',
        close(layerOf(chord, 'lead'), 2 * Math.sqrt(75), 1e-6));

    check('sphere: volume = 4/3 pi R^3',
        close(sph.getVolume_cm3(), (4 / 3) * Math.PI * 1000, 1e-6));

    const src = new Geometry.SphereVolume({
        id: 'ss', role: 'source', materialKey: 'water',
        position: { x: 5, y: 8, z: -3 },
        rotation: { x: 15, y: 30, z: 45 },
        dimensions: { radius: 6 },
        isotopeKey: 'Co-60', activity_Ci: 2.25
    });
    const elems = src.meshSource(4, 8, 6);
    const total = elems.reduce((s, e) => s + e.activity_Ci, 0);
    const allInside = elems.every(e =>
        src.containsPoint(e.position.x, e.position.y, e.position.z));
    check('sphere source mesh: all elements inside', allInside);
    check('sphere source mesh: activity conserved',
        close(total, 2.25, 1e-9), `total=${total}`);
}

// ---------------------------------------------------------------------------
// 9. enabled flag: disabled volumes are invisible to the physics
// ---------------------------------------------------------------------------
{
    const m = new Geometry.SceneModel();
    m.addVolume(new Geometry.CylinderVolume({
        id: 'shield', role: 'shield', materialKey: 'lead',
        position: { x: 0, y: 0, z: 0 },
        dimensions: { radius: 10, height: 100 },
        enabled: false
    }));
    m.addVolume(new Geometry.CylinderVolume({
        id: 'src', role: 'source', materialKey: 'water',
        position: { x: 100, y: 0, z: 0 },
        dimensions: { radius: 5, height: 10 },
        isotopeKey: 'Co-60', activity_Ci: 7, enabled: false
    }));

    const layers = m.rayTrace({ x: -50, y: 50, z: 0 }, { x: 50, y: 50, z: 0 });
    check('disabled shield: ray sees only air',
        layers.every(l => l.materialKey === 'air'), JSON.stringify(layers));
    check('disabled shield: getMaterialAt = air',
        m.getMaterialAt(0, 50, 0) === 'air');
    check('disabled source: zero total activity', m.getTotalActivity() === 0);
    check('disabled source: no mesh elements', m.meshAllSources(3, 6, 6).length === 0);

    // Round-trip keeps the flag; re-enabling restores the physics
    const restored = Geometry.sceneFromJSON(JSON.parse(JSON.stringify(m.toJSON())));
    check('enabled flag survives round-trip',
        restored.getVolume('shield').enabled === false &&
        restored.getVolume('src').enabled === false);
    restored.getVolume('shield').enabled = true;
    const layers2 = restored.rayTrace({ x: -50, y: 50, z: 0 }, { x: 50, y: 50, z: 0 });
    check('re-enabled shield: lead path = 2R',
        close(layerOf(layers2, 'lead'), 20, 1e-6));
}

// ---------------------------------------------------------------------------
// 10. Box/sphere JSON round-trip: identical ray-trace results
// ---------------------------------------------------------------------------
{
    const m = new Geometry.SceneModel();
    m.addVolume(new Geometry.BoxVolume({
        id: 'b', role: 'shield', materialKey: 'concrete',
        position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 30, z: 0 },
        dimensions: { width: 25, depth: 15, height: 40 }
    }));
    m.addVolume(new Geometry.SphereVolume({
        id: 's', role: 'source', materialKey: 'water',
        position: { x: 40, y: 10, z: -10 },
        dimensions: { radius: 8 },
        isotopeKey: 'Cs-137', activity_Ci: 3
    }));
    const restored = Geometry.sceneFromJSON(JSON.parse(JSON.stringify(m.toJSON())));
    check('box/sphere round-trip: volume count',
        restored.volumes.length === 2);
    const rays = [
        [{ x: -80, y: 20, z: 0 }, { x: 80, y: 20, z: 0 }],
        [{ x: 40, y: -30, z: -10 }, { x: 40, y: 60, z: -10 }]
    ];
    const same = rays.every(([a, b]) =>
        JSON.stringify(m.rayTrace(a, b)) === JSON.stringify(restored.rayTrace(a, b)));
    check('box/sphere round-trip: identical ray-traces', same);
}

// ---------------------------------------------------------------------------
// Bounding-sphere ray-trace acceleration: rayTrace(a, b, accel) must return
// EXACTLY the same layers as rayTrace(a, b) for any segment — the accel is a
// pure rejection test. Exercised on a busy scene with every volume type,
// rotations, and a spread of random segments (many missing most volumes).
// ---------------------------------------------------------------------------
{
    const m = new Geometry.SceneModel();
    m.addVolume(new Geometry.CylinderVolume({
        id: 'c1', materialKey: 'water', position: { x: 0, y: 0, z: 0 },
        dimensions: { radius: 20, height: 60 }, priority: 10
    }));
    m.addVolume(new Geometry.AnnulusVolume({
        id: 'a1', materialKey: 'steel', position: { x: 0, y: 0, z: 0 },
        dimensions: { innerRadius: 20, outerRadius: 23, height: 60 }, priority: 50
    }));
    m.addVolume(new Geometry.BoxVolume({
        id: 'b1', materialKey: 'lead', position: { x: 120, y: 10, z: -40 },
        rotation: { x: 0, y: 35, z: 10 },
        dimensions: { width: 30, depth: 8, height: 50 }, priority: 20
    }));
    m.addVolume(new Geometry.SphereVolume({
        id: 's1', materialKey: 'concrete', position: { x: -150, y: 0, z: 90 },
        dimensions: { radius: 35 }, priority: 20
    }));
    m.addVolume(new Geometry.DiskVolume({
        id: 'd1', materialKey: 'lead', position: { x: 60, y: 80, z: 60 },
        rotation: { x: 20, y: 0, z: 45 },
        dimensions: { radius: 25, thickness: 3 }, priority: 30
    }));
    m.addVolume(new Geometry.BoxVolume({
        id: 'off', materialKey: 'concrete', position: { x: 0, y: 0, z: 900 },
        dimensions: { width: 100, depth: 20, height: 100 }, priority: 20,
        enabled: false   // disabled volumes must stay excluded either way
    }));

    const accel = m.buildRayAccel();
    check('accel excludes disabled volumes', accel.length === 5,
        `got ${accel.length}`);

    // Deterministic pseudo-random segments spanning the scene and far past it
    let seed = 12345;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    let mismatches = 0, tested = 0, totalLayersAccel = 0, totalLayersPlain = 0;
    for (let i = 0; i < 400; i++) {
        const a = { x: (rnd() - 0.5) * 800, y: (rnd() - 0.5) * 400, z: (rnd() - 0.5) * 800 };
        const b = { x: (rnd() - 0.5) * 800, y: (rnd() - 0.5) * 400, z: (rnd() - 0.5) * 800 };
        const plain = m.rayTrace(a, b);
        const fast = m.rayTrace(a, b, accel);
        totalLayersPlain += plain.length;
        totalLayersAccel += fast.length;
        if (JSON.stringify(plain) !== JSON.stringify(fast)) mismatches++;
        tested++;
    }
    check('accel: 400 random segments give identical layers', mismatches === 0,
        `${mismatches}/${tested} differ`);
    check('accel: traces actually hit material (non-trivial test)',
        totalLayersPlain > 400, `total layers = ${totalLayersPlain}`);
}

console.log(failures === 0
    ? '\nAll geometry checks passed.'
    : `\n${failures} geometry checks FAILED.`);
process.exit(failures === 0 ? 0 : 1);
