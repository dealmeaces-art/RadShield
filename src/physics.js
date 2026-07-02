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
    // Returns dose rate in mrem/hr (= mrad/hr for gamma, QF=1)
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

            // Mass energy-absorption coefficient for air (for dose calculation)
            const mu_en_rho_air = Materials.getMuEnRho('air', E);

            // Dose rate contribution from this energy line
            const dose_mrem = phi * E * mu_en_rho_air * DOSE_CONV;

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
    //   sourceElements: [{position: {x,y,z}, activity_Ci}]
    //   isotopeKey: isotope identifier
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
                isotopeKey,
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
    // Icosphere generator for uniform spherical sampling
    // Starts with an icosahedron and subdivides faces for even distribution.
    // Returns { vertices: [{x,y,z}], faces: [{a,b,c}] }
    // -----------------------------------------------------------------------
    function createIcosphere(subdivisions) {
        // Golden ratio
        const t = (1 + Math.sqrt(5)) / 2;

        // Icosahedron base vertices (normalized to unit sphere)
        let vertices = [
            {x:-1,y: t,z: 0},{x: 1,y: t,z: 0},{x:-1,y:-t,z: 0},{x: 1,y:-t,z: 0},
            {x: 0,y:-1,z: t},{x: 0,y: 1,z: t},{x: 0,y:-1,z:-t},{x: 0,y: 1,z:-t},
            {x: t,y: 0,z:-1},{x: t,y: 0,z: 1},{x:-t,y: 0,z:-1},{x:-t,y: 0,z: 1}
        ];
        // Normalize
        vertices = vertices.map(v => {
            const len = Math.sqrt(v.x*v.x + v.y*v.y + v.z*v.z);
            return { x: v.x/len, y: v.y/len, z: v.z/len };
        });

        // Icosahedron faces
        let faces = [
            {a:0,b:11,c:5},{a:0,b:5,c:1},{a:0,b:1,c:7},{a:0,b:7,c:10},{a:0,b:10,c:11},
            {a:1,b:5,c:9},{a:5,b:11,c:4},{a:11,b:10,c:2},{a:10,b:7,c:6},{a:7,b:1,c:8},
            {a:3,b:9,c:4},{a:3,b:4,c:2},{a:3,b:2,c:6},{a:3,b:6,c:8},{a:3,b:8,c:9},
            {a:4,b:9,c:5},{a:2,b:4,c:11},{a:6,b:2,c:10},{a:8,b:6,c:7},{a:9,b:8,c:1}
        ];

        // Subdivide
        const midpointCache = {};
        function getMidpoint(i1, i2) {
            const key = Math.min(i1,i2) + '_' + Math.max(i1,i2);
            if (midpointCache[key] !== undefined) return midpointCache[key];
            const v1 = vertices[i1], v2 = vertices[i2];
            const mx = (v1.x+v2.x)/2, my = (v1.y+v2.y)/2, mz = (v1.z+v2.z)/2;
            const len = Math.sqrt(mx*mx+my*my+mz*mz);
            vertices.push({ x:mx/len, y:my/len, z:mz/len });
            const idx = vertices.length - 1;
            midpointCache[key] = idx;
            return idx;
        }

        for (let s = 0; s < subdivisions; s++) {
            const newFaces = [];
            for (const f of faces) {
                const ab = getMidpoint(f.a, f.b);
                const bc = getMidpoint(f.b, f.c);
                const ca = getMidpoint(f.c, f.a);
                newFaces.push(
                    {a:f.a, b:ab, c:ca},
                    {a:f.b, b:bc, c:ab},
                    {a:f.c, b:ca, c:bc},
                    {a:ab, b:bc, c:ca}
                );
            }
            faces = newFaces;
            // Clear cache for next subdivision level
            for (const key in midpointCache) delete midpointCache[key];
        }

        return { vertices, faces };
    }

    // -----------------------------------------------------------------------
    // Isodose Surface Generation
    //
    // Uses icosphere ray directions for uniform sampling, binary searches
    // along each ray to find target dose rate distance.
    //
    // Parameters:
    //   sourceElements: pre-meshed source elements (use coarse mesh)
    //   isotopeKey: isotope identifier
    //   geometryModel: SceneModel with rayTrace()
    //   center: {x,y,z} center of ray-casting (source centroid)
    //   levels: [{value_mrem_hr, color, label}]
    //   options: {includeAir, subdivisions, minDist, maxDist, searchSteps}
    //   onProgress: callback(fraction) for progress updates
    //
    // Returns: [{level, points, faces}]
    // -----------------------------------------------------------------------
    function generateIsodoseSurfaces(sourceElements, isotopeKey, geometryModel, center, levels, options, onProgress) {
        const includeAir = options.includeAir !== undefined ? options.includeAir : true;
        const subdivisions = options.subdivisions || 3;
        const minDist = options.minDist || 1;
        const maxDist = options.maxDist || 2000;
        const searchSteps = options.searchSteps || 12;
        const calcOpts = { includeAir: includeAir };

        // Generate icosphere for uniform ray directions + triangulation
        const ico = createIcosphere(subdivisions);
        const directions = ico.vertices;  // unit vectors
        const icoFaces = ico.faces;       // triangulation

        // Sort levels highest to lowest
        const sortedLevels = levels.slice().sort((a, b) => b.value_mrem_hr - a.value_mrem_hr);

        // Calculate dose at a point along a ray direction
        function doseAtDistance(dir, dist) {
            const dosePos = {
                x: center.x + dir.x * dist,
                y: center.y + dir.y * dist,
                z: center.z + dir.z * dist
            };
            let total = 0;
            for (const elem of sourceElements) {
                const layers = geometryModel.rayTrace(elem.position, dosePos);
                total += pointSourceDose(elem.activity_Ci, isotopeKey, elem.position, dosePos, layers, calcOpts).total_mrem_hr;
            }
            return total;
        }

        // Binary search for the distance where dose = target
        function findIsodoseDistance(dir, targetDose) {
            let lo = minDist;
            let hi = maxDist;

            const doseAtMin = doseAtDistance(dir, lo);
            if (doseAtMin < targetDose) return -1;

            const doseAtMax = doseAtDistance(dir, hi);
            if (doseAtMax > targetDose) return maxDist;

            for (let step = 0; step < searchSteps; step++) {
                const mid = (lo + hi) / 2;
                if (doseAtDistance(dir, mid) > targetDose) {
                    lo = mid;
                } else {
                    hi = mid;
                }
            }
            return (lo + hi) / 2;
        }

        // Generate surface for each level
        const results = [];
        const totalWork = directions.length * sortedLevels.length;
        let workDone = 0;

        for (const level of sortedLevels) {
            const points = [];

            for (let di = 0; di < directions.length; di++) {
                const dist = findIsodoseDistance(directions[di], level.value_mrem_hr);

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

            // Use icosphere faces directly — filter out faces with null vertices
            const faces = [];
            for (const f of icoFaces) {
                if (points[f.a] && points[f.b] && points[f.c]) {
                    faces.push({ a: f.a, b: f.b, c: f.c });
                }
            }

            results.push({ level, points, faces });
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
        quickDose_R_hr,
        formatDose,
        formatDoseSv,
        DOSE_CONV,
        CI_TO_BQ
    };

})();
