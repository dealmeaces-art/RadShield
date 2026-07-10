// ============================================================================
// RadShield - Geometry Module v2
// Volume-based scene model with flexible source and shield placement
// ============================================================================

const Geometry = (() => {

    // -----------------------------------------------------------------------
    // Unit conversion helpers
    // -----------------------------------------------------------------------
    const INCH_TO_CM = 2.54;
    const FT_TO_CM = 30.48;
    const M_TO_CM = 100;

    function toCm(value, unit) {
        switch (unit) {
            case 'in': return value * INCH_TO_CM;
            case 'ft': return value * FT_TO_CM;
            case 'm':  return value * M_TO_CM;
            case 'cm': return value;
            default:   return value;
        }
    }

    // ===================================================================
    // Volume Base Class
    //
    // Every geometric object in the scene is a Volume with:
    //   id           - unique identifier
    //   role         - 'source' | 'shield' | 'container'
    //   materialKey  - material type (e.g., 'steel', 'water')
    //   position     - {x, y, z} of the volume's bottom center (world)
    //   rotation     - {x, y, z} Euler angles in DEGREES, applied in
    //                  three.js 'XYZ' order about the volume's position.
    //                  Subclass geometry lives in a local frame (axis = +Y,
    //                  bottom center at origin); the base class maps
    //                  world <-> local so subclass math never sees rotation.
    //   priority     - higher priority wins when volumes overlap
    //   For sources:
    //     isotopeKey  - e.g., 'Co-60'
    //     activity_Ci - activity in Curies
    // ===================================================================
    const DEG_TO_RAD = Math.PI / 180;

    class Volume {
        constructor(config) {
            this.id = config.id || 'vol-' + Math.random().toString(36).substr(2, 6);
            this.role = config.role || 'shield';
            this.materialKey = config.materialKey || 'steel';
            this.position = config.position || { x: 0, y: 0, z: 0 };
            this.priority = config.priority || 10;
            this.label = config.label || '';
            // Display-only: hidden volumes still participate in the physics
            this.visible = config.visible !== false;
            // Calculation flag: disabled volumes are drawn ghosted and are
            // excluded from ray-tracing, source meshing, and totals
            this.enabled = config.enabled !== false;
            this.rotation = config.rotation
                ? { x: config.rotation.x || 0, y: config.rotation.y || 0, z: config.rotation.z || 0 }
                : { x: 0, y: 0, z: 0 };
            this._updateRotationMatrix();

            // Persistent relationship (mate): { targetId, mode }. When set, the
            // editor re-solves this volume's pose whenever geometry changes so
            // it follows its target. null = free-floating.
            this.constraint = config.constraint || null;

            // Source properties
            if (this.role === 'source') {
                this.isotopeKey = config.isotopeKey || 'Co-60';
                this.activity_Ci = config.activity_Ci || 0;
            }
        }

        setRotation(rot) {
            this.rotation = { x: rot.x || 0, y: rot.y || 0, z: rot.z || 0 };
            this._updateRotationMatrix();
        }

        // Row-major local->world rotation matrix, matching three.js
        // Euler order 'XYZ' (Matrix4.makeRotationFromEuler) so the
        // renderer and the physics always agree. null = identity.
        _updateRotationMatrix() {
            const { x, y, z } = this.rotation;
            if (!x && !y && !z) { this._rot = null; return; }
            const a = Math.cos(x * DEG_TO_RAD), b = Math.sin(x * DEG_TO_RAD);
            const c = Math.cos(y * DEG_TO_RAD), d = Math.sin(y * DEG_TO_RAD);
            const e = Math.cos(z * DEG_TO_RAD), f = Math.sin(z * DEG_TO_RAD);
            const ae = a * e, af = a * f, be = b * e, bf = b * f;
            this._rot = [
                c * e,        -c * f,        d,
                af + be * d,  ae - bf * d,  -b * c,
                bf - ae * d,  be + af * d,   a * c
            ];
        }

        // World point -> local frame (relative to position, un-rotated)
        worldToLocal(x, y, z) {
            const px = x - this.position.x;
            const py = y - this.position.y;
            const pz = z - this.position.z;
            const m = this._rot;
            if (!m) return { x: px, y: py, z: pz };
            // R^T * p
            return {
                x: m[0] * px + m[3] * py + m[6] * pz,
                y: m[1] * px + m[4] * py + m[7] * pz,
                z: m[2] * px + m[5] * py + m[8] * pz
            };
        }

        // World direction -> local frame (rotation only, stays unit length)
        worldDirToLocal(nx, ny, nz) {
            const m = this._rot;
            if (!m) return { x: nx, y: ny, z: nz };
            return {
                x: m[0] * nx + m[3] * ny + m[6] * nz,
                y: m[1] * nx + m[4] * ny + m[7] * nz,
                z: m[2] * nx + m[5] * ny + m[8] * nz
            };
        }

        // Local point -> world
        localToWorld(lx, ly, lz) {
            const m = this._rot;
            if (!m) {
                return {
                    x: lx + this.position.x,
                    y: ly + this.position.y,
                    z: lz + this.position.z
                };
            }
            return {
                x: m[0] * lx + m[1] * ly + m[2] * lz + this.position.x,
                y: m[3] * lx + m[4] * ly + m[5] * lz + this.position.y,
                z: m[6] * lx + m[7] * ly + m[8] * lz + this.position.z
            };
        }

        containsPoint(x, y, z) { return false; }
        rayIntersect(ox, oy, oz, nx, ny, nz) { return []; }
        meshSource(nr, ntheta, nz) { return []; }
        getVolume_cm3() { return 0; }

        getVisData() {
            return {
                id: this.id,
                type: 'unknown',
                role: this.role,
                materialKey: this.materialKey,
                position: { ...this.position },
                rotation: { ...this.rotation },
                priority: this.priority,
                label: this.label,
                visible: this.visible,
                enabled: this.enabled,
                isSource: this.role === 'source',
                activity_Ci: this.activity_Ci || 0,
                isotopeKey: this.isotopeKey || ''
            };
        }

        // Serializable plain object. Subclasses supply _type()/_dims().
        toJSON() {
            const j = {
                type: this._type(),
                id: this.id,
                role: this.role,
                materialKey: this.materialKey,
                position: { ...this.position },
                rotation: { ...this.rotation },
                priority: this.priority,
                label: this.label,
                visible: this.visible,
                enabled: this.enabled
            };
            if (this.role === 'source') {
                j.isotopeKey = this.isotopeKey;
                j.activity_Ci = this.activity_Ci;
            }
            if (this.constraint) j.constraint = { ...this.constraint };
            j.dimensions = this._dims();
            return j;
        }

        _type() { return 'unknown'; }
        _dims() { return {}; }
    }

    // ===================================================================
    // CylinderVolume - Full solid cylinder (vertical, axis along Y)
    // Used for: tank interiors, liquid fills, plugs, filter beds
    // ===================================================================
    class CylinderVolume extends Volume {
        constructor(config) {
            super(config);
            this.radius = config.dimensions.radius;
            this.height = config.dimensions.height;
        }

        containsPoint(x, y, z) {
            const p = this.worldToLocal(x, y, z);
            const r2 = p.x * p.x + p.z * p.z;
            return r2 <= this.radius * this.radius &&
                   p.y >= 0 && p.y <= this.height;
        }

        rayIntersect(ox, oy, oz, nx, ny, nz) {
            const hits = [];
            const o = this.worldToLocal(ox, oy, oz);
            const n = this.worldDirToLocal(nx, ny, nz);

            // Side wall: (o.x + t*n.x)^2 + (o.z + t*n.z)^2 = R^2
            const a = n.x * n.x + n.z * n.z;
            const b = 2 * (o.x * n.x + o.z * n.z);
            const c = o.x * o.x + o.z * o.z - this.radius * this.radius;

            if (a > 1e-10) {
                const disc = b * b - 4 * a * c;
                if (disc >= 0) {
                    const sd = Math.sqrt(disc);
                    const t1 = (-b - sd) / (2 * a);
                    const t2 = (-b + sd) / (2 * a);
                    // Check Y bounds for each hit
                    const y1 = o.y + t1 * n.y;
                    if (y1 >= 0 && y1 <= this.height) hits.push(t1);
                    const y2 = o.y + t2 * n.y;
                    if (y2 >= 0 && y2 <= this.height) hits.push(t2);
                }
            }

            // Top and bottom caps: y = height, y = 0
            if (Math.abs(n.y) > 1e-10) {
                for (const capY of [this.height, 0]) {
                    const t = (capY - o.y) / n.y;
                    const hx = o.x + t * n.x, hz = o.z + t * n.z;
                    if (hx * hx + hz * hz <= this.radius * this.radius) hits.push(t);
                }
            }

            return hits;
        }

        meshSource(nr, ntheta, nz) {
            if (this.role !== 'source' || !this.activity_Ci) return [];
            nr = nr || 5; ntheta = ntheta || 8; nz = nz || 10;

            const elements = [];
            const R = this.radius;
            const H = this.height;
            const totalVol = Math.PI * R * R * H;
            const dr = R / nr;
            const dtheta = (2 * Math.PI) / ntheta;
            const dz_step = H / nz;

            for (let ir = 0; ir < nr; ir++) {
                const ri = ir * dr, ro = (ir + 1) * dr, rm = (ri + ro) / 2;
                for (let it = 0; it < ntheta; it++) {
                    const theta = (it + 0.5) * dtheta;
                    for (let iz = 0; iz < nz; iz++) {
                        const zm = iz * dz_step + dz_step / 2;
                        const vol = 0.5 * (ro * ro - ri * ri) * dtheta * dz_step;
                        elements.push({
                            position: this.localToWorld(
                                rm * Math.cos(theta), zm, rm * Math.sin(theta)
                            ),
                            activity_Ci: this.activity_Ci * (vol / totalVol),
                            volume_cm3: vol,
                            isotopeKey: this.isotopeKey
                        });
                    }
                }
            }
            return elements;
        }

        getVolume_cm3() {
            return Math.PI * this.radius * this.radius * this.height;
        }

        getVisData() {
            return {
                ...super.getVisData(),
                type: 'cylinder',
                radius: this.radius,
                height: this.height
            };
        }

        _type() { return 'cylinder'; }
        _dims() { return { radius: this.radius, height: this.height }; }
    }

    // ===================================================================
    // AnnulusVolume - Hollow cylinder (cylindrical shell)
    // Used for: tank walls, lid rings
    // ===================================================================
    class AnnulusVolume extends Volume {
        constructor(config) {
            super(config);
            this.innerRadius = config.dimensions.innerRadius;
            this.outerRadius = config.dimensions.outerRadius;
            this.height = config.dimensions.height;
        }

        containsPoint(x, y, z) {
            const p = this.worldToLocal(x, y, z);
            const r2 = p.x * p.x + p.z * p.z;
            return r2 >= this.innerRadius * this.innerRadius &&
                   r2 <= this.outerRadius * this.outerRadius &&
                   p.y >= 0 && p.y <= this.height;
        }

        rayIntersect(ox, oy, oz, nx, ny, nz) {
            const hits = [];
            const o = this.worldToLocal(ox, oy, oz);
            const n = this.worldDirToLocal(nx, ny, nz);
            const a = n.x * n.x + n.z * n.z;

            if (a > 1e-10) {
                const bCoeff = 2 * (o.x * n.x + o.z * n.z);
                const d2 = o.x * o.x + o.z * o.z;

                // Outer and inner cylinder walls
                for (const R of [this.outerRadius, this.innerRadius]) {
                    const disc = bCoeff * bCoeff - 4 * a * (d2 - R * R);
                    if (disc >= 0) {
                        const sd = Math.sqrt(disc);
                        for (const t of [(-bCoeff - sd) / (2 * a), (-bCoeff + sd) / (2 * a)]) {
                            const hy = o.y + t * n.y;
                            if (hy >= 0 && hy <= this.height) hits.push(t);
                        }
                    }
                }
            }

            // Top and bottom annular caps
            if (Math.abs(n.y) > 1e-10) {
                for (const capY of [0, this.height]) {
                    const t = (capY - o.y) / n.y;
                    const hx = o.x + t * n.x, hz = o.z + t * n.z;
                    const r2 = hx * hx + hz * hz;
                    if (r2 >= this.innerRadius * this.innerRadius &&
                        r2 <= this.outerRadius * this.outerRadius) {
                        hits.push(t);
                    }
                }
            }

            return hits;
        }

        getVolume_cm3() {
            return Math.PI * (this.outerRadius * this.outerRadius -
                   this.innerRadius * this.innerRadius) * this.height;
        }

        getVisData() {
            return {
                ...super.getVisData(),
                type: 'annulus',
                innerRadius: this.innerRadius,
                outerRadius: this.outerRadius,
                height: this.height
            };
        }

        _type() { return 'annulus'; }
        _dims() {
            return {
                innerRadius: this.innerRadius,
                outerRadius: this.outerRadius,
                height: this.height
            };
        }
    }

    // ===================================================================
    // DiskVolume - Thin cylinder (convenience subclass)
    // Used for: sludge layers, floor plates, lids, filter media
    // Functionally identical to CylinderVolume but semantically distinct
    // ===================================================================
    class DiskVolume extends CylinderVolume {
        constructor(config) {
            // DiskVolume uses 'thickness' instead of 'height'
            const dims = {
                radius: config.dimensions.radius,
                height: config.dimensions.thickness || config.dimensions.height
            };
            super({ ...config, dimensions: dims });
            this.thickness = dims.height;
        }

        getVisData() {
            return {
                ...super.getVisData(),
                type: 'disk',
                thickness: this.thickness
            };
        }

        _type() { return 'disk'; }
        _dims() { return { radius: this.radius, thickness: this.thickness }; }
    }

    // ===================================================================
    // BoxVolume - Rectangular solid (axis-aligned in its local frame)
    // Local frame: bottom-center at origin; width along X, depth along Z,
    // height along +Y. Covers cubes, slabs, plates, walls and "planes"
    // (a plane is just a thin box).
    // ===================================================================
    class BoxVolume extends Volume {
        constructor(config) {
            super(config);
            this.width = config.dimensions.width;    // X extent
            this.depth = config.dimensions.depth;    // Z extent
            this.height = config.dimensions.height;  // Y extent
        }

        containsPoint(x, y, z) {
            const p = this.worldToLocal(x, y, z);
            return Math.abs(p.x) <= this.width / 2 &&
                   Math.abs(p.z) <= this.depth / 2 &&
                   p.y >= 0 && p.y <= this.height;
        }

        rayIntersect(ox, oy, oz, nx, ny, nz) {
            const o = this.worldToLocal(ox, oy, oz);
            const n = this.worldDirToLocal(nx, ny, nz);

            // Slab method in the local frame
            let tmin = -Infinity, tmax = Infinity;
            const slabs = [
                [o.x, n.x, -this.width / 2, this.width / 2],
                [o.y, n.y, 0, this.height],
                [o.z, n.z, -this.depth / 2, this.depth / 2]
            ];
            for (const [op, np, lo, hi] of slabs) {
                if (Math.abs(np) < 1e-12) {
                    if (op < lo || op > hi) return [];
                } else {
                    let t1 = (lo - op) / np;
                    let t2 = (hi - op) / np;
                    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
                    if (t1 > tmin) tmin = t1;
                    if (t2 < tmax) tmax = t2;
                    if (tmin > tmax) return [];
                }
            }
            return [tmin, tmax];
        }

        meshSource(nr, ntheta, nz) {
            if (this.role !== 'source' || !this.activity_Ci) return [];
            // Reuse the cylindrical density knobs as a grid: the angular
            // count drives X/Z, the axial count drives Y.
            const nx = ntheta || 8, ny = nz || 10, nzz = ntheta || 8;
            const W = this.width, D = this.depth, H = this.height;
            const dx = W / nx, dy = H / ny, dz = D / nzz;
            const elemVol = dx * dy * dz;
            const totalVol = W * D * H;

            const elements = [];
            for (let ix = 0; ix < nx; ix++) {
                const lx = -W / 2 + (ix + 0.5) * dx;
                for (let iy = 0; iy < ny; iy++) {
                    const ly = (iy + 0.5) * dy;
                    for (let iz = 0; iz < nzz; iz++) {
                        const lz = -D / 2 + (iz + 0.5) * dz;
                        elements.push({
                            position: this.localToWorld(lx, ly, lz),
                            activity_Ci: this.activity_Ci * (elemVol / totalVol),
                            volume_cm3: elemVol,
                            isotopeKey: this.isotopeKey
                        });
                    }
                }
            }
            return elements;
        }

        getVolume_cm3() { return this.width * this.depth * this.height; }

        getVisData() {
            return {
                ...super.getVisData(),
                type: 'box',
                width: this.width,
                depth: this.depth,
                height: this.height
            };
        }

        _type() { return 'box'; }
        _dims() { return { width: this.width, depth: this.depth, height: this.height }; }
    }

    // ===================================================================
    // SphereVolume - Solid sphere
    // Local frame: bottom point at origin, center at (0, radius, 0), so
    // position keeps the same "bottom center" meaning as other volumes.
    // ===================================================================
    class SphereVolume extends Volume {
        constructor(config) {
            super(config);
            this.radius = config.dimensions.radius;
        }

        containsPoint(x, y, z) {
            const p = this.worldToLocal(x, y, z);
            const dy = p.y - this.radius;
            return p.x * p.x + dy * dy + p.z * p.z <= this.radius * this.radius;
        }

        rayIntersect(ox, oy, oz, nx, ny, nz) {
            const o = this.worldToLocal(ox, oy, oz);
            const n = this.worldDirToLocal(nx, ny, nz);
            const cy = o.y - this.radius;  // relative to sphere center

            const b = 2 * (o.x * n.x + cy * n.y + o.z * n.z);
            const c = o.x * o.x + cy * cy + o.z * o.z - this.radius * this.radius;
            const disc = b * b - 4 * c;    // a = 1 (unit direction)
            if (disc < 0) return [];
            const sd = Math.sqrt(disc);
            return [(-b - sd) / 2, (-b + sd) / 2];
        }

        meshSource(nr, ntheta, nz) {
            if (this.role !== 'source' || !this.activity_Ci) return [];
            nr = nr || 5; ntheta = ntheta || 8;
            const nphi = nz || 10;
            const R = this.radius;
            const totalVol = (4 / 3) * Math.PI * R * R * R;

            const elements = [];
            const dr = R / nr;
            const dtheta = (2 * Math.PI) / ntheta;
            const dcos = 2 / nphi;  // equal cos(phi) bands = equal solid angle

            for (let ir = 0; ir < nr; ir++) {
                const ri = ir * dr, ro = (ir + 1) * dr;
                const rm = (ri + ro) / 2;
                const shellVol = (ro * ro * ro - ri * ri * ri) / 3;
                for (let ip = 0; ip < nphi; ip++) {
                    const cos1 = 1 - ip * dcos, cos2 = 1 - (ip + 1) * dcos;
                    const cosm = (cos1 + cos2) / 2;
                    const sinm = Math.sqrt(Math.max(0, 1 - cosm * cosm));
                    for (let it = 0; it < ntheta; it++) {
                        const theta = (it + 0.5) * dtheta;
                        const vol = shellVol * (cos1 - cos2) * dtheta;
                        elements.push({
                            position: this.localToWorld(
                                rm * sinm * Math.cos(theta),
                                R + rm * cosm,
                                rm * sinm * Math.sin(theta)
                            ),
                            activity_Ci: this.activity_Ci * (vol / totalVol),
                            volume_cm3: vol,
                            isotopeKey: this.isotopeKey
                        });
                    }
                }
            }
            return elements;
        }

        getVolume_cm3() {
            return (4 / 3) * Math.PI * this.radius ** 3;
        }

        getVisData() {
            return {
                ...super.getVisData(),
                type: 'sphere',
                radius: this.radius
            };
        }

        _type() { return 'sphere'; }
        _dims() { return { radius: this.radius }; }
    }

    // ===================================================================
    // SceneModel - Container for all volumes in the scene
    // Provides ray-tracing, source meshing, and material detection
    // ===================================================================
    class SceneModel {
        constructor() {
            this.volumes = [];
        }

        addVolume(volume) {
            this.volumes.push(volume);
            return volume;
        }

        removeVolume(id) {
            this.volumes = this.volumes.filter(v => v.id !== id);
        }

        getVolume(id) {
            return this.volumes.find(v => v.id === id) || null;
        }

        // ---------------------------------------------------------------
        // Get the material at a point in space
        // Highest priority volume containing the point wins
        // ---------------------------------------------------------------
        getMaterialAt(x, y, z) {
            let bestMaterial = 'air';
            let bestPriority = -1;
            for (const vol of this.volumes) {
                if (vol.enabled === false) continue;
                if (vol.priority > bestPriority && vol.containsPoint(x, y, z)) {
                    bestMaterial = vol.materialKey;
                    bestPriority = vol.priority;
                }
            }
            return bestMaterial;
        }

        // ---------------------------------------------------------------
        // Bounding-sphere acceleration for rayTrace. One entry per enabled
        // volume: a conservative world-space sphere the volume is fully
        // inside. A segment that misses the sphere can neither intersect
        // the volume nor have any point inside it, so both the intersect
        // loop and the material sampling may skip it — the layers returned
        // are identical, just computed faster. Build once per batch of
        // traces (the caller owns freshness: rebuild after geometry edits).
        // ---------------------------------------------------------------
        buildRayAccel() {
            const accel = [];
            for (const vol of this.volumes) {
                if (vol.enabled === false) continue;
                const dims = vol._dims();
                const type = vol._type();
                let cy, r2;
                if (type === 'sphere') {
                    cy = dims.radius;
                    r2 = dims.radius * dims.radius;
                } else if (type === 'box') {
                    cy = dims.height / 2;
                    r2 = (dims.width * dims.width + dims.height * dims.height +
                          dims.depth * dims.depth) / 4;
                } else {
                    // cylinder / disk / annulus: radius × half-height envelope
                    const r = dims.radius || dims.outerRadius || 0;
                    const h = dims.height || dims.thickness || 0;
                    cy = h / 2;
                    r2 = r * r + (h / 2) * (h / 2);
                }
                const c = vol.localToWorld(0, cy, 0);
                // small conservative margin against float error
                accel.push({ vol: vol, cx: c.x, cy: c.y, cz: c.z, r2: r2 * 1.000002 + 1e-9 });
            }
            return accel;
        }

        // ---------------------------------------------------------------
        // Ray-trace from source point to dose point
        // Returns [{materialKey, thickness_cm}] ordered along the ray.
        // Optional accel (from buildRayAccel) skips volumes the segment
        // provably cannot touch — result is unchanged.
        // ---------------------------------------------------------------
        rayTrace(fromPos, toPos, accel) {
            const dx = toPos.x - fromPos.x;
            const dy = toPos.y - fromPos.y;
            const dz = toPos.z - fromPos.z;
            const rayLen = Math.sqrt(dx * dx + dy * dy + dz * dz);
            if (rayLen < 1e-10) return [];

            const nx = dx / rayLen;
            const ny = dy / rayLen;
            const nz = dz / rayLen;

            // Candidate volumes: those whose bounding sphere the segment touches
            let candidates = null;
            if (accel) {
                candidates = [];
                for (const a of accel) {
                    // squared distance from sphere center to segment [from,to]
                    const px = a.cx - fromPos.x, py = a.cy - fromPos.y, pz = a.cz - fromPos.z;
                    let t = (px * dx + py * dy + pz * dz) / (rayLen * rayLen);
                    if (t < 0) t = 0; else if (t > 1) t = 1;
                    const ex = px - t * dx, ey = py - t * dy, ez = pz - t * dz;
                    if (ex * ex + ey * ey + ez * ez <= a.r2) candidates.push(a.vol);
                }
            }
            const vols = candidates || this.volumes;

            // Collect all intersection t-values from every candidate volume
            const allT = new Set();
            allT.add(0);
            allT.add(rayLen);

            for (const vol of vols) {
                if (vol.enabled === false) continue;
                const hits = vol.rayIntersect(fromPos.x, fromPos.y, fromPos.z, nx, ny, nz);
                for (const t of hits) {
                    if (t > 1e-6 && t < rayLen - 1e-6) {
                        allT.add(t);
                    }
                }
            }

            // Sort intersection parameters
            const boundaries = Array.from(allT).sort((a, b) => a - b);

            // Walk segments, sample midpoint to determine material. Only the
            // candidate volumes can contain a point ON the segment, so the
            // material lookup may use the same reduced list.
            const layers = [];
            for (let i = 0; i < boundaries.length - 1; i++) {
                const t0 = boundaries[i];
                const t1 = boundaries[i + 1];
                const thickness = t1 - t0;
                if (thickness < 1e-8) continue;

                const tMid = (t0 + t1) / 2;
                const px = fromPos.x + tMid * nx;
                const py = fromPos.y + tMid * ny;
                const pz = fromPos.z + tMid * nz;

                let mat;
                if (candidates) {
                    mat = 'air';
                    let bestPriority = -1;
                    for (const vol of candidates) {
                        if (vol.priority > bestPriority && vol.containsPoint(px, py, pz)) {
                            mat = vol.materialKey;
                            bestPriority = vol.priority;
                        }
                    }
                } else {
                    mat = this.getMaterialAt(px, py, pz);
                }

                if (layers.length > 0 && layers[layers.length - 1].materialKey === mat) {
                    layers[layers.length - 1].thickness_cm += thickness;
                } else {
                    layers.push({ materialKey: mat, thickness_cm: thickness });
                }
            }

            return layers;
        }

        // ---------------------------------------------------------------
        // Mesh all source volumes into discrete elements
        // ---------------------------------------------------------------
        meshAllSources(nr, ntheta, nz) {
            const allElements = [];
            for (const vol of this.volumes) {
                if (vol.enabled === false) continue;
                if (vol.role === 'source') {
                    const elements = vol.meshSource(nr, ntheta, nz);
                    allElements.push(...elements);
                }
            }
            return allElements;
        }

        // ---------------------------------------------------------------
        // Get the isotope key for dose calculation
        // Uses the first source volume found
        // ---------------------------------------------------------------
        getSourceIsotope() {
            for (const vol of this.volumes) {
                if (vol.enabled === false) continue;
                if (vol.role === 'source' && vol.isotopeKey) {
                    return vol.isotopeKey;
                }
            }
            return 'Co-60';
        }

        // ---------------------------------------------------------------
        // Get total source activity
        // ---------------------------------------------------------------
        getTotalActivity() {
            let total = 0;
            for (const vol of this.volumes) {
                if (vol.enabled === false) continue;
                if (vol.role === 'source') {
                    total += vol.activity_Ci || 0;
                }
            }
            return total;
        }

        // ---------------------------------------------------------------
        // Get visualization data for all volumes
        // ---------------------------------------------------------------
        getVisData() {
            return this.volumes.map(v => v.getVisData());
        }

        // ---------------------------------------------------------------
        // Get scene bounding box for camera framing
        // Uses each volume's bounding sphere (center of local extent),
        // so arbitrary rotations are always enclosed.
        // ---------------------------------------------------------------
        getBounds() {
            let minX = Infinity, minY = Infinity, minZ = Infinity;
            let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

            for (const vol of this.volumes) {
                const vd = vol.getVisData();
                let cy, rad;
                if (vd.type === 'box') {
                    cy = vd.height / 2;
                    rad = Math.sqrt(
                        (vd.width / 2) ** 2 + (vd.height / 2) ** 2 + (vd.depth / 2) ** 2);
                } else if (vd.type === 'sphere') {
                    cy = vd.radius;
                    rad = vd.radius;
                } else {
                    const r = vd.radius || vd.outerRadius || 0;
                    const h = vd.height || vd.thickness || 0;
                    cy = h / 2;
                    rad = Math.sqrt(r * r + (h / 2) * (h / 2));
                }
                const c = vol.localToWorld(0, cy, 0);

                minX = Math.min(minX, c.x - rad);
                maxX = Math.max(maxX, c.x + rad);
                minY = Math.min(minY, c.y - rad);
                maxY = Math.max(maxY, c.y + rad);
                minZ = Math.min(minZ, c.z - rad);
                maxZ = Math.max(maxZ, c.z + rad);
            }

            return { minX, minY, minZ, maxX, maxY, maxZ };
        }

        // ---------------------------------------------------------------
        // Serialization
        // ---------------------------------------------------------------
        toJSON() {
            return {
                format: 'radshield-scene',
                version: 1,
                volumes: this.volumes.map(v => v.toJSON())
            };
        }
    }

    // -----------------------------------------------------------------------
    // Deserialization
    // -----------------------------------------------------------------------
    function volumeFromJSON(j) {
        const config = {
            id: j.id,
            role: j.role,
            materialKey: j.materialKey,
            position: j.position,
            rotation: j.rotation,
            priority: j.priority,
            label: j.label,
            visible: j.visible,
            enabled: j.enabled,
            isotopeKey: j.isotopeKey,
            activity_Ci: j.activity_Ci,
            constraint: j.constraint,
            dimensions: j.dimensions
        };
        switch (j.type) {
            case 'cylinder': return new CylinderVolume(config);
            case 'annulus':  return new AnnulusVolume(config);
            case 'disk':     return new DiskVolume(config);
            case 'box':      return new BoxVolume(config);
            case 'sphere':   return new SphereVolume(config);
            default: throw new Error(`Unknown volume type: ${j.type}`);
        }
    }

    function sceneFromJSON(data) {
        if (data.format !== 'radshield-scene') {
            throw new Error('Not a RadShield scene file');
        }
        const model = new SceneModel();
        for (const j of data.volumes) {
            model.addVolume(volumeFromJSON(j));
        }
        return model;
    }

    // ===================================================================
    // Tank Preset - Creates a SceneModel from tank configuration
    // Backward compatible with the old TankGeometry config format
    // ===================================================================
    function createTankPreset(config) {
        const model = new SceneModel();
        const cx = config.cx || 0, cy = config.cy || 0, cz = config.cz || 0;

        // --- Source distribution ---
        const dist = (config.source && config.source.distribution) || 'uniform';
        const liquidLevel = (config.source && config.source.liquidLevel) || 0;
        const activity = (config.source && config.source.activity_Ci) || 0;
        const isotope = (config.source && config.source.isotope) || 'Co-60';
        const liquidMat = (config.source && config.source.liquidMaterial) || 'water';

        if (liquidLevel > 0) {
            if (dist === 'uniform') {
                // Entire liquid is the source
                model.addVolume(new CylinderVolume({
                    id: 'source-liquid',
                    role: 'source',
                    materialKey: liquidMat,
                    position: { x: cx, y: cy, z: cz },
                    dimensions: { radius: config.innerRadius, height: liquidLevel },
                    priority: 10,
                    isotopeKey: isotope,
                    activity_Ci: activity,
                    label: 'Source Liquid'
                }));
            } else {
                // Settled or layered: source at bottom, clean water above
                let sourceHeight = liquidLevel;
                if (dist === 'settled') {
                    sourceHeight = Math.min(config.source.sludgeHeight || 2.54, liquidLevel);
                } else if (dist === 'layered') {
                    sourceHeight = Math.min(config.source.sourceLayerHeight || liquidLevel, liquidLevel);
                }

                // Source layer at bottom
                model.addVolume(new CylinderVolume({
                    id: 'source-sludge',
                    role: 'source',
                    materialKey: liquidMat,
                    position: { x: cx, y: cy, z: cz },
                    dimensions: { radius: config.innerRadius, height: sourceHeight },
                    priority: 20,
                    isotopeKey: isotope,
                    activity_Ci: activity,
                    label: 'Sludge (Source)'
                }));

                // Clean water above
                if (sourceHeight < liquidLevel) {
                    model.addVolume(new CylinderVolume({
                        id: 'clean-water',
                        role: 'shield',
                        materialKey: liquidMat,
                        position: { x: cx, y: cy + sourceHeight, z: cz },
                        dimensions: { radius: config.innerRadius, height: liquidLevel - sourceHeight },
                        priority: 10,
                        label: 'Clean Water (Shield)'
                    }));
                }
            }
        }

        // --- Wall layers ---
        let currentR = config.innerRadius;
        if (config.wallLayers) {
            config.wallLayers.forEach((layer, i) => {
                model.addVolume(new AnnulusVolume({
                    id: `wall-${i}`,
                    role: 'container',
                    materialKey: layer.materialKey,
                    position: { x: cx, y: cy, z: cz },
                    dimensions: {
                        innerRadius: currentR,
                        outerRadius: currentR + layer.thickness,
                        height: config.innerHeight
                    },
                    priority: 50,
                    label: `Wall: ${Materials.getMaterial(layer.materialKey).name}`
                }));
                currentR += layer.thickness;
            });
        }
        const outerRadius = currentR;

        // --- Floor layers ---
        let floorY = cy;
        if (config.floorLayers) {
            config.floorLayers.forEach((layer, i) => {
                floorY -= layer.thickness;
                model.addVolume(new CylinderVolume({
                    id: `floor-${i}`,
                    role: 'container',
                    materialKey: layer.materialKey,
                    position: { x: cx, y: floorY, z: cz },
                    dimensions: { radius: outerRadius, height: layer.thickness },
                    priority: 50,
                    label: `Floor: ${Materials.getMaterial(layer.materialKey).name}`
                }));
            });
        }

        // --- Lid ---
        if (config.lid) {
            const lidOpeningR = config.lid.openingRadius || 0;
            if (lidOpeningR > 0) {
                // Donut lid (annulus)
                model.addVolume(new AnnulusVolume({
                    id: 'lid',
                    role: 'container',
                    materialKey: config.lid.materialKey,
                    position: { x: cx, y: cy + config.innerHeight, z: cz },
                    dimensions: {
                        innerRadius: lidOpeningR,
                        outerRadius: outerRadius,
                        height: config.lid.thickness
                    },
                    priority: 50,
                    label: `Lid: ${Materials.getMaterial(config.lid.materialKey).name}`
                }));
            } else {
                // Solid lid
                model.addVolume(new CylinderVolume({
                    id: 'lid',
                    role: 'container',
                    materialKey: config.lid.materialKey,
                    position: { x: cx, y: cy + config.innerHeight, z: cz },
                    dimensions: { radius: outerRadius, height: config.lid.thickness },
                    priority: 50,
                    label: `Lid: ${Materials.getMaterial(config.lid.materialKey).name}`
                }));
            }

            // --- Plug ---
            if (config.plug && lidOpeningR > 0) {
                // A plug can be wider than the opening (a cover that overlaps the
                // lid). An outerRadius override larger than the opening makes the
                // plug a cover resting on the lid's top face; otherwise it fills
                // the opening flush.
                const plugR = (config.plug.outerRadius && config.plug.outerRadius > lidOpeningR)
                    ? config.plug.outerRadius : lidOpeningR;
                model.addVolume(new CylinderVolume({
                    id: 'plug',
                    role: 'container',
                    materialKey: config.plug.materialKey,
                    position: { x: cx, y: cy + config.innerHeight + config.lid.thickness, z: cz },
                    dimensions: { radius: plugR, height: config.plug.thickness },
                    priority: 55,
                    label: `Plug: ${Materials.getMaterial(config.plug.materialKey).name}`
                }));
            }
        }

        return model;
    }

    // -----------------------------------------------------------------------
    // Public API
    // -----------------------------------------------------------------------
    return {
        Volume,
        CylinderVolume,
        AnnulusVolume,
        DiskVolume,
        BoxVolume,
        SphereVolume,
        SceneModel,
        createTankPreset,
        volumeFromJSON,
        sceneFromJSON,
        toCm,
        INCH_TO_CM,
        FT_TO_CM,
        M_TO_CM
    };

})();
