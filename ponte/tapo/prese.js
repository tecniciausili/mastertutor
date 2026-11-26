/**
 * prese.js
 * Accesso alle prese Tapo per il ponte. Deriva da dispositivo.js delle app di
 * CHIARA (stessa scelta automatica del protocollo, stessi messaggi d'errore),
 * ma gestisce piu' prese insieme: una sessione per ogni indirizzo.
 *
 * Le prese parlano KLAP v2 (firmware recenti) o Secure Passthrough (fino alla
 * 1.3.x): si prova il primo, si ricade sul secondo e poi si ricorda l'esito.
 *
 * I comandi alla stessa presa vengono messi in fila, e fra due comandi passa
 * almeno ATTESA_MINIMA_MS: la presa e' un interruttore che scatta davvero, e
 * un doppio scatto ravvicinato su certi apparecchi e' dannoso.
 */

import { TapoDevice } from './klap.js';
import { TapoPassthroughDevice } from './passthrough.js';
import { scopriPresa } from './scoperta.js';

const ATTESA_MINIMA_MS = 500;

const sessioni = new Map();   // ip -> { chiave, protocollo, apparecchio }
const code = new Map();       // ip -> { ultima: Promise, ultimoComando: ms }

const chiaveDi = ({ ip, email, password }) => `${ip}|${email}|${password}`;
const attendi = (ms) => new Promise((r) => setTimeout(r, ms));

/** Dimentica la sessione di una presa (o di tutte): il prossimo comando rifa' l'handshake. */
export function dimentica(ip) {
  if (ip) {
    sessioni.delete(ip);
  } else {
    sessioni.clear();
  }
}

/** Esegue le operazioni sulla stessa presa una alla volta. */
function inFila(ip, operazione) {
  const coda = code.get(ip) || { ultima: Promise.resolve(), ultimoComando: 0 };
  const eseguita = coda.ultima.catch(() => {}).then(async () => {
    const trascorso = Date.now() - coda.ultimoComando;
    if (trascorso < ATTESA_MINIMA_MS) {
      await attendi(ATTESA_MINIMA_MS - trascorso);
    }
    try {
      return await operazione();
    } finally {
      coda.ultimoComando = Date.now();
    }
  });
  coda.ultima = eseguita;
  code.set(ip, coda);
  return eseguita;
}

// Dopo il messaggio di scoperta il servizio locale di una presa appena accesa parte in circa 12 s
const TENTATIVI_AVVIO = 6;
const ATTESA_AVVIO_MS = 3000;

async function prova(Classe, ip, email, password) {
  const apparecchio = new Classe(ip, email, password);
  await apparecchio.getInfo();
  return apparecchio;
}

/** Una prova di collegamento con i due protocolli, nell'ordine suggerito dalla scoperta. */
async function collega(ip, email, password, protocolloScoperto) {
  const ordine = protocolloScoperto === 'AES'
    ? [['passthrough', TapoPassthroughDevice], ['klap', TapoDevice]]
    : [['klap', TapoDevice], ['passthrough', TapoPassthroughDevice]];
  const errori = {};
  for (const [nome, Classe] of ordine) {
    try {
      return { protocollo: nome, apparecchio: await prova(Classe, ip, email, password) };
    } catch (e) {
      errori[nome] = e;
    }
  }
  const errore = new Error(descriviErrore(errori.klap, errori.passthrough));
  errore.rifiutata = [errori.klap, errori.passthrough].every((e) => String(e?.message || e).includes('ECONNREFUSED'));
  throw errore;
}

async function apri(presa) {
  const chiave = chiaveDi(presa);
  const esistente = sessioni.get(presa.ip);
  if (esistente && esistente.chiave === chiave) {
    return esistente;
  }

  const { ip, email, password } = presa;
  // Messaggio di scoperta: «sveglia» il servizio locale delle P110 con firmware 1.4.x
  // (senza, dopo l'accensione resta spento per 8-9 minuti) e dice quale protocollo usano
  const scoperta = await scopriPresa(ip);
  if (scoperta?.protocollo === 'TPAP') {
    throw new Error(MESSAGGIO_TERZE_PARTI);
  }

  for (let n = 1; ; n++) {
    try {
      const { protocollo, apparecchio } = await collega(ip, email, password, scoperta?.protocollo);
      const sessione = { chiave, protocollo, apparecchio };
      sessioni.set(ip, sessione);
      return sessione;
    } catch (errore) {
      // La presa c'è (ha risposto alla scoperta) ma il servizio locale sta ancora partendo
      if (!(errore.rifiutata && scoperta && n < TENTATIVI_AVVIO)) {
        throw errore;
      }
      await attendi(ATTESA_AVVIO_MS);
    }
  }
}

const MESSAGGIO_TERZE_PARTI = 'La presa non accetta comandi da altri programmi. Nell\'app Tapo del telefono: '
  + 'Io (in basso a destra) → Servizi di terze parti → attivare «Compatibilità con terze parti»; '
  + 'poi staccare e riattaccare la presa e premere di nuovo «Salva».';

/** Traduce in una frase leggibile il fallimento di entrambi i protocolli. */
export function descriviErrore(erroreKlap, errorePassthrough) {
  const testoKlap = String(erroreKlap?.message || erroreKlap);
  const testoPassthrough = String(errorePassthrough?.message || errorePassthrough);
  // Le prese con firmware vecchio non conoscono KLAP (404): conta l'errore dell'altro protocollo
  const testo = testoKlap.includes('HTTP 404') ? testoPassthrough : testoKlap;

  // 403 a KLAP, oppure la presa risponde ma né KLAP né AES vanno (pagina HTML, AES rifiutato
  // con 1003...): così i firmware recenti dicono che la compatibilità con terze parti è spenta
  const rispondeMaNonParla = testoKlap.includes('KLAP non disponibile')
    && /HTTP 404|Passthrough (handshake|risposta)/.test(testoPassthrough);
  if (testoKlap.includes('403') || rispondeMaNonParla) {
    return MESSAGGIO_TERZE_PARTI;
  }
  if (testo.includes('hash mismatch')) {
    return 'Email o password non corrispondono all\'account Tapo. '
      + 'Sono le stesse credenziali usate per accedere all\'app Tapo sul telefono.';
  }
  if (testo.includes('EHOSTUNREACH') || testo.includes('ENETUNREACH')) {
    return 'Indirizzo irraggiungibile: la presa non e\' sulla stessa rete del computer.';
  }
  if (testo.includes('ECONNREFUSED')) {
    return 'La presa a questo indirizzo non accetta collegamenti: se è stata appena attaccata, '
      + 'aspettare un minuto e riprovare; altrimenti controllare l\'indirizzo IP nell\'app Tapo '
      + '(Impostazioni della presa → Informazioni dispositivo).';
  }
  if (testo.includes('Timeout') || testo.includes('ETIMEDOUT')) {
    return 'La presa non risponde: controllare che l\'indirizzo sia corretto e che la presa sia alimentata.';
  }
  return `Collegamento non riuscito. KLAP: ${testoKlap} | Passthrough: ${testoPassthrough}`;
}

/** Il nome dato alla presa nell'app Tapo viaggia codificato in base64. */
function decodificaNome(nickname) {
  if (!nickname) {
    return '';
  }
  try {
    return Buffer.from(nickname, 'base64').toString('utf-8');
  } catch {
    return '';
  }
}

/** Legge dalla presa se e' accesa. presa = { ip, email, password } */
export function leggiStato(presa) {
  return inFila(presa.ip, async () => {
    const { apparecchio, protocollo } = await apri(presa);
    try {
      const info = (await apparecchio.getInfo())?.result || {};
      return { acceso: Boolean(info.device_on), protocollo, nome: decodificaNome(info.nickname) };
    } catch (errore) {
      dimentica(presa.ip);
      throw errore;
    }
  });
}

/** Accende (true) o spegne (false) la presa. */
export function comanda(presa, acceso) {
  return inFila(presa.ip, async () => {
    const { apparecchio, protocollo } = await apri(presa);
    try {
      await apparecchio.toggle(Boolean(acceso));
      return { acceso: Boolean(acceso), protocollo };
    } catch (errore) {
      // Sessione scaduta o presa scollegata: al prossimo comando si ricomincia dall'handshake
      dimentica(presa.ip);
      throw errore;
    }
  });
}
