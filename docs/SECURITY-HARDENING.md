# Notes d'enduriment de seguretat

Aquest document recull les decisions d'implementació sensibles a la seguretat que s'han de preservar en futures refactoritzacions de Ferrocat 1.0.

## Frontera de confiança de l'estat del navegador

`sessionStorage` és una entrada controlada pel client. `frontend/app.js` utilitza una clau d'estat versionada i saneja les dades persistides abans d'assignar-les a l'estat viu de l'aplicació.

La validació inclou:

- format i unicitat dels identificadors de línia;
- nombre màxim de línies;
- colors de línia contrastats amb `COLORS_LINIA`;
- identificadors d'estació contrastats amb `MUNICIPI_PER_ID`;
- eliminació d'estacions duplicades i límit d'estacions;
- longitud màxima del nom de línia;
- `existingKm` finit i no negatiu;
- capes de mapa permeses (`procedural`, `osm`);
- valors finits del `viewBox` i límits d'amplada equivalents als del zoom;
- booleans estrictes;
- paràmetres del model finits i restringits als mateixos rangs que els sliders de la interfície.

Un JSON invàlid o un objecte superior amb una estructura no vàlida s'ignora sense fer fallar el component.

## Classificació de l'HTML/SVG dinàmic

El frontend conserva renderització SVG/HTML basada en cadenes en rutes sensibles al rendiment. És una decisió intencionada per evitar una refactorització visual extensa. Cada ús d'`innerHTML` pertany a una d'aquestes classes:

| Renderitzador | Classe | Entrada variable | Mitigació |
| --- | --- | --- | --- |
| Missatges d'estat buit | A — estàtic | Cap | Marcatge literal únicament |
| Paths de comarques | B/C | geometria numèrica projectada; nom de comarca | La geometria és numèrica; el nom passa per `esc()` |
| Anell de hover | B | coordenades numèriques del municipi | Els IDs provenen del mapa intern; els atributs són numèrics |
| Tesel·les OSM | B | coordenades numèriques de tesel·la | L'host és el literal fix `tile.openstreetmap.org`; les parts de la URL són enters calculats |
| SVG de fluxos capturats | B | valors numèrics calculats; color de línia | Els colors restaurats passen per allowlist; els nous provenen de `COLORS_LINIA` |
| SVG de línies ferroviàries | B | coordenades calculades; color de línia | Mateixa allowlist de colors; les coordenades provenen de municipis coneguts |
| Etiquetes de municipi | C | nom de municipi | El nom passa per `esc()` |
| Targetes per línia | C | nom de línia, ruta i etiqueta de metadades | El text passa per `esc()`; els IDs segueixen `^linia-\d+$`; els colors passen per allowlist |
| Resum global | A/B | valors numèrics calculats | Les etiquetes són estàtiques; els valors són numèrics o formatats |

Regles per a codi futur:

1. Prioritza `textContent`, `createElement()` i `createElementNS()` per a nous textos i components dinàmics.
2. Si es manté una plantilla de text, qualsevol text variable ha de passar per `esc()`.
3. Els atributs no textuals influïts per estat persistit s'han de validar per tipus o mitjançant allowlist abans de renderitzar-los.
4. No passis mai directament a `innerHTML` dades crues de `sessionStorage`, paràmetres d'URL, metadades externes o secrets.

## Frontera de confiança del downloader MITMS

Només es permet l'host HTTPS oficial. Cada redirecció es valida abans de seguir-la. El downloader limita els bytes, el nombre de redireccions, els reintents i el nombre de files descomprimides, i elimina els fitxers parcials quan hi ha errors.

El valor per defecte de `MAX_ROWS_PER_DATASET` és deliberadament ampli. És una protecció contra denegació de servei, no una afirmació sobre el nombre esperat de files. Si el dataset oficial creix legítimament per sobre d'aquest límit, cal revisar el format d'origen i els requisits de recursos abans d'augmentar-lo.

## Payload de Streamlit

Tot el contingut de `rail_app(data=...)` és públic per al navegador. El payload s'ha de limitar a municipis públics, geometria comarcal, parelles OD públiques i metadades públiques.

## Controls de desplegament externs al repositori

Les regles de branca de GitHub, l'escaneig de secrets i la protecció de push natius de GitHub, la configuració de Code Security i les capçaleres del reverse proxy HTTPS són controls de plataforma o desplegament. Afegir fitxers al repositori no activa automàticament aquestes opcions del compte.
