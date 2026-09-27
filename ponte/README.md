# Ponte Mastertutor

Programma che collega la PWA **Mastertutor** alle **prese TP-Link Tapo** della rete locale.

```
PWA (computer, tablet, telefono) → Azure Web PubSub → PONTE → prese Tapo
```

Una pagina web non può comandare le prese: il browser non le lascia parlare con i dispositivi della rete
locale, e l'app Tapo usa un protocollo che una pagina non può eseguire. Il ponte fa da tramite. Resta
acceso su un computer collegato alla **stessa rete Wi-Fi delle prese** e aspetta i comandi della PWA.
I comandi arrivano attraverso il servizio Azure Web PubSub.

- **È il ponte a collegarsi a internet**, quindi sul router non va aperto nulla.
- **Lo spegnimento lo decide il ponte.** La PWA chiede «accendi per N secondi» e allo scadere il ponte
  spegne la presa da solo, anche se il tablet perde la connessione o viene chiuso.
- **La password dell'account Tapo viene salvata solo su questo computer**, nel file `config.json`.
  Se la si inserisce dalla PWA (finestra *Configura le prese*) viaggia cifrata attraverso Azure fino al
  ponte, ma non viene salvata altrove e non torna mai indietro ai tablet.

Il protocollo delle prese (cartella `tapo/`) viene dalle app di CHIARA: **KLAP v2** per i
firmware recenti e **Secure Passthrough** (AES) per quelli fino alla 1.3.x, scelto in automatico.
Il Secure Passthrough è stato riscritto sul modello di python-kasa: la versione di CHIARA veniva
respinta dalla P100 con firmware 1.3.7 («socket hang up»), questa si collega (login versione 2).

---

## Avvio

| Sistema | Come si avvia |
|---|---|
| **Windows** | Doppio clic su **`avvia.bat`** |
| **macOS** | Doppio clic su **`avvia.command`** |
| **Linux / Raspberry Pi** | `./avvia.command` dal terminale |

Serve **Node.js 22 o successivo** (<https://nodejs.org>, versione LTS). Non c'è nient'altro da
installare: nessun `npm install`, nessuna dipendenza esterna.

All'avvio il ponte:
1. **spegne tutte le prese**, per sicurezza (una chiusura improvvisa potrebbe averne lasciata una accesa);
2. apre nel browser la pagina di configurazione **<http://localhost:8124>**;
3. si collega ad Azure e resta in ascolto.

Per fermarlo: **CTRL + C** nella finestra nera. Le prese vengono spente prima di uscire.

Avvio manuale:

```bash
node ponte.js                  # normale
node ponte.js --simula         # prese finte: per provare senza hardware
node ponte.js --porta 8200     # pagina di configurazione su un'altra porta
node ponte.js --senza-browser  # non apre il browser (Raspberry Pi, servizio di sistema)
```

---

## Configurazione (una volta sola)

Si può fare in due modi, con gli stessi dati:
- **dalla PWA**: *Area Educatore → Presa → Configura le prese*, dopo aver abbinato il ponte con il suo
  codice. È il modo comodo per riconfigurare le prese a casa, dal tablet;
- **dalla pagina del ponte**, sul computer dove gira.

Nella pagina **<http://localhost:8124>**:

| Passo | Cosa inserire |
|---|---|
| **1. Indirizzo dell'app** | L'indirizzo di Mastertutor su Azure, per esempio `https://nome-casuale.azurestaticapps.net` |
| **2. Account Tapo** | Email e password con cui si accede all'app Tapo sul telefono |
| **3. Prese** | Un nome (es. «Ventilatore») e l'indirizzo IP di ogni presa. L'IP si legge nell'app Tapo: si tocca la presa, poi l'ingranaggio, e in fondo c'è *Indirizzo IP* |

Con **Verifica** si controlla che la presa risponda. Con **Prova 3 s** la si accende per tre secondi.

Poi, in Mastertutor, si apre **Area Educatore → Presa** e si scrive il **codice di abbinamento**
mostrato dalla pagina del ponte, per esempio `K7PM-2QXD-9HVA`. Va fatto su ogni computer o tablet che
deve comandare le prese.

> **L'indirizzo della presa può cambiare.** I router assegnano gli indirizzi a tempo. Se dopo qualche
> settimana la presa non risponde più, quasi sempre ha ricevuto un indirizzo diverso: lo si rilegge
> nell'app Tapo e lo si reinserisce. Per evitarlo si può riservarle un indirizzo fisso dal router.

**Genera un nuovo codice** crea un codice diverso. I dispositivi abbinati con il vecchio smettono di
comandare le prese. È utile se il codice è finito in mani sbagliate.

---

## Avvio automatico all'accensione del computer

Così non serve ricordarsi di avviarlo: parte da solo a ogni accesso.

| Sistema | Come si attiva |
|---|---|
| **Mac** | Doppio clic su **`avvio-automatico.command`**. Il ponte parte subito e a ogni accesso, e riparte se si blocca; il registro è nel file `ponte.log`. La cartella del ponte non deve stare in Scrivania, Documenti o Download |
| **Windows** | Doppio clic su **`avvio-automatico.bat`**. Crea un collegamento in *Esecuzione automatica*: il ponte parte a ogni accesso con la finestra ridotta a icona |
| **Raspberry Pi** | Servizio di sistema, vedi più sotto |

Un secondo doppio clic sullo stesso file **disattiva** l'avvio automatico. Se il ponte è già acceso,
un doppio clic su `avvia.command` o `avvia.bat` non ne avvia un secondo, che comanderebbe le stesse
prese, ma apre la sua pagina.

> Una PWA non può avviare programmi sul computer: è una protezione del browser. Per questo il ponte
> si avvia con il computer e non con l'app.

## Dove tenerlo acceso

Su qualunque computer che resti acceso durante le sessioni e sia collegato alla rete delle prese: il PC
della stanza oppure un **Raspberry Pi** (poche decine di euro), lasciato sempre acceso vicino al router.

### Avvio automatico su Raspberry Pi (Linux)

Con Node.js 22 installato e la cartella del ponte in `/home/pi/ponte`, si crea il file
`/etc/systemd/system/ponte-mastertutor.service`:

```ini
[Unit]
Description=Ponte Mastertutor
After=network-online.target
Wants=network-online.target

[Service]
WorkingDirectory=/home/pi/ponte
ExecStart=/usr/bin/node ponte.js --senza-browser
Restart=always
User=pi

[Install]
WantedBy=multi-user.target
```

poi `sudo systemctl enable --now ponte-mastertutor`. La pagina di configurazione resta raggiungibile
solo dal Raspberry stesso (`http://localhost:8124`). Per configurarlo da un altro computer si usa
`ssh -L 8124:localhost:8124 pi@indirizzo-del-raspberry` e si apre `http://localhost:8124`.

---

## Sicurezza

- La pagina di configurazione ascolta **solo su questo computer** (127.0.0.1): dalla rete non si raggiunge.
- Accetta richieste solo da se stessa: un altro sito aperto nel browser non può comandare le prese.
- `config.json` contiene la password dell'account Tapo in chiaro. È escluso da git (`.gitignore`) e **non
  va copiato** su chiavette destinate ad altri.
- Chi conosce il codice di abbinamento può accendere le prese di questo ponte e cambiarne la
  configurazione dalla PWA: va dato solo a chi usa Mastertutor.
- Un'accensione dura al massimo 600 secondi, qualunque cosa chieda la PWA.

---

## Messaggi scambiati con la PWA

Viaggiano nel campo `data` del protocollo `json.webpubsub.azure.v1`. Ogni codice ha due gruppi:
`mt-<codice>-ponte` (ascoltato dal ponte) e `mt-<codice>-app` (ascoltato dalle PWA).

| Da → a | Messaggio | Significato |
|---|---|---|
| PWA → ponte | `{tipo: 'ping', id}` | Ci sei? |
| PWA → ponte | `{tipo: 'accendi', id, prese: [...], secondi}` | Accendi (elenco vuoto = tutte) |
| PWA → ponte | `{tipo: 'spegni', id, prese: [...]}` | Spegni subito |
| PWA → ponte | `{tipo: 'leggi-config', id}` | Mandami la configurazione (senza password) |
| PWA → ponte | `{tipo: 'configura', id, account?, prese?}` | Salva account e prese, poi prova ogni presa |
| ponte → PWA | `{tipo: 'pong', id, prese, versione}` | Risposta al ping |
| ponte → PWA | `{tipo: 'ciao', prese, versione}` | Il ponte si è appena collegato |
| ponte → PWA | `{tipo: 'config', id, account: {email, passwordImpostata}, prese}` | Configurazione attuale |
| ponte → PWA | `{tipo: 'esito', id, ok, errore, prese, verifiche?}` | Esito di accendi, spegni, configura |
| ponte → PWA | `{tipo: 'spenta', prese}` | Una presa si è spenta allo scadere del tempo |

Una futura versione del ponte su **ESP32** dovrà solo parlare questi stessi messaggi: la PWA non cambia.

---

## Struttura dei file

```
ponte/
├── avvia.bat / avvia.command   Avvio su Windows / macOS e Linux
├── avvio-automatico.bat / .command  Attiva o disattiva l'avvio all'accensione
├── ponte.js                    Collegamento ad Azure, comandi, pagina di configurazione
├── pagina.html                 Pagina di configurazione (http://localhost:8124)
├── config.json                 Indirizzo dell'app, codice, account e prese (creato dalla pagina)
├── config.example.json         Esempio di config.json
├── tapo/
│   ├── prese.js                Più prese insieme, comandi in fila, messaggi d'errore leggibili
│   ├── klap.js                 Protocollo KLAP v2 (dalle app di CHIARA)
│   └── passthrough.js          Protocollo Secure Passthrough / AES (come python-kasa)
└── prove/
    └── prove.js                Verifiche automatiche (non servono all'uso)
```

---

## Problemi frequenti

| Sintomo | Causa e soluzione |
|---|---|
| «Il ponte richiede Node.js 22» | Installare Node.js LTS da <https://nodejs.org> |
| «L'indirizzo … non risponde come Mastertutor» | Indirizzo dell'app sbagliato: copiarlo dalla barra del browser quando Mastertutor è aperto |
| «Il servizio della presa non è ancora configurato su Azure» | Su Azure manca l'impostazione `WEBPUBSUB_CONNECTION_STRING` (vedi il README dell'app) |
| «La presa rifiuta il collegamento» | Nell'app Tapo attivare **Compatibilità terze parti** (impostazioni della presa, in fondo) |
| «Email o password non corrispondono» | Usare le credenziali dell'**account Tapo**, non una password della presa |
| «Indirizzo irraggiungibile» | Il computer del ponte non è sulla stessa rete Wi-Fi delle prese |
| In Mastertutor: «il ponte non risponde» | Il ponte è spento, o il suo computer non ha internet. Appena torna, Mastertutor si ricollega da solo |
| macOS chiede di consentire l'accesso alla «rete locale» | Rispondere **Consenti**: senza, il ponte non raggiunge le prese |
| Funzionava, ora no | Quasi sempre la presa ha cambiato indirizzo IP: rileggerlo nell'app Tapo |
