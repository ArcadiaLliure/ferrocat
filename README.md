# Catatrens — Simulador ferroviari de Catalunya

Catatrens és un simulador interactiu de línies ferroviàries per a Catalunya. Permet dibuixar una o diverses línies sobre el mapa, editar-les independentment i estimar, per a cada línia i per al conjunt de la xarxa, la demanda observada que podria ser captada pel tren, els vehicles evitats, l’estalvi de CO₂ i el cost aproximat de construcció.

La interfície conserva el plantejament del simulador HTML original: **mapa gran a l’esquerra** i **panell de línies, estadístiques i paràmetres a la dreta**.

Streamlit actua principalment com a host i carregador de dades. La interacció cartogràfica —zoom, pan, selecció de municipis, edició de línies, canvi de capa i sliders— s’executa al navegador mitjançant un component frontend propi basat en **Streamlit Components V2**, de manera que no es produeixen reruns continus de Streamlit durant l’edició del mapa.

---

## Funcionalitats principals

- Mapa interactiu de Catalunya.
- Municipis de Catalunya amb coordenades i població de referència.
- Límits de les 43 comarques.
- Creació de múltiples línies ferroviàries simultànies.
- Edició independent de cada línia.
- Possibilitat d’aturar l’edició i començar una nova línia.
- Desfer l’última parada.
- Eliminar línies individualment o esborrar tota la xarxa.
- Estadístiques individualitzades per línia.
- Resum global de la xarxa.
- Selecció de municipis amb tolerància al voltant del punt.
- Etiquetes adaptatives segons el nivell de zoom.
- Capa `Procedural` tipus blueprint.
- Capa `OpenStreetMap`.
- Demanda basada en dades origen–destinació observades del Ministeri de Transports.
- Model modal tren/cotxe configurable.
- Estimació de vehicles evitats, CO₂ i cost.
- Possibilitat d’indicar quilòmetres de via existent reutilitzada per línia.

---

# Arquitectura

```text
Streamlit / Python
│
├── carrega dades estàtiques
├── carrega matriu OD MITMS
├── carrega relació municipi INE ↔ zona MITMS
├── prepara les dades per al frontend
│
└── Streamlit Components V2
     │
     └── HTML + CSS + JavaScript
          ├── mapa
          ├── línies
          ├── zoom / pan
          ├── selecció de municipis
          ├── canvi de capa
          ├── sliders
          ├── càlcul modal
          ├── estadístiques per línia
          └── resum global
```

El frontend es manté separat del codi Python:

```text
frontend/
├── index.html
└── app.js
```

`app.py` carrega els fitxers, construeix el payload de dades i serveix aquesta UI mitjançant Components V2.

---

# Estructura actual del projecte

```text
Catatrens/
├── app.py
├── download_mobility.py
├── requirements.txt
├── README.md
├── .gitignore
│
├── frontend/
│   ├── index.html
│   └── app.js
│
├── reference/
│   ├── municipis_catalunya.csv
│   ├── comarques_catalunya.json
│   └── simulador-original.html
│
└── data/
    ├── od_catalunya.parquet
    ├── municipi_ine_to_mitma.parquet
    ├── metadata.json
    │
    └── raw/
        ├── zonificacion/
        └── viajes_municipios/
```

## Per què existeix `reference/`?

En l’estat actual del projecte, `reference/` conté dades **estàtiques i versionades amb el projecte**:

- `municipis_catalunya.csv`: municipis, coordenades, població i informació territorial usada per la UI.
- `comarques_catalunya.json`: geometries comarcals utilitzades per la capa procedural.
- `simulador-original.html`: versió HTML de referència del disseny original.

En canvi, `data/` conté dades **descarregades o generades pel pipeline MITMS**.

Aquesta separació és funcional, no obligatòria. Si en el futur es vol moure `municipis_catalunya.csv` i `comarques_catalunya.json` a `data/static/`, també s’hauran d’actualitzar les rutes de `app.py`.

---

# Requisits

- Python 3.11 o superior.
- `pip`.
- Connexió a Internet per:
  - descarregar les dades MITMS;
  - utilitzar les tesel·les d’OpenStreetMap;
  - carregar les tipografies de Google Fonts si no s’autoallotgen.

Dependències Python actuals:

```text
streamlit>=1.62
pandas>=2.2
pyarrow>=16
requests>=2.32
```

---

# Instal·lació local

## 1. Obtenir el projecte

Clona el repositori o descarrega’l:

```bash
git clone <URL_DEL_REPOSITORI>
cd Catatrens
```

Si ja tens el projecte en local, situa’t directament al directori arrel.

---

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

---

## 3. Instal·lar dependències

```bash
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
```

---

# Preparació de les dades

L’aplicació necessita aquests fitxers processats:

```text
data/
├── od_catalunya.parquet
├── municipi_ine_to_mitma.parquet
└── metadata.json
```

Si no existeixen, s’han de generar amb:

```bash
python download_mobility.py
```

El downloader:

1. consulta el `RSS.xml` oficial del portal de mobilitat;
2. detecta directament l’últim `Viajes_municipios` publicat;
3. descarrega la relació entre municipis INE i zones MITMS;
4. descarrega l’última matriu diària disponible;
5. filtra només els orígens i destinacions de Catalunya;
6. agrega franges i segments del dia;
7. genera els Parquet utilitzats per l’aplicació.

No prova dates una per una.

Els fitxers originals es desen a:

```text
data/raw/
```

Per exemple:

```text
data/raw/
├── zonificacion/
│   ├── relacion_ine_zonificacionMitma.csv
│   ├── nombres_municipios.csv
│   └── poblacion_municipios.csv
│
└── viajes_municipios/
    └── YYYY-MM/
        └── YYYYMMDD_Viajes_municipios.csv.gz
```

`data/raw/` està pensat com a caché reproduïble i pot ocupar força espai.

---

# Arrencar Catatrens

Des del directori arrel:

```bash
python -m streamlit run app.py
```

Streamlit obrirà normalment:

```text
http://localhost:8501
```

Si no s’obre automàticament, entra manualment a aquesta adreça.

---

# Arrencar-lo en un servidor

Per escoltar en totes les interfícies:

```bash
python -m streamlit run app.py \
  --server.address 0.0.0.0 \
  --server.port 8501
```

En Windows:

```bat
python -m streamlit run app.py --server.address 0.0.0.0 --server.port 8501
```

Per a un desplegament públic és recomanable posar Streamlit darrere d’un reverse proxy com Nginx, Caddy o Traefik i servir-lo amb HTTPS.

---

# Desplegament a Streamlit Community Cloud

La manera més senzilla de publicar Catatrens és mitjançant un repositori GitHub.

## 1. Preparar el repositori

Abans de fer `push`, comprova que el repositori contingui:

```text
app.py
download_mobility.py
requirements.txt
frontend/
reference/
data/od_catalunya.parquet
data/municipi_ine_to_mitma.parquet
data/metadata.json
```

No cal pujar:

```text
data/raw/
```

El `.gitignore` actual l’exclou perquè els fitxers originals del Ministeri són reproduïbles i poden ser grans.

## 2. Generar les dades abans del desplegament

L’aplicació **no executa automàticament el downloader en arrencar**.

Per tant, abans de desplegar:

```bash
python download_mobility.py
```

i després:

```bash
git add data/od_catalunya.parquet
git add data/municipi_ine_to_mitma.parquet
git add data/metadata.json
git commit -m "Actualitza dades MITMS"
git push
```

## 3. Crear l’aplicació a Streamlit Community Cloud

1. Puja el projecte a GitHub.
2. Entra a Streamlit Community Cloud.
3. Crea una nova app.
4. Selecciona el repositori de Catatrens.
5. Selecciona la branca corresponent.
6. Indica com a fitxer principal:

```text
app.py
```

7. Desplega l’aplicació.

Streamlit instal·larà automàticament les dependències de `requirements.txt`.

## 4. Actualitzar les dades publicades

Quan vulguis actualitzar la matriu del Ministeri:

```bash
python download_mobility.py
git add data/od_catalunya.parquet data/municipi_ine_to_mitma.parquet data/metadata.json
git commit -m "Actualitza mobilitat MITMS"
git push
```

Streamlit tornarà a desplegar l’aplicació amb les dades noves.

### Automatització futura

Aquest procés es pot automatitzar amb GitHub Actions:

```text
RSS MITMS
   ↓
detectar nova data
   ↓
executar download_mobility.py
   ↓
regenerar Parquet
   ↓
commit automàtic
   ↓
redeploy Streamlit
```

Aquesta automatització no forma part encara del projecte base.

---

# Tipografies

La UI utilitza actualment:

- Inter
- Space Grotesk
- IBM Plex Mono

Es carreguen des de Google Fonts a `frontend/index.html`.

Per al desenvolupament local **no cal descarregar-les manualment** si hi ha connexió a Internet.

Si es vol un desplegament completament autònom o sense dependències externes:

1. descarrega les famílies tipogràfiques;
2. desa-les, per exemple, a:

```text
frontend/fonts/
```

3. substitueix els `<link>` de Google Fonts per regles `@font-face`;
4. conserva els textos de llicència corresponents.

Les tres famílies es distribueixen sota **SIL Open Font License 1.1 (OFL-1.1)**.

---

# Model de demanda

## Demanda base

La demanda **no es calcula a partir de la població**.

La base són els viatges origen–destinació observats a:

```text
data/od_catalunya.parquet
```

generats a partir de les matrius `Viajes_municipios` del Ministeri de Transports i Mobilitat Sostenible.

La població s’utilitza com a dada territorial, no com a generador de viatges.

---

## Àrees de captació

Cada municipi situat dins del radi configurat al voltant d’una estació s’assigna a una única estació.

Si un municipi queda dins del radi de diverses estacions, s’assigna a la més propera.

Això evita doble recompte.

---

## Zones MITMS agregades

El Ministeri no sempre proporciona una zona independent per a cada municipi petit.

Quan una mateixa zona MITMS pot correspondre a l’àrea de captació de més d’una estació, Catatrens l’assigna a una sola estació per no duplicar els viatges.

La relació utilitzada es desa a:

```text
data/municipi_ine_to_mitma.parquet
```

---

# Estadístiques per línia

Cada línia disposa de la seva pròpia targeta al panell lateral.

Entre les mètriques disponibles hi ha:

- estacions;
- longitud;
- temps cap a cap;
- població directa;
- població d’influència;
- OD observat/dia;
- viatges captats pel tren/dia;
- vehicles evitats/dia;
- CO₂ estalviat;
- cost estimat;
- quilòmetres de via existent reutilitzada.

## OD observat/dia

És demanda observada procedent de la matriu MITMS.

## Captats pel tren/dia

És una estimació derivada del model modal aplicada sobre els OD observats.

## Vehicles evitats/dia

Es calcula a partir dels viatges-persona captats i de l’ocupació mitjana del cotxe.

## CO₂

Es deriva dels vehicles evitats, la distància per carretera, el factor d’emissions i els dies equivalents anuals.

## Població

La població directa i d’influència són indicadors territorials.

**No s’utilitzen per inventar o estimar la matriu de viatges.**

---

# Model modal tren / cotxe

El model compara el temps generalitzat de viatge en tren amb el temps estimat del cotxe.

Entre els paràmetres configurables hi ha:

- velocitat comercial del tren;
- freqüència;
- temps d’accés a l’estació;
- temps d’aturada;
- velocitat mitjana del cotxe;
- factor de traça ferroviària;
- factor de carretera;
- penalització d’horari;
- quota actual del cotxe;
- ocupació mitjana;
- sensibilitat al diferencial de temps;
- biaix base a favor del cotxe;
- captació màxima cotxe → tren.

Aquest model transforma una part de la demanda observada en demanda potencialment transferible al ferrocarril.

---

# Cost

Cada línia pot tenir:

```text
km de via nova
+
km de via existent reutilitzada
```

La fórmula conceptual és:

```text
cost =
    km_nous × cost_via_nova
  + km_existents × cost_adaptació
```

És una estimació simplificada i no substitueix un estudi d’enginyeria ferroviària.

---

# Capes cartogràfiques

## Procedural

La capa `Procedural` és la vista principal pròpia de Catatrens:

- fons blueprint;
- graella;
- municipis;
- etiquetes;
- límits comarcals;
- línies ferroviàries;
- fluxos capturats.

Els límits comarcals procedeixen de la geoinformació de l’ICGC incorporada al projecte.

## OpenStreetMap

La capa `OpenStreetMap` utilitza actualment les tesel·les estàndard:

```text
https://tile.openstreetmap.org/{z}/{x}/{y}.png
```

La UI ha de mantenir visible l’atribució:

```text
© OpenStreetMap contributors
```

Per a una aplicació pública amb trànsit significatiu no s’ha de considerar `tile.openstreetmap.org` un CDN comercial gratuït. Cal respectar la política d’ús d’OSM o utilitzar un proveïdor de tesel·les adequat o infraestructura pròpia.

---

# Llicències, reutilització i atribucions

Les llicències de les **dades**, del **mapa**, de les **tipografies** i del **codi de Catatrens** són independents entre si.

## Dades de mobilitat — Ministeri de Transports i Mobilitat Sostenible

La matriu OD utilitzada per Catatrens procedeix de les dades obertes del Ministeri de Transports i Mobilitat Sostenible.

La llicència de dades obertes del Ministeri permet la reutilització amb finalitats comercials i no comercials.

En reutilitzar-les cal, entre altres condicions:

- no desnaturalitzar el sentit de la informació;
- citar la font;
- indicar la data de l’última actualització quan estigui disponible;
- no suggerir que el Ministeri participa, patrocina o dona suport al producte;
- conservar els metadades de reutilització quan existeixin.

Atribució recomanada:

```text
Origen de les dades: Ministerio de Transportes y Movilidad Sostenible.
Data de les dades: <data indicada a data/metadata.json>.
```

Llicència / condicions oficials:

```text
https://nap.transportes.gob.es/licencia-datos
```

i condicions generals del Ministeri:

```text
https://sede.transportes.gob.es/aviso-legal
```

---

## Població i informació municipal — Idescat

Les dades estadístiques municipals de referència provenen de l’Institut d’Estadística de Catalunya (Idescat).

L’Idescat permet amb caràcter general la reutilització de la informació publicada al seu web sempre que:

- se citi la font;
- no s’alteri ni es desnaturalitzi el contingut;
- s’indiqui la data de l’última actualització;
- no se suggereixi que l’Idescat participa o patrocina el producte.

Quan les dades s’han tractat, l’atribució recomanada per l’Idescat és:

```text
Font: elaboració pròpia a partir de dades de l’Idescat.
```

Si no hi ha tractament:

```text
Font: Idescat.
```

Condicions:

```text
https://www.idescat.cat/institut/web/
```

---

## Geometries comarcals — ICGC

Les geometries comarcals utilitzades en la capa procedural provenen de l’Institut Cartogràfic i Geològic de Catalunya (ICGC).

La geoinformació propietat de l’ICGC es distribueix, amb les excepcions indicades pel mateix organisme, sota:

```text
Creative Commons Reconeixement 4.0 Internacional
CC BY 4.0
```

Atribució recomanada:

```text
Límits comarcals derivats de geoinformació de l’Institut Cartogràfic
i Geològic de Catalunya (ICGC), utilitzada sota llicència CC BY 4.0.
```

Informació oficial:

```text
https://www.icgc.cat/ca/LICGC/Informacio-publica/Transparencia/Reutilitzacio-de-la-informacio
```

També s’ha de conservar o indicar la data d’actualització de la geoinformació quan sigui coneguda.

---

## OpenStreetMap

Les dades d’OpenStreetMap estan disponibles sota:

```text
Open Data Commons Open Database License
ODbL 1.0
```

Cal mostrar una atribució visible, habitualment:

```text
© OpenStreetMap contributors
```

i deixar clar que les dades OSM estan disponibles sota ODbL.

Informació de copyright i llicència:

```text
https://www.openstreetmap.org/copyright
```

### Política de tesel·les

La llicència ODbL de les dades **no equival** a un dret il·limitat d’ús dels servidors públics de tesel·les.

Si s’utilitza:

```text
https://tile.openstreetmap.org/
```

cal respectar:

```text
https://operations.osmfoundation.org/policies/tiles/
```

Entre altres coses:

- atribució visible;
- no fer descàrregues massives ni prefetch;
- respectar les capçaleres de caché;
- no tractar el servidor comunitari com un servei comercial amb SLA.

Per a producció amb càrrega elevada, utilitza un proveïdor adequat o un servidor propi.

---

## Tipografies

Catatrens utilitza:

- Inter;
- Space Grotesk;
- IBM Plex Mono.

Aquestes famílies es distribueixen sota:

```text
SIL Open Font License 1.1
```

Actualment es carreguen remotament a través de Google Fonts.

Si s’autoallotgen, els fitxers de llicència OFL corresponents s’han de conservar juntament amb les fonts distribuïdes.

---

## Llicència del codi de Catatrens

La llicència de les dades de tercers **no determina la llicència del codi de Catatrens**.

El repositori ha d’incloure explícitament un fitxer:

```text
LICENSE
```

si es vol concedir una llicència sobre el codi.

Si no existeix un `LICENSE`, no s’ha d’assumir que el codi és open source ni que es concedeixen automàticament drets de còpia, modificació o redistribució.

Abans d’una publicació comercial o open source cal decidir explícitament la llicència del codi.

---

# Atribució recomanada dins de l’aplicació

Per a una versió pública de Catatrens, és recomanable disposar d’un apartat `Fonts i llicències` amb un text similar a:

```text
Mobilitat:
Origen de les dades: Ministerio de Transportes y Movilidad Sostenible.
Data de la matriu: <data del metadata.json>.

Població municipal:
Elaboració pròpia a partir de dades de l’Idescat.

Límits comarcals:
Geoinformació de l’Institut Cartogràfic i Geològic de Catalunya (ICGC),
CC BY 4.0.

Mapa OpenStreetMap:
© OpenStreetMap contributors — dades ODbL.
```

Aquesta atribució no substitueix les condicions completes de cada font.

---

# Actualització de dades

Per obtenir l’última matriu publicada:

```bash
python download_mobility.py
```

El downloader consulta:

```text
https://movilidad-opendata.mitma.es/RSS.xml
```

i extreu la data més recent disponible de:

```text
YYYYMMDD_Viajes_municipios.csv.gz
```

La data utilitzada queda registrada a:

```text
data/metadata.json
```

---

# Git i fitxers que s’han de versionar

És recomanable versionar:

```text
app.py
download_mobility.py
requirements.txt
README.md
frontend/
reference/
data/od_catalunya.parquet
data/municipi_ine_to_mitma.parquet
data/metadata.json
```

No és recomanable versionar:

```text
data/raw/
__pycache__/
.venv/
venv/
*.pyc
```

Un `.gitignore` mínim:

```gitignore
__pycache__/
*.pyc
.venv/
venv/

data/raw/
```

---

# Resolució de problemes

## `Falten fitxers`

Executa:

```bash
python download_mobility.py
```

i comprova també que existeixin:

```text
reference/municipis_catalunya.csv
reference/comarques_catalunya.json
```

---

## Components V2 no disponibles

Actualitza Streamlit:

```bash
python -m pip install -U "streamlit>=1.62"
```

---

## La capa OpenStreetMap no apareix

Comprova:

- connexió a Internet;
- accés a `tile.openstreetmap.org`;
- consola del navegador;
- bloquejadors de contingut o polítiques CSP.

---

## Les dades semblen antigues

Executa de nou:

```bash
python download_mobility.py
```

El portal del Ministeri no necessàriament publica dades amb periodicitat diària. Catatrens utilitza l’últim fitxer que apareix al RSS oficial.

---

# Avís metodològic

Catatrens és una eina de simulació.

Els valors de:

- captació ferroviària;
- vehicles evitats;
- CO₂;
- temps de trajecte;
- cost;

són estimacions derivades dels paràmetres configurats i del model implementat.

La matriu OD és observada, però això no converteix automàticament els resultats de canvi modal en una previsió oficial.

Per a planificació real d’infraestructures serien necessaris, entre altres:

- models de demanda calibrats;
- distribució temporal dels viatges;
- motius de viatge;
- capacitat ferroviària;
- accessibilitat real a les estacions;
- xarxa viària real;
- transbordaments;
- costos operatius;
- inversió detallada;
- estudis ambientals;
- demanda induïda;
- competència amb altres modes.

---

# Fonts principals

- Ministerio de Transportes y Movilidad Sostenible — dades de mobilitat.
- Institut d’Estadística de Catalunya (Idescat) — dades municipals.
- Institut Cartogràfic i Geològic de Catalunya (ICGC) — geoinformació comarcal.
- OpenStreetMap contributors — cartografia OSM.
