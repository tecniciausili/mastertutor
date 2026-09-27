// ==================== UTILITÀ COMUNI ====================
// Piccole funzioni usate da tutti i moduli. Nessuna dipendenza.

const Util = {
  // true dentro l'app Android installata (APK Capacitor), false nel browser e nella PWA
  apk: !!window.Capacitor?.isNativePlatform?.(),

  // Protegge il testo inserito dall'educatore quando finisce dentro innerHTML
  escapeHtml(testo) {
    return String(testo ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[c]));
  },

  // 75 → "1:15"
  formatoTempo(secondi) {
    const s = Math.max(0, Math.round(Number(secondi) || 0));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  },

  // 3725 secondi → "1 h 2 min", 75 → "1 min 15 s"
  formatoDurata(secondi) {
    const s = Math.max(0, Math.round(Number(secondi) || 0));
    const ore = Math.floor(s / 3600);
    const min = Math.floor((s % 3600) / 60);
    if (ore > 0) {
      return `${ore} h ${min} min`;
    }
    if (min > 0) {
      return `${min} min ${s % 60} s`;
    }
    return `${s} s`;
  },

  formatoData(timestamp) {
    return new Date(timestamp).toLocaleString('it-IT', {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  },

  numeroCasuale(min, max) {
    const a = Math.min(min, max);
    const b = Math.max(min, max);
    return a + Math.random() * (b - a);
  },

  // Copia della lista in ordine casuale (Fisher-Yates)
  mescola(lista) {
    const copia = [...lista];
    for (let i = copia.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copia[i], copia[j]] = [copia[j], copia[i]];
    }
    return copia;
  },

  // Giro senza ripetizioni: ogni elemento esce una sola volta finché non sono usciti
  // tutti, poi si prepara un nuovo giro. prossimo(elementi, prepara) riceve gli elementi
  // disponibili adesso; prepara(elementi) dà l'ordine del nuovo giro (lista o mescolato).
  // Gli elementi tolti a metà giro vengono saltati, quelli aggiunti entrano dal giro dopo.
  // Con seguiOrdine (giro "in ordine di lista") quelli non ancora usciti seguono subito
  // l'ordine attuale degli elementi: un riordino a giro in corso vale da subito.
  creaGiro(chiave = (x) => x) {
    let coda = [];
    let ultima = null;
    return {
      prossimo(elementi, prepara, { seguiOrdine = false } = {}) {
        if (!elementi || elementi.length === 0) {
          return null;
        }
        const perChiave = new Map(elementi.map((e) => [chiave(e), e]));
        coda = coda.filter((k) => perChiave.has(k));
        if (seguiOrdine && coda.length > 1) {
          const posizione = new Map(elementi.map((e, i) => [chiave(e), i]));
          coda.sort((a, b) => posizione.get(a) - posizione.get(b));
        }
        if (coda.length === 0) {
          coda = prepara(elementi).map(chiave);
          // A cavallo tra due giri lo stesso elemento non esce due volte di fila
          if (coda.length > 1 && coda[0] === ultima) {
            [coda[0], coda[1]] = [coda[1], coda[0]];
          }
        }
        ultima = coda.shift();
        return perChiave.get(ultima);
      },
      // Butta il giro in corso (es. passaggio tra lista e a caso); l'ultimo uscito resta noto
      ricomincia() {
        coda = [];
      },
    };
  },

  // Attesa interrompibile: true a tempo scaduto, false se annullata dal segnale
  attendi(ms, segnale) {
    return new Promise((resolve) => {
      if (segnale?.aborted) {
        resolve(false);
        return;
      }
      const annulla = () => {
        clearTimeout(timer);
        resolve(false);
      };
      const timer = setTimeout(() => {
        segnale?.removeEventListener('abort', annulla);
        resolve(true);
      }, Math.max(0, ms));
      segnale?.addEventListener('abort', annulla, { once: true });
    });
  },

  idUnivoco() {
    if (window.crypto?.randomUUID) {
      return crypto.randomUUID();
    }
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  },

  // Estrae l'id del video da tutti i formati di link YouTube comuni
  estraiVideoId(url) {
    if (!url) {
      return null;
    }
    const valido = (id) => (/^[A-Za-z0-9_-]{11}$/.test(id || '') ? id : null);
    try {
      const u = new URL(url.trim());
      const host = u.hostname.replace(/^www\.|^m\.|^music\./, '');
      if (host === 'youtu.be') {
        return valido(u.pathname.split('/')[1]);
      }
      if (host.endsWith('youtube.com') || host.endsWith('youtube-nocookie.com')) {
        if (u.searchParams.has('v')) {
          return valido(u.searchParams.get('v'));
        }
        const m = u.pathname.match(/\/(embed|shorts|live|v)\/([A-Za-z0-9_-]{11})/);
        if (m) {
          return valido(m[2]);
        }
      }
    } catch (e) {
      return null;
    }
    return null;
  },

  // Estrae l'id di una playlist dal link YouTube (parametro "list").
  // Esclude le liste private non enumerabili (WL = Guarda più tardi, LL = Mi piace).
  estraiPlaylistId(url) {
    if (!url) {
      return null;
    }
    try {
      const u = new URL(url.trim());
      const host = u.hostname.replace(/^www\.|^m\.|^music\./, '');
      if (!(host === 'youtu.be' || host.endsWith('youtube.com') || host.endsWith('youtube-nocookie.com'))) {
        return null;
      }
      const id = u.searchParams.get('list');
      if (!id || id === 'WL' || id === 'LL') {
        return null;
      }
      return /^[A-Za-z0-9_-]{12,}$/.test(id) ? id : null;
    } catch (e) {
      return null;
    }
  },

  // Tempo scritto come minuti e secondi → secondi totali
  secondiDa(minuti, secondi) {
    return (parseInt(minuti, 10) || 0) * 60 + (parseInt(secondi, 10) || 0);
  },

  // True se il tasto arriva da un campo di testo (lì SPAZIO e frecce servono a scrivere)
  daCampoDiTesto(evento) {
    const t = evento.target;
    if (!t || !t.tagName) {
      return false;
    }
    if (t.isContentEditable || t.tagName === 'TEXTAREA') {
      return true;
    }
    if (t.tagName === 'INPUT') {
      return ['text', 'number', 'url', 'search', 'email', 'password'].includes(t.type);
    }
    return false;
  },
};

// Nell'APK alcune scelte grafiche sono diverse dalla PWA (es. Area Educatore a tutta
// pagina): il foglio di stile le attiva con la classe "app-apk" sulla pagina
if (Util.apk) {
  document.documentElement.classList.add('app-apk');
}
