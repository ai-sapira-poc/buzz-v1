# Revisión independiente del relevo entre agentes — veredicto

**Revisor:** rol `revisor` (worktree `revisor-dispatch`). **Fecha:** 2026-09-22.
**Pre-registro de riesgos:** 2026-09-22T21:48Z (sección al final, sellada antes de leer el diff).
**Artefacto revisado:** rama `agent/coder-dispatch`, tip `cd13a9a4f`; nota del coder
`artifacts/tower/handover-coder.md` (sha256 `0047985c…`); PR **#7** contra `main` de
`ai-sapira-poc/buzz-v1` (OPEN, no draft, head `agent/coder-dispatch`).
**Entorno de ejecución:** worktree `coder-dispatch` (checkout de `cd13a9a4f`), toolchain Hermit
(cargo 1.95.0 / rustc 1.95.0), node v24.15.0, pnpm 11.4.0, Python 3.12.4.
**Árbol tras las pruebas:** limpio (`git status -s` vacío, HEAD `cd13a9a4f`).

---

## 0. Veredicto, en una frase

**La slice funciona y está bien probada; la afirmación central del PR es cierta en todo lo que
medí. Pero le falta el tercer gate: el fallo de publicación del relevo no llega a la superficie y
el vacío miente en ese caso — exactamente lo que la frontera del arquitecto §3 y la spec de diseño
§5.3 exigen que no ocurra. Eso bloquea la aceptación.**

Confianza: **alta** en las ejecuciones (las reproduje yo); **media** en los juicios de
diseño/estado porque no abrí una superficie renderizada ni un relay vivo.

---

## 1. Ejecuciones reales (comando → salida)

| Comando | Salida real | ¿Coincide con la nota del coder? |
|---|---|---|
| `node ./scripts/check-px-text.mjs` (en `desktop/`) | sin salida, `EXIT=0` | sí (`exit 0`) |
| `pnpm test` (desktop, suite completa) | `ℹ tests 6709 · pass 6709 · fail 0` | — (la nota solo cita el subconjunto tower) |
| `node --test … src/features/tower/** src/shared/api/tower*` | `ℹ tests 90 · pass 90 · fail 0` | sí (90 pass) |
| `BUZZ_PILOT_PROJECT=tower_project python3 -m unittest test_tower_project test_controls` | `Ran 61 tests … OK` | sí (61) |
| `cargo test -p buzz-cli --lib jobs::` | `15 passed; 0 failed` | sí (15) |
| `cargo test -p buzz-core --lib kind::` | `19 passed; 0 failed` (incl. `no_duplicate_kind_values`) | sí (19) |
| `cargo test -p buzz-relay --lib ingest` | `176 passed; 0 failed; 1 ignored` | sí (176/1) |

Todas las cifras de la nota del coder que pude ejecutar **se reproducen exactamente**. No encontré
una afirmación numérica inflada.

---

## 2. Test de falsación — quitar guards y comprobar que un test falla

Ejecuté tres eliminaciones de código de producción real, cada una revertida después
(`git status -s` limpio al final). **Las tres hicieron fallar tests**: el vínculo guard↔costura es
real, no decorativo.

| # | Guard eliminado (código de producción) | Test que falla | Salida literal |
|---|---|---|---|
| A | `ingest.rs`: `KIND_JOB_HANDOFF` fuera del match de `required_scope_for_kind` | `the_job_protocol_kinds_are_admitted` | `FAILED … 175 passed; 1 failed` |
| B | `operator_updates.py`: `for child in children_of(parent_job)` → `for child in []` | `test_one_event_per_child_never_one_per_parent` (+3) | `Ran 61 tests … FAILED (failures=4)` |
| C | `portfolioState.ts`: la rama `snapshot.isError → "unreachable"` neutralizada | `a failed read renders the error state, not the empty state` (+4) | `tests 15 · pass 10 · fail 5` |

**No hay hallazgo de guard falsable-falso.** La afirmación del coder («quitar el bucle por hijo y
el kind del filtro del relay hace fallar un test») la reproduje de forma independiente.

---

## 3. Veredicto por riesgo pre-registrado

| # | Riesgo | Veredicto | Evidencia |
|---|---|---|---|
| **R1** | vínculo padre→hijo solo con identificador, no contenido | **CONFIRMADO — pero declarado fuera de alcance, no es defecto** | El productor emite `job`(padre), `child`, `role`, `h`, `trace`; el `--content` es una frase plantilla («{rol} entrega su conclusión al encargo {child}» + trace_id) y **el lector no lo lee** (`foldHandoffEdges` solo lee tags). La frontera §3 declara «El contenido que cruzó … **sin productor**» y la spec §4 lo repite. El operador sigue sin saber *qué* se pasó, pero eso es decisión de producto/arquitecto, no un fallo de la implementación. |
| **R2** | la UI aprendió kinds/Relay/Nostr | **FALSO** | `grep -rnE "4300[0-9]|KIND_|relayClient|subscribeLive"` en `HandoverSection.tsx`, `handoverState.ts`, `useHandoverState.ts`, `domain/handover.ts` → `NONE`. El único sitio con el número es `shared/api/towerHandoffEdges.ts` + `constants/kinds.ts` (la costura del puerto, correcto). Guard `towerContract.test.mjs` falsable (ver §5, F5 para su límite). |
| **R3** | `check:px-text` falla | **FALSO** | `EXIT=0`. |
| **R4** | estados vacío/carga/error sin texto o indistinguibles | **PARCIAL — el texto está y las ramas se distinguen; pero el vacío miente en un caso (F1)** | Los cuatro estados llevan texto visible (carga «Leyendo los relevos…», vacío con título+descripción, error con `AlertTitle`+motivo, stale con aviso). La costura es falsable (§2 C). **Pero** un fallo de publicación del 43007 se registra solo en local (`job_handoff_failed`) y no cruza a la superficie → el vacío dice «no hay relevos … no es un fallo de lectura» cuando sí lo fue (F1). |
| **R5** | el PR afirma más de lo que prueba | **FALSO en lo medible** | Todas las cifras reproducidas; la nota declara explícitamente lo no cubierto. No vi exageración. |
| **R6** | el test de falsación no falsa nada | **FALSO** | §2: tres guards, tres fallos. |
| **R7** | la admisión del relay del kind nuevo no está wired | **MITAD RESUELTA** | La admisión **sí** está wired y probada (`ingest.rs` añade `KIND_JOB_HANDOFF`; test dedicado; falsable §2 A). Lo que **no** está wired es la señal de *fallo* de publicación hacia la superficie (F1). |
| **R8** | `blocked` derivado de `failed` marcado `observed` se propaga | **NO APLICABLE a esta superficie** | `towerJobFold.ts` **no** se toca; las filas de relevo usan `parentOutcome` de kinds terminales (43004/43005/43006), no `blocked`. El defecto conocido del plegado sigue existiendo, pero es pre-existente y fuera de este diff. |
| **R9** | productor solo de test | **FALSO** | `publish_handoffs` se llama en código real de entrega (`launch_tower.py` dispatch_pi + rama de recuperación; `supervisor.py`). **El camino por el cable sí está sin ejercitar** (publisher parcheado en tests) — la nota lo declara. |
| **R10** | cobertura headless presentada como nativa | **NO PRESENTADA COMO NATIVA** | La nota no reclama evidencia nativa; dice «no live relay↔desktop round trip». Los tests desktop son `node --test` sobre lógica/render helpers, **sin** navegador, sin relay, sin e2e, sin captura. |
| **R11** | duplicados (N filas por hijo) | **FALSO** | `foldHandoffEdges` pliega por clave de arista `parent->child` (gana el instante más nuevo); test «a republished edge is one row» en verde. |
| **R12** | lista sin cota | **FALSO** | `TOWER_HANDOFF_EVENT_LIMIT = 500` en el filtro de lectura. |
| **R13** | kind no declarado en `kind.rs` / colisión | **FALSO** | `KIND_JOB_HANDOFF = 43007` declarado tras 43006 y dado de alta en `ALL_KINDS`; `no_duplicate_kind_values` pasa. |
| **R14** | proceso: push/PR en vez de propuesta | **CONFIRMADO (con matiz)** | `origin/agent/coder-dispatch` == local; PR #7 OPEN en `ai-sapira-poc/buzz-v1`. La rama se empujó a `origin`. La atribución a un bug de `agent_delivery` (gh contra `upstream`) **no la verifiqué** (habría empujado). |
| **R0.1** | integridad del pre-registro | **DECLARADO** | Leí las 5 primeras líneas de la nota para localizar el PR antes de sellar los riesgos. Declarado, no oculto. |

---

## 4. Hallazgos priorizados

### F1 — [Alto · gate 3] Un fallo de publicación del relevo se dibuja como vacío
**Repro:**
```
grep -rn "job_handoff_failed" experiments desktop            # solo: operator_updates.py:307 + el test
grep -rn "handoff_failed" desktop                            # NOT in desktop reader
```
`publish_handoffs` captura la excepción del publi`sh y escribe el evento **local** `job_handoff_failed`;
nada lo proyecta al relay. El lector solo conoce kinds 43001-43007. Por tanto, si el relay rechaza/está
caído, la pantalla muestra el **estado vacío** («No hay ningún relevo en esta ventana … y no es un fallo
de lectura»). Esto contradice:
- frontera del arquitecto §3: «Un fallo de publicación debe **verse** …, nunca renderizarse como ausencia
  (regla 1 de `AGENTS.md`)»;
- spec de diseño §5.3: «la pantalla **nunca** omite el fallo: la fila diría «no se pudo registrar el traspaso»»;
- `AGENTS.md` regla 1: «never convert a terminal failure into an authoritative success/empty result».

El coder lo declara honestamente («a failed publication remains invisible to the surface (needs a new
published signal, not a bug fix)»), pero **el requisito queda sin cumplir**. Nota del coder: no es
un bug de un renglón.

**Qué hace falta para aceptar:** una señal de fallo publicada (p. ej. `job_handoff_failed` como evento
de relay, o un kind/estado de «traspaso no registrado»), o re-acotar el requisito con el operador por
escrito. Mientras no exista, la rama VACÍO no puede afirmar «no es un fallo de lectura».

### F2 — [Medio · gate 3] El vacío no nombra la ventana en texto
La spec §3 exige la línea «… en la ventana **2026-09-16 00:00 → 2026-09-22 23:59 · canal
tower-control** …». La implementación dice «en la ventana **de la sesión**» sin fechas ni canal
(`HandoverSection.tsx`, `HandoverEmptyState`). La regla «nombrar la ventana, nunca un 0» se cumple a
medias: no hay 0, pero la ventana no queda nombrada. **Aceptar exige** o nombrar el periodo/canal, o
declarar que el encargo no lo pedía.

### F3 — [Medio · gate 2/3] La carga no conserva la cabecera de 5 columnas
Spec §3 (CARGA): «la cabecera de cinco columnas **permanece visible**; las celdas son `Skeleton`».
La implementación pinta un `div` en rejilla con 3×5 `Skeleton` y **sin `<thead>`**. El esqueleto no se
lee como fila parcial (bien) pero el encabezado desaparece (desviación de la spec).

### F4 — [Bajo/Medio] No es adopción del catálogo `@sapira/ui`
La spec §1 nombra `DataTable`, `EmptyState`, `Alert`, `StatusBadge` del catálogo Sapira 0.13.1; la
implementación usa `@/shared/ui/{alert,button,skeleton}` (componentes locales de Buzz; `@sapira/ui` no
está en `desktop/package.json`). Coincide con la convención del Tower existente y la propia spec §8
admite que el prototipo no es adopción React; queda como **tensión declarada** con «todo lo que tenga
interfaz se construye sobre Sapira Design System».

### F5 — [Bajo] El guard de «la UI no nombra un kind» es más débil que su nombre
El test cubre `/KIND_[A-Z_]+/` pero **no** un kind numérico crudo. Lo comprobé: añadir
`export const _x = 43007;` a un `.ts` de `ui/` **no** hace fallar el test (con `KIND_JOB_HANDOFF` sí).
Guard pre-existente (no en este diff), pero es lo que respalda R2.

### F6 — [Proceso] Push directo y PR #7
Ver R14. El PR existe y está bien, pero llegó por `git push`, no por la herramienta prevista. La causa
que la nota atribuye al tool no la verifiqué.

---

## 5. Lo que NO ejercí (declarado, no omitido)

- **Sin relay vivo**: no arranqué relay/Postgres, no publiqué un 43007 real, no hubo round-trip
  relay↔desktop. La admisión del kind se probó por test unitario, no por POST real.
- **Sin superficie renderizada**: no abrí Tower Control en navegador/app; no hay captura ni e2e. Foco,
  `aria-live`, orden de tabulación y contraste **no medidos** (yo tampoco los medí).
- **Sin `just ci`** ni builds (Tauri/desktop/web); solo tests + `check:px-text`. No corrí `biome lint`.
- **Sin la suite de integración** con infraestructura.
- **`agent_delivery`** no ejecutado (habría empujado). La afirmación del bug (gh contra `upstream`) no
  verificada.
- **No verifiqué** la afirmación «a stub relay confirms both events POST as kind 43006» (pertenece al
  commit del tag `outcome`, fuera de la slice del relevo) ni los commits de test-fixtures.
- **No leí** los artefactos de revisión previos de otros revisores (`reviews/relevo-riesgos.md`,
  `reviews/relevo-veredicto.md`) para no cerrar riesgos por consenso.

---

## 6. Respuesta a las preguntas mínimas del encargo

1. **¿El vínculo padre→hijo lleva contenido real o solo un identificador?** Solo identificadores
   (padre, hijo, rol emisor, canal, `trace`) más el resultado terminal del padre. El contenido **no se
   emite ni se lee**, y esto está declarado como frontera («sin productor»), no escondido.
2. **¿La UI aprendió kinds o Relay?** No. La UI y el dominio están limpios; el número vive en la costura
   del puerto (`shared/api`).
3. **¿`check:px-text` pasa?** Sí, `EXIT=0`.
4. **¿Los estados vacío, carga y error tienen texto?** Sí, los tres (y un cuarto, stale). Pero el vacío
   puede afirmar «no es un fallo de lectura» cuando sí lo fue (F1).
5. **¿El PR afirma más de lo que prueba?** No en lo cuantitativo; sí deja un requisito de la frontera
   sin cumplir y lo declara (F1).

---

## 7. Veredicto final

**NO ACEPTAR todavía.** La implementación es sólida y honesta: camino end-to-end presente en
`TowerScreen`, kind declarado primero en `kind.rs`, admitido por el relay, UI transport-agnóstica,
estados distinguibles, dedup por arista, cota de lectura, y **tests verdes que reproduje uno a uno** más
**tres guards falsables** que fallan al quitarlos. El primer gate (90%) y buena parte del segundo están.

Lo que falta para poder aceptar:
1. **F1 (bloqueante de gate 3):** publicar la señal de fallo de publicación, o re-acotar por escrito el
   requisito «un fallo se ve, nunca se dibuja como ausencia».
2. **F2/F3:** alinear vacío (ventana nombrada) y carga (cabecera visible) con la spec §3, o declarar la
   desviación como decisión.
3. **Evidencia de superficie real:** una ejecución renderizada (navegador/app) de las cuatro ramas,
   aunque sea headless con captura; hoy no existe ninguna.
4. **Wire real:** un POST de 43007 contra un relay y su lectura por el lector, o declararlo como riesgo
   residual aceptado explícitamente.
5. **F6:** posicionamiento del operador sobre el push directo / el bug del tool de entrega.

Confianza en el veredicto: **alta** sobre la corrección de lo medido; la condición de bloqueo F1
descansa en una lectura de código y en la admisión del propio autor, no en una ejecución — cualquiera
puede rebatirla mostrando que `job_handoff_failed` sí llega a alguna superficie.

---

## Anexo — Riesgos pre-registrados (sellados 2026-09-22T21:48Z, antes del diff)

| # | Riesgo |
|---|---|
| R1 | El vínculo padre→hijo lleva solo un identificador, no contenido real. |
| R2 | La UI aprendió kinds/Relay/Nostr. |
| R3 | `pnpm check:px-text` falla. |
| R4 | Estados vacío/carga/error sin texto, o uno solo dibujado. |
| R5 | El PR afirma más de lo que prueba. |
| R6 | El test de falsación no falsa nada. |
| R7 | La admisión del relay del kind nuevo no está wired. |
| R8 | `blocked` derivado de `failed` marcado `observed` se propaga a la superficie nueva. |
| R9 | Productor solo de test. |
| R10 | Cobertura headless presentada como nativa. |
| R11 | Duplicados: N filas por hijo. |
| R12 | Lista sin cota. |
| R13 | Kind no declarado primero en `kind.rs` o con colisión. |
| R14 | Proceso: push/merge directo en vez de propuesta. |
| R0.1 | Integridad del pre-registro (leí 5 líneas de la nota antes de sellar). |
