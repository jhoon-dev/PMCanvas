const { execFileSync } = require('node:child_process');
const path = require('node:path');

// Use the same renderer and opaque master as the mobile launcher icons.
execFileSync(
  process.execPath,
  [path.join(__dirname, '../../mobile/scripts/prepare-icons.mjs'), '--desktop'],
  {
    stdio: 'inherit',
  },
);
