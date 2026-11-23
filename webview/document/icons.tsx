// Icons for the document: VS Code codicons where one fits, small inline SVGs (drawn at the codicons'
// weight) for the rest.
import { codicon } from '../shared/codicon';
const svg = (d: string, filled = false) =>
  function Icon() {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden fill={filled ? 'currentColor' : 'none'} stroke={filled ? 'none' : 'currentColor'} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
        <path d={d} />
      </svg>
    );
  };

export const IconEdit = codicon('edit');
export const IconMaximize = codicon('screen-full');
export const IconCollapse = codicon('chevron-down');
export const IconReset = codicon('discard');
export const IconRemove = codicon('close');
export const IconInfo = codicon('info');
export const IconOpen = codicon('link-external');
export const IconClose = IconRemove;
export const IconFit = svg('M2.5 6V2.5H6 M10 2.5h3.5V6 M13.5 10v3.5H10 M6 13.5H2.5V10');
/** Fill: stretch to every edge. */
export const IconFill = svg('M8 1.5v13 M1.5 8h13 M6 3.5l2-2 2 2 M6 12.5l2 2 2-2 M3.5 6l-2 2 2 2 M12.5 6l2 2-2 2');
/** Actual size, "1:1". */
export const IconActualSize = svg('M3.5 5l1.5-1.2V12 M10.5 5L12 3.8V12 M8 6.8v.01 M8 9.8v.01');
/** Center: a target with ticks. */
export const IconCenter = svg('M8 10.2a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4z M8 1.5V4 M8 12v2.5 M1.5 8H4 M12 8h2.5');
/** Add a subsection: an elbow and a plus. */
export const IconAddChild = svg('M3 2.5V8h4 M11.5 5v6 M8.5 8h6');
/** Promote (one level up) and demote (one level down). */
export const IconPromote = codicon('arrow-left');
export const IconDemote = codicon('arrow-right');
export const IconPlus = codicon('add');
export const IconMinus = codicon('remove');

// --- toolbar icons (16 px, stroke) ----------------------------------------------------------
const tb = (body: React.ReactNode) =>
  function Icon() {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
        {body}
      </svg>
    );
  };

export const IconBold = codicon('bold');
export const IconItalic = codicon('italic');
export const IconStrike = tb(<path d="M2.5 8h11 M11 4.6C10.4 3.6 9.3 3 8 3 6.3 3 5 3.9 5 5.2c0 .9.5 1.6 1.4 2 M5 11.4C5.6 12.4 6.7 13 8 13c1.7 0 3-.9 3-2.3 0-.5-.2-1-.5-1.4" />);
export const IconCode = codicon('code');
export const IconLink = codicon('link');
export const IconClear = codicon('clear-all');
export const IconBulletList = codicon('list-unordered');
export const IconOrderedList = codicon('list-ordered');
export const IconIndent = codicon('indent');
export const IconOutdent = codicon('indent', { transform: 'scaleX(-1)' });
export const IconQuote = codicon('quote');
export const IconCodeBlock = codicon('file-code');
export const IconRule = codicon('horizontal-rule');
export const IconTable = codicon('table');
export const IconImage = codicon('file-media');
export const IconDiagram = codicon('type-hierarchy');
export const IconUndo = codicon('discard');
export const IconRedo = codicon('redo');
export const IconChevron = codicon('chevron-down');
export const IconRowAbove = tb(<><rect x="1.8" y="7.5" width="12.4" height="6" rx="1" /><path d="M8 1.8v4 M6 3.8h4" /></>);
export const IconRowBelow = tb(<><rect x="1.8" y="2.5" width="12.4" height="6" rx="1" /><path d="M8 10.2v4 M6 12.2h4" /></>);
export const IconColLeft = tb(<><rect x="7.5" y="1.8" width="6" height="12.4" rx="1" /><path d="M1.8 8h4 M3.8 6v4" /></>);
export const IconColRight = tb(<><rect x="2.5" y="1.8" width="6" height="12.4" rx="1" /><path d="M10.2 8h4 M12.2 6v4" /></>);
export const IconUp = codicon('arrow-up');
export const IconDown = codicon('arrow-down');
export const IconLeft = codicon('arrow-left');
export const IconRight = codicon('arrow-right');
export const IconDeleteRow = tb(<><rect x="1.8" y="5" width="12.4" height="6" rx="1" /><path d="M6 6.8l4 2.4 M10 6.8l-4 2.4" /></>);
export const IconDeleteCol = tb(<><rect x="5" y="1.8" width="6" height="12.4" rx="1" /><path d="M6.8 6l2.4 4 M9.2 6l-2.4 4" /></>);
export const IconDeleteTable = tb(<><rect x="1.8" y="2.5" width="12.4" height="11" rx="1.2" /><path d="M5.5 5.8l5 4.4 M10.5 5.8l-5 4.4" /></>);
export const IconMerge = tb(<><rect x="1.8" y="3" width="12.4" height="10" rx="1" /><path d="M4.5 8h2.2 M5.6 6.8L6.8 8 5.6 9.2 M11.5 8H9.3 M10.4 6.8L9.2 8l1.2 1.2" /></>);
export const IconSplit = tb(<><rect x="1.8" y="3" width="12.4" height="10" rx="1" /><path d="M8 3v10 M6.6 8H4.2 M5.2 6.8L4 8l1.2 1.2 M9.4 8h2.4 M10.8 6.8L12 8l-1.2 1.2" /></>);
export const IconPlusSmall = codicon('add');
export const IconGrip = codicon('gripper');
