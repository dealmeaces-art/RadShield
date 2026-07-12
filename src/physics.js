// ============================================================================
// RadShield - Physics Engine
// Point-kernel dose rate calculation with buildup factors
// ============================================================================

const Physics = (() => {

    // -----------------------------------------------------------------------
    // Constants
    // -----------------------------------------------------------------------
    const CI_TO_BQ = 3.7e10;           // 1 Ci = 3.7e10 disintegrations/sec
    const MEV_TO_ERG = 1.602e-6;       // 1 MeV = 1.602e-6 erg
    const ERG_PER_G_TO_RAD = 100;      // 1 rad = 100 erg/g
    const SEC_PER_HOUR = 3600;

    // Combined conversion factor for dose rate calculation
    // Converts from [photons/(cm²·s)] × [MeV] × [cm²/g] to mrad/hr
    // = MeV_to_erg × sec_to_hr × 1000(mrad/rad) / erg_per_g_per_rad
    // = 1.602e-6 × 3600 × 1000 / 100 = 5.767e-2
    const DOSE_CONV = MEV_TO_ERG * SEC_PER_HOUR * 1000 / ERG_PER_G_TO_RAD;

    // -----------------------------------------------------------------------
    // Calculate dose rate at a point from a single point source element
    //
    // Returns dose rate in mrem/hr: absorbed dose to soft tissue (ICRU-44),
    // QF=1 for photons so mrad(tissue)/hr = mrem/hr.
    //
    // Parameters:
    //   activity_Ci:  source element activity (Ci)
    //   isotopeKey:   isotope identifier (e.g., 'Co-60')
    //   sourcePos:    {x, y, z} position of source element (cm)
    //   dosePos:      {x, y, z} position of dose point (cm)
    //   shieldLayers: [{materialKey, thickness_cm}] - materials along the ray
    //                 (ordered from source to dose point)
    //
    // Returns: { total_mrem_hr, total_mSv_hr, byEnergy: [{energy, dose}] }
    // -----------------------------------------------------------------------
    function pointSourceDose(activity_Ci, isotopeKey, sourcePos, dosePos, shieldLayers, options) {
        const isotope = Isotopes.getIsotope(isotopeKey);
        if (!isotope) throw new Error(`Unknown isotope: ${isotopeKey}`);
        const includeAir = options && options.includeAir !== undefined ? options.includeAir : true;

        // Distance from source to dose point
        const dx = dosePos.x - sourcePos.x;
        const dy = dosePos.y - sourcePos.y;
        const dz = dosePos.z - sourcePos.z;
        const r_cm = Math.sqrt(dx * dx + dy * dy + dz * dz);

        if (r_cm < 0.01) return { total_mrem_hr: Infinity, total_mSv_hr: Infinity, byEnergy: [] };

        const r2 = r_cm * r_cm;
        let total_mrem = 0;
        const byEnergy = [];

        for (const line of isotope.gammaLines) {
            const E = line.energy_MeV;
            const y = line.yield;

            // Source emission rate for this line
            const S = activity_Ci * CI_TO_BQ * y;  // photons/sec

            // Uncollided fluence rate at dose point
            const phi_unc = S / (4 * Math.PI * r2);  // photons/(cm²·s)

            // Calculate total mean free paths through all shield layers
            let totalMFP = 0;
            let outermostMaterial = null;

            for (const layer of shieldLayers) {
                // Skip air layers if air attenuation is disabled
                if (!includeAir && layer.materialKey === 'air') continue;

                const mu = Materials.getMu(layer.materialKey, E);
                const mfp = mu * layer.thickness_cm;
                totalMFP += mfp;
                // Track the last significant non-air material (closest to dose point)
                if (layer.materialKey !== 'air' && mfp > 0.001) {
                    outermostMaterial = layer.materialKey;
                }
            }

            // Buildup factor - use outermost (last) material's GP parameters
            // applied to total MFP. This matches MicroShield's approach:
            // scattered radiation near the dose point is shaped by the
            // last significant shield material encountered.
            let B = 1.0;
            if (outermostMaterial && totalMFP > 0) {
                B = Materials.getBuildup(outermostMaterial, E, totalMFP);
            }

            // Attenuated fluence rate with buildup
            const phi = phi_unc * B * Math.exp(-totalMFP);

            // Fluence -> absorbed dose in SOFT TISSUE (ICRU-44). Photons have
            // QF=1, so mrad(tissue) = mrem. Using air here instead (as pre-v0.9
            // builds did) yields air kerma, which underestimates tissue dose by
            // ~10% at Co-60 energies and reads ~14% below an exposure (mR/hr)
            // instrument or MicroShield's exposure column.
            const mu_en_rho_tissue = Materials.getTissueMuEnRho(E);

            // Dose rate contribution from this energy line
            const dose_mrem = phi * E * mu_en_rho_tissue * DOSE_CONV;

            total_mrem += dose_mrem;
            byEnergy.push({ energy_MeV: E, dose_mrem_hr: dose_mrem });
        }

        return {
            total_mrem_hr: total_mrem,
            total_mSv_hr: total_mrem / 100,  // 100 mrem = 1 mSv
            byEnergy: byEnergy
        };
    }

    // -----------------------------------------------------------------------
    // Calculate dose rate from a meshed volumetric source
    //
    // Parameters:
    //   sourceElements: [{position: {x,y,z}, activity_Ci, isotopeKey?}]
    //       Elements meshed from source volumes carry their own isotopeKey,
    //       so mixed-isotope scenes transport each source with its own
    //       gamma lines.
    //   isotopeKey: fallback isotope for elements without their own
    //   dosePos: {x, y, z} dose point position (cm)
    //   geometryModel: object with rayTrace(from, to) method that returns
    //                  [{materialKey, thickness_cm}]
    //
    // Returns: { total_mrem_hr, total_mSv_hr, elementCount }
    // -----------------------------------------------------------------------
    function volumetricSourceDose(sourceElements, isotopeKey, dosePos, geometryModel, options) {
        let total_mrem = 0;
        let total_mSv = 0;

        for (const elem of sourceElements) {
            // Ray-trace from source element to dose point through geometry
            const shieldLayers = geometryModel.rayTrace(elem.position, dosePos);

            const result = pointSourceDose(
                elem.activity_Ci,
                elem.isotopeKey || isotopeKey,
                elem.position,
                dosePos,
                shieldLayers,
                options
            );

            total_mrem += result.total_mrem_hr;
        }

        total_mSv = total_mrem / 100;

        return {
            total_mrem_hr: total_mrem,
            total_mSv_hr: total_mSv,
            elementCount: sourceElements.length
        };
    }

    // -----------------------------------------------------------------------
    // Quick unshielded point source dose rate (for verification)
    // Uses the specific gamma constant directly
    //
    // Returns dose rate in R/hr at given distance
    // -----------------------------------------------------------------------
    function quickDose_R_hr(activity_Ci, isotopeKey, distance_m) {
        const isotope = Isotopes.getIsotope(isotopeKey);
        if (!isotope) return 0;
        return activity_Ci * isotope.specificGammaConstant / (distance_m * distance_m);
    }

    // -----------------------------------------------------------------------
    // Format dose rate for display
    // -----------------------------------------------------------------------
    function formatDose(mrem_hr) {
        if (mrem_hr >= 1e6) {
            return (mrem_hr / 1e6).toFixed(2) + ' krem/hr';
        } else if (mrem_hr >= 1000) {
            return (mrem_hr / 1000).toFixed(2) + ' rem/hr';
        } else if (mrem_hr >= 1) {
            return mrem_hr.toFixed(2) + ' mrem/hr';
        } else if (mrem_hr >= 0.001) {
            return (mrem_hr * 1000).toFixed(2) + ' \u00b5rem/hr';
        } else {
            return mrem_hr.toExponential(3) + ' mrem/hr';
        }
    }

    function formatDoseSv(mSv_hr) {
        if (mSv_hr >= 1000) {
            return (mSv_hr / 1000).toFixed(2) + ' Sv/hr';
        } else if (mSv_hr >= 1) {
            return mSv_hr.toFixed(2) + ' mSv/hr';
        } else if (mSv_hr >= 0.001) {
            return (mSv_hr * 1000).toFixed(2) + ' µSv/hr';
        } else {
            return mSv_hr.toExponential(3) + ' mSv/hr';
        }
    }

    // -----------------------------------------------------------------------
    // Geodesic icosphere generator for uniform spherical sampling.
    // Each icosahedron face is split into freq² triangles (barycentric grid,
    // projected to the unit sphere), giving 10·freq²+2 vertices. Unlike the
    // old recursive midpoint subdivision (which could only do 42/162/642/2562
    // = freq 2/4/8/16), any even spacing is available — freq 6 = 362 rays
    // sits between Low (162) and Medium (642).
    // Returns { vertices: [{x,y,z}], faces: [{a,b,c}] }
    // -----------------------------------------------------------------------
    function createIcosphere(freq) {
        freq = Math.max(1, Math.round(freq));
        const t = (1 + Math.sqrt(5)) / 2;
        const base = [
            {x:-1,y: t,z: 0},{x: 1,y: t,z: 0},{x:-1,y:-t,z: 0},{x: 1,y:-t,z: 0},
            {x: 0,y:-1,z: t},{x: 0,y: 1,z: t},{x: 0,y:-1,z:-t},{x: 0,y: 1,z:-t},
            {x: t,y: 0,z:-1},{x: t,y: 0,z: 1},{x:-t,y: 0,z:-1},{x:-t,y: 0,z: 1}
        ].map(v => {
            const len = Math.sqrt(v.x*v.x + v.y*v.y + v.z*v.z);
            return { x: v.x/len, y: v.y/len, z: v.z/len };
        });
        const baseFaces = [
            {a:0,b:11,c:5},{a:0,b:5,c:1},{a:0,b:1,c:7},{a:0,b:7,c:10},{a:0,b:10,c:11},
            {a:1,b:5,c:9},{a:5,b:11,c:4},{a:11,b:10,c:2},{a:10,b:7,c:6},{a:7,b:1,c:8},
            {a:3,b:9,c:4},{a:3,b:4,c:2},{a:3,b:2,c:6},{a:3,b:6,c:8},{a:3,b:8,c:9},
            {a:4,b:9,c:5},{a:2,b:4,c:11},{a:6,b:2,c:10},{a:8,b:6,c:7},{a:9,b:8,c:1}
        ];

        const vertices = [];
        const vmap = new Map();   // dedupe shared edge/corner vertices
        function addVert(x, y, z) {
            const len = Math.sqrt(x*x + y*y + z*z);
            x /= len; y /= len; z /= len;
            const key = Math.round(x*1e6) + ',' + Math.round(y*1e6) + ',' + Math.round(z*1e6);
            if (vmap.has(key)) return vmap.get(key);
            vertices.push({ x, y, z });
            vmap.set(key, vertices.length - 1);
            return vertices.length - 1;
        }

        const faces = [];
        for (const f of baseFaces) {
            const A = base[f.a], B = base[f.b], C = base[f.c];
            // Barycentric grid: idx[i][j] with i along A→B, j along A→C
            const idx = [];
            for (let i = 0; i <= freq; i++) {
                idx.push([]);
                for (let j = 0; j <= freq - i; j++) {
                    const u = i / freq, v = j / freq;
                    idx[i].push(addVert(
                        A.x + (B.x - A.x) * u + (C.x - A.x) * v,
                        A.y + (B.y - A.y) * u + (C.y - A.y) * v,
                        A.z + (B.z - A.z) * u + (C.z - A.z) * v
                    ));
                }
            }
            for (let i = 0; i < freq; i++) {
                for (let j = 0; j < freq - i; j++) {
                    faces.push({ a: idx[i][j], b: idx[i + 1][j], c: idx[i][j + 1] });
                    if (j < freq - i - 1) {
                        faces.push({ a: idx[i + 1][j], b: idx[i + 1][j + 1], c: idx[i][j + 1] });
                    }
                }
            }
        }

        return { vertices, faces };
    }

    // -----------------------------------------------------------------------
    // Isodose Surface Generation
    //
    // Uses icosphere ray directions for uniform sampling, binary searches
    // along each ray to find target dose rate distance.
    //
    // Ray fans are cast from EACH source's own center (one vantage per
    // source), while the dose at every sample still sums ALL source
    // elements. A single shared centroid misses the high-dose lobes around
    // individual sources when sources are far apart: the first sample near
    // the centroid reads below the level and the ray reports "no surface".
    // Per-source vantages draw each lobe; overlapping surfaces from nearby
    // sources simply draw on top of each other (visual union).
    //
    // Parameters:
    //   sourceElements: pre-meshed source elements (all sources combined)
    //   isotopeKey: isotope identifier
    //   geometryModel: SceneModel with rayTrace()
    //   centers: [{x,y,z}] ray-cast vantage per source (single object ok)
    //   levels: [{value_mrem_hr, color, label}]
    //   options: {includeAir, subdivisions, minDist, maxDist, searchSteps}
    //   onProgress: callback(fraction) for progress updates
    //
    // Returns: [{level, center, points, faces}] — one entry per
    //          (level x center) pair that produced any points
    // -----------------------------------------------------------------------
    function generateIsodoseSurfaces(sourceElements, isotopeKey, geometryModel, centers, levels, options, onProgress) {
        const includeAir = options.includeAir !== undefined ? options.includeAir : true;
        // frequency = geodesic density (rays = 10·freq²+2); legacy subdivisions
        // map to freq 2^n so old callers keep their ray counts
        const frequency = options.frequency || Math.pow(2, options.subdivisions || 3);
        const minDist = options.minDist || 1;
        const maxDist = options.maxDist || 2000;
        const searchSteps = options.searchSteps || 12;
        const calcOpts = { includeAir: includeAir };
        const centerList = Array.isArray(centers) ? centers : [centers];

        // Generate icosphere for uniform ray directions + triangulation
        const ico = createIcosphere(frequency);
        const directions = ico.vertices;  // unit vectors
        const icoFaces = ico.faces;       // triangulation

        // Sort levels highest to lowest
        const sortedLevels = levels.slice().sort((a, b) => b.value_mrem_hr - a.value_mrem_hr);

        // True dose at a world point: every element with its own isotope,
        // ray-traced shielding
        function doseAtPoint(dosePos) {
            let total = 0;
            for (const elem of sourceElements) {
                const layers = geometryModel.rayTrace(elem.position, dosePos);
                total += pointSourceDose(elem.activity_Ci, elem.isotopeKey || isotopeKey,
                    elem.position, dosePos, layers, calcOpts).total_mrem_hr;
            }
            return total;
        }

        function doseAtDistance(center, dir, dist) {
            return doseAtPoint({
                x: center.x + dir.x * dist,
                y: center.y + dir.y * dist,
                z: center.z + dir.z * dist
            });
        }

        // Find the distance where the dose first falls to the target level:
        // march outward (x1.5 per step) until the dose first drops below the
        // target, then bisect inside that bracket. Taking the FIRST crossing
        // keeps each vantage's surface to its own lobe — a plain lo/hi
        // bisection over [min, max] could tunnel through a low-dose corridor
        // and land on the far side of ANOTHER source's lobe, drawing spikes
        // between separated sources.
        function findIsodoseDistance(center, dir, targetDose) {
            if (doseAtDistance(center, dir, minDist) < targetDose) return -1;

            let lo = minDist;
            let hi = -1;
            for (let d = minDist * 1.5; ; d *= 1.5) {
                if (d >= maxDist) {
                    if (doseAtDistance(center, dir, maxDist) > targetDose) {
                        return maxDist;  // surface beyond search range
                    }
                    hi = maxDist;
                    break;
                }
                if (doseAtDistance(center, dir, d) < targetDose) { hi = d; break; }
                lo = d;
            }

            for (let step = 0; step < searchSteps; step++) {
                const mid = (lo + hi) / 2;
                if (doseAtDistance(center, dir, mid) > targetDose) {
                    lo = mid;
                } else {
                    hi = mid;
                }
            }
            return (lo + hi) / 2;
        }

        // Generate one surface per (level x source vantage)
        const results = [];
        const totalWork = directions.length * sortedLevels.length * centerList.length;
        let workDone = 0;

        for (const level of sortedLevels) {
            for (const center of centerList) {
                const points = [];

                for (let di = 0; di < directions.length; di++) {
                    const dist = findIsodoseDistance(center, directions[di], level.value_mrem_hr);

                    if (dist > 0) {
                        points.push({
                            x: center.x + directions[di].x * dist,
                            y: center.y + directions[di].y * dist,
                            z: center.z + directions[di].z * dist
                        });
                    } else {
                        points.push(null);
                    }

                    workDone++;
                    if (onProgress && workDone % 10 === 0) {
                        onProgress(workDone / totalWork);
                    }
                }

                // Use icosphere faces directly — skip faces with null vertices
                const faces = [];
                for (const f of icoFaces) {
                    if (points[f.a] && points[f.b] && points[f.c]) {
                        faces.push({ a: f.a, b: f.b, c: f.c });
                    }
                }

                results.push({ level, center, points, faces });
            }
        }

        if (onProgress) onProgress(1);
        return results;
    }

    // -----------------------------------------------------------------------
    // Async isodose generation — same physics, same sample positions, same
    // answers as generateIsodoseSurfaces, with two improvements:
    //
    //  1. It yields to the event loop every ~40 ms, so the page stays
    //     responsive and the progress % actually paints during long runs
    //     (no more "page not responding" on big scenes).
    //  2. One outward march per ray brackets ALL levels at once. Along a
    //     given ray the crossings for descending levels sit at increasing
    //     distances, and the march samples (minDist × 1.5^k) are identical
    //     for every level — so re-marching per level (what the sync version
    //     does) is pure duplicated work. Bisection still runs per level.
    //
    // Returns a Promise of the same [{level, center, points, faces}] list,
    // in the same order (levels sorted high→low, then centers).
    // -----------------------------------------------------------------------
    async function generateIsodoseSurfacesAsync(sourceElements, isotopeKey, geometryModel, centers, levels, options, onProgress) {
        const includeAir = options.includeAir !== undefined ? options.includeAir : true;
        const frequency = options.frequency || Math.pow(2, options.subdivisions || 3);
        const minDist = options.minDist || 1;
        const maxDist = options.maxDist || 2000;
        const searchSteps = options.searchSteps || 12;
        const calcOpts = { includeAir: includeAir };
        const centerList = Array.isArray(centers) ? centers : [centers];

        const ico = createIcosphere(frequency);
        const directions = ico.vertices;
        const icoFaces = ico.faces;
        const sortedLevels = levels.slice().sort((a, b) => b.value_mrem_hr - a.value_mrem_hr);

        // Bounding-sphere acceleration for the ray-tracer: volumes a segment
        // provably cannot touch are skipped. Purely a rejection test — the
        // layers that come back are identical (regression-checked against the
        // sync reference, which does not use it).
        const rayAccel = geometryModel.buildRayAccel ? geometryModel.buildRayAccel() : null;

        // Every decision this algorithm makes is "is dose above/below a level?"
        // — never the value itself. Dose is a sum of nonnegative element
        // kernels, so once the running sum passes `breakAbove` the comparison
        // outcome is locked and the remaining elements can be skipped. Same
        // summation order, so every decision (and thus every vertex) is
        // bit-identical to the exhaustive sum.
        function doseAtPoint(dosePos, breakAbove) {
            let total = 0;
            for (const elem of sourceElements) {
                const layers = geometryModel.rayTrace(elem.position, dosePos, rayAccel);
                total += pointSourceDose(elem.activity_Ci, elem.isotopeKey || isotopeKey,
                    elem.position, dosePos, layers, calcOpts).total_mrem_hr;
                if (breakAbove !== undefined && total > breakAbove) return total;
            }
            return total;
        }
        function doseAtDistance(center, dir, dist, breakAbove) {
            return doseAtPoint({
                x: center.x + dir.x * dist,
                y: center.y + dir.y * dist,
                z: center.z + dir.z * dist
            }, breakAbove);
        }

        // Cooperative yield: give the browser a paint/input window every ~40 ms
        const now = (typeof performance !== 'undefined' && performance.now)
            ? () => performance.now() : () => Date.now();
        let lastYield = now();
        async function maybeYield() {
            if (now() - lastYield > 40) {
                await new Promise(r => setTimeout(r, 0));
                lastYield = now();
            }
        }

        // points[levelIdx][centerIdx] = per-direction vertex list
        const points = sortedLevels.map(() => centerList.map(() => []));
        const totalWork = directions.length * centerList.length;
        let workDone = 0;

        // March samples are compared against EVERY level, so their early-exit
        // ceiling must be the highest level: a partial sum that exceeds it
        // answers "above" for all levels; anything else is summed exactly.
        const levelMax = sortedLevels.length ? sortedLevels[0].value_mrem_hr : undefined;

        for (let ci = 0; ci < centerList.length; ci++) {
            const center = centerList[ci];
            for (let di = 0; di < directions.length; di++) {
                const dir = directions[di];

                // Dose at the innermost sample decides which levels are live
                // on this ray at all (mirrors the sync version's early-out).
                const s0 = doseAtDistance(center, dir, minDist, levelMax);
                let smallestLive = null;
                for (const lev of sortedLevels) {
                    if (s0 >= lev.value_mrem_hr) smallestLive = lev.value_mrem_hr;
                }

                // ONE outward march (identical sample ladder to the sync
                // version: minDist × 1.5^k), recorded so every level can
                // find its own first-crossing bracket in it.
                const samples = [];
                let reachedMax = false, maxSample = 0;
                if (smallestLive !== null) {
                    for (let d = minDist * 1.5; ; d *= 1.5) {
                        if (d >= maxDist) {
                            reachedMax = true;
                            maxSample = doseAtDistance(center, dir, maxDist, levelMax);
                            break;
                        }
                        const s = doseAtDistance(center, dir, d, levelMax);
                        samples.push({ d: d, dose: s });
                        if (s < smallestLive) break;   // every live level has bracketed
                    }
                }

                for (let li = 0; li < sortedLevels.length; li++) {
                    const L = sortedLevels[li].value_mrem_hr;
                    if (s0 < L) { points[li][ci].push(null); continue; }

                    // First crossing = first march sample below the level
                    let k = -1;
                    for (let i = 0; i < samples.length; i++) {
                        if (samples[i].dose < L) { k = i; break; }
                    }

                    let lo, hi;
                    if (k === 0) { lo = minDist; hi = samples[0].d; }
                    else if (k > 0) { lo = samples[k - 1].d; hi = samples[k].d; }
                    else if (reachedMax) {
                        if (maxSample > L) {   // surface beyond search range — clamp
                            points[li][ci].push({
                                x: center.x + dir.x * maxDist,
                                y: center.y + dir.y * maxDist,
                                z: center.z + dir.z * maxDist
                            });
                            continue;
                        }
                        lo = samples.length ? samples[samples.length - 1].d : minDist;
                        hi = maxDist;
                    } else {
                        points[li][ci].push(null);   // unreachable; defensive
                        continue;
                    }

                    for (let step = 0; step < searchSteps; step++) {
                        const mid = (lo + hi) / 2;
                        // Bisection only compares against THIS level
                        if (doseAtDistance(center, dir, mid, L) > L) lo = mid;
                        else hi = mid;
                    }
                    const dist = (lo + hi) / 2;
                    points[li][ci].push({
                        x: center.x + dir.x * dist,
                        y: center.y + dir.y * dist,
                        z: center.z + dir.z * dist
                    });
                }

                workDone++;
                if (onProgress && workDone % 5 === 0) onProgress(workDone / totalWork);
                await maybeYield();
            }
        }

        // Assemble in the sync version's order: level outer, center inner
        const results = [];
        for (let li = 0; li < sortedLevels.length; li++) {
            for (let ci = 0; ci < centerList.length; ci++) {
                const pts = points[li][ci];
                const faces = [];
                for (const f of icoFaces) {
                    if (pts[f.a] && pts[f.b] && pts[f.c]) {
                        faces.push({ a: f.a, b: f.b, c: f.c });
                    }
                }
                results.push({ level: sortedLevels[li], center: centerList[ci], points: pts, faces });
            }
        }

        if (onProgress) onProgress(1);
        return results;
    }

    // -----------------------------------------------------------------------
    // Public API
    // -----------------------------------------------------------------------
    return {
        pointSourceDose,
        volumetricSourceDose,
        generateIsodoseSurfaces,
        generateIsodoseSurfacesAsync,
        quickDose_R_hr,
        formatDose,
        formatDoseSv,
        DOSE_CONV,
        CI_TO_BQ
    };

})();
