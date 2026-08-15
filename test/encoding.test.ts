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
