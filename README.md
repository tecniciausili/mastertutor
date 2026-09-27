# Mastertutor — versione autonoma

Strumento di **stimolazione e ascolto** per utenti con disabilità: audio registrati con la voce di chi
conosce l'utente, video YouTube (anche **solo audio**) e una **presa smart Tapo** per accendere una
luce, un ventilatore o un giocattolo.
È la versione PWA del programma Python *Mastertutor_Tapo*.

Applicazione **statica** (HTML/CSS/JavaScript) per Azure Static Web Apps, installabile su **computer e
tablet**. **Un dispositivo = un utente**: audio, video e registro restano nel browser del dispositivo.

## Funzionalità

### Area Educatore (accesso libero)

| Scheda | Cosa si fa |
|---|---|
| **Audio** | Registrare la voce con il microfono del dispositivo, oppure caricare **qualsiasi file audio** dal disco (MP3, vocali **WhatsApp**, M4A, WAV, FLAC, AMR, WMA, AIFF, anche l'audio di un video). Tutto viene convertito in MP3 nel browser (lamejs) e il silenzio iniziale e finale viene tagliato. Con la spunta **Nel gioco** l'audio diventa uno stimolo |
| **YouTube** | Ricerca integrata (scrivendo la categoria si apre YouTube), link, nome, **tempi di inizio e fine**, scelta **video** oppure **solo audio** |
| **Anticipatore** | L'audio che annuncia ogni stimolo: suono predefinito, nessuno, oppure uno registrato o caricato |
| **Presa** | Abbinamento con il **ponte** (codice di 12 caratteri), scelta delle prese, durata, prova. Il pulsante **Configura le prese** (anche nel menu ⋮) apre una finestra a scomparsa per inserire account Tapo e indirizzi delle prese di una nuova rete, per esempio a casa, e salvarli sul ponte |
| **Tempi** | Attesa casuale minima e massima, durata massima di audio e video, tipi di stimolo usati, tempo per rispondere allo switch |
| **Registro** | Sessioni svolte: stimoli, risposte allo switch, tempi medi di risposta, pressioni |

### Area Utente

La modalità si sceglie con il pulsante in alto a sinistra.

| Modalità | Comportamento |
|---|---|
| **Stimolazione casuale** | Come il programma originale. L'educatore preme *Avvia*; dopo un'attesa casuale suona l'anticipatore e parte lo stimolo. **Audio e video** seguono la lista (o partono a caso, se scelto); la **presa** parte sempre a caso, tra uno stimolo e l'altro |
| **Stimolo su richiesta** | Come sopra, ma dopo l'anticipatore lo stimolo parte **solo se l'utente preme lo switch** entro il tempo impostato. Il registro raccoglie risposte e tempi di reazione (causa-effetto) |
| **Ascolto con switch** | Come nelle altre app: **Diretto**, **Random** (mai lo stesso due volte di fila), **Temporizzato** (pausa dopo N secondi, lo switch riprende), **🔒 Timer persistente** (switch disattivato durante il timer), **Navigazione assistita** (la voce annuncia ogni stimolo, che parte dopo un conto alla rovescia) |

- **Switch**: SPAZIO, INVIO, frecce (Makey Makey, switch USB o Bluetooth) oppure **tocco sullo schermo**.
- **Doppio switch** (opzione): la FRECCIA DESTRA fa sentire gli audio registrati. La musica YouTube va in
  pausa e riprende alla fine dell'audio.
- **Attesa tra gli stimoli** regolabile con due cursori sotto *Avvia*: vale dal prossimo stimolo.
- **Ordine degli stimoli**: nell'elenco dell'Area Utente si trascinano con la maniglia ⠿ (mouse o
  dito; con la tastiera, frecce su e giù sulla maniglia). È un'unica sequenza, uguale in tutte le
  modalità e negli elenchi dell'Area Educatore (dove è di sola lettura: l'ordine si cambia **solo**
  nell'Area Utente). Nella stimolazione casuale e su richiesta la lista di audio e video si ripete
  dall'inizio e salta quelli non disponibili (tipo escluso nei *Tempi*, video non riproducibile).
  La **presa** non fa parte della sequenza: parte a caso, tra uno stimolo e l'altro.
- **Video pronti in anticipo**: il prossimo video si carica, muto e nascosto, mentre suona l'audio
  anticipatore o scorre il conto alla rovescia, così parte subito.
- **Schermo intero**, schermo sempre acceso durante le sessioni, scene grandi e ad alto contrasto.
- I tasti **non comandano YouTube** (`disablekb`) e un velo trasparente impedisce al video di rubare il focus.
- Su **iPad/iPhone** YouTube parte da solo solo dopo un primo tocco sul video: all'avvio di una
  sessione l'app lo chiede una volta.

## Architettura dati

| Dato | Dove |
|---|---|
| Video YouTube, impostazioni, registro | `localStorage` |
| Audio registrati e caricati (MP3) | `IndexedDB` |
| Account Tapo e indirizzi delle prese | solo nel `config.json` del **ponte**, mai nella PWA |

All'avvio l'app chiede `navigator.storage.persist()`. **Non cancellare i dati di navigazione** sul
dispositivo: contengono le registrazioni.

### Esporta / Importa (menu ⋮)

**Esporta dati** salva un unico file `.json` con impostazioni, video YouTube, ordine degli stimoli e
**gli audio inclusi** (in base64). **Importa dati** lo rilegge e sostituisce tutto. Serve a configurare
comodamente sul computer (dove copiare i link di YouTube è facile) e poi auto-configurare il tablet,
e vale anche come backup. Il file **non** contiene il registro delle sessioni né la password delle
prese; il codice di abbinamento del ponte resta quello del dispositivo su cui si importa. Gli id degli
audio vengono rimappati, così l'ordine degli stimoli resta corretto.

## La presa smart

Una PWA non può comandare le prese della rete locale, perché il browser lo impedisce. Il comando fa
questo giro:

```
PWA (computer, tablet, telefono) → Azure Web PubSub → ponte → prese Tapo
```

- **Il ponte** (cartella `ponte/`) è un programma Node.js senza dipendenze. Resta acceso su un computer
  o un Raspberry Pi nella rete delle prese. Riusa il codice Tapo delle app di CHIARA (KLAP v2 e
  Secure Passthrough). Istruzioni in [`ponte/README.md`](ponte/README.md).
- **Azure Web PubSub** fa da postino. Il ponte si collega da solo verso internet, quindi sul router non
  va aperto nulla, e il tablet può stare su qualunque rete.
- **La funzione `api/negotiate`** rilascia i permessi di collegamento. Ogni codice di abbinamento ha i
  suoi gruppi: chi non conosce il codice non comanda le prese.
- **Sicurezza**: la PWA chiede «accendi per N secondi» e lo spegnimento lo fa il ponte da solo, anche
  se il tablet perde la connessione.
- **Prese di un'altra rete** (per esempio a casa, con prese nuove): si avvia un ponte in quella rete,
  si inserisce il suo codice nella scheda *Presa*, poi con **Configura le prese** si scrivono account e
  indirizzi e si preme **Salva configurazione**. Il ponte salva, prova ogni presa e dice quali rispondono.
  La password viaggia cifrata fino al ponte e viene salvata solo lì, mai nella PWA.
- **Valori di sede**: il `ponte/config.json` di questa cartella contiene già la presa e l'account usati
  finora dal programma Python (`configfile.ini`). La PWA parte con stimolo di 30 secondi e attese di
  15–20 secondi, come il programma originale.

## Struttura del progetto

```
├── index.html                 Pagina unica
├── css/styles.css             Stili
├── js/
│   ├── util.js                Utilità comuni
│   ├── archivio.js            localStorage + IndexedDB
│   ├── elabora-audio.js       Registrazione, caricamento, taglio silenzio, MP3
│   ├── presa.js               Interfaccia unica della presa
│   ├── presa-webpubsub.js     Collegamento al ponte via Azure Web PubSub
│   ├── riproduttore.js        Palco: YouTube, audio, scene, schermo intero
│   ├── ordinabile.js          Elenchi riordinabili trascinando (mouse, dito, tastiera)
│   ├── scheda-presa.js        Area Educatore: scheda Presa
│   ├── configura-prese.js     Finestra a scomparsa "Configura le prese"
│   ├── educatore.js           Area Educatore
│   ├── utente.js              Area Utente: le tre modalità e gli switch
│   ├── app.js                 Avvio, menu, installazione PWA
│   └── lib/                   lamejs (encoder MP3) e ffmpeg.wasm (formati insoliti)
├── api/negotiate/             Funzione Azure (Node.js, nessuna dipendenza)
├── ponte/                     Ponte per le prese (va sul computer vicino alle prese)
├── strumenti/                 Server per provare la presa in locale, senza Azure
├── assets/                    Icone, font Bootstrap Icons, suono anticipatore
├── manifest.json · service-worker.js · staticwebapp.config.json · serve.json
```

Questo è il repository **mastertutor**: il codice web è uno solo e vale anche per l'APK.
La versione Android sta nel repository **mastertutor-android**, che va tenuto affiancato:

```
mastertutor/
├── versione_pwa/       ← questo repository (è quello che Azure pubblica)
├── versione_android/   ← mastertutor-android: involucro Capacitor, copia i file web da qui
└── mp3/, …             ← dati personali, fuori da entrambi i repository
```

## Sviluppo locale

```bash
cd mastertutor/versione_pwa
npx serve          # oppure: python3 -m http.server 8080
```

Con `npx serve` funzionano audio, YouTube e modalità, ma **non la presa**: `/api/negotiate` e Azure Web
PubSub esistono solo su Azure.

### Prova della presa dal computer, senza Azure

Al posto di `npx serve` (va chiuso prima, per restare sulla porta 3000 dove ci sono i dati) si usa il
server di prova. Con **un solo doppio clic** su `strumenti/prova-locale.command` (Mac) o
`strumenti/prova-locale.bat` (Windows):

- serve l'app e la apre nel browser;
- imita la parte Azure, usando la vera funzione `api/negotiate`;
- **avvia il ponte**, con le prese e l'account del suo `config.json`, e ne stampa il codice.

Nell'app, *Area Educatore → Presa*: codice del ponte → **Collega** → **Prova**. Con CTRL + C si
ferma tutto e il ponte spegne le prese. Per provare **senza prese**:
`node strumenti/server-locale.mjs --simula`. Le verifiche automatiche del ponte:
`cd ponte && npm run prove`.

## Pubblicazione su Azure

Si segue la *Guida operativa* del gruppo Ausili (piano **Gratuito**, gruppo **Ausili**, repository
**tecniciausili**) con due differenze:

1. **Percorso API: `api`** invece di vuoto. Se l'app esiste già, nel file
   `.github/workflows/azure-static-web-apps-….yml` si imposta `api_location: "api"`.
2. **Risorsa Web PubSub**, una volta sola:
   - portale Azure → **Crea risorsa** → **Web PubSub Service** (non «for Socket.IO»);
   - gruppo **Ausili**, area **West Europe**, piano tariffario **Free (F1)**;
   - nella risorsa, **Chiavi** → copiare la **Stringa di connessione** primaria;
   - nell'App Web statica, **Impostazioni → Variabili di ambiente** → aggiungere
     `WEBPUBSUB_CONNECTION_STRING` = la stringa copiata → **Applica**.

   L'hub `mastertutor` non va creato: nasce al primo collegamento.

> Il piano Free di Web PubSub consente **20 collegamenti contemporanei**, condivisi fra tutti i ponti e
> i dispositivi che usano la presa, e 20.000 messaggi al giorno. Se l'uso cresce, si passa al piano
> Standard.

Dopo ogni modifica si aumenta la versione in `service-worker.js` (`CACHE_NAME`) e il `?v=` in
`index.html`, altrimenti i dispositivi continuano a usare i file vecchi.

## Note

- **YouTube «solo audio»**: il video resta coperto da un'immagine. Le regole di YouTube per i player
  incorporati non consentono di separare l'audio dal video: è una scelta da valutare per un'app pubblica.
- Da ottobre 2025 YouTube rifiuta l'embed senza `origin` (errore 153): il player lo passa sempre, per
  questo l'app va aperta da `http://localhost` o `https://`, non con doppio clic sul file.
- **Video non riproducibili fuori da YouTube** (errori 101/150, frequenti con i video musicali
  ufficiali): nell'Area Educatore il video viene controllato appena si incolla il link, con
  un'anteprima, e se non si può usare non viene salvato. Se capita durante l'uso, sul palco compare il
  motivo, il video viene segnato nell'elenco e non viene più proposto finché non si preme **Riprova**.
- **Formati audio insoliti**: i più comuni li legge il browser; per gli altri (AMR, WMA, AIFF, video
  MOV…) l'app usa ffmpeg.wasm. I suoi file sono in `js/lib/ffmpeg/`, mentre il motore (@ffmpeg/core,
  circa 30 MB, licenza GPL) si scarica da cdn.jsdelivr.net solo la prima volta che serve.
- Il service worker usa **prima la rete**: con la connessione i dispositivi prendono sempre i file
  aggiornati, senza la rete usano la copia in cache.
- Il microfono richiede `https://` (o `localhost`). L'intestazione `Permissions-Policy: microphone=(self)`
  è in `staticwebapp.config.json`.
