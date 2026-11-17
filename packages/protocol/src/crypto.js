import crypto from 'node:crypto';
import { base32Encode } from './base32.js';
const ED_SPKI = Buffer.from('302a300506032b6570032100', 'hex');
const ED_PKCS8 = Buffer.from('302e020100300506032b657004220420', 'hex');
const X_SPKI = Buffer.from('302a300506032b656e032100', 'hex');
const X_PKCS8 = Buffer.from('302e020100300506032b656e04220420', 'hex');
function rawFromDer(exported) {
    return Buffer.from(Buffer.from(exported).subarray(-32));
}
export function generateEd25519() {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    return {
        pub: rawFromDer(publicKey.export({ format: 'der', type: 'spki' })),
        priv: rawFromDer(privateKey.export({ format: 'der', type: 'pkcs8' })),
    };
}
export function generateX25519() {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('x25519');
    return {
        pub: rawFromDer(publicKey.export({ format: 'der', type: 'spki' })),
        priv: rawFromDer(privateKey.export({ format: 'der', type: 'pkcs8' })),
    };
}
export function edSign(privRaw, message) {
    const key = crypto.createPrivateKey({
        key: Buffer.concat([ED_PKCS8, Buffer.from(privRaw)]),
        format: 'der',
        type: 'pkcs8',
    });
    return crypto.sign(null, Buffer.from(message), key);
}
export function edVerify(pubRaw, message, signature) {
    try {
        const key = crypto.createPublicKey({
            key: Buffer.concat([ED_SPKI, Buffer.from(pubRaw)]),
            format: 'der',
            type: 'spki',
        });
        return crypto.verify(null, Buffer.from(message), key, Buffer.from(signature));
    }
    catch {
        return false;
    }
}
export function x25519Shared(privRaw, peerPubRaw) {
    const priv = crypto.createPrivateKey({
        key: Buffer.concat([X_PKCS8, Buffer.from(privRaw)]),
        format: 'der',
        type: 'pkcs8',
    });
    const pub = crypto.createPublicKey({
        key: Buffer.concat([X_SPKI, Buffer.from(peerPubRaw)]),
        format: 'der',
        type: 'spki',
    });
    return crypto.diffieHellman({ privateKey: priv, publicKey: pub });
}
export function deriveSessionKeys(shared, salt) {
    const c2s = Buffer.from(crypto.hkdfSync('sha256', shared, salt, Buffer.from('dsh-mesh/v1/c2s'), 32));
    const s2c = Buffer.from(crypto.hkdfSync('sha256', shared, salt, Buffer.from('dsh-mesh/v1/s2c'), 32));
    return { c2s, s2c };
}
const IV_LEN = 12;
const TAG_LEN = 16;
/** iv(12) | tag(16) | ciphertext */
export function seal(key, plaintext) {
    const iv = crypto.randomBytes(IV_LEN);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const ct = Buffer.concat([cipher.update(Buffer.from(plaintext)), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), ct]);
}
export function openSealed(key, frame) {
    const buf = Buffer.from(frame);
    if (buf.length < IV_LEN + TAG_LEN)
        throw new Error('frame too short');
    const iv = buf.subarray(0, IV_LEN);
    const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
    const ct = buf.subarray(IV_LEN + TAG_LEN);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]);
}
export function sha256(data) {
    return crypto.createHash('sha256').update(Buffer.from(data)).digest();
}
export function deviceIdOf(edPub) {
    return base32Encode(sha256(edPub)).slice(0, 26);
}
export function randomNonce(bytes = 18) {
    return crypto.randomBytes(bytes);
}
export function b64u(buf) {
    return Buffer.from(buf).toString('base64url');
}
export function fromB64u(s) {
    return Buffer.from(s, 'base64url');
}
/** Bytes both sides sign: identical ordering and separators. */
export function handshakeTranscript(client, server) {
    const norm = (s) => `${s.deviceId}|${s.edPub}|${s.xPub}|${s.nonce}`;
    return Buffer.from(`dsh-mesh/v1|${norm(client)}|${norm(server)}`, 'utf8');
}
//# sourceMappingURL=crypto.js.map