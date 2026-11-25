# Funzionalità

L'elenco completo di cosa fa WayMatch, per chi vuole i dettagli. Per una panoramica c'è il
[README](../README.md); per l'uso quotidiano, le guide per [chi usa l'app](guida-utente.md) e per il
[mobility manager](guida-mobility-manager.md).

## Cosa include

- **Setup guidato al primo avvio**: crea l'utente mobility manager, il nome azienda e le sedi.
- **Profili con ruoli**: *mobility manager* (gestione completa: utenti, sedi, branding, premi,
  contest, regole punteggio), *supervisor* (report in sola lettura), *dipendente* (offre e cerca
  passaggi).
- **Offerta passaggi**: andata, ritorno o entrambi, con destinazione/partenza scelta tra le
  sedi aziendali, indirizzo di casa con **autocomplete OpenStreetMap**, **calcolo automatico
  della tratta** (km reali su strada, non in linea d'aria) e **mappa del percorso**, posti
  disponibili, note e **soste intermedie** (es. pausa colazione, spesa al ritorno).
- **Ricerca e prenotazione**: filtri per sede (default la propria, selezionabile), data, tipo;
  richiesta posto con eventuale punto di salita/discesa personalizzato tra le soste; conferma
  da parte dell'autista; limite realistico sui posti (le richieste in eccesso non vengono rifiutate: entrano in
  lista d'attesa, vedi più sotto).
- **Modifica passaggi**: l'autista (o un mobility manager) può modificare orario, indirizzo,
  sede, posti e soste di un passaggio ancora attivo; i passeggeri con richieste/conferme
  attive vengono avvisati della modifica.
- **Solo passaggi futuri**: non è possibile creare passaggi per data/ora già passate, e la
  home/ricerca mostrano solo passaggi non ancora partiti.
- **"I miei prossimi passaggi"** in home: vista unificata di ciò che hai offerto e a cui hai
  aderito, ancora da svolgere. Lo storico completo (passati, completati, andati a vuoto) è
  disponibile in "I miei viaggi → Storico".
- **Validazione dei viaggi completati configurabile** (Impostazioni generali → Validazione
  viaggi): l'autista può confermare da solo, oppure — se attivata l'opzione — la conferma
  mette il viaggio "in approvazione" finché un mobility manager non lo approva dalla pagina
  "Approvazioni" (i punti vengono assegnati solo dopo l'approvazione).
- **Check-in a bordo**: l'autista segna chi è realmente salito; i punti premiano solo i viaggi
  effettivamente avvenuti.
- **Notifiche**: centro notifiche in-app (campanella) + **notifiche push del browser** (nuova
  richiesta, richiesta confermata/rifiutata, viaggio annullato, esiti riscatto premi).
- **Gamification**: regole punteggio **configurabili dal pannello mobility manager**
  (punti per offerta, per viaggio completato come autista/passeggero, bonus km, bonus
  "macchina piena" separato per autista e passeggeri), assegnazione punti manuale con
  storico, classifica generale e per sede, contest a tempo, catalogo premi con
  **decurtazione punti immediata al riscatto e riaccredito automatico se rifiutato**.
- **Dati auto nel profilo** (marca a tendina, modello, anno, cilindrata, colore,
  alimentazione) usati per stimare **CO2 e costo risparmiati** nei viaggi condivisi e per
  riconoscere l'auto al punto di ritrovo.
- **Import utenti da CSV** con due modalità distinte dal nome del file: file normale (crea i
  nuovi utenti e aggiorna nome/cognome/ruolo di quelli esistenti, senza mai toccare le
  password già impostate) e file il cui nome contiene "cessati" (disattiva gli utenti
  elencati per email) — nessuna disattivazione avviene mai automaticamente al di fuori di
  questa modalità esplicita.
- **Notifiche via email** (opzionale, tramite SMTP configurabile — vedi sotto), in aggiunta
  a in-app e push.
- **Preferenze di notifica personali**: ogni utente decide, per categoria (richieste
  ricevute, esito delle proprie richieste, variazioni ai viaggi, premi, e per il mobility
  manager le approvazioni in sospeso), su quali canali riceverle: nell'app (campanella), push, email.
- **Log attività** per i Mobility Manager: traccia le operazioni di gestione (utenti, sedi,
  premi, regole punteggio, impostazioni, branding, forzature su viaggi altrui) e un
  sottoinsieme curato delle azioni degli utenti (offerte, richieste, annullamenti,
  completamenti...), filtrabile per categoria, tipo di evento e utente.
- **Documenti e consensi**: il Mobility Manager può pubblicare documenti — testo con
  formattazione minima (titoli, grassetto, elenchi, link) o un PDF caricato — che ogni
  utente deve accettare con spunta esplicita; le versioni successive richiedono una nuova
  accettazione, consultabile anche dopo dal proprio profilo con data e ora. Un documento può
  essere **generale** (richiesto a tutti al primo accesso, es. informativa privacy) o
  **per chi offre un passaggio** (richiesto solo la prima volta che si pubblica un'offerta,
  es. dichiarazione di responsabilità del conducente).
- **Turni fissi / percorsi ricorrenti**: puoi impostare un tragitto abituale (giorni della
  settimana, orario, indirizzo) e il sistema genera automaticamente i passaggi per le
  prossime due settimane, senza doverli ricreare ogni giorno. Sospendere un turno annulla
  le occorrenze future non ancora svolte. Con documenti del conducente da accettare (per
  esempio una nuova versione) i turni vanno in pausa: restano le corse già generate, non se
  ne generano di nuove e la riattivazione è bloccata; all'accettazione riprendono da soli.
- **Promemoria di partenza e matching proattivo**: due nuove categorie di notifica
  configurabili (con anticipo personalizzabile per il promemoria) — un avviso prima della
  partenza di un tuo viaggio, e un avviso quando viene pubblicato un passaggio compatibile
  con un tuo turno fisso.
- **Export report in Excel e PDF** dalla pagina Report.
- **Premi come voucher digitali**: oltre alla consegna "fisica", un premio può generare un
  codice univoco al momento dell'approvazione, sovrapposto automaticamente a un template
  grafico caricato dal Mobility Manager (es. con logo/filigrana aziendale).
- **Pannello report**: km, CO2 e costi risparmiati, per sede e per mese, utenti più attivi.
- **Branding personalizzabile**: logo aziendale, nome, colori primario/accento, icona dell'app e nome
  breve sul telefono (vedi "Il tuo logo, i tuoi colori" nel README).
- **Giorni lavorativi configurabili** (Impostazioni generali → Calendario).
- **Guida e informazioni nell'app**, allineate alla versione installata.
- **Accessibilità**: verificata con axe-core secondo WCAG 2.1 livello AA, uso da tastiera.
- **PWA**: installabile da smartphone (icona in home, si apre a schermo intero, notifiche
  push anche ad app chiusa).
- **Lista d'attesa**: se un passaggio è al completo, la richiesta entra in lista d'attesa
  invece di essere rifiutata; quando si libera un posto (rifiuto, annullamento, o l'autista
  aumenta i posti), il primo in lista viene promosso automaticamente a richiesta.
- **Eccezioni sui turni fissi**: si può saltare una singola data (ferie, malattia) senza
  sospendere l'intero turno; l'eventuale occorrenza già generata per quella data viene
  annullata e ripristinabile in qualsiasi momento.
- **Passaggi pertinenti per te**: impostando il proprio indirizzo di casa nel profilo, la
  home e la ricerca mostrano prima i passaggi il cui percorso reale passa vicino a casa
  (soglia di distanza regolabile), con un badge dedicato.
- **Diritti GDPR** (pannello Profilo → Privacy): ogni utente può esportare tutti i propri
  dati in un file, o richiedere la cancellazione dell'account. Una richiesta di
  cancellazione va approvata da un Mobility Manager (pannello "Cancellazioni"): se accettata,
  il profilo viene anonimizzato (non eliminato fisicamente, per non compromettere lo storico
  dei passaggi condivisi con altri colleghi) e il login disabilitato.


## Note sui calcoli CO2/costi

I km utilizzati nei report sono quelli calcolati automaticamente da OSRM al momento della
creazione del passaggio (percorso stradale reale tra indirizzo e sede), oppure inseriti
manualmente se la geocodifica non è disponibile. I fattori di emissione (g CO2/km) usati
sono medie indicative per tipo di alimentazione (`backend/utils/co2.js`) e il costo/km è
configurabile in Impostazioni generali → Costi e CO2. Sono stime utili per il monitoraggio interno, non un
calcolo di bilancio ambientale certificato.


## Note sul database veicoli

Non esiste un database gratuito ufficiale (es. ACI) con marca/modello/cilindrata per
singolo veicolo: l'ACI mette a disposizione solo open data statistici aggregati (parco
veicolare, immatricolazioni). Per questo il profilo utente usa una tendina con le marche
più comuni e campo libero per modello/cilindrata/colore. Un database completo e sempre
aggiornato è tipicamente un servizio commerciale a pagamento.


## Possibili estensioni future

Idee realistiche, non ancora pianificate, che richiedono solo lavoro di sviluppo:

- Autoregistrazione dipendenti con dominio email aziendale verificato
- Editing manuale del tragitto sulla mappa (drag dei waypoint, oltre alla scelta tra le
  alternative già proposte da OSRM)
- Istanza self-hosted di Nominatim/OSRM per un uso intensivo senza limiti dei server pubblici


## Per ora non previsto

Funzioni che oggi non ci sono per scelta, non per un limite tecnico. Non sono escluse per
sempre: se servono a chi usa WayMatch, o se qualcuno vuole contribuire a realizzarle, se ne può
riparlare in una [segnalazione su GitHub](https://github.com/waymatch/waymatch/issues).

- **SSO aziendale (Entra ID, Okta...) e integrazione con Microsoft Teams.** Per ora WayMatch
  gestisce da sé gli accessi: si installa senza toccare l'identità aziendale, senza registrare
  applicazioni nel tenant e senza credenziali dedicate. Molte organizzazioni preferiscono così,
  per non collegare il proprio SSO a uno strumento interno di terze parti. Non vale per tutte,
  però: se alla vostra azienda serve, parliamone. L'integrazione con Teams, pensata per mettere
  in contatto autista e passeggero, presuppone l'SSO e segue la stessa strada.
