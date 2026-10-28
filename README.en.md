# PM Canvas

The repository separates two products and their shared source.

| Directory                     | Purpose                                            |
| ----------------------------- | -------------------------------------------------- |
| [web/](web/README.en.md)      | Self-hosted Node.js and PostgreSQL web application |
| [desktop/](desktop/README.md) | Offline Windows and macOS application              |
| [shared/](shared/README.md)   | Shared calculations, validation, and reusable UI   |
| .github/                      | Product-specific CI and desktop packaging          |

Install dependencies inside each product. The root package only forwards development commands. Existing web configuration, keys, backups, documentation and operational scripts now live under `web/`. Run web administration commands there. The Compose project keeps the existing default name `pmcanvas`.

See the product READMEs for development, testing and packaging. Windows checks cover the earlier current-user 0.2.0 installation lifecycle. For 0.7.0, Windows x64 and macOS arm64 CI verify unit, screen, date/language and native workflows in both development and packaged apps. Certificate-backed signing/notarization and the new installers' system installation/update lifecycle remain separate release checks; see [signing setup](desktop/SIGNING.md). Existing web installations should follow the [data-preserving upgrade instructions](web/docs/DEPLOYMENT.md).
