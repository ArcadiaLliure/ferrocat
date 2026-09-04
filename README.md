# Ferrocat — Simulador ferroviari de Catalunya

**Versió actual: 1.0**

Ferrocat és un simulador interactiu de línies ferroviàries per a Catalunya. Permet dibuixar una o diverses línies sobre el mapa, editar-les independentment i estimar, per a cada línia i per al conjunt de la xarxa, la demanda observada que podria captar el tren, els vehicles evitats, l'estalvi de CO₂ i el cost aproximat de construcció.

La interfície manté el plantejament original: **mapa gran a l'esquerra** i **panell de línies, estadístiques i paràmetres a la dreta**. Streamlit actua principalment com a host i carregador de dades. El zoom, el pan, la selecció de municipis, l'edició de línies, el canvi de capa i els sliders s'executen al navegador mitjançant **Streamlit Components V2**, sense reruns continus de Streamlit.

## Funcionalitats principals

- Mapa interactiu de Catalunya.
- Capa procedural tipus blueprint.
- Límits de les 43 comarques.
- Capa OpenStreetMap opcional.
- Municipis de Catalunya amb coordenades i població de referència.
- Selecció magnètica de municipis.
- Etiquetes adaptatives segons el nivell de zoom.
- Creació de múltiples línies ferroviàries simultànies.
- Edició independent de cada línia.
- Possibilitat d'aturar l'edició i començar una nova línia.
- Desfer l'última parada.
- Eliminar línies individualment o esborrar tota la xarxa.
- Estadístiques individualitzades per línia.
- Resum global de la xarxa.
- Demanda basada en dades origen–destinació observades del MITMS.
- Model modal tren/cotxe configurable.
- Estimació de vehicles evitats, CO₂ i cost.
- Possibilitat d'indicar quilòmetres de via existent reutilitzada per línia.
- Persistència de l'escenari de treball a `sessionStorage`.

---

## Arquitectura

```text
Streamlit / Python
│
├── carrega municipis i comarques
├── carrega matriu OD MITMS
├── carrega relació municipi INE ↔ zona MITMS
├── prepara únicament dades públiques per al frontend
│
└── Streamlit Components V2
     │
     └── HTML + CSS + JavaScript
          ├── mapa procedural / OSM
          ├── zoom i pan
          ├── selecció de municipis
          ├── línies i estacions
          ├── sliders
          ├── model modal
          ├── estadístiques per línia
          └── resum global
```

El frontend es manté separat del codi Python:

```text
frontend/
├── index.html
└── app.js
```

`app.py` llegeix els datasets locals, construeix el payload públic i serveix la interfície mitjançant Components V2.

---

## Estructura del repositori

```text
ferrocat/
├── app.py
├── download_mobility.py
├── requirements.in
├── requirements.txt
├── requirements-dev.txt
├── README.md
├── SECURITY.md
├── .gitignore
│
├── .github/
│   ├── dependabot.yml
│   └── workflows/
│       ├── security.yml
│       ├── codeql.yml
│       └── gitleaks.yml
│
├── frontend/
│   ├── index.html
│   └── app.js
│
├── reference/
│   ├── municipis_catalunya.csv
│   └── comarques_catalunya.json
│
├── tests/
│   ├── conftest.py
│   ├── test_download_security.py
│   └── frontend_state_security.test.js
│
├── docs/
│   └── SECURITY-HARDENING.md
│
└── data/
    ├── README.md
    ├── od_catalunya.parquet
    ├── municipi_ine_to_mitma.parquet
    ├── metadata.json
    └── raw/                 # local; no es versiona
```

`reference/` conté dades estàtiques versionades amb el projecte. `data/` conté els datasets processats que consumeix l'aplicació i `data/raw/` és la caché reproduïble de les descàrregues originals del MITMS.

---

# Requisits

- Python 3.11 o superior.
- `pip`.
- Connexió a Internet per descarregar dades MITMS i, si s'activa, per carregar les tesel·les d'OpenStreetMap i les tipografies de Google Fonts.

Les dependències directes de producció es documenten a `requirements.in`. Les versions utilitzades en producció estan fixades exactament a `requirements.txt` per fer els desplegaments reproduïbles.

---

# Instal·lació local

## 1. Clonar el repositori

```bash
git clone https://github.com/ArcadiaLliure/ferrocat.git
cd ferrocat
```

## 2. Crear un entorn virtual

### Windows

```bat
python -m venv .venv
.venv\Scripts\activate
```

### Linux / macOS

```bash
python3 -m venv .venv
source .venv/bin/activate
```

## 3. Instal·lar les dependències de producció

```bash
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
python -m pip check
```

Per executar tests i eines de seguretat:

```bash
python -m pip install -r requirements-dev.txt
```

---

# Preparació de les dades MITMS

Ferrocat necessita aquests fitxers processats:

```text
data/od_catalunya.parquet
data/municipi_ine_to_mitma.parquet
data/metadata.json
```

Els fitxers poden estar ja versionats al repositori. Per actualitzar-los amb l'última matriu municipal publicada:

```bash
python download_mobility.py
```

El downloader:

1. consulta el `RSS.xml` oficial del MITMS;
2. detecta directament l'últim fitxer `YYYYMMDD_Viajes_municipios.csv.gz` publicat;
3. descarrega la relació entre municipis INE i zones MITMS;
4. descarrega únicament l'última matriu diària disponible;
5. filtra els orígens i destinacions de Catalunya;
6. agrega les franges i segments del dia;
7. genera els dos Parquet i `metadata.json`.

No prova dates una a una.

Els fitxers originals es desen a:

```text
data/raw/
```

Aquest directori està exclòs de Git.

## Proteccions del downloader

El pipeline tracta la xarxa i els fitxers remots com a entrada no confiable, encara que la font sigui oficial:

- només permet HTTPS;
- només permet hosts explícitament autoritzats del MITMS;
- valida cada redirecció abans de seguir-la;
- limita el nombre de redireccions;
- aplica timeouts de connexió i lectura;
- reintenta únicament errors transitoris (`429`, `500`, `502`, `503`, `504`), amb backoff i un nombre finit de reintents;
- limita la mida del RSS;
- limita la mida de cada descàrrega;
- comprova `Content-Length` quan existeix i compta també els bytes realment rebuts;
- elimina els fitxers `.part` en cas d'error;
- només publica el fitxer final després d'una descàrrega completa;
- analitza XML amb `defusedxml`;
- processa els CSV gzip per chunks;
- imposa un límit defensiu de files per dataset;
- valida les columnes obligatòries `origen`, `destino` i `viajes`.

Els límits són constants explícites a `download_mobility.py` i s'han d'ajustar deliberadament si el format oficial canvia legítimament.

---

# Arrencar Ferrocat

Des del directori arrel:

```bash
python -m streamlit run app.py
```

Normalment estarà disponible a:

```text
http://localhost:8501
```

---

# Desplegament a Streamlit Community Cloud

## 1. Preparar el repositori

Comprova que el repositori contingui com a mínim:

```text
app.py
requirements.txt
frontend/
reference/
data/od_catalunya.parquet
data/municipi_ine_to_mitma.parquet
data/metadata.json
```

No cal pujar `data/raw/`.

## 2. Crear l'aplicació

1. Puja el repositori a GitHub.
2. Entra a Streamlit Community Cloud.
3. Crea una nova aplicació.
4. Selecciona `ArcadiaLliure/ferrocat`.
5. Selecciona la branca que vulguis desplegar.
6. Indica `app.py` com a fitxer principal.
7. Desplega.

Streamlit instal·larà les dependències de `requirements.txt`.

Ferrocat **no executa `download_mobility.py` en arrencar**. Les dades publicades s'actualitzen deliberadament abans de fer push:

```bash
python download_mobility.py
git add data/od_catalunya.parquet data/municipi_ine_to_mitma.parquet data/metadata.json
git commit -m "Actualitza mobilitat MITMS"
git push
```

Els canvis de seguretat del repositori no desactiven XSRF ni CORS de Streamlit i no requereixen cap secret per executar l'aplicació.

---

# Desplegament en servidor propi

No exposis Streamlit directament a Internet mitjançant HTTP. Utilitza HTTPS darrere d'un reverse proxy com **Caddy, Nginx o Traefik** i preserva el suport de WebSocket.

Capçaleres recomanades:

```text
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=()
Strict-Transport-Security: max-age=31536000; includeSubDomains
```

Aplica HSTS només quan el domini i els subdominis corresponents funcionin exclusivament amb HTTPS.

No s'inclou una CSP agressiva per defecte: Components V2, el WebSocket de Streamlit, Google Fonts i OpenStreetMap necessiten directives específiques que s'han de provar en el domini real abans d'aplicar-les.

Exemple Nginx simplificat, preservant WebSocket:

```nginx
location / {
    proxy_pass http://127.0.0.1:8501;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;

    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;
}
```

---

# Model de demanda

## Demanda base

La demanda **no es calcula a partir de la població**.

La base són els viatges origen–destinació observats a:

```text
data/od_catalunya.parquet
```

generats a partir de la matriu municipal del Ministerio de Transportes y Movilidad Sostenible.

La població s'utilitza com a estadística territorial i per resoldre l'assignació de zones MITMS agregades, no per generar viatges.

## Àrees de captació

Cada municipi situat dins del radi configurat al voltant d'una estació s'assigna a l'estació més propera.

Això evita el doble recompte.

## Zones MITMS agregades

Quan una mateixa zona MITMS pot correspondre a l'àrea de captació de més d'una estació, Ferrocat l'assigna a una sola estació per evitar duplicar viatges.

La relació utilitzada es desa a:

```text
data/municipi_ine_to_mitma.parquet
```

## Canvi modal

El model compara el temps generalitzat del tren amb el del cotxe i aplica un model logit sobre els viatges observats corresponents a la quota actual del cotxe.

---

# Estadístiques per línia

Cada línia disposa de la seva pròpia targeta al panell lateral.

Entre les mètriques disponibles hi ha:

- estacions;
- longitud;
- temps cap a cap;
- població directa;
- població d'influència;
- OD observat/dia;
- viatges captats pel tren/dia;
- vehicles evitats/dia;
- CO₂ estalviat;
- cost estimat;
- quilòmetres de via existent reutilitzada.

`OD observat/dia` és demanda observada procedent de la matriu MITMS. La captació ferroviària, els vehicles evitats, el CO₂ i el cost són resultats del model.

---

# Capes cartogràfiques

## Procedural

La capa principal pròpia de Ferrocat manté:

- fons blueprint `#0d2a4a`;
- graella;
- municipis;
- etiquetes;
- límits comarcals translúcids;
- línies ferroviàries;
- fluxos capturats.

## OpenStreetMap

La capa OSM utilitza tesel·les de:

```text
https://tile.openstreetmap.org/{z}/{x}/{y}.png
```

La interfície manté visible l'atribució:

```text
© OpenStreetMap contributors
```

Quan l'usuari activa OSM, **el navegador contacta directament amb `tile.openstreetmap.org`**. Com en qualsevol petició web, aquest tercer pot rebre metadades de xarxa normals com la IP i el User-Agent.

El servidor públic d'OSM no és un CDN comercial gratuït. Per a un desplegament públic amb trànsit significatiu cal utilitzar un proveïdor adequat o infraestructura pròpia i respectar la política de tesel·les d'OSM.

---

# Seguretat

Ferrocat 1.0 té deliberadament una superfície de servidor reduïda:

- no hi ha comptes d'usuari;
- no hi ha login;
- no hi ha base de dades SQL;
- no hi ha uploads;
- els visitants no escriuen fitxers al servidor;
- la major part de la interacció i del model s'executa al navegador;
- els datasets lliurats al frontend són públics.

## Payload del component

**Tot el que s'envia mitjançant `rail_app(data=...)` és visible per al client.** No s'hi han d'incloure mai claus API, tokens, credencials, secrets d'entorn ni dades privades.

Els secrets d'un desplegament futur, si fossin necessaris, s'han de guardar en variables d'entorn o a `.streamlit/secrets.toml`, que està ignorat per Git. No s'han d'inserir al frontend ni al payload del component.

## Estat del navegador

`sessionStorage` és una entrada controlada pel client. En restaurar l'estat es validen:

- IDs i nombre màxim de línies;
- colors contra una allowlist;
- IDs d'estació contra els municipis existents;
- absència de duplicats;
- longitud del nom;
- `existingKm`;
- `layerMode`;
- `viewBox`;
- booleans;
- tots els paràmetres del model contra els mateixos rangs dels sliders;
- valors no finits o estructures inesperades.

Un JSON corrupte s'ignora i s'elimina sense fer caure el component.

## HTML/SVG dinàmic

El frontend conserva `innerHTML` en diversos renderitzadors per evitar una reescriptura visual de risc. Els textos variables passen per `esc()` o `textContent`, i els atributs procedents de l'estat persistit es validen abans de renderitzar.

La classificació detallada és a [`docs/SECURITY-HARDENING.md`](docs/SECURITY-HARDENING.md).

## Comprovacions locals

```bash
python -m pip install -r requirements.txt -r requirements-dev.txt
python -m pip check
pip-audit -r requirements.txt
python -m py_compile app.py download_mobility.py
pytest
node --check frontend/app.js
node tests/frontend_state_security.test.js
```

## Automatització a GitHub

El repositori incorpora:

- Dependabot per a `pip` i GitHub Actions;
- `pip-audit` en pull requests, `main` i execució programada;
- tests de seguretat del downloader;
- CodeQL per Python i JavaScript/TypeScript;
- Gitleaks per detectar secrets al repositori i a l'historial.

Les GitHub Actions externes estan fixades per SHA quan és viable i documentades amb la seva versió humana.

Consulta també [`SECURITY.md`](SECURITY.md).

---

# Actualització controlada de dependències

No substitueixis els pins de producció per `>=` sense revisió.

Flux recomanat:

```bash
# 1. Crea una branca d'actualització.
git switch -c chore/update-dependencies

# 2. Revisa requirements.in i les noves versions candidates.
# 3. Actualitza deliberadament els pins exactes de requirements.txt.

# 4. Instal·la en un entorn virtual net.
python -m pip install -r requirements.txt -r requirements-dev.txt
python -m pip check

# 5. Audita i prova.
pip-audit -r requirements.txt
pytest
node --check frontend/app.js
python -m streamlit run app.py
```

`pip-tools` està disponible a `requirements-dev.txt` si es vol evolucionar cap a un lock complet de dependències transitives. Qualsevol regeneració amb `pip-compile` s'ha de revisar com un canvi de dependències, no executar-se automàticament sobre `main`.

Dependabot obre pull requests; no actualitza `main` directament.

---

# Seguretat de la branca `main`

La protecció de branca és una configuració de GitHub i no queda activada només per afegir fitxers al repositori.

Configuració recomanada:

```text
Settings
→ Rules
→ Rulesets
→ New branch ruleset
```

Per a `main`:

- bloquejar force pushes;
- bloquejar l'eliminació de la branca;
- exigir els checks de seguretat abans del merge;
- requerir pull request quan hi hagi més d'un col·laborador;
- si el projecte té un únic desenvolupador, valorar no exigir PR obligatori si perjudica el flux de treball.

A `Settings → Security` o `Code security and analysis`, habilita quan estigui disponible:

- Dependabot alerts;
- Dependabot security updates;
- Secret scanning;
- Push protection;
- Code scanning;
- Private Vulnerability Reporting.

Aquests controls són configuració externa de GitHub i no s'activen automàticament des del codi.

---

# Llicències, reutilització i atribucions

Les llicències de les dades, la cartografia, les tipografies i el codi són independents.

## Mobilitat — Ministerio de Transportes y Movilidad Sostenible

La matriu OD procedeix de les dades obertes del Ministeri. En reutilitzar-les cal respectar les condicions oficials, citar la font, conservar la informació d'actualització quan correspongui i no suggerir patrocini o suport institucional.

Atribució recomanada:

```text
Origen de les dades: Ministerio de Transportes y Movilidad Sostenible.
Data de les dades: <data indicada a data/metadata.json>.
```

Condicions oficials:

- https://nap.transportes.gob.es/licencia-datos
- https://sede.transportes.gob.es/aviso-legal

## Idescat

Per a dades municipals de població, quan hi ha tractament:

```text
Font: elaboració pròpia a partir de dades de l'Idescat.
```

Cal respectar les condicions de reutilització de l'Idescat i indicar la font i l'actualització corresponent.

## ICGC

Els límits comarcals deriven de geoinformació de l'Institut Cartogràfic i Geològic de Catalunya. La geoinformació de l'ICGC, amb les excepcions indicades per l'organisme, es distribueix sota **CC BY 4.0**.

Atribució recomanada:

```text
Límits comarcals derivats de geoinformació de l'Institut Cartogràfic
i Geològic de Catalunya (ICGC), utilitzada sota llicència CC BY 4.0.
```

## OpenStreetMap

Les dades d'OpenStreetMap estan disponibles sota **ODbL 1.0**. Cal mantenir una atribució visible:

```text
© OpenStreetMap contributors
```

Informació:

- https://www.openstreetmap.org/copyright
- https://operations.osmfoundation.org/policies/tiles/

## Tipografies

La interfície utilitza Inter, Space Grotesk i IBM Plex Mono, distribuïdes sota **SIL Open Font License 1.1**. Actualment es carreguen mitjançant Google Fonts. Si s'autoallotgen, cal conservar les llicències OFL corresponents.

## Llicència del codi

La llicència dels datasets de tercers no concedeix automàticament una llicència sobre el codi de Ferrocat. Si es vol distribuir el codi sota una llicència determinada, el repositori ha d'incorporar explícitament un fitxer `LICENSE`.

---

# Resolució de problemes

## Falten dades

Executa:

```bash
python download_mobility.py
```

Comprova també que existeixin:

```text
reference/municipis_catalunya.csv
reference/comarques_catalunya.json
```

## Components V2 no disponibles

Instal·la exactament les dependències del projecte:

```bash
python -m pip install -r requirements.txt
```

## OpenStreetMap no apareix

Comprova la connexió a Internet, l'accés a `tile.openstreetmap.org`, la consola del navegador i possibles bloquejadors de contingut.

## Les dades semblen antigues

Executa:

```bash
python download_mobility.py
```

Ferrocat utilitza l'últim `Viajes_municipios` anunciat pel RSS oficial del MITMS.

---

# Avís metodològic

Ferrocat és una eina de simulació.

La matriu OD és observada, però la captació ferroviària, els vehicles evitats, el CO₂, els temps de trajecte i el cost són estimacions derivades del model i dels paràmetres configurats. No substitueix un estudi oficial de demanda ni un projecte d'enginyeria ferroviària.

Per a planificació real serien necessaris, entre altres, models calibrats, distribució temporal i motius de viatge, accessibilitat real, xarxa viària, transbordaments, capacitat, costos operatius, inversió detallada, efectes ambientals i demanda induïda.

---

# Fonts principals

- Ministerio de Transportes y Movilidad Sostenible — mobilitat OD.
- Institut d'Estadística de Catalunya (Idescat) — dades municipals.
- Institut Cartogràfic i Geològic de Catalunya (ICGC) — geoinformació comarcal.
- OpenStreetMap contributors — cartografia OSM.
