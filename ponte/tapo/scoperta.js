/**
 * scoperta.js
 * «Scoperta» delle prese Tapo con il messaggio TDP (UDP, porta 20002), lo stesso che manda
 * l'app Tapo del telefono quando aggiorna l'elenco dei dispositivi.
 *
 * Serve per due motivi, entrambi nati con i firmware 1.4.x delle P110 (2026):
 *  1. dopo l'accensione la presa NON avvia il servizio locale (porta 80) finché non riceve
 *     questo messaggio: senza, per 8-9 minuti risponde «connessione rifiutata»;
 *  2. la risposta dice quale protocollo usa la presa (mgt_encrypt_schm.encrypt_type):
 *     KLAP, AES (Secure Passthrough) oppure TPAP. TPAP è il nuovo protocollo che la presa usa
 *     quando nell'app Tapo è spenta la «Compatibilità con terze parti»: non è utilizzabile
 *     da programmi esterni, quindi va riconosciuto e spiegato.
 *
 * Il pacchetto: 16 byte di intestazione (versione 2, tipo 0, operazione 1, lunghezza, flag 17,
 * numero casuale, CRC32 di tutto il pacchetto) e un JSON con una chiave pubblica RSA.
 * La risposta: 16 byte di intestazione e un JSON in chiaro.
 */

import crypto from 'node:crypto';
import dgram from 'node:dgram';

const PORTA = 20002;
const SEGNAPOSTO_CRC = 0x5A6B7C8D;

// CRC32 (lo stesso di zlib): node:zlib.crc32 esiste solo da Node 22, così va bene ovunque
const TABELLA = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
  }
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (const b of buf) {
    c = TABELLA[(c ^ b) & 0xFF] ^ (c >>> 8);
  }
  return (c ^ 0xFFFFFFFF) >>> 0;
}

let chiavePubblica = null;
function pacchetto() {
  if (!chiavePubblica) {
    const { publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });   // come python-kasa
    chiavePubblica = publicKey.export({ type: 'spki', format: 'pem' });
  }
  const corpo = Buffer.from(JSON.stringify({ params: { rsa_key: chiavePubblica } }));
  const testa = Buffer.alloc(16);
  testa.writeUInt8(2, 0);                                   // versione
  testa.writeUInt8(0, 1);                                   // tipo
  testa.writeUInt16BE(1, 2);                                // operazione
  testa.writeUInt16BE(corpo.length, 4);                     // lunghezza del JSON
  testa.writeUInt8(17, 6);                                  // flag
  testa.writeUInt8(0, 7);
  testa.writeUInt32BE(crypto.randomBytes(4).readUInt32BE(0), 8);
  testa.writeUInt32BE(SEGNAPOSTO_CRC, 12);
  const tutto = Buffer.concat([testa, corpo]);
  tutto.writeUInt32BE(crc32(tutto), 12);
  return tutto;
}

function leggiRisposta(msg, rinfo) {
  try {
    const json = JSON.parse(msg.subarray(16).toString('utf8'));
    const r = json.result || {};
    const schema = r.mgt_encrypt_schm || {};
    return {
      ip: r.ip || rinfo.address,
      modello: r.device_model || '',
      tipo: r.device_type || '',
      protocollo: String(schema.encrypt_type || '').toUpperCase(),   // KLAP, AES, TPAP
      versioneLogin: schema.lv ?? null,
      tpapPreferito: r.tpap_preferred === true,
      mac: r.mac || '',
    };
  } catch {
    return null;
  }
}

/**
 * Manda il messaggio di scoperta e raccoglie le risposte per `attesaMs`.
 * ip: indirizzo di una presa (risponde solo lei) oppure '255.255.255.255' per tutta la rete.
 * Non lancia mai errori: se qualcosa va storto restituisce un elenco vuoto.
 */
export function scopri(ip = '255.255.255.255', attesaMs = 1500) {
  return new Promise((resolve) => {
    const trovate = new Map();
    let socket;
    let finito = false;
    const fine = () => {
      if (finito) return;
      finito = true;
      try { socket.close(); } catch { /* già chiuso */ }
      resolve([...trovate.values()]);
    };
    try {
      socket = dgram.createSocket('udp4');
      socket.on('error', fine);
      socket.on('message', (msg, rinfo) => {
        const presa = leggiRisposta(msg, rinfo);
        if (presa) {
          trovate.set(presa.ip, presa);
          if (ip !== '255.255.255.255' && rinfo.address === ip) fine();
        }
      });
      socket.bind(0, () => {
        try {
          socket.setBroadcast(true);
          const dati = pacchetto();
          // Più invii a distanza di poco: l'UDP può perdersi, e la presa appena accesa può non sentire il primo
          [0, 300, 700].forEach((ritardo) => setTimeout(() => {
            if (!finito) socket.send(dati, PORTA, ip, () => {});
          }, ritardo));
        } catch {
          fine();
        }
      });
      setTimeout(fine, attesaMs);
    } catch {
      fine();
    }
  });
}

/** Scoperta di una sola presa: i suoi dati, oppure null se non ha risposto. */
export async function scopriPresa(ip, attesaMs = 1500) {
  const trovate = await scopri(ip, attesaMs);
  return trovate.find((p) => p.ip === ip) || null;
}
