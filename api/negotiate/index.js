/**
 * /api/negotiate
 * Rilascia l'indirizzo con cui la PWA o il ponte si collegano ad Azure Web PubSub.
 *
 * Il servizio fa da "postino" tra la PWA (computer, tablet, telefono) e il ponte
 * acceso vicino alle prese: la PWA manda i comandi al gruppo del ponte, il ponte
 * risponde al gruppo delle app. I gruppi sono legati al codice di abbinamento
 * mostrato dal ponte, quindi ogni ponte ha i suoi e chi non conosce il codice
 * non può comandare le prese.
 *
 *   GET /api/negotiate?ruolo=app&codice=ABCDEFGHJKLM
 *   GET /api/negotiate?ruolo=ponte&codice=ABCDEFGHJKLM
 *   → { url, gruppo, destinatario }
 *
 * Richiede l'impostazione dell'app WEBPUBSUB_CONNECTION_STRING (la stringa di
 * connessione della risorsa Web PubSub, pagina "Chiavi" nel portale Azure).
 * Non usa librerie esterne: il token è un JWT firmato con la chiave di accesso.
 */

const crypto = require('crypto');

const HUB = 'mastertutor';
const DURATA_TOKEN_MINUTI = 60;
const CODICE_VALIDO = /^[A-Z0-9]{12}$/;

function rispondi(context, stato, corpo) {
  context.res = {
    status: stato,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
    body: corpo,
  };
}

// "Endpoint=https://nome.webpubsub.azure.com;AccessKey=...;Version=1.0;"
function leggiConnessione(testo) {
  const campi = {};
  for (const parte of String(testo).split(';')) {
    const uguale = parte.indexOf('=');
    if (uguale > 0) {
      campi[parte.slice(0, uguale).trim().toLowerCase()] = parte.slice(uguale + 1).trim();
    }
  }
  if (!campi.endpoint || !campi.accesskey) {
    throw new Error('Stringa di connessione Web PubSub incompleta.');
  }
  return {
    endpoint: campi.endpoint.replace(/\/+$/, ''),
    chiave: campi.accesskey,
  };
}

function base64url(dati) {
  return Buffer.from(dati).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function firmaJwt(contenuto, chiave) {
  const testa = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const corpo = base64url(JSON.stringify(contenuto));
  const firma = base64url(crypto.createHmac('sha256', chiave).update(`${testa}.${corpo}`).digest());
  return `${testa}.${corpo}.${firma}`;
}

module.exports = async function negotiate(context, req) {
  const connessione = process.env.WEBPUBSUB_CONNECTION_STRING;
  if (!connessione) {
    rispondi(context, 500, {
      errore: 'Il servizio della presa non è ancora configurato su Azure (manca WEBPUBSUB_CONNECTION_STRING).',
    });
    return;
  }

  const codice = String(req.query.codice || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const ruolo = req.query.ruolo === 'ponte' ? 'ponte' : 'app';
  if (!CODICE_VALIDO.test(codice)) {
    rispondi(context, 400, { errore: 'Codice di abbinamento non valido: sono 12 lettere e numeri.' });
    return;
  }

  let endpoint;
  let chiave;
  try {
    ({ endpoint, chiave } = leggiConnessione(connessione));
  } catch (e) {
    rispondi(context, 500, { errore: e.message });
    return;
  }

  const gruppoPonte = `mt-${codice}-ponte`;
  const gruppoApp = `mt-${codice}-app`;
  const ascolta = ruolo === 'ponte' ? gruppoPonte : gruppoApp;
  const scrive = ruolo === 'ponte' ? gruppoApp : gruppoPonte;

  const adesso = Math.floor(Date.now() / 1000);
  const token = firmaJwt({
    aud: `${endpoint}/client/hubs/${HUB}`,
    iat: adesso,
    exp: adesso + DURATA_TOKEN_MINUTI * 60,
    sub: `${ruolo}-${crypto.randomUUID()}`,
    role: [`webpubsub.sendToGroup.${scrive}`],
    'webpubsub.group': [ascolta],
  }, chiave);

  const indirizzo = endpoint.replace(/^http/i, 'ws');
  rispondi(context, 200, {
    url: `${indirizzo}/client/hubs/${HUB}?access_token=${encodeURIComponent(token)}`,
    gruppo: ascolta,
    destinatario: scrive,
  });
};

// Esposte per le verifiche automatiche
module.exports.leggiConnessione = leggiConnessione;
module.exports.firmaJwt = firmaJwt;
