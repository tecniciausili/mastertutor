/**
 * server-locale.mjs
 * Server per provare Mastertutor sul proprio computer, presa compresa, senza Azure.
 * Si usa AL POSTO di "npx serve" (doppio clic su strumenti/prova-locale.command):
 *
 *   node strumenti/server-locale.mjs                  porta 3000, o la prima libera
 *   node strumenti/server-locale.mjs 3100             porta indicata
 *   node strumenti/server-locale.mjs --senza-ponte    non avvia il ponte
 *   node strumenti/server-locale.mjs --senza-browser  non apre il browser
 *   node strumenti/server-locale.mjs --simula         ponte con prese finte (prove senza hardware)
 *
 * Con un solo comando:
 *   - serve i file dell'app, come npx serve, e la apre nel browser;
 *   - risponde a /api/negotiate usando la VERA funzione dell'app (api/negotiate);
 *   - imita Azure Web PubSub (protocollo json.webpubsub.azure.v1);
 *   - avvia il PONTE (ponte/ponte.js) collegato a questo server, con le prese e
 *     l'account del suo config.json: i comandi arrivano alle prese vere.
 * Chiudendo (CTRL + C) si ferma anche il ponte, che spegne le prese.
 * Solo per prove: non richiede librerie esterne, basta Node.js 22.
 */

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, exec } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const RADICE = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const CHIAVE = 'chiave-solo-per-le-prove-locali';
const PROTOCOLLO = 'json.webpubsub.azure.v1';
const HUB = '/client/hubs/mastertutor';

// Cartelle che su Azure non vengono pubblicate
const RISERVATI = ['/ponte/', '/strumenti/', '/api/'];

const TIPI = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function ora() {
  return new Date().toLocaleTimeString('it-IT');
}

function portaLibera(partenza) {
  return new Promise((risolvi) => {
    const prova = net.createServer();
    prova.once('error', () => risolvi(portaLibera(partenza + 1)));
    prova.once('listening', () => prova.close(() => risolvi(partenza)));
    prova.listen(partenza);
  });
}

const argomenti = process.argv.slice(2);
const PORTA_RICHIESTA = Number(argomenti.find((a) => /^\d+$/.test(a))) || 3000;
const SENZA_PONTE = argomenti.includes('--senza-ponte');
const SENZA_BROWSER = argomenti.includes('--senza-browser');
const SIMULA = argomenti.includes('--simula');

const porta = await portaLibera(PORTA_RICHIESTA);
process.env.WEBPUBSUB_CONNECTION_STRING = `Endpoint=http://localhost:${porta};AccessKey=${CHIAVE};Version=1.0;`;
const negotiate = require(path.join(RADICE, 'api', 'negotiate', 'index.js'));

// ==================== FILE E /api/negotiate ====================

const server = http.createServer(async (richiesta, risposta) => {
  const url = new URL(richiesta.url, `http://localhost:${porta}`);
  const percorso = decodeURIComponent(url.pathname);

  if (percorso === '/api/negotiate') {
    const ctx = {};
    await negotiate(ctx, { query: Object.fromEntries(url.searchParams) });
    risposta.writeHead(ctx.res.status, ctx.res.headers);
    risposta.end(JSON.stringify(ctx.res.body));
    return;
  }

  const file = path.join(RADICE, percorso === '/' ? 'index.html' : percorso);
  const ammesso = file.startsWith(RADICE + path.sep) && !RISERVATI.some((r) => percorso.startsWith(r));
  if (!ammesso || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    risposta.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    risposta.end('Non trovato');
    return;
  }
  risposta.writeHead(200, {
    'Content-Type': TIPI[path.extname(file).toLowerCase()] || 'application/octet-stream',
    'Cache-Control': 'no-cache',
    'Permissions-Policy': 'microphone=(self)',
  });
  fs.createReadStream(file).pipe(risposta);
});

// ==================== FINTO AZURE WEB PUBSUB ====================

const gruppi = new Map();   // nome -> Set(cliente)

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

server.on('upgrade', (richiesta, socket) => {
  const url = new URL(richiesta.url, 'http://x');
  const token = url.searchParams.get('access_token') || '';
  const [testa, corpo, firma] = token.split('.');
  const attesa = crypto.createHmac('sha256', CHIAVE).update(`${testa}.${corpo}`).digest('base64url');
  if (url.pathname !== HUB || firma !== attesa) {
    socket.end('HTTP/1.1 401 Unauthorized\r\n\r\n');
    return;
  }
  const claim = JSON.parse(Buffer.from(corpo, 'base64url'));
  if (claim.exp * 1000 < Date.now()) {
    socket.end('HTTP/1.1 401 Unauthorized\r\n\r\n');
    return;
  }
  const accetta = crypto.createHash('sha1')
    .update(richiesta.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  const protocolli = String(richiesta.headers['sec-websocket-protocol'] || '').split(',').map((p) => p.trim());
  socket.write([
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${accetta}`,
    ...(protocolli.includes(PROTOCOLLO) ? [`Sec-WebSocket-Protocol: ${PROTOCOLLO}`] : []),
    '', '',
  ].join('\r\n'));

  const cliente = { socket, ruoli: claim.role || [], nome: String(claim.sub || '').split('-')[0] };
  for (const g of claim['webpubsub.group'] || []) {
    if (!gruppi.has(g)) {
      gruppi.set(g, new Set());
    }
    gruppi.get(g).add(cliente);
  }
  console.log(`${ora()}  collegato: ${cliente.nome === 'ponte' ? 'il PONTE' : 'una PWA'}`);
  inviaFrame(socket, JSON.stringify({ type: 'system', event: 'connected', userId: claim.sub, connectionId: crypto.randomUUID() }));

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
      if (opcode === 0x9) {
        socket.write(Buffer.concat([Buffer.from([0x8a, carico.length]), carico]));   // pong
        continue;
      }
      if (opcode !== 0x1) {
        continue;
      }
      let m;
      try {
        m = JSON.parse(Buffer.from(carico).toString('utf-8'));
      } catch {
        continue;
      }
      if (m.type !== 'sendToGroup' || !cliente.ruoli.includes(`webpubsub.sendToGroup.${m.group}`)) {
        continue;
      }
      const tipo = m.data?.tipo;
      if (tipo && tipo !== 'ping' && tipo !== 'pong') {
        console.log(`${ora()}  ${cliente.nome === 'ponte' ? 'ponte → PWA' : 'PWA → ponte'}: ${tipo}${m.data.secondi ? ` (${m.data.secondi} s)` : ''}`);
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

// ==================== PONTE E BROWSER ====================

let ponte = null;

function portaOccupata(numero) {
  return new Promise((risolvi) => {
    const prova = net.createServer();
    prova.once('error', () => risolvi(true));
    prova.once('listening', () => prova.close(() => risolvi(false)));
    prova.listen(numero, '127.0.0.1');
  });
}

async function avviaPonte(indirizzo) {
  // Se un ponte e' gia' acceso (pagina su 8124) non ne avvio un secondo:
  // due ponti comanderebbero le stesse prese
  if (await portaOccupata(8124)) {
    console.log('  Un ponte è già acceso: nella sua pagina (http://localhost:8124) scrivi');
    console.log(`  come indirizzo dell'app ${indirizzo}, oppure chiudilo e rilancia questo server.`);
    console.log('');
    return;
  }
  const opzioni = ['ponte.js', '--app', indirizzo, '--senza-browser', ...(SIMULA ? ['--simula'] : [])];
  ponte = spawn(process.execPath, opzioni, {
    cwd: path.join(RADICE, 'ponte'),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const inoltra = (dati) => {
    for (const riga of String(dati).split('\n')) {
      if (riga.trim()) {
        console.log(`  [ponte] ${riga}`);
      }
    }
  };
  ponte.stdout.on('data', inoltra);
  ponte.stderr.on('data', inoltra);
  ponte.on('exit', (codice) => {
    ponte = null;
    if (codice) {
      console.log(`  [ponte] si è fermato (codice ${codice})`);
    }
  });
}

function apriBrowser(indirizzo) {
  const comando = process.platform === 'win32' ? `start "" "${indirizzo}"`
    : process.platform === 'darwin' ? `open "${indirizzo}"`
      : `xdg-open "${indirizzo}"`;
  exec(comando, () => { /* se non si apre, l'indirizzo resta stampato */ });
}

// CTRL + C: fermo prima il ponte (che spegne le prese), poi il server
async function chiudi() {
  if (ponte) {
    ponte.kill('SIGINT');
    await Promise.race([
      new Promise((r) => ponte?.once('exit', r)),
      new Promise((r) => setTimeout(r, 7000)),
    ]);
  }
  process.exit(0);
}
process.on('SIGINT', chiudi);
process.on('SIGTERM', chiudi);

server.listen(porta, async () => {
  const indirizzo = `http://localhost:${porta}`;
  const rete = Object.values(os.networkInterfaces()).flat()
    .find((i) => i && i.family === 'IPv4' && !i.internal)?.address;
  console.log('');
  console.log(' ============================================================');
  console.log('  Mastertutor: prova in locale, presa compresa (al posto di npx serve)');
  console.log(`  App:                  ${indirizzo}`);
  if (rete) {
    console.log(`  Da un tablet in rete: http://${rete}:${porta}  (senza microfono: serve https)`);
  }
  console.log('  Per fermare tutto:    CTRL + C (il ponte spegne le prese)');
  console.log(' ============================================================');
  if (porta !== PORTA_RICHIESTA) {
    console.log('');
    console.log(`  ATTENZIONE: la porta ${PORTA_RICHIESTA} è occupata (npx serve è ancora acceso?).`);
    console.log(`  Audio e video salvati su http://localhost:${PORTA_RICHIESTA} NON compaiono su ${indirizzo}:`);
    console.log('  ogni indirizzo ha i suoi dati. Chiudi l\'altro server e rilancia questo.');
  }
  console.log('');
  if (!SENZA_PONTE) {
    await avviaPonte(indirizzo);
  }
  if (!SENZA_BROWSER) {
    apriBrowser(indirizzo);
  }
});
