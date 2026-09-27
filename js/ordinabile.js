// ==================== ELENCHI RIORDINABILI ====================
// Si prende la maniglia ⠿ di un elemento e lo si trascina in alto o in basso:
// funziona con il mouse, con il dito (tablet) e con la penna. Con la tastiera,
// sulla maniglia, le frecce su e giù spostano l'elemento di un posto.

const Ordinabile = (() => {
  function trovaScorrimento(el) {
    for (let p = el; p && p !== document.body; p = p.parentElement) {
      const stile = getComputedStyle(p);
      if (/(auto|scroll)/.test(stile.overflowY) && p.scrollHeight > p.clientHeight) {
        return p;
      }
    }
    return document.scrollingElement;
  }

  // opzioni: { elemento: selettore delle righe, maniglia: selettore della maniglia,
  //            onCambio: (chiavi) => … con i data-chiave nel nuovo ordine }
  function attiva(contenitore, { elemento = '.brano-item', maniglia = '.maniglia', onCambio = () => {} } = {}) {
    let trascinato = null;
    let manigliaAttiva = null;
    let idPuntatore = null;
    let scostamento = 0;
    let ultimaY = 0;
    let scorrimento = null;
    let animazione = null;
    let ordinePrima = '';

    const chiavi = () => [...contenitore.querySelectorAll(elemento)].map((x) => x.dataset.chiave);

    function riposiziona() {
      if (!trascinato) {
        return;
      }
      const altri = [...contenitore.querySelectorAll(elemento)].filter((x) => x !== trascinato);
      let prima = null;
      for (const altro of altri) {
        const r = altro.getBoundingClientRect();
        if (ultimaY < r.top + r.height / 2) {
          prima = altro;
          break;
        }
      }
      if (prima) {
        if (trascinato.nextElementSibling !== prima) {
          contenitore.insertBefore(trascinato, prima);
        }
      } else if (altri.length && altri[altri.length - 1].nextElementSibling !== trascinato) {
        altri[altri.length - 1].after(trascinato);
      }
      // L'elemento resta sotto il dito anche dopo lo spostamento nel DOM
      trascinato.style.transform = '';
      const naturale = trascinato.getBoundingClientRect().top;
      trascinato.style.transform = `translateY(${ultimaY - scostamento - naturale}px)`;
    }

    // Vicino ai bordi dell'elenco lo faccio scorrere, così si arriva anche agli elementi nascosti
    function autoScorrimento() {
      if (!trascinato) {
        return;
      }
      const r = scorrimento === document.scrollingElement
        ? { top: 0, bottom: window.innerHeight }
        : scorrimento.getBoundingClientRect();
      const margine = 48;
      let passo = 0;
      if (ultimaY < r.top + margine) {
        passo = -Math.ceil((r.top + margine - ultimaY) / 6);
      } else if (ultimaY > r.bottom - margine) {
        passo = Math.ceil((ultimaY - (r.bottom - margine)) / 6);
      }
      if (passo) {
        scorrimento.scrollTop += passo;
        riposiziona();
      }
      animazione = requestAnimationFrame(autoScorrimento);
    }

    function muovi(e) {
      if (e.pointerId !== idPuntatore) {
        return;
      }
      ultimaY = e.clientY;
      riposiziona();
    }

    function termina(e) {
      if (e && e.pointerId !== idPuntatore) {
        return;
      }
      cancelAnimationFrame(animazione);
      manigliaAttiva?.removeEventListener('pointermove', muovi);
      manigliaAttiva?.removeEventListener('pointerup', termina);
      manigliaAttiva?.removeEventListener('pointercancel', termina);
      if (trascinato) {
        trascinato.style.transform = '';
        trascinato.classList.remove('in-trascinamento');
      }
      document.body.classList.remove('trascinamento-attivo');
      trascinato = null;
      manigliaAttiva = null;
      idPuntatore = null;
      const dopo = chiavi();
      if (dopo.join('|') !== ordinePrima) {
        onCambio(dopo);
      }
    }

    contenitore.addEventListener('pointerdown', (e) => {
      const m = e.target.closest(maniglia);
      const riga = m?.closest(elemento);
      if (!m || !riga || !contenitore.contains(riga) || trascinato) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      trascinato = riga;
      manigliaAttiva = m;
      idPuntatore = e.pointerId;
      ultimaY = e.clientY;
      scostamento = e.clientY - riga.getBoundingClientRect().top;
      ordinePrima = chiavi().join('|');
      scorrimento = trovaScorrimento(contenitore);
      m.setPointerCapture(e.pointerId);
      m.addEventListener('pointermove', muovi);
      m.addEventListener('pointerup', termina);
      m.addEventListener('pointercancel', termina);
      riga.classList.add('in-trascinamento');
      document.body.classList.add('trascinamento-attivo');
      animazione = requestAnimationFrame(autoScorrimento);
    });

    // Tastiera: frecce su/giù sulla maniglia
    contenitore.addEventListener('keydown', (e) => {
      const m = e.target.closest(maniglia);
      const riga = m?.closest(elemento);
      if (!riga || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'ArrowUp' && riga.previousElementSibling?.matches(elemento)) {
        riga.previousElementSibling.before(riga);
      } else if (e.key === 'ArrowDown' && riga.nextElementSibling?.matches(elemento)) {
        riga.nextElementSibling.after(riga);
      } else {
        return;
      }
      m.focus();
      onCambio(chiavi());
    });
  }

  return { attiva };
})();
