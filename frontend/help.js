/* Ajuda contextual dels camps de paràmetres de Ferrocat.
 * S'injecta després del motor principal i no provoca reruns de Streamlit.
 */
const FERROCAT_FIELD_HELP = Object.freeze({
  's-velocitatTren': {
    title: 'Velocitat tren',
    text: "Velocitat mitjana de circulació entre estacions, en km/h. El temps de parada a les estacions intermèdies s'afegeix a part. Afecta el temps de viatge del tren i, per tant, la captació modal estimada."
  },
  's-frequencia': {
    title: 'Freqüència',
    text: "Nombre de trens per hora. Ferrocat en deriva l'interval mitjà entre trens (60/freqüència) i aplica un cost d'espera de referència del 30% d'aquest interval al temps generalitzat del tren."
  },
  's-velocitatCotxe': {
    title: 'Velocitat cotxe',
    text: "Velocitat mitjana assumida per al trajecte en cotxe, en km/h. S'utilitza per estimar el temps del cotxe quan no hi ha un temps viari observat o un routing més precís."
  },
  's-tempsAcces': {
    title: 'Accés estació',
    text: "Minuts d'accés o egrés associats a cada extrem del viatge ferroviari. El model els aplica tant a l'origen com a la destinació; per exemple, 6 min equivalen a 12 min totals afegits al viatge."
  },
  's-tempsParada': {
    title: 'Parada intermèdia',
    text: "Temps, en minuts, que s'afegeix per cada estació intermèdia entre origen i destinació. No s'aplica a les dues estacions extremes del trajecte."
  },
  's-intensitatMobilitat': {
    title: 'Factor traça fallback',
    text: "Factor que estima la longitud ferroviària quan encara no existeix una geometria real o dibuixada. Amb 1,12×, 50 km en línia directa es converteixen en 56 km estimats de via. Quan hi ha traçat real, aquest factor no hauria d'intervenir."
  },
  's-sensibilitatDistancia': {
    title: 'Factor carretera',
    text: "Factor que transforma la distància directa en una distància viària aproximada quan no hi ha routing real. Amb 1,20×, 50 km directes es consideren 60 km per carretera. També afecta els vehicle-km i el CO₂ evitats."
  },
  's-sensibilitat': {
    title: 'Beta logit',
    text: "Sensibilitat del model modal a la diferència de temps entre tren i cotxe. En P = 0,65 / (1 + exp(biaix + beta·(Ttren − Tcotxe))), una beta més alta fa que petites diferències de temps canviïn més fortament la probabilitat de passar del cotxe al tren."
  },
  's-biaix': {
    title: 'Biaix cotxe',
    text: "Preferència estructural pel cotxe dins del model logit, independent de la diferència de temps. Un valor més alt penalitza el tren i exigeix que sigui més competitiu per captar els mateixos viatges."
  },
  's-fraccioCotxeActual': {
    title: 'Quota cotxe',
    text: "Percentatge dels viatges OD observats pel MITMS que s'assumeix que actualment es fan en cotxe. El model de canvi modal s'aplica sobre aquesta fracció, no sobre tota la demanda observada."
  },
  's-radiCaptacio': {
    title: 'Radi captació',
    text: "Radi, en km, utilitzat per decidir quins municipis i zones MITMS queden servits per una estació. Si un municipi entra al radi de diverses estacions, s'assigna a la més propera; una zona MITMS s'assigna una sola vegada per evitar doble recompte."
  },
  's-costPerKm': {
    title: 'Via nova',
    text: "Cost base de prefactibilitat, en milions d'euros per km, per a una nova plataforma ferroviària en superfície. Els túnels, viaductes i estacions es valoren amb paràmetres separats; no és un pressupost constructiu."
  },
  's-tunnelCost': {
    title: 'Túnel',
    text: "Cost estimat, en milions d'euros per km, dels trams que el motor topogràfic classifica com a túnel. S'aplica quan no es troba una alternativa superficial raonable dins del corredor de cerca o quan el perfil vertical ho requereix."
  },
  's-viaductCost': {
    title: 'Viaducte',
    text: "Cost estimat, en milions d'euros per km, dels trams que necessiten mantenir la rasante ferroviària significativament per sobre del terreny. És una aproximació de prefactibilitat, no un càlcul estructural."
  },
  's-stationCost': {
    title: 'Estació nova',
    text: "Cost estimat, en milions d'euros, per cada parada proposta que requereix construir una estació nova. El cost és zero quan Ferrocat detecta que es pot reutilitzar una estació ferroviària activa compatible."
  },
  's-stationReuseRadius': {
    title: 'Radi reutilització estació',
    text: "Distància màxima ordinària, en km, per considerar que una parada proposada pot reutilitzar una estació activa de Renfe o FGC. El matching també pot considerar coincidències de nom properes per evitar duplicar estacions reals."
  },
  's-maxGradient': {
    title: 'Pendent excepcional',
    text: "Pendent màxima admissible que el motor de prefactibilitat permet al perfil ferroviari, expressada en ‰ (per mil), no en %. Si una solució superficial la supera, Ferrocat ha d'intentar una alternativa per vall o proposar obres singulars com túnels."
  },
  's-emissioPerKm': {
    title: 'Emissions cotxe',
    text: "Factor d'emissió del cotxe, en kg de CO₂ per vehicle-km, utilitzat per convertir els vehicle-km evitats en estalvi anual de CO₂. És un paràmetre de model i es pot ajustar segons l'escenari de flota."
  }
});

(function installFerrocatFieldHelp() {
  const doc = parentElement.ownerDocument;

  if (!parentElement.querySelector('#ferrocat-field-help-style')) {
    const style = doc.createElement('style');
    style.id = 'ferrocat-field-help-style';
    style.textContent = `
      .field-help-head{display:flex;align-items:center;gap:5px;min-height:18px}
      .fila-slider .field-help-label{display:inline!important;justify-content:initial!important;font-size:11.5px;line-height:1.25;cursor:pointer}
      .field-help-head .valor{margin-left:auto;white-space:nowrap}
      button.field-help-toggle{display:inline-flex;align-items:center;justify-content:center;flex:0 0 16px;width:16px;height:16px;min-width:16px;padding:0;margin:0;border:1px solid #8c94a3;border-radius:50%;background:#fffdf8;color:#626b7c;font:700 10px/1 'IBM Plex Mono',monospace;cursor:pointer;box-shadow:none;opacity:1}
      button.field-help-toggle:hover,button.field-help-toggle:focus-visible,button.field-help-toggle[aria-expanded="true"]{opacity:1;background:#eef1f5;color:#1c2333;border-color:#5b6478;outline:none}
      button.field-help-toggle:focus-visible{box-shadow:0 0 0 2px rgba(255,107,53,.28)}
      .field-help-text{margin:4px 0 5px;padding:6px 7px;border:1px solid #d9d2c0;border-left:3px solid #8e98aa;border-radius:2px;background:#f7f4ea;color:#4d5668;font:10px/1.45 Inter,sans-serif}
      .field-help-text[hidden]{display:none!important}
    `;
    parentElement.prepend(style);
  }

  const closeAll = exceptId => {
    parentElement.querySelectorAll('.field-help-text').forEach(panel => {
      if (panel.id === exceptId) return;
      panel.hidden = true;
      const button = parentElement.querySelector(`[aria-controls="${panel.id}"]`);
      if (button) button.setAttribute('aria-expanded', 'false');
    });
  };

  for (const [inputId, spec] of Object.entries(FERROCAT_FIELD_HELP)) {
    const input = byId(inputId);
    const row = input?.closest('.fila-slider');
    if (!input || !row || row.dataset.helpReady === '1') continue;

    const oldLabel = row.querySelector('label');
    const value = oldLabel?.querySelector('.valor');
    if (!oldLabel || !value) continue;

    const head = doc.createElement('div');
    head.className = 'field-help-head';

    const parent = oldLabel.parentNode;
    parent.insertBefore(head, oldLabel);

    oldLabel.removeChild(value);
    oldLabel.textContent = spec.title;
    oldLabel.className = 'field-help-label';
    oldLabel.setAttribute('for', inputId);

    const panelId = `help-${inputId}`;
    const toggle = doc.createElement('button');
    toggle.type = 'button';
    toggle.className = 'field-help-toggle';
    toggle.textContent = '?';
    toggle.setAttribute('aria-label', `Què és «${spec.title}»?`);
    toggle.setAttribute('aria-controls', panelId);
    toggle.setAttribute('aria-expanded', 'false');
    toggle.title = `Què és «${spec.title}»?`;

    const panel = doc.createElement('div');
    panel.id = panelId;
    panel.className = 'field-help-text';
    panel.hidden = true;
    panel.textContent = spec.text;

    toggle.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      const willOpen = panel.hidden;
      closeAll(willOpen ? panelId : null);
      panel.hidden = !willOpen;
      toggle.setAttribute('aria-expanded', String(willOpen));
    });

    head.append(oldLabel, toggle, value);
    head.insertAdjacentElement('afterend', panel);
    row.dataset.helpReady = '1';
  }

  parentElement.addEventListener('click', event => {
    if (event.target.closest('.field-help-toggle') || event.target.closest('.field-help-text')) return;
    closeAll(null);
  });

  parentElement.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    closeAll(null);
    const focused = parentElement.querySelector('.field-help-toggle:focus');
    if (focused) focused.blur();
  });
})();
