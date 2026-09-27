/**
 * prove.js
 * Verifiche automatiche del ponte, senza hardware e senza Azure:
 *   - un finto Azure Web PubSub (server WebSocket minimo, qui sotto) usa la VERA
 *     funzione api/negotiate dell'app per rilasciare i token;
 *   - il ponte gira in modalita' --simula con una configurazione temporanea
 *     (il config.json vero non viene toccato);
 *   - una finta PWA si collega come farebbe il tablet e invia i comandi.
 *
 * Uso:  node prove/prove.js     (oppure: npm run prove)
 */

import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const CARTELLA = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const CHIAVE = 'chiave-delle-prove';
const CODICE = 'PROVA2345678';
const PROTOCOLLO = 'json.webpubsub.azure.v1';

const risultati = [];
function verifica(descrizione, condizione, dettaglio = '') {
  risultati.push({ descrizione, ok: Boolean(condizione) });
  console.log(`${condizione ? '  ✓' : '  ✗'} ${descrizione}${!condizione && dettaglio ? `  → ${dettaglio}` : ''}`);
}

const attendi = (ms) => new Promise((r) => setTimeout(r, ms));

function portaLibera() {
  return new Promise((risolvi) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => risolvi(port));
    });
  });
}

// ==================== FINTO AZURE WEB PUBSUB ====================

function inviaFrame(socket, testo) {
  const carico = Buffer.from(testo);
  let testa;
  if (carico.length < 126) {
    testa = Buffer.from([0x81, carico.length]);
  } else if (carico.length < 65536) {
    testa = Buffer.alloc(4);
    testa[0] = 0x81;
    testa[1] = 126;
    testa.writeUInt16BE(carico.length, 2);
  } else {
    testa = Buffer.alloc(10);
    testa[0] = 0x81;
    testa[1] = 127;
    testa.writeBigUInt64BE(BigInt(carico.length), 2);
  }
  socket.write(Buffer.concat([testa, carico]));
}

function avviaFintoAzure(porta) {
  process.env.WEBPUBSUB_CONNECTION_STRING = `Endpoint=http://127.0.0.1:${porta};AccessKey=${CHIAVE};Version=1.0;`;
  const negotiate = require(path.join(CARTELLA, '..', 'api', 'negotiate', 'index.js'));
  const gruppi = new Map();
  const rifiutati = [];

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/api/negotiate') {
      const ctx = {};
      await negotiate(ctx, { query: Object.fromEntries(url.searchParams) });
      res.writeHead(ctx.res.status, ctx.res.headers);
      res.end(JSON.stringify(ctx.res.body));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  server.on('upgrade', (req, socket) => {
    const token = new URL(req.url, 'http://x').searchParams.get('access_token') || '';
    const [h, p, s] = token.split('.');
    const firma = crypto.createHmac('sha256', CHIAVE).update(`${h}.${p}`).digest('base64url');
    if (firma !== s) {
      socket.end('HTTP/1.1 401 Unauthorized\r\n\r\n');
      return;
    }
    const claim = JSON.parse(Buffer.from(p, 'base64url'));
    const chiave = crypto.createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    const protocolli = String(req.headers['sec-websocket-protocol'] || '').split(',').map((x) => x.trim());
    socket.write([
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${chiave}`,
      ...(protocolli.includes(PROTOCOLLO) ? [`Sec-WebSocket-Protocol: ${PROTOCOLLO}`] : []),
      '', '',
    ].join('\r\n'));

    const cliente = { socket, ruoli: claim.role || [] };
    for (const g of claim['webpubsub.group'] || []) {
      if (!gruppi.has(g)) {
        gruppi.set(g, new Set());
      }
      gruppi.get(g).add(cliente);
    }

    let buffer = Buffer.alloc(0);
    socket.on('data', (dati) => {
      buffer = Buffer.concat([buffer, dati]);
      for (;;) {
        if (buffer.length < 2) {
          return;
        }
        const opcode = buffer[0] & 0x0f;
        const mascherato = (buffer[1] & 0x80) !== 0;
        let lunghezza = buffer[1] & 0x7f;
        let pos = 2;
        if (lunghezza === 126) {
          if (buffer.length < 4) return;
          lunghezza = buffer.readUInt16BE(2);
          pos = 4;
        } else if (lunghezza === 127) {
          if (buffer.length < 10) return;
          lunghezza = Number(buffer.readBigUInt64BE(2));
          pos = 10;
        }
        const maschera = mascherato ? buffer.subarray(pos, pos + 4) : null;
        if (mascherato) {
          pos += 4;
        }
        if (buffer.length < pos + lunghezza) {
          return;
        }
        let carico = Buffer.from(buffer.subarray(pos, pos + lunghezza));
        if (maschera) {
          carico = carico.map((b, i) => b ^ maschera[i % 4]);
        }
        buffer = buffer.subarray(pos + lunghezza);
        if (opcode === 0x8) {
          socket.end();
          return;
        }
        if (opcode !== 0x1) {
          continue;
        }
        const m = JSON.parse(Buffer.from(carico).toString('utf-8'));
        if (m.type !== 'sendToGroup') {
          continue;
        }
        if (!cliente.ruoli.includes(`webpubsub.sendToGroup.${m.group}`)) {
          rifiutati.push(m.group);
          continue;
        }
        for (const dest of gruppi.get(m.group) || []) {
          inviaFrame(dest.socket, JSON.stringify({ type: 'message', from: 'group', group: m.group, dataType: m.dataType, data: m.data }));
        }
      }
    });
    socket.on('close', () => {
      for (const insieme of gruppi.values()) {
        insieme.delete(cliente);
      }
    });
    socket.on('error', () => {});
  });

  return new Promise((risolvi) => server.listen(porta, '127.0.0.1', () => risolvi({ server, rifiutati })));
}

// ==================== FINTA PWA ====================

async function collegaApp(portaAzure) {
  const r = await fetch(`http://127.0.0.1:${portaAzure}/api/negotiate?ruolo=app&codice=${CODICE}`);
  const { url, destinatario } = await r.json();
  const ws = new WebSocket(url, PROTOCOLLO);
  const ricevuti = [];
  const inAttesa = [];
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.type !== 'message') return;
    ricevuti.push(m.data);
    for (const a of [...inAttesa]) {
      if (a.filtro(m.data)) {
        inAttesa.splice(inAttesa.indexOf(a), 1);
        a.risolvi(m.data);
      }
    }
  });
  await new Promise((risolvi, rifiuta) => {
    ws.addEventListener('open', risolvi, { once: true });
    ws.addEventListener('error', rifiuta, { once: true });
  });
  return {
    invia(dati) {
      ws.send(JSON.stringify({ type: 'sendToGroup', group: destinatario, dataType: 'json', data: dati }));
    },
    // Scrive nel proprio gruppo: il finto Azure deve rifiutarlo (ruoli del token)
    inviaAGruppoSbagliato(dati) {
      ws.send(JSON.stringify({ type: 'sendToGroup', group: `mt-${CODICE}-app`, dataType: 'json', data: dati }));
    },
    aspetta(filtro, ms = 5000) {
      const gia = ricevuti.find(filtro);
      if (gia) return Promise.resolve(gia);
      return new Promise((risolvi, rifiuta) => {
        const voce = { filtro, risolvi };
        inAttesa.push(voce);
        setTimeout(() => {
          const i = inAttesa.indexOf(voce);
          if (i >= 0) {
            inAttesa.splice(i, 1);
            rifiuta(new Error('tempo scaduto'));
          }
        }, ms);
      });
    },
    ricevuti,
    chiudi: () => ws.close(),
  };
}

// ==================== PROVE ====================

const portaAzure = await portaLibera();
const portaPagina = await portaLibera();
const { server, rifiutati } = await avviaFintoAzure(portaAzure);
const cartellaTemp = fs.mkdtempSync(path.join(os.tmpdir(), 'ponte-prove-'));
const fileConfig = path.join(cartellaTemp, 'config.json');
fs.writeFileSync(fileConfig, JSON.stringify({
  app: `http://127.0.0.1:${portaAzure}`,
  codice: CODICE,
  account: { email: '', password: '' },
  prese: [
    { id: 'presa1', nome: 'Ventilatore', ip: '192.168.50.10' },
    { id: 'presa2', nome: 'Lampada', ip: '192.168.50.11' },
  ],
}));

console.log('\nPonte Mastertutor: verifiche automatiche\n');

// La finta PWA si collega prima del ponte, cosi' riceve il suo "ciao"
const app = await collegaApp(portaAzure);

let uscita = '';
const ponte = spawn(process.execPath, [path.join(CARTELLA, 'ponte.js'), '--simula', '--senza-browser',
  '--porta', String(portaPagina), '--config', fileConfig], { cwd: CARTELLA });
ponte.stdout.on('data', (d) => { uscita += d; });
ponte.stderr.on('data', (d) => { uscita += d; });

try {
  const ciao = await app.aspetta((d) => d.tipo === 'ciao', 8000);
  verifica('il ponte si collega e si presenta con le sue prese', ciao.prese?.length === 2);
  verifica('all\'avvio il ponte spegne tutte le prese', uscita.includes('Prese spente (avvio del ponte)'));

  app.invia({ tipo: 'ping', id: 'p1' });
  const pong = await app.aspetta((d) => d.tipo === 'pong' && d.id === 'p1');
  verifica('risponde al ping con lo stesso id', pong.id === 'p1' && pong.versione);

  app.invia({ tipo: 'accendi', id: 'a1', prese: ['presa2'], secondi: 1 });
  const esito = await app.aspetta((d) => d.tipo === 'esito' && d.id === 'a1');
  verifica('accende solo la presa richiesta', esito.ok && esito.prese.length === 1 && esito.prese[0].id === 'presa2',
    JSON.stringify(esito));
  const spenta = await app.aspetta((d) => d.tipo === 'spenta' && d.prese?.includes('presa2'), 4000);
  verifica('la rispegne da solo allo scadere del tempo', Boolean(spenta));

  app.invia({ tipo: 'accendi', id: 'a2', prese: ['inesistente'], secondi: 30 });
  const esito2 = await app.aspetta((d) => d.tipo === 'esito' && d.id === 'a2');
  verifica('con un id sconosciuto accende tutte le prese', esito2.ok && esito2.prese.length === 2);
  app.invia({ tipo: 'spegni', id: 's1', prese: [] });
  const esito3 = await app.aspetta((d) => d.tipo === 'esito' && d.id === 's1');
  verifica('spegne subito su richiesta', esito3.ok && esito3.prese.length === 2);

  app.invia({ tipo: 'accendi', id: 'a3', prese: ['presa1'], secondi: 99999 });
  await app.aspetta((d) => d.tipo === 'esito' && d.id === 'a3');
  verifica('un\'accensione non supera i 600 secondi', uscita.includes('Accensione per 600 s'));
  app.invia({ tipo: 'spegni', id: 's2', prese: ['presa1'] });
  await app.aspetta((d) => d.tipo === 'esito' && d.id === 's2');

  // Configurazione dalla PWA (finestra "Configura le prese")
  app.invia({ tipo: 'leggi-config', id: 'c1' });
  const conf = await app.aspetta((d) => d.tipo === 'config' && d.id === 'c1');
  verifica('legge la configurazione (2 prese, nessuna password)', conf.prese.length === 2
    && conf.account.passwordImpostata === false && !JSON.stringify(conf).includes('"password"'));

  app.invia({ tipo: 'configura', id: 'c2', prese: [{ nome: 'Rotta', ip: '300.1.1.1' }] });
  const rifiuto = await app.aspetta((d) => d.tipo === 'esito' && d.id === 'c2');
  verifica('rifiuta un indirizzo IP non valido dalla PWA', rifiuto.ok === false && /non è valido/.test(rifiuto.errore), rifiuto.errore);

  app.invia({ tipo: 'configura', id: 'c3', account: { email: 'casa@esempio.it', password: 'segreta-di-prova' },
    prese: [{ nome: 'Nuova di casa', ip: '10.0.0.5' }, { id: 'presa1', nome: 'Ventilatore', ip: '192.168.50.10' }] });
  const salvata = await app.aspetta((d) => d.tipo === 'esito' && d.id === 'c3', 15000);
  const idNuova = salvata.prese?.find((p) => p.ip === '10.0.0.5')?.id;
  verifica('salva la nuova configurazione e prova ogni presa', salvata.ok && salvata.verifiche?.length === 2
    && salvata.verifiche.every((v) => v.ok), JSON.stringify(salvata));
  verifica('mantiene l\'id delle prese già note e ne dà uno nuovo alle altre',
    salvata.prese.find((p) => p.ip === '192.168.50.10')?.id === 'presa1' && idNuova && idNuova !== 'presa1');
  verifica('la password non torna mai alla PWA', !JSON.stringify(salvata).includes('segreta-di-prova')
    && salvata.account.passwordImpostata === true);
  const suDisco = JSON.parse(fs.readFileSync(fileConfig, 'utf-8'));
  verifica('la password resta solo nel config.json del ponte', suDisco.account.password === 'segreta-di-prova'
    && suDisco.prese.length === 2);
  app.invia({ tipo: 'configura', id: 'c4', account: { email: 'casa@esempio.it', password: '' } });
  await app.aspetta((d) => d.tipo === 'esito' && d.id === 'c4', 15000);
  verifica('una password vuota non cancella quella salvata',
    JSON.parse(fs.readFileSync(fileConfig, 'utf-8')).account.password === 'segreta-di-prova');

  app.inviaAGruppoSbagliato({ tipo: 'accendi', id: 'x1', secondi: 5 });
  await attendi(300);
  verifica('la PWA non puo\' scrivere nel gruppo delle app (ruoli del token)', rifiutati.includes(`mt-${CODICE}-app`));

  // Pagina locale
  const base = `http://127.0.0.1:${portaPagina}`;
  const stato = await (await fetch(`${base}/api/stato`)).json();
  verifica('la pagina locale mostra il codice formattato', stato.codice === 'PROV-A234-5678');
  verifica('la pagina locale non restituisce la password', !('password' in stato)
    && !JSON.stringify(stato).includes('segreta-di-prova') && stato.passwordImpostata === true);
  // fetch non permette di cambiare l'intestazione Host: uso http.request
  const codiceEstraneo = await new Promise((risolvi) => {
    http.get({ host: '127.0.0.1', port: portaPagina, path: '/api/stato', headers: { Host: 'sito-estraneo.example' } },
      (r) => { r.resume(); risolvi(r.statusCode); }).on('error', () => risolvi(0));
  });
  verifica('rifiuta nomi diversi da localhost (DNS rebinding)', codiceEstraneo === 403, `HTTP ${codiceEstraneo}`);
  const altroSito = await fetch(`${base}/api/prese/prova`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://sito-estraneo.example' },
    body: JSON.stringify({ id: 'presa1' }),
  });
  verifica('rifiuta comandi inviati da altri siti', altroSito.status === 403);
  const ipErrato = await fetch(`${base}/api/prese/aggiungi`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nome: 'X', ip: '999.1.1.1' }),
  });
  verifica('rifiuta un indirizzo IP non valido', ipErrato.status === 400);

  // Chiusura: le prese vanno spente
  ponte.kill('SIGINT');
  await new Promise((r) => ponte.once('exit', r));
  verifica('chiudendo il ponte le prese vengono spente', uscita.includes('Prese spente (chiusura del ponte)'));
} catch (errore) {
  verifica(`errore inatteso: ${errore.message}`, false);
  console.log(uscita);
} finally {
  ponte.kill('SIGKILL');
  app.chiudi();
  server.close();
  fs.rmSync(cartellaTemp, { recursive: true, force: true });
}

const falliti = risultati.filter((r) => !r.ok).length;
console.log(`\n${risultati.length - falliti} verifiche superate su ${risultati.length}.\n`);
process.exit(falliti ? 1 : 0);
