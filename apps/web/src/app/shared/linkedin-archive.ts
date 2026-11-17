import { linkedInFileKind, type LinkedInExportFile } from './linkedin-export';

/**
 * Opening the files a user picks for the LinkedIn import: the ZIP archive
 * LinkedIn emailed them, or single CSV files taken out of it. Everything
 * happens in the browser; the archive is never uploaded or kept.
 *
 * Only the handful of files Jobbotix uses are ever decompressed or decoded
 * (linkedInFileKind decides). Messages, invitations, searches and the rest
 * of the archive stay closed.
 */

/** A picked file: its name and a way to get its bytes. */
export interface PickedFile {
  name: string;
  size: number;
  read: () => Promise<Uint8Array>;
}

export interface OpenedArchive {
  files: LinkedInExportFile[];
  /** Files that were in the pick or the archive and were left unopened. */
  ignored: number;
  /** Why nothing could be read, in words for the user. */
  problem?: string;
}

/** The whole archive is held in memory while it is read. */
export const MAX_ARCHIVE_BYTES = 300 * 1024 * 1024;
/** No CSV Jobbotix reads comes near this, even with 30,000 connections. */
export const MAX_CSV_BYTES = 30 * 1024 * 1024;

const isZip = (name: string) => /\.zip$/i.test(name);
const decode = (bytes: Uint8Array) =>
  new TextDecoder('utf-8').decode(bytes).replace(/^\uFEFF/, '');

export async function openLinkedInArchive(
  picked: PickedFile[],
): Promise<OpenedArchive> {
  const files: LinkedInExportFile[] = [];
  let ignored = 0;
  for (const p of picked) {
    if (isZip(p.name)) {
      if (p.size > MAX_ARCHIVE_BYTES)
        return {
          files: [],
          ignored,
          problem:
            'That archive is over 300 MB. Unzip it on your computer and pick the CSV files instead (Connections, Saved Jobs, Job Applications, Profile, Positions, Education, Skills).',
        };
      let entries: Record<string, Uint8Array>;
      try {
        const { unzipSync } = await import('fflate');
        entries = unzipSync(await p.read(), {
          // decided from the name alone, before anything is decompressed
          filter: (f) => {
            const wanted =
              linkedInFileKind(f.name) !== null &&
              f.originalSize <= MAX_CSV_BYTES;
            if (!wanted && !f.name.endsWith('/')) ignored++;
            return wanted;
          },
        });
      } catch {
        return {
          files: [],
          ignored,
          problem:
            'That ZIP file could not be opened. Download the archive from LinkedIn again, or unzip it and pick the CSV files.',
        };
      }
      for (const [name, bytes] of Object.entries(entries))
        files.push({ name, text: decode(bytes) });
    } else if (linkedInFileKind(p.name) && p.size <= MAX_CSV_BYTES) {
      files.push({ name: p.name, text: decode(await p.read()) });
    } else {
      ignored++;
    }
  }
  if (!files.length)
    return {
      files,
      ignored,
      problem:
        'None of those files is one Jobbotix reads. Pick the ZIP file LinkedIn sent you, or the CSV files inside it: Connections, Saved Jobs, Job Applications, Profile, Positions, Education, Skills.',
    };
  return { files, ignored };
}
