// Names in zips made by old Windows and DOS tools are stored in a local code page with no marker.
// 7-Zip's WebAssembly build can't convert code pages, so web-pak reads the raw names from the
// zip's central directory and decodes them here: UTF-8 when the zip says so, otherwise the chosen
// encoding, or (auto) UTF-8 when the bytes are valid UTF-8 and DOS code page 437 when not.

const CP437_HIGH = 'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ';
const cp437 = (b: Uint8Array) => Array.from(b, x => (x < 128 ? String.fromCharCode(x) : CP437_HIGH[x - 128])).join('');

export interface RawName { raw: Uint8Array; utf8: boolean }

/** The raw names from a zip's central directory, in order; null when it isn't a plain zip */
export async function zipRawNames(blob: Blob): Promise<RawName[] | null> {
  const tailLen = Math.min(blob.size, 65557);
  const tail = new Uint8Array(await blob.slice(blob.size - tailLen).arrayBuffer());
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) if (tail[i] === 0x50 && tail[i + 1] === 0x4b && tail[i + 2] === 0x05 && tail[i + 3] === 0x06) { eocd = i; break; }
  if (eocd < 0) return null;
  const dv = new DataView(tail.buffer, tail.byteOffset);
  const count = dv.getUint16(eocd + 10, true), size = dv.getUint32(eocd + 12, true), offset = dv.getUint32(eocd + 16, true);
  if (offset === 0xffffffff || size === 0xffffffff || offset + size > blob.size) return null; // zip64: leave names to 7-Zip
  const cd = new Uint8Array(await blob.slice(offset, offset + size).arrayBuffer()), cv = new DataView(cd.buffer);
  const names: RawName[] = [];
  let p = 0;
  for (let i = 0; i < count && p + 46 <= cd.length; i++) {
    if (cv.getUint32(p, true) !== 0x02014b50) return null;
    const flags = cv.getUint16(p + 8, true), n = cv.getUint16(p + 28, true), x = cv.getUint16(p + 30, true), c = cv.getUint16(p + 32, true);
    names.push({ raw: cd.slice(p + 46, p + 46 + n), utf8: !!(flags & 0x800) });
    p += 46 + n + x + c;
  }
  return names;
}

export function decodeName(name: RawName, encoding = 'auto'): string {
  const ascii = name.raw.every(b => b < 128);
  if (ascii || name.utf8 || encoding === 'utf-8') return new TextDecoder().decode(name.raw);
  if (encoding === 'auto') {
    try { return new TextDecoder('utf-8', { fatal: true }).decode(name.raw); } catch { return cp437(name.raw); }
  }
  if (encoding === 'cp437') return cp437(name.raw);
  try { return new TextDecoder(encoding).decode(name.raw); } catch { return cp437(name.raw); }
}

/** True when some name has non-ASCII bytes and no UTF-8 flag: worth offering an encoding choice */
export const needsEncoding = (names: RawName[]) => names.some(n => !n.utf8 && n.raw.some(b => b >= 128));
