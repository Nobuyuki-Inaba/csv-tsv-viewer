/**
 * Text decoding for files opened from the Explorer.
 *
 * Uses the platform `TextDecoder` only — no dependency, and `shift_jis` is part
 * of the WHATWG encoding set that Electron ships.
 */

export type EncodingName = 'auto' | 'utf8' | 'shift_jis';

const UTF8_BOM = [0xef, 0xbb, 0xbf];
const UTF16LE_BOM = [0xff, 0xfe];
const UTF16BE_BOM = [0xfe, 0xff];

function startsWith(bytes: Uint8Array, prefix: number[]): boolean {
  return prefix.every((byte, i) => bytes[i] === byte);
}

/**
 * Decode file bytes to text.
 *
 * `auto` honours a BOM first, then tries strict UTF-8 and falls back to
 * Shift_JIS — the common case for Japanese CSV exports, which would otherwise
 * decode into replacement characters.
 */
export function decodeText(bytes: Uint8Array, encoding: EncodingName = 'auto'): string {
  if (encoding === 'utf8') return stripBom(new TextDecoder('utf-8').decode(bytes));
  if (encoding === 'shift_jis') return new TextDecoder('shift_jis').decode(bytes);

  if (startsWith(bytes, UTF8_BOM)) {
    return new TextDecoder('utf-8').decode(bytes.subarray(UTF8_BOM.length));
  }
  if (startsWith(bytes, UTF16LE_BOM)) {
    return new TextDecoder('utf-16le').decode(bytes.subarray(UTF16LE_BOM.length));
  }
  if (startsWith(bytes, UTF16BE_BOM)) {
    return new TextDecoder('utf-16be').decode(bytes.subarray(UTF16BE_BOM.length));
  }

  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('shift_jis').decode(bytes);
  }
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}
