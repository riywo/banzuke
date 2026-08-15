/**
 * Read the dimensions out of PNG bytes (IHDR).
 *
 * Its own module rather than part of render.mjs: this is byte parsing with no renderer in it, so
 * keeping it a leaf lets a caller check an already-rendered sheet without loading takumi.
 */
export function pngSize(png) {
  const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
  return { width: dv.getUint32(16), height: dv.getUint32(20) };
}
