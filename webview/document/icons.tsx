// Small inline icons (no icon font in the webview).
const svg = (d: string, filled = false) =>
  function Icon() {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden fill={filled ? 'currentColor' : 'none'} stroke={filled ? 'none' : 'currentColor'} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
        <path d={d} />
      </svg>
    );
  };

export const IconEdit = svg('M10.5 2.5l3 3L6 13H3v-3z M9 4l3 3');
export const IconMaximize = svg('M9.5 2.5h4v4 M13.5 2.5L9 7 M6.5 13.5h-4v-4 M2.5 13.5L7 9');
export const IconCollapse = svg('M4 6l4 4 4-4');
export const IconReset = svg('M3 8a5 5 0 1 0 1.5-3.5 M3 2.5v3h3');
export const IconRemove = svg('M4 4l8 8 M12 4l-8 8');
export const IconInfo = svg('M8 14.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13z M8 7.5v4 M8 5v.01');
export const IconOpen = svg('M9 2.5h4.5V7 M13.5 2.5L7.5 8.5 M11.5 9.5v4h-9v-9h4');
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
export const IconPromote = svg('M13 8H4 M7 4.5L3.5 8 7 11.5 M1.5 3v10');
export const IconDemote = svg('M3 8h9 M9 4.5l3.5 3.5L9 11.5 M14.5 3v10');
export const IconPlus = svg('M8 3v10 M3 8h10');
export const IconMinus = svg('M3 8h10');

// --- toolbar icons (16 px, stroke) ----------------------------------------------------------
const tb = (body: React.ReactNode) =>
  function Icon() {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
        {body}
      </svg>
    );
  };

export const IconBold = tb(<path d="M4.5 3h4.2a2.4 2.4 0 0 1 0 4.8H4.5z M4.5 7.8h4.8a2.6 2.6 0 0 1 0 5.2H4.5z" strokeWidth="1.8" />);
export const IconItalic = tb(<path d="M7 3h5 M4 13h5 M9.5 3l-3 10" />);
export const IconStrike = tb(<path d="M2.5 8h11 M11 4.6C10.4 3.6 9.3 3 8 3 6.3 3 5 3.9 5 5.2c0 .9.5 1.6 1.4 2 M5 11.4C5.6 12.4 6.7 13 8 13c1.7 0 3-.9 3-2.3 0-.5-.2-1-.5-1.4" />);
export const IconCode = tb(<path d="M5.5 4.5L2 8l3.5 3.5 M10.5 4.5L14 8l-3.5 3.5" />);
export const IconLink = tb(<path d="M6.5 9.5l3-3 M7 4.6l1.2-1.2a2.9 2.9 0 0 1 4.1 4.1L11.1 8.7 M9 11.4l-1.2 1.2a2.9 2.9 0 0 1-4.1-4.1L4.9 7.3" />);
export const IconClear = tb(<path d="M3 3.5h8 M7 3.5L5.2 12.5 M10 9l4 4 M14 9l-4 4" />);
export const IconBulletList = tb(<><path d="M6 4h8 M6 8h8 M6 12h8" /><circle cx="2.8" cy="4" r=".9" fill="currentColor" stroke="none" /><circle cx="2.8" cy="8" r=".9" fill="currentColor" stroke="none" /><circle cx="2.8" cy="12" r=".9" fill="currentColor" stroke="none" /></>);
export const IconOrderedList = tb(<path d="M6.5 4h7.5 M6.5 8h7.5 M6.5 12h7.5 M2.2 2.8l1-.6v3.3 M2 10.2c.2-.4.6-.6 1-.6.6 0 1 .4 1 .9 0 .8-2 1.5-2 2.5h2" strokeWidth="1.2" />);
export const IconIndent = tb(<path d="M7 4h7 M7 8h7 M7 12h7 M2 5.5L4.5 8 2 10.5" />);
export const IconOutdent = tb(<path d="M7 4h7 M7 8h7 M7 12h7 M4.5 5.5L2 8l2.5 2.5" />);
export const IconQuote = tb(<path d="M3 5.5h3.5v3.2c0 1.8-1 3-2.8 3.3 M9.5 5.5H13v3.2c0 1.8-1 3-2.8 3.3 M3 5.5v3h3.5 M9.5 5.5v3H13" />);
export const IconCodeBlock = tb(<><rect x="1.8" y="2.5" width="12.4" height="11" rx="1.6" /><path d="M6.2 6.2L4.4 8l1.8 1.8 M9.8 6.2L11.6 8l-1.8 1.8" /></>);
export const IconRule = tb(<path d="M2 8h12 M2 4.5h3 M11 4.5h3 M2 11.5h3 M11 11.5h3" />);
export const IconTable = tb(<><rect x="1.8" y="2.5" width="12.4" height="11" rx="1.2" /><path d="M1.8 6.3h12.4 M1.8 9.9h12.4 M6 6.3v7.2 M10 6.3v7.2" /></>);
export const IconImage = tb(<><rect x="1.8" y="2.5" width="12.4" height="11" rx="1.4" /><circle cx="5.5" cy="6.2" r="1.2" /><path d="M2 12l4-4 3 3 2-2 3 3" /></>);
export const IconDiagram = tb(<><rect x="5.5" y="1.8" width="5" height="3.6" rx=".6" /><rect x="1.8" y="10.6" width="5" height="3.6" rx=".6" /><rect x="9.2" y="10.6" width="5" height="3.6" rx=".6" /><path d="M8 5.4v2.6 M4.3 8h7.4 M4.3 8v2.6 M11.7 8v2.6" /></>);
export const IconUndo = tb(<path d="M5.5 3.5L2.5 6.5l3 3 M2.5 6.5H10a3.5 3.5 0 0 1 0 7H6" />);
export const IconRedo = tb(<path d="M10.5 3.5l3 3-3 3 M13.5 6.5H6a3.5 3.5 0 0 0 0 7h4" />);
export const IconChevron = tb(<path d="M4.5 6.5L8 10l3.5-3.5" />);
export const IconRowAbove = tb(<><rect x="1.8" y="7.5" width="12.4" height="6" rx="1" /><path d="M8 1.8v4 M6 3.8h4" /></>);
export const IconRowBelow = tb(<><rect x="1.8" y="2.5" width="12.4" height="6" rx="1" /><path d="M8 10.2v4 M6 12.2h4" /></>);
export const IconColLeft = tb(<><rect x="7.5" y="1.8" width="6" height="12.4" rx="1" /><path d="M1.8 8h4 M3.8 6v4" /></>);
export const IconColRight = tb(<><rect x="2.5" y="1.8" width="6" height="12.4" rx="1" /><path d="M10.2 8h4 M12.2 6v4" /></>);
export const IconUp = tb(<path d="M8 13V3 M4 7l4-4 4 4" />);
export const IconDown = tb(<path d="M8 3v10 M4 9l4 4 4-4" />);
export const IconLeft = tb(<path d="M13 8H3 M7 4L3 8l4 4" />);
export const IconRight = tb(<path d="M3 8h10 M9 4l4 4-4 4" />);
export const IconDeleteRow = tb(<><rect x="1.8" y="5" width="12.4" height="6" rx="1" /><path d="M6 6.8l4 2.4 M10 6.8l-4 2.4" /></>);
export const IconDeleteCol = tb(<><rect x="5" y="1.8" width="6" height="12.4" rx="1" /><path d="M6.8 6l2.4 4 M9.2 6l-2.4 4" /></>);
export const IconDeleteTable = tb(<><rect x="1.8" y="2.5" width="12.4" height="11" rx="1.2" /><path d="M5.5 5.8l5 4.4 M10.5 5.8l-5 4.4" /></>);
export const IconMerge = tb(<><rect x="1.8" y="3" width="12.4" height="10" rx="1" /><path d="M4.5 8h2.2 M5.6 6.8L6.8 8 5.6 9.2 M11.5 8H9.3 M10.4 6.8L9.2 8l1.2 1.2" /></>);
export const IconSplit = tb(<><rect x="1.8" y="3" width="12.4" height="10" rx="1" /><path d="M8 3v10 M6.6 8H4.2 M5.2 6.8L4 8l1.2 1.2 M9.4 8h2.4 M10.8 6.8L12 8l-1.2 1.2" /></>);
export const IconPlusSmall = tb(<path d="M8 4v8 M4 8h8" strokeWidth="1.6" />);
export const IconGrip = tb(<><circle cx="6" cy="4" r=".9" fill="currentColor" stroke="none" /><circle cx="10" cy="4" r=".9" fill="currentColor" stroke="none" /><circle cx="6" cy="8" r=".9" fill="currentColor" stroke="none" /><circle cx="10" cy="8" r=".9" fill="currentColor" stroke="none" /><circle cx="6" cy="12" r=".9" fill="currentColor" stroke="none" /><circle cx="10" cy="12" r=".9" fill="currentColor" stroke="none" /></>);
