import { nativeImage, type NativeImage } from "electron";

// A simple ring drawn in code, so the tray works without image assets.
// Replace with a designed icon before release.
export function trayIcon(): NativeImage {
  const size = 32;
  const buf = Buffer.alloc(size * size * 4); // BGRA
  const c = (size - 1) / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - c, y - c);
      const i = (y * size + x) * 4;
      const inDisc = d <= 15;
      const inHole = d <= 7;
      if (inDisc && !inHole) {
        buf[i] = 0xcb; // B
        buf[i + 1] = 0x4a; // G
        buf[i + 2] = 0x2b; // R
        buf[i + 3] = 0xff;
      }
    }
  }
  return nativeImage.createFromBitmap(buf, { width: size, height: size });
}
