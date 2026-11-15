import { describe, it, expect } from 'vitest';
import { decodeText } from '../src/encoding';

const utf8 = (text: string) => new TextEncoder().encode(text);
const withBom = (text: string) => new Uint8Array([0xef, 0xbb, 0xbf, ...utf8(text)]);

// 「表」in Shift_JIS — also a classic UTF-8 mis-decode trigger.
const shiftJisHyou = new Uint8Array([0x95, 0x5c]);

describe('decodeText', () => {
  it('decodes plain UTF-8', () => {
    expect(decodeText(utf8('a,b\n1,2'))).toBe('a,b\n1,2');
  });

  it('decodes UTF-8 with Japanese text', () => {
    expect(decodeText(utf8('名前,部署'))).toBe('名前,部署');
  });

  it('strips a UTF-8 BOM', () => {
    expect(decodeText(withBom('id,name'))).toBe('id,name');
  });

  it('strips the BOM when UTF-8 is forced', () => {
    expect(decodeText(withBom('id'), 'utf8')).toBe('id');
  });

  it('falls back to Shift_JIS for bytes that are not valid UTF-8', () => {
    expect(decodeText(shiftJisHyou)).toBe('表');
  });

  it('honours an explicit shift_jis setting', () => {
    expect(decodeText(shiftJisHyou, 'shift_jis')).toBe('表');
  });

  it('does not misread ASCII as Shift_JIS', () => {
    expect(decodeText(utf8('id,name,value'), 'auto')).toBe('id,name,value');
  });

  it('decodes a UTF-16LE BOM', () => {
    const bytes = new Uint8Array([0xff, 0xfe, 0x61, 0x00, 0x62, 0x00]);
    expect(decodeText(bytes)).toBe('ab');
  });

  it('returns an empty string for empty input', () => {
    expect(decodeText(new Uint8Array())).toBe('');
  });
});

describe('decodeText: mostly-valid UTF-8 and BOM precedence', () => {
  const concat = (...parts: Uint8Array[]) => new Uint8Array(parts.flatMap((p) => [...p]));

  it('keeps UTF-8 when only a stray byte is invalid', () => {
    const text = '名前\t値\n東京\t大阪\n'.repeat(5);
    const bytes = concat(utf8(text), new Uint8Array([0xe9]));
    expect(decodeText(bytes)).toBe(text + '�');
  });

  it('keeps UTF-8 when the file is cut off in the middle of a character', () => {
    const full = utf8('名前,部署\n山田,営業\n');
    const decoded = decodeText(full.subarray(0, full.length - 2));
    expect(decoded.startsWith('名前,部署\n山田,')).toBe(true);
  });

  it('still falls back to Shift_JIS for real Shift_JIS text', () => {
    // 「名前,東京」in Shift_JIS
    const bytes = new Uint8Array([0x96, 0xbc, 0x91, 0x4f, 0x2c, 0x93, 0x8c, 0x8b, 0x9e]);
    expect(decodeText(bytes)).toBe('名前,東京');
  });

  it('still falls back to Shift_JIS for half-width katakana, whose bytes can form valid UTF-8 pairs', () => {
    // 「ﾁﾂﾃ」×4 — 0xC2 0xC3 lead bytes followed by 0xC1 etc.
    const bytes = new Uint8Array([0xc1, 0xc2, 0xc3, 0xc1, 0xc2, 0xc3, 0xc1, 0xc2, 0xc3, 0xc1, 0xc2, 0xc3]);
    expect(decodeText(bytes)).toBe('ﾁﾂﾃﾁﾂﾃﾁﾂﾃﾁﾂﾃ');
  });

  it('still falls back to Shift_JIS for ASCII with a few Shift_JIS characters', () => {
    const bytes = concat(utf8('id,name\n1,'), shiftJisHyou, utf8('\n'));
    expect(decodeText(bytes)).toBe('id,name\n1,表\n');
  });

  it('lets a UTF-8 BOM win over a shift_jis setting', () => {
    expect(decodeText(withBom('a,東京'), 'shift_jis')).toBe('a,東京');
  });

  it('lets a UTF-16LE BOM win over a utf8 setting', () => {
    const bytes = new Uint8Array([0xff, 0xfe, 0x61, 0x00, 0x09, 0x00, 0x62, 0x00]);
    expect(decodeText(bytes, 'utf8')).toBe('a\tb');
  });
});
