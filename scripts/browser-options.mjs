// Browser selection for tests and maintainer scripts. CI uses installed Edge (the default);
// set RYODEV_BROWSER_PATH to a Chromium executable elsewhere (e.g. a cloud container).
export const browserOptions = () => process.env.RYODEV_BROWSER_PATH
  ? { executablePath: process.env.RYODEV_BROWSER_PATH }
  : { channel: process.env.RYODEV_BROWSER_CHANNEL ?? 'msedge' };
