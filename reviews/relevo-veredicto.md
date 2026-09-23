# El relevo — veredicto de revisión (revisor, ejecutando, no leyendo)

**Artefacto revisado:** rama `agent/coder-dispatch`, commit
`aa1fc86c4af221bb2e855e320a6ab2e58e69c927` «feat(tower): show agent handoffs end
to end» (16 ficheros, +1042/−25), más su base `59b9d8eff`.
**Método:** riesgos derivados del requisito ANTES de leer el commit; después los
tests del coder EJECUTADOS, tres mutaciones de guard, y un sondeo propio de la
rama de error con datos previos.
**Veredicto corto:** el camino feliz existe, está probado y sus guardas son
falsables (3/3 mutaciones hacen fallar un test). **No apruebo la puerta 3**: con
los datos que produce hoy el piloto la sección dirime un caso que no puede
distinguir (F1), y un refresco fallido sobre filas existentes es invisible (F2,
ejecutado).

---

## 1. Riesgos derivados del requisito (a ciegas)

Requisito literal: «hacer **visible** e **interrumpible** el traspaso entre
agentes», con las reglas de la casa (la UI no conoce Relay/Nostr/kinds; no se
dibuja botón sin efecto; si el dato no distingue dos estados, la superficie lo
dice). Cada riesgo lleva la observación que lo mata.

| # | Riesgo | Observación que lo mata | Resultado |
|---|---|---|---|
| R1 | Estado inventado (`blocked` derivado de `failed` con `basis: observed`) dibujado en la fila | trazar cada estado visible hasta su productor | **No en esta fila** (no dibuja bloqueo); el defecto sigue vivo en el plegado, F7 |
| R2 | La superficie confunde vacío / error / cargando (un fallo pintado como «no hay») | forzar reject y exigir rama de error | **Cubierto** por par de tests ejecutados (§3) |
| R3 | El traspaso no llega al canal nativo (sin `h`, sin hilo, sin `p`) | publicar y leerlo como mensaje nativo | **NO EJERCIDO**: no levanté relay; el hilo no se emite por diseño (F5) |
| R4 | La UI aprende Relay/Nostr/kinds | grep: `features/tower/{ui,domain}` no importa `constants/kinds` | **Cumplido**: el kind solo vive en `shared/api/towerHandoffEdges.ts` |
| R5 | Botón sin efecto («Interrumpir») | pulsarlo a mitad de run y ver parar el run | **Cumplido por omisión**: no existe tal botón (`grep -i "interrumpir\|pausar" features/tower` → 0). La mitad «interrumpible» del encargo NO está entregada |
| R6 | Fallo que solo se ve si miras la consola (R6 del armazón) | refresco fallido **con filas en pantalla** | **FALLA**: ejecutado, la tabla vieja se pinta y el error no (§2, F2) |
| R7 | Texto en px (zoom muerto) | `pnpm check:px-text` | **Cumplido**: exit 0 |
| R8 | El vacío nombra una ventana que no ha leído, o confunde «no hay filas» con «no hay productor» | leer el texto del `EmptyState` contra el estado real del productor | **FALLA**: F1 |

---

## 2. Sondeo propio: R2 y R6 ejecutados

Script nuevo **mío** (temporal, ejecutado con el loader del repo, borrado
después; `git status` limpio). Constructo el snapshot de React Query con
`isError: true` y `data` con una fila:

```
PHASE= unreachable LINES= 1 FAILURE= {"code":null,"message":"relay unreachable"}
ERROR_SHOWN= false
EMPTY_SHOWN= false
STALE_TABLE_SHOWN= true
ANNOUNCE= No se pudo leer el registro de relevos
```

Esperado (armazón R6, `especificacion-seccion-armazon.md` / spec §3 R6): aviso
fijo **encima** de la lista vieja, con cuándo se leyó y el único «Reintentar» de
la rama. Actual: la lista vieja se pinta **sin ningún aviso visible**; el único
aviso es `sr-only`. La spec de diseño declaró R6 «fuera del encargo, para que el
coder no lo invente», así que esto es riesgo residual **aceptado por diseño y no
cubierto**, no una desviación oculta.

El par vacío ≠ error **sí** está ejercido en las dos direcciones por los tests
del coder (empty→`EmptyState`, reject→`Alert` con `adapter_unavailable`) y por
el contrato del puerto: `getHandovers` **rechaza**, no resuelve `[]`.

---

## 3. Salida real de los tests del coder (ejecutados, no leídos)

`cd desktop && node --import ./test-loader.mjs --experimental-strip-types --test
src/shared/api/towerHandoffEdges.test.mjs src/features/tower/ui/handoverRender.test.mjs`

```
✔ real handoff edges render as rows, not as empty or error
✔ a successful empty read renders the empty state, not the error state
✔ a failed read renders the error state, not the empty state
✔ loading renders a skeleton, never the empty state's copy
✔ one handoff event is one row, keyed by the parent→child edge
✔ fan-out to two children is two rows, never one row per parent
✔ the sender is the emitter of the handoff, not the child's role
✔ the parent's terminal outcome is joined from its own lifecycle event
✔ a failed parent is distinguished from a finished one by outcome, not color
✔ a cancelled parent is its own outcome, not folded into failed
✔ an unreadable parent end is `unknown`, never a fabricated outcome
✔ an edge with no child is dropped, not drawn as a half row
✔ an edge with no parent job is dropped
✔ kinds outside the handoff and terminal sets are ignored
✔ malformed events degrade instead of crashing the fold
✔ the thread carries the channel but not a thread id it was never given
✔ no channel is 'sin hilo', distinguishable from an unopenable thread
✔ an unreadable instant is null, never 'now'
✔ rows are newest first
✔ the relay filter names its kinds explicitly and scopes to the owner
ℹ tests 20  ℹ pass 20  ℹ fail 0
```

Otras ejecuciones (todas desde el worktree del coder, con
`CARGO_TARGET_DIR=…/sapira/cargo-target`):

| Comando | Salida |
|---|---|
| `node --test src/features/tower/**/*.test.mjs src/shared/api/tower*.test.mjs` | `tests 84 · pass 84 · fail 0` |
| `pnpm check:px-text` | exit 0 (sin hallazgos) |
| `pnpm typecheck` | exit 0 |
| `cargo test -p buzz-cli a_handoff` | `3 passed; 0 failed; 489 filtered out` |
| `cargo test -p buzz-relay the_job_protocol_kinds_are_admitted` | `1 passed; 0 failed; 1137 filtered out` |

---

## 4. Test de mutación del guard (hecho, no supuesto)

Cada mutación se aplicó con `perl -0pi`, se ejecutó, y se restauró con
`git checkout --`; el sha256 volvió a coincidir y `git status --porcelain` quedó
vacío en los tres casos.

| Guard mutado | Fichero:línea | Resultado |
|---|---|---|
| `\|\| childJobId === null` eliminado del fold de aristas | `desktop/src/shared/api/towerHandoffEdges.ts:105` | **FAIL**: `an edge with no child is dropped` — actual `[{ id: 'p1->null', … }]`, esperado `[]` (dibuja media fila) |
| `if state == HANDOFF_STATE {` → `if false && …` en `resolve_child` | `crates/buzz-cli/src/commands/jobs.rs:111` | **FAIL ×2**: `a_handoff_requires_a_child` (panicked jobs.rs:409) y `a_handoff_carries_the_child_tag_on_the_wire` |
| `\| KIND_JOB_HANDOFF` eliminado del match de scope | `crates/buzz-relay/src/handlers/ingest.rs:558` | **FAIL**: `the_job_protocol_kinds_are_admitted` — `left: None, right: Some(MessagesWrite)` en ingest.rs:4061 |

Conclusión del paso 2: los guards están **atados a la costura de producción**
(el fold, el CLI y el relay), no a ayudantes de test. Quitar cualquiera de los
tres hace fallar un test.

---

## 5. Hallazgos, por impacto

### F1 — ALTO (producto): el vacío afirma lo que no puede saber
`HandoverEmptyState` (literal): «No hay ningún relevo en esta ventana» + «La
fuente respondió que no hay traspasos registrados en la ventana de la sesión».
**El productor del 43007 desde el piloto no existe** — lo dice el propio mensaje
del commit («the producer that emits 43007 from the pilot is not part of this
change»). Por tanto, en producción la sección **siempre** dirá que no hay
relevos, y eso es ausencia de **productor** dibujada como ausencia de **filas**.
`design/handover-slice1-spec.md` §5 ya lo había declarado decisión de producto
pendiente: «Las dos frases no son intercambiables». El test del coder
(`a successful empty read renders the empty state`) **codifica la frase
equivocada como correcta**, así que pasará en verde hasta que alguien cambie el
texto. Repro: leer el literal y cruzarlo con el alcance declarado del commit.
Aceptar un arreglo exige: o (a) el vacío dice «el traspaso es sin señal en esta
versión» mientras no exista emisor, o (b) el emisor existe y el vacío puede
afirmar «no hay relevos en la ventana». Sin una de las dos, es la celda central
mintiendo.

### F2 — MEDIO: refresco fallido sobre filas existentes, invisible
Ejecutado (§2). `ERROR_SHOWN=false`, `STALE_TABLE_SHOWN=true`; solo un
`aria-live` `sr-only`. El operador ve filas viejas presentadas como actuales sin
saber que la lectura falló. Repro: ver §2. Aceptar un arreglo exige el aviso
R6 (no descartable, encima de la lista, con `lastSuccessAt` y un único
«Reintentar»); y un test nuevo que falle sin ese aviso.

### F3 — MEDIO-BAJO: el vacío no nombra la ventana
La spec (R7) exige periodo y canal en texto. El coder dice «la ventana de la
sesión». Cumple «nunca un 0», pero no cumple «la ventana se nombra»: el
operador no puede saber qué intervalo se leyó. Acepta: fechas + canal impresos.

### F4 — BAJO: la rama de carga no tiene línea visible
La spec §0/§3 pide una línea de texto **visible** por estado. Aquí la carga
pinta solo esqueletos y su frase vive en `sr-only` (leído en fuente:
`HandoverSection.tsx` `HandoverLoadingState` + `announcementFor`). No lo
rendericé visualmente; es lectura de fuente, no observación.

### F5 — BAJO: «Dónde se discutió» no enlaza al hilo
La spec §1 nombra `Button variant="link" (asChild)` + `Badge`. El coder pinta el
canal como texto mono y «el hilo no se pudo abrir (el id del hilo no se
publica)». Es **honesto** (un enlace muerto sería peor y la regla de la casa
prohíbe el control sin efecto), pero el encargo «va al hilo existente» queda no
entregado hasta que el productor emita el id del evento.

### F6 — BAJO: la referencia del hijo no se resuelve
`child.name` es `null` incondicional en el fold y la celda pinta el id crudo
(`row.child.jobId`). La spec §2 regla 5 pide referencias resueltas, nunca ids.
Acepta: leer el nombre del hijo de sus propios eventos, o decir «sin nombre
registrado» en vez de presentar un id como etiqueta.

### F7 — INFORMATIVO / PREEXISTENTE: el cero fabricado sigue
`desktop/src/shared/api/towerJobFold.ts:96` sigue con
`blocked: { count: failed ? 1 : 0, basis: "observed" }` (leído en fuente; el
commit **no toca ese fichero** — `git show --stat`). La sección de relevo no
dibuja bloqueo, así que este slice no lo propaga; pero la cartera encima de ella
sigue pudiendo pintar «N blocked» con `basis: "observed"` sobre esa inferencia.
El brief pedía arreglarlo **antes** de dibujar la celda de bloqueo: sigue sin
arreglar.

---

## 6. Lo que NO ejercí (dicho, no implicado)

- **No levanté relay**: ningún 43007 real publicado y releído ida y vuelta. Todo
  lo del relay es el test unitario de scope; la admisión de lectura (filtro del
  desktop contra el p-gate) no la probé.
- **No render nativo**: `renderToStaticMarkup` es render headless de React a
  cadena. **No es cobertura nativa** ni mide foco, orden de tabulación, lector de
  pantalla ni responsive.
- **No medí los 400 ms** ni el tiempo de carga: no hay instrumentación ni
  `performance` en mi ejecución.
- **No probé la cancelación/interrupción**: no hay botón y no hay productor de
  pausa; la mitad «interrumpible» del encargo queda declarada fuera.
- **Procedencia**: F4–F7 son lectura de fuente; F1 es lectura de fuente + del
  mensaje del commit; F2 y todo el §3–§4 son ejecución. Lo único que ejecuté
  fuera de los tests del coder es el sondeo temporal de §2, borrado después.

## 7. Handoff

**Decisión que se debe:** ratificar la frase del vacío (F1) — ¿«no hay relevos
en la ventana» con emisor que existe, o «traspaso sin señal» mientras no exista?
De esa decisión depende el texto, el `title` del vacío y el test del par
vacío≠error. **Bloqueador de la siguiente puerta:** F2 necesita aviso R6 + test.
**Artefacto:** este fichero, `reviews/relevo-veredicto.md`; el código revisado en
`agent/coder-dispatch@aa1fc86c4`. Sin push, sin merge, sin PR, sin deploy.
