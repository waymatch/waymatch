const Database = require('better-sqlite3-multiple-ciphers');
const path = require('path');
const fs = require('fs');
const webpush = require('web-push');
const { readSecret } = require('./utils/secrets');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// Il database e' cifrato a riposo (contiene dati personali: indirizzi, email, telefoni...):
// senza questa chiave il file .db su disco e' inutilizzabile anche per chi riuscisse a
// copiarlo (backup sottratto, accesso non autorizzato al filesystem). Non protegge invece
// da un'applicazione compromessa in esecuzione: la chiave resta comunque in memoria del
// processo per leggere/scrivere normalmente - vedi README, sezione "Sicurezza e hardening".
const DB_ENCRYPTION_KEY = readSecret('DB_ENCRYPTION_KEY');
if (!DB_ENCRYPTION_KEY) {
  throw new Error(
    'DB_ENCRYPTION_KEY non impostata: imposta DB_ENCRYPTION_KEY (o DB_ENCRYPTION_KEY_FILE) ' +
    'prima di avviare il server. Genera un valore con: openssl rand -hex 32'
  );
}
if (!/^[0-9a-fA-F]{64}$/.test(DB_ENCRYPTION_KEY)) {
  // Formato validato rigidamente per due motivi: garantisce una chiave di 32 byte di
  // entropia reale, ed evita che caratteri come l'apice possano rompere la sintassi della
  // PRAGMA qui sotto (il valore vi finisce interpolato direttamente).
  throw new Error('DB_ENCRYPTION_KEY non valida: deve essere una stringa esadecimale di 64 caratteri (32 byte). Genera un valore con: openssl rand -hex 32');
}

const db = new Database(path.join(DATA_DIR, 'carpooling.db'));
db.pragma(`key='${DB_ENCRYPTION_KEY}'`);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
// Con più richieste concorrenti (es. due prenotazioni nello stesso istante), senza questo
// una scrittura in conflitto lancia subito SQLITE_BUSY invece di attendere/riprovare.
db.pragma('busy_timeout = 5000');

db.exec(`
CREATE TABLE IF NOT EXISTS system_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  initialized INTEGER NOT NULL DEFAULT 0,
  company_name TEXT DEFAULT 'La Mia Azienda',
  logo_path TEXT,
  primary_color TEXT DEFAULT '#14424F',
  accent_color TEXT DEFAULT '#3CC8B8',
  km_cost_eur REAL DEFAULT 0.35,
  richiede_approvazione_completamento INTEGER DEFAULT 0,
  vapid_public_key TEXT,
  vapid_private_key TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sedi (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  indirizzo TEXT,
  lat REAL,
  lon REAL,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Ruoli: mobility_manager (gestione completa, ex admin+mobility manager) | supervisor (sola lettura report) | utente
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  cognome TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  ruolo TEXT NOT NULL DEFAULT 'utente',
  sede_id INTEGER REFERENCES sedi(id) ON DELETE SET NULL,
  telefono TEXT,
  auto_marca TEXT,
  auto_modello TEXT,
  auto_anno INTEGER,
  auto_cilindrata INTEGER,
  auto_colore TEXT,
  auto_alimentazione TEXT,
  auto_posti INTEGER DEFAULT 3,
  attivo INTEGER DEFAULT 1,
  tentativi_falliti INTEGER DEFAULT 0,
  bloccato_fino TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS rides (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  driver_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sede_id INTEGER REFERENCES sedi(id) ON DELETE SET NULL,
  tipo TEXT NOT NULL,
  data TEXT NOT NULL,
  ora TEXT NOT NULL,
  punto_partenza TEXT NOT NULL,
  punto_arrivo TEXT NOT NULL,
  partenza_lat REAL,
  partenza_lon REAL,
  arrivo_lat REAL,
  arrivo_lon REAL,
  km_calcolati_auto INTEGER DEFAULT 0,
  km_stimati REAL DEFAULT 0,
  geometria TEXT, -- JSON con la polilinea del percorso [[lat,lon],...], per la mappa
  posti_totali INTEGER NOT NULL DEFAULT 3,
  posti_disponibili INTEGER NOT NULL DEFAULT 3,
  note TEXT,
  stato TEXT NOT NULL DEFAULT 'attivo', -- attivo | completato | annullato
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ride_stops (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ride_id INTEGER NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
  orario TEXT,
  luogo TEXT NOT NULL,
  descrizione TEXT,
  lat REAL,
  lon REAL
);

CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ride_id INTEGER NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
  passenger_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stato TEXT NOT NULL DEFAULT 'richiesto', -- richiesto | confermato | rifiutato | completato | no_show | annullato
  punto_salita TEXT, -- luogo scelto per salire/scendere (facoltativo)
  check_in INTEGER DEFAULT 0,
  check_in_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(ride_id, passenger_id)
);

CREATE TABLE IF NOT EXISTS points_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tipo_evento TEXT NOT NULL,
  punti INTEGER NOT NULL,
  ride_id INTEGER,
  note TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS voucher_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  immagine_path TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Costo/km e CO2/km per cluster di alimentazione: righe presenti solo per i cluster
-- personalizzati dal Mobility Manager (override); se assente si usa il valore predefinito
-- in utils/co2.js. "Reimposta al valore predefinito" = elimina la riga.
CREATE TABLE IF NOT EXISTS cost_co2_clusters (
  alimentazione TEXT PRIMARY KEY,
  costo_km_eur REAL,
  co2_g_km REAL
);

CREATE TABLE IF NOT EXISTS rewards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  descrizione TEXT,
  punti_richiesti INTEGER NOT NULL,
  tipo TEXT NOT NULL DEFAULT 'fisico', -- fisico | voucher_digitale
  voucher_template_id INTEGER REFERENCES voucher_templates(id) ON DELETE SET NULL,
  attivo INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS reward_redemptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reward_id INTEGER NOT NULL REFERENCES rewards(id) ON DELETE CASCADE,
  stato TEXT NOT NULL DEFAULT 'in_attesa', -- in_attesa | approvato | rifiutato | consegnato
  codice_voucher TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS contests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  descrizione TEXT,
  metrica TEXT NOT NULL DEFAULT 'punti',
  data_inizio TEXT NOT NULL,
  data_fine TEXT NOT NULL,
  sede_id INTEGER REFERENCES sedi(id) ON DELETE SET NULL,
  attivo INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS point_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chiave TEXT UNIQUE NOT NULL,
  nome TEXT NOT NULL,
  descrizione TEXT,
  punti INTEGER NOT NULL DEFAULT 0,
  attivo INTEGER DEFAULT 1,
  modificabile INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS manual_point_awards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assegnato_da INTEGER REFERENCES users(id) ON DELETE SET NULL,
  punti INTEGER NOT NULL,
  motivo TEXT NOT NULL,
  redemption_id INTEGER REFERENCES reward_redemptions(id) ON DELETE SET NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL,
  messaggio TEXT NOT NULL,
  ride_id INTEGER,
  letta INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT UNIQUE NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notification_preferences (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  categoria TEXT NOT NULL,
  push INTEGER DEFAULT 1,
  email INTEGER DEFAULT 1,
  minuti_anticipo INTEGER DEFAULT 30,
  PRIMARY KEY (user_id, categoria)
);

CREATE TABLE IF NOT EXISTS reminder_sent (
  ride_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (ride_id, user_id)
);

CREATE TABLE IF NOT EXISTS recurring_rides (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  driver_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL, -- andata | ritorno
  giorni_settimana TEXT NOT NULL, -- lista di numeri 1(lun)-7(dom) separati da virgola
  ora TEXT NOT NULL,
  punto_partenza TEXT NOT NULL,
  punto_arrivo TEXT NOT NULL,
  sede_id INTEGER REFERENCES sedi(id) ON DELETE SET NULL,
  partenza_lat REAL, partenza_lon REAL,
  arrivo_lat REAL, arrivo_lon REAL,
  km_stimati REAL DEFAULT 0,
  geometria TEXT,
  posti_totali INTEGER NOT NULL DEFAULT 3,
  note TEXT,
  soste TEXT, -- JSON delle soste da replicare su ogni occorrenza generata
  data_inizio TEXT NOT NULL,
  data_fine TEXT, -- NULL = a tempo indeterminato
  attivo INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Date singole in cui un turno fisso NON deve generare/mantenere un'occorrenza (es.
-- ferie, malattia di un giorno), senza dover sospendere l'intero turno.
CREATE TABLE IF NOT EXISTS recurring_ride_exceptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recurring_ride_id INTEGER NOT NULL REFERENCES recurring_rides(id) ON DELETE CASCADE,
  data TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(recurring_ride_id, data)
);

CREATE TABLE IF NOT EXISTS legal_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  titolo TEXT NOT NULL,
  contenuto TEXT NOT NULL,
  versione INTEGER NOT NULL DEFAULT 1,
  attivo INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS document_acceptances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  document_id INTEGER NOT NULL REFERENCES legal_documents(id) ON DELETE CASCADE,
  versione_accettata INTEGER NOT NULL,
  accettato_at TEXT DEFAULT (datetime('now')),
  UNIQUE(user_id, document_id)
);

-- Richieste di esportazione/cancellazione dati personali (GDPR). "completata" anonimizza
-- l'utente invece di eliminarlo fisicamente: altrimenti, data la cascata su rides/bookings,
-- cancellare un utente cancellerebbe anche lo storico di viaggi condivisi di ALTRI colleghi.
CREATE TABLE IF NOT EXISTS account_deletion_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stato TEXT NOT NULL DEFAULT 'in_attesa', -- in_attesa | completata | rifiutata
  motivo TEXT,
  gestita_da INTEGER REFERENCES users(id) ON DELETE SET NULL,
  gestita_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  categoria TEXT NOT NULL DEFAULT 'gestione', -- gestione (Mobility Manager) | utente
  azione TEXT NOT NULL,
  dettagli TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_rides_data ON rides(data);
CREATE INDEX IF NOT EXISTS idx_rides_sede ON rides(sede_id);
CREATE INDEX IF NOT EXISTS idx_rides_autista_data ON rides(driver_id, data);
CREATE INDEX IF NOT EXISTS idx_bookings_ride ON bookings(ride_id);
CREATE INDEX IF NOT EXISTS idx_bookings_passenger ON bookings(passenger_id);
CREATE INDEX IF NOT EXISTS idx_points_user ON points_log(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, letta);
CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at);
CREATE INDEX IF NOT EXISTS idx_manual_awards_user ON manual_point_awards(user_id);
`);

// --- Migrazioni leggere per installazioni già esistenti ---
function addColumnIfMissing(table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}
addColumnIfMissing('sedi', 'lat', 'REAL');
// Gamification facoltativa (utils/gamification.js): spenta sulle installazioni nuove. Su quelle già
// configurate prima di questa opzione resta accesa, per non cambiare un servizio già in uso.
// Colonna e valore iniziale insieme: un'interruzione a metà non lascia spenta un'installazione in uso.
if (!db.prepare('PRAGMA table_info(system_settings)').all().some((c) => c.name === 'gamification_attiva')) {
  db.transaction(() => {
    db.exec('ALTER TABLE system_settings ADD COLUMN gamification_attiva INTEGER NOT NULL DEFAULT 0');
    db.prepare('UPDATE system_settings SET gamification_attiva = 1 WHERE initialized = 1').run();
  })();
}
// Dati per il calcolo della CO2 evitata (docs/metodo-calcolo.md): segmento dell'auto (mini, piccola,
// media, grande) e come il collega verrebbe al lavoro senza passaggio (auto_propria, mezzi,
// bici_piedi, altro; null = non indicato).
addColumnIfMissing('users', 'auto_segmento', 'TEXT');
addColumnIfMissing('users', 'senza_passaggio', 'TEXT');
// Foto del profilo (utils/fotoProfilo.js): percorso del file cifrato e numero di versione, che
// cambia a ogni nuova foto (null = nessuna foto).
addColumnIfMissing('users', 'foto_path', 'TEXT');
addColumnIfMissing('users', 'foto_versione', 'INTEGER');
// Azzeramento dei punteggi (utils/points.js, generazionePunti): ogni movimento di punti registra la
// generazione in cui nasce e l'azzeramento passa alla successiva; saldi e classifiche contano solo
// quella attuale. Il confine è esatto (scritture e azzeramento sono serializzati dal database).
// punti_azzerati_il serve solo a mostrare quando è successo.
addColumnIfMissing('system_settings', 'punti_azzerati_il', 'TEXT');
addColumnIfMissing('system_settings', 'generazione_punti', 'INTEGER NOT NULL DEFAULT 0');
addColumnIfMissing('points_log', 'generazione', 'INTEGER NOT NULL DEFAULT 0');
addColumnIfMissing('manual_point_awards', 'generazione', 'INTEGER NOT NULL DEFAULT 0');
// Ultima versione pubblicata di WayMatch vista dal controllo giornaliero (utils/aggiornamenti.js).
addColumnIfMissing('system_settings', 'ultima_versione', 'TEXT');
addColumnIfMissing('system_settings', 'ultima_versione_url', 'TEXT');
addColumnIfMissing('system_settings', 'aggiornamenti_controllati_il', 'TEXT');
addColumnIfMissing('sedi', 'lon', 'REAL');
addColumnIfMissing('rides', 'partenza_lat', 'REAL');
addColumnIfMissing('rides', 'partenza_lon', 'REAL');
addColumnIfMissing('rides', 'arrivo_lat', 'REAL');
addColumnIfMissing('rides', 'arrivo_lon', 'REAL');
addColumnIfMissing('rides', 'km_calcolati_auto', 'INTEGER DEFAULT 0');
addColumnIfMissing('rides', 'geometria', 'TEXT');
addColumnIfMissing('ride_stops', 'lat', 'REAL');
addColumnIfMissing('ride_stops', 'lon', 'REAL');
addColumnIfMissing('bookings', 'punto_salita', 'TEXT');
addColumnIfMissing('bookings', 'check_in', 'INTEGER DEFAULT 0');
addColumnIfMissing('bookings', 'check_in_at', 'TEXT');
addColumnIfMissing('users', 'auto_colore', 'TEXT');
addColumnIfMissing('users', 'auto_targa', 'TEXT');
addColumnIfMissing('manual_point_awards', 'redemption_id', 'INTEGER REFERENCES reward_redemptions(id) ON DELETE SET NULL');
addColumnIfMissing('system_settings', 'vapid_public_key', 'TEXT');
addColumnIfMissing('system_settings', 'vapid_private_key', 'TEXT');
addColumnIfMissing('system_settings', 'richiede_approvazione_completamento', 'INTEGER DEFAULT 0');
// Giorni lavorativi (1 = lunedì ... 7 = domenica): si possono offrire passaggi solo in questi giorni.
addColumnIfMissing('system_settings', 'giorni_lavorativi', "TEXT DEFAULT '1,2,3,4,5,6'");
addColumnIfMissing('system_settings', 'icon_path', 'TEXT');
addColumnIfMissing('system_settings', 'pwa_short_name', 'TEXT');
// Perché un'occorrenza di un turno fisso è stata annullata: 'sospensione_turno' permette di
// ripristinare solo quelle quando il turno viene riattivato.
addColumnIfMissing('rides', 'motivo_annullamento', 'TEXT');
// Km del percorso calcolati dal server (OSRM) alla pubblicazione: la base dei punti e dei
// risparmi, al posto dei km inviati dal client. NULL se il servizio non era disponibile.
addColumnIfMissing('rides', 'km_verificati', 'REAL');
addColumnIfMissing('recurring_rides', 'km_verificati', 'REAL');
// Km del percorso diretto, senza soste: con km_verificati danno la deviazione dell'autista.
addColumnIfMissing('rides', 'km_diretti', 'REAL');
addColumnIfMissing('recurring_rides', 'km_diretti', 'REAL');

// Migrazioni una tantum, numerate con PRAGMA user_version: ognuna gira una sola volta per database.
const versioneSchema = db.pragma('user_version', { simple: true });
if (versioneSchema < 1) {
  // Colori predefiniti WayMatch: chi aveva ancora i predefiniti di prima passa ai nuovi. Gira una
  // volta sola, così un'azienda che sceglie in seguito uno di quei colori se lo tiene.
  db.transaction(() => {
    db.prepare("UPDATE system_settings SET primary_color = '#14424F' WHERE primary_color IN ('#0E7C66', '#7A5228')").run();
    db.prepare("UPDATE system_settings SET accent_color = '#3CC8B8' WHERE accent_color IN ('#F5A623', '#A8763E')").run();
    db.pragma('user_version = 1');
  })();
}

// Lo stile mappa non esiste più (il provider dei tile si sceglie nel .env): pulizia della colonna.
if (db.prepare('PRAGMA table_info(system_settings)').all().some((c) => c.name === 'mappa_stile')) {
  db.exec('ALTER TABLE system_settings DROP COLUMN mappa_stile');
}
addColumnIfMissing('audit_log', 'categoria', "TEXT NOT NULL DEFAULT 'gestione'");
addColumnIfMissing('users', 'tentativi_falliti', 'INTEGER DEFAULT 0');
addColumnIfMissing('users', 'bloccato_fino', 'TEXT');
addColumnIfMissing('users', 'token_version', 'INTEGER DEFAULT 0');
addColumnIfMissing('rides', 'recurring_ride_id', 'INTEGER REFERENCES recurring_rides(id) ON DELETE SET NULL');
addColumnIfMissing('rewards', 'tipo', "TEXT NOT NULL DEFAULT 'fisico'");
addColumnIfMissing('rewards', 'voucher_template_id', 'INTEGER REFERENCES voucher_templates(id) ON DELETE SET NULL');
addColumnIfMissing('reward_redemptions', 'codice_voucher', 'TEXT');
addColumnIfMissing('notification_preferences', 'minuti_anticipo', 'INTEGER DEFAULT 30');
// Terzo canale accanto a push ed email: la campanella dentro l'app. Attivo per chi aveva già
// delle preferenze salvate.
addColumnIfMissing('notification_preferences', 'inapp', 'INTEGER NOT NULL DEFAULT 1');
// Indirizzo di casa predefinito: precompila l'offerta di un passaggio e permette di
// mostrare prima, nella ricerca, i passaggi il cui percorso reale passa vicino a casa.
addColumnIfMissing('users', 'indirizzo_casa', 'TEXT');
addColumnIfMissing('users', 'casa_lat', 'REAL');
addColumnIfMissing('users', 'casa_lon', 'REAL');
addColumnIfMissing('users', 'citta_casa', 'TEXT');
// tipo: 'generale' (richiesto a tutti al primo accesso) | 'conducente' (richiesto solo
// la prima volta che si offre un passaggio, es. dichiarazione di responsabilità).
// formato: 'testo' (contenuto con markdown minimale) | 'pdf' (file allegato in file_path).
addColumnIfMissing('legal_documents', 'tipo', "TEXT NOT NULL DEFAULT 'generale'");
addColumnIfMissing('legal_documents', 'formato', "TEXT NOT NULL DEFAULT 'testo'");
addColumnIfMissing('legal_documents', 'file_path', 'TEXT');
// Solo la città dell'indirizzo privato (casa dell'autista/passeggero), per mostrarla nelle
// liste di passaggi disponibili senza esporre la via completa a chi non ha ancora
// richiesto il passaggio; punto_partenza/punto_arrivo restano la fonte per l'indirizzo
// completo (usato come punto di salita una volta aperto il dettaglio).
addColumnIfMissing('rides', 'citta_domicilio', 'TEXT');
addColumnIfMissing('recurring_rides', 'citta_domicilio', 'TEXT');
// Pagina di destinazione calcolata una sola volta alla creazione (vedi utils/notify.js):
// prima la stessa logica era duplicata anche nel frontend (NotificationBell), con il
// rischio di scollegarsi se in futuro si aggiunge un tipo di notifica in un solo posto.
addColumnIfMissing('notifications', 'url', 'TEXT');
// Forza il cambio password al prossimo accesso: attivo di default per chi viene creato
// dal MM (a mano o via CSV) o riceve una password reimpostata da un altro utente, così
// una password che qualcun altro conosce smette di essere valida il prima possibile.
addColumnIfMissing('users', 'password_da_cambiare', 'INTEGER DEFAULT 0');
db.exec(`
  CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    scade_il TEXT NOT NULL,
    usato INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );
  -- Usata solo quando SMTP non è configurato: la richiesta di reset non può essere
  -- gestita in autonomia dall'utente (nessun link sicuro da inviargli), quindi passa dal MM.
  CREATE TABLE IF NOT EXISTS password_reset_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    stato TEXT NOT NULL DEFAULT 'in_attesa',
    gestita_da INTEGER REFERENCES users(id) ON DELETE SET NULL,
    gestita_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_reset_tokens_user ON password_reset_tokens(user_id);
`);
// "Passaggi preferiti": segui un autista per un dato tipo di tratta (andata/ritorno) e
// ricevi una notifica quando ne pubblica uno nuovo — non è una preferenza sulla persona,
// solo su quel pattern di viaggio (per questo il nome scelto è "preferiti", non "colleghi").
db.exec(`
  CREATE TABLE IF NOT EXISTS favorite_rides (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    follower_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    driver_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tipo TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(follower_id, driver_id, tipo)
  );
  CREATE INDEX IF NOT EXISTS idx_favorite_rides_driver ON favorite_rides(driver_id, tipo);
`);
// Traccia l'invio del riepilogo settimanale per evitare doppi invii se lo scheduler
// controlla più volte nella stessa finestra oraria (es. dopo un riavvio del container).
db.exec(`
  CREATE TABLE IF NOT EXISTS weekly_summary_sent (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    settimana TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, settimana)
  );
`);
// Avvisi "nuova versione disponibile" già mandati: uno per mobility manager e per versione.
db.exec(`
  CREATE TABLE IF NOT EXISTS avvisi_nuova_versione (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    versione TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, versione)
  );
`);
// Ultimo avviso "turni fissi in pausa" mandato a ogni conducente, con le versioni dei documenti
// da accettare in quel momento: evita di ripeterlo a ogni giro dello scheduler.
db.exec(`
  CREATE TABLE IF NOT EXISTS avvisi_turni_in_pausa (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    firma TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );
`);
// Una riga per ogni login: permette logout lato server, revoca per dispositivo e rinnovo
// del token di accesso (8 ore) finché la sessione è in uso. Del segreto di rinnovo, che
// sta nel cookie httpOnly del browser, qui c'è solo l'hash.
db.exec(`
  CREATE TABLE IF NOT EXISTS sessioni (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    segreto_hash TEXT NOT NULL UNIQUE,
    dispositivo TEXT,
    creata_il TEXT NOT NULL DEFAULT (datetime('now')),
    ultimo_uso TEXT NOT NULL DEFAULT (datetime('now')),
    revocata INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_sessioni_user ON sessioni(user_id);
`);
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_recurring_driver ON recurring_rides(driver_id);
  CREATE INDEX IF NOT EXISTS idx_rides_recurring ON rides(recurring_ride_id);
  CREATE INDEX IF NOT EXISTS idx_doc_accept_user ON document_acceptances(user_id);
  CREATE INDEX IF NOT EXISTS idx_recurring_exceptions ON recurring_ride_exceptions(recurring_ride_id);
  CREATE INDEX IF NOT EXISTS idx_deletion_requests_user ON account_deletion_requests(user_id);
`);

// Fusione ruoli: le vecchie installazioni con ruolo "admin" diventano "mobility_manager"
db.prepare(`UPDATE users SET ruolo = 'mobility_manager' WHERE ruolo = 'admin'`).run();

// Riga system_settings sempre presente
const settingsRow = db.prepare('SELECT id FROM system_settings WHERE id = 1').get();
if (!settingsRow) {
  db.prepare('INSERT INTO system_settings (id, initialized) VALUES (1, 0)').run();
}

// Genera le chiavi VAPID per le notifiche push al primo avvio
const settingsNow = db.prepare('SELECT vapid_public_key, vapid_private_key FROM system_settings WHERE id = 1').get();
if (!settingsNow.vapid_public_key || !settingsNow.vapid_private_key) {
  const keys = webpush.generateVAPIDKeys();
  db.prepare('UPDATE system_settings SET vapid_public_key = ?, vapid_private_key = ? WHERE id = 1')
    .run(keys.publicKey, keys.privateKey);
}

// Seed delle regole punteggio di default (solo se la tabella è vuota). Tutte le regole
// "discrezionali" partono DISATTIVATE: il mobility manager deve impostarle esplicitamente
// da Admin → Regole punteggio, invece di ritrovarsi punti assegnati per default senza
// averlo deciso lui. km_cap_bonus fa eccezione: non è un premio ma un tetto massimo, e
// modificabile=0 lo rende comunque un valore fisso (non un interruttore) nell'interfaccia.
// Controllo e inserimenti in un'unica transazione: un avvio interrotto a metà non lascia un
// elenco di regole incompleto (al successivo avvio la tabella risulta ancora vuota).
db.transaction(() => {
  const rulesCount = db.prepare('SELECT COUNT(*) as n FROM point_rules').get().n;
  if (rulesCount === 0) {
    const insRule = db.prepare(`
      INSERT INTO point_rules (chiave, nome, descrizione, punti, attivo, modificabile)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    insRule.run('offerta_creata', 'Offerta di un passaggio', 'Punti assegnati quando pubblichi un\'offerta (indipendentemente dal suo esito). Puoi azzerarla se vuoi premiare solo i viaggi effettivamente svolti.', 5, 0, 1);
    insRule.run('viaggio_completato_autista', 'Viaggio completato come autista', 'Punti base per l\'autista quando il viaggio viene completato con almeno un passeggero effettivamente a bordo (check-in).', 10, 0, 1);
    insRule.run('viaggio_completato_passeggero', 'Viaggio completato come passeggero', 'Punti per il passeggero, assegnati solo se ha effettuato il check-in a bordo.', 8, 0, 1);
    insRule.run('punto_per_km', 'Bonus per km condiviso', 'Punti extra per l\'autista, per ogni km risparmiato per ciascun passeggero a bordo (moltiplicatore).', 1, 0, 1);
    insRule.run('km_cap_bonus', 'Tetto massimo bonus km', 'Numero massimo di punti bonus-km assegnabili per singolo viaggio.', 20, 1, 0);
    insRule.run('bonus_macchina_piena_autista', 'Bonus macchina piena (autista)', 'Punti extra per l\'autista se tutti i posti disponibili sono stati occupati (check-in) nel viaggio.', 10, 0, 1);
    insRule.run('bonus_macchina_piena_passeggero', 'Bonus macchina piena (passeggero)', 'Punti extra per ciascun passeggero se il viaggio era a pieno carico.', 5, 0, 1);
  }
})();

module.exports = db;
