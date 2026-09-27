/**
 * ponte.js
 * Ponte fra la PWA Mastertutor e le prese Tapo della rete locale.
 *
 *   PWA (computer, tablet, telefono) -> Azure Web PubSub -> PONTE -> prese Tapo
 *
 * Una pagina web non puo' parlare con le prese della rete locale: il browser lo
 * impedisce. Il ponte e' il programma che lo fa al suo posto. Fa tre cose:
 *   - si collega ad Azure Web PubSub con il proprio codice di abbinamento e resta
 *     in ascolto dei comandi della PWA (e' lui a chiamare internet: sul router non
 *     va aperto nulla);
 *   - accende le prese quando la PWA lo chiede e le rispegne DA SOLO allo scadere
 *     del tempo, anche se il tablet perde la connessione;
 *   - offre una pagina locale (http://localhost:8124) per configurare prese e account.
 *
 * Non richiede librerie esterne: basta Node.js 22 o successivo.
 *
 * Uso:
 *   node ponte.js                 avvio normale, apre la pagina di configurazione
 *   node ponte.js --simula        prese finte, per provare senza hardware
 *   node ponte.js --porta 8200    pagina locale su un'altra porta
 *   node ponte.js --senza-browser non apre il browser (es. Raspberry Pi)
 *   node ponte.js --config altro.json  usa un altro file di configurazione
 *   node ponte.js --app http://localhost:3000  indirizzo dell'app solo per questa volta
 *                                 (lo usa il server di prova; config.json non cambia)
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import net from 'node:net';
import { exec } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { leggiStato, comanda, dimentica } from './tapo/prese.js';

const VERSIONE = '1.0.0';
const CARTELLA = path.dirname(fileURLToPath(import.meta.url));
const FILE_PAGINA = path.join(CARTELLA, 'pagina.html');
const PORTA_PREDEFINITA = 8124;
const PROTOCOLLO = 'json.webpubsub.azure.v1';
const MAX_SECONDI = 600;
const TENTATIVI_SPEGNIMENTO = 3;
// Niente 0/O e 1/I: il codice si legge e si trascrive senza confondersi
const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const argomenti = process.argv.slice(2);
const SIMULA = argomenti.includes('--simula');
const SENZA_BROWSER = argomenti.includes('--senza-browser');
const posPorta = argomenti.indexOf('--porta');
const PORTA_RICHIESTA = posPorta >= 0 ? Number(argomenti[posPorta + 1]) || PORTA_PREDEFINITA : PORTA_PREDEFINITA;
const posConfig = argomenti.indexOf('--config');
const FILE_CONFIG = posConfig >= 0 && argomenti[posConfig + 1]
  ? path.resolve(argomenti[posConfig + 1])
  : path.join(CARTELLA, 'config.json');
const posApp = argomenti.indexOf('--app');
const APP_TEMPORANEA = posApp >= 0 && argomenti[posApp + 1] ? normalizzaApp(argomenti[posApp + 1]) : '';

if (typeof WebSocket !== 'function' || typeof fetch !== 'function') {
  console.error('\n  Il ponte richiede Node.js 22 o successivo (questa e\' la versione ' + process.version + ').');
  console.error('  Scaricalo da https://nodejs.org (versione "LTS").\n');
  process.exit(1);
}

function log(...parti) {
  console.log(new Date().toLocaleTimeString('it-IT'), ...parti);
}

// ==================== CONFIGURAZIONE ====================

function nuovoCodice() {
  // 256 e' multiplo di 32: ogni carattere ha la stessa probabilita'
  return [...crypto.randomBytes(12)].map((b) => ALFABETO[b % ALFABETO.length]).join('');
}

function formattaCodice(codice) {
  return codice.replace(/(.{4})(?=.)/g, '$1-');
}

function normalizzaApp(indirizzo) {
  return String(indirizzo || '').trim().replace(/\/+$/, '').replace(/\/index\.html$/i, '');
}

// Indirizzo dell'app in uso: quello passato con --app vale solo per questa esecuzione
function appAttiva() {
  return APP_TEMPORANEA || config.app;
}

function leggiConfig() {
  let grezza = {};
  try {
    grezza = JSON.parse(fs.readFileSync(FILE_CONFIG, 'utf-8'));
  } catch {
    /* primo avvio: configurazione vuota */
  }
  const codice = String(grezza.codice || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return {
    app: normalizzaApp(grezza.app),
    codice: codice.length === 12 ? codice : '',
    account: {
      email: String(grezza.account?.email || '').trim(),
      password: String(grezza.account?.password || ''),
    },
    prese: (Array.isArray(grezza.prese) ? grezza.prese : [])
      .filter((p) => p && p.ip)
      .map((p, i) => ({
        id: String(p.id || `presa${i + 1}`),
        nome: String(p.nome || `Presa ${i + 1}`).trim(),
        ip: String(p.ip).trim(),
      })),
  };
}

function scriviConfig() {
  fs.writeFileSync(FILE_CONFIG, JSON.stringify(config, null, 2) + '\n', { encoding: 'utf-8', mode: 0o600 });
}

const config = leggiConfig();
if (!config.codice) {
  config.codice = nuovoCodice();
  scriviConfig();
}

// ==================== PRESE ====================

const accese = new Map();   // id -> { timer, fino }

function credenziali(presa) {
  return { ip: presa.ip, email: config.account.email, password: config.account.password };
}

async function comandaPresa(presa, acceso) {
  if (SIMULA) {
    log(`[simulazione] ${presa.nome}: ${acceso ? 'ACCESA' : 'spenta'}`);
    return { acceso, protocollo: 'simulazione' };
  }
  return comanda(credenziali(presa), acceso);
}

async function statoPresa(presa) {
  if (SIMULA) {
    return { acceso: accese.has(presa.id), protocollo: 'simulazione', nome: presa.nome };
  }
  return leggiStato(credenziali(presa));
}

function manca() {
  if (config.prese.length === 0) {
    return 'Sul ponte non ci sono prese configurate.';
  }
  if (!SIMULA && !(config.account.email && config.account.password)) {
    return 'Sul ponte manca l\'account Tapo (email e password).';
  }
  return '';
}

// Prese richieste dalla PWA; se l'elenco e' vuoto (o non corrisponde) valgono tutte
function selezione(ids) {
  if (!Array.isArray(ids) || ids.length === 0) {
    return config.prese;
  }
  const scelte = config.prese.filter((p) => ids.includes(p.id));
  return scelte.length > 0 ? scelte : config.prese;
}

function riassunto(risultati) {
  const errori = risultati.filter((r) => !r.ok)
    .map((r) => `${config.prese.find((p) => p.id === r.id)?.nome || r.id}: ${r.errore}`);
  return {
    ok: risultati.some((r) => r.ok),
    prese: risultati,
    errore: errori.join(' · '),
  };
}

async function accendi(ids, secondi) {
  const problema = manca();
  if (problema) {
    return { ok: false, errore: problema };
  }
  const durata = Math.min(MAX_SECONDI, Math.max(1, Number(secondi) || 5));
  const risultati = await Promise.all(selezione(ids).map(async (presa) => {
    try {
      const gia = accese.get(presa.id);
      if (gia) {
        clearTimeout(gia.timer); // gia' accesa: allungo soltanto il tempo
      } else {
        await comandaPresa(presa, true);
      }
      const timer = setTimeout(() => spegniUna(presa, 'tempo scaduto'), durata * 1000);
      accese.set(presa.id, { timer, fino: Date.now() + durata * 1000 });
      return { id: presa.id, ok: true };
    } catch (errore) {
      return { id: presa.id, ok: false, errore: errore.message };
    }
  }));
  const esito = riassunto(risultati);
  log(`Accensione per ${durata} s: ${risultati.map((r) => `${config.prese.find((p) => p.id === r.id)?.nome} ${r.ok ? 'ok' : `ERRORE (${r.errore})`}`).join(', ')}`);
  return esito;
}

// Spegnimento con qualche nuovo tentativo: una presa non deve restare accesa per un errore di rete
async function spegniUna(presa, motivo, tentativo = 1) {
  const voce = accese.get(presa.id);
  if (voce) {
    clearTimeout(voce.timer);
    accese.delete(presa.id);
  }
  try {
    await comandaPresa(presa, false);
    log(`Spenta: ${presa.nome} (${motivo})`);
    inviaApp({ tipo: 'spenta', prese: [presa.id] });
    return { id: presa.id, ok: true };
  } catch (errore) {
    if (tentativo < TENTATIVI_SPEGNIMENTO) {
      log(`Spegnimento di ${presa.nome} non riuscito (${errore.message}): riprovo tra 3 secondi`);
      setTimeout(() => spegniUna(presa, motivo, tentativo + 1), 3000);
    } else {
      log(`ATTENZIONE: ${presa.nome} potrebbe essere rimasta ACCESA: ${errore.message}`);
    }
    return { id: presa.id, ok: false, errore: errore.message };
  }
}

async function spegni(ids) {
  const risultati = await Promise.all(selezione(ids).map((p) => spegniUna(p, 'comando dalla PWA')));
  return risultati.length ? riassunto(risultati) : { ok: true, prese: [], errore: '' };
}

async function spegniTutte(motivo) {
  if (manca()) {
    return;
  }
  await Promise.all(config.prese.map(async (presa) => {
    const voce = accese.get(presa.id);
    if (voce) {
      clearTimeout(voce.timer);
      accese.delete(presa.id);
    }
    try {
      await comandaPresa(presa, false);
    } catch (errore) {
      log(`${presa.nome}: non raggiungibile (${errore.message})`);
    }
  }));
  log(`Prese spente (${motivo})`);
}

// ==================== AZURE WEB PUBSUB ====================

const collegamento = { stato: 'non-configurato', errore: '', ultimoComando: 0 };
let ws = null;
let destinatario = '';
let tentativi = 0;
let timerRiconnessione = null;
let attivo = true;

function descrizione() {
  return {
    prese: config.prese.map((p) => ({ id: p.id, nome: p.nome, ip: p.ip })),
    versione: VERSIONE,
    simulazione: SIMULA,
  };
}

function inviaApp(dati) {
  if (ws && ws.readyState === WebSocket.OPEN && destinatario) {
    ws.send(JSON.stringify({ type: 'sendToGroup', group: destinatario, dataType: 'json', data: dati }));
  }
}

function chiudiCollegamento() {
  clearTimeout(timerRiconnessione);
  if (ws) {
    const vecchio = ws;
    ws = null;
    try {
      vecchio.close();
    } catch { /* gia' chiuso */ }
  }
}

function programmaRiconnessione() {
  clearTimeout(timerRiconnessione);
  if (!attivo || !appAttiva()) {
    return;
  }
  const attesa = Math.min(60000, 2000 * 2 ** Math.min(tentativi, 5));
  tentativi++;
  timerRiconnessione = setTimeout(collegaServizio, attesa);
}

async function collegaServizio() {
  chiudiCollegamento();
  if (!appAttiva()) {
    collegamento.stato = 'non-configurato';
    collegamento.errore = 'Manca l\'indirizzo dell\'app su Azure.';
    return;
  }
  collegamento.stato = 'connessione';
  try {
    const url = `${appAttiva()}/api/negotiate?ruolo=ponte&codice=${config.codice}`;
    const risposta = await fetch(url, { signal: AbortSignal.timeout(15000), cache: 'no-store' });
    const testo = await risposta.text();
    let dati;
    try {
      dati = JSON.parse(testo);
    } catch {
      throw new Error(`L'indirizzo ${appAttiva()} non risponde come Mastertutor: e' quello giusto?`);
    }
    if (!risposta.ok) {
      throw new Error(dati.errore || `Errore del servizio (HTTP ${risposta.status})`);
    }

    destinatario = dati.destinatario;
    const socket = new WebSocket(dati.url, PROTOCOLLO);
    ws = socket;
    socket.addEventListener('open', () => {
      tentativi = 0;
      collegamento.stato = 'collegato';
      collegamento.errore = '';
      log(`Collegato al servizio (${appAttiva()}): il ponte e' pronto a ricevere i comandi.`);
      inviaApp({ tipo: 'ciao', ...descrizione() });
    });
    socket.addEventListener('message', (evento) => {
      gestisci(evento.data).catch((e) => log('Errore nel comando:', e.message));
    });
    socket.addEventListener('close', () => {
      if (ws !== socket) {
        return;
      }
      ws = null;
      collegamento.stato = 'connessione';
      if (attivo) {
        log('Collegamento con Azure interrotto: riprovo.');
        programmaRiconnessione();
      }
    });
    socket.addEventListener('error', () => {
      collegamento.errore = 'Errore di rete verso Azure.';
    });
  } catch (errore) {
    collegamento.stato = 'errore';
    collegamento.errore = errore.name === 'TimeoutError' ? 'Azure non risponde: il computer e\' collegato a internet?' : errore.message;
    log(`Collegamento non riuscito: ${collegamento.errore}`);
    programmaRiconnessione();
  }
}

// ==================== CONFIGURAZIONE DALLA PWA ====================
// Le prese valgono per una rete: a casa se ne comprano di nuove e si riconfigura
// tutto dalla finestra "Configura le prese" della PWA. La password dell'account
// arriva cifrata attraverso Azure, viene salvata solo qui e non torna mai indietro.

const MAX_PRESE = 10;

function leggiConfigurazione() {
  return {
    account: { email: config.account.email, passwordImpostata: Boolean(config.account.password) },
    prese: config.prese.map((p) => ({ id: p.id, nome: p.nome, ip: p.ip })),
    versione: VERSIONE,
    simulazione: SIMULA,
  };
}

// Controlla e normalizza l'elenco delle prese; mantiene l'id di quelle gia' note
function validaPrese(elenco) {
  if (!Array.isArray(elenco)) {
    throw new Error('Elenco delle prese non valido.');
  }
  if (elenco.length > MAX_PRESE) {
    throw new Error(`Al massimo ${MAX_PRESE} prese per ponte.`);
  }
  const usati = new Set();
  const indirizzi = new Set();
  const risultato = elenco.map((voce, i) => {
    const nome = String(voce?.nome || '').trim().slice(0, 60);
    const ip = String(voce?.ip || '').trim();
    if (!nome) {
      throw new Error(`Presa ${i + 1}: manca il nome.`);
    }
    if (!net.isIPv4(ip)) {
      throw new Error(`"${nome}": l'indirizzo IP "${ip}" non è valido (esempio: 192.168.1.65).`);
    }
    if (indirizzi.has(ip)) {
      throw new Error(`L'indirizzo ${ip} compare due volte.`);
    }
    indirizzi.add(ip);
    const nota = config.prese.find((p) => p.id === voce.id) || config.prese.find((p) => p.ip === ip);
    let id = nota && !usati.has(nota.id) ? nota.id : '';
    if (!id) {
      let n = 1;
      while (usati.has(`presa${n}`) || config.prese.some((p) => p.id === `presa${n}` && p.ip !== ip)) {
        n++;
      }
      id = `presa${n}`;
    }
    usati.add(id);
    return { id, nome, ip };
  });
  return risultato;
}

async function configura(dati) {
  const nuovoAccount = { ...config.account };
  if (dati.account) {
    const email = String(dati.account.email || '').trim();
    if (!email) {
      throw new Error('Manca l\'email dell\'account Tapo.');
    }
    nuovoAccount.email = email;
    if (dati.account.password) {
      nuovoAccount.password = String(dati.account.password);
    }
  }
  const nuovePrese = dati.prese ? validaPrese(dati.prese) : config.prese;

  // Prima di cambiare, spengo quelle accese: il comando di spegnimento deve
  // arrivare alla presa vecchia, non a quella nuova con lo stesso nome
  await Promise.all([...accese.keys()].map((id) => {
    const presa = config.prese.find((p) => p.id === id);
    return presa ? spegniUna(presa, 'nuova configurazione') : null;
  }));

  config.account = nuovoAccount;
  config.prese = nuovePrese;
  scriviConfig();
  dimentica();
  log(`Configurazione aggiornata dalla PWA: ${config.prese.map((p) => `${p.nome} (${p.ip})`).join(', ') || 'nessuna presa'}`);
  inviaApp({ tipo: 'ciao', ...descrizione() });

  // Verifico subito ogni presa, cosi' chi configura sa se e' tutto a posto
  const problema = manca();
  const verifiche = await Promise.all(config.prese.map(async (presa) => {
    if (problema) {
      return { id: presa.id, nome: presa.nome, ip: presa.ip, ok: false, errore: problema };
    }
    try {
      const stato = await statoPresa(presa);
      return { id: presa.id, nome: presa.nome, ip: presa.ip, ok: true, acceso: stato.acceso, protocollo: stato.protocollo };
    } catch (errore) {
      return { id: presa.id, nome: presa.nome, ip: presa.ip, ok: false, errore: errore.message };
    }
  }));
  return { ...leggiConfigurazione(), verifiche };
}

async function gestisci(testo) {
  let messaggio;
  try {
    messaggio = JSON.parse(typeof testo === 'string' ? testo : String(testo));
  } catch {
    return;
  }
  if (messaggio.type !== 'message' || !messaggio.data || typeof messaggio.data !== 'object') {
    return;
  }
  const d = messaggio.data;
  collegamento.ultimoComando = Date.now();
  if (d.tipo === 'ping') {
    inviaApp({ tipo: 'pong', id: d.id, ...descrizione() });
  } else if (d.tipo === 'accendi') {
    inviaApp({ tipo: 'esito', id: d.id, ...(await accendi(d.prese, d.secondi)) });
  } else if (d.tipo === 'spegni') {
    inviaApp({ tipo: 'esito', id: d.id, ...(await spegni(d.prese)) });
  } else if (d.tipo === 'leggi-config') {
    inviaApp({ tipo: 'config', id: d.id, ...leggiConfigurazione() });
  } else if (d.tipo === 'configura') {
    try {
      inviaApp({ tipo: 'esito', id: d.id, ok: true, ...(await configura(d)) });
    } catch (errore) {
      inviaApp({ tipo: 'esito', id: d.id, ok: false, errore: errore.message });
    }
  }
}

// ==================== PAGINA LOCALE DI CONFIGURAZIONE ====================

let porta = PORTA_RICHIESTA;

function inviaJson(risposta, codice, contenuto) {
  risposta.writeHead(codice, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  risposta.end(JSON.stringify(contenuto));
}

function leggiCorpo(richiesta) {
  return new Promise((risolvi, rifiuta) => {
    let testo = '';
    richiesta.setEncoding('utf-8');
    richiesta.on('data', (pezzo) => {
      testo += pezzo;
      if (testo.length > 10000) {
        rifiuta(new Error('Richiesta troppo grande'));
        richiesta.destroy();
      }
    });
    richiesta.on('end', () => {
      try {
        risolvi(testo ? JSON.parse(testo) : {});
      } catch {
        rifiuta(new Error('Dati non validi'));
      }
    });
    richiesta.on('error', rifiuta);
  });
}

// La pagina risponde solo a se stessa: niente richieste da altri siti o da nomi diversi da localhost
function richiestaAmmessa(richiesta) {
  const ammessi = [`localhost:${porta}`, `127.0.0.1:${porta}`];
  if (!ammessi.includes(richiesta.headers.host)) {
    return false;
  }
  if (richiesta.method !== 'GET') {
    const origine = richiesta.headers.origin;
    if (origine && !ammessi.map((a) => `http://${a}`).includes(origine)) {
      return false;
    }
    if (!String(richiesta.headers['content-type'] || '').includes('application/json')) {
      return false;
    }
  }
  return true;
}

function statoPerPagina() {
  return {
    versione: VERSIONE,
    simulazione: SIMULA,
    codice: formattaCodice(config.codice),
    app: appAttiva(),
    appTemporanea: Boolean(APP_TEMPORANEA),
    collegamento: collegamento.stato,
    errore: collegamento.errore,
    ultimoComando: collegamento.ultimoComando,
    email: config.account.email,
    passwordImpostata: Boolean(config.account.password),
    prese: config.prese.map((p) => ({ ...p, accesa: accese.has(p.id) })),
  };
}

async function gestisciApi(richiesta, risposta, percorso) {
  if (percorso === '/api/stato' && richiesta.method === 'GET') {
    inviaJson(risposta, 200, statoPerPagina());
    return;
  }
  if (richiesta.method !== 'POST') {
    inviaJson(risposta, 404, { errore: 'Rotta sconosciuta' });
    return;
  }
  const corpo = await leggiCorpo(richiesta);

  if (percorso === '/api/app') {
    const app = normalizzaApp(corpo.app);
    if (app && !/^https:\/\/[^/\s]+$/i.test(app) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(app)) {
      inviaJson(risposta, 400, { errore: 'Scrivi l\'indirizzo completo dell\'app, per esempio https://nome.azurestaticapps.net' });
      return;
    }
    config.app = app;
    scriviConfig();
    // Con un indirizzo temporaneo (server di prova) il nuovo vale dal prossimo avvio
    if (!APP_TEMPORANEA) {
      tentativi = 0;
      collegaServizio();
    }
    inviaJson(risposta, 200, statoPerPagina());
    return;
  }

  if (percorso === '/api/account') {
    const email = String(corpo.email || '').trim();
    const password = corpo.password ? String(corpo.password) : config.account.password;
    if (!email || !password) {
      inviaJson(risposta, 400, { errore: 'Servono email e password dell\'account Tapo.' });
      return;
    }
    config.account = { email, password };
    scriviConfig();
    dimentica();
    inviaJson(risposta, 200, statoPerPagina());
    return;
  }

  if (percorso === '/api/prese/aggiungi') {
    const nome = String(corpo.nome || '').trim();
    const ip = String(corpo.ip || '').trim();
    if (!nome || net.isIPv4(ip) === false) {
      inviaJson(risposta, 400, { errore: 'Servono un nome e un indirizzo IP valido (es. 192.168.1.65).' });
      return;
    }
    if (config.prese.some((p) => p.ip === ip)) {
      inviaJson(risposta, 400, { errore: 'C\'e\' gia\' una presa con questo indirizzo.' });
      return;
    }
    let n = config.prese.length + 1;
    while (config.prese.some((p) => p.id === `presa${n}`)) {
      n++;
    }
    config.prese.push({ id: `presa${n}`, nome, ip });
    scriviConfig();
    inviaApp({ tipo: 'ciao', ...descrizione() });
    inviaJson(risposta, 200, statoPerPagina());
    return;
  }

  const presa = config.prese.find((p) => p.id === corpo.id);
  if (percorso.startsWith('/api/prese/') && !presa) {
    inviaJson(risposta, 404, { errore: 'Presa non trovata.' });
    return;
  }

  if (percorso === '/api/prese/elimina') {
    await spegniUna(presa, 'eliminata dalla configurazione').catch(() => {});
    config.prese = config.prese.filter((p) => p.id !== presa.id);
    dimentica(presa.ip);
    scriviConfig();
    inviaApp({ tipo: 'ciao', ...descrizione() });
    inviaJson(risposta, 200, statoPerPagina());
    return;
  }

  if (percorso === '/api/prese/verifica') {
    const problema = SIMULA ? '' : (!(config.account.email && config.account.password) ? 'Inserisci prima l\'account Tapo.' : '');
    if (problema) {
      inviaJson(risposta, 400, { errore: problema });
      return;
    }
    try {
      const esito = await statoPresa(presa);
      inviaJson(risposta, 200, { ok: true, ...esito });
    } catch (errore) {
      inviaJson(risposta, 200, { ok: false, errore: errore.message });
    }
    return;
  }

  if (percorso === '/api/prese/prova') {
    const esito = await accendi([presa.id], 3);
    inviaJson(risposta, 200, esito);
    return;
  }

  if (percorso === '/api/codice/nuovo') {
    config.codice = nuovoCodice();
    scriviConfig();
    log(`Nuovo codice di abbinamento: ${formattaCodice(config.codice)}`);
    tentativi = 0;
    collegaServizio();
    inviaJson(risposta, 200, statoPerPagina());
    return;
  }

  inviaJson(risposta, 404, { errore: 'Rotta sconosciuta' });
}

const server = http.createServer(async (richiesta, risposta) => {
  if (!richiestaAmmessa(richiesta)) {
    risposta.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    risposta.end('Accesso consentito solo da questo computer.');
    return;
  }
  const percorso = new URL(richiesta.url, `http://localhost:${porta}`).pathname;
  try {
    if (percorso.startsWith('/api/')) {
      await gestisciApi(richiesta, risposta, percorso);
      return;
    }
    if (percorso === '/' || percorso === '/index.html') {
      risposta.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      risposta.end(fs.readFileSync(FILE_PAGINA));
      return;
    }
    risposta.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    risposta.end('Non trovato');
  } catch (errore) {
    inviaJson(risposta, 500, { errore: errore.message });
  }
});

function portaLibera(partenza) {
  return new Promise((risolvi) => {
    const prova = net.createServer();
    prova.once('error', () => risolvi(portaLibera(partenza + 1)));
    prova.once('listening', () => prova.close(() => risolvi(partenza)));
    prova.listen(partenza, '127.0.0.1');
  });
}

function apriBrowser(indirizzo) {
  const comando = process.platform === 'win32' ? `start "" "${indirizzo}"`
    : process.platform === 'darwin' ? `open "${indirizzo}"`
      : `xdg-open "${indirizzo}"`;
  exec(comando, () => { /* se il browser non si apre, l'indirizzo resta stampato a video */ });
}

// ==================== AVVIO E CHIUSURA ====================

async function chiudi() {
  if (!attivo) {
    process.exit(0);
  }
  attivo = false;
  log('Chiusura: spengo le prese...');
  chiudiCollegamento();
  await Promise.race([spegniTutte('chiusura del ponte'), new Promise((r) => setTimeout(r, 6000))]);
  process.exit(0);
}
process.on('SIGINT', chiudi);
process.on('SIGTERM', chiudi);

// Un ponte e' gia' acceso su questo computer (per esempio con l'avvio automatico)?
// Allora non ne avvio un secondo, che comanderebbe le stesse prese: apro la sua pagina.
async function ponteGiaAcceso() {
  try {
    const risposta = await fetch(`http://localhost:${PORTA_RICHIESTA}/api/stato`, { signal: AbortSignal.timeout(1500) });
    const stato = await risposta.json();
    return typeof stato.codice === 'string';
  } catch {
    return false;
  }
}

if (await ponteGiaAcceso()) {
  console.log('');
  console.log(`  Il ponte e' gia' acceso su questo computer: pagina http://localhost:${PORTA_RICHIESTA}`);
  console.log('  Non ne avvio un secondo.');
  console.log('');
  if (!SENZA_BROWSER) {
    apriBrowser(`http://localhost:${PORTA_RICHIESTA}`);
  }
  process.exit(0);
}

porta = await portaLibera(PORTA_RICHIESTA);
server.listen(porta, '127.0.0.1', () => {
  const indirizzo = `http://localhost:${porta}`;
  console.log('');
  console.log(' ============================================================');
  console.log(`  Ponte Mastertutor ${VERSIONE}${SIMULA ? '  (SIMULAZIONE: prese finte)' : ''}`);
  console.log(`  Codice di abbinamento:  ${formattaCodice(config.codice)}`);
  console.log(`  Configurazione:         ${indirizzo}`);
  console.log(`  App:                    ${appAttiva() || 'da impostare nella pagina di configurazione'}${APP_TEMPORANEA ? '  (temporanea, server di prova)' : ''}`);
  console.log(`  Prese:                  ${config.prese.length ? config.prese.map((p) => `${p.nome} (${p.ip})`).join(', ') : 'nessuna'}`);
  console.log('  Per fermare il ponte:   CTRL + C (le prese vengono spente)');
  console.log(' ============================================================');
  console.log('');
  if (!SENZA_BROWSER) {
    apriBrowser(indirizzo);
  }
});

// Per sicurezza, all'avvio spengo tutto: una chiusura improvvisa potrebbe aver lasciato una presa accesa
await spegniTutte('avvio del ponte');
collegaServizio();
