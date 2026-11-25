# Metodo di calcolo della CO2 evitata

Metodo WayMatch **v1**, in vigore dalla versione 0.11 dell'app.

Questo documento descrive come WayMatch calcola la CO2 evitata grazie al carpooling, riportata nei
report. Il metodo è **uno solo, uguale per tutte le installazioni** e non modificabile: così i
numeri sono confrontabili nel tempo e tra aziende. Ogni report indica la versione del metodo usata.

## 1. Che cosa si misura

La CO2 che **non è stata emessa** perché un collega ha viaggiato come passeggero invece di usare la
propria auto, al netto dei chilometri in più che l'autista ha percorso per passarlo a prendere.
È coerente con l'impostazione della categoria 7 dello Scope 3 del GHG Protocol (spostamenti
casa-lavoro dei dipendenti): le emissioni evitate sono quelle dei veicoli che non sono stati usati.

L'auto dell'autista **non** produce risparmio: avrebbe fatto quel viaggio comunque.

## 2. Perimetro

- Viaggi **completati** nel periodo e nelle sedi scelti per il report.
- Solo passeggeri con **check-in** (saliti davvero a bordo).
- Viaggi senza passeggeri: contano tra i viaggi, non producono risparmio.

## 3. Formula

Per ogni passeggero *p* di un viaggio completato:

    CO2 evitata(p) = km × fattore(p)       se senza il passaggio avrebbe usato la propria auto
                   = 0                      altrimenti

Per ogni viaggio *v*, una volta sola e senza attribuirla a un passeggero in particolare:

    CO2 deviazione(v) = km deviazione(v) × fattore(auto dell'autista)

Risultato del viaggio:

    CO2 evitata(v) = Σ CO2 evitata(p) − CO2 deviazione(v)       (mai sotto zero)

Il totale del report è la somma dei viaggi. Lo stesso calcolo vale per i chilometri evitati e per il
costo evitato (per il costo si usa il costo al km di ogni auto, che il Mobility Manager può adattare
alla propria azienda e che non fa parte di questo metodo).

### 3.1 Chilometri

I chilometri del **tragitto diretto**: quelli del viaggio, dichiarati dall'autista entro il 30% in
più del percorso calcolato dal server sulla rete stradale (gli stessi usati per i punti), **meno la
deviazione dell'autista** (§3.4) quando è calcolabile. Così il giro in più per prendere i passeggeri
non conta a favore di ciascuno di loro: pesa una sola volta, in negativo, sul viaggio. Il passeggero
conta per l'intero tragitto anche se sale o scende a una sosta intermedia (semplificazione
dichiarata, §6).

### 3.2 Cosa avrebbe fatto il passeggero

Dal profilo, domanda facoltativa «Senza un passaggio, come verresti al lavoro?»: *con la mia auto* ·
*con i mezzi pubblici* · *in bici o a piedi* · *in un altro modo*.

- Con i mezzi, in bici o a piedi, in altro modo: il passeggero **non si conta**.
- «Con la mia auto»: si conta, anche se non ha indicato un'auto nel profilo (si usa l'auto media).
- Nessuna risposta: si conta se ha indicato un'auto nel profilo (alimentazione, marca o modello);
  altrimenti **non si conta** (scelta prudente).

### 3.3 Fattore di emissione

Il fattore (g di CO2 per km) è quello dell'**auto del passeggero**. In ordine, il primo disponibile:

1. **Segmento e classe Euro** (ISPRA, §5): se sono noti alimentazione, segmento (mini, piccola,
   media, grande) e anno di immatricolazione. Dall'anno si ricava la classe Euro in base alle date di
   obbligo per tutte le nuove immatricolazioni:

   | Prima immatricolazione | Classe |
   |---|---|
   | fino al 1992 | prima dell'Euro 1 (si usa il valore ISPRA più vecchio disponibile) |
   | 1993–1996 | Euro 1 |
   | 1997–2000 | Euro 2 |
   | 2001–2005 | Euro 3 |
   | 2006–2010 | Euro 4 |
   | 2011–2014 | Euro 5 |
   | 2015–2018 | Euro 6 a/b/c |
   | 2019–2020 | Euro 6 d-temp |
   | dal 2021 | Euro 6 d |

2. **Media per alimentazione** (ISPRA, §5), se manca il segmento o l'anno, o se ISPRA non ha quella
   combinazione.
3. **Auto media** (ISPRA, §5), se manca anche l'alimentazione.

Per l'**auto dell'autista**, quando serve per la deviazione, vale la stessa regola.

### 3.4 Deviazione dell'autista

Chilometri del percorso con le soste dei passeggeri meno chilometri del percorso diretto, entrambi
calcolati dal server sulla rete stradale al momento della pubblicazione o della modifica del
passaggio. Se uno dei due non c'è (per esempio nei viaggi creati prima di questa versione) la
deviazione si considera zero e il viaggio è segnalato nella qualità dei dati (§7).

## 4. Confini

- **Solo CO2 allo scarico** (dal serbatoio alla ruota, *tank-to-wheel*): né la produzione dei
  carburanti né quella dell'energia elettrica. I fattori ISPRA tengono la CO2 della combustione
  separata dagli altri gas.
- **CO2**, non CO2 equivalente.
- Conseguenza: un'auto **elettrica** evitata vale **0 g/km**, e di un'ibrida plug-in conta solo la
  quota termica già inclusa nel fattore. Il risparmio legato all'elettrico è quindi **sottostimato,
  mai gonfiato**.

## 5. Fonti dei fattori

| Uso | Fonte | Licenza |
|---|---|---|
| Fattori per segmento, classe Euro e alimentazione | ISPRA, *La banca dati dei fattori di emissione medi per il parco circolante in Italia* (https://fetransp.isprambiente.it/), valori dell'anno 2022 basati sull'inventario nazionale delle emissioni comunicato nel 2024, calcolati con COPERT 5.7.3 secondo l'EMEP/EEA Guidebook 2023 e le linee guida IPCC 2006 | CC BY 4.0 (note legali ISPRA, salvo diversa indicazione) |

Valori ISPRA 2022, autovetture, CO2 in g/km, valore **totale** (media dei cicli urbano, extraurbano e
autostradale), usati quando non si conoscono segmento e anno:

| Alimentazione in WayMatch | Voce ISPRA | g CO2/km |
|---|---|---|
| Benzina | Petrol | 161,3 |
| Diesel | Diesel | 167,1 |
| GPL | LPG Bifuel | 154,7 |
| Metano | CNG Bifuel | 126,1 |
| Ibrida | Petrol Hybrid | 135,6 |
| Ibrida plug-in | Petrol PHEV | 123,1 |
| Elettrica | Battery electric | 0 |
| Non indicata (auto media) | Passenger Cars, tutte le alimentazioni | 161,7 |

I valori per segmento e classe Euro sono nel foglio «dettaglio» della stessa banca dati; l'elenco
completo che usa WayMatch è nel file `backend/fattori/ispra-autovetture.json`, generato con
`backend/scripts/fattori-ispra.js` dal file originale conservato nel repository. Per le auto
precedenti all'Euro 1 si usa il valore ISPRA della tecnologia più vecchia disponibile (benzina
«ECE 15/04», altre alimentazioni «Conventional»).

Sono stime **su strada** del parco circolante italiano, comprese le auto più vecchie (modello
COPERT), non valori di omologazione.

I fattori **non sono modificabili** dal Mobility Manager. Il costo al km sì, ed è fuori da questo
metodo.

## 6. Limiti dichiarati

- Sono stime del parco circolante per segmento, classe Euro e alimentazione, non misure su ogni
  veicolo; non si applicano correttivi.
- Elettrico e plug-in: vedi §4.
- Lo scenario alternativo è dichiarato dagli utenti, non verificato.
- I chilometri sono quelli del tragitto stimato, non misurati; il passeggero conta per l'intero
  tragitto anche se sale o scende a metà.
- Il tratto per raggiungere il punto di ritrovo non si conta. Se il passeggero lo fa in auto (da
  solo o con altri), il risparmio è sovrastimato; se lo raggiunge a piedi, in bici o viene preso
  sotto casa, il calcolo è corretto.
- Non si considerano effetti indiretti (per esempio chi, senza auto, avrebbe comunque viaggiato con
  un collega).
- Sono **stime per il reporting interno**, non una certificazione.

## 7. Qualità dei dati (riportata in ogni report)

- Viaggi completati e quota con chilometri verificati dal server.
- Passeggeri conteggiati, e quanti esclusi perché senza il passaggio non avrebbero usato l'auto o
  perché senza auto indicata e senza risposta.
- Da dove viene il fattore di ogni passeggero conteggiato: per segmento e classe Euro, per
  alimentazione, auto media.
- Viaggi con deviazione non calcolabile.

## 8. Aggiornamento delle fonti

Quando ISPRA pubblica una nuova edizione dei fattori la tabella si rigenera con lo script e arriva con
la versione successiva dell'app, con l'anno dei valori indicato nei report. Aggiornare i valori **non**
cambia la versione del metodo, che cambia solo se cambiano formula, confini o regole.

## Storico delle versioni

| Versione | Dalla versione dell'app | Cosa cambia |
|---|---|---|
| v1 | 0.11 | Prima versione documentata. Prima (app fino alla 0.10): fattore dell'auto **dell'autista** per i km dei passeggeri, valori per alimentazione senza fonte dichiarata e modificabili dal Mobility Manager, nessuno scenario alternativo né deviazione. |
