# El relevo — veredicto independiente (revisor, ejecutando, no leyendo)

**Artefacto revisado:** rama `agent/coder-dispatch`, commit
`7e56ef224541c8c97232aa699100df7946bbcf8f` «fix(pilot): emit the Hermes handoff
edge where the delegating role finishes» (4 commits desde `main`:
`aa1fc86c4` UI, `35301b108` R6 + una fila por hijo, `cd13a9a4f` emisor Pi,
`7e56ef224` emisor Hermes).
**Método:** riesgos derivados del requisito ANTES de leer el cierre del autor;
después los tests del coder EJECUTADOS (`pnpm test`, `pnpm check:px-text`,
`tsc --noEmit`, unittest del piloto), tres mutaciones de guard ejecutadas y
restauradas, un sondeo propio de render con una fila degenerada, y lectura de
`pilot.db` en solo-lectura.
**Veredicto corto:** **apruebo las puertas 1 y 2** para la fila y sus tres
estados; **no apruebo la puerta 3**. Las cinco comprobaciones obligatorias pasan
con salida real. Queda un hueco de producto real (F1) y una deuda de verdad
declarada (F5): **la emisión del 43007 nunca se ha ejecutado contra un relay**.

> Sustituye al veredicto anterior, que revisó `aa1fc86c4`. Los dos commits del
> emisor (`cd13a9a4f`, `7e56ef224`) y el cierre de R6 (`35301b108`) son
> posteriores a aquel documento.

---

## 0. Comprobaciones obligatorias — resultado

| # | Comprobación | Resultado | Salida que lo sostiene |
|---|---|---|---|
| 1 | Quitar un guard hace fallar un test | **PASA (3/3)** | §1, tres mutaciones ejecutadas |
| 2 | Tres estados con texto; el error NO se dibuja como vacío | **PASA** | §2, render propio + tests del coder |
| 3 | Ninguna celda de la fila queda en blanco | **PASA** | §2, `CELLS: ["Agente sin nombre","Rol sin registrar job-child-hexish","job-parent-hexish sin resultado registrado","sin instante registrado","sin hilo"]` |
| 4 | La UI no contiene Relay/Nostr/kind ni números de kind | **PASA** | §3, grep + render |
| 5 | No se dibuja botón de interrumpir ni celda de bloqueo | **PASA en la fila de relevo** | §3, grep; el `BlockedCell` que existe es de la cartera pre-existente |

---

## 1. Falsación de guardas (ejecutada, no supuesta)

Cada mutación se aplicó con `perl -0pi` en un worktree **detached** propio
(`/tmp/relevo-rev`, HEAD = `7e56ef224`, `node_modules` enlazado al del coder),
se ejecutó el test, se restauró con `cp` desde copia y el sha256 volvió a
coincidir; el worktree se eliminó después. No se tocó la rama de nadie.

| Guard mutado | Fichero | Test que falla | Salida |
|---|---|---|---|
| `publish_handoffs(role, role, job, trace_id)` **eliminado** de `worker.run` | `experiments/buzz-autonomy/worker.py` | `test_completion.CompletionBoundary.test_a_hermes_handoff_reaches_the_wire_for_each_child` | `AssertionError: 0 != 1 : one projection per completed job` → `FAILED (failures=1)` |
| `\|\| childJobId === null` eliminado del fold de aristas | `desktop/src/shared/api/towerHandoffEdges.ts` | `towerHandoffEdges.test.mjs` → «an edge with no child is dropped, not drawn as a half row» | `actual: [ { id: 'p1->null', … } ]`, `expected: []` |
| `view.phase === "unreachable" &&` eliminado de la rama de error | `desktop/src/features/tower/ui/HandoverSection.tsx` | `handoverRender.test.mjs` → «loading renders a skeleton, never the empty state's copy» | `✖ loading renders a skeleton…`; `ℹ pass 6 · fail 1` (la rama de carga pasó a dibujar el `Alert` de error) |

Los tres guards están **atados a la costura de producción** (el emisor del
piloto, el fold de aristas y la separación de ramas de la superficie), no a
ayudantes de test.

---

## 2. Render propio: tres estados, fila degenerada, refresco

Sondeo **mío** (fichero temporal en el worktree detached, borrado después).
Render con `renderToStaticMarkup` sobre `HandoverSection` + `deriveHandoverView`:

- **Fila degenerada** (`sender.name=null`, `child.name=null`,
  `parentOutcome="unknown"`, `transferredAt=null`, `thread=null`): cinco celdas,
  todas con texto — ver §0.3. **Ninguna celda en blanco.**
- **Vacío vs error** (el par que define la pieza): `data:[]` →
  `EMPTY: true false` (vacío sí, error no); `isError:true` sin datos →
  `ERR: true false` (error sí, vacío no); `isPending:true` →
  `LOAD: true false false`. Las tres ramas son **mutuamente excluyentes**.
- **Error sin cifras ni instantes** (spec §3 R5): el cuerpo del error es
  «…No se pudo leer el registro de relevos… Un fallo de lectura no se dibuja
  como una lista vacía. Reintentar» — sin fecha y sin `0`.
- **Refresco sobre filas** (`isFetching:true` con datos): `REFRESH: true false`
  → la tabla sigue montada, no aparece el esqueleto (R2 cumplido).
- **Fuga léxica en el render**: `LEAK_kind_number: false  LEAK_relay: false
  LEAK_nostr: false` en los tres estados.

Los tests del coder para las tres ramas y para el par vacío≠error pasan (26/26
en `handoverRender.test.mjs` + `towerHandoffEdges.test.mjs`).

---

## 3. Fuga C2 y controles prohibidos (comprobación 4 y 5)

`git grep` sobre `desktop/src/features/tower/ui/` (rama, tip):

- `4300\d|4301\d|kind` → **0 coincidencias**.
- `constants/kinds` → **0 importaciones** desde `ui/`.
- `relay|nostr` (case-insensitive) → **0**; los únicos aciertos de `event` son
  manejadores DOM (`onBlur`, `handleKeyDown`), no vocabulario de protocolo.
- `interrumpir|pausar|pause|resume` en todo `features/tower/` → **0**. **No hay
  botón de interrumpir.**
- En la **fila de relevo** no hay celda de bloqueo: los cinco `<td>` son
  emisor / hijo / padre+resultado / instante / hilo.
- **Salvedad, fuera de esta fila:** `ui/PortfolioRow.tsx` (cartera
  pre-existente, encima de la sección) sí dibuja `BlockedCell` sobre
  `line.blocked` derivado de `failed` con `basis:"observed"`
  (`towerJobFold.ts:96`). El slice del relevo no lo propaga, pero sigue en pie
  en la misma pantalla; es el riesgo F7 del veredicto anterior, **no resuelto**.

---

## 4. Contraste afirmación-por-afirmación

| Afirmación del coder | Veredicto | Salida |
|---|---|---|
| `pnpm test` desktop: 6709 passed, 0 failed, 86 suites | **CONFIRMADO** | `ℹ tests 6709 · suites 86 · pass 6709 · fail 0` (ejecutado por mí) |
| `pnpm check:px-text` exit 0 | **CONFIRMADO** | `EXIT=0` |
| `tsc --noEmit` exit 0 | **CONFIRMADO** | `EXIT_TC=0` |
| `biome check` exit 0 | **NO VERIFICADO** | no lo ejecuté |
| `unittest test_completion` 6 passed | **CONFIRMADO** | `Ran 6 tests … OK` |
| `unittest test_controls` 27 passed | **CONFIRMADO** | `Ran 27 tests … OK` |
| `unittest discover` 182 ran, 11 errores pre-existentes | **NO VERIFICADO** | ejecuté 3 ficheros; ver abajo |
| El test nuevo falla con `worker.py` revertido | **CONFIRMADO** | mutación §1 fila 1 |
| `cd13a9a4f` no emitía nada porque solo cubría Pi | **CONFIRMADO** | `sqlite3 -readonly pilot.db`: los 7 padres con hijos son `maestro`; **0 de Pi**. (El coder dice 20; mi consulta de «padres con hijos» da 7 — 20 es el número de `handoff_published` locales. El hecho del seam no cambia.) |
| El emisor Hermes en `worker.run` es el call-site correcto | **CONFIRMADO por lectura + test**, **NO VERIFICADO en vivo** | §5, `job_handoff_published = 0` en `pilot.db` |
| No se ha hecho end-to-end contra relay | **CONFIRMADO (es un hueco real)** | `job_handoff_published = 0`, `job_handoff_failed = 0` en `pilot.db` |

**`unittest discover`, matiz:** al ejecutar `test_tower_project` (fichero que la
rama modifica, +71 líneas) da `Ran 34 tests … FAILED (errors=1)` por
`ModuleNotFoundError: No module named 'control_plane.vision_e2e'`, en
`test_pursuit_only_uses_a_wall_cap_when_operator_sets_one`. **Es pre-existente:**
el test existe en `main:test_tower_project.py:336` y `control_plane/vision_e2e.py`
no existe ni en `main` ni en el tip. Los tests nuevos del handoff dentro de ese
fichero sí pasan. No reproduje el recuento agregado de 182/11.

---

## 5. Hallazgos, por impacto

### F1 — MEDIO (producto). Un fallo de proyección se lee como «no hay relevos»
La spec §5.3 lo exige al revés: «Un fallo de publicación no se convierte en
relevo exitoso… la pantalla nunca omite el fallo». El emisor escribe
`job_handoff_failed` **solo en el log local** (`operator_updates.py:307`), nada
lo publica al relay y nada lo reintenta (`grep job_handoff_failed` en el piloto:
solo el `event(...)` y su test). La superficie lee **solo** la wire, así que un
traspaso que sí ocurrió y cuya proyección falló se dibuja como estado **VACÍO**,
y el vacío dice «La fuente respondió que no hay traspasos registrados». El
docstring del propio test («never a silent gap the surface reads as 'no
handoff'») describe una garantía que el sistema no da: el hueco sí es silencioso
en la superficie.
- **Repro:** leer `operator_updates.py:307` (evento local) + `towerBuzzSource.getHandovers` (lee solo el filtro de relay) + el texto del `HandoverEmptyState`; `sqlite3 pilot.db "SELECT COUNT(*) FROM events WHERE action='job_handoff_failed'"` (consumido por nada).
- **Esperado vs actual:** esperado, que la superficie distinga «no hay relevos»
  de «hay relevos cuyo registro no llegó»; actual, ambas se dibujan igual.
- **Aceptar un arreglo exige:** o publicar al wire un hecho de fallo que la fila
  pueda mostrar (o el vacío declara que su silencio también cubre una proyección
  fallida), o un test que falle hoy y pase con esa distinción. Regla de la casa
  #1 se cumple a medias (hay registro durable) pero la #6 («un guard que
  esconde la única recuperación es fallo funcional») apunta en la misma
  dirección: no hay camino de reintento.

### F2 — MEDIO-BAJO. El vacío nombra una ventana que no lee
`buildHandoffEventFilter` (rama) construye `{kinds:[…43001-43006, 43007], "#p":[owner], limit:500}`
**sin `since`/`until`**. El texto del vacío dice «en la ventana de la sesión»; la
lectura real es «los 500 eventos más recientes del owner». La spec §3 VACÍO pide
periodo y canal impresos. No es una mentira de cero, pero sí una afirmación de
alcance no sostenida por el filtro.
- **Repro:** leer el filtro y el literal `HandoverEmptyState`.
- **Aceptar:** imprimir el ámbito real (o el periodo exacto del filtro).

### F3 — BAJO. La rama de carga no mantiene la cabecera de cinco columnas
`HandoverLoadingState` pinta un `grid sm:grid-cols-5` de esqueletos **sin** la
cabecera de columnas. La spec §3 CARGA: «la cabecera de cinco columnas
permanece visible». Impacto bajo (la línea «Leyendo los relevos…» sí está).
- **Repro:** leer `HandoverLoadingState`; render de carga en §2.

### F4 — BAJO. La columna del padre imprime el id crudo como etiqueta principal
`HandoverRowItem` columna 3 muestra `row.sender.jobId`. La spec (regla 5) pide
referencias resueltas. En el piloto los ids son slugs legibles
(`tower-arquitecto`), así que no es hex ni pubkey, pero el nombre del encargo del
padre no se resuelve. La columna del hijo **sí** mejoró: ahora resuelve el rol
desde los eventos del hijo y solo cae a `Rol sin registrar` cuando no lo publicó
(probado en «the receiver cell names the child's own role»).
- **Repro:** leer el fold y la celda.

### F5 — NO VERIFICADO (hueco declarado por el autor, **confirmado por datos**). La emisión nunca se ejecutó contra un relay
`pilot.db` en solo-lectura: `handoff_published = 20` (hechos locales),
`job_handoff_published = 0`, `job_handoff_failed = 0`. El emisor nuevo **no ha
corrido nunca en vivo**; los 179 `job_event_published` prueban que el canal de
escritura del ciclo de vida sí funciona, pero **no** que un 43007 se admita y se
relea de ida y vuelta. La coincidencia de etiquetas productor/lector
(`--owner`→`p` (`jobs.rs:149`), `--channel`→`h`, `--job`/`--role`/`--child`) la
verifiqué **por lectura del código**, no por un evento real.
- **Qué falta para cerrarlo:** una ejecución de un padre `maestro` con hijos y
  una lectura desde Tower con `#p`=viewer; o, más barato, publicar un 43007 con
  el CLI y releerlo.

### F6 — Informativo / pre-existente. El cero fabricado sigue
`towerJobFold.ts:96` mantiene `blocked:{count: failed?1:0, basis:"observed"}` y
`PortfolioRow` lo dibuja. Fuera de este slice (el commit no toca ese fichero en
esta parte), pero el brief pedía arreglarlo antes de dibujar bloqueo, y la
cartera está en la misma pantalla que la sección nueva.

---

## 6. Lo que NO ejercí (dicho, no implicado)

- **No levanté relay.** Ningún 43007 publicado y releído de ida y vuelta. La
  admisión de escritura la verifiqué **por lectura** de `ingest.rs:557`
  (`KIND_JOB_HANDOFF => MessagesWrite`), no ejecutando el test de relay.
- **No corrí tests de Rust** (`cargo`): ninguna salida de `buzz-cli`/`buzz-relay`
  en este documento es mía. Las cifras de `cargo` que cita el mensaje del commit
  `cd13a9a4f` no las re-ejecuté.
- **No render nativo.** `renderToStaticMarkup` es render headless a cadena; no
  mide foco, orden de tabulación, lector de pantalla ni responsive. **No es
  cobertura nativa.**
- **No medí los 400 ms** ni el tiempo real de carga.
- **No probé la interrupción** (no existe el botón) ni la celda de bloqueo del
  relevo (no existe en la fila).
- **No ejecuté `biome check`** ni el `unittest discover` agregado.
- **Procedencia:** §1–§3 son ejecución mía; §4 son ejecuciones mías o lectura de
  línea; §5 F1–F4 y F6 son lectura de línea (F1 además con `grep` y `sqlite`);
  F5 es ejecución de `sqlite` en solo-lectura. Las mutaciones se aplicaron en un
  worktree detached mío, borrado; la rama `agent/coder-dispatch` no se tocó
  (`coder-dispatch` sigue limpio en `7e56ef224`).

---

## 7. Handoff

**Decisión que se debe (producto, no revisor):** F1 — ¿la superficie distingue
«no hay relevos» de «hay relevos cuyo registro no llegó», o el vacío declara que
su silencio también cubre una proyección fallida? De esa respuesta dependen el
texto del vacío, el contrato del productor y un test nuevo.
**Deuda de verificación:** F5 — sin una ejecución real contra relay, «la
superficie dibuja datos reales» sigue sin estar probado; es lo primero que
rompería en producción y lo más barato de cerrar.
**Puertas:** 1 y 2 aprobadas para la fila y sus estados; **3 no aprobada**
(F1 sin resolver; F5 declarada). F2–F4 son pulido de la propia superficie.
**Artefacto:** este fichero, `reviews/relevo-veredicto.md`; código revisado en
`agent/coder-dispatch@7e56ef224`. Sin push, sin merge, sin PR, sin deploy.
