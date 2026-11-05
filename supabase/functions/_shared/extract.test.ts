import { deepStrictEqual as assertEquals } from 'node:assert';
import {
  detectStack,
  heuristicExtract,
  htmlToText,
  pageTitle,
  parseExtraction,
} from './extract.ts';

const html = `<html><head><title>Senior Angular Engineer at Northwind - Careers</title><style>.x{}</style></head>
<body><nav>Home</nav><script>var a=1</script><h1>Senior Angular Engineer</h1>
<p>Remote, worldwide. Salary $95k - $130k per year.</p><ul><li>Angular 19 &amp; TypeScript</li><li>RxJS, NgRx, SCSS</li></ul>
<footer>© Northwind</footer></body></html>`;

Deno.test('htmlToText drops scripts, styles, nav and footer', () => {
  const t = htmlToText(html);
  assertEquals(t.includes('var a=1'), false);
  assertEquals(t.includes('Home'), false);
  assertEquals(t.includes('Angular 19 & TypeScript'), true);
});

Deno.test('pageTitle reads the title tag', () => {
  assertEquals(
    pageTitle(html),
    'Senior Angular Engineer at Northwind - Careers',
  );
});

Deno.test(
  'heuristicExtract splits title and company and finds salary and stack',
  () => {
    const r = heuristicExtract('https://jobs.northwind.example/123', html);
    assertEquals(r.title, 'Senior Angular Engineer');
    assertEquals(r.company, 'Northwind');
    assertEquals(r.type, 'full_time');
    assertEquals(r.location, 'Remote');
    assertEquals(r.salary.startsWith('$95k'), true);
    assertEquals(r.stack.includes('Angular') && r.stack.includes('NgRx'), true);
  },
);

Deno.test('heuristicExtract falls back to the hostname for the company', () => {
  const r = heuristicExtract(
    'https://www.acme.example/jobs/1',
    '<title>Frontend Developer</title>',
  );
  assertEquals(r.company, 'Acme');
  assertEquals(r.title, 'Frontend Developer');
});

Deno.test('detectStack matches whole words only', () => {
  assertEquals(detectStack('We use React and reactive forms'), ['React']);
});

Deno.test('parseExtraction tolerates prose around the JSON', () => {
  const r = parseExtraction(
    'Sure: {"company":"X","title":"Y","type":"contract","stack":["Vue",3],"salary":""} done',
  );
  assertEquals(r?.company, 'X');
  assertEquals(r?.type, 'contract');
  assertEquals(r?.stack, ['Vue']);
  assertEquals(parseExtraction('no json here'), null);
});

Deno.test(
  'heuristicExtract uses the first line when there is no title tag',
  () => {
    const r = heuristicExtract(
      'https://careers.glassfern.example/jobs/42',
      '<title></title>Senior Angular Developer at Glassfern Labs\nFully remote, worldwide.\nAngular and TypeScript.',
    );
    assertEquals(r.title, 'Senior Angular Developer');
    assertEquals(r.company, 'Glassfern Labs');
  },
);
