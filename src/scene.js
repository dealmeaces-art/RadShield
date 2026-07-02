// ============================================================================
// RadShield - 3D Visualization Module v2
// Renders arbitrary volumes from SceneModel
// ============================================================================

const Scene = (() => {

    let scene, camera, renderer, controls;
    let container;
    let sceneGroup = null;
    let dosePointMesh = null;
    let dosePointLabel = null;

    // --- Editor state ---
    let transformControls = null;
    let editorCallbacks = {};        // onSelect, onPickPoint, onContextMenu,
                                     // onTransformStart, onTransformEnd
    let interactionMode = 'select';  // 'select' | 'translate' | 'rotate' | 'dose'
    let selectedId = null;
    let volGroupById = {};           // volumeId -> THREE.Group
    let pickMeshes = [];             // raycast targets (userData.volumeId set)
    const GROUND_PLANE = { normal: { x: 0, y: 1, z: 0 }, constant: 0 };

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

        renderer = new THREE.WebGLRenderer({ antialias: true });
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
        const opacity = isSource ? 0.5 : (vol.role === 'container' ? 0.35 : 0.3);
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
                opacity: 0.5
            });
            const wireframe = new THREE.LineSegments(wireGeom, wireMat);
            wireframe.position.set(0, h / 2, 0);
            volGroup.add(wireframe);

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
                color: baseColor, transparent: true, opacity: 0.5
            });
            const wireframe = new THREE.LineSegments(wireGeom, wireMat);
            wireframe.position.set(0, h / 2, 0);
            volGroup.add(wireframe);
        }

        // Label
        if (vol.label) {
            const h = vol.height || vol.thickness || 0;
            const r = vol.outerRadius || vol.radius || 10;
            const labelSprite = makeTextSprite(vol.label, {
                fontSize: 14,
                color: isSource ? '#FF8F00' : '#ffffff'
            });
            labelSprite.position.set(r + 12, h / 2, 0);
            labelSprite.scale.set(60, 25, 1);
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
    function makeTextSprite(message, params) {
        const fontSize = params.fontSize || 14;
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = 512;
        canvas.height = 128;
        ctx.font = (fontSize * 3) + 'px Arial';
        ctx.fillStyle = params.color || '#ffffff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(message, 256, 64);
        const texture = new THREE.CanvasTexture(canvas);
        texture.needsUpdate = true;
        return new THREE.Sprite(new THREE.SpriteMaterial({
            map: texture, transparent: true, depthTest: false
        }));
    }

    // -----------------------------------------------------------------------
    // Set dose point marker
    // -----------------------------------------------------------------------
    function setDosePoint(x, y, z, resultText) {
        if (dosePointMesh) {
            scene.remove(dosePointMesh);
            dosePointMesh.geometry.dispose();
            dosePointMesh.material.dispose();
        }
        if (dosePointLabel) {
            scene.remove(dosePointLabel);
            dosePointLabel.material.map.dispose();
            dosePointLabel.material.dispose();
        }

        const geom = new THREE.SphereGeometry(2, 16, 16);
        const mat = new THREE.MeshBasicMaterial({ color: COLORS.dosePoint });
        dosePointMesh = new THREE.Mesh(geom, mat);
        dosePointMesh.position.set(x, y, z);
        scene.add(dosePointMesh);

        const glowGeom = new THREE.SphereGeometry(4, 16, 16);
        const glowMat = new THREE.MeshBasicMaterial({
            color: COLORS.dosePoint, transparent: true, opacity: 0.3
        });
        dosePointMesh.add(new THREE.Mesh(glowGeom, glowMat));

        if (resultText) {
            dosePointLabel = makeTextSprite(resultText, { fontSize: 16, color: '#FF1744' });
            dosePointLabel.position.set(x, y + 10, z);
            dosePointLabel.scale.set(80, 30, 1);
            scene.add(dosePointLabel);
        }
    }

    // -----------------------------------------------------------------------
    // Isodose surface rendering
    // -----------------------------------------------------------------------
    let isodoseGroup = null;
    let isodoseMeshes = [];  // for raycasting click detection
    let isodoseCenter = { x: 0, y: 0, z: 0 };
    let clickLabel = null;
    let clickMarker = null;

    function renderIsodoseSurfaces(surfaceData, center) {
        clearIsodoseSurfaces();

        isodoseGroup = new THREE.Group();
        isodoseMeshes = [];
        isodoseCenter = center || { x: 0, y: 0, z: 0 };

        for (const surface of surfaceData) {
            const { level, points, faces } = surface;
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

            const keyPoints = findKeyPoints(validPts, isodoseCenter);
            for (const kp of keyPoints) {
                const dist = Math.sqrt(
                    (kp.pt.x - isodoseCenter.x) ** 2 +
                    (kp.pt.y - isodoseCenter.y) ** 2 +
                    (kp.pt.z - isodoseCenter.z) ** 2
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
                const sprite = makeTextSprite(text, { fontSize: 14, color: colorHex });
                sprite.position.set(
                    kp.pt.x + kp.offsetX * 8,
                    kp.pt.y + kp.offsetY * 8,
                    kp.pt.z + kp.offsetZ * 8
                );
                sprite.scale.set(50, 20, 1);
                isodoseGroup.add(sprite);
            }

            // Level name label at top
            const topPt = keyPoints.find(k => k.name === 'top');
            if (topPt) {
                const lvlSprite = makeTextSprite(
                    level.label || (level.value_mrem_hr + ' mrem/hr'),
                    { fontSize: 16, color: colorHex }
                );
                lvlSprite.position.set(topPt.pt.x, topPt.pt.y + 15, topPt.pt.z);
                lvlSprite.scale.set(70, 28, 1);
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
            const dist = Math.sqrt(
                (pt.x - isodoseCenter.x) ** 2 +
                (pt.y - isodoseCenter.y) ** 2 +
                (pt.z - isodoseCenter.z) ** 2
            );

            const CM_TO_IN = 1 / 2.54;
            const CM_TO_FT = 1 / 30.48;
            const levelInfo = hit.object.userData.level || {};
            const doseLabel = levelInfo.label || '';
            const text = doseLabel + ' | Dist: ' +
                (dist * CM_TO_FT).toFixed(1) + "' (" +
                (dist * CM_TO_IN).toFixed(0) + '") | ' +
                'X:' + (pt.x * CM_TO_IN).toFixed(1) + '" ' +
                'Y:' + (pt.y * CM_TO_IN).toFixed(1) + '" ' +
                'Z:' + (pt.z * CM_TO_IN).toFixed(1) + '"';

            // Marker dot
            const dotGeom = new THREE.SphereGeometry(2, 12, 12);
            const dotMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
            clickMarker = new THREE.Mesh(dotGeom, dotMat);
            clickMarker.position.copy(pt);
            scene.add(clickMarker);

            // Label
            clickLabel = makeTextSprite(text, { fontSize: 14, color: '#ffffff' });
            clickLabel.position.set(pt.x, pt.y + 12, pt.z);
            clickLabel.scale.set(120, 30, 1);
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
            if (e.button === 0) {
                downX = e.clientX; downY = e.clientY;
                downOnGizmo = !!(transformControls &&
                    (transformControls.dragging || transformControls.axis));
            } else if (e.button === 2) {
                rightX = e.clientX; rightY = e.clientY;
            }
        });

        el.addEventListener('pointerup', (e) => {
            if (e.button !== 0 || downOnGizmo) return;
            const moved = Math.hypot(e.clientX - downX, e.clientY - downY);
            if (moved > 5) return;  // was an orbit drag, not a click
            handleClick(e);
        });

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
        const id = pickVolumeId(e);
        if (editorCallbacks.onSelect) editorCallbacks.onSelect(id);
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
        interactionMode = mode;
        if (renderer) {
            renderer.domElement.style.cursor = (mode === 'dose') ? 'crosshair' : 'default';
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
        renderIsodoseSurfaces,
        clearIsodoseSurfaces,
        onResize,
        initEditorControls,
        setSelected,
        getSelected,
        setMode,
        getMode,
        COLORS
    };

})();
