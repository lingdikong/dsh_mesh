export interface KeyPairRaw {
    pub: Buffer;
    priv: Buffer;
}
export declare function generateEd25519(): KeyPairRaw;
export declare function generateX25519(): KeyPairRaw;
export declare function edSign(privRaw: Uint8Array, message: Uint8Array): Buffer;
export declare function edVerify(pubRaw: Uint8Array, message: Uint8Array, signature: Uint8Array): boolean;
export declare function x25519Shared(privRaw: Uint8Array, peerPubRaw: Uint8Array): Buffer;
export interface SessionKeys {
    c2s: Buffer;
    s2c: Buffer;
}
export declare function deriveSessionKeys(shared: Buffer, salt: Buffer): SessionKeys;
/** iv(12) | tag(16) | ciphertext */
export declare function seal(key: Buffer, plaintext: Uint8Array): Buffer;
export declare function openSealed(key: Buffer, frame: Uint8Array): Buffer;
export declare function sha256(data: Uint8Array): Buffer;
export declare function deviceIdOf(edPub: Uint8Array): string;
export declare function randomNonce(bytes?: number): Buffer;
export declare function b64u(buf: Uint8Array): string;
export declare function fromB64u(s: string): Buffer;
export interface HandshakeSide {
    deviceId: string;
    edPub: string;
    xPub: string;
    nonce: string;
}
/** Bytes both sides sign: identical ordering and separators. */
export declare function handshakeTranscript(client: HandshakeSide, server: HandshakeSide): Buffer;
