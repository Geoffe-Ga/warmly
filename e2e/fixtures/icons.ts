/**
 * The app's own icons: the only images the service worker may cache.
 *
 * The precache list in `sw.js` names files without a leading slash, and
 * an address in Cache Storage has one, so the pattern allows both.
 */
export const OWN_ICON = /^\/?(icon-[a-z0-9-]+|apple-touch-icon)\.png$/;
