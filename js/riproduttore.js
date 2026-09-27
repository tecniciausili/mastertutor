// ==================== RIPRODUTTORE E PALCO ====================
// Il "palco" è lo spazio grande dell'Area Utente: contiene il player YouTube,
// le scene della stimolazione (attesa, audio anticipatore, richiesta dello
// switch, presa accesa) e la copertina per i video in modalità "solo audio".
//
// Ogni riproduzione restituisce una Promise che si risolve quando lo stimolo
// finisce: 'fine' (fine naturale o durata massima), 'stop' (interrotto),
// 'errore' (file o video non riproducibile).

const Riproduttore = (() => {
  const SCENE = {
    riposo: { icona: 'bi-headphones', classe: 'scena-riposo' },
    attesa: { icona: 'bi-moon-stars', classe: 'scena-attesa' },
    anticipatore: { icona: 'bi-ear', classe: 'scena-anticipatore' },
    richiesta: { icona: 'bi-hand-index-thumb', classe: 'scena-richiesta' },
    audio: { icona: 'bi-soundwave', classe: 'scena-audio' },
    'solo-audio': { icona: 'bi-music-note-beamed', classe: 'scena-audio' },
    presa: { icona: 'bi-lightning-charge-fill', classe: 'scena-presa' },
    pausa: { icona: 'bi-pause-circle', classe: 'scena-pausa' },
    annuncio: { icona: 'bi-megaphone', classe: 'scena-annuncio' },
    blocco: { icona: 'bi-shield-lock', classe: 'scena-blocco' },
    errore: { icona: 'bi-exclamation-triangle', classe: 'scena-errore' },
    caricamento: { icona: 'bi-hourglass-split', classe: 'scena-caricamento' },
  };

  // Errori del player YouTube (evento onError) spiegati a chi usa l'app
  const ERRORI_YOUTUBE = {
    2: 'Il link del video non è valido.',
    5: 'Il browser non riesce a riprodurre questo video.',
    100: 'Il video non esiste più oppure è privato.',
    101: 'Il proprietario non permette di vederlo fuori da YouTube (succede spesso con i video musicali ufficiali).',
    150: 'Il proprietario non permette di vederlo fuori da YouTube (succede spesso con i video musicali ufficiali).',
    153: 'YouTube non riconosce l\'indirizzo dell\'app: aprila da http://localhost o dal suo indirizzo su Azure, non con doppio clic sul file.',
  };
  // Errori che non cambiano riprovando: il video va sostituito
  const ERRORI_DEFINITIVI = [2, 100, 101, 150];

  function descriviErroreYoutube(codice) {
    return ERRORI_YOUTUBE[codice] || `YouTube non riesce a riprodurre questo video (errore ${codice}).`;
  }

  function erroreDefinitivo(codice) {
    return ERRORI_DEFINITIVI.includes(Number(codice));
  }

  // iPad e iPhone: YouTube parte solo dopo un tocco sul video stesso
  const IOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  let el = null;              // elementi del palco montato
  let onTocco = null;         // tocco sul palco = switch
  let contatoreId = null;

  const audioEl = new Audio();
  audioEl.preload = 'auto';
  audioEl.setAttribute('playsinline', '');
  let audioSbloccato = false;
  let ttsSbloccato = false;
  let urlBlob = null;
  let chiudiAudio = null;     // chiude la riproduzione audio in corso

  let yt = null;
  let ytPronto = null;
  let ytSbloccato = !IOS;     // fuori da iOS basta un'interazione con la pagina
  let ytAscoltatore = null;   // riceve stati ed errori della riproduzione in corso
  let chiudiYoutube = null;
  let attesaTocco = null;     // callback quando YouTube parte dopo un tocco
  let ytPartito = false;      // il video in corso ha iniziato a suonare
  let precarico = null;       // {videoId, inizio, stato: 'in-corso'|'pronto'|'errore'|'lento', codice}
  let ytPrecaricoAscoltatore = null;
  let ultimoErrore = null;    // {codice, videoId} dell'ultimo video non riproducibile

  let wakeLock = null;
  let schermoRichiesto = false;

  const silenzioUrl = creaSilenzioWav();

  // WAV di 0,1 s di silenzio: serve a "sbloccare" l'audio al primo tocco (iOS)
  function creaSilenzioWav() {
    const sr = 8000;
    const n = 800;
    const buf = new ArrayBuffer(44 + n);
    const v = new DataView(buf);
    const testo = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
    testo(0, 'RIFF');
    v.setUint32(4, 36 + n, true);
    testo(8, 'WAVE');
    testo(12, 'fmt ');
    v.setUint32(16, 16, true);
    v.setUint16(20, 1, true);
    v.setUint16(22, 1, true);
    v.setUint32(24, sr, true);
    v.setUint32(28, sr, true);
    v.setUint16(32, 1, true);
    v.setUint16(34, 8, true);
    testo(36, 'data');
    v.setUint32(40, n, true);
    for (let i = 0; i < n; i++) {
      v.setUint8(44 + i, 128);
    }
    return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
  }

  // ==================== PALCO ====================

  function monta(contenitore, opzioni = {}) {
    smonta();
    onTocco = opzioni.onTocco || null;

    contenitore.innerHTML = `
      <div class="palco" id="palco">
        <div class="palco-video"><div id="palcoYoutube"></div></div>
        <div class="palco-scena scena-riposo" id="palcoScena">
          <i class="bi bi-headphones scena-icona" aria-hidden="true"></i>
          <div class="scena-titolo"></div>
          <div class="scena-sottotitolo"></div>
          <div class="scena-contatore" hidden></div>
        </div>
        <div class="palco-tocco" id="palcoTocco" title="Tocca = switch"></div>
        <div class="palco-avviso" id="palcoAvviso" hidden>
          <i class="bi bi-hand-index-thumb"></i> <span></span>
        </div>
        <div class="palco-badge" id="palcoBadge" hidden></div>
        <button type="button" class="palco-schermo-intero" id="palcoSchermoIntero"
          title="Schermo intero" aria-label="Schermo intero">
          <i class="bi bi-fullscreen"></i>
        </button>
      </div>
    `;

    el = {
      palco: contenitore.querySelector('#palco'),
      scena: contenitore.querySelector('#palcoScena'),
      icona: contenitore.querySelector('.scena-icona'),
      titolo: contenitore.querySelector('.scena-titolo'),
      sottotitolo: contenitore.querySelector('.scena-sottotitolo'),
      contatore: contenitore.querySelector('.scena-contatore'),
      tocco: contenitore.querySelector('#palcoTocco'),
      avviso: contenitore.querySelector('#palcoAvviso'),
      avvisoTesto: contenitore.querySelector('#palcoAvviso span'),
      badge: contenitore.querySelector('#palcoBadge'),
      schermoIntero: contenitore.querySelector('#palcoSchermoIntero'),
    };

    el.tocco.addEventListener('click', () => {
      sblocca();
      onTocco?.();
    });
    el.schermoIntero.addEventListener('click', (e) => {
      e.stopPropagation();
      alternaSchermoIntero();
    });

    scena('riposo', opzioni.scenaIniziale || {});
  }

  function smonta() {
    ferma();
    fermaContatore();
    if (yt) {
      try {
        yt.destroy();
      } catch (e) { /* già distrutto */ }
    }
    yt = null;
    ytPronto = null;
    ytAscoltatore = null;
    precarico = null;
    ytPrecaricoAscoltatore = null;
    attesaTocco = null;
    el = null;
    onTocco = null;
  }

  // Mostra una scena sopra il video. 'video' nasconde la scena e lascia vedere YouTube.
  function scena(nome, { titolo = '', sottotitolo = '', contatore = null } = {}) {
    if (!el) {
      return;
    }
    fermaContatore();
    if (nome === 'video') {
      el.scena.classList.add('nascosta');
      return;
    }
    const def = SCENE[nome] || SCENE.riposo;
    el.scena.className = `palco-scena ${def.classe}`;
    el.icona.className = `bi ${def.icona} scena-icona`;
    el.titolo.textContent = titolo;
    el.sottotitolo.textContent = sottotitolo;
    el.contatore.hidden = contatore === null;
    if (contatore !== null) {
      let rimanenti = Math.max(0, Math.round(contatore));
      el.contatore.textContent = String(rimanenti);
      contatoreId = setInterval(() => {
        rimanenti = Math.max(0, rimanenti - 1);
        if (el) {
          el.contatore.textContent = String(rimanenti);
        }
        if (rimanenti <= 0) {
          fermaContatore();
        }
      }, 1000);
    }
  }

  function fermaContatore() {
    if (contatoreId) {
      clearInterval(contatoreId);
      contatoreId = null;
    }
  }

  function mostraBadge(testo) {
    if (!el) {
      return;
    }
    el.badge.textContent = testo || '';
    el.badge.hidden = !testo;
  }

  // Chiede di toccare il video: il velo trasparente si disattiva così il tocco
  // arriva al player YouTube (su iPad è l'unico modo per far partire l'audio)
  function mostraRichiestaTocco(testo) {
    if (!el) {
      return;
    }
    el.avvisoTesto.textContent = testo;
    el.avviso.hidden = false;
    el.palco.classList.add('attende-tocco-video');
  }

  function nascondiRichiestaTocco() {
    if (!el) {
      return;
    }
    el.avviso.hidden = true;
    el.palco.classList.remove('attende-tocco-video');
  }

  // ==================== SBLOCCO AUDIO (da chiamare dentro un tocco o un tasto) ====================

  function sblocca() {
    if (!audioSbloccato && audioEl.paused && !chiudiAudio) {
      audioEl.src = silenzioUrl;
      audioEl.play().then(() => {
        audioSbloccato = true;
      }).catch(() => {});
    }
    if (!ttsSbloccato && 'speechSynthesis' in window) {
      try {
        const u = new SpeechSynthesisUtterance(' ');
        u.volume = 0;
        window.speechSynthesis.speak(u);
      } catch (e) { /* non supportato */ }
      ttsSbloccato = true;
    }
  }

  // ==================== AUDIO (registrazioni, file, anticipatore) ====================

  // sorgente: Blob oppure URL
  function riproduciAudio(sorgente, { maxSecondi = 0, segnale } = {}) {
    return new Promise((resolve) => {
      if (segnale?.aborted) {
        resolve('stop');
        return;
      }
      chiudiAudio?.('stop');

      if (urlBlob) {
        URL.revokeObjectURL(urlBlob);
        urlBlob = null;
      }
      let url = sorgente;
      if (sorgente instanceof Blob) {
        urlBlob = URL.createObjectURL(sorgente);
        url = urlBlob;
      }

      let finito = false;
      let timerMax = null;
      let rimuoviAttesaTocco = null;
      const alTermine = () => chiudi('fine');
      const alErrore = () => chiudi('errore');
      const alStop = () => chiudi('stop');

      function chiudi(esito) {
        if (finito) {
          return;
        }
        finito = true;
        clearTimeout(timerMax);
        rimuoviAttesaTocco?.();
        audioEl.removeEventListener('ended', alTermine);
        audioEl.removeEventListener('error', alErrore);
        segnale?.removeEventListener('abort', alStop);
        if (esito !== 'fine' || !audioEl.ended) {
          audioEl.pause();
        }
        if (chiudiAudio === chiudi) {
          chiudiAudio = null;
        }
        nascondiRichiestaTocco();
        resolve(esito);
      }

      chiudiAudio = chiudi;
      audioEl.addEventListener('ended', alTermine);
      audioEl.addEventListener('error', alErrore);
      segnale?.addEventListener('abort', alStop, { once: true });
      if (maxSecondi > 0) {
        timerMax = setTimeout(() => chiudi('fine'), maxSecondi * 1000);
      }

      audioEl.src = url;
      audioEl.play().then(() => {
        audioSbloccato = true;
      }).catch((e) => {
        if (finito) {
          return;
        }
        if (e && e.name === 'NotAllowedError') {
          // Autoplay bloccato: aspetto un tocco sul palco (che in questo caso
          // serve solo a sbloccare l'audio, non vale come pressione dello switch)
          mostraRichiestaTocco('Tocca lo schermo per ascoltare');
          el?.palco.classList.remove('attende-tocco-video');
          const tocco = el?.tocco;
          const riprova = (evento) => {
            evento.stopImmediatePropagation();
            rimuoviAttesaTocco?.();
            nascondiRichiestaTocco();
            audioEl.play().catch(() => chiudi('errore'));
          };
          rimuoviAttesaTocco = () => {
            tocco?.removeEventListener('click', riprova, true);
            rimuoviAttesaTocco = null;
          };
          tocco?.addEventListener('click', riprova, true);
        } else if (!e || e.name !== 'AbortError') {
          chiudi('errore');
        }
      });
    });
  }

  // ==================== YOUTUBE ====================

  function attendiApiYoutube(timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      const inizio = Date.now();
      (function controlla() {
        if (window.YT && typeof window.YT.Player === 'function') {
          resolve();
        } else if (Date.now() - inizio > timeoutMs) {
          reject(new Error('YouTube non raggiungibile: serve la connessione a internet.'));
        } else {
          setTimeout(controlla, 200);
        }
      }());
    });
  }

  function youtubeDisponibile() {
    return !!(window.YT && typeof window.YT.Player === 'function') && navigator.onLine !== false;
  }

  function youtubeSbloccato() {
    return ytSbloccato;
  }

  // Crea (una volta per palco) il player YouTube, già con un video in coda
  function preparaYoutube(videoIdIniziale) {
    if (ytPronto) {
      return ytPronto;
    }
    ytPronto = attendiApiYoutube().then(() => new Promise((resolve, reject) => {
      if (!el) {
        reject(new Error('Palco non disponibile.'));
        return;
      }
      const opzioni = {
        width: '100%',
        height: '100%',
        playerVars: {
          autoplay: 0,
          controls: 1,
          rel: 0,
          modestbranding: 1,
          disablekb: 1,      // i tasti restano agli switch, non comandano YouTube
          playsinline: 1,
          fs: 0,             // lo schermo intero è quello del palco
          iv_load_policy: 3,
          // Da ottobre 2025 YouTube rifiuta l'embed senza un origin valido (errore 153)
          enablejsapi: 1,
          origin: window.location.origin,
        },
        events: {
          onReady: () => resolve(yt),
          onStateChange: (evento) => {
            ytPrecaricoAscoltatore?.('stato', evento.data);
            if (evento.data === 1 && !ytPrecaricoAscoltatore) {
              ytSbloccato = true;
              nascondiRichiestaTocco();
              if (attesaTocco) {
                const fatto = attesaTocco;
                attesaTocco = null;
                fatto();
              }
            }
            ytAscoltatore?.('stato', evento.data);
          },
          onError: (evento) => {
            ytPrecaricoAscoltatore?.('errore', evento.data);
            ytAscoltatore?.('errore', evento.data);
          },
        },
      };
      if (videoIdIniziale) {
        opzioni.videoId = videoIdIniziale;
      }
      yt = new YT.Player('palcoYoutube', opzioni);
    }));
    ytPronto.catch(() => {
      ytPronto = null;
    });
    return ytPronto;
  }

  // Su iPad: prima di una sessione automatica chiede di toccare una volta il video,
  // così i video successivi possono partire da soli. Restituisce true se sbloccato.
  async function assicuraYoutubeSbloccato(segnale) {
    if (ytSbloccato) {
      return true;
    }
    let player;
    try {
      player = await preparaYoutube();
    } catch (e) {
      return false;
    }
    if (segnale?.aborted) {
      return false;
    }
    scena('video');
    mostraRichiestaTocco('Tocca il video una volta per abilitare YouTube');
    const sbloccato = await new Promise((resolve) => {
      const timer = setTimeout(() => chiudi(false), 120000);
      const alStop = () => chiudi(false);
      function chiudi(esito) {
        clearTimeout(timer);
        segnale?.removeEventListener('abort', alStop);
        attesaTocco = null;
        resolve(esito);
      }
      attesaTocco = () => chiudi(true);
      segnale?.addEventListener('abort', alStop, { once: true });
    });
    nascondiRichiestaTocco();
    try {
      player.pauseVideo();
    } catch (e) { /* ignora */ }
    return sbloccato;
  }

  // Prepara un video mentre suona altro (audio anticipatore, conto alla rovescia):
  // lo carica muto e nascosto e lo ferma appena è pronto, così quando serve parte
  // subito. Se YouTube lo rifiuta, l'errore è già noto prima di mostrarlo.
  async function precaricaYoutube(video) {
    if (IOS && !ytSbloccato) {
      return false; // su iPad il primo avvio deve venire da un tocco
    }
    if (precarico && precarico.videoId === video.video_id && precarico.stato !== 'lento') {
      return precarico.stato === 'pronto';
    }
    if (chiudiYoutube) {
      return false; // un video sta già suonando: non lo interrompo
    }
    let player;
    try {
      player = await preparaYoutube(video.video_id);
    } catch (e) {
      return false;
    }
    if (chiudiYoutube) {
      return false;
    }
    annullaPrecarico();
    const voce = { videoId: video.video_id, inizio: video.inizio || 0, stato: 'in-corso', codice: null };
    precarico = voce;
    return new Promise((resolve) => {
      let timer = null;
      const fine = (esito) => {
        clearTimeout(timer);
        if (ytPrecaricoAscoltatore === ascolta) {
          ytPrecaricoAscoltatore = null;
        }
        resolve(esito);
      };
      const ascolta = (tipo, dato) => {
        if (precarico !== voce) {
          fine(false);
          return;
        }
        if (tipo === 'errore') {
          voce.stato = 'errore';
          voce.codice = Number(dato);
          ultimoErrore = { codice: voce.codice, videoId: voce.videoId };
          try {
            player.unMute();
          } catch (e) { /* ignora */ }
          fine(false);
        } else if (dato === 1) {
          try {
            player.pauseVideo();
            player.seekTo(voce.inizio, true);
            player.unMute();
          } catch (e) { /* ignora */ }
          voce.stato = 'pronto';
          fine(true);
        }
      };
      ytPrecaricoAscoltatore = ascolta;
      timer = setTimeout(() => {
        if (voce.stato === 'in-corso') {
          voce.stato = 'lento';
          try {
            player.unMute();
          } catch (e) { /* ignora */ }
        }
        fine(false);
      }, 10000);
      try {
        player.mute();
        player.loadVideoById({ videoId: voce.videoId, startSeconds: voce.inizio });
      } catch (e) {
        fine(false);
      }
    });
  }

  function annullaPrecarico() {
    if (precarico) {
      precarico = null;
      ytPrecaricoAscoltatore = null;
      try {
        yt?.unMute();
      } catch (e) { /* ignora */ }
    }
  }

  function riproduciYoutube(video, { maxSecondi = 0, segnale } = {}) {
    return new Promise((resolve) => {
      if (segnale?.aborted) {
        resolve('stop');
        return;
      }
      chiudiYoutube?.('stop');

      let finito = false;
      let monitor = null;
      let timerMax = null;
      let timerAvvio = null;
      let partito = false;
      const alStop = () => chiudi('stop');

      function chiudi(esito) {
        if (finito) {
          return;
        }
        finito = true;
        clearInterval(monitor);
        clearTimeout(timerMax);
        clearTimeout(timerAvvio);
        segnale?.removeEventListener('abort', alStop);
        if (chiudiYoutube === chiudi) {
          chiudiYoutube = null;
          ytAscoltatore = null;
        }
        if (esito !== 'fine' || !yt || yt.getPlayerState?.() !== 0) {
          try {
            yt?.pauseVideo();
          } catch (e) { /* ignora */ }
        }
        nascondiRichiestaTocco();
        resolve(esito);
      }

      chiudiYoutube = chiudi;
      ytPartito = false;
      segnale?.addEventListener('abort', alStop, { once: true });

      preparaYoutube(video.video_id).then((player) => {
        if (finito) {
          return;
        }
        let inErrore = false;
        ytAscoltatore = (tipo, dato) => {
          if (tipo === 'errore') {
            if (inErrore) {
              return;
            }
            // Invece di far sparire il video spiego perché non parte, poi proseguo
            inErrore = true;
            ultimoErrore = { codice: Number(dato), videoId: video.video_id };
            console.warn(`YouTube: errore ${dato} sul video "${video.nome}" (${video.video_id})`);
            clearInterval(monitor);
            clearTimeout(timerMax);
            clearTimeout(timerAvvio);
            nascondiRichiestaTocco();
            scena('errore', { titolo: `"${video.nome}" non si può riprodurre`, sottotitolo: descriviErroreYoutube(dato) });
            setTimeout(() => chiudi('errore'), 5000);
          } else if (dato === 1) {
            if (!partito && !video.solo_audio && el?.scena.classList.contains('scena-caricamento')) {
              scena('video');
            }
            partito = true;
            ytPartito = true;
          } else if (dato === 0 && !inErrore) {
            chiudi('fine');
          }
        };

        const pronto = precarico && precarico.videoId === video.video_id ? precarico : null;
        if (pronto?.stato === 'errore') {
          // YouTube lo aveva già rifiutato durante la preparazione
          precarico = null;
          ytAscoltatore('errore', pronto.codice);
          return;
        }
        if (pronto && (pronto.stato === 'pronto' || pronto.stato === 'in-corso')) {
          // Video già caricato (o in caricamento): basta farlo partire, con l'audio
          precarico = null;
          ytPrecaricoAscoltatore = null;
          try {
            player.unMute();
            if (pronto.stato === 'pronto') {
              player.seekTo(video.inizio || 0, true);
            }
            player.playVideo();
          } catch (e) { /* ignora */ }
        } else {
          annullaPrecarico();
          const carica = { videoId: video.video_id, startSeconds: video.inizio || 0 };
          if (video.fine > 0) {
            carica.endSeconds = video.fine;
          }
          player.loadVideoById(carica);
        }

        if (video.fine > 0) {
          monitor = setInterval(() => {
            try {
              if (player.getCurrentTime() >= video.fine) {
                chiudi('fine');
              }
            } catch (e) { /* player non pronto */ }
          }, 250);
        }
        if (maxSecondi > 0) {
          timerMax = setTimeout(() => chiudi('fine'), maxSecondi * 1000);
        }
        // Se dopo qualche secondo non è partito, l'autoplay è bloccato (tipico su iPad)
        timerAvvio = setTimeout(() => {
          if (!partito && !finito) {
            mostraRichiestaTocco('Tocca il video per avviarlo');
          }
        }, IOS ? 1500 : 4000);
      }).catch((e) => {
        console.warn('YouTube non disponibile:', e.message);
        chiudi('errore');
      });
    });
  }

  // ==================== CONTROLLI COMUNI ====================

  function pausaAudio() {
    audioEl.pause();
  }

  function riprendiAudio() {
    if (chiudiAudio) {
      audioEl.play().catch(() => {});
    }
  }

  function audioInCorso() {
    return !!chiudiAudio;
  }

  function pausaYoutube() {
    try {
      yt?.pauseVideo();
    } catch (e) { /* ignora */ }
  }

  function riprendiYoutube() {
    if (chiudiYoutube) {
      try {
        yt?.playVideo();
      } catch (e) { /* ignora */ }
    }
  }

  function youtubeInCorso() {
    return !!chiudiYoutube;
  }

  // Il video in corso non è ancora partito (autoplay bloccato o ancora in caricamento)
  function youtubeInAttesaDiAvvio() {
    return !!chiudiYoutube && !ytPartito && !(el && el.scena.classList.contains('scena-errore'));
  }

  // Tocco sul palco mentre il video non è partito: provo ad avviarlo e lascio
  // passare i tocchi successivi al player (come nelle altre app)
  function avviaYoutube() {
    try {
      yt?.playVideo();
    } catch (e) { /* ignora */ }
    mostraRichiestaTocco('Tocca il video per avviarlo');
  }

  function ultimoErroreYoutube() {
    return ultimoErrore;
  }

  function youtubeStaSuonando() {
    try {
      const s = yt?.getPlayerState?.();
      return !!chiudiYoutube && (s === 1 || s === 3);
    } catch (e) {
      return false;
    }
  }

  function ferma() {
    chiudiAudio?.('stop');
    chiudiYoutube?.('stop');
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    mostraBadge('');
  }

  // Sintesi vocale (navigazione assistita): si risolve a fine lettura
  function parla(testo, segnale) {
    if (!('speechSynthesis' in window) || !testo) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      let finito = false;
      const fine = () => {
        if (!finito) {
          finito = true;
          clearTimeout(timer);
          resolve();
        }
      };
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(testo);
      u.lang = 'it-IT';
      u.rate = 1;
      const voce = window.speechSynthesis.getVoices().find((v) => (v.lang || '').toLowerCase().startsWith('it'));
      if (voce) {
        u.voice = voce;
      }
      u.onend = fine;
      u.onerror = fine;
      // Alcuni browser non segnalano la fine: tempo massimo stimato
      const timer = setTimeout(fine, 2000 + testo.length * 90);
      segnale?.addEventListener('abort', () => {
        window.speechSynthesis.cancel();
        fine();
      }, { once: true });
      window.speechSynthesis.speak(u);
    });
  }

  // ==================== SCHERMO SEMPRE ACCESO E SCHERMO INTERO ====================

  async function schermoAcceso(attivo) {
    schermoRichiesto = attivo;
    if (!('wakeLock' in navigator)) {
      return;
    }
    if (attivo && !wakeLock) {
      try {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => {
          wakeLock = null;
        });
      } catch (e) { /* negato (batteria scarica o pagina non visibile) */ }
    } else if (!attivo && wakeLock) {
      try {
        await wakeLock.release();
      } catch (e) { /* già rilasciato */ }
      wakeLock = null;
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && schermoRichiesto && !wakeLock) {
      schermoAcceso(true);
    }
  });

  function elementoSchermoIntero() {
    return document.fullscreenElement || document.webkitFullscreenElement || null;
  }

  function alternaSchermoIntero() {
    if (!el) {
      return;
    }
    if (!elementoSchermoIntero()) {
      const richiedi = el.palco.requestFullscreen || el.palco.webkitRequestFullscreen;
      const p = richiedi?.call(el.palco);
      p?.catch?.(() => {});
    } else {
      const esci = document.exitFullscreen || document.webkitExitFullscreen;
      esci?.call(document);
    }
  }

  function aggiornaIconaSchermoIntero() {
    const icona = el?.schermoIntero.querySelector('i');
    if (icona) {
      icona.className = elementoSchermoIntero() ? 'bi bi-fullscreen-exit' : 'bi bi-fullscreen';
    }
  }
  document.addEventListener('fullscreenchange', aggiornaIconaSchermoIntero);
  document.addEventListener('webkitfullscreenchange', aggiornaIconaSchermoIntero);

  return {
    IOS,
    monta,
    smonta,
    scena,
    mostraBadge,
    sblocca,
    riproduciAudio,
    preparaYoutube,
    riproduciYoutube,
    assicuraYoutubeSbloccato,
    youtubeDisponibile,
    youtubeSbloccato,
    pausaAudio,
    riprendiAudio,
    audioInCorso,
    pausaYoutube,
    riprendiYoutube,
    youtubeInCorso,
    youtubeStaSuonando,
    youtubeInAttesaDiAvvio,
    avviaYoutube,
    precaricaYoutube,
    ultimoErroreYoutube,
    descriviErroreYoutube,
    erroreDefinitivo,
    attendiApiYoutube,
    ferma,
    parla,
    schermoAcceso,
    alternaSchermoIntero,
  };
})();
