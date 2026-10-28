// Local, disposable walkthrough. This never loads the production .env or database.
process.env.RUN_MAIL_ADMIN_PREVIEW = '1';
process.env.RUN_REGISTRATION_REVIEW_PREVIEW = '1';
process.env.RUN_WORKSPACE_PREVIEW = '1';
process.env.RUN_WALKTHROUGH_PREVIEW = '1';
await import('../test/support/mail-admin-preview.mjs');
console.log('Demo mailbox: http://localhost:4182/inbox');
console.log('In-memory data expires in one hour. Stop with Ctrl+C.');
