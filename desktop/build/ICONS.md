# PM Canvas icon source

`build/icon-source.svg` is the original PM Canvas artwork: a canvas frame, a P
project spine and two staggered schedule bars. It replaces the Electron default
atom artwork to meet Microsoft Store's on-device tile requirements.

The generator renders the vector to the opaque 1024px `icon-source.png` master,
then derives Windows ICO, Store tiles, macOS, mobile and web icons from it.
`build/icon-settings.json` defines the shared background, `#2c2e3a`.
The Windows ICO includes 16, 20, 24, 32, 40, 48, 64, 128 and 256px PNG frames.
Store tiles use the same original artwork at 50, 150 and 44px.

Run `npm run prepare:icons` at the repository root to regenerate all platforms.
Run `npm run verify:icons` to verify dimensions, opacity, background colors,
ICO frames and shared source copies. Add `-- --preview` for a comparison image.
The desktop-only generator updates desktop outputs from the same vector.

Copyright (c) 2026 PM Canvas contributors. Original project artwork.
The old Electron artwork is no longer used; historical Electron license files
remain preserved in the repository.
