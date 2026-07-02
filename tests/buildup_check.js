// ============================================================================
// RadShield - Buildup factor regression test
// Run with: node tests/buildup_check.js
//
// Checks Materials.getBuildup() (GP fit, ANSI/ANS-6.4.3-1991 Table 5.1
// exposure coefficients) against the standard's tabulated exposure buildup
// factors (Table 3). Tolerance reflects the GP fit's own quoted max
// deviation (typically 1-3%); air is checked looser because it uses the
// energy-absorption coefficient set (no exposure set published for air).
// ============================================================================

const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'materials.js'), 'utf8');
const Materials = new Function(src + '\nreturn Materials;')();

// [materialKey, energy_MeV, mfp, tabulated B (ANS-6.4.3 Table 3), tolerance]
const CASES = [
    // Water (std p.39)
    ['water', 1.0,  1.0, 2.08,  0.03],
    ['water', 1.0, 10.0, 26.1,  0.03],
    ['water', 1.0, 40.0, 218.0, 0.04],
    ['water', 0.5,  2.0, 4.88,  0.03],
    ['water', 0.5, 10.0, 62.9,  0.03],
    ['water', 2.0, 10.0, 12.7,  0.03],
    ['water', 5.0, 10.0, 6.05,  0.03],
    ['water', 0.1,  5.0, 65.2,  0.04],
    ['water', 15.0, 10.0, 3.05, 0.03],
    // Iron / steel (std p.30)
    ['steel', 1.0,  1.0, 1.85,  0.03],
    ['steel', 1.0, 10.0, 15.8,  0.03],
    ['steel', 1.0, 20.0, 41.3,  0.03],
    ['steel', 0.5, 10.0, 19.1,  0.03],
    ['steel', 3.0, 10.0, 8.80,  0.03],
    ['steel', 0.1, 10.0, 2.61,  0.04],
    // Lead (std p.37)
    ['lead', 1.0,  1.0, 1.38,   0.03],
    ['lead', 1.0, 10.0, 3.51,   0.03],
    ['lead', 0.5, 10.0, 2.10,   0.03],
    ['lead', 2.0, 10.0, 5.07,   0.03],
    ['lead', 6.0, 10.0, 6.61,   0.04],
    // Concrete (std p.41)
    ['concrete', 1.0,  1.0, 1.98,  0.03],
    ['concrete', 1.0, 10.0, 20.7,  0.03],
    ['concrete', 0.5, 10.0, 36.4,  0.03],
    ['concrete', 5.0, 10.0, 6.15,  0.03],
    ['concrete', 0.15, 10.0, 42.7, 0.04],
    // Air (std p.40) - energy-absorption coefficients vs exposure table
    ['air', 1.0, 10.0, 25.8, 0.05],
    ['air', 0.5, 10.0, 60.6, 0.05],
    ['air', 2.0, 10.0, 12.6, 0.05],
];

let failures = 0;
for (const [mat, E, mfp, expected, tol] of CASES) {
    const got = Materials.getBuildup(mat, E, mfp);
    const relErr = Math.abs(got - expected) / expected;
    const ok = relErr <= tol;
    if (!ok) failures++;
    console.log(
        `${ok ? 'PASS' : 'FAIL'}  ${mat.padEnd(9)} E=${String(E).padEnd(5)} MeV ` +
        `x=${String(mfp).padEnd(4)} mfp  B=${got.toFixed(3).padStart(8)}  ` +
        `table=${String(expected).padStart(6)}  err=${(relErr * 100).toFixed(2)}%`
    );
}

console.log(failures === 0
    ? `\nAll ${CASES.length} buildup checks passed.`
    : `\n${failures} of ${CASES.length} buildup checks FAILED.`);
process.exit(failures === 0 ? 0 : 1);
