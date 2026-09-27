// ==================== PRESA: COMANDO DIRETTO DAL TABLET (APK ANDROID) ====================
// Nell'app Android installata sul tablet la presa si comanda direttamente, senza
// Azure e senza ponte:
//
//   app (tablet) → plugin nativo PresaTapo → presa Tapo della stessa rete Wi-Fi
//
// Il plugin (versione_android/…/PresaTapoPlugin.java) parla i protocolli KLAP e AES,
// tiene account e prese nella memoria privata dell'app (la password non torna mai
// qui) e spegne da solo la presa allo scadere del tempo.
// Nella versione web (browser, PWA) questo file non fa nulla: resta il ponte.

(() => {
  const cap = window.Capacitor;
  if (!cap?.isNativePlatform?.()) {
    return;
  }
  const plugin = typeof cap.registerPlugin === 'function' ? cap.registerPlugin('PresaTapo') : cap.Plugins?.PresaTapo;
  if (!plugin) {
    return;
  }

  let ultimoErrore = '';

  const trasporto = {
    onStato: () => {},
    locale: true,
    get errore() {
      return ultimoErrore;
    },
    // Niente codice da inserire: rilegge la configurazione salvata sul tablet
    async collega() {
      await aggiorna();
    },
    scollega() {
      aggiorna().catch(() => {});
    },
    async accendi(ids, secondi) {
      const esito = await plugin.accendi({ prese: ids || [], secondi });
      if (!esito.ok) {
        throw new Error(esito.errore || 'La presa non si è accesa.');
      }
      return esito;
    },
    async spegni(ids) {
      const esito = await plugin.spegni({ prese: ids || [] });
      if (!esito.ok) {
        throw new Error(esito.errore || 'La presa non si è spenta.');
      }
      return esito;
    },
    async verifica() {
      const conf = await aggiorna();
      return { prese: conf.prese || [], versione: conf.versione || '' };
    },
    async leggiConfigurazione() {
      return plugin.leggiConfigurazione();
    },
    async salvaConfigurazione(dati) {
      const esito = await plugin.salvaConfigurazione(dati);
      applica(esito);
      return esito;
    },
  };

  // Pronta quando ci sono almeno una presa e l'account completo
  function applica(conf) {
    const prese = Array.isArray(conf.prese) ? conf.prese : [];
    const pronta = prese.length > 0 && !!conf.account?.email && !!conf.account?.passwordImpostata;
    trasporto.onStato(pronta ? 'online' : 'non-configurata', prese);
  }

  async function aggiorna() {
    try {
      const conf = await plugin.leggiConfigurazione();
      ultimoErrore = '';
      applica(conf);
      return conf;
    } catch (e) {
      ultimoErrore = e.message;
      throw e;
    }
  }

  Presa.usaTrasporto(trasporto);
  aggiorna().catch((e) => console.warn('Presa:', e.message));
})();
