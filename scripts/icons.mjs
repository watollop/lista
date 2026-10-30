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

// Splash iOS: una por tamaño de iPhone (ancho x alto en pt, factor de píxel). iOS solo usa
// la que coincide exactamente con la pantalla; sin coincidencia, arranca en blanco.
// index.html enlaza estas mismas (se genera con `npm run icons`).
const SPLASHES = [
  [360, 780, 3], [375, 667, 2], [375, 812, 3], [390, 844, 3], [393, 852, 3], [402, 874, 3],
  [414, 736, 3], [414, 896, 2], [414, 896, 3], [428, 926, 3], [430, 932, 3], [440, 956, 3],
];
const TARGET_GLYPH_W = 200;
const splash = (w, h, bg, fg) => {
  const k = (TARGET_GLYPH_W * (w / 1179)) / GLYPH_W; // el glifo ocupa la misma fracción del ancho en todos
  return svgDoc(
    w,
    h,
    `<rect width="${w}" height="${h}" fill="${bg}"/>` +
      `<g transform="translate(${w / 2} ${h / 2}) scale(${k.toFixed(5)}) translate(${-GLYPH_CX} ${-GLYPH_CY})">${glyph(fg)}</g>`,
  );
};
for (const [pw, ph, ratio] of SPLASHES) {
  const w = pw * ratio;
  const h = ph * ratio;
  write(`splash-${w}x${h}-light.png`, toPng(splash(w, h, '#fff', '#000')));
  write(`splash-${w}x${h}-dark.png`, toPng(splash(w, h, '#000', '#fff')));
}

// Favicon SVG: copia literal del diseño.
copyFileSync(srcPath, path.join(outDir, 'favicon.svg'));
console.log('  ->', path.join('public/icons', 'favicon.svg'));
