// This explicit list is the entire public artifact, not a directory glob.
export const publicFiles = new Map([
  ['index.html', 'text/html; charset=utf-8'],
  ['src/app.js', 'text/javascript; charset=utf-8'],
  ['src/model.js', 'text/javascript; charset=utf-8'],
  ['src/fixtures.js', 'text/javascript; charset=utf-8'],
  ['src/styles.css', 'text/css; charset=utf-8'],
  ['assets/workstation.svg', 'image/svg+xml; charset=utf-8'],
  ['manifest.webmanifest', 'application/manifest+json; charset=utf-8'],
  ['assets/icon.svg', 'image/svg+xml; charset=utf-8'],
  ['assets/apple-touch-icon.png', 'image/png'],
  ['assets/icon-192.png', 'image/png'],
  ['assets/icon-512.png', 'image/png'],
  ['.nojekyll', 'text/plain; charset=utf-8'],
]);

export const staticCsp = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; manifest-src 'self'; connect-src 'none'; object-src 'none'; frame-src 'none'; child-src 'none'; worker-src 'none'; base-uri 'none'; form-action 'none'";
