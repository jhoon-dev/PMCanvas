# PM Canvas

The repository separates two products and their shared source.

| Directory                     | Purpose                                            |
| ----------------------------- | -------------------------------------------------- |
| [web/](web/README.en.md)      | Self-hosted Node.js and PostgreSQL web application |
| [desktop/](desktop/README.md) | Offline Windows and macOS application              |
| [shared/](shared/README.md)   | Shared calculations, validation, and reusable UI   |
| .github/                      | Product-specific CI and desktop packaging          |

Install dependencies inside each product. The root package only forwards development commands. Existing web configuration, keys, backups, documentation and operational scripts now live under `web/`. Run web administration commands there. The Compose project keeps the existing default name `pmcanvas`.

See the product READMEs for development, testing and packaging. The Windows development app and packaged executable have passed file save/restart and CSV/XLSX workflow checks. System installation of the new 0.2.0 installer, release signing and macOS execution remain unverified. Existing web installations should follow the [data-preserving upgrade instructions](web/docs/DEPLOYMENT.md).
