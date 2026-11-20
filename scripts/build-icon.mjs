// Draws the Archery mark (a blueprint: three honeycomb cells that meet in the middle, two built as cubes,
// the top one still a wireframe) and builds every icon asset from it:
//   media/icon.svg            the mark in one colour, white on transparent, filled shapes only (also the activity bar icon)
//   media/activitybar.svg     the same
//   media/icon.png            extension icon (Marketplace, Extensions view): the mark in amber on transparent,
//                             readable on light and dark themes (a PNG cannot follow the theme)
//   media/logo-light.svg      black mark, for editor tabs and the chat participant on light themes
//   media/logo-dark.svg       white mark, for dark themes
//   media/archery-icons.woff  icon font, so the status bar / commands can show $(archery-logo) in the theme's colour
// The geometry lives here and nowhere else; edit it here and run: npm run icon
import { Resvg } from '@resvg/resvg-js';
import { writeFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import { SVGIcons2SVGFontStream } from 'svgicons2svgfont';
import svg2ttf from 'svg2ttf';
import ttf2woff from 'ttf2woff';

const C = 256; // the mark is drawn on a 512 square
const AMBER = { 700: '#B45309', 600: '#D97706', 400: '#FBBF24' };

const n = (v) => String(Math.round(v * 10) / 10);
/** A pointy-top hexagon (a vertex at the top) of circumradius R, clockwise from the top vertex. */
const hexagon = (cx, cy, R) => Array.from({ length: 6 }, (_, k) => [cx + R * Math.cos(((-90 + 60 * k) * Math.PI) / 180), cy + R * Math.sin(((-90 + 60 * k) * Math.PI) / 180)]);

/** A convex polygon (clockwise on screen) with every side moved in by d. */
function inset(pts, d) {
  // Each side's line moved inward (to the right of its direction, for a clockwise polygon with y down)...
  const lines = pts.map((P, i) => {
    const Q = pts[(i + 1) % pts.length];
    const L = Math.hypot(Q[0] - P[0], Q[1] - P[1]);
    const [nx, ny] = [-(Q[1] - P[1]) / L, (Q[0] - P[0]) / L];
    return { P: [P[0] + nx * d, P[1] + ny * d], dir: [(Q[0] - P[0]) / L, (Q[1] - P[1]) / L] };
  });
  // ...and the new corners where neighbouring lines meet.
  return lines.map((a, i) => {
    const b = lines[(i + lines.length - 1) % lines.length];
    const den = b.dir[0] * a.dir[1] - b.dir[1] * a.dir[0];
    const t = ((a.P[0] - b.P[0]) * a.dir[1] - (a.P[1] - b.P[1]) * a.dir[0]) / den;
    return [b.P[0] + b.dir[0] * t, b.P[1] + b.dir[1] * t];
  });
}

/** Path of a convex polygon (clockwise), its sides moved in by gap / 2 and its corners rounded to radius r. */
function rounded(pts, gap, r) {
  const p = inset(pts, gap / 2);
  const corners = p.map((P, i) => {
    const [A, B] = [p[(i + p.length - 1) % p.length], p[(i + 1) % p.length]];
    const a = [A[0] - P[0], A[1] - P[1]];
    const b = [B[0] - P[0], B[1] - P[1]];
    const [la, lb] = [Math.hypot(...a), Math.hypot(...b)];
    const angle = Math.acos(Math.max(-1, Math.min(1, (a[0] * b[0] + a[1] * b[1]) / (la * lb))));
    const t = Math.min(r / Math.tan(angle / 2), la / 2, lb / 2);
    return { s: [P[0] + (a[0] / la) * t, P[1] + (a[1] / la) * t], e: [P[0] + (b[0] / lb) * t, P[1] + (b[1] / lb) * t], r: t * Math.tan(angle / 2) };
  });
  return corners.map((c, i) => `${i ? 'L' : 'M'}${n(c.s[0])} ${n(c.s[1])}A${n(c.r)} ${n(c.r)} 0 0 1 ${n(c.e[0])} ${n(c.e[1])}`).join('') + 'Z';
}

const signedArea = (p) => p.reduce((s, a, i) => s + a[0] * p[(i + 1) % p.length][1] - p[(i + 1) % p.length][0] * a[1], 0) / 2;
/** A line from P to Q drawn as a filled bar of width w with round ends (the icon font takes filled shapes only). */
function bar(P, Q, w) {
  const L = Math.hypot(Q[0] - P[0], Q[1] - P[1]);
  const [nx, ny] = [(-(Q[1] - P[1]) / L) * (w / 2), ((Q[0] - P[0]) / L) * (w / 2)];
  let rect = [[P[0] + nx, P[1] + ny], [Q[0] + nx, Q[1] + ny], [Q[0] - nx, Q[1] - ny], [P[0] - nx, P[1] - ny]];
  if (signedArea(rect) < 0) rect = rect.reverse();
  return rounded(rect, 0, w / 2 - 0.01);
}
/** A dashed line from P to Q: bars of length `dash` with `space` between them, centred along the line. */
function dashes(P, Q, w, dash, space) {
  const L = Math.hypot(Q[0] - P[0], Q[1] - P[1]);
  const count = Math.max(1, Math.floor((L + space) / (dash + space)));
  const start = (L - (count * dash + (count - 1) * space)) / 2;
  const at = (d) => [P[0] + ((Q[0] - P[0]) / L) * d, P[1] + ((Q[1] - P[1]) / L) * d];
  return Array.from({ length: count }, (_, i) => bar(at(start + i * (dash + space) + w / 2), at(start + i * (dash + space) + dash - w / 2), w));
}

/**
 * The mark, a blueprint: three cells whose centres sit one cell radius from the middle (top, lower right,
 * lower left), so each pair shares a side and all three meet in one point, the group centred on the
 * square. The two below are built: cubes seen from above, each hexagon split from its centre into a top,
 * a left and a right face. The one on top is still a drawing: a wireframe cube, its visible edges solid
 * and its hidden edges dashed.
 * `gap` is the room between the cells, `seam` the room between the faces of a cube, `line` and `hidden`
 * the widths of the wireframe's edges: all larger in the one-colour mark, which is drawn at 16 px.
 */
function mark({ gap, seam, line, hidden, dash, space }) {
  const R = 140;
  const dy = R / 4; // the cells span 2R above the middle and 1.5R below it
  const centre = (a) => [C + R * Math.cos((a * Math.PI) / 180), C + dy + R * Math.sin((a * Math.PI) / 180)];
  const faces = { top: [], left: [], right: [] };
  for (const a of [30, 150]) {
    const O = centre(a);
    const v = hexagon(O[0], O[1], R - gap / Math.sqrt(3)); // the cell, its sides moved in by gap / 2
    faces.top.push(rounded([O, v[5], v[0], v[1]], seam, 14));
    faces.right.push(rounded([O, v[1], v[2], v[3]], seam, 14));
    faces.left.push(rounded([O, v[3], v[4], v[5]], seam, 14));
  }
  // The wireframe: its outline inside the cell's (moved in by half a line), the three edges that meet at the
  // near top corner, and dashed, the three that meet at the hidden back corner (both project onto the centre).
  const O = centre(-90);
  const v = hexagon(O[0], O[1], R - gap / Math.sqrt(3) - line / Math.sqrt(3));
  const visible = [...v.map((P, k) => bar(P, v[(k + 1) % 6], line)), ...[1, 3, 5].map((k) => bar(O, v[k], line))];
  const back = [0, 2, 4].flatMap((k) => {
    const L = Math.hypot(v[k][0] - O[0], v[k][1] - O[1]);
    const trim = (t) => [O[0] + ((v[k][0] - O[0]) / L) * t, O[1] + ((v[k][1] - O[1]) / L) * t];
    return dashes(trim(line), trim(L - line), hidden, dash, space); // clear of the solid edges at both ends
  });
  return { faces, visible, back };
}

// One colour: everything in one path; the seams between the faces show the cubes.
const mono = mark({ gap: 40, seam: 26, line: 30, hidden: 22, dash: 44, space: 26 });
const monoPath = (fill) => `<path fill="${fill}" d="${[...mono.faces.top, ...mono.faces.left, ...mono.faces.right, ...mono.visible, ...mono.back].join('')}"/>`;
const monoSvg = (fill, size, comment = '') =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="${size}" height="${size}">${comment}${monoPath(fill)}</svg>\n`;
const iconSvg = monoSvg('#FFFFFF', 24, '\n  <!-- Archery: a blueprint of three honeycomb cells, two built as cubes, one still a wireframe. Generated by scripts/build-icon.mjs; filled shapes only (also an icon-font glyph). -->\n  ');
writeFileSync('media/icon.svg', iconSvg);
writeFileSync('media/activitybar.svg', iconSvg);
writeFileSync('media/logo-light.svg', monoSvg('#000000', 16));
writeFileSync('media/logo-dark.svg', monoSvg('#FFFFFF', 16));

// In colour: the cubes lit from above, so the top faces take the lightest amber, the left faces the middle
// step and the right faces the darkest; the wireframe in the middle step.
const color = mark({ gap: 22, seam: 12, line: 16, hidden: 11, dash: 28, space: 16 });
const colored = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <path fill="${AMBER[400]}" d="${color.faces.top.join('')}"/>
  <path fill="${AMBER[600]}" d="${color.faces.left.join('')}"/>
  <path fill="${AMBER[700]}" d="${color.faces.right.join('')}"/>
  <path fill="${AMBER[600]}" d="${[...color.visible, ...color.back].join('')}"/>
</svg>`;
const png = new Resvg(colored, { fitTo: { mode: 'width', value: 256 }, background: 'rgba(0,0,0,0)' }).render().asPng();
writeFileSync('media/icon.png', png);

const fontSvg = await new Promise((resolve, reject) => {
  const font = new SVGIcons2SVGFontStream({ fontName: 'archery-icons', normalize: true, fontHeight: 1000, log: () => {} });
  let out = '';
  font.on('data', (chunk) => (out += chunk));
  font.on('end', () => resolve(out));
  font.on('error', reject);
  const glyph = Readable.from([iconSvg]);
  glyph.metadata = { name: 'archery-logo', unicode: [String.fromCharCode(0xe001)] }; // package.json: fontCharacter \E001
  font.write(glyph);
  font.end();
});
const ttf = svg2ttf(fontSvg, {});
const woff = ttf2woff(new Uint8Array(ttf.buffer));
writeFileSync('media/archery-icons.woff', Buffer.from(woff.buffer ?? woff));
console.log(`media/icon.png ${png.length} bytes, media/archery-icons.woff ${(woff.buffer ?? woff).byteLength} bytes`);
