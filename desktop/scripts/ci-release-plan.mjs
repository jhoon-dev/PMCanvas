import fs from 'node:fs';
import { releasePlan } from './release-policy.mjs';

const signed = process.env.PM_SIGNED === 'true';
const unsigned = process.env.PM_UNSIGNED === 'true';
const publish = process.env.PM_PUBLISH === 'true';
const recovery = process.env.PM_RELEASE_RUN_ID || '';
if (signed && unsigned) throw Error('Select only one build mode: signed or unsigned.');
if (recovery && !/^\d+$/.test(recovery)) throw Error('release_run must be a numeric run ID.');
if (publish && !signed && !unsigned && !recovery)
  throw Error('Publication requires a signed/unsigned build or a verified release_run.');
const plan = releasePlan({
  mode: signed ? 'signed' : 'unsigned',
  platform: process.env.PM_RELEASE_PLATFORM || 'all',
});
for (const key of ['mode', 'builds', 'installs'])
  fs.appendFileSync(
    process.env.GITHUB_OUTPUT,
    key + '=' + (typeof plan[key] === 'string' ? plan[key] : JSON.stringify(plan[key])) + '\n',
  );
fs.appendFileSync(
  process.env.GITHUB_STEP_SUMMARY,
  `Desktop plan: **${plan.mode}**, platform **${plan.platform}**. ` +
    'Publication requires all selected installation checks and matching artifact evidence.\n',
);
