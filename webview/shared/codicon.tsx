// VS Code's own icon font (codicons), so the webviews' buttons use the same icons as the rest of
// the workbench. Icons with no codicon (UML shapes, table and layout tools) stay as inline SVGs.
import '@vscode/codicons/dist/codicon.css';
import type { CSSProperties } from 'react';

export const codicon = (name: string, style?: CSSProperties) =>
  function Icon() {
    return <span className={`codicon codicon-${name}`} style={style} aria-hidden="true" />;
  };

/** Markup for code that builds the DOM by hand. */
export const codiconHtml = (name: string) => `<span class="codicon codicon-${name}" aria-hidden="true"></span>`;
