import { fileToPortrait, portraitCrop } from './photo';

describe('portraitCrop', () => {
  it('takes the largest 3-by-4 box, centred across', () => {
    // landscape: full height, the middle of the width
    expect(portraitCrop(1600, 1200)).toEqual({
      sx: 350,
      sy: 0,
      sw: 900,
      sh: 1200,
    });
    // already 3 by 4
    expect(portraitCrop(900, 1200)).toEqual({
      sx: 0,
      sy: 0,
      sw: 900,
      sh: 1200,
    });
  });

  it('keeps the upper part of a tall picture, where the face is', () => {
    // a phone selfie, 9 by 16: 1080 wide needs 1440 of its 1920 height
    const crop = portraitCrop(1080, 1920);
    expect(crop.sw).toBe(1080);
    expect(crop.sh).toBe(1440);
    expect(crop.sy).toBe(120); // a quarter of the 480 spare, not half
    expect(crop.sy + crop.sh).toBeLessThanOrEqual(1920);
  });
});

describe('fileToPortrait', () => {
  it('refuses what is not a picture, or is far too large', async () => {
    await expect(
      fileToPortrait(
        new File(['%PDF-1.4'], 'cv.pdf', { type: 'application/pdf' }),
      ),
    ).rejects.toThrow(/not a picture/);
    const huge = new File([new Uint8Array(13 * 1024 * 1024)], 'me.jpg', {
      type: 'image/jpeg',
    });
    await expect(fileToPortrait(huge)).rejects.toThrow(/over 12 MB/);
  });
});
