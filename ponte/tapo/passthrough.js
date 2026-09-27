/**
 * Implementazione del protocollo TP-Link Secure Passthrough ("AES" nella scoperta).
 * Usato dai firmware piu' vecchi (es. P100 1.3.7) prima che fosse introdotto KLAP v2.
 *
 * Riscritto sul modello di AesTransport di python-kasa, che con la P100 1.3.7
 * funziona, mentre la versione delle app di CHIARA veniva respinta ("socket hang up"):
 * - la chiave pubblica va inviata in PEM SubjectPublicKeyInfo con il base64 su una
 *   sola riga: per RSA-1024 la richiesta e' lunga esattamente 314 byte;
 * - servono le intestazioni requestByApp e Accept;
 * - il login "versione 2" (quella delle prese recenti) vuole username e password2
 *   come base64 dello SHA1 esadecimale; la versione 1 la password in base64.
 *   La presa non dice quale usa, quindi si prova la 2 e poi la 1.
 *
 * Flusso:
 * 1. Client genera coppia RSA-1024
 * 2. POST /app (handshake): invia chiave pubblica RSA, riceve chiave AES cifrata con RSA
 * 3. POST /app (login): invia credenziali cifrate con AES, riceve token di sessione
 * 4. POST /app?token=<token>: invia comandi cifrati con AES
 */

import crypto from 'node:crypto';
import http from 'node:http';

// Codice restituito dalla presa quando email o password sono sbagliate
const ERRORE_CREDENZIALI = -1501;

function sha1Hex(testo) {
    return crypto.createHash('sha1').update(Buffer.from(testo)).digest('hex');
}

function base64(testo) {
    return Buffer.from(testo).toString('base64');
}

function aesEncrypt(plaintext, key, iv) {
    const cipher = crypto.createCipheriv('aes-128-cbc', key, iv);
    return Buffer.concat([cipher.update(plaintext), cipher.final()]);
}

function aesDecrypt(ciphertext, key, iv) {
    const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

function httpPostJson(host, path, bodyObj, cookie, timeout = 8000) {
    return new Promise((resolve, reject) => {
        const bodyBuf = Buffer.from(JSON.stringify(bodyObj), 'utf-8');

        const options = {
            hostname: host,
            port: 80,
            path: path,
            method: 'POST',
            timeout: timeout,
            // Una connessione nuova per ogni richiesta: il server della presa chiude
            // le connessioni senza avvisare, e riusarne una gia' chiusa da' "socket hang up"
            agent: false,
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'requestByApp': 'true',
                // Senza la lunghezza esatta la presa risponde 500 o chiude la connessione
                'Content-Length': bodyBuf.length
            }
        };

        if (cookie) options.headers['Cookie'] = cookie;

        const req = http.request(options, (res) => {
            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => {
                // Estrai cookie di sessione (alcuni firmware lo chiamano SESSIONID)
                let sessionCookie = null;
                for (const c of res.headers['set-cookie'] || []) {
                    const match = c.match(/(?:TP_)?SESSIONID=([^;]+)/);
                    if (match) { sessionCookie = `TP_SESSIONID=${match[1]}`; break; }
                }
                resolve({
                    status: res.statusCode,
                    body: Buffer.concat(chunks),
                    cookie: sessionCookie
                });
            });
        });

        req.on('timeout', () => { req.destroy(); reject(new Error('Timeout passthrough')); });
        req.on('error', reject);
        req.write(bodyBuf);
        req.end();
    });
}

function leggiJson(res, fase) {
    try {
        return JSON.parse(res.body.toString());
    } catch {
        throw new Error(`Passthrough ${fase}: risposta non JSON (HTTP ${res.status})`);
    }
}

class TapoPassthroughDevice {

    constructor(ip, email, password) {
        this.ip = ip;
        this.email = email;
        this.password = password;
        this.aesKey = null;
        this.aesIv = null;
        this.token = null;
        this.cookie = null;
        this.versioneLogin = null;   // 2 o 1, ricordata dopo il primo login riuscito
        this.terminalUuid = crypto.createHash('md5').update(crypto.randomBytes(16)).digest('base64');
    }

    async handshake() {
        this.token = null;
        this.aesKey = null;

        // --- Step 1: Genera coppia RSA-1024 ---
        const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 1024 });
        const spki = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
        const pem = `-----BEGIN PUBLIC KEY-----\n${spki}\n-----END PUBLIC KEY-----\n`;

        // --- Step 2: Handshake con il dispositivo ---
        const hsRes = await httpPostJson(this.ip, '/app', {
            method: 'handshake',
            params: { key: pem }
        }, null);

        if (hsRes.status === 404) {
            throw new Error('PASSTHROUGH_NOT_SUPPORTED');
        }
        if (hsRes.status !== 200) {
            throw new Error(`Passthrough handshake fallito: HTTP ${hsRes.status}`);
        }

        const hsResult = leggiJson(hsRes, 'handshake');
        if (hsResult.error_code !== 0) {
            throw new Error(`Passthrough handshake errore: ${hsResult.error_code}`);
        }

        // Decripta la chiave AES con la nostra RSA privata (PKCS1 v1.5)
        let aesKeyIv;
        try {
            aesKeyIv = crypto.privateDecrypt(
                { key: privateKey, padding: crypto.constants.RSA_PKCS1_PADDING },
                Buffer.from(hsResult.result.key, 'base64')
            );
        } catch (e) {
            throw new Error('Impossibile decriptare chiave AES: ' + e.message);
        }

        // 32 byte = 16 key + 16 IV
        this.aesKey = aesKeyIv.subarray(0, 16);
        this.aesIv = aesKeyIv.subarray(16, 32);
        this.cookie = hsRes.cookie;
    }

    /** Invia un messaggio cifrato e restituisce la risposta decifrata della presa. */
    async securePassthrough(messaggio) {
        const request = aesEncrypt(Buffer.from(JSON.stringify(messaggio)), this.aesKey, this.aesIv).toString('base64');
        const path = this.token ? `/app?token=${this.token}` : '/app';

        const res = await httpPostJson(this.ip, path, {
            method: 'securePassthrough',
            params: { request }
        }, this.cookie);

        if (res.status !== 200) {
            throw new Error(`Passthrough request fallita: HTTP ${res.status}`);
        }

        const outer = leggiJson(res, 'request');
        if (outer.error_code !== 0) {
            const errore = new Error(`Passthrough risposta errore: ${outer.error_code}`);
            errore.codice = outer.error_code;
            throw errore;
        }

        const response = outer.result.response;
        try {
            return JSON.parse(aesDecrypt(Buffer.from(response, 'base64'), this.aesKey, this.aesIv).toString());
        } catch {
            // Alcuni firmware rispondono in chiaro
            return JSON.parse(response);
        }
    }

    parametriLogin(versione) {
        const username = base64(sha1Hex(this.email));
        if (versione === 2) {
            return { username, password2: base64(sha1Hex(this.password)) };
        }
        return { username, password: base64(this.password) };
    }

    async login() {
        const versioni = this.versioneLogin ? [this.versioneLogin] : [2, 1];
        let codice = null;

        for (const versione of versioni) {
            // Dopo un login fallito la presa vuole un nuovo handshake
            if (codice !== null) await this.handshake();

            let risposta;
            try {
                risposta = await this.securePassthrough({
                    method: 'login_device',
                    params: this.parametriLogin(versione),
                    request_time_milis: Date.now()
                });
            } catch (e) {
                // Errore di rete: inutile provare l'altra versione
                if (e.codice === undefined) throw e;
                risposta = { error_code: e.codice };
            }

            if (risposta.error_code === 0 && risposta.result?.token) {
                this.token = risposta.result.token;
                this.versioneLogin = versione;
                return;
            }
            codice = risposta.error_code;
        }

        this.aesKey = null;
        if (codice === ERRORE_CREDENZIALI) {
            throw new Error('Passthrough login: credenziali errate (hash mismatch)');
        }
        throw new Error(`Passthrough login errore: ${codice}`);
    }

    async sendCommand(command, tentativiRimasti = 1) {
        const sessioneNuova = !this.token || !this.aesKey;
        if (sessioneNuova) {
            await this.handshake();
            await this.login();
        }

        try {
            const risposta = await this.securePassthrough({
                ...command,
                request_time_milis: Date.now(),
                terminal_uuid: this.terminalUuid
            });

            if (risposta.error_code !== 0) {
                throw new Error(`Passthrough comando errore: ${risposta.error_code}`);
            }
            return risposta;

        } catch (e) {
            this.token = null; this.aesKey = null;
            // Sessione scaduta (dura circa un giorno) o presa riavviata: un solo nuovo
            // tentativo, altrimenti un device che rifiuta sempre ripeterebbe all'infinito
            if (!sessioneNuova && tentativiRimasti > 0) {
                return this.sendCommand(command, tentativiRimasti - 1);
            }
            throw e;
        }
    }

    async turnOn()  { return this.sendCommand({ method: 'set_device_info', params: { device_on: true  } }); }
    async turnOff() { return this.sendCommand({ method: 'set_device_info', params: { device_on: false } }); }
    async getInfo() { return this.sendCommand({ method: 'get_device_info' }); }
    async toggle(state) { return state ? this.turnOn() : this.turnOff(); }
}

export { TapoPassthroughDevice };
