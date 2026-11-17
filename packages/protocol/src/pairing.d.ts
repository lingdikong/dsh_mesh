export declare const PAIRING_VERSION = 1;
export interface PairingPayload {
    v: typeof PAIRING_VERSION;
    deviceId: string;
    name: string;
    platform: string;
    edPub: string;
    xPub: string;
    addresses: string[];
    code: string;
    expiresAt: number;
}
export declare function encodePairingLink(payload: PairingPayload): string;
export declare function parsePairingLink(link: string): PairingPayload;
export declare function pairingCode(): string;
