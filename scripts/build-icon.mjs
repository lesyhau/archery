// Builds the icon assets from media/icon.svg (white on transparent, filled shapes only):
//   media/icon.png            extension icon (Marketplace, Extensions view): the symbol in teal and amber on
//                             transparent, readable on light and dark themes (a PNG cannot follow the theme)
//   media/logo-light.svg      black symbol, for editor tabs and the chat participant on light themes
//   media/logo-dark.svg       white symbol, for dark themes
//   media/archery-icons.woff  icon font, so the status bar / commands can show $(archery-logo) in the theme's colour
// Run with: npm run icon
import { Resvg } from '@resvg/resvg-js';
import { readFileSync, writeFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import { SVGIcons2SVGFontStream } from 'svgicons2svgfont';
import svg2ttf from 'svg2ttf';
import ttf2woff from 'ttf2woff';

const svg = readFileSync('media/icon.svg', 'utf8');

const path = /<path[^>]*\/>/.exec(svg)[0];
// The symbol itself in colour, without a tile: mid-tone teal rings and an amber arrow, light enough for dark themes
// and dark enough for light ones. The path holds the outer ring, the inner ring and the arrow, each starting with M.
const [outer, inner, arrow] = /\sd="([^"]+)"/.exec(path)[1].split(/ (?=M)/);
const TEAL = { light: '#33B3D0', deep: '#147A94' };
const AMBER = { light: '#F6A623', deep: '#DB7608' };
const gradient = (id, { light, deep }) =>
  `<linearGradient id="${id}" x1="2" y1="0" x2="22" y2="22" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${light}"/><stop offset="1" stop-color="${deep}"/></linearGradient>`;
// Centred on the rings (their centre in icon.svg); the half-size leaves room for the arrow's feathers (lower left).
const RINGS = { x: 14, y: 10 };
const HALF = 12.2;
const colored = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${RINGS.x - HALF} ${RINGS.y - HALF} ${2 * HALF} ${2 * HALF}" width="24" height="24">
  <defs>${gradient('teal', TEAL)}${gradient('amber', AMBER)}</defs>
  <path fill="url(#teal)" d="${outer}"/>
  <path fill="url(#teal)" d="${inner}"/>
  <path fill="url(#amber)" d="${arrow}"/>
</svg>`;
const png = new Resvg(colored, { fitTo: { mode: 'width', value: 256 }, background: 'rgba(0,0,0,0)' }).render().asPng();
writeFileSync('media/icon.png', png);
const logo = (fill) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16">${path.replace(/fill="[^"]*"/, `fill="${fill}"`)}</svg>
`;
writeFileSync('media/logo-light.svg', logo('#000000'));
writeFileSync('media/logo-dark.svg', logo('#FFFFFF'));

const fontSvg = await new Promise((resolve, reject) => {
  const font = new SVGIcons2SVGFontStream({ fontName: 'archery-icons', normalize: true, fontHeight: 1000, log: () => {} });
  let out = '';
  font.on('data', (chunk) => (out += chunk));
  font.on('end', () => resolve(out));
  font.on('error', reject);
  const glyph = Readable.from([svg]);
  glyph.metadata = { name: 'archery-logo', unicode: [''] };
  font.write(glyph);
  font.end();
});
const ttf = svg2ttf(fontSvg, {});
const woff = ttf2woff(new Uint8Array(ttf.buffer));
writeFileSync('media/archery-icons.woff', Buffer.from(woff.buffer ?? woff));
console.log(`media/icon.png ${png.length} bytes, media/archery-icons.woff ${(woff.buffer ?? woff).byteLength} bytes`);
