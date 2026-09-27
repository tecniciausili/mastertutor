// ==================== AREA EDUCATORE: SCHEDA "PRESA" ====================
// Abbinamento con il ponte (codice di 12 caratteri), scelta delle prese da
// accendere come stimolo, durata dell'accensione e prova.

const SchedaPresa = (() => {
  const TESTI_STATO = {
    'non-configurata': { icona: 'bi-plug', testo: 'Non collegata', classe: 'spenta' },
    connessione: { icona: 'bi-arrow-repeat', testo: 'Collegamento al servizio in corso…', classe: 'attesa' },
    offline: { icona: 'bi-wifi-off', testo: 'Servizio raggiunto, ma il ponte non risponde: è acceso e collegato a internet?', classe: 'errore' },
    online: { icona: 'bi-check-circle-fill', testo: 'Collegata: il ponte risponde', classe: 'ok' },
  };

  // Nell'APK Android le prese si comandano direttamente dal tablet
  const TESTI_STATO_LOCALE = {
    'non-configurata': { icona: 'bi-tablet', testo: 'Nessuna presa configurata: premi «Configura le prese»', classe: 'spenta' },
    online: { icona: 'bi-check-circle-fill', testo: 'Pronta: le prese si comandano da questo tablet', classe: 'ok' },
  };

  // Mostra il codice a gruppi di 4: ABCD-EFGH-JKLM
  function formatta(codice) {
    return String(codice || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12)
      .replace(/(.{4})(?=.)/g, '$1-');
  }

  function disegna(contenuto) {
    const conf = Archivio.getImpostazioni().presa;
    const locale = Presa.locale;
    const chiSpegne = locale ? 'l\'app' : 'il ponte';
    contenuto.innerHTML = `
      <h3><i class="bi bi-plug-fill"></i> Presa smart</h3>
      <p class="helper-text">${locale
        ? 'In questa app la presa Tapo si comanda <strong>direttamente dal tablet</strong>, senza ponte né '
          + 'internet: basta che tablet e prese siano nella <strong>stessa rete Wi-Fi</strong>. Account Tapo e '
          + 'indirizzi delle prese si scrivono in <strong>Configura le prese</strong>.'
        : 'La presa Tapo si comanda attraverso il <strong>ponte</strong>: un piccolo programma acceso su un '
          + 'computer nella stessa rete Wi-Fi delle prese. Il ponte mostra un <strong>codice di abbinamento</strong>: '
          + 'scrivilo qui una volta sola, su ogni dispositivo che deve comandare la presa.'}
      </p>
      <div class="stato-presa" id="statoPresaBox"><i class="bi"></i> <span></span></div>
      <button type="button" class="btn-secondary btn-configura" data-azione="presa-configura">
        <i class="bi bi-gear-fill"></i> Configura le prese (account Tapo e indirizzi)
      </button>
      <form id="formPresa" class="form-grid" novalidate ${locale ? 'hidden' : ''}>
        <div class="form-group">
          <label for="presaCodice">Codice del ponte</label>
          <input id="presaCodice" class="input-codice" type="text" maxlength="14" autocomplete="off"
            autocapitalize="characters" spellcheck="false" placeholder="ABCD-EFGH-JKLM"
            value="${Util.escapeHtml(formatta(conf.codice))}" />
        </div>
        <div class="form-actions">
          <button type="submit" class="btn-primary"><i class="bi bi-link-45deg"></i> Collega</button>
          <button type="button" class="btn-secondary" data-azione="presa-scollega"><i class="bi bi-x-circle"></i> Scollega</button>
        </div>
      </form>
      <div id="dettagliPresa" hidden>
        <h4 class="titolo-lista"><i class="bi bi-lightning-charge"></i> Prese da accendere come stimolo</h4>
        <p class="helper-text">Se non ne scegli nessuna si accendono tutte quelle configurate.</p>
        <div id="listaPrese" class="lista-elementi"></div>
        <div class="form-group" style="margin-top: 1rem;">
          <label for="presaSecondi">Quanto resta accesa (secondi)</label>
          <input id="presaSecondi" type="number" min="1" max="600" value="${conf.secondi}" />
          <p class="helper-text">${locale
            ? 'Lo spegnimento lo fa l\'app da sola, anche se lo schermo si spegne.'
            : 'Lo spegnimento lo fa il ponte da solo, anche se il tablet perde la connessione.'}</p>
        </div>
        <div class="form-actions">
          <button type="button" class="btn-primary" data-azione="presa-prova">
            <i class="bi bi-lightning-charge-fill"></i> Prova: accendi per <span class="durata-prova">${conf.secondi}</span> secondi
          </button>
        </div>
        <p class="helper-text" style="margin-top: 0.5rem;">
          «Prova» accende le prese scelte (o tutte); il pulsante accanto a ogni presa prova solo quella.
          Allo scadere del tempo impostato è ${chiSpegne} a spegnerle.
        </p>
        <div>
        </div>
      </div>
      <div id="statoPresa" class="status-message" role="status" aria-live="polite"></div>
      <div class="info-box">
        <i class="bi bi-info-circle"></i>
        <p>${locale
          ? 'Nell\'app Tapo del telefono, per ogni presa va attivata <strong>Compatibilità terze parti</strong> '
            + '(ingranaggio della presa, in fondo), dove si legge anche il suo <strong>indirizzo IP</strong>. '
            + 'La password dell\'account resta salvata solo su questo tablet.'
          : '<strong>Il ponte</strong> sta nella cartella <code>ponte</code> dell\'app e si avvia con '
            + '<code>avvia.bat</code> (Windows) o <code>avvia.command</code> (Mac) su un computer della stessa '
            + 'rete delle prese. Le prese (account Tapo e indirizzi) si configurano con '
            + '<strong>Configura le prese</strong> oppure dalla pagina del ponte <code>http://localhost:8124</code>. '
            + 'La password viene salvata solo sul ponte.'}
        </p>
      </div>
    `;

    const el = {
      box: contenuto.querySelector('#statoPresaBox'),
      codice: contenuto.querySelector('#presaCodice'),
      dettagli: contenuto.querySelector('#dettagliPresa'),
      lista: contenuto.querySelector('#listaPrese'),
      secondi: contenuto.querySelector('#presaSecondi'),
      stato: contenuto.querySelector('#statoPresa'),
    };

    function messaggio(testo, tipo = 'info') {
      el.stato.textContent = testo || '';
      el.stato.className = `status-message ${testo ? tipo : ''}`;
    }

    function mostraDurata(secondi) {
      contenuto.querySelectorAll('.durata-prova').forEach((n) => {
        n.textContent = secondi;
      });
    }

    // Durata scritta nel campo, anche se non ancora confermata: la salvo e la uso,
    // così la prova (e la sessione) rispettano sempre il timer impostato
    function secondiImpostati() {
      const secondi = Math.min(600, Math.max(1, Number(el.secondi.value) || 30));
      if (Archivio.getImpostazioni().presa.secondi !== secondi) {
        Archivio.salvaImpostazioni({ presa: { secondi } });
      }
      mostraDurata(secondi);
      return secondi;
    }

    function aggiorna(stato = Presa.stato) {
      const testi = locale ? TESTI_STATO_LOCALE : TESTI_STATO;
      const def = testi[stato] || testi['non-configurata'];
      el.box.className = `stato-presa ${def.classe}`;
      el.box.querySelector('i').className = `bi ${def.icona}`;
      const errore = stato === 'connessione' && Presa.errore ? ` (${Presa.errore})` : '';
      el.box.querySelector('span').textContent = def.testo + errore;

      // La durata può essere cambiata anche dalla finestra "Configura le prese"
      if (document.activeElement !== el.secondi) {
        el.secondi.value = Archivio.getImpostazioni().presa.secondi;
      }
      mostraDurata(Archivio.getImpostazioni().presa.secondi);

      const prese = Presa.elenco();
      el.dettagli.hidden = stato !== 'online';
      if (stato === 'online') {
        const scelte = Archivio.getImpostazioni().presa.prese;
        el.lista.innerHTML = prese.length === 0
          ? '<p class="vuoto"><i class="bi bi-plug"></i> Nessuna presa ancora: aggiungile con <strong>Configura le prese</strong>.</p>'
          : prese.map((p) => `
            <div class="elemento ${scelte.includes(p.id) ? 'attivo' : ''}">
              <label class="riga-scelta">
                <input type="checkbox" class="spunta-presa" value="${Util.escapeHtml(p.id)}" ${scelte.includes(p.id) ? 'checked' : ''} />
                <i class="bi bi-plug-fill elemento-icona"></i>
                <span class="elemento-testo"><strong>${Util.escapeHtml(p.nome || p.id)}</strong>
                  <small>${Util.escapeHtml(p.ip || '')}</small></span>
              </label>
              <button type="button" class="btn-secondary btn-piccolo" data-azione="presa-prova-una"
                data-id="${Util.escapeHtml(p.id)}" title="Accende solo questa presa per il tempo impostato">
                <i class="bi bi-lightning-charge-fill"></i> Prova
              </button>
            </div>`).join('');
      }
    }

    contenuto.querySelector('#formPresa').addEventListener('submit', async (e) => {
      e.preventDefault();
      const codice = el.codice.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (codice.length !== 12) {
        messaggio('Il codice del ponte è di 12 lettere e numeri (quello mostrato dalla pagina del ponte).', 'error');
        return;
      }
      el.codice.value = formatta(codice);
      Archivio.salvaImpostazioni({ presa: { codice } });
      messaggio('⏳ Collegamento in corso…', 'info');
      try {
        await Presa.collega({ codice });
        await Presa.verifica();
        messaggio('✅ Ponte trovato: la presa è collegata.', 'success');
      } catch (errore) {
        messaggio(errore.message, 'error');
      }
    });

    el.codice.addEventListener('input', () => {
      const inizio = el.codice.selectionStart === el.codice.value.length;
      el.codice.value = formatta(el.codice.value);
      if (inizio) {
        el.codice.selectionStart = el.codice.value.length;
      }
    });

    // Salvo già mentre si scrive: prima il valore veniva preso solo quando il campo
    // perdeva il focus, e la durata digitata poteva non essere registrata
    el.secondi.addEventListener('input', () => {
      const valore = Number(el.secondi.value);
      if (Number.isFinite(valore) && valore >= 1 && valore <= 600) {
        Archivio.salvaImpostazioni({ presa: { secondi: Math.round(valore) } });
        mostraDurata(Math.round(valore));
      }
    });

    el.secondi.addEventListener('change', () => {
      const secondi = secondiImpostati();
      el.secondi.value = secondi;
      messaggio(`✅ La presa resterà accesa ${secondi} secondi.`, 'success');
    });

    el.lista.addEventListener('change', () => {
      const scelte = [...el.lista.querySelectorAll('.spunta-presa:checked')].map((c) => c.value);
      // salvaImpostazioni unisce gli oggetti ma sostituisce le liste
      Archivio.salvaImpostazioni({ presa: { prese: scelte } });
      aggiorna();
    });

    contenuto.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-azione]');
      if (!btn) {
        return;
      }
      if (btn.dataset.azione === 'presa-configura') {
        ConfiguraPrese.apri();
      } else if (btn.dataset.azione === 'presa-prova-una') {
        const nome = Presa.elenco().find((p) => p.id === btn.dataset.id)?.nome || 'la presa';
        const secondi = secondiImpostati();
        btn.disabled = true;
        messaggio(`⏳ Accendo "${nome}" per ${secondi} secondi…`, 'info');
        try {
          await Presa.accendi([btn.dataset.id], secondi);
          messaggio(`✅ "${nome}" risponde: si è accesa e si spegne da sola tra ${secondi} secondi.`, 'success');
        } catch (errore) {
          messaggio(`"${nome}": ${errore.message}`, 'error');
        } finally {
          btn.disabled = false;
        }
      } else if (btn.dataset.azione === 'presa-scollega') {
        Presa.scollega();
        Archivio.salvaImpostazioni({ presa: { codice: '' } });
        el.codice.value = '';
        messaggio('Presa scollegata da questo dispositivo.', 'info');
      } else if (btn.dataset.azione === 'presa-prova') {
        const secondi = secondiImpostati();
        btn.disabled = true;
        messaggio(`⏳ Accendo la presa per ${secondi} secondi…`, 'info');
        try {
          await Presa.accendi(Archivio.getImpostazioni().presa.prese, secondi);
          messaggio(`✅ Comando eseguito: la presa si spegne da sola tra ${secondi} secondi.`, 'success');
        } catch (errore) {
          messaggio(errore.message, 'error');
        } finally {
          btn.disabled = false;
        }
      }
    });

    aggiorna();
    if (Presa.stato === 'online') {
      Presa.verifica().catch(() => {});
    }
    return Presa.onCambio((stato) => aggiorna(stato));
  }

  return { disegna };
})();
