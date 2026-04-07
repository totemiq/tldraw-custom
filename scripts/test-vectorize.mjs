import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PNG_SRC = path.join(process.env.HOME, 'Downloads', 'PNG POR GRUPOS ', 'UKUKO 1', 'ukuko 1.png');
const TEST_DIR_SVG = path.join(ROOT, 'public', 'illustrations', 'svg', 'test-group');
const TEST_DIR_PNG = path.join(ROOT, 'public', 'illustrations', 'png', 'test-group');
const DEST_SVG = path.join(TEST_DIR_SVG, 'ukuko-1.svg');
const DEST_PNG = path.join(TEST_DIR_PNG, 'ukuko-1.png');

if (!fs.existsSync(PNG_SRC)) {
  console.error("Missing source PNG:", PNG_SRC);
  process.exit(1);
}

fs.mkdirSync(TEST_DIR_SVG, { recursive: true });
fs.mkdirSync(TEST_DIR_PNG, { recursive: true });

fs.copyFileSync(PNG_SRC, DEST_PNG);

console.log("Vectorizing Tinta (Ink)...");
const tmpInk = path.join(ROOT, 'public', 'illustrations', 'temp-ink.pgm');
// Flatten sobre blanco y sacar líneas negras
execSync(`magick "${PNG_SRC}" -background white -flatten -threshold 50% "${tmpInk}"`);
execSync(`potrace -s -o "${DEST_SVG}.ink.svg" "${tmpInk}"`);

console.log("Vectorizing Silueta (Background Fill)...");
const tmpFill = path.join(ROOT, 'public', 'illustrations', 'temp-fill.pgm');
// Intentamos crear una silueta sólida usando floodfill desde 0,0 y Morphology
// 1. Aplanamos en blanco
// 2. Cerramos huecos (Disk:5)
// 3. Floodfill transparente desde 0,0
// 4. Extraer Alpha
try {
  execSync(`magick "${PNG_SRC}" -background white -flatten \\
    -morphology Close Disk:15 \\
    -fuzz 5% -fill none -draw "color 0,0 floodfill" \\
    -channel A -separate -threshold 50% "${tmpFill}"`);
  execSync(`potrace -s -o "${DEST_SVG}.fill.svg" "${tmpFill}"`);
} catch (e) {
  console.log("Silueta compleja, usando fallback de caja opaca.");
  execSync(`magick "${PNG_SRC}" -fill black -colorize 100 -transparent white "${tmpFill}"`);
  execSync(`potrace -s -o "${DEST_SVG}.fill.svg" "${tmpFill}"`);
}

fs.unlinkSync(tmpInk);
if (fs.existsSync(tmpFill)) fs.unlinkSync(tmpFill);

// Ensamblar ambos SVGs
let inkSvg = fs.readFileSync(`${DEST_SVG}.ink.svg`, 'utf8');
let fillSvg = fs.readFileSync(`${DEST_SVG}.fill.svg`, 'utf8');

// Extraer los <path> usando regex básico
const extractPath = (svgStr) => {
  const match = svgStr.match(/<path[^>]*d="([^"]*)"/);
  return match ? match[1] : '';
};

const inkPathData = extractPath(inkSvg);
const fillPathData = extractPath(fillSvg);

// Tldraw dimensions
const w = 3754; const h = 2394;

const finalSvg = `<?xml version="1.0" standalone="no"?>
<svg version="1.0" xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet">
<g transform="translate(0.000000,${h}.000000) scale(0.100000,-0.100000)">
  <!-- FONDO (Fill) -->
  <path class="shape-fill" d="${fillPathData}" fill="transparent" />
  <!-- TINTA (Stroke) -->
  <path class="shape-stroke" d="${inkPathData}" fill="currentColor" />
</g>
</svg>`;

fs.writeFileSync(DEST_SVG, finalSvg, 'utf8');
fs.unlinkSync(`${DEST_SVG}.ink.svg`);
fs.unlinkSync(`${DEST_SVG}.fill.svg`);

console.log("Done. Output with 2 layers to", DEST_SVG);
