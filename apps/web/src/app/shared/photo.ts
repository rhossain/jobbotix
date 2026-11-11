import { PHOTO } from './resume-templates';

const MAX_UPLOAD = 12 * 1024 * 1024;
/** What the database accepts (resume_photos.data), with room to spare. */
export const MAX_PHOTO_CHARS = 190_000;

/**
 * The largest 3-by-4 box in a picture of that size: centred across, and a
 * quarter of the way down the spare height, because a face sits above the
 * middle of a portrait.
 */
export function portraitCrop(
  width: number,
  height: number,
): { sx: number; sy: number; sw: number; sh: number } {
  const want = PHOTO.pixels.width / PHOTO.pixels.height;
  if (width / height > want) {
    const sw = Math.round(height * want);
    return { sx: Math.round((width - sw) / 2), sy: 0, sw, sh: height };
  }
  const sh = Math.round(width / want);
  return { sx: 0, sy: Math.round((height - sh) * 0.25), sw: width, sh };
}

/**
 * Turns a picked image into the resume photo: cropped to a portrait, shrunk
 * to 360 by 480 and saved as a JPEG data URL of a few tens of kilobytes.
 * It is done in the browser, so the original never leaves the device.
 */
export async function fileToPortrait(file: File): Promise<string> {
  if (!/^image\//.test(file.type))
    throw new Error('That is not a picture. Pick a JPEG or PNG.');
  if (file.size > MAX_UPLOAD)
    throw new Error('That picture is over 12 MB. Pick a smaller one.');
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error(
      'That picture could not be opened. Save it as a JPEG or PNG and try again.',
    );
  }
  try {
    if (bitmap.width < 150 || bitmap.height < 200)
      throw new Error(
        'That picture is too small to print well. Use one at least 300 pixels wide.',
      );
    const canvas = document.createElement('canvas');
    canvas.width = PHOTO.pixels.width;
    canvas.height = PHOTO.pixels.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('This browser could not prepare the picture.');
    // A transparent PNG would turn black as a JPEG.
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingQuality = 'high';
    const { sx, sy, sw, sh } = portraitCrop(bitmap.width, bitmap.height);
    ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.86, 0.75, 0.6]) {
      const data = canvas.toDataURL('image/jpeg', quality);
      if (data.length <= MAX_PHOTO_CHARS) return data;
    }
    throw new Error('That picture could not be made small enough.');
  } finally {
    bitmap.close();
  }
}
