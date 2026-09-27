// ==================== FINESTRA A SCOMPARSA "CONFIGURA LE PRESE" ====================
// Le prese valgono per una rete Wi-Fi: in sede ci sono quelle di qui, a casa si
// comprano prese nuove e si inseriscono qui i loro dati. Il salvataggio arriva al
// ponte (che le comanda) attraverso Azure: il ponte scrive la configurazione,
// prova ogni presa e risponde. La password dell'account non viene salvata nella
// PWA e il ponte non la rimanda mai indietro.

const ConfiguraPrese = (() => {
  const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
  let el = null;
  let rimuoviAscolto = null;
  let caricata = false;

  function crea() {
    if (el) {
      return;
    }
    const velo = document.createElement('div');
    velo.className = 'overlay velo-cassetto';
    const cassetto = document.createElement('aside');
    cassetto.className = 'cassetto';
    cassetto.setAttribute('aria-label', 'Configura le prese');
    cassetto.innerHTML = `
      <div class="cassetto-testa">
        <h3><i class="bi bi-gear-fill"></i> Configura le prese</h3>
        <button type="button" class="btn-close-menu" data-cassetto="chiudi" aria-label="Chiudi">
          <i class="bi bi-x-lg"></i>
        </button>
      </div>
      <div class="cassetto-corpo">
        <div class="stato-presa" data-ruolo="stato"><i class="bi"></i> <span></span></div>
        <p class="helper-text" data-ruolo="spiegazione"></p>
        <form novalidate>
          <fieldset class="gruppo-campi">
            <legend><i class="bi bi-person-circle"></i> Account Tapo</legend>
            <div class="form-group">
              <label for="cpEmail">Email</label>
              <input id="cpEmail" type="email" autocomplete="off" spellcheck="false" />
            </div>
            <div class="form-group">
              <label for="cpPassword">Password</label>
              <input id="cpPassword" type="password" autocomplete="new-password" />
              <p class="helper-text" data-ruolo="aiuto-password"></p>
            </div>
          </fieldset>
          <fieldset class="gruppo-campi">
            <legend><i class="bi bi-plug-fill"></i> Prese</legend>
            <div class="righe-prese" data-ruolo="righe"></div>
            <button type="button" class="btn-secondary btn-piccolo" data-cassetto="aggiungi">
              <i class="bi bi-plus-lg"></i> Aggiungi presa
            </button>
          </fieldset>
          <fieldset class="gruppo-campi">
            <legend><i class="bi bi-stopwatch"></i> Accensione</legend>
            <div class="form-group">
              <label for="cpSecondi">Quanto resta accesa a ogni stimolo (secondi)</label>
              <input id="cpSecondi" type="number" min="1" max="600" />
            </div>
          </fieldset>
          <div class="form-actions">
            <button type="submit" class="btn-primary" data-ruolo="salva">
              <i class="bi bi-save"></i> Salva configurazione
            </button>
            <button type="button" class="btn-secondary" data-cassetto="chiudi">Chiudi</button>
          </div>
          <div class="status-message" data-ruolo="esito" role="status" aria-live="polite"></div>
          <div class="lista-elementi" data-ruolo="verifiche"></div>
        </form>
        <details class="aiuto-prese">
          <summary><i class="bi bi-question-circle"></i> Come preparo le prese nuove?</summary>
          <ol>
            <li>Con l'app <strong>Tapo</strong> sul telefono si aggiunge la presa alla rete Wi-Fi di casa,
              come indicato nella sua confezione.</li>
            <li>Nell'app Tapo: si tocca la presa → ingranaggio → si attiva <strong>Compatibilità terze parti</strong>.</li>
            <li>Sempre lì, in fondo, c'è l'<strong>indirizzo IP</strong> (es. 192.168.1.23): va scritto qui sopra.</li>
            <li>L'account è quello con cui si accede all'app Tapo sul telefono.</li>
            <li data-ruolo="passo-ponte">Il ponte va avviato su un computer della stessa rete Wi-Fi, e il suo codice inserito in
              <strong>Area Educatore → Presa</strong>.</li>
            <li data-ruolo="passo-tablet">Il tablet deve essere collegato alla <strong>stessa rete Wi-Fi</strong> delle prese.</li>
          </ol>
        </details>
      </div>
    `;
    document.body.append(velo, cassetto);

    // Nell'APK Android le prese si comandano dal tablet stesso: niente ponte
    const locale = Presa.locale;
    cassetto.querySelector('[data-ruolo="spiegazione"]').innerHTML = locale
      ? 'Le prese valgono per una rete Wi-Fi: a casa, con prese nuove, si scrivono qui i loro dati e si preme '
        + '<strong>Salva configurazione</strong>. I dati vengono salvati <strong>su questo tablet</strong>, '
        + 'che comanda le prese direttamente: basta che sia nella stessa rete Wi-Fi.'
      : 'Le prese valgono per una rete Wi-Fi. In sede sono già impostate quelle di qui; a casa, con prese '
        + 'nuove, si scrivono qui i loro dati e si preme <strong>Salva configurazione</strong>. I dati vengono '
        + 'salvati sul <strong>ponte</strong>, che deve essere acceso nella stessa rete delle prese.';
    cassetto.querySelector('[data-ruolo="passo-ponte"]').hidden = locale;
    cassetto.querySelector('[data-ruolo="passo-tablet"]').hidden = !locale;

    el = {
      velo,
      cassetto,
      form: cassetto.querySelector('form'),
      stato: cassetto.querySelector('[data-ruolo="stato"]'),
      email: cassetto.querySelector('#cpEmail'),
      password: cassetto.querySelector('#cpPassword'),
      aiutoPassword: cassetto.querySelector('[data-ruolo="aiuto-password"]'),
      righe: cassetto.querySelector('[data-ruolo="righe"]'),
      secondi: cassetto.querySelector('#cpSecondi'),
      salva: cassetto.querySelector('[data-ruolo="salva"]'),
      esito: cassetto.querySelector('[data-ruolo="esito"]'),
      verifiche: cassetto.querySelector('[data-ruolo="verifiche"]'),
    };

    velo.addEventListener('click', chiudi);
    cassetto.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-cassetto]');
      if (!btn) {
        return;
      }
      const azione = btn.dataset.cassetto;
      if (azione === 'chiudi') {
        chiudi();
      } else if (azione === 'aggiungi') {
        aggiungiRiga({ nome: '', ip: '' });
        el.righe.querySelector('.riga-presa:last-child .cp-nome')?.focus();
      } else if (azione === 'elimina') {
        btn.closest('.riga-presa')?.remove();
        segnaVuoto();
      }
    });
    el.form.addEventListener('submit', (e) => {
      e.preventDefault();
      salva();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && el.cassetto.classList.contains('active')) {
        chiudi();
      }
    });
  }

  function messaggio(testo, tipo = 'info') {
    el.esito.textContent = testo || '';
    el.esito.className = `status-message ${testo ? tipo : ''}`;
  }

  function aggiornaStato() {
    const online = Presa.disponibile() || Presa.locale;
    const testi = Presa.locale ? {
      online: ['ok', 'bi-tablet', 'Le prese si comandano direttamente da questo tablet.'],
      'non-configurata': ['attesa', 'bi-tablet', 'Nessuna presa ancora: scrivi qui sotto account e indirizzi, poi salva.'],
    } : {
      online: ['ok', 'bi-check-circle-fill', 'Ponte collegato: puoi leggere e salvare la configurazione.'],
      offline: ['errore', 'bi-wifi-off', 'Il ponte non risponde: è acceso e collegato a internet?'],
      connessione: ['attesa', 'bi-arrow-repeat', 'Collegamento al servizio in corso…'],
      'non-configurata': ['spenta', 'bi-plug', 'Nessun ponte abbinato: inserisci prima il suo codice in Area Educatore → Presa.'],
    };
    const [classe, icona, testo] = testi[Presa.stato] || testi['non-configurata'];
    el.stato.className = `stato-presa ${classe}`;
    el.stato.querySelector('i').className = `bi ${icona}`;
    el.stato.querySelector('span').textContent = testo;
    el.salva.disabled = !online;
    if (online && !caricata) {
      carica();
    }
  }

  function aggiungiRiga({ id = '', nome = '', ip = '' }) {
    const riga = document.createElement('div');
    riga.className = 'riga-presa';
    riga.dataset.id = id;
    riga.innerHTML = `
      <input class="cp-nome" type="text" maxlength="60" placeholder="Nome (es. Ventilatore)" aria-label="Nome della presa" />
      <input class="cp-ip" type="text" inputmode="decimal" placeholder="192.168.1.65" aria-label="Indirizzo IP" spellcheck="false" />
      <button type="button" class="btn-icona pericolo" data-cassetto="elimina" title="Elimina presa" aria-label="Elimina presa">
        <i class="bi bi-trash3"></i>
      </button>
    `;
    riga.querySelector('.cp-nome').value = nome;
    riga.querySelector('.cp-ip').value = ip;
    el.righe.append(riga);
    segnaVuoto();
  }

  function segnaVuoto() {
    el.righe.classList.toggle('vuota', el.righe.children.length === 0);
  }

  async function carica() {
    caricata = true;
    el.secondi.value = Archivio.getImpostazioni().presa.secondi;
    try {
      const conf = await Presa.leggiConfigurazione();
      el.email.value = conf.account?.email || '';
      el.password.value = '';
      el.password.placeholder = conf.account?.passwordImpostata ? '•••••••• già impostata' : '';
      el.aiutoPassword.textContent = conf.account?.passwordImpostata
        ? 'Lascia vuoto per tenere quella salvata sul ponte.'
        : 'Serve per comandare le prese.';
      el.righe.innerHTML = '';
      (conf.prese || []).forEach(aggiungiRiga);
      if ((conf.prese || []).length === 0) {
        aggiungiRiga({});
      }
      messaggio(conf.simulazione ? 'Il ponte è in modalità simulazione: le prese sono finte.' : '', 'info');
    } catch (e) {
      caricata = false;
      messaggio(e.message, 'error');
    }
  }

  async function salva() {
    el.verifiche.innerHTML = '';
    const prese = [...el.righe.querySelectorAll('.riga-presa')].map((riga) => ({
      id: riga.dataset.id || undefined,
      nome: riga.querySelector('.cp-nome').value.trim(),
      ip: riga.querySelector('.cp-ip').value.trim(),
    })).filter((p) => p.nome || p.ip);

    const email = el.email.value.trim();
    if (!email) {
      messaggio('Scrivi l\'email dell\'account Tapo.', 'error');
      el.email.focus();
      return;
    }
    for (const p of prese) {
      if (!p.nome) {
        messaggio(`Manca il nome della presa ${p.ip}.`, 'error');
        return;
      }
      if (!IPV4.test(p.ip)) {
        messaggio(`"${p.nome}": l'indirizzo IP non è valido (esempio: 192.168.1.65).`, 'error');
        return;
      }
    }
    const secondi = Math.min(600, Math.max(1, Number(el.secondi.value) || 30));
    el.secondi.value = secondi;
    Archivio.salvaImpostazioni({ presa: { secondi } });

    el.salva.disabled = true;
    messaggio(Presa.locale ? '⏳ Salvataggio e prova delle prese…' : '⏳ Salvataggio sul ponte e prova delle prese…', 'info');
    try {
      const esito = await Presa.salvaConfigurazione({
        account: { email, password: el.password.value },
        prese,
      });
      el.password.value = '';
      el.password.placeholder = esito.account?.passwordImpostata ? '•••••••• già impostata' : '';
      // Le prese hanno nuovi id: allineo le righe e dimentico le scelte non più valide
      el.righe.innerHTML = '';
      (esito.prese || []).forEach(aggiungiRiga);
      const ids = (esito.prese || []).map((p) => p.id);
      const scelte = Archivio.getImpostazioni().presa.prese.filter((id) => ids.includes(id));
      Archivio.salvaImpostazioni({ presa: { prese: scelte } });

      const verifiche = esito.verifiche || [];
      const problemi = verifiche.filter((v) => !v.ok).length;
      messaggio(problemi
        ? `Configurazione salvata, ma ${problemi} ${problemi === 1 ? 'presa non risponde' : 'prese non rispondono'}: controlla qui sotto.`
        : '✅ Configurazione salvata: tutte le prese rispondono.', problemi ? 'error' : 'success');
      el.verifiche.innerHTML = verifiche.map((v) => `
        <div class="elemento ${v.ok ? 'attivo' : ''}">
          <i class="bi ${v.ok ? 'bi-check-circle-fill testo-ok' : 'bi-x-circle-fill testo-errore'} elemento-icona"></i>
          <div class="elemento-testo">
            <strong>${Util.escapeHtml(v.nome)} <small>${Util.escapeHtml(v.ip)}</small></strong>
            <small>${v.ok
              ? `Raggiunta: ora è ${v.acceso ? 'accesa' : 'spenta'} (${Util.escapeHtml(v.protocollo || '')})`
              : Util.escapeHtml(v.errore || 'Non risponde')}</small>
          </div>
        </div>`).join('');
    } catch (e) {
      messaggio(e.message, 'error');
    } finally {
      el.salva.disabled = !(Presa.disponibile() || Presa.locale);
    }
  }

  function apri() {
    crea();
    caricata = false;
    el.verifiche.innerHTML = '';
    messaggio('');
    el.righe.innerHTML = '';
    el.email.value = '';
    el.password.value = '';
    el.secondi.value = Archivio.getImpostazioni().presa.secondi;
    el.cassetto.classList.add('active');
    el.velo.classList.add('active');
    rimuoviAscolto?.();
    rimuoviAscolto = Presa.onCambio(aggiornaStato);
    aggiornaStato();
  }

  function chiudi() {
    if (!el) {
      return;
    }
    el.cassetto.classList.remove('active');
    el.velo.classList.remove('active');
    el.password.value = '';
    rimuoviAscolto?.();
    rimuoviAscolto = null;
  }

  return { apri, chiudi };
})();
