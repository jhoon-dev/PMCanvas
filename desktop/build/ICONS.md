# Desktop icon source

`build/icon-source.png` is the shared opaque 1024px master for Windows, macOS,
iPhone and Android. It retains the existing Windows atom artwork supplied with
Electron 45.1.0. The master is the previously generated iPhone artwork with its
opaque background, now used by every platform at the user's request.

`build/icon-settings.json` defines the shared background, `#2c2e3a`. Icons have
no transparent pixels, so wallpaper and operating-system themes do not change
their background. Windows ICO contains 16, 20, 24, 32, 40, 48, 64, 128 and 256px
PNG frames. Mac and iPhone use byte-identical copies of the master. Store tiles
and Android adaptive background use the same color; OS icon masks may differ.

Install mobile development dependencies and Playwright Chromium, then run
`npm run prepare:icons` at the repository root to refresh all platforms, launch
screens, in-app branding and web favicon. The desktop command delegates to the
same generator for desktop outputs only. Run `npm run verify:icons` to check
actual pixel opacity, background colors, dimensions, ICO frames and shared
source copies. `npm --prefix mobile run verify:icons -- --preview` also produces
a comparison under `test-results/icon-backgrounds/preview.png`.

Keep the master separate from generated output: regeneration never reads its
own ICO or resized PNGs. Android keeps the symbol within its adaptive safe area.
Do not reintroduce a separate P monogram or web logo.

The artwork is supplied with Electron. Its copyright and license are preserved
in `LICENSE.electron.txt` in packaged distributions and below.

Copyright (c) Electron contributors
Copyright (c) 2013-2020 GitHub Inc.

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
