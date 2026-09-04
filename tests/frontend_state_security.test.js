'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('frontend/app.js', 'utf8');
const start = source.indexOf("const STATE_KEY = 'catatrens-state-v9';");
const endMarker = 'restoreState();';
const end = source.indexOf(endMarker, start);
assert.ok(start >= 0 && end > start, 'state security block not found in frontend/app.js');
const actualSecurityBlock = source.slice(start, end + endMarker.length);

const storage = new Map();
const sessionStorage = {
  getItem: key => storage.has(key) ? storage.get(key) : null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: key => storage.delete(key),
};

const prelude = `
const COLORS_LINIA = ['#e63946','#2a9d8f','#f4a300','#8338ec','#3a86ff','#06d6a0','#ff6b35','#c9184a'];
const BASE_VB = {x:0,y:0,w:800,h:660};
const MUNICIPIS = [{id:'08001'},{id:'08002'},{id:'08003'}];
const OD_PAIRS = [];
const META = {};
let linies = [];
let comptadorLinies = 0;
let lineaActivaId = null;
let mostrarFluxos = true;
let mostrarComarques = true;
let layerMode = 'procedural';
let vb = {...BASE_VB};
const parametres = {
  velocitatTren:80, frequencia:2, velocitatCotxe:65, tempsAcces:6,
  tempsParada:1, intensitatMobilitat:1.12, sensibilitatDistancia:1.20,
  sensibilitat:0.08, biaix:0.8, fraccioCotxeActual:0.75, costPerKm:12,
  emissioPerKm:0.15, diesPerAny:250, radiCaptacio:8,
};
const parentElement = {querySelector: () => ({})};
`;

const expose = `
globalThis.__stateApi = {
  STATE_KEY,
  sanitizeState,
  sanitizeParameters,
  sanitizeViewBox,
  sanitizeLines,
  restoreState,
  runtime: () => ({linies,comptadorLinies,lineaActivaId,mostrarFluxos,mostrarComarques,layerMode,vb,parametres:{...parametres}}),
};
`;

const context = {sessionStorage, console};
vm.createContext(context);
vm.runInContext(prelude + actualSecurityBlock + expose, context, {filename: 'frontend-state-security.vm.js'});
const api = context.__stateApi;

// Empty state leaves defaults untouched.
assert.deepEqual(Array.from(api.runtime().linies), []);
assert.equal(api.runtime().layerMode, 'procedural');

// Valid persisted data survives sanitization.
const valid = api.sanitizeState({
  linies:[{id:'linia-2',nom:'Regional',color:'#e63946',estacions:['08001','08002'],existingKm:3}],
  comptadorLinies:2,
  lineaActivaId:'linia-2',
  mostrarFluxos:false,
  mostrarComarques:true,
  layerMode:'osm',
  vb:{x:10,y:20,w:400,h:330},
  parametres:{velocitatTren:120,frequencia:3},
});
assert.equal(valid.linies.length, 1);
assert.equal(valid.linies[0].nom, 'Regional');
assert.equal(valid.layerMode, 'osm');
assert.equal(valid.parametres.velocitatTren, 120);
assert.equal(valid.parametres.frequencia, 3);

const boundedLine = api.sanitizeLines([{
  id:'linia-3', nom:'A'.repeat(500), color:'#3a86ff', estacions:['08001'], existingKm:-5,
}])[0];
assert.equal(boundedLine.nom.length, 80);
assert.equal(boundedLine.existingKm, 0);

// Manipulated attributes never reach the live state unchanged.
const manipulated = api.sanitizeState({
  linies:[
    {id:'linia-1',nom:'A'.repeat(500),color:'red\" onload=alert(1)',estacions:['08001'],existingKm:-10},
    {id:'linia-2',nom:'Safe',color:'#2a9d8f',estacions:['08001','99999','08001','08002'],existingKm:5},
    {id:'../../bad',nom:'Bad ID',color:'#e63946',estacions:['08001'],existingKm:0},
  ],
  comptadorLinies:2,
  lineaActivaId:'../../bad',
  mostrarFluxos:'yes',
  mostrarComarques:1,
  layerMode:'javascript:alert(1)',
  vb:{x:0,y:0,w:1,h:1},
  parametres:{velocitatTren:'fast',frequencia:-1,biaix:99},
});
assert.equal(manipulated.linies.length, 1);
assert.equal(manipulated.linies[0].id, 'linia-2');
assert.deepEqual(Array.from(manipulated.linies[0].estacions), ['08001']);
assert.equal(manipulated.lineaActivaId, null);
assert.equal(manipulated.layerMode, 'procedural');
assert.equal(manipulated.mostrarFluxos, true);
assert.equal(manipulated.mostrarComarques, true);
assert.equal(manipulated.vb.w, 800);
assert.equal(manipulated.parametres.velocitatTren, 80);
assert.equal(manipulated.parametres.frequencia, 2);
assert.equal(manipulated.parametres.biaix, 0.8);

// Values parsed as Infinity are rejected by Number.isFinite.
const huge = JSON.parse('{"linies":[],"comptadorLinies":0,"parametres":{"velocitatTren":1e999}}');
assert.equal(api.sanitizeState(huge).parametres.velocitatTren, 80);

// Corrupt JSON is removed rather than crashing restoreState().
storage.set(api.STATE_KEY, '{not-json');
api.restoreState();
assert.equal(storage.has(api.STATE_KEY), false);

console.log('frontend state security tests: OK');
