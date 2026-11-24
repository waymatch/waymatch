# WayMatch · Brand kit

**Due strade, una via.** Il simbolo è fatto di due tragitti che partono da punti diversi e arrivano nello stesso posto.
Il tratto che percorrono insieme è color acqua: è il "match", il punto in cui due vie diventano una (Dao 道, "la Via").
"Il bene più alto è come l'acqua" (Daodejing, cap. 8): come l'acqua, le strade confluiscono.

## Contenuto
- `svg/symbol` · simbolo da solo (su scuro, su chiaro, mono nero, mono bianco)
- `svg/lockup` · simbolo + nome, logo principale
- `svg/wordmark` · nome con il tragitto sotto
- `svg/icon` · icona app; le versioni `-small` hanno tratti più spessi per 64 px e meno
- `png/` · esportazioni raster (icone 16–1024 px, loghi @2x)
- `favicon/` · favicon.ico, favicon.svg, apple-touch-icon.png
- `svg|png/social` · anteprima social GitHub (1280×640) e banner README (1600×400)
- `colors.css` · colori e font come variabili CSS
- `svg/icon/waymatch-icon-{dark,light}-maskable.svg` + PNG 192/512 · icone a tutto campo per Android e installazioni PWA (disegno dentro il cerchio di sicurezza dell'80%)
- `svg/icon/waymatch-icon-badge.svg` + PNG 96 · icona monocromatica bianca su trasparente per notifiche e badge Android
- `svg/lockup/waymatch-powered-by-{on-light,on-dark}.svg` + PNG @2x · "powered by" compatto, alto 24 px, per piè di pagina

## Regole rapide
- Per le installazioni PWA e Android usa le icone `-maskable`; per le favicon usa le icone normali.
- Acqua `#3CC8B8` per il tratto del simbolo e per testo/accenti su petrolio; per testo e link su sfondo chiaro usa acqua scuro `#0B6E66`.
- Sfondi: petrolio `#14424F`, nebbia `#F3F7F5` o bianco `#FFFFFF`.
- Spazio di rispetto attorno al logo: almeno l'altezza della "W".
- Non ruotare, deformare o ricolorare le due strade; non togliere il tratto color acqua.
- Sotto i 64 px usa l'icona `-small`; sotto i 120 px di larghezza usa il simbolo invece del lockup.

Font: Space Grotesk (titoli e logo) e Inter (testi), entrambi SIL Open Font License, liberi su Google Fonts.
Nei file SVG il testo è già convertito in tracciati: non serve installare i font.
