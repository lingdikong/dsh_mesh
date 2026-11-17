const ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';
/** RFC 4648 base32, lower-case, unpadded. */
export function base32Encode(bytes) {
    let bits = 0;
    let value = 0;
    let out = '';
    for (const b of bytes) {
        value = (value << 8) | b;
        bits += 8;
        while (bits >= 5) {
            out += ALPHABET[(value >>> (bits - 5)) & 31];
            bits -= 5;
        }
    }
    if (bits > 0)
        out += ALPHABET[(value << (5 - bits)) & 31];
    return out;
}
//# sourceMappingURL=base32.js.map