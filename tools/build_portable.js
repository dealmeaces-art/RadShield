// ============================================================================
// RadShield - Portable build script
// Run with: node tools/build_portable.js [output.html]
//
// Produces a single self-contained HTML file from index.html by inlining
// the CDN Three.js/OrbitControls references (using the local cached copies)
// and all src/*.js modules. The output runs offline via double-click.
// ============================================================================

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const outName = process.argv[2] || 'RadShield_Portable_v5.html';

let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

function localFileFor(src) {
    if (src.includes('three.min.js')) return 'three.min.js';
    if (src.includes('OrbitControls.js')) return 'OrbitControls.js';
    if (src.includes('TransformControls.js')) return 'TransformControls.js';
    if (src.includes('gifenc.min.js')) return 'gifenc.min.js';
    if (src.startsWith('src/')) return src;
    return null;
}

let inlined = 0;
html = html.replace(/<script src="([^"]+)"><\/script>/g, (tag, src) => {
    const file = localFileFor(src);
    if (!file) {
        console.warn(`WARNING: no local file for ${src}, leaving external reference`);
        return tag;
    }
    let code = fs.readFileSync(path.join(root, file), 'utf8');
    if (code.includes('</script')) {
        // Break up any literal close-tag so the inline block survives parsing
        code = code.replace(/<\/script/g, '<\\/script');
    }
    inlined++;
    return `<script>\n// ==== inlined: ${file} ====\n${code}\n</script>`;
});

const outPath = path.join(root, outName);
fs.writeFileSync(outPath, html);
const kb = Math.round(fs.statSync(outPath).size / 1024);
console.log(`Built ${outName} (${kb} KB, ${inlined} scripts inlined)`);
