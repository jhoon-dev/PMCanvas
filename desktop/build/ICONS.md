# Desktop icon source

`build/icon.ico` is the unmodified icon resource extracted from the previously tested
Windows 0.8.2 executable (Electron 45.1.0). It contains the original 16, 32, 48
and 256 pixel representations. The existing Windows atom icon is retained at
the user's request.

Run `npm run prepare:icons` in `desktop` to derive the sidebar image, Mac icon
and Windows Store tile images from its original 256 pixel PNG. No new artwork
is drawn. All desktop distribution channels use these same source images.

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
