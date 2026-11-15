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
 * Invalid sequences tolerated per valid non-ASCII character before UTF-8 is
 * given up for Shift_JIS. Shift_JIS read as UTF-8 yields roughly ten or more
 * invalid sequences per valid character (kanji, half-width kana and mixed
 * samples measured 0.02–0.09 valid per invalid), so this leaves a wide margin;
 * a genuine UTF-8 file with a stray or truncated byte stays well inside it.
 */
const MAX_INVALID_PER_VALID = 1 / 4;

/**
 * Decode file bytes to text.
 *
 * A BOM is definitive and wins over the `encoding` setting. Without one,
 * `auto` tries strict UTF-8 and falls back to Shift_JIS — the common case for
 * Japanese CSV exports, which would otherwise decode into replacement
 * characters — unless the text is plainly UTF-8 with only a few bad bytes.
 */
export function decodeText(bytes: Uint8Array, encoding: EncodingName = 'auto'): string {
  if (startsWith(bytes, UTF8_BOM)) {
    return new TextDecoder('utf-8').decode(bytes.subarray(UTF8_BOM.length));
  }
  if (startsWith(bytes, UTF16LE_BOM)) {
    return new TextDecoder('utf-16le').decode(bytes.subarray(UTF16LE_BOM.length));
  }
  if (startsWith(bytes, UTF16BE_BOM)) {
    return new TextDecoder('utf-16be').decode(bytes.subarray(UTF16BE_BOM.length));
  }

  if (encoding === 'utf8') return new TextDecoder('utf-8').decode(bytes);
  if (encoding === 'shift_jis') return new TextDecoder('shift_jis').decode(bytes);

  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    const lenient = new TextDecoder('utf-8').decode(bytes);
    return mostlyUtf8(lenient) ? lenient : new TextDecoder('shift_jis').decode(bytes);
  }
}

/** Whether lenient UTF-8 output has only a few replacement characters next to its real non-ASCII text. */
function mostlyUtf8(text: string): boolean {
  let invalid = 0;
  let valid = 0;

  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code === 0xfffd) invalid++;
    else if (code > 0x7f) valid++;
  }

  return valid > 0 && invalid <= valid * MAX_INVALID_PER_VALID;
}
