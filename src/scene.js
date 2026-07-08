// ============================================================================
// RadShield - 3D Visualization Module v2
// Renders arbitrary volumes from SceneModel
// ============================================================================

const Scene = (() => {

    let scene, camera, renderer, controls;
    let container;
    let sceneGroup = null;

    // --- Editor state ---
    let transformControls = null;
    let editorCallbacks = {};        // onSelect, onPickPoint, onContextMenu,
                                     // onTransformStart, onTransformEnd
    let interactionMode = 'select';  // 'select' | 'translate' | 'rotate' | 'dose'
    let selectedId = null;
    let volGroupById = {};           // volumeId -> THREE.Group
    let pickMeshes = [];             // raycast targets (userData.volumeId set)
    const GROUND_PLANE = { normal: { x: 0, y: 1, z: 0 }, constant: 0 };

    // --- Feature snapping (Measure / Smart Dimension) ---
    let currentVisList = [];         // vis data of the rendered volumes
    let snapFeatureCache = null;     // lazily-built world-space key points
    let hoverGroup = null;           // transient snap glyphs / face highlights
    let hoveredVolId = null;         // volume currently tinted by hover
    let currentSnap = null;          // {x,y,z,type} the active snap target
    let pointerIsDown = false;       // suppress hover while dragging / orbiting
    const SNAP_TOL = 16;             // px radius to grab a key point

    // Material colors
    const COLORS = {
        steel:    0x808080,
        lead:     0x404040,
        water:    0x2196F3,
        air:      0xE3F2FD,
        concrete: 0x9E9E9E,
        liquid:   0x4FC3F7,
        source:   0xFF8F00,
        dosePoint: 0xFF1744,
        grid:     0x444444,
        background: 0x1a1a2e
    };

    // -----------------------------------------------------------------------
    // Initialize the Three.js scene
    // -----------------------------------------------------------------------
    function init(containerId) {
        container = document.getElementById(containerId);
        if (!container) throw new Error('Container not found: ' + containerId);

        scene = new THREE.Scene();
        scene.background = new THREE.Color(COLORS.background);

        const aspect = container.clientWidth / container.clientHeight;
        camera = new THREE.PerspectiveCamera(50, aspect, 0.1, 10000);
        camera.position.set(150, 120, 150);
        camera.lookAt(0, 40, 0);

        renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
        renderer.setSize(container.clientWidth, container.clientHeight);
        renderer.setPixelRatio(window.devicePixelRatio);
        container.appendChild(renderer.domElement);

        controls = new THREE.OrbitControls(camera, renderer.domElement);
        controls.target.set(0, 40, 0);
        controls.enableDamping = true;
        controls.dampingFactor = 0.05;
        controls.update();

        scene.add(new THREE.AmbientLight(0xffffff, 0.4));
        const dl = new THREE.DirectionalLight(0xffffff, 0.8);
        dl.position.set(100, 200, 100);
        scene.add(dl);
        const dl2 = new THREE.DirectionalLight(0xffffff, 0.3);
        dl2.position.set(-100, 100, -100);
        scene.add(dl2);

        scene.add(new THREE.GridHelper(400, 20, 0x444444, 0x333333));
        scene.add(new THREE.AxesHelper(20));

        window.addEventListener('resize', onResize);
        (function animate() {
            requestAnimationFrame(animate);
            if (controls) controls.update();
            if (renderer && scene && camera) renderer.render(scene, camera);
        })();
    }

    function onResize() {
        if (!container || !camera || !renderer) return;
        camera.aspect = container.clientWidth / container.clientHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(container.clientWidth, container.clientHeight);
    }

    // -----------------------------------------------------------------------
    // Render a scene (array of volume vis-data objects)
    // -----------------------------------------------------------------------
    function renderScene(volumesVisData, bounds, opts) {
        opts = opts || {};
        // The gizmo may be attached to a group we are about to destroy
        if (transformControls) transformControls.detach();

        // Remove previous scene geometry
        if (sceneGroup) {
            scene.remove(sceneGroup);
            sceneGroup.traverse(child => {
                if (child.geometry) child.geometry.dispose();
                if (child.material) {
                    if (Array.isArray(child.material)) {
                        child.material.forEach(m => m.dispose());
                    } else {
                        child.material.dispose();
                    }
                }
            });
        }

        sceneGroup = new THREE.Group();
        volGroupById = {};
        pickMeshes = [];

        for (const vol of volumesVisData) {
            renderVolume(sceneGroup, vol);
        }

        scene.add(sceneGroup);

        // Feature-snapping data for Measure / Smart Dimension
        currentVisList = volumesVisData || [];
        snapFeatureCache = null;
        clearHover();

        // Restore selection highlight + gizmo on the rebuilt groups
        if (selectedId && volGroupById[selectedId]) {
            applySelectionVisuals();
        } else {
            selectedId = null;
        }

        // Frame camera to scene bounds
        if (bounds && opts.frame !== false) {
            const cx = (bounds.minX + bounds.maxX) / 2;
            const cy = (bounds.minY + bounds.maxY) / 2;
            const cz = (bounds.minZ + bounds.maxZ) / 2;
            const dx = bounds.maxX - bounds.minX;
            const dy = bounds.maxY - bounds.minY;
            const dz = bounds.maxZ - bounds.minZ;
            const maxDim = Math.max(dx, dy, dz, 20);
            camera.position.set(cx + maxDim * 1.5, cy + maxDim, cz + maxDim * 1.5);
            controls.target.set(cx, cy, cz);
            controls.update();
        }
    }

    // -----------------------------------------------------------------------
    // Render a single volume
    // -----------------------------------------------------------------------
    function renderVolume(group, vol) {
        const isSource = vol.isSource;
        const baseColor = isSource ? COLORS.source : (COLORS[vol.materialKey] || 0x888888);
        // Volumes excluded from the calculation draw as faint ghosts
        const ghost = vol.enabled === false;
        const opacity = ghost ? 0.06
            : (isSource ? 0.5 : (vol.role === 'container' ? 0.35 : 0.3));
        const wireOpacity = ghost ? 0.15 : 0.5;
        const metalness = (vol.materialKey === 'steel' || vol.materialKey === 'lead') ? 0.7 : 0.1;

        // Per-volume group: children are placed in the volume's LOCAL frame
        // (bottom center at origin, axis along +Y); the group carries the
        // world position + rotation, matching Geometry's world<->local
        // transform exactly (three.js Euler order 'XYZ', degrees in model).
        const pos = vol.position;
        const rot = vol.rotation || { x: 0, y: 0, z: 0 };
        const DEG = Math.PI / 180;
        const volGroup = new THREE.Group();
        volGroup.position.set(pos.x, pos.y, pos.z);
        volGroup.rotation.set(rot.x * DEG, rot.y * DEG, rot.z * DEG);
        volGroup.userData.volumeId = vol.id;
        volGroupById[vol.id] = volGroup;
        group.add(volGroup);

        // Hidden volumes keep their (empty) group so selection/gizmo still
        // work from the outliner, but draw nothing.
        if (vol.visible === false) return;

        let geom;

        if (vol.type === 'cylinder' || vol.type === 'disk') {
            const r = vol.radius;
            const h = vol.height || vol.thickness;
            geom = new THREE.CylinderGeometry(r, r, h, 32);

            const mat = new THREE.MeshPhysicalMaterial({
                color: baseColor,
                transparent: true,
                opacity: opacity,
                roughness: 0.4,
                metalness: metalness,
                side: THREE.DoubleSide
            });
            const mesh = new THREE.Mesh(geom, mat);
            mesh.position.set(0, h / 2, 0);
            volGroup.add(mesh);

            // Wireframe outline
            const wireGeom = new THREE.EdgesGeometry(
                new THREE.CylinderGeometry(r, r, h, 32)
            );
            const wireMat = new THREE.LineBasicMaterial({
                color: baseColor,
                transparent: true,
                opacity: wireOpacity
            });
            const wireframe = new THREE.LineSegments(wireGeom, wireMat);
            wireframe.position.set(0, h / 2, 0);
            volGroup.add(wireframe);

        } else if (vol.type === 'box') {
            const w = vol.width, h = vol.height, d = vol.depth;
            geom = new THREE.BoxGeometry(w, h, d);

            const mat = new THREE.MeshPhysicalMaterial({
                color: baseColor,
                transparent: true,
                opacity: opacity,
                roughness: 0.4,
                metalness: metalness,
                side: THREE.DoubleSide
            });
            const mesh = new THREE.Mesh(geom, mat);
            mesh.position.set(0, h / 2, 0);
            volGroup.add(mesh);

            const wireGeom = new THREE.EdgesGeometry(new THREE.BoxGeometry(w, h, d));
            const wireMat = new THREE.LineBasicMaterial({
                color: baseColor, transparent: true, opacity: wireOpacity
            });
            const wireframe = new THREE.LineSegments(wireGeom, wireMat);
            wireframe.position.set(0, h / 2, 0);
            volGroup.add(wireframe);

        } else if (vol.type === 'sphere') {
            const r = vol.radius;
            geom = new THREE.SphereGeometry(r, 32, 20);

            const mat = new THREE.MeshPhysicalMaterial({
                color: baseColor,
                transparent: true,
                opacity: opacity,
                roughness: 0.4,
                metalness: metalness,
                side: THREE.DoubleSide
            });
            const mesh = new THREE.Mesh(geom, mat);
            mesh.position.set(0, r, 0);
            volGroup.add(mesh);

            // Equator + meridian outline circles instead of edge wireframe
            const circGeom = new THREE.EdgesGeometry(
                new THREE.CircleGeometry(r, 48), 1);
            const circMat = new THREE.LineBasicMaterial({
                color: baseColor, transparent: true, opacity: wireOpacity
            });
            const eq = new THREE.LineSegments(circGeom, circMat);
            eq.rotation.x = -Math.PI / 2;
            eq.position.y = r;
            volGroup.add(eq);
            const mer = new THREE.LineSegments(circGeom.clone(), circMat.clone());
            mer.position.y = r;
            volGroup.add(mer);

        } else if (vol.type === 'annulus') {
            const h = vol.height;
            geom = createCylindricalShell(vol.innerRadius, vol.outerRadius, h, 32);

            const mat = new THREE.MeshPhysicalMaterial({
                color: baseColor,
                transparent: true,
                opacity: opacity,
                roughness: 0.4,
                metalness: metalness,
                side: THREE.DoubleSide
            });
            const mesh = new THREE.Mesh(geom, mat);
            mesh.position.set(0, h / 2, 0);
            volGroup.add(mesh);

            // Top and bottom ring caps (local y = 0 and h)
            addRingCap(volGroup, vol.innerRadius, vol.outerRadius, 0, baseColor, opacity);
            addRingCap(volGroup, vol.innerRadius, vol.outerRadius, h, baseColor, opacity);

            // Wireframe on outer surface
            const wireGeom = new THREE.EdgesGeometry(
                new THREE.CylinderGeometry(vol.outerRadius, vol.outerRadius, h, 32)
            );
            const wireMat = new THREE.LineBasicMaterial({
                color: baseColor, transparent: true, opacity: wireOpacity
            });
            const wireframe = new THREE.LineSegments(wireGeom, wireMat);
            wireframe.position.set(0, h / 2, 0);
            volGroup.add(wireframe);
        }

        // Label
        if (vol.label) {
            const h = vol.height || vol.thickness ||
                (vol.type === 'sphere' ? vol.radius * 2 : 0);
            const r = vol.type === 'box'
                ? Math.max(vol.width, vol.depth) / 2
                : (vol.outerRadius || vol.radius || 10);
            const labelSprite = makeTextSprite(
                vol.label + (ghost ? ' (excluded)' : ''), {
                fontSize: 14,
                color: ghost ? '#666c76' : (isSource ? '#FF8F00' : '#ffffff'),
                worldHeight: 9
            });
            labelSprite.position.set(r + 12, h / 2, 0);
            volGroup.add(labelSprite);
        }

        // Register solid meshes as raycast pick targets
        volGroup.traverse(child => {
            if (child.isMesh) {
                child.userData.volumeId = vol.id;
                pickMeshes.push(child);
            }
        });
    }

    // -----------------------------------------------------------------------
    // Create cylindrical shell geometry (hollow cylinder)
    // -----------------------------------------------------------------------
    function createCylindricalShell(innerR, outerR, height, segments) {
        const shape = new THREE.Shape();
        shape.absarc(0, 0, outerR, 0, Math.PI * 2, false);
        const holePath = new THREE.Path();
        holePath.absarc(0, 0, innerR, 0, Math.PI * 2, true);
        shape.holes.push(holePath);

        const geom = new THREE.ExtrudeGeometry(shape, {
            steps: 1, depth: height, bevelEnabled: false
        });
        geom.rotateX(-Math.PI / 2);
        geom.translate(0, -height / 2, 0);
        return geom;
    }

    // -----------------------------------------------------------------------
    // Add a ring-shaped cap (annular disk) at a local y within the group
    // -----------------------------------------------------------------------
    function addRingCap(group, innerR, outerR, yPos, color, opacity) {
        const geom = new THREE.RingGeometry(innerR, outerR, 32);
        const mat = new THREE.MeshPhysicalMaterial({
            color: color,
            transparent: true,
            opacity: opacity,
            side: THREE.DoubleSide
        });
        const mesh = new THREE.Mesh(geom, mat);
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.y = yPos;
        group.add(mesh);
    }

    // -----------------------------------------------------------------------
    // Create a text sprite
    // -----------------------------------------------------------------------
    // Multiline text sprite. The canvas is sized to the text and the sprite
    // scale preserves the aspect ratio, so nothing is clipped or stretched.
    // params.worldHeight = world units (cm) per text line (default 8).
    function makeTextSprite(message, params) {
        const fontSize = params.fontSize || 14;
        const font = 'bold ' + (fontSize * 3) + 'px Arial';
        const lines = String(message).split('\n');
        const lineH = fontSize * 3 * 1.3;
        const pad = 12;

        const canvas = document.createElement('canvas');
        let ctx = canvas.getContext('2d');
        ctx.font = font;
        const textW = Math.max(...lines.map(l => ctx.measureText(l).width), 1);
        canvas.width = Math.ceil(textW + pad * 2);
        canvas.height = Math.ceil(lineH * lines.length + pad);

        // Resizing the canvas resets the context state
        ctx = canvas.getContext('2d');
        ctx.font = font;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        if (params.background) {
            ctx.fillStyle = params.background;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
        ctx.fillStyle = params.color || '#ffffff';
        lines.forEach((l, i) => {
            ctx.fillText(l, canvas.width / 2, pad / 2 + lineH * (i + 0.5));
        });

        const texture = new THREE.CanvasTexture(canvas);
        texture.needsUpdate = true;
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
            map: texture, transparent: true, depthTest: false
        }));
        const H = (params.worldHeight || 8) * lines.length;
        sprite.scale.set(H * canvas.width / canvas.height, H, 1);
        return sprite;
    }

    // -----------------------------------------------------------------------
    // Dose point markers (any number of named points)
    // points: [{x, y, z, name?, text?}] in cm
    // -----------------------------------------------------------------------
    let doseGroup = null;

    function setDosePoints(points) {
        if (doseGroup) {
            scene.remove(doseGroup);
            doseGroup.traverse(child => {
                if (child.geometry) child.geometry.dispose();
                if (child.material) {
                    if (child.material.map) child.material.map.dispose();
                    child.material.dispose();
                }
            });
            doseGroup = null;
        }
        if (!points || !points.length) return;

        doseGroup = new THREE.Group();
        for (const p of points) {
            const mesh = new THREE.Mesh(
                new THREE.SphereGeometry(2, 16, 16),
                new THREE.MeshBasicMaterial({ color: COLORS.dosePoint })
            );
            mesh.position.set(p.x, p.y, p.z);
            mesh.add(new THREE.Mesh(
                new THREE.SphereGeometry(4, 16, 16),
                new THREE.MeshBasicMaterial({
                    color: COLORS.dosePoint, transparent: true, opacity: 0.3
                })
            ));
            doseGroup.add(mesh);

            const lines = [];
            if (p.name) lines.push(p.name);
            if (p.text) lines.push(p.text);
            if (lines.length) {
                const label = makeTextSprite(lines.join('\n'), {
                    fontSize: 15, color: '#FF1744', worldHeight: 8,
                    background: 'rgba(13,17,23,0.6)'
                });
                label.position.set(p.x, p.y + 9 + lines.length * 4, p.z);
                doseGroup.add(label);
            }
        }
        scene.add(doseGroup);
    }

    // Legacy single-point wrapper
    function setDosePoint(x, y, z, resultText) {
        setDosePoints([{ x, y, z, text: resultText }]);
    }

    // -----------------------------------------------------------------------
    // Still frame of the current view as a PNG data URL (for reports)
    // -----------------------------------------------------------------------
    function snapshot() {
        renderer.render(scene, camera);
        return renderer.domElement.toDataURL('image/png');
    }

    // -----------------------------------------------------------------------
    // Survey heat map: a colored horizontal plane textured from a canvas.
    // area: {minX, maxX, minZ, maxZ, y} in cm. Canvas row 0 = minZ edge,
    // canvas column 0 = minX edge (matches the -90° X rotation + flipY).
    // -----------------------------------------------------------------------
    let heatmapMesh = null;

    function showHeatmap(canvas, area) {
        clearHeatmap();
        const tex = new THREE.CanvasTexture(canvas);
        tex.magFilter = THREE.LinearFilter;
        tex.needsUpdate = true;
        const geo = new THREE.PlaneGeometry(area.maxX - area.minX, area.maxZ - area.minZ);
        const mat = new THREE.MeshBasicMaterial({
            map: tex, transparent: true, opacity: 0.85,
            side: THREE.DoubleSide, depthWrite: false
        });
        heatmapMesh = new THREE.Mesh(geo, mat);
        heatmapMesh.rotation.x = -Math.PI / 2;
        heatmapMesh.position.set(
            (area.minX + area.maxX) / 2, area.y, (area.minZ + area.maxZ) / 2);
        heatmapMesh.renderOrder = 5;
        scene.add(heatmapMesh);
    }

    function clearHeatmap() {
        if (!heatmapMesh) return;
        scene.remove(heatmapMesh);
        heatmapMesh.geometry.dispose();
        if (heatmapMesh.material.map) heatmapMesh.material.map.dispose();
        heatmapMesh.material.dispose();
        heatmapMesh = null;
    }

    // -----------------------------------------------------------------------
    // Isodose surface rendering
    // -----------------------------------------------------------------------
    let isodoseGroup = null;
    let isodoseMeshes = [];  // for raycasting click detection
    let isodoseCenters = [{ x: 0, y: 0, z: 0 }];  // one vantage per source
    let clickLabel = null;
    let clickMarker = null;

    function renderIsodoseSurfaces(surfaceData, centers) {
        clearIsodoseSurfaces();

        isodoseGroup = new THREE.Group();
        isodoseMeshes = [];
        isodoseCenters = Array.isArray(centers)
            ? centers.slice()
            : [centers || { x: 0, y: 0, z: 0 }];

        for (const surface of surfaceData) {
            const { level, points, faces } = surface;
            // Distance labels measure from this surface's own source vantage
            const surfCenter = surface.center || isodoseCenters[0];
            if (!faces || faces.length === 0) continue;

            // Build vertex array
            const positions = [];
            const indexMap = {};
            let newIdx = 0;

            for (let i = 0; i < points.length; i++) {
                if (points[i]) {
                    indexMap[i] = newIdx++;
                    positions.push(points[i].x, points[i].y, points[i].z);
                }
            }
            if (positions.length < 9) continue;

            const indices = [];
            for (const face of faces) {
                const ia = indexMap[face.a], ib = indexMap[face.b], ic = indexMap[face.c];
                if (ia !== undefined && ib !== undefined && ic !== undefined) {
                    indices.push(ia, ib, ic);
                }
            }
            if (indices.length < 3) continue;

            const geom = new THREE.BufferGeometry();
            geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
            geom.setIndex(indices);
            geom.computeVertexNormals();

            const color = new THREE.Color(level.color || '#ff0000');

            const mat = new THREE.MeshPhysicalMaterial({
                color: color, transparent: true, opacity: 0.18,
                roughness: 0.3, side: THREE.DoubleSide, depthWrite: false
            });
            const mesh = new THREE.Mesh(geom, mat);
            mesh.userData = { isIsodose: true, level: level };
            isodoseGroup.add(mesh);
            isodoseMeshes.push(mesh);

            // Wireframe
            const wireMat = new THREE.MeshBasicMaterial({
                color: color, transparent: true, opacity: 0.3, wireframe: true
            });
            isodoseGroup.add(new THREE.Mesh(geom.clone(), wireMat));

            // Find key points for auto-labels: top, bottom, +X, -X, +Z, -Z
            const validPts = points.filter(p => p);
            if (validPts.length === 0) continue;

            const colorHex = '#' + color.getHexString();
            const CM_TO_IN = 1 / 2.54;
            const CM_TO_FT = 1 / 30.48;

            const keyPoints = findKeyPoints(validPts, surfCenter);
            for (const kp of keyPoints) {
                const dist = Math.sqrt(
                    (kp.pt.x - surfCenter.x) ** 2 +
                    (kp.pt.y - surfCenter.y) ** 2 +
                    (kp.pt.z - surfCenter.z) ** 2
                );
                const distFt = (dist * CM_TO_FT).toFixed(1);
                const distIn = (dist * CM_TO_IN).toFixed(0);
                const text = distFt + "' (" + distIn + '")';

                // Small dot at the point
                const dotGeom = new THREE.SphereGeometry(1.5, 8, 8);
                const dotMat = new THREE.MeshBasicMaterial({ color: color });
                const dot = new THREE.Mesh(dotGeom, dotMat);
                dot.position.set(kp.pt.x, kp.pt.y, kp.pt.z);
                isodoseGroup.add(dot);

                // Distance label
                const sprite = makeTextSprite(text, {
                    fontSize: 14, color: colorHex, worldHeight: 7
                });
                sprite.position.set(
                    kp.pt.x + kp.offsetX * 8,
                    kp.pt.y + kp.offsetY * 8,
                    kp.pt.z + kp.offsetZ * 8
                );
                isodoseGroup.add(sprite);
            }

            // Level name label at top
            const topPt = keyPoints.find(k => k.name === 'top');
            if (topPt) {
                const lvlSprite = makeTextSprite(
                    level.label || (level.value_mrem_hr + ' mrem/hr'),
                    { fontSize: 16, color: colorHex, worldHeight: 10 }
                );
                lvlSprite.position.set(topPt.pt.x, topPt.pt.y + 15, topPt.pt.z);
                isodoseGroup.add(lvlSprite);
            }
        }

        scene.add(isodoseGroup);

        // Set up click handler
        if (!renderer.domElement._isodoseClickBound) {
            renderer.domElement.addEventListener('dblclick', onIsodoseClick);
            renderer.domElement._isodoseClickBound = true;
        }
    }

    // Find key surface points: top, bottom, and 4 cardinal directions at midheight
    function findKeyPoints(points, center) {
        let top = null, bottom = null;
        let maxY = -Infinity, minY = Infinity;
        let plusX = null, minusX = null, plusZ = null, minusZ = null;
        let maxX = -Infinity, minX = Infinity, maxZ = -Infinity, minZ = Infinity;

        // Find midheight Y
        for (const p of points) {
            if (p.y > maxY) { maxY = p.y; top = p; }
            if (p.y < minY) { minY = p.y; bottom = p; }
        }
        const midY = (maxY + minY) / 2;
        const yTolerance = (maxY - minY) * 0.15;

        // Find cardinal direction points near midheight
        for (const p of points) {
            if (Math.abs(p.y - midY) > yTolerance) continue;
            if (p.x > maxX) { maxX = p.x; plusX = p; }
            if (p.x < minX) { minX = p.x; minusX = p; }
            if (p.z > maxZ) { maxZ = p.z; plusZ = p; }
            if (p.z < minZ) { minZ = p.z; minusZ = p; }
        }

        const result = [];
        if (top) result.push({ name: 'top', pt: top, offsetX: 0, offsetY: 1, offsetZ: 0 });
        if (bottom) result.push({ name: 'bottom', pt: bottom, offsetX: 0, offsetY: -1, offsetZ: 0 });
        if (plusX) result.push({ name: '+X', pt: plusX, offsetX: 1, offsetY: 0, offsetZ: 0 });
        if (minusX) result.push({ name: '-X', pt: minusX, offsetX: -1, offsetY: 0, offsetZ: 0 });
        if (plusZ) result.push({ name: '+Z', pt: plusZ, offsetX: 0, offsetY: 0, offsetZ: 1 });
        if (minusZ) result.push({ name: '-Z', pt: minusZ, offsetX: 0, offsetY: 0, offsetZ: -1 });

        return result;
    }

    // Click-to-inspect: double-click on isodose surface to see distance
    function onIsodoseClick(event) {
        if (!isodoseMeshes.length) return;

        const rect = renderer.domElement.getBoundingClientRect();
        const mouse = new THREE.Vector2(
            ((event.clientX - rect.left) / rect.width) * 2 - 1,
            -((event.clientY - rect.top) / rect.height) * 2 + 1
        );

        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(mouse, camera);
        const hits = raycaster.intersectObjects(isodoseMeshes);

        // Remove previous click label/marker
        if (clickLabel) { scene.remove(clickLabel); clickLabel.material.map.dispose(); clickLabel.material.dispose(); clickLabel = null; }
        if (clickMarker) { scene.remove(clickMarker); clickMarker.geometry.dispose(); clickMarker.material.dispose(); clickMarker = null; }

        if (hits.length > 0) {
            const hit = hits[0];
            const pt = hit.point;
            // Distance from the NEAREST source vantage
            let dist = Infinity;
            for (const c of isodoseCenters) {
                const d = Math.sqrt(
                    (pt.x - c.x) ** 2 + (pt.y - c.y) ** 2 + (pt.z - c.z) ** 2);
                if (d < dist) dist = d;
            }

            const CM_TO_IN = 1 / 2.54;
            const CM_TO_FT = 1 / 30.48;
            const levelInfo = hit.object.userData.level || {};
            const doseLabel = levelInfo.label || '';
            const fromWhat = isodoseCenters.length > 1
                ? 'from nearest source' : 'from source center';
            const text = doseLabel + '\n' +
                (dist * CM_TO_FT).toFixed(1) + "' (" +
                (dist * CM_TO_IN).toFixed(0) + '") ' + fromWhat + '\n' +
                'at X ' + (pt.x * CM_TO_IN).toFixed(1) + '"  ' +
                'Y ' + (pt.y * CM_TO_IN).toFixed(1) + '"  ' +
                'Z ' + (pt.z * CM_TO_IN).toFixed(1) + '"';

            // Marker dot
            const dotGeom = new THREE.SphereGeometry(2, 12, 12);
            const dotMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
            clickMarker = new THREE.Mesh(dotGeom, dotMat);
            clickMarker.position.copy(pt);
            scene.add(clickMarker);

            // Label
            clickLabel = makeTextSprite(text, {
                fontSize: 14, color: '#ffffff', worldHeight: 7,
                background: 'rgba(13,17,23,0.75)'
            });
            clickLabel.position.set(pt.x, pt.y + 18, pt.z);
            scene.add(clickLabel);
        }
    }

    function clearIsodoseSurfaces() {
        if (isodoseGroup) {
            scene.remove(isodoseGroup);
            isodoseGroup.traverse(child => {
                if (child.geometry) child.geometry.dispose();
                if (child.material) child.material.dispose();
            });
            isodoseGroup = null;
        }
        isodoseMeshes = [];
        if (clickLabel) { scene.remove(clickLabel); clickLabel = null; }
        if (clickMarker) { scene.remove(clickMarker); clickMarker = null; }
    }

    // =======================================================================
    // Editor interaction layer (Phase 1)
    // Picking, selection highlight, transform gizmo, interaction modes.
    // App-level behavior (undo, panels, menus) lives in editor.js and is
    // wired in through the callbacks passed to initEditorControls().
    // =======================================================================

    function initEditorControls(callbacks) {
        editorCallbacks = callbacks || {};

        transformControls = new THREE.TransformControls(camera, renderer.domElement);
        transformControls.setTranslationSnap(2.54 / 4);                 // 1/4 inch
        transformControls.setRotationSnap(THREE.MathUtils.degToRad(15)); // 15 deg
        transformControls.addEventListener('dragging-changed', (e) => {
            controls.enabled = !e.value;
            if (e.value) {
                if (editorCallbacks.onTransformStart) {
                    editorCallbacks.onTransformStart(selectedId);
                }
            } else {
                commitGizmoTransform();
            }
        });
        scene.add(transformControls);

        const el = renderer.domElement;
        let downX = 0, downY = 0, downOnGizmo = false;
        let rightX = 0, rightY = 0;

        el.addEventListener('pointerdown', (e) => {
            pointerIsDown = true;
            if (e.button === 0) {
                downX = e.clientX; downY = e.clientY;
                downOnGizmo = !!(transformControls &&
                    (transformControls.dragging || transformControls.axis));
            } else if (e.button === 2) {
                rightX = e.clientX; rightY = e.clientY;
            }
        });

        el.addEventListener('pointerup', (e) => {
            pointerIsDown = false;
            if (e.button !== 0 || downOnGizmo) return;
            const moved = Math.hypot(e.clientX - downX, e.clientY - downY);
            if (moved > 5) return;  // was an orbit drag, not a click
            handleClick(e);
        });

        // Feature-snap hover (Measure / Smart Dimension only)
        el.addEventListener('pointermove', (e) => {
            if (pointerIsDown) return;   // don't fight an orbit/pan drag
            if (interactionMode === 'measure' || interactionMode === 'dimension') {
                updateHover(e);
            }
        });
        el.addEventListener('pointerleave', () => clearHover());

        // Right-click menu only when the mouse didn't pan (right-drag = pan)
        el.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            const moved = Math.hypot(e.clientX - rightX, e.clientY - rightY);
            if (moved > 5) return;
            const id = pickVolumeId(e);
            const pt = pickAnyPoint(e);
            if (editorCallbacks.onContextMenu) {
                editorCallbacks.onContextMenu(id, { x: e.clientX, y: e.clientY }, pt);
            }
        });
    }

    function rayFromEvent(e) {
        const rect = renderer.domElement.getBoundingClientRect();
        const mouse = new THREE.Vector2(
            ((e.clientX - rect.left) / rect.width) * 2 - 1,
            -((e.clientY - rect.top) / rect.height) * 2 + 1
        );
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(mouse, camera);
        return raycaster;
    }

    function pickVolumeId(e) {
        if (!pickMeshes.length) return null;
        const hits = rayFromEvent(e).intersectObjects(pickMeshes, false);
        return hits.length ? hits[0].object.userData.volumeId : null;
    }

    // Point on a volume surface, or on the ground plane as fallback
    function pickAnyPoint(e) {
        const raycaster = rayFromEvent(e);
        const hits = pickMeshes.length
            ? raycaster.intersectObjects(pickMeshes, false) : [];
        if (hits.length) {
            const p = hits[0].point;
            return { x: p.x, y: p.y, z: p.z };
        }
        const plane = new THREE.Plane(
            new THREE.Vector3(GROUND_PLANE.normal.x, GROUND_PLANE.normal.y, GROUND_PLANE.normal.z),
            GROUND_PLANE.constant
        );
        const target = new THREE.Vector3();
        if (raycaster.ray.intersectPlane(plane, target)) {
            return { x: target.x, y: target.y, z: target.z };
        }
        return null;
    }

    function handleClick(e) {
        if (interactionMode === 'dose') {
            const pt = pickAnyPoint(e);
            if (pt && editorCallbacks.onPickPoint) editorCallbacks.onPickPoint(pt);
            return;
        }
        if (interactionMode === 'measure') {
            handleMeasureClick(e);
            return;
        }
        const id = pickVolumeId(e);
        if (editorCallbacks.onSelect) {
            editorCallbacks.onSelect(id, { x: e.clientX, y: e.clientY });
        }
    }

    // =======================================================================
    // Measure tool: click two points (on volume surfaces or the ground);
    // draws markers, a line, and a distance label with X/Y/Z deltas.
    // =======================================================================
    let measureGroup = null;
    let measurePtA = null;

    function clearMeasure() {
        if (measureGroup) {
            scene.remove(measureGroup);
            measureGroup.traverse(child => {
                if (child.geometry) child.geometry.dispose();
                if (child.material) {
                    if (child.material.map) child.material.map.dispose();
                    child.material.dispose();
                }
            });
            measureGroup = null;
        }
        measurePtA = null;
    }

    function measureMarker(pt, color) {
        const m = new THREE.Mesh(
            new THREE.SphereGeometry(1.5, 12, 12),
            new THREE.MeshBasicMaterial({ color: color, depthTest: false })
        );
        m.position.set(pt.x, pt.y, pt.z);
        m.renderOrder = 10;
        return m;
    }

    function handleMeasureClick(e) {
        // Prefer the snapped key point from hover; fall back to a raw pick
        const pt = currentSnap
            ? { x: currentSnap.x, y: currentSnap.y, z: currentSnap.z }
            : pickAnyPoint(e);
        if (!pt) return;

        if (!measurePtA) {
            clearMeasure();
            measurePtA = pt;
            measureGroup = new THREE.Group();
            measureGroup.add(measureMarker(pt, 0x2ee6a8));
            scene.add(measureGroup);
            if (editorCallbacks.onMeasure) editorCallbacks.onMeasure(pt, null);
            return;
        }

        const a = measurePtA, b = pt;
        measureGroup.add(measureMarker(b, 0x2ee6a8));

        const lineGeom = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(a.x, a.y, a.z),
            new THREE.Vector3(b.x, b.y, b.z)
        ]);
        const line = new THREE.Line(lineGeom, new THREE.LineBasicMaterial({
            color: 0x2ee6a8, depthTest: false
        }));
        line.renderOrder = 10;
        measureGroup.add(line);

        const IN = 2.54, FT = 30.48;
        const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const text =
            (dist / IN).toFixed(2) + '"  (' + (dist / FT).toFixed(2) + " ft)\n" +
            'ΔX ' + (dx / IN).toFixed(2) + '"  ' +
            'ΔY ' + (dy / IN).toFixed(2) + '"  ' +
            'ΔZ ' + (dz / IN).toFixed(2) + '"';
        const label = makeTextSprite(text, {
            fontSize: 14, color: '#2ee6a8', worldHeight: 6,
            background: 'rgba(13,17,23,0.75)'
        });
        label.position.set((a.x + b.x) / 2, (a.y + b.y) / 2 + 8, (a.z + b.z) / 2);
        measureGroup.add(label);

        measurePtA = null;
        if (editorCallbacks.onMeasure) editorCallbacks.onMeasure(a, b);
    }

    // =======================================================================
    // Feature snapping (Measure & Smart Dimension) — SolidEdge-style.
    // On hover we tint the volume, highlight the specific face under the
    // cursor, and snap to the nearest key point (corner / edge midpoint /
    // rim quadrant / face or axis center). The snapped world point is what a
    // Measure/Dimension click consumes, so measurements lock onto real
    // geometry instead of an arbitrary point in space.
    // =======================================================================

    // World-space rotation+translation for a vis object, matching the volume's
    // own transform (three.js Euler order 'XYZ' — same as geometry.js).
    function visMatrix(vis) {
        const r = vis.rotation || { x: 0, y: 0, z: 0 };
        const M = new THREE.Matrix4();
        M.makeRotationFromEuler(new THREE.Euler(
            THREE.MathUtils.degToRad(r.x || 0),
            THREE.MathUtils.degToRad(r.y || 0),
            THREE.MathUtils.degToRad(r.z || 0), 'XYZ'));
        M.setPosition(vis.position.x, vis.position.y, vis.position.z);
        return M;
    }

    // Key points for one volume, in WORLD coordinates.
    // prio: 0 = corner/vertex, 1 = edge/quadrant, 2 = center/face (lower wins).
    function featuresFor(vis) {
        const M = visMatrix(vis);
        const out = [];
        const add = (x, y, z, type, label, prio) => out.push({
            p: new THREE.Vector3(x, y, z).applyMatrix4(M),
            volId: vis.id, type, label, prio
        });
        switch (vis.type) {
            case 'box': {
                const hw = vis.width / 2, hd = vis.depth / 2, h = vis.height;
                for (const sx of [-hw, hw])
                    for (const sy of [0, h])
                        for (const sz of [-hd, hd]) add(sx, sy, sz, 'vertex', 'Corner', 0);
                for (const sy of [0, h]) for (const sz of [-hd, hd]) add(0, sy, sz, 'edge', 'Edge midpoint', 1);
                for (const sx of [-hw, hw]) for (const sz of [-hd, hd]) add(sx, h / 2, sz, 'edge', 'Edge midpoint', 1);
                for (const sx of [-hw, hw]) for (const sy of [0, h]) add(sx, sy, 0, 'edge', 'Edge midpoint', 1);
                add(0, h / 2, 0, 'center', 'Center', 2);
                add(hw, h / 2, 0, 'face', 'Face center', 2);
                add(-hw, h / 2, 0, 'face', 'Face center', 2);
                add(0, h / 2, hd, 'face', 'Face center', 2);
                add(0, h / 2, -hd, 'face', 'Face center', 2);
                add(0, 0, 0, 'face', 'Bottom center', 2);
                add(0, h, 0, 'face', 'Top center', 2);
                break;
            }
            case 'cylinder': {
                const r = vis.radius, h = vis.height;
                add(0, 0, 0, 'face', 'Bottom center', 2);
                add(0, h, 0, 'face', 'Top center', 2);
                add(0, h / 2, 0, 'center', 'Center', 2);
                for (const [dx, dz] of [[r, 0], [-r, 0], [0, r], [0, -r]]) {
                    add(dx, 0, dz, 'edge', 'Rim quadrant', 1);
                    add(dx, h, dz, 'edge', 'Rim quadrant', 1);
                }
                break;
            }
            case 'disk': {
                const r = vis.radius, th = vis.thickness || vis.height;
                add(0, 0, 0, 'face', 'Bottom center', 2);
                add(0, th, 0, 'face', 'Top center', 2);
                add(0, th / 2, 0, 'center', 'Center', 2);
                for (const [dx, dz] of [[r, 0], [-r, 0], [0, r], [0, -r]]) {
                    add(dx, 0, dz, 'edge', 'Rim quadrant', 1);
                    add(dx, th, dz, 'edge', 'Rim quadrant', 1);
                }
                break;
            }
            case 'annulus': {
                const ri = vis.innerRadius, ro = vis.outerRadius, h = vis.height;
                add(0, 0, 0, 'center', 'Axis (bottom)', 2);
                add(0, h, 0, 'center', 'Axis (top)', 2);
                for (const rr of [ri, ro])
                    for (const [dx, dz] of [[rr, 0], [-rr, 0], [0, rr], [0, -rr]]) {
                        add(dx, 0, dz, 'edge', 'Rim quadrant', 1);
                        add(dx, h, dz, 'edge', 'Rim quadrant', 1);
                    }
                break;
            }
            case 'sphere': {
                const r = vis.radius;
                add(0, r, 0, 'center', 'Center', 2);
                add(0, 0, 0, 'vertex', 'Bottom point', 0);
                add(0, 2 * r, 0, 'vertex', 'Top point', 0);
                for (const [dx, dz] of [[r, 0], [-r, 0], [0, r], [0, -r]])
                    add(dx, r, dz, 'edge', 'Equator quadrant', 1);
                break;
            }
        }
        return out;
    }

    function getSnapFeatures() {
        if (snapFeatureCache) return snapFeatureCache;
        snapFeatureCache = [];
        for (const vis of currentVisList) {
            if (vis.visible === false) continue;
            for (const f of featuresFor(vis)) snapFeatureCache.push(f);
        }
        return snapFeatureCache;
    }

    // World point -> pixel coords within the canvas; behind=true if off-camera.
    function toScreen(v3, rect) {
        const p = v3.clone().project(camera);
        return {
            x: (p.x * 0.5 + 0.5) * rect.width,
            y: (-p.y * 0.5 + 0.5) * rect.height,
            behind: p.z > 1
        };
    }

    const GLYPH_COLOR = {
        vertex: 0xffd54f, edge: 0x00e5ff,
        center: 0xff5cf0, face: 0xff5cf0, onface: 0xffffff
    };

    function makeGlyph(type, p) {
        let geom;
        if (type === 'vertex') geom = new THREE.BoxGeometry(3.2, 3.2, 3.2);
        else if (type === 'edge') geom = new THREE.OctahedronGeometry(2.4);
        else if (type === 'onface') geom = new THREE.SphereGeometry(1.7, 10, 10);
        else geom = new THREE.TorusGeometry(2.3, 0.7, 8, 18);
        const m = new THREE.Mesh(geom, new THREE.MeshBasicMaterial({
            color: GLYPH_COLOR[type] || 0xffffff, depthTest: false,
            transparent: true, opacity: 0.95
        }));
        m.position.copy(p);
        m.renderOrder = 21;
        return m;
    }

    function addSnapLabel(text, p) {
        const label = makeTextSprite(text, {
            fontSize: 12, color: '#e6edf3', worldHeight: 4.5,
            background: 'rgba(13,17,23,0.8)'
        });
        label.position.set(p.x, p.y + 7, p.z);
        label.renderOrder = 22;
        hoverGroup.add(label);
    }

    function addRimLoop(group, r, y) {
        const pts = [];
        for (let i = 0; i <= 48; i++) {
            const a = (i / 48) * Math.PI * 2;
            pts.push(new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r));
        }
        const loop = new THREE.Line(
            new THREE.BufferGeometry().setFromPoints(pts),
            new THREE.LineBasicMaterial({
                color: 0x00e5ff, depthTest: false, transparent: true, opacity: 0.9
            }));
        loop.renderOrder = 12;
        group.add(loop);
    }

    // Translucent highlight of the specific face/surface under the cursor.
    function addFaceHighlight(vis, hit) {
        if (!hit || !hit.face) return;
        const nWorld = hit.face.normal.clone()
            .applyMatrix3(new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld))
            .normalize();
        const r = vis.rotation || { x: 0, y: 0, z: 0 };
        const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(
            THREE.MathUtils.degToRad(r.x || 0),
            THREE.MathUtils.degToRad(r.y || 0),
            THREE.MathUtils.degToRad(r.z || 0), 'XYZ'));
        const nLoc = nWorld.clone().applyQuaternion(q.clone().invert());
        const ax = Math.abs(nLoc.x), ay = Math.abs(nLoc.y), az = Math.abs(nLoc.z);

        const local = new THREE.Group();
        local.matrixAutoUpdate = false;
        local.matrix.copy(visMatrix(vis));
        const mat = new THREE.MeshBasicMaterial({
            color: 0x00e5ff, transparent: true, opacity: 0.22,
            side: THREE.DoubleSide, depthTest: false, depthWrite: false
        });

        if (vis.type === 'box') {
            const hw = vis.width / 2, hd = vis.depth / 2, h = vis.height;
            let mesh;
            if (ax >= ay && ax >= az) {
                mesh = new THREE.Mesh(new THREE.PlaneGeometry(vis.depth, h), mat);
                mesh.rotation.y = Math.sign(nLoc.x) * Math.PI / 2;
                mesh.position.set(Math.sign(nLoc.x) * hw, h / 2, 0);
            } else if (ay >= ax && ay >= az) {
                mesh = new THREE.Mesh(new THREE.PlaneGeometry(vis.width, vis.depth), mat);
                mesh.rotation.x = -Math.sign(nLoc.y) * Math.PI / 2;
                mesh.position.set(0, nLoc.y > 0 ? h : 0, 0);
            } else {
                mesh = new THREE.Mesh(new THREE.PlaneGeometry(vis.width, h), mat);
                if (nLoc.z < 0) mesh.rotation.y = Math.PI;
                mesh.position.set(0, h / 2, Math.sign(nLoc.z) * hd);
            }
            mesh.renderOrder = 12;
            local.add(mesh);
        } else if (vis.type === 'cylinder' || vis.type === 'disk') {
            const rr = vis.radius;
            const h = (vis.type === 'disk') ? (vis.thickness || vis.height) : vis.height;
            if (ay >= ax && ay >= az) {
                const mesh = new THREE.Mesh(new THREE.CircleGeometry(rr, 40), mat);
                mesh.rotation.x = -Math.PI / 2;
                mesh.position.y = nLoc.y > 0 ? h : 0;
                mesh.renderOrder = 12;
                local.add(mesh);
            } else {
                addRimLoop(local, rr, 0);
                addRimLoop(local, rr, h);
            }
        } else if (vis.type === 'annulus') {
            const ri = vis.innerRadius, ro = vis.outerRadius, h = vis.height;
            if (ay >= ax && ay >= az) {
                const mesh = new THREE.Mesh(new THREE.RingGeometry(ri, ro, 40), mat);
                mesh.rotation.x = -Math.PI / 2;
                mesh.position.y = nLoc.y > 0 ? h : 0;
                mesh.renderOrder = 12;
                local.add(mesh);
            } else {
                addRimLoop(local, ro, 0); addRimLoop(local, ro, h);
                addRimLoop(local, ri, 0); addRimLoop(local, ri, h);
            }
        }
        // sphere: tint only, no planar face to highlight
        if (local.children.length) hoverGroup.add(local);
    }

    function applyHoverTint(id) {
        if (id === selectedId) return;    // don't override the selection color
        const grp = volGroupById[id];
        if (!grp) return;
        grp.traverse(child => {
            if (child.isMesh && child.material && child.material.emissive) {
                child.material.emissive.setHex(0x00393f);
                child.material.emissiveIntensity = 1.0;
            }
        });
        hoveredVolId = id;
    }

    function pickGroundPoint(rc) {
        const plane = new THREE.Plane(
            new THREE.Vector3(GROUND_PLANE.normal.x, GROUND_PLANE.normal.y, GROUND_PLANE.normal.z),
            GROUND_PLANE.constant);
        const target = new THREE.Vector3();
        return rc.ray.intersectPlane(plane, target)
            ? { x: target.x, y: target.y, z: target.z } : null;
    }

    function updateHover(e) {
        clearHover();
        const rect = renderer.domElement.getBoundingClientRect();
        const cursor = { x: e.clientX - rect.left, y: e.clientY - rect.top };
        const rc = rayFromEvent(e);
        const hits = pickMeshes.length ? rc.intersectObjects(pickMeshes, false) : [];
        const hit = hits.length ? hits[0] : null;
        const hoverId = hit ? hit.object.userData.volumeId : null;

        // nearest key point within pixel tolerance (priority, then distance)
        let best = null;
        for (const f of getSnapFeatures()) {
            const s = toScreen(f.p, rect);
            if (s.behind) continue;
            const d = Math.hypot(s.x - cursor.x, s.y - cursor.y);
            if (d > SNAP_TOL) continue;
            const score = f.prio * 10000 + d;
            if (!best || score < best.score) best = { f, score };
        }

        hoverGroup = new THREE.Group();
        scene.add(hoverGroup);

        if (hoverId) {
            applyHoverTint(hoverId);
            const vis = currentVisList.find(v => v.id === hoverId);
            if (vis) addFaceHighlight(vis, hit);
        }

        if (best) {
            const p = best.f.p;
            currentSnap = { x: p.x, y: p.y, z: p.z, type: best.f.label };
            hoverGroup.add(makeGlyph(best.f.type, p));
            addSnapLabel(best.f.label, p);
        } else if (hit) {
            const p = hit.point;
            currentSnap = { x: p.x, y: p.y, z: p.z, type: 'On surface' };
            hoverGroup.add(makeGlyph('onface', p));
            addSnapLabel('On surface', p);
        } else {
            const g = pickGroundPoint(rc);
            if (g) {
                currentSnap = { x: g.x, y: g.y, z: g.z, type: 'On floor' };
                hoverGroup.add(makeGlyph('onface', new THREE.Vector3(g.x, g.y, g.z)));
            } else {
                currentSnap = null;
            }
        }

        // rubber-band preview from the 1st measure point to the live snap
        if (interactionMode === 'measure' && measurePtA && currentSnap) {
            const lg = new THREE.BufferGeometry().setFromPoints([
                new THREE.Vector3(measurePtA.x, measurePtA.y, measurePtA.z),
                new THREE.Vector3(currentSnap.x, currentSnap.y, currentSnap.z)
            ]);
            const ln = new THREE.Line(lg, new THREE.LineDashedMaterial({
                color: 0x2ee6a8, depthTest: false, dashSize: 3, gapSize: 2,
                transparent: true, opacity: 0.85
            }));
            ln.computeLineDistances();
            ln.renderOrder = 14;
            hoverGroup.add(ln);
        }
    }

    function clearHover() {
        if (hoveredVolId) { applySelectionVisuals(); hoveredVolId = null; }
        if (hoverGroup) {
            scene.remove(hoverGroup);
            hoverGroup.traverse(child => {
                if (child.geometry) child.geometry.dispose();
                if (child.material) {
                    if (child.material.map) child.material.map.dispose();
                    child.material.dispose();
                }
            });
            hoverGroup = null;
        }
        currentSnap = null;
    }

    function commitGizmoTransform() {
        const obj = transformControls.object;
        if (!obj || !selectedId) return;
        const RAD = 180 / Math.PI;
        if (editorCallbacks.onTransformEnd) {
            editorCallbacks.onTransformEnd(selectedId,
                { x: obj.position.x, y: obj.position.y, z: obj.position.z },
                { x: obj.rotation.x * RAD, y: obj.rotation.y * RAD, z: obj.rotation.z * RAD }
            );
        }
    }

    // --- Selection ---
    function setSelected(id) {
        selectedId = id;
        applySelectionVisuals();
    }

    function getSelected() { return selectedId; }

    function applySelectionVisuals() {
        // Emissive highlight on the selected volume's meshes
        for (const [id, grp] of Object.entries(volGroupById)) {
            const isSel = id === selectedId;
            grp.traverse(child => {
                if (child.isMesh && child.material && child.material.emissive) {
                    child.material.emissive.setHex(isSel ? 0x1f6feb : 0x000000);
                    child.material.emissiveIntensity = isSel ? 0.55 : 1.0;
                }
            });
        }
        updateGizmoAttachment();
    }

    function updateGizmoAttachment() {
        if (!transformControls) return;
        const wantGizmo = (interactionMode === 'translate' || interactionMode === 'rotate');
        const grp = selectedId ? volGroupById[selectedId] : null;
        if (wantGizmo && grp) {
            transformControls.setMode(interactionMode);
            transformControls.attach(grp);
        } else {
            transformControls.detach();
        }
    }

    // --- Interaction mode ---
    function setMode(mode) {
        if (interactionMode === 'measure' && mode !== 'measure') clearMeasure();
        clearHover();
        interactionMode = mode;
        if (renderer) {
            renderer.domElement.style.cursor =
                (mode === 'dose' || mode === 'measure') ? 'crosshair' : 'default';
        }
        updateGizmoAttachment();
    }

    function getMode() { return interactionMode; }

    // -----------------------------------------------------------------------
    // Public API
    // -----------------------------------------------------------------------
    return {
        init,
        renderScene,
        setDosePoint,
        setDosePoints,
        snapshot,
        showHeatmap,
        clearHeatmap,
        renderIsodoseSurfaces,
        clearIsodoseSurfaces,
        onResize,
        initEditorControls,
        setSelected,
        getSelected,
        setMode,
        getMode,
        clearMeasure,
        getSnap: () => currentSnap,
        COLORS
    };

})();
