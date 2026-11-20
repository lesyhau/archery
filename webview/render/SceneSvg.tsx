import type { CSSProperties } from 'react';
import { FONT_SIZE, strokeWidthOf, textWidth, type DiagramStyle, type Paint, type Prim, type Scene } from '../../src/render/scene';

const COLOR: Record<Paint, string> = {
  none: 'none',
  surface: 'var(--diagram-surface)',
  alt: 'var(--diagram-alt)',
  node: 'color-mix(in srgb, var(--diagram-ink) 7%, var(--diagram-surface))',
  ink: 'var(--diagram-ink)',
  muted: 'var(--diagram-muted)',
  error: 'var(--vscode-errorForeground, #f14c4c)',
};

/** onLink: makes drill-down markers clickable (without it they are not interactive). */
export function drawPrim(p: Prim, key: number, style?: DiagramStyle, onLink?: (file: string) => void) {
  const stroke = (s?: Paint) => COLOR[s ?? 'ink'];
  // Modern: round line ends.
  const cap = style === 'modern' ? 'round' : undefined;
  const dash = (d?: boolean) => (d ? '6 4' : undefined);
  switch (p.t) {
    case 'rect':
      if (p.link) {
        const file = p.link;
        if (!onLink) return null;
        return (
          <rect
            key={key}
            className="scene-link nodrag nopan"
            data-link={file}
            x={p.x}
            y={p.y}
            width={p.w}
            height={p.h}
            rx={3}
            fill="transparent"
            stroke="none"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onLink(file);
            }}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            <title>Open detail diagram</title>
          </rect>
        );
      }
      return <rect key={key} x={p.x} y={p.y} width={p.w} height={p.h} rx={p.rx} fill={COLOR[p.fill ?? 'none']} stroke={stroke(p.stroke)} strokeDasharray={dash(p.dashed)} />;
    case 'line':
      if (p.dotted) return <line key={key} x1={p.x1} y1={p.y1} x2={p.x2} y2={p.y2} stroke={stroke(p.stroke)} strokeDasharray="0.5 3" strokeLinecap="round" strokeWidth={1.4} />;
      return <line key={key} x1={p.x1} y1={p.y1} x2={p.x2} y2={p.y2} stroke={stroke(p.stroke)} strokeDasharray={dash(p.dashed)} strokeLinecap={cap} />;
    case 'path':
      return <path key={key} d={p.d} fill={COLOR[p.fill ?? 'none']} stroke={stroke(p.stroke)} strokeDasharray={dash(p.dashed)} strokeLinejoin="round" strokeLinecap={cap} />;
    case 'circle':
      return <circle key={key} cx={p.cx} cy={p.cy} r={p.r} fill={COLOR[p.fill ?? 'none']} stroke={stroke(p.stroke)} />;
    case 'ellipse':
      return <ellipse key={key} cx={p.cx} cy={p.cy} rx={p.rx} ry={p.ry} fill={COLOR[p.fill ?? 'none']} stroke={stroke(p.stroke)} strokeDasharray={dash(p.dashed)} />;
    case 'text': {
      const size = p.size ?? FONT_SIZE;
      const text = (
        <text
          x={p.x}
          y={p.y}
          textAnchor={p.anchor ?? 'start'}
          fontSize={size}
          fontWeight={p.bold ? 600 : 400}
          fontStyle={p.italic ? 'italic' : undefined}
          textDecoration={p.underline ? 'underline' : undefined}
          fill={COLOR[p.fill ?? 'ink']}
        >
          {p.text}
        </text>
      );
      if (!p.halo) return <g key={key}>{text}</g>;
      const w = textWidth(p.text, size, p.bold) + 8;
      const x = p.anchor === 'middle' ? p.x - w / 2 : p.anchor === 'end' ? p.x - w : p.x - 4;
      return (
        <g key={key}>
          <rect x={x} y={p.y - size} width={w} height={size + 5} rx={3} fill={COLOR.surface} />
          {text}
        </g>
      );
    }
  }
}

export function SceneSvg({ scene, style, label, onLink }: { scene: Scene; style?: CSSProperties; label?: string; onLink?: (file: string) => void }) {
  return (
    <svg
      className="scene"
      viewBox={`0 0 ${scene.width} ${scene.height}`}
      width={scene.width}
      height={scene.height}
      role="img"
      aria-label={label}
      preserveAspectRatio="xMidYMin meet"
      style={style}
      strokeWidth={strokeWidthOf(scene.style)}
    >
      {scene.prims.map((p, i) => drawPrim(p, i, scene.style, onLink))}
    </svg>
  );
}
