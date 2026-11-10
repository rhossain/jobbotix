/**
 * Getting a posting into Jobbotix from wherever the user is reading it:
 * the phone's share sheet (the installed app is a share target) and a
 * bookmarklet that sends the page's link and text from any desktop browser.
 */

const URL_IN_TEXT = /https?:\/\/[^\s<>"']+/i;

export interface Captured {
  url: string;
  /** Posting text worth keeping; '' when it is only a title or the link. */
  text: string;
}

/**
 * What a share sheet hands over, as /roles/new?url=&text=&title=. Android
 * often puts the link inside `text` ("Senior Angular Engineer https://…"),
 * so the first link in the text stands in for a missing `url`.
 */
export function readShared(p: {
  url?: string | null;
  text?: string | null;
  title?: string | null;
}): Captured {
  const text = (p.text ?? '').trim();
  let url = (p.url ?? '').trim();
  if (!/^https?:\/\//i.test(url)) url = text.match(URL_IN_TEXT)?.[0] ?? '';
  url = url.replace(/[).,;]+$/, '');
  const rest = text.replace(url, '').trim();
  // a title or a sentence is not a posting; the page will be read instead
  return { url, text: rest.length >= 400 ? rest : '' };
}

/** The message the bookmarklet posts to the Add role window. */
export interface PostingMessage {
  type: 'jobbotix-posting';
  url: string;
  title: string;
  text: string;
}

/**
 * Accepts a posting only from the window that opened this one, and only
 * when it came from the page it describes.
 */
export function acceptPosting(
  data: unknown,
  origin: string,
): PostingMessage | null {
  if (!data || typeof data !== 'object') return null;
  const m = data as Partial<PostingMessage>;
  if (m.type !== 'jobbotix-posting' || typeof m.url !== 'string') return null;
  let pageOrigin = '';
  try {
    pageOrigin = new URL(m.url).origin;
  } catch {
    return null;
  }
  if (pageOrigin !== origin || !/^https?:$/.test(new URL(m.url).protocol))
    return null;
  return {
    type: 'jobbotix-posting',
    url: m.url,
    title: String(m.title ?? '').slice(0, 300),
    text: String(m.text ?? '').slice(0, 50_000),
  };
}

/**
 * The bookmarklet: opens Add role in a new tab and posts the page's link,
 * title and text to it (the selection when there is one), so pages behind a
 * sign-in such as LinkedIn work too. It retries for a few seconds while the
 * app loads; the app takes the first message only.
 */
export function bookmarklet(appOrigin: string): string {
  const target = JSON.stringify(appOrigin);
  const src = `(()=>{const o=${target};const d={type:'jobbotix-posting',url:location.href,title:document.title,text:(String(getSelection())||document.body.innerText||'').slice(0,50000)};const w=window.open(o+'/roles/new?via=bookmarklet&url='+encodeURIComponent(location.href),'jobbotix');if(!w){location.href=o+'/roles/new?url='+encodeURIComponent(location.href);return}let n=0;const t=setInterval(()=>{try{w.postMessage(d,o)}catch(e){}if(++n>25)clearInterval(t)},400)})()`;
  return `javascript:${encodeURIComponent(src)}`;
}
