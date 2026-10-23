// Legal documents for this fork live in the repository itself, so the in-app links always match the
// shipped code — there is no hosted page to keep in sync, and upstream's pages at axisapp.live
// describe a service this fork does not run.
// In the packaged app we go through the Electron bridge (opens the OS browser, not an in-app window);
// in a plain browser build we fall back to window.open.
const REPO = 'https://github.com/AndriusSak/Axis/blob/main';
export const LEGAL = {
  terms: `${REPO}/legal/terms.md`,
  privacy: `${REPO}/legal/privacy.md`,
  index: `${REPO}/legal/README.md`
} as const;

export function openExternal(url: string): void {
  const d = (globalThis as { axisDesktop?: { openExternal?: (u: string) => void } }).axisDesktop;
  if (d?.openExternal) d.openExternal(url);
  else window.open(url, '_blank', 'noopener,noreferrer');
}
