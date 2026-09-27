// ==================== PRESA: COLLEGAMENTO ATTRAVERSO AZURE WEB PUBSUB ====================
// Una PWA non può parlare direttamente con le prese della rete locale (il browser
// lo impedisce). Il comando fa quindi questo giro:
//
//   PWA (computer, tablet, telefono) → Azure Web PubSub → ponte → presa Tapo
//
// Il ponte è un piccolo programma acceso vicino alle prese (su un computer oppure,
// in futuro, su una ESP32). Mostra un codice di abbinamento di 12 caratteri che
// l'educatore inserisce una volta nella scheda "Presa".
//
// Messaggi (campo "data" del protocollo json.webpubsub.azure.v1):
//   app → ponte: {tipo:'ping'|'accendi'|'spegni', id, prese?, secondi?}
//   ponte → app: {tipo:'pong'|'ciao'|'esito'|'spenta', id?, ok?, errore?, prese?}

const TrasportoWebPubSub = (() => {
  const PROTOCOLLO = 'json.webpubsub.azure.v1';
  const ATTESA_RISPOSTA_MS = 8000;
  const RIPROVA_PING_MS = 60000;

  let ws = null;
  let codice = '';
  let attivo = false;
  let gruppoPonte = '';
  let pontePresente = false;
  let prese = [];
  let tentativi = 0;
  let timerRiconnessione = null;
  let timerPing = null;
  let ultimoErrore = '';
  let annullaApertura = null;   // interrompe un collegamento non ancora aperto
  const inAttesa = new Map();

  const trasporto = {
    onStato: () => {},
    collega,
    scollega,
    accendi,
    spegni,
    verifica,
    get errore() {
      return ultimoErrore;
    },
  };

  function stato() {
    if (!attivo) {
      return 'non-configurata';
    }
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return 'connessione';
    }
    return pontePresente ? 'online' : 'offline';
  }

  function notifica() {
    trasporto.onStato(stato(), prese);
  }

  function normalizza(testo) {
    return String(testo || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  async function collega({ codice: nuovoCodice }) {
    scollega();
    codice = normalizza(nuovoCodice);
    if (codice.length !== 12) {
      throw new Error('Il codice del ponte è di 12 lettere e numeri.');
    }
    attivo = true;
    tentativi = 0;
    notifica();
    await apri();
  }

  function scollega() {
    attivo = false;
    annullaApertura?.();
    annullaApertura = null;
    clearTimeout(timerRiconnessione);
    clearTimeout(timerPing);
    pontePresente = false;
    prese = [];
    if (ws) {
      ws.onclose = null;
      try {
        ws.close();
      } catch (e) { /* già chiuso */ }
      ws = null;
    }
    rifiutaTutte('Presa scollegata.');
  }

  async function apri() {
    let dati;
    try {
      const risposta = await fetch(`api/negotiate?ruolo=app&codice=${encodeURIComponent(codice)}`, { cache: 'no-store' });
      const testo = await risposta.text();
      try {
        dati = JSON.parse(testo);
      } catch (e) {
        throw new Error('Il servizio della presa non risponde (l\'app va aperta dal suo indirizzo su Azure).');
      }
      if (!risposta.ok) {
        throw new Error(dati.errore || `Errore del servizio (${risposta.status}).`);
      }
    } catch (e) {
      ultimoErrore = e.message === 'Failed to fetch' || e.name === 'TypeError'
        ? 'Nessuna connessione a internet.'
        : e.message;
      notifica();
      programmaRiconnessione();
      throw new Error(ultimoErrore);
    }
    if (!attivo) {
      return;
    }

    gruppoPonte = dati.destinatario;
    // Mi risolvo solo a collegamento aperto, così chi aspetta collega() può subito inviare comandi
    await new Promise((resolve, reject) => {
      const socket = new WebSocket(dati.url, PROTOCOLLO);
      let aperto = false;
      ws = socket;
      annullaApertura = () => reject(new Error('Collegamento annullato.'));
      socket.onopen = () => {
        aperto = true;
        annullaApertura = null;
        tentativi = 0;
        ultimoErrore = '';
        notifica();
        verifica().catch(() => {});
        resolve();
      };
      socket.onmessage = (evento) => {
        try {
          ricevi(JSON.parse(evento.data));
        } catch (e) {
          console.warn('Presa: messaggio non valido', e);
        }
      };
      socket.onclose = () => {
        if (!aperto) {
          ultimoErrore = 'Impossibile collegarsi al servizio della presa.';
          reject(new Error(ultimoErrore));
        }
        if (ws !== socket) {
          return;
        }
        ws = null;
        pontePresente = false;
        rifiutaTutte('Collegamento con il servizio interrotto.');
        notifica();
        programmaRiconnessione();
      };
    });
  }

  function programmaRiconnessione() {
    clearTimeout(timerRiconnessione);
    if (!attivo) {
      return;
    }
    // 2, 4, 8... fino a 60 secondi tra un tentativo e l'altro
    const attesa = Math.min(60000, 2000 * 2 ** Math.min(tentativi, 5));
    tentativi++;
    timerRiconnessione = setTimeout(() => {
      apri().catch(() => {});
    }, attesa);
  }

  function ricevi(messaggio) {
    if (messaggio.type !== 'message' || !messaggio.data || typeof messaggio.data !== 'object') {
      return;
    }
    const d = messaggio.data;
    if (d.tipo === 'pong' || d.tipo === 'ciao') {
      clearTimeout(timerPing);
      pontePresente = true;
      prese = Array.isArray(d.prese) ? d.prese : [];
      notifica();
    }
    if (d.id && inAttesa.has(d.id)) {
      const attesa = inAttesa.get(d.id);
      inAttesa.delete(d.id);
      clearTimeout(attesa.timer);
      attesa.resolve(d);
    }
  }

  function rifiutaTutte(motivo) {
    for (const [id, attesa] of inAttesa) {
      clearTimeout(attesa.timer);
      attesa.reject(new Error(motivo));
      inAttesa.delete(id);
    }
  }

  function richiesta(tipo, campi = {}, attesaMs = ATTESA_RISPOSTA_MS) {
    return new Promise((resolve, reject) => {
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        reject(new Error('Servizio della presa non collegato.'));
        return;
      }
      const id = Util.idUnivoco();
      const timer = setTimeout(() => {
        inAttesa.delete(id);
        if (pontePresente) {
          pontePresente = false;
          notifica();
        }
        programmaPing();
        reject(new Error('Il ponte non risponde: è acceso e collegato a internet?'));
      }, attesaMs);
      inAttesa.set(id, { resolve, reject, timer });
      ws.send(JSON.stringify({
        type: 'sendToGroup',
        group: gruppoPonte,
        dataType: 'json',
        data: { tipo, id, ...campi },
      }));
    });
  }

  // Se il ponte non risponde riprovo ogni tanto, finché non torna
  function programmaPing() {
    clearTimeout(timerPing);
    if (attivo) {
      timerPing = setTimeout(() => verifica().catch(() => {}), RIPROVA_PING_MS);
    }
  }

  async function verifica() {
    const risposta = await richiesta('ping');
    return { prese: risposta.prese || [], versione: risposta.versione || '' };
  }

  async function accendi(ids, secondi) {
    const esito = await richiesta('accendi', { prese: ids || [], secondi });
    if (!esito.ok) {
      throw new Error(esito.errore || 'La presa non si è accesa.');
    }
    return esito;
  }

  async function spegni(ids) {
    const esito = await richiesta('spegni', { prese: ids || [] });
    if (!esito.ok) {
      throw new Error(esito.errore || 'La presa non si è spenta.');
    }
    return esito;
  }

  // Configurazione delle prese sul ponte (la password non torna mai indietro)
  async function leggiConfigurazione() {
    return richiesta('leggi-config');
  }

  async function salvaConfigurazione(dati) {
    // Il ponte verifica ogni presa prima di rispondere: serve più tempo
    const esito = await richiesta('configura', dati, 45000);
    if (!esito.ok) {
      throw new Error(esito.errore || 'Il ponte non ha salvato la configurazione.');
    }
    return esito;
  }

  trasporto.leggiConfigurazione = leggiConfigurazione;
  trasporto.salvaConfigurazione = salvaConfigurazione;
  return trasporto;
})();

Presa.usaTrasporto(TrasportoWebPubSub);
