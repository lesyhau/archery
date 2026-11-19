// Builds the icon assets from media/icon.svg (white on transparent, filled shapes only):
//   media/icon.png            extension icon (Marketplace, Extensions view): the white symbol on a rounded tile in
//                             Proxyma's brand colours (a PNG cannot follow the theme)
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
// The white symbol on a rounded tile in Proxyma's brand ramp (primary #164E63): a diagonal gradient lit from
// the top left, plus Proxyma's soft sheen. The tile reads on light and dark backgrounds alike.
const RAMP = { light: '#42A7CD', mid: '#2A8CB2', deep: '#206F8D' };
/** The rings' centre in icon.svg (the arrow tip); the tile centres it, the arrow reaches into the lower left. */
const RINGS = { x: 14, y: 10 };
const SCALE = 0.75;
const colored = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">
  <defs>
    <linearGradient id="ramp" x1="0.1" y1="0" x2="0.9" y2="1">
      <stop offset="0" stop-color="${RAMP.light}"/><stop offset="0.5" stop-color="${RAMP.mid}"/><stop offset="1" stop-color="${RAMP.deep}"/>
    </linearGradient>
    <linearGradient id="sheen" x1="0.08" y1="0" x2="0.92" y2="1">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.20"/><stop offset="0.42" stop-color="#ffffff" stop-opacity="0.03"/>
      <stop offset="0.58" stop-color="#000000" stop-opacity="0.03"/><stop offset="1" stop-color="#000000" stop-opacity="0.18"/>
    </linearGradient>
  </defs>
  <rect width="24" height="24" rx="5" fill="url(#ramp)"/>
  <rect width="24" height="24" rx="5" fill="url(#sheen)"/>
  <g transform="translate(${12 - RINGS.x * SCALE} ${12 - RINGS.y * SCALE}) scale(${SCALE})">${path.replace(/fill="[^"]*"/, 'fill="#FFFFFF"')}</g>
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
