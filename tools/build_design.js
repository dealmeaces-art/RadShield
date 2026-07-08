// ============================================================================
// RadShield - Design Document build script
// Run with: node tools/build_design.js
//
// Produces RadShield_Design_Document.html (self-contained, images embedded as
// base64 data URIs) from docs/design_src.html + docs/images/*.png.
// Edit docs/design_src.html, re-run this, commit both. Inline SVG figures need
// no embedding; only <img src="images/..."> references are inlined.
// ============================================================================

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const srcPath = path.join(root, 'docs', 'design_src.html');
const outPath = path.join(root, 'RadShield_Design_Document.html');

let html = fs.readFileSync(srcPath, 'utf8');

let embedded = 0;
html = html.replace(/src="images\/([^"]+)"/g, (m, file) => {
    const imgPath = path.join(root, 'docs', 'images', file);
    if (!fs.existsSync(imgPath)) {
        console.warn(`WARNING: missing image ${file}, leaving relative reference`);
        return m;
    }
    const b64 = fs.readFileSync(imgPath).toString('base64');
    embedded++;
    return `src="data:image/png;base64,${b64}"`;
});

fs.writeFileSync(outPath, html);
const mb = (fs.statSync(outPath).size / 1024 / 1024).toFixed(2);
console.log(`Built RadShield_Design_Document.html (${mb} MB, ${embedded} images embedded)`);
