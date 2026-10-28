// The browser suite starts a private MemoryRepository and loopback TLS mailbox only.
import { existsSync, unlinkSync } from 'node:fs';
const credential = new URL('../../releases/.browser-admin-recovery.json', import.meta.url);
const clean = () => {
  if (existsSync(credential)) unlinkSync(credential);
};
clean();
process.once('exit', clean);
process.env.RUN_MAIL_ADMIN_PREVIEW = '1';
process.env.RUN_REGISTRATION_REVIEW_PREVIEW = '1';
process.env.RUN_WORKSPACE_PREVIEW = '1';
process.env.RUN_WALKTHROUGH_PREVIEW = '1';
process.env.PM_PREVIEW_PORT = '4193';
process.env.PM_PREVIEW_MAIL_PORT = '4192';
await import('./mail-admin-preview.mjs');
