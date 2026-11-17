import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { openLinkedInArchive, type PickedFile } from './linkedin-archive';

const SAVED =
  'Saved Date,Job Url,Job Title,Company Name\n"11/14/26, 9:14 AM",https://www.linkedin.com/jobs/view/4012345678,Engineer,Acme\n';

function picked(
  name: string,
  bytes: Uint8Array,
): PickedFile & { reads: number } {
  const f = {
    name,
    size: bytes.length,
    reads: 0,
    read: async () => {
      f.reads++;
      return bytes;
    },
  };
  return f;
}

describe('openLinkedInArchive', () => {
  it('opens only the files Jobbotix reads inside the ZIP', async () => {
    const zip = zipSync({
      'Basic_LinkedInDataExport/Jobs/Saved Jobs.csv': strToU8(SAVED),
      'Basic_LinkedInDataExport/Connections.csv': strToU8(
        '\uFEFFFirst Name,Last Name,URL,Email Address,Company,Position,Connected On\n',
      ),
      'Basic_LinkedInDataExport/messages.csv': strToU8(
        'FROM,TO,CONTENT\na,b,private',
      ),
      'Basic_LinkedInDataExport/Invitations.csv': strToU8('From,To\na,b'),
      'Basic_LinkedInDataExport/Rich_Media/photo.jpg': new Uint8Array([
        1, 2, 3,
      ]),
    });
    const r = await openLinkedInArchive([
      picked('Basic_LinkedInDataExport.zip', zip),
    ]);
    expect(r.problem).toBeUndefined();
    expect(r.files.map((f) => f.name).sort()).toEqual([
      'Basic_LinkedInDataExport/Connections.csv',
      'Basic_LinkedInDataExport/Jobs/Saved Jobs.csv',
    ]);
    expect(r.ignored).toBe(3);
    expect(JSON.stringify(r)).not.toContain('private');
    // the byte-order mark is gone, so the first header is read by name
    expect(
      r.files
        .find((f) => f.name.endsWith('Connections.csv'))
        ?.text.startsWith('First Name'),
    ).toBe(true);
  });

  it('takes CSV files picked one by one, and never reads the others', async () => {
    const saved = picked('Saved Jobs.csv', strToU8(SAVED));
    const messages = picked(
      'messages.csv',
      strToU8('FROM,TO,CONTENT\na,b,private'),
    );
    const r = await openLinkedInArchive([saved, messages]);
    expect(r.files).toEqual([{ name: 'Saved Jobs.csv', text: SAVED }]);
    expect(r.ignored).toBe(1);
    expect(messages.reads).toBe(0);
  });

  it('explains itself when nothing usable was picked', async () => {
    const r = await openLinkedInArchive([
      picked('holiday.jpg', new Uint8Array([1])),
    ]);
    expect(r.files).toEqual([]);
    expect(r.problem).toContain('None of those files');
    const broken = await openLinkedInArchive([
      picked('archive.zip', strToU8('not a zip')),
    ]);
    expect(broken.problem).toContain('could not be opened');
    const huge = picked('archive.zip', new Uint8Array(1));
    huge.size = 400 * 1024 * 1024;
    expect((await openLinkedInArchive([huge])).problem).toContain(
      'over 300 MB',
    );
    expect(huge.reads).toBe(0);
  });
});
