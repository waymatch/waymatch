# Sicurezza

## Segnalare una vulnerabilità

**Non aprire una issue pubblica.** Usa la segnalazione privata di GitHub:
[Security → Report a vulnerability](https://github.com/waymatch/waymatch/security/advisories/new).
Resta visibile solo a te e al manutentore finché il problema non è risolto.

Il modulo di GitHub chiede titolo, descrizione e gravità. Nella descrizione indica:

- **cosa** hai trovato e in quale parte dell'app (API, pagina, configurazione);
- **come riprodurlo**, passo per passo;
- **che effetto ha** (chi può fare cosa che non dovrebbe);
- la **versione** di WayMatch (in Informazioni → Sistema, o il tag/commit).

Non servono prove di sfruttamento su sistemi reali, e ti chiedo di non accedere a dati che non
sono tuoi.

Il progetto è mantenuto da una persona nel tempo libero: risponderò non appena possibile e i
problemi gravi hanno la precedenza su tutto il resto. I crediti della segnalazione vanno a te, se
lo desideri.

## Versioni supportate

Solo l'ultima versione su `main`.

## Per chi installa l'app

- Genera `JWT_SECRET` e `DB_ENCRYPTION_KEY` con `openssl rand -hex 32`. Il server rifiuta di
  partire con il valore d'esempio.
- Conserva una copia di `DB_ENCRYPTION_KEY` **fuori dal server**: senza, il database cifrato è
  illeggibile.
- Metti l'app dietro un proxy HTTPS e non esporre la porta dell'app direttamente.
