// Installed Chromium-based browsers (Edge, Chrome, Chromium, Brave), run headless to print the PDF
// export and to measure tables. No VS Code here: the MCP server uses it too.
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** Browsers that can run headless, in order of preference; `configured` (a path) first. */
export function findBrowsers(configured?: string): string[] {
  const list: string[] = configured?.trim() ? [configured.trim()] : [];
  if (process.platform === 'win32') {
    for (const base of [process.env['PROGRAMFILES(X86)'], process.env.PROGRAMFILES, process.env.LOCALAPPDATA]) {
      if (!base) continue;
      list.push(
        join(base, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        join(base, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        join(base, 'Chromium', 'Application', 'chrome.exe'),
        join(base, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
      );
    }
  } else if (process.platform === 'darwin') {
    for (const app of ['Google Chrome', 'Microsoft Edge', 'Chromium', 'Brave Browser']) list.push(`/Applications/${app}.app/Contents/MacOS/${app}`);
  } else {
    for (const bin of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge', 'microsoft-edge-stable', 'brave-browser']) list.push(`/usr/bin/${bin}`);
    list.push('/snap/bin/chromium');
  }
  return [...new Set(list)].filter((p) => existsSync(p));
}

export const NO_BROWSER = 'needs Microsoft Edge, Google Chrome, Chromium or Brave (or set "archery.export.browserPath")';
