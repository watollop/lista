// Genera los iconos PWA y las splash de iOS a partir de scripts/icon.svg.
// Uso: npm run icons
import { readFileSync, writeFileSync, copyFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const outDir = path.join(root, 'public', 'icons');
const srcPath = path.join(here, 'icon.svg');
const srcSvg = readFileSync(srcPath, 'utf8');

// Grupo del glifo (lista + checkbox). Solo contiene formas geométricas.
const glyphMatch = srcSvg.match(/<g id="glyph"[\s\S]*?<\/g>/);
if (!glyphMatch) throw new Error('scripts/icon.svg: falta <g id="glyph">');
const glyphTemplate = glyphMatch[0];
const glyph = (color) => glyphTemplate.replaceAll('#fff', color);

// Caja del glifo en el lienzo de 512 (x: 109..403, y: 170..343).
const GLYPH_W = 294;
const GLYPH_CX = 256;
const GLYPH_CY = 256.5;

const svgDoc = (width, height, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>`;

const toPng = (svg, width) => {
  const opts = { font: { loadSystemFonts: false } };
  if (width) opts.fitTo = { mode: 'width', value: width };
  return new Resvg(svg, opts).render().asPng();
};

mkdirSync(outDir, { recursive: true });
const write = (name, buf) => {
  writeFileSync(path.join(outDir, name), buf);
  console.log('  ->', path.join('public/icons', name), buf.length, 'bytes');
};

// Iconos normales (fondo negro cuadrado, sin radios: el SO redondea si procede).
write('icon-192.png', toPng(srcSvg, 192));
write('icon-512.png', toPng(srcSvg, 512));
write('apple-touch-icon.png', toPng(srcSvg, 180));
write('favicon-32.png', toPng(srcSvg, 32));

// Maskable: contenido dentro del 80% central (zona segura), fondo negro completo.
const maskable = svgDoc(
  512,
  512,
  `<rect width="512" height="512" fill="#000"/>` +
    `<g transform="translate(256 256) scale(0.8) translate(-256 -256)">${glyph('#fff')}</g>`,
);
write('maskable-512.png', toPng(maskable, 512));

// Splash iOS iPhone 16 (393x852 pt @3x = 1179x2556).
const SPLASH_W = 1179;
const SPLASH_H = 2556;
const TARGET_GLYPH_W = 200;
const k = TARGET_GLYPH_W / GLYPH_W;
const splash = (bg, fg) =>
  svgDoc(
    SPLASH_W,
    SPLASH_H,
    `<rect width="${SPLASH_W}" height="${SPLASH_H}" fill="${bg}"/>` +
      `<g transform="translate(${SPLASH_W / 2} ${SPLASH_H / 2}) scale(${k.toFixed(5)}) translate(${-GLYPH_CX} ${-GLYPH_CY})">${glyph(fg)}</g>`,
  );
write('splash-1179x2556-light.png', toPng(splash('#fff', '#000')));
write('splash-1179x2556-dark.png', toPng(splash('#000', '#fff')));

// Favicon SVG: copia literal del diseño.
copyFileSync(srcPath, path.join(outDir, 'favicon.svg'));
console.log('  ->', path.join('public/icons', 'favicon.svg'));
