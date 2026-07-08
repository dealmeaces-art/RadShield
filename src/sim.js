// ============================================================================
// RadShield - Time Simulation Engine
// Transfers/discharges of activity between sources over time, optional
// radioactive decay, and spill scenarios (a puddle that grows as it fills).
//
// Key idea: with fixed geometry, dose rate is LINEAR in each source's
// activity. We precompute a dose-per-curie matrix D[source][point] once
// (the expensive ray-traced part), after which the dose at any time is
//     dose_j(t) = sum_i A_i(t) * D[i][j]
// and timeline evaluation / playback is instant. The one exception is a
// spill puddle, whose geometry (radius) changes with time - its per-curie
// dose is computed per timestep with a coarse mesh.
//
// Approximations: decay is applied to each inventory as 2^(-t/T1/2) of the
// post-transfer amount (exact for pure decay, slightly conservative for
// activity transferred late in the evolution); transferred activity adopts
// the destination source's isotope; a growing puddle contributes dose but
// its (negligible) self-shielding effect on OTHER sources' rays is not
// re-traced per step.
// ============================================================================

const Sim = (() => {

    // Cumulative fraction transferred by normalized time t in [0,1]
    const CURVES = {
        linear: { label: 'Linear (constant rate)', f: t => t },
        scurve: { label: 'S-curve (slow-fast-slow)', f: t => t * t * (3 - 2 * t) },
        front:  { label: 'Front-loaded (fast start)', f: t => 1 - (1 - t) * (1 - t) },
        back:   { label: 'Back-loaded (fast finish)', f: t => t * t }
    };

    function curveF(key) { return (CURVES[key] || CURVES.linear).f; }

    // -----------------------------------------------------------------------
    // Dose-per-curie matrix for all enabled static sources.
    // Returns [{ id, isotopeKey, base, perCi: [mrem/hr per Ci, per point] }]
    // -----------------------------------------------------------------------
    function doseMatrix(model, points, mesh, calcOpts, excludeIds) {
        const rows = [];
        for (const vol of model.volumes) {
            if (vol.enabled === false || vol.role !== 'source') continue;
            if (excludeIds && excludeIds.indexOf(vol.id) >= 0) continue;
            const savedA = vol.activity_Ci;
            vol.activity_Ci = 1;
            const els = vol.meshSource(mesh.nr, mesh.nt, mesh.nz);
            vol.activity_Ci = savedA;
            if (!els.length) continue;
            const perCi = points.map(p => Physics.volumetricSourceDose(
                els, vol.isotopeKey || 'Co-60',
                { x: p.x, y: p.y, z: p.z }, model, calcOpts).total_mrem_hr);
            rows.push({ id: vol.id, isotopeKey: vol.isotopeKey || 'Co-60',
                        base: savedA || 0, perCi: perCi });
        }
        return rows;
    }

    // -----------------------------------------------------------------------
    // Inventory (Ci per source id) at normalized time t01, applying all
    // transfers and optional decay.
    // inventory: [{id, isotopeKey, base}] ; cfg.transfers:
    //   [{ fromId|null, toId|null, amountCi, curve, viaId|null, transitCi }]
    //   null/'' fromId = activity enters from outside the scene;
    //   null/'' toId   = activity leaves the scene (discharge out).
    //   viaId = carrier (hose): holds transitCi extra while flow is active.
    // -----------------------------------------------------------------------
    function activitiesAt(inventory, cfg, t01) {
        const t = Math.min(1, Math.max(0, t01));
        const act = {};
        for (const s of inventory) act[s.id] = s.base;

        for (const tr of (cfg.transfers || [])) {
            const F = curveF(tr.curve)(t) * (tr.amountCi || 0);
            if (tr.fromId && act[tr.fromId] !== undefined) act[tr.fromId] -= F;
            if (tr.toId && act[tr.toId] !== undefined) act[tr.toId] += F;
            if (tr.viaId && act[tr.viaId] !== undefined && t > 0 && t < 1) {
                act[tr.viaId] += (tr.transitCi || 0);
            }
        }
        for (const k in act) act[k] = Math.max(0, act[k]);

        if (cfg.decay) {
            const tSec = t * (cfg.durationMin || 0) * 60;
            if (tSec > 0) {
                for (const s of inventory) {
                    const iso = Isotopes.getIsotope(s.isotopeKey);
                    if (!iso) continue;
                    act[s.id] *= Math.pow(2, -tSec / Isotopes.halfLifeToSeconds(iso.halfLife));
                }
            }
        }
        return act;
    }

    // -----------------------------------------------------------------------
    // Run a timeline.
    //   model, points: SceneModel + [{x,y,z}] (cm)
    //   cfg: { durationMin, steps, decay, transfers: [...],
    //          spill?: { volId, fromId, amountCi, totalVolume_cm3,
    //                    depth_cm, curve } }
    //   opts: { mesh: {nr,nt,nz}, includeAir, onProgress(frac) }
    // Returns:
    //   { times_min[], doses[pt][step] (mrem/hr), activities[step]{id:Ci},
    //     spillRadius_cm[step]|null, integrated_mrem[pt],
    //     peak: [{mrem_hr, at_min}] }
    // -----------------------------------------------------------------------
    function runTimeline(model, points, cfg, opts) {
        opts = opts || {};
        const mesh = opts.mesh || { nr: 3, nt: 8, nz: 6 };
        const calcOpts = { includeAir: opts.includeAir !== false };
        const steps = Math.max(2, Math.round(cfg.steps || 30));
        const durationMin = cfg.durationMin || 30;
        const onProgress = opts.onProgress || null;

        const spill = cfg.spill || null;
        const spillVol = spill ? model.getVolume(spill.volId) : null;

        // Static dose matrix (spill puddle handled separately per step)
        const matrix = doseMatrix(model, points, mesh, calcOpts,
            spillVol ? [spillVol.id] : null);

        // Inventory bookkeeping covers static sources + the puddle
        const inventory = matrix.map(s => ({ id: s.id, isotopeKey: s.isotopeKey, base: s.base }));
        if (spillVol) {
            inventory.push({ id: spillVol.id,
                isotopeKey: spillVol.isotopeKey || 'Co-60',
                base: spillVol.activity_Ci || 0 });
        }

        // Effective transfer list: the spill is a transfer into the puddle
        const transfers = (cfg.transfers || []).slice();
        if (spill && spillVol) {
            transfers.push({ fromId: spill.fromId || null, toId: spillVol.id,
                amountCi: spill.amountCi || 0, curve: spill.curve || 'linear' });
        }
        const effCfg = { durationMin: durationMin, decay: cfg.decay, transfers: transfers };

        // Per-step per-curie dose for the growing puddle
        let spillPerCi = null, spillRadius = null;
        if (spill && spillVol) {
            spillPerCi = []; spillRadius = [];
            const savedR = spillVol.radius, savedA = spillVol.activity_Ci;
            const f = curveF(spill.curve);
            for (let i = 0; i <= steps; i++) {
                const F = f(i / steps);
                const r = Math.max(1, Math.sqrt(
                    (spill.totalVolume_cm3 * F) / (Math.PI * spill.depth_cm)));
                spillRadius.push(r);
                spillVol.radius = r;
                spillVol.activity_Ci = 1;
                const els = spillVol.meshSource(3, 8, 2);
                spillPerCi.push(points.map(p => Physics.volumetricSourceDose(
                    els, spillVol.isotopeKey || 'Co-60',
                    { x: p.x, y: p.y, z: p.z }, model, calcOpts).total_mrem_hr));
                if (onProgress) onProgress(0.5 + 0.5 * (i / steps));
            }
            spillVol.radius = savedR;
            spillVol.activity_Ci = savedA;
        }

        // Evaluate the timeline (instant - matrix multiply per step)
        const times = [], activities = [];
        const doses = points.map(() => []);
        for (let i = 0; i <= steps; i++) {
            const t01 = i / steps;
            times.push(t01 * durationMin);
            const act = activitiesAt(inventory, effCfg, t01);
            activities.push(act);
            for (let j = 0; j < points.length; j++) {
                let d = 0;
                for (const s of matrix) d += act[s.id] * s.perCi[j];
                if (spillPerCi) d += act[spillVol.id] * spillPerCi[i][j];
                doses[j].push(d);
            }
        }

        // Integrated dose (trapezoid) and peak, per point
        const dtHr = (durationMin / 60) / steps;
        const integrated = [], peak = [];
        for (let j = 0; j < points.length; j++) {
            let sum = 0, pk = -1, pkAt = 0;
            for (let i = 0; i < steps; i++) sum += (doses[j][i] + doses[j][i + 1]) / 2 * dtHr;
            for (let i = 0; i <= steps; i++) {
                if (doses[j][i] > pk) { pk = doses[j][i]; pkAt = times[i]; }
            }
            integrated.push(sum);
            peak.push({ mrem_hr: pk, at_min: pkAt });
        }

        return {
            times_min: times,
            doses: doses,
            activities: activities,
            spillRadius_cm: spillRadius,
            integrated_mrem: integrated,
            peak: peak
        };
    }

    return {
        CURVES,
        doseMatrix,
        activitiesAt,
        runTimeline
    };

})();
