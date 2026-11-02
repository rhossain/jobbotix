#!/usr/bin/env node
/**
 * One-off: load the rows from the "Sazzad's Job Pipeline" artifact into
 * Jobbotix through the ingest API, under the account that owns the key.
 *
 * 1. Export the artifact's `jobs` collection to a folder of JSON files
 *    (Claude's ArtifactData "list" with out_dir does this), one file per role,
 *    in the tracker's document shape: company, title, url, source, location,
 *    type, salary, posted, stack, score, aiMatch, status, reasons, gaps,
 *    coverLetter, qa, notes, foundAt.
 * 2. Create an ingest key in Jobbotix (Settings, or the create_ingest_key RPC).
 * 3. Run:
 *      JOBBOTIX_URL=https://<ref>.supabase.co JOBBOTIX_INGEST_KEY=jbx_... \
 *        node tools/migrate-tracker.mjs ./export/jobs
 *
 * Status and notes are not part of the ingest payload (a run must never change
 * them), so the script applies them afterwards with the user's own session if
 * JOBBOTIX_ACCESS_TOKEN (a signed-in user's JWT) and JOBBOTIX_ANON_KEY are set.
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const dir = process.argv[2];
const base = process.env.JOBBOTIX_URL;
const key = process.env.JOBBOTIX_INGEST_KEY;
if (!dir || !base || !key) {
  console.error(
    'usage: JOBBOTIX_URL=... JOBBOTIX_INGEST_KEY=jbx_... node tools/migrate-tracker.mjs <export-dir>',
  );
  process.exit(1);
}

const files = (await readdir(dir)).filter((f) => f.endsWith('.json'));
const docs = [];
for (const f of files) {
  const doc = JSON.parse(await readFile(join(dir, f), 'utf8'));
  if (doc && doc.url && doc.company && doc.title) docs.push(doc);
}
console.log(`read ${docs.length} roles from ${files.length} files`);

const payload = {
  runAt: new Date().toISOString(),
  searched: docs.length,
  roles: docs.map((d) => ({
    company: d.company,
    title: d.title,
    url: d.url,
    source: d.source ?? '',
    location: d.location ?? '',
    type: d.type ?? 'Full-time',
    salary: d.salary ?? '',
    posted: d.posted ?? '',
    stack: d.stack ?? '',
    score: d.score ?? 0,
    aiMatch: d.aiMatch === true,
    reasons: d.reasons ?? [],
    gaps: d.gaps ?? [],
    coverLetter: d.coverLetter ?? '',
    qa: d.qa ?? [],
  })),
};

const res = await fetch(`${base}/functions/v1/ingest-roles`, {
  method: 'POST',
  headers: {
    authorization: `Bearer ${key}`,
    'content-type': 'application/json',
  },
  body: JSON.stringify(payload),
});
const result = await res.json();
console.log('ingest:', res.status, JSON.stringify(result));
if (!res.ok) process.exit(1);

// Optional second pass: carry status and notes across as the user.
const token = process.env.JOBBOTIX_ACCESS_TOKEN;
const anon = process.env.JOBBOTIX_ANON_KEY;
if (token && anon) {
  let applied = 0;
  for (const d of docs) {
    const patch = {};
    if (d.status && d.status !== 'new') patch.status = d.status;
    if (d.notes) patch.notes = d.notes;
    if (!Object.keys(patch).length) continue;
    const r = await fetch(
      `${base}/rest/v1/roles?url=eq.${encodeURIComponent(d.url)}`,
      {
        method: 'PATCH',
        headers: {
          apikey: anon,
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          prefer: 'return=minimal',
        },
        body: JSON.stringify(patch),
      },
    );
    if (r.ok) applied++;
    else console.warn('status/notes not applied for', d.url, r.status);
  }
  console.log(`status/notes applied to ${applied} roles`);
} else {
  console.log(
    'JOBBOTIX_ACCESS_TOKEN not set: statuses and notes left at defaults',
  );
}
