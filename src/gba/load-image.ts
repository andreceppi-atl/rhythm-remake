// Decode an image for reading its pixels. createImageBitmap decodes in background tabs too, where
// HTMLImageElement.decode() can stay pending until the page is shown (the game then sat on "Loading…").
export async function loadImage(url: string): Promise<ImageBitmap> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} returned ${r.status}`);
  return createImageBitmap(await r.blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
}
