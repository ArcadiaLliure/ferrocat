# Política de seguretat

## Versions compatibles

Ferrocat es desenvolupa actualment com una aplicació desplegada de manera contínua. La versió actual és la **1.0**.

| Versió | Suport de seguretat |
| --- | --- |
| `1.0` / `main` actual / darrer desplegament | Sí |
| Commits antics, forks o còpies locals | Sense suport garantit |

Les correccions de seguretat es preparen en una branca o pull request, es revisen i s'integren a `main` quan s'accepten.

## Comunicació d'una vulnerabilitat

No publiquis detalls d'explotació, credencials, tokens, dades privades ni vulnerabilitats greus en una issue pública de GitHub.

Canal preferent:

1. Utilitza **GitHub Private Vulnerability Reporting** per a aquest repositori si està habilitat.
2. Si no està disponible, obre una issue pública mínima demanant un canal privat, sense incloure detalls d'explotació ni informació sensible.

No enviïs secrets en captures de pantalla ni registres públics.

Un informe útil hauria d'incloure:

- component i fitxer o ruta afectats;
- impacte i escenari d'atac realista;
- requisits previs per explotar-lo;
- passos reproduïbles o una prova de concepte mínima;
- versió o commit afectat, si es coneix;
- mitigació suggerida, si n'hi ha;
- si el problema ja és públic en algun altre lloc.

## Divulgació responsable

Dona un temps raonable per reproduir, avaluar i corregir el problema abans de divulgar-lo públicament. El mantenidor pot demanar informació tècnica addicional o una prova de concepte reduïda.

Els informes fets de bona fe per millorar la seguretat del projecte són benvinguts. No accedeixis, modifiquis ni destrueixis dades que no siguin teves, no interrompis el servei públic, no intentis robar credencials i no facis proves de denegació de servei contra infraestructura de producció.

## Abast de seguretat

La versió 1.0 de Ferrocat té deliberadament una superfície de servidor petita: no hi ha comptes d'usuari, base de dades SQL, pujada de fitxers ni persistència de servidor controlada pels visitants. Les dades públiques derivades de MITMS, Idescat, ICGC i OSM s'envien al navegador per disseny.

Tot el que es passa al component de Streamlit s'ha de considerar públic. No hi incloguis mai claus API, credencials, tokens ni dades privades.

## Controls automatitzats

El repositori inclou:

- auditoria de dependències Python amb `pip-audit`;
- tests Python i comprovacions de compilació;
- CodeQL per Python i JavaScript/TypeScript;
- Gitleaks per detectar secrets;
- Dependabot per obrir pull requests d'actualització.

Les regles de branca, l'escaneig de secrets natiu de GitHub, la protecció de push i el Private Vulnerability Reporting s'han d'habilitar manualment a GitHub quan estiguin disponibles.
