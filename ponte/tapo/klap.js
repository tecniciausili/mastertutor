/**
 * Implementazione del protocollo KLAP v2 per prese Tapo P100.
 * Usa solo il modulo 'crypto' nativo di Node.js - zero dipendenze esterne.
 * 
 * Protocollo:
 * 1. auth_hash = sha256(sha1(email) + sha1(password))
 * 2. handshake1: invia local_seed, riceve remote_seed + server_hash + cookie
 * 3. handshake2: invia sha256(remote_seed + local_seed + auth_hash) con cookie
 * 4. request: invia comandi cifrati AES-CBC con firma SHA256
 */

import crypto from 'node:crypto';
import http from 'node:http';

// --- Utilità crypto ---

function sha1(data) {
    return crypto.createHash('sha1').update(data).digest();
}

function sha256(data) {
    return crypto.createHash('sha256').update(data).digest();
}

function generateAuthHash(email, password) {
    return sha256(Buffer.concat([
        sha1(Buffer.from(email)),
        sha1(Buffer.from(password))
    ]));
}

// --- Sessione KLAP ---

class KlapSession {
    constructor(localSeed, remoteSeed, authHash) {
        this.localSeed = localSeed;
        this.remoteSeed = remoteSeed;
        this.authHash = authHash;

        const combined = Buffer.concat([localSeed, remoteSeed, authHash]);

        // Chiave AES (primi 16 byte)
        this.key = sha256(Buffer.concat([Buffer.from('lsk'), combined])).subarray(0, 16);

        // IV seed (primi 12 byte + 4 byte seq)
        const ivSeed = sha256(Buffer.concat([Buffer.from('iv'), combined]));
        this.ivBase = ivSeed.subarray(0, 12);

        // Signature prefix (primi 28 byte)
        this.sig = sha256(Buffer.concat([Buffer.from('ldk'), combined])).subarray(0, 28);

        // Sequence number iniziale (ultimi 4 byte di ivSeed, signed int32 big-endian)
        this.seq = ivSeed.readInt32BE(ivSeed.length - 4);
    }

    encrypt(data) {
        this.seq += 1;

        // IV = ivBase(12) + seq(4) = 16 byte
        const seqBuf = Buffer.alloc(4);
        seqBuf.writeInt32BE(this.seq);
        const iv = Buffer.concat([this.ivBase, seqBuf]);

        // AES-CBC encrypt con PKCS7 padding
        const cipher = crypto.createCipheriv('aes-128-cbc', this.key, iv);
        const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);

        // Firma = sha256(sig(28) + seq(4) + encrypted)
        const signature = sha256(Buffer.concat([this.sig, seqBuf, encrypted]));

        return { payload: Buffer.concat([signature, encrypted]), seq: this.seq };
    }

    decrypt(data) {
        // data = signature(32) + encrypted
        const encrypted = data.subarray(32);

        // IV con seq corrente (già incrementato dal server nella risposta)
        const seqBuf = Buffer.alloc(4);
        seqBuf.writeInt32BE(this.seq);
        const iv = Buffer.concat([this.ivBase, seqBuf]);

        // AES-CBC decrypt
        const decipher = crypto.createDecipheriv('aes-128-cbc', this.key, iv);
        const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);

        return decrypted;
    }
}

// --- HTTP helper ---

function httpPost(host, path, body, cookie = null, timeout = 5000) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: host,
            port: 80,
            path: path,
            method: 'POST',
            timeout: timeout,
            headers: {
                'Content-Length': body.length,
                'Content-Type': 'application/octet-stream',
            }
        };

        if (cookie) {
            options.headers['Cookie'] = cookie;
        }

        const req = http.request(options, (res) => {
            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => {
                const responseBody = Buffer.concat(chunks);
                const setCookie = res.headers['set-cookie'];
                let sessionCookie = null;
                if (setCookie) {
                    for (const c of setCookie) {
                        const match = c.match(/TP_SESSIONID=[^;]+/);
                        if (match) sessionCookie = match[0];
                    }
                }
                resolve({
                    status: res.statusCode,
                    body: responseBody,
                    cookie: sessionCookie
                });
            });
        });

        req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

// --- Client Tapo KLAP ---

class TapoDevice {

    constructor(ip, email, password) {
        this.ip = ip;
        this.email = email;
        this.password = password;
        this.authHash = generateAuthHash(email, password);
        this.session = null;
        this.cookie = null;
    }

    async handshake() {
        // Genera seed locale (16 byte random)
        const localSeed = crypto.randomBytes(16);

        // --- Handshake 1 ---
        const hs1 = await httpPost(this.ip, '/app/handshake1', localSeed);

        if (hs1.status === 403) {
            throw new Error('403 Forbidden - Attiva "Compatibilità terze parti" nell\'app Tapo');
        }
        if (hs1.status !== 200) {
            throw new Error(`Handshake1 fallito: HTTP ${hs1.status}`);
        }

        const remoteSeed = hs1.body.subarray(0, 16);
        const serverHash = hs1.body.subarray(16, 48);
        this.cookie = hs1.cookie;

        // Verifica hash del server
        const expectedHash = sha256(Buffer.concat([localSeed, remoteSeed, this.authHash]));
        if (!serverHash.equals(expectedHash)) {
            throw new Error('Credenziali errate (hash mismatch)');
        }

        // --- Handshake 2 ---
        const hs2Payload = sha256(Buffer.concat([remoteSeed, localSeed, this.authHash]));
        const hs2 = await httpPost(this.ip, '/app/handshake2', hs2Payload, this.cookie);

        if (hs2.status !== 200) {
            throw new Error(`Handshake2 fallito: HTTP ${hs2.status}`);
        }

        // Sessione stabilita!
        this.session = new KlapSession(localSeed, remoteSeed, this.authHash);
    }

    async sendCommand(command) {
        if (!this.session) {
            await this.handshake();
        }

        const payload = Buffer.from(JSON.stringify(command));
        const { payload: encrypted, seq } = this.session.encrypt(payload);

        try {
            const res = await httpPost(
                this.ip,
                `/app/request?seq=${seq}`,
                encrypted,
                this.cookie
            );

            if (res.status === 403) {
                // Sessione scaduta, riprova
                this.session = null;
                await this.handshake();
                const retry = this.session.encrypt(payload);
                const res2 = await httpPost(
                    this.ip,
                    `/app/request?seq=${retry.seq}`,
                    retry.payload,
                    this.cookie
                );
                if (res2.status !== 200) throw new Error(`Request fallita: HTTP ${res2.status}`);
                return JSON.parse(this.session.decrypt(res2.body).toString());
            }

            if (res.status !== 200) {
                throw new Error(`Request fallita: HTTP ${res.status}`);
            }

            return JSON.parse(this.session.decrypt(res.body).toString());

        } catch (e) {
            // Reset sessione per il prossimo tentativo
            this.session = null;
            throw e;
        }
    }

    async turnOn() {
        return this.sendCommand({
            method: 'set_device_info',
            params: { device_on: true }
        });
    }

    async turnOff() {
        return this.sendCommand({
            method: 'set_device_info',
            params: { device_on: false }
        });
    }

    async getInfo() {
        return this.sendCommand({
            method: 'get_device_info'
        });
    }

    async toggle(turnOn) {
        if (turnOn) return this.turnOn();
        else return this.turnOff();
    }
}

export { TapoDevice, generateAuthHash };
