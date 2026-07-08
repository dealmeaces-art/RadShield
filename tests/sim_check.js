// ============================================================================
// RadShield - Time simulation engine regression test
// Run with: node tests/sim_check.js
//
// Verifies the dose-per-curie matrix approach against direct dose
// calculations, transfer bookkeeping (conservation, carriers, curves),
// decay, integrated dose, and the growing-puddle spill scenario.
// ============================================================================

const fs = require('fs');
const path = require('path');

const load = f => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
const { Materials, Isotopes, Physics, Geometry, Sim } = new Function(
    load('materials.js') + '\n' + load('isotopes.js') + '\n' +
    load('physics.js') + '\n' + load('geometry.js') + '\n' + load('sim.js') +
    '\nreturn { Materials, Isotopes, Physics, Geometry, Sim };'
)();

let failures = 0;
function check(name, cond, detail) {
    if (!cond) failures++;
    console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? '  -- ' + detail : ''}`);
}
function close(a, b, rel) { return Math.abs(a - b) <= Math.abs(b) * (rel || 1e-9); }

const MESH = { nr: 3, nt: 6, nz: 4 };
const OPTS = { mesh: MESH, includeAir: true };

// ---------------------------------------------------------------------------
// Scene: hose (carrier) + receiving tank sludge + a dose point
// ---------------------------------------------------------------------------
function makeScene() {
    const m = new Geometry.SceneModel();
    m.addVolume(new Geometry.CylinderVolume({
        id: 'hose', role: 'source', materialKey: 'water',
        position: { x: -80, y: 0, z: 0 },
        dimensions: { radius: 2.54, height: 200 },
        isotopeKey: 'Co-60', activity_Ci: 0
    }));
    m.addVolume(new Geometry.CylinderVolume({
        id: 'sludge', role: 'source', materialKey: 'water',
        position: { x: 80, y: 0, z: 0 },
        dimensions: { radius: 40, height: 6 },
        isotopeKey: 'Co-60', activity_Ci: 0
    }));
    return m;
}
const POINTS = [{ x: 0, y: 100, z: 0 }, { x: 200, y: 30, z: 0 }];

// ---------------------------------------------------------------------------
// 1. Matrix linearity: timeline end state matches a direct calculation
// ---------------------------------------------------------------------------
{
    const m = makeScene();
    const cfg = {
        durationMin: 30, steps: 10, decay: false,
        transfers: [{ fromId: null, toId: 'sludge', amountCi: 10, curve: 'linear',
                      viaId: 'hose', transitCi: 0.5 }]
    };
    const res = Sim.runTimeline(m, POINTS, cfg, OPTS);

    // Direct check at t = end: sludge holds 10 Ci, hose 0
    m.getVolume('sludge').activity_Ci = 10;
    const els = m.getVolume('sludge').meshSource(MESH.nr, MESH.nt, MESH.nz);
    const direct = Physics.volumetricSourceDose(els, 'Co-60', POINTS[0], m, { includeAir: true });
    m.getVolume('sludge').activity_Ci = 0;

    check('end-state dose matches direct calculation',
        close(res.doses[0][10], direct.total_mrem_hr, 1e-9),
        `sim=${res.doses[0][10]}, direct=${direct.total_mrem_hr}`);
    check('dose starts at zero (empty system)', res.doses[0][0] === 0);
    check('dose is monotonically rising for a linear fill',
        res.doses[0].every((d, i, a) => i === 0 || d >= a[i - 1] - 1e-12));
    check('two dose points tracked independently',
        res.doses.length === 2 && res.doses[1][10] > 0 &&
        res.doses[1][10] !== res.doses[0][10]);
}

// ---------------------------------------------------------------------------
// 2. Transfer bookkeeping: conservation, carrier inventory, curves
// ---------------------------------------------------------------------------
{
    const m = makeScene();
    m.getVolume('hose').activity_Ci = 0;
    const inv = [
        { id: 'tankA', isotopeKey: 'Co-60', base: 10 },
        { id: 'tankB', isotopeKey: 'Co-60', base: 2 },
        { id: 'hose', isotopeKey: 'Co-60', base: 0 }
    ];
    const cfg = { durationMin: 30, decay: false, transfers: [
        { fromId: 'tankA', toId: 'tankB', amountCi: 6, curve: 'linear', viaId: 'hose', transitCi: 0.4 }
    ]};

    const mid = Sim.activitiesAt(inv, cfg, 0.5);
    check('mid-transfer: A down 3, B up 3',
        close(mid.tankA, 7) && close(mid.tankB, 5), JSON.stringify(mid));
    check('mid-transfer: hose carries transit inventory', close(mid.hose, 0.4));
    check('total conserved mid-transfer (excl. transit)',
        close(mid.tankA + mid.tankB, 12));

    const end = Sim.activitiesAt(inv, cfg, 1.0);
    check('end: A=4, B=8, hose flushed',
        close(end.tankA, 4) && close(end.tankB, 8) && end.hose === 0);

    // S-curve reaches the same endpoint but lags at the midpoint
    const s = Sim.activitiesAt(inv, { ...cfg, transfers: [{ ...cfg.transfers[0], curve: 'scurve' }] }, 0.25);
    check('s-curve lags linear early on', s.tankB - 2 < 1.5 && s.tankB > 2,
        `B=${s.tankB}`);

    // Clamping: cannot go negative
    const over = Sim.activitiesAt([{ id: 'a', isotopeKey: 'Co-60', base: 1 }],
        { durationMin: 1, transfers: [{ fromId: 'a', toId: null, amountCi: 5, curve: 'linear' }] }, 1);
    check('over-transfer clamps at zero', over.a === 0);
}

// ---------------------------------------------------------------------------
// 3. Decay: one half-life halves the dose (Na-24, 15 h)
// ---------------------------------------------------------------------------
{
    const m = makeScene();
    m.getVolume('sludge').isotopeKey = 'Na-24';
    m.getVolume('sludge').activity_Ci = 4;
    const halfLifeMin = 14.997 * 60;
    const res = Sim.runTimeline(m, [POINTS[0]],
        { durationMin: halfLifeMin, steps: 4, decay: true, transfers: [] }, OPTS);
    check('one half-life halves the dose rate',
        close(res.doses[0][4], res.doses[0][0] / 2, 1e-6),
        `start=${res.doses[0][0]}, end=${res.doses[0][4]}`);
}

// ---------------------------------------------------------------------------
// 4. Integrated dose: constant source over 2 hours = 2 x dose rate
// ---------------------------------------------------------------------------
{
    const m = makeScene();
    m.getVolume('sludge').activity_Ci = 5;
    const res = Sim.runTimeline(m, [POINTS[0]],
        { durationMin: 120, steps: 12, decay: false, transfers: [] }, OPTS);
    check('constant source: integrated = rate x hours',
        close(res.integrated_mrem[0], res.doses[0][0] * 2, 1e-9),
        `integrated=${res.integrated_mrem[0]}, rate=${res.doses[0][0]}`);
    check('peak of a falling/flat curve reported at t=0',
        res.peak[0].mrem_hr === res.doses[0][0]);
}

// ---------------------------------------------------------------------------
// 5. Spill: growing puddle - radius law, conservation, end-state dose
// ---------------------------------------------------------------------------
{
    const m = makeScene();
    m.getVolume('sludge').activity_Ci = 8;
    const GAL = 3785.41;
    const depth = 0.6;
    m.addVolume(new Geometry.DiskVolume({
        id: 'puddle', role: 'source', materialKey: 'water',
        position: { x: 0, y: 0, z: 120 },
        dimensions: { radius: 1, thickness: depth },
        isotopeKey: 'Co-60', activity_Ci: 0
    }));

    const cfg = {
        durationMin: 20, steps: 8, decay: false, transfers: [],
        spill: { volId: 'puddle', fromId: 'sludge', amountCi: 3,
                 totalVolume_cm3: 10 * GAL, depth_cm: depth, curve: 'linear' }
    };
    const res = Sim.runTimeline(m, POINTS, cfg, OPTS);

    const rEnd = Math.sqrt(10 * GAL / (Math.PI * depth));
    check('puddle radius follows sqrt(V/(pi d))',
        close(res.spillRadius_cm[8], rEnd, 1e-9),
        `r=${res.spillRadius_cm[8]}, expected=${rEnd}`);
    check('puddle radius grows monotonically',
        res.spillRadius_cm.every((r, i, a) => i === 0 || r >= a[i - 1]));

    const actEnd = res.activities[8];
    check('spill conserves activity (tank 5, puddle 3)',
        close(actEnd.sludge, 5) && close(actEnd.puddle, 3), JSON.stringify(actEnd));

    const pud = m.getVolume('puddle');
    check('model restored after simulation (puddle back to initial size)',
        pud.radius === 1 && pud.activity_Ci === 0 &&
        m.getVolume('sludge').activity_Ci === 8,
        `r=${pud.radius}, A=${pud.activity_Ci}`);

    // Direct end-state check: tank at 5 Ci + full-size puddle at 3 Ci
    m.getVolume('sludge').activity_Ci = 5;
    pud.radius = rEnd; pud.activity_Ci = 3;
    const els = [...m.getVolume('sludge').meshSource(MESH.nr, MESH.nt, MESH.nz),
                 ...pud.meshSource(3, 8, 2)];
    const direct = Physics.volumetricSourceDose(els, 'Co-60', POINTS[0], m, { includeAir: true });
    check('spill end-state dose matches direct calculation',
        close(res.doses[0][8], direct.total_mrem_hr, 1e-9),
        `sim=${res.doses[0][8]}, direct=${direct.total_mrem_hr}`);
}

console.log(failures === 0
    ? '\nAll simulation checks passed.'
    : `\n${failures} simulation checks FAILED.`);
process.exit(failures === 0 ? 0 : 1);
