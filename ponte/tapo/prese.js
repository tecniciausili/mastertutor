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

async function apri(presa) {
  const chiave = chiaveDi(presa);
  const esistente = sessioni.get(presa.ip);
  if (esistente && esistente.chiave === chiave) {
    return esistente;
  }

  const { ip, email, password } = presa;
  try {
    const apparecchio = new TapoDevice(ip, email, password);
    await apparecchio.getInfo();
    const sessione = { chiave, protocollo: 'klap', apparecchio };
    sessioni.set(ip, sessione);
    return sessione;
  } catch (erroreKlap) {
    try {
      const apparecchio = new TapoPassthroughDevice(ip, email, password);
      await apparecchio.getInfo();
      const sessione = { chiave, protocollo: 'passthrough', apparecchio };
      sessioni.set(ip, sessione);
      return sessione;
    } catch (errorePassthrough) {
      throw new Error(descriviErrore(erroreKlap, errorePassthrough));
    }
  }
}

/** Traduce in una frase leggibile il fallimento di entrambi i protocolli. */
export function descriviErrore(erroreKlap, errorePassthrough) {
  const testoKlap = String(erroreKlap?.message || erroreKlap);
  const testoPassthrough = String(errorePassthrough?.message || errorePassthrough);
  // Le prese con firmware vecchio non conoscono KLAP (404): conta l'errore dell'altro protocollo
  const testo = testoKlap.includes('HTTP 404') ? testoPassthrough : testoKlap;

  if (testoKlap.includes('403')) {
    return 'La presa rifiuta il collegamento. Nell\'app Tapo del telefono va attivata '
      + '"Compatibilita\' terze parti" (Impostazioni della presa, in fondo).';
  }
  if (testo.includes('hash mismatch')) {
    return 'Email o password non corrispondono all\'account Tapo. '
      + 'Sono le stesse credenziali usate per accedere all\'app Tapo sul telefono.';
  }
  if (testo.includes('EHOSTUNREACH') || testo.includes('ENETUNREACH')) {
    return 'Indirizzo irraggiungibile: la presa non e\' sulla stessa rete del computer.';
  }
  if (testo.includes('ECONNREFUSED')) {
    return 'Nessuna presa risponde a questo indirizzo.';
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
