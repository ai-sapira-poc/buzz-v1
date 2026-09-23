# El panel — veredicto independiente (revisor, ejecutando)

**Artefacto revisado:** rama `agent/coder-dispatch`, commit
`b3f8cff38f066773b5c87604cd7445cdf3a98685` «feat(panel): record a job at rest
and draw the workforce list» (un commit sobre `origin/main` `0f09f854f`, que ya
contiene el PR #7 de aristas de relevo, `e2319442d`).
**Método:** riesgos derivados del requisito (`architecture/panel-frontera-v1.md`
§7) **antes** de leer el cierre del autor; después los tests del PR ejecutados en
un worktree detached propio (`/tmp/panel-rev`, HEAD = `b3f8cff38`), cuatro
mutaciones de guard ejecutadas y restauradas con verificación de sha256, un
sondeo de render propio para los casos 5 y 7, y la CLI real ejecutada.

## Veredicto corto: **ACEPTAR** — el slice funciona de punta a punta **en proceso**;
la única pata no ejercida es un relay vivo, que el autor declara.

| Puerta | Estado | Base |
|---|---|---|
| 90 % — el camino funciona y tiene tests | **PASA** | 6727/6727 desktop, 22/22 CLI, 1/1 core, 1/1 relay, 30/30 piloto, todos reproducidos por mí |
| 7 % — casos límite e integración | **PARCIAL** | casos 1–7 con test; **el texto exigido del caso 5 no se dibuja** (F1); casos 8 y 9 declarados sin test |
| 3 % — experiencia del operador | **PASA, con un defecto de idioma** | vacío/carga/error con texto, cabecera en carga, «sin señal» con el porqué, ninguna celda `blocked`; el rol ausente sale «Unnamed agent» (F2) |

**Dos condiciones para dejarlo listo para operador** (no invalidan el slice, sí lo
incompletan): F1 (el texto del caso 5) y F3 (el `43008` no está en la lista de
exclusión de no-leídos). El resto son residuales declarados (F5–F8).

> **Corrección de premisa, primero.** El encargo dice «el PR de panel-coder-r2».
> **El PR no existe**: el coder no pudo abrirlo (`python3 -m control_plane.agent_delivery`
> no existe en su entorno) y no hace push. Lo que reviso es el **commit** en la
> rama local/remota `agent/coder-dispatch`. Y `reviews/panel-riesgos.md` no está en
> este worktree: el artefacto real es `artifacts/reviews/panel-riesgos.md` (lo cito
> por ese path). Ninguna de las dos cosas cambia el trabajo, pero cambia quién
> puede actuar sobre el resultado.

---

## 1. Tests del PR — ejecutados, salida literal

Worktree `/tmp/panel-rev` (detached en `b3f8cff38`), `node_modules` enlazado al
del coder. Todo lo de abajo lo corrí yo; no lo leí.

| Comando | Salida | Coincide con el autor |
|---|---|---|
| `node --import ./test-loader.mjs --experimental-strip-types --test src/features/panel/domain/panel.test.mjs src/features/panel/ui/panelRender.test.mjs src/shared/api/towerJobWaiting.test.mjs src/shared/api/towerBuzzSource.test.mjs src/features/tower/ui/towerPortIsolation.test.mjs` | `ℹ tests 42 · pass 42 · fail 0` | sí («42 pass») |
| `node … --test "src/**/*.test.mjs"` (suite completa desktop) | `ℹ tests 6727 · pass 6727 · fail 0` | sí |
| `cargo test -p buzz-core no_duplicate_kind_values` | `test kind::tests::no_duplicate_kind_values ... ok · 1 passed` | sí |
| `cargo test -p buzz-cli commands::jobs` | `22 passed; 0 failed` (incluye `a_waiting_event_maps_to_the_waiting_kind`, `a_waiting_event_requires_a_reason`, `waiting_is_not_one_of_the_six_lifecycle_states`) | sí |
| `cargo test -p buzz-relay the_job_protocol_kinds_are_admitted` | `test handlers::ingest::postgres_tests::the_job_protocol_kinds_are_admitted ... ok · 1 passed` | sí |
| `python3 -m unittest test_controls` | `Ran 30 tests … OK` | sí |

`cargo fmt`, `clippy`, `tsc`, biome no los re-ejecuté por separado; la suite
desktop y los tests Rust que sí corrí cargan y compilan el código mutado, que es
la parte con cobertura real.

---

## 2. Falsación de guardas — ejecutada, con restauración verificada

Las cuatro mutaciones en `/tmp/panel-rev`; `git checkout -- <file>` + sha256
idéntico al de HEAD tras cada una; `git status` limpio al final.

| # | Guard mutado | Fichero | Test que falla | Salida literal |
|---|---|---|---|---|
| A | `\| KIND_JOB_WAITING` quitado del brazo | `crates/buzz-relay/src/handlers/ingest.rs:561` | `the_job_protocol_kinds_are_admitted` | `assertion left == right failed: kind 43008 should require MessagesWrite scope · left: None · right: Some(MessagesWrite)` → `FAILED` |
| B | regla de borrado quitada | `desktop/src/shared/api/towerJobWaiting.ts:135` | `towerJobWaiting.test.mjs` | 4 fallos: «a wait beaten by a lifecycle event in the same second», «…a later lifecycle event», «…a newer terminal», «getPortfolio does not attach a wait a later movement beat» → `pass 10 · fail 4` |
| C | `const MUTANT_KIND = 43008;` en UI del panel | `desktop/src/features/panel/ui/PanelSection.tsx` | `towerPortIsolation.test.mjs` | `AssertionError: PanelSection.tsx: names a raw agent-job kind number` → `pass 0 · fail 1` |
| D | `[43008, "running"]` en `STATE_BY_KIND` | `desktop/src/shared/api/towerJobFold.ts:45` | `getPortfolio reports an orphan wait as a line instead of losing it` | `pass 38 · fail 1` (ver F4: cobertura incidental, no un guard de diseño) |

La A es la que el autor «daba por inferida»: **no hizo falta inferirla, falla**.
La B confirma los 4 tests que él declaró. La C es la extensión a `features/panel/ui`.

**CLI real, no solo la costura unitaria** (`./target/debug/buzz jobs publish …`, built from HEAD):

```
--state waiting --job j1 --owner owner
 → {"error":"user_error","message":"a waiting event names its reason: --reason is required with --state waiting","retryable":false}  exit=1
--state waiting … --reason stuck
 → {"error":"user_error","message":"unknown reason 'stuck'; expected one of: ladder_exhausted, capability_denied",…}  exit=1
--state result … --reason ladder_exhausted
 → {"error":"user_error","message":"reason names why a job is waiting; it is only meaningful with --state waiting",…}  exit=1
--state waiting … --reason capability_denied
 → pasa la validación de razón; falla por el owner de prueba ("must be a 64-character hex string")  exit=1
```

---

## 3. Los nueve casos límite de §7

| # | Caso | ¿Ejercido? | Evidencia |
|---|---|---|---|
| 1 | espera + ciclo de vida posterior, mismo segundo | **sí** | `towerJobWaiting.test.mjs`; mutación B lo tumba |
| 2 | idem, segundo posterior | **sí** | idem |
| 3 | dos esperas, gana la más nueva, una celda | **sí** | `two waits of one job yield one entry: the newest wins` |
| 4 | espera + `done` más nuevo → `null`, estado `done` | **sí** | `a wait beaten by a newer terminal is dropped` |
| 5 | huérfano: `43008` sin ciclo de vida en la ventana | **el dato sí; el texto exigido NO** | fold + `getPortfolio reports an orphan wait as a line`; render propio muestra que no aparece «sin actividad en la ventana» → **F1** |
| 6 | sin `reason` o fuera de vocabulario → se descarta y se cuenta | **sí** | 3 tests (`dropped = 1`) |
| 7 | `role` que no viaja | **dato sí; texto divergente** | test de fold `role = null`; en superficie sale «Unnamed agent» (inglés) → **F2** |
| 8 | truncación por `limit 500` | **no** | declarado no cubierto por el autor y por el arquitecto; sin señal en la respuesta |
| 9 | relay rechaza `43008` | **no** | F1 heredado; el fallo local vive en el log del piloto, la superficie queda «sin señal» |

**Regla de borrado verificada como semántica central:** `towerJobWaiting.ts:135`
`if (moved !== undefined && moved >= entry.at) continue;` — el empate lo gana el
movimiento. Mutación B: quitarla y 4 tests fallan.

---

## 4. Contraste con `artifacts/reviews/panel-riesgos.md` — qué quedó abierto

| Riesgo (ciego) | Estado tras ejecutar |
|---|---|
| R1 celda `blocked`←`failed`, con guardián test | **La parte del panel, cerrada**: `features/panel` no renderiza `blocked` (grep + test `the panel never renders a blocked cell`). El defecto de Tower **sigue vivo** y fijado por `towerBuzzSource.test.mjs:79` → residual F6 |
| R2 fallo pintado como vacío | **cerrado**: `a failed read is drawn as an error, never as empty` |
| R3 cifra sin ventana | **cerrado**: solo el conteo de filas en un `aria-live`; sin métrica |
| R4 «trabaja» sin cualificar | **cerrado**: la celda antepone «Último evento publicado» |
| R5 productor inexistente | **cerrado**: `kind.rs:539` + `ingest.rs:561` + `jobs.rs` + `pursue.py` |
| R6 fallo de publicación invisible | **abierto, heredado** (F5): best-effort, evento local `waiting_failed`; no cruza a superficie |
| R7 semántica ladder≠persona | **cerrado + falsador §8.1 ejecutado**: `rg question|ask_operator|awaiting|human_decision` no devuelve productor (solo prosa); §8.2: `supervisor.retry` (`supervisor.py:370`) **no tiene llamante automático**, y `recover_stale_pi_leases` solo requeuea leases Pi vencidos |
| R8 staleness | casos 1–7 cerrados; 8/9 declarados |
| R9 relay rechaza el kind | guard falsado (mutación A) |
| R10 guard no cubría número crudo ni panel | **cerrado**: `towerPortIsolation.test.mjs:20,30`; falsado (mutación C) |
| R11 `STATE_BY_KIND` sin test | **parcial** → F4 |
| R12 número en cinco sitios sin atar | **abierto** → F8 |
| R13 `43008` infla el no-leído | **abierto, sin tocar** → F3 |
| R14 vacío sin ventana | **cerrado**: `PanelEmptyState` nombra la ventana |
| R15 esqueleto sin cabecera | **cerrado**: `PanelLoadingState` conserva `PanelHeader` |
| R16 error sustituye la lista | **cerrado**: `PanelStaleBanner` conserva filas |
| R17 «sin señal» vs «nada» | **cerrado**: `WaitingCell` |
| R18 truncación | declarado |
| R19 «de dónde vino» sin arista | **cerrado**: PR #7 ya en `origin/main` |

---

## 5. Honestidad de superficie — comprobada renderizando, no leyendo

Soné `PanelSection` con `renderToStaticMarkup` sobre eventos reales del adaptador.
Texto visible de una fila huérfana:

> `architect orphan-1 sin tarea declarada Último evento publicado · 20719 d ago
> sin padre registrado sin resultado registrado Espera registrada capability_denied
> El encargo necesita una capacidad que el agente no tiene. Desde 1970-01-01T00:16:40.000Z … sin hilo`

- **Ninguna celda en blanco**: cada ausencia tiene texto (`sin tarea declarada`,
  `sin padre registrado`, `sin hilo`).
- **«sin señal» con el porqué**: `Sin señal` + `Sin señal de espera registrada.
  Esto no significa que nada espere.` — nunca `0`.
- **Ninguna fila renderiza `blocked`**: `grep -rn blocked desktop/src/features/panel/`
  solo aparece en comentarios y en el test que **prohíbe** el token; render con
  `blocked:{count:1,basis:"observed"}` → `doesNotMatch(html, /blocked/i)`.
- **`0 blocked` no aparece** en ningún output.

---

## Hallazgos

### F1 · El texto exigido del caso 5 no se dibuja — Media
- **Path:** `desktop/src/features/panel/ui/PanelRow.tsx` (la fila no distingue un
  huérfano); contrato `architecture/panel-frontera-v1.md` §7 caso 5.
- **Reproducción:** sondeo propio con `createTowerBuzzSource(async () => [un 43008 sin ciclo de vida])`
  → `HAS case5 sentence? false`; texto visible: «sin tarea declarada … Último
  evento publicado · 20719 d ago».
- **Esperado:** «espera registrada para un encargo sin actividad en la ventana».
  **Actual:** el huérfano se dibuja como una fila corriente; el operador no puede
  distinguir «espera sin actividad en la ventana» de «espera de un encargo activo».
- **Aceptar el cierre exige:** que la fila marque `work === null` con ese texto,
  y un test de render que lo afirme.

### F2 · El rol ausente sale «Unnamed agent», en inglés — Baja
- **Path:** `desktop/src/shared/api/towerBuzzSource.ts:107` (y el placeholder
  heredado `desktop/src/shared/api/towerJobFold.ts:91`); contrato §7 caso 7.
- **Reproducción:** sondeo con un `43008` sin tag `role` → `HAS 'Unnamed agent'? true`.
- **Esperado:** «sin rol registrado» (vocabulario del contrato, en español).
  **Actual:** literal inglés heredado del fold de Tower, en una superficie en español.
- **Aceptar el cierre exige:** usar el mismo texto español y un test que lo fije.

### F3 · Un `43008` con tag `h` infla el pill de no-leídos — Media-Baja
- **Path:** `desktop/src/shared/constants/kinds.ts:166-178` — `NON_CONVERSATIONAL_UNREAD_KINDS`
  lista 43001–43006 y **no** `KIND_JOB_WAITING`; `isConversationalUnreadKind` (`:184`)
  es lista de exclusión.
- **Reproducción:** el productor publica con `--channel` cuando
  `BUZZ_PUBLISH_CHANNEL` está puesto (`operator_updates.py:publish_waiting`), y el
  flujo §4.4 del arquitecto admite `[h]`. Con `h`, el evento se cuenta como
  conversacional → «1 no leído» por un hecho que no es conversación.
- **Esperado:** los eventos del protocolo de encargos no cuentan. **Actual:** cuentan.
- **Aceptar el cierre exige:** añadir `KIND_JOB_WAITING` a esa lista (decidir
  explícitamente si se renderiza en el timeline) y un test de `isConversationalUnreadKind`.
  Nota: el mismo hueco lo tiene ya `KIND_JOB_HANDOFF`.

### F4 · `STATE_BY_KIND` solo está guardado de forma incidental — Baja
- **Path:** `desktop/src/shared/api/towerJobFold.ts:45`.
- **Reproducción:** mutación D (`[43008, "running"]`) → falla **1** test, y lo hace
  por un efecto colateral (el huérfano deja de ser huérfano), no por un guard que
  nombre el invariante.
- **Esperado:** un test que afirme «el 43008 no pliega como estado».
  **Actual:** no existe; R11 del informe ciego sigue abierto en su forma dura.
- **Aceptar el cierre exige:** un assert directo sobre `STATE_BY_KIND` o sobre el
  fold con un 43008.

### F5 · Relay vivo no ejercido y fallo de publicación invisible (residual declarado) — Alta como límite, aceptada
- **Path:** `experiments/buzz-autonomy/operator_updates.py:publish_waiting` (best-effort,
  `waiting_failed` local); `reports/handover-review.md` §4 F1.
- **Estado:** el productor está probado con `buzz` mockeado, no contra un relay; un
  rechazo del relay deja la superficie en «sin señal» idéntica a «nada espera». Es
  exactamente el caso 9, declarado sin test por autor y arquitecto.
- **Qué requiere:** un `43008` real contra un relay, y que el fallo de publicación
  sea visible en la superficie o, como mínimo, un test que pruebe que la celda no
  afirma ausencia sobre una publicación fallida.

### F6 · El guardián de R1 sigue vivo en Tower (no en el panel) — Baja como residual
- **Path:** `desktop/src/shared/api/towerBuzzSource.test.mjs:79` afirma
  `blocked: { count: 1, basis: "observed" }` para un `failed`; `towerJobFold.ts:96`
  deriva la celda de `failed`.
- **Estado:** el panel **no lo hereda** (verificado). Retirar la celda de Tower
  sigue rompiendo CI mientras ese test viva. Fuera del alcance del slice, pero es
  deuda que el panel decidió no arrastrar.

### F7 · Desviación de §7.3 (`waiting` fuera de `STATES`) — Baja, aceptada
- **Path:** `crates/buzz-cli/src/commands/jobs.rs:52,63`; test `:519-522` fija
  `STATES.len() == 6`.
- **Estado:** el contrato pedía meter `("waiting", 43008)` en `STATES`; el coder lo
  dejó fuera para no romper «exactamente seis estados de ciclo de vida». El contrato
  externo (`--state waiting` + `--reason` obligatorio) se cumple y lo verifiqué con
  la CLI real. Acepto la desviación; el razonamiento es correcto y no hay consumidor
  de `STATES` que la necesite dentro.

### F8 · El número del kind vive en varios sitios sin guard cross-lenguaje — Baja
- **Path:** `kind.rs:539`, `kinds.ts:40`, `ingest.rs:561`, `jobs.rs:52`.
- **Estado:** `kinds.ts` es «el único sitio con el número» **en el front**, pero
  nada compara las constantes Rust con las TS. Una divergencia silenciosa entre las
  dos mitades es el modo de fallo que C2 («el kind ES el estado») existe para
  impedir. Sin cambios respecto al informe ciego (R12), no bloquea este slice.

---

## Qué NO ejercité (dicho, no implicado)

- **Ningún relay vivo**: no publiqué un `43008` real, no autentiqué, no levanté
  Postgres/Redis. La admisión del relay la probé mutando el brazo (A), no con un
  evento real.
- **Ningún navegador ni app renderizada**: el render es `renderToStaticMarkup` en
  Node sobre las secciones; **no** abrí la superficie Tauri, no miré zoom, foco ni
  lector de pantalla. No etiqueto esto como cobertura nativa.
- **Ningún test E2E del desktop** (`playwright`/mock-bridge) ni `just ci`.
- **`pursue.py` no se ejecutó**; la cadena del productor la vi por sus tests con
  `buzz` mockeado y por la CLI real, no por un ciclo del piloto.
- Los casos 8 y 9, declarados por el autor, no los cerré.

## Handoff

- **Al implementador:** cerrar F1 (texto del caso 5) y F3 (`43008` fuera del
  no-leído) antes de considerar el panel listo para operador. F4 es barato. F2 es copy.
- **A quien tenga `control_plane.agent_delivery`:** el PR **no está abierto**; la
  rama es `agent/coder-dispatch` @ `b3f8cff38`. Este veredicto no lo abre.
- **Decisión que sigue siendo del director:** ratificar `KIND_JOB_WAITING = 43008`
  con `reason ∈ {ladder_exhausted, capability_denied}`, o posponer la celda de
  espera. La desviación §7.3 (F7) conviene que quede ratificada con la misma firma.
- **Confianza:** **alta** en los hechos ejecutados (tests, 4 mutaciones, CLI, render
  propio); **media** en F3, que es inferida del código y **no ejercida** con un
  evento `h` real.
