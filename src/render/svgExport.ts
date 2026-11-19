// Serializes a diagram scene to a standalone SVG document (for export and the docx/PDF build).
import { FONT_SIZE, strokeWidthOf, textWidth, type Paint, type Prim, type Scene } from './scene';

export type ExportTheme = 'light' | 'dark';

const PALETTE: Record<ExportTheme, Record<Paint, string> & { background: string }> = {
  light: { none: 'none', surface: '#ffffff', alt: '#f2f2f2', node: '#f1f2f4', ink: '#1f1f1f', muted: '#8a8a8a', error: '#d1242f', background: '#ffffff' },
  dark: { none: 'none', surface: '#1f1f1f', alt: '#2b2b2b', node: '#2c2d30', ink: '#d4d4d4', muted: '#8a8a8a', error: '#f85149', background: '#1f1f1f' },
};

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** link: where a drill-down marker points (e.g. "#diagram-…"); markers without one are not links. */
function prim(p: Prim, c: Record<Paint, string>, link?: (file: string) => string | undefined): string {
  const stroke = (s?: Paint) => `stroke="${c[s ?? 'ink']}"`;
  const dash = (d?: boolean) => (d ? ' stroke-dasharray="6 4"' : '');
  switch (p.t) {
    case 'rect': {
      if (p.link) {
        const href = link?.(p.link);
        return href ? `<a href="${esc(href)}"><title>Shown in detail</title><rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" fill="transparent" stroke="none"/></a>` : '';
      }
      return `<rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}"${p.rx ? ` rx="${p.rx}"` : ''} fill="${c[p.fill ?? 'none']}" ${stroke(p.stroke)}${dash(p.dashed)}/>`;
    }
    case 'line':
      if (p.dotted) return `<line x1="${p.x1}" y1="${p.y1}" x2="${p.x2}" y2="${p.y2}" ${stroke(p.stroke)} stroke-dasharray="0.5 3" stroke-linecap="round" stroke-width="1.4"/>`;
      return `<line x1="${p.x1}" y1="${p.y1}" x2="${p.x2}" y2="${p.y2}" ${stroke(p.stroke)}${dash(p.dashed)}/>`;
    case 'path':
      return `<path d="${p.d}" fill="${c[p.fill ?? 'none']}" ${stroke(p.stroke)}${dash(p.dashed)} stroke-linejoin="round"/>`;
    case 'circle':
      return `<circle cx="${p.cx}" cy="${p.cy}" r="${p.r}" fill="${c[p.fill ?? 'none']}" ${stroke(p.stroke)}/>`;
    case 'ellipse':
      return `<ellipse cx="${p.cx}" cy="${p.cy}" rx="${p.rx}" ry="${p.ry}" fill="${c[p.fill ?? 'none']}" ${stroke(p.stroke)}${dash(p.dashed)}/>`;
    case 'text': {
      const size = p.size ?? FONT_SIZE;
      const attrs = [
        `x="${p.x}"`,
        `y="${p.y}"`,
        `font-size="${size}"`,
        `text-anchor="${p.anchor ?? 'start'}"`,
        `fill="${c[p.fill ?? 'ink']}"`,
        p.bold ? 'font-weight="600"' : '',
        p.italic ? 'font-style="italic"' : '',
        p.underline ? 'text-decoration="underline"' : '',
      ].filter(Boolean);
      const text = `<text ${attrs.join(' ')} stroke="none">${esc(p.text)}</text>`;
      if (!p.halo) return text;
      const w = textWidth(p.text, size, p.bold) + 8;
      const x = p.anchor === 'middle' ? p.x - w / 2 : p.anchor === 'end' ? p.x - w : p.x - 4;
      return `<rect x="${x}" y="${p.y - size}" width="${w}" height="${size + 5}" rx="3" fill="${c.surface}" stroke="none"/>${text}`;
    }
  }
}

export function sceneToSvg(scene: Scene, options: { theme?: ExportTheme; title?: string; background?: boolean; link?: (file: string) => string | undefined } = {}): string {
  const c = PALETTE[options.theme ?? 'light'];
  const bg = options.background === false ? '' : `<rect width="100%" height="100%" fill="${c.background}" stroke="none"/>`;
  const title = options.title ? `<title>${esc(options.title)}</title>` : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${scene.width}" height="${scene.height}" viewBox="0 0 ${scene.width} ${scene.height}" font-family="'Segoe UI', Helvetica, Arial, sans-serif" stroke-width="${strokeWidthOf(scene.style)}"${scene.style === 'modern' ? ' stroke-linecap="round"' : ''}>${title}
${bg}
${scene.prims.map((p) => prim(p, c, options.link)).filter(Boolean).join('\n')}
</svg>
`;
}
