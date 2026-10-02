// Code page 437: the character set DOS used. Bytes 0x00-0x7F are ASCII
// (control codes are left alone so importers can see delimiters); 0x80-0xFF
// map to the accented letters, box drawing and symbols below.
const HIGH =
  'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒ' +
  'áíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐' +
  '└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀' +
  'αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ';

if ([...HIGH].length !== 128) throw new Error('CP437 table must have 128 entries');

const HIGH_CHARS = [...HIGH];
const REVERSE = new Map(HIGH_CHARS.map((c, i) => [c, 0x80 + i]));

export function decodeCp437(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    out += b < 0x80 ? String.fromCharCode(b) : HIGH_CHARS[b - 0x80];
  }
  return out;
}

export function encodeCp437(text) {
  const out = [];
  for (const ch of text) {
    const code = ch.codePointAt(0);
    if (code < 0x80) out.push(code);
    else out.push(REVERSE.get(ch) ?? 0x3f); // '?'
  }
  return Uint8Array.from(out);
}

// Decide how to turn file bytes into text. A file that is valid UTF-8 and
// contains multi-byte sequences is UTF-8; anything else is treated as DOS text.
export function decodeBytes(bytes, encoding = 'auto') {
  if (encoding === 'cp437') return decodeCp437(bytes);
  if (encoding === 'utf-8') return new TextDecoder('utf-8').decode(bytes);
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  } catch {
    return decodeCp437(bytes);
  }
}
