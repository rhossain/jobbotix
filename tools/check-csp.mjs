// Fails when the production index.html needs something the site's
// Content-Security-Policy (apps/web/public/_headers) blocks: an inline
// <script> or an inline event handler such as onload="...". Browsers drop
// those silently, so the page loads without its styles or behaviour.
// Run after `nx build web`.
import { readFileSync } from 'node:fs';

const dir = process.argv[2] ?? 'dist/apps/web/browser';
const html = readFileSync(`${dir}/index.html`, 'utf8');
const headers = readFileSync(`${dir}/_headers`, 'utf8');

const csp = /Content-Security-Policy:\s*(.+)/i.exec(headers)?.[1] ?? '';
const scriptSrc = /script-src([^;]*)/.exec(csp)?.[1] ?? '';
if (scriptSrc.includes("'unsafe-inline'")) process.exit(0);

const problems = [];
for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
  if (!/\bsrc=/.test(m[1]) && m[2].trim())
    problems.push(`inline <script>: ${m[2].trim().slice(0, 80)}`);
}
for (const m of html.matchAll(/<[a-z][^>]*\s(on[a-z]+)=/gi))
  problems.push(`inline ${m[1]}= handler: ${m[0].slice(0, 80)}`);

if (problems.length) {
  console.error(
    `index.html needs inline script, which the CSP (script-src${scriptSrc}) blocks:\n  ` +
      problems.join('\n  '),
  );
  process.exit(1);
}
console.log('index.html runs under the CSP: no inline scripts or handlers');
