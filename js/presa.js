// ==================== PRESA SMART ====================
// Interfaccia unica usata dall'Area Educatore e dall'Area Utente per comandare
// la presa. Il "trasporto" (come il comando arriva alla presa) è separato:
// il resto dell'app usa solo i metodi qui sotto.
//
//   Presa.stato            'non-configurata' | 'connessione' | 'online' | 'offline'
//   Presa.disponibile()    true se si può accendere adesso
//   Presa.elenco()         prese note [{id, nome}]
//   Presa.accendi(ids, s)  accende per s secondi (lo spegnimento è garantito dall'altro lato)
//   Presa.spegni()         spegne subito
//   Presa.onCambio(fn)     notifica i cambi di stato

const Presa = (() => {
  let stato = 'non-configurata';
  let prese = [];
  let trasporto = null;
  const ascoltatori = new Set();

  function imposta(nuovoStato, nuovePrese) {
    stato = nuovoStato;
    if (Array.isArray(nuovePrese)) {
      prese = nuovePrese;
    }
    ascoltatori.forEach((fn) => {
      try {
        fn(stato, prese);
      } catch (e) {
        console.error(e);
      }
    });
  }

  // Il trasporto concreto si registra qui (vedi js/presa-*.js)
  function usaTrasporto(t) {
    trasporto = t;
    t.onStato = (s, elenco) => imposta(s, elenco);
  }

  return {
    get stato() {
      return stato;
    },
    // true nell'APK Android: le prese si comandano direttamente da questo tablet,
    // senza ponte (vedi js/presa-nativa.js)
    get locale() {
      return !!trasporto?.locale;
    },
    configurabile() {
      return !!trasporto;
    },
    disponibile() {
      return !!trasporto && stato === 'online';
    },
    elenco() {
      return prese.slice();
    },
    usaTrasporto,
    async collega(parametri) {
      if (!trasporto) {
        throw new Error('Il collegamento alla presa non è ancora disponibile in questa versione.');
      }
      imposta('connessione');
      return trasporto.collega(parametri);
    },
    scollega() {
      trasporto?.scollega();
      imposta('non-configurata', []);
    },
    async accendi(ids, secondi) {
      if (!this.disponibile()) {
        throw new Error('Presa non collegata.');
      }
      return trasporto.accendi(ids, secondi);
    },
    async spegni(ids) {
      if (trasporto && stato === 'online') {
        return trasporto.spegni(ids);
      }
      return null;
    },
    // Chiede al ponte se c'è e quali prese conosce
    async verifica() {
      if (!trasporto) {
        throw new Error('Il collegamento alla presa non è disponibile in questa versione.');
      }
      return trasporto.verifica();
    },
    get errore() {
      return trasporto?.errore || '';
    },
    // false quando su questo indirizzo le prese via ponte non sono disponibili
    // (l'APK non passa dal servizio: per lui è sempre true)
    async verificaServizio() {
      return trasporto?.verificaServizio ? trasporto.verificaServizio() : true;
    },
    async leggiConfigurazione() {
      if (!this.disponibile() && !this.locale) {
        throw new Error('Il ponte non è collegato.');
      }
      return trasporto.leggiConfigurazione();
    },
    async salvaConfigurazione(dati) {
      if (!this.disponibile() && !this.locale) {
        throw new Error('Il ponte non è collegato.');
      }
      return trasporto.salvaConfigurazione(dati);
    },
    onCambio(fn) {
      ascoltatori.add(fn);
      return () => ascoltatori.delete(fn);
    },
  };
})();
