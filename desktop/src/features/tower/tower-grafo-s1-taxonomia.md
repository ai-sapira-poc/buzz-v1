# Tower Grafo S1 — taxonomía de estados de tarjeta y sus productores reales

**Rol:** arquitecto. **Encargo:** taxonomía de estados de tarjeta mapeada a
productores reales con `path:línea`. **Alcance:** S1 dibuja tarjetas, sin aristas.

**Base observada:** `main` = `ab63b012900def60a16ca39d32d3515a0be81e50`
(`git rev-parse main`, leído en la sesión). El informe previo de frontera
(`architecture/tower-grafo-frontera-v1.md`) citaba HEAD `3086ec28a`; comprobado
que es ancestro de este HEAD (`git merge-base --is-ancestor 3086ec28a HEAD` →
salida 0). **Todo lo de abajo es código en disco en ese HEAD**, salvo donde digo
lo contrario.

---

## 0. La premisa, corregida en las dos primeras frases

El encargo dice «legibles 43001-43006» y «bloqueado: sin productor». La primera
mitad es correcta **para el ciclo de vida**; la segunda es correcta para el ciclo
de vida y **falsa para la adyacencia**: en HEAD existen `43007` (arista de relevo)
y `43008` (encargo en reposo), y **`43008` sí tiene productor**
(`control_plane/pursue.py:529-530` → `operator_updates.publish_waiting`). `43008`
**no es «bloqueado» ni lo sustituye**: significa «el encargo está en reposo y el
siguiente movimiento es del operador», y hoy no está dibujado en ninguna
superficie. Por tanto la taxonomía correcta es: **cinco estados de ciclo de vida
legibles de 43001-43006**; `bloqueado` declarado «sin señal» y **no dibujado**; y
`43008` como estado **adyacente con productor pero sin superficie**, y **fuera de S1**
por decisión del maestro (2026-09-24, reversible): va a la slice siguiente, y solo
entra si su productor ha emitido al menos una vez **en vivo**.

Corrección adicional, porque afecta a lo que el coder puede asumir: la frontera
previa declaraba la admisión de las kinds de job en el relay como **no
committed** («working tree `ingest.rs`»). En este HEAD **está committed**:
`crates/buzz-relay/src/handlers/ingest.rs:554-561` mapea 43001–43008 a
`Scope::MessagesWrite` (`git show HEAD:crates/buzz-relay/src/handlers/ingest.rs`
lo devuelve; `git status` no marca ese fichero).

---

## 1. Procedencia

**Observado** = leído en el fichero con `cat -n` / `grep -n`, o comando y salida,
**en la base de la PR** (`main` = `ab63b0129`). **Inferido** = marcado como tal.
**No ejecuté el piloto** ni publiqué ningún evento contra un relay: no vi ninguna
de estas transiciones en vivo.

**Corrección de procedencia (defecto señalado por el revisor, arreglado aquí).**
En la primera versión leí `experiments/buzz-autonomy/operator_updates.py` del
**árbol de trabajo**, que entonces divergía de `main`: el diff no tocaba
`JOB_EVENT_STATE`, pero insertaba líneas en `result_header` (`git diff --numstat`
→ `14 2`), desplazando **+12** todo lo posterior. Concluir que las líneas «valen
igual» fue un *non sequitur* — no tocar un bloque no es no moverlo. Las citas de
los scripts del piloto están ahora fijadas a `main` y reproducen con
`git show ab63b0129:<fichero> | sed -n '<línea>p'`. Regla adoptada: **citar
siempre desde el commit que la PR entrega, nunca desde el árbol de trabajo.**

**Re-verificación de citas (rama `agent/tower-grafo-s1`; base `main` = `ab63b0129`).**
Comprobé una a una todas las
citas de este documento contra `main` (`ab63b0129`) con `git show ab63b0129:<fichero>
| sed -n '<línea>p'`. Dos defectos de la misma clase quedaron corregidos en esa pasada:
tres citas abreviadas de §2 (`:205`, `:207`, `:208`) apuntaban, tal como estaban
escritas, a líneas inexistentes de `towerJobFold.ts` (162 líneas) y ahora llevan el
nombre del fichero; y el llamador de `publish_delegation` está en `capabilities.py` de
la raíz del piloto, no en `control_plane/`. Las rutas del piloto son relativas a
`experiments/buzz-autonomy/`.

---

## 2. Taxonomía: los cinco estados de tarjeta legibles de 43001-43006

| # | Estado de tarjeta (`WorkState`) | Kind | Constante | Plegado | Productor del evento (state → kind) | Semántica |
|---|---|---|---|---|---|---|
| 1 | `requested` | 43001 | `desktop/src/shared/constants/kinds.ts:26` | `desktop/src/shared/api/towerJobFold.ts:33` | `created` (`operator_updates.py:203`) | pedido, sin arrancar |
| 2 | `running` (aceptado) | 43002 | `kinds.ts:27` | `towerJobFold.ts:34` | `started` (`operator_updates.py:204`) | aceptado |
| 3 | `running` (progreso) | 43003 | `kinds.ts:28` | `towerJobFold.ts:35` | `running` (`operator_updates.py:205`) **y `blocked` (`:209`)** | trabajando / **contaminado** |
| 4 | `done` | 43004 | `kinds.ts:29` | `towerJobFold.ts:36` | `done` (`operator_updates.py:206`) | entregado |
| 5 | `cancelled` | 43005 | `kinds.ts:30` | `towerJobFold.ts:37` | `cancelled` (`operator_updates.py:207`) | detenido por decisión |
| 6 | `failed` | 43006 | `kinds.ts:31` | `towerJobFold.ts:38` | `failed` (`operator_updates.py:208`) | no entregó |

Dos kinds colapsan en `running` (aceptado y progreso): la tarjeta tiene **cinco**
valores, no seis. Es una decisión del plegado, no un defecto. `requested` es fila
propia y distinta de `running` — `towerJobFold.ts:33` mapea `43001 → "requested"`,
no a `running`.

**Cadena de producción completa:**

| Eslabón | Dónde |
|---|---|
| El CLI acepta el estado y lo traduce a kind | `crates/buzz-cli/src/commands/jobs.rs:26-33` (`STATES`), `:58-78` (`kind_for`) |
| El piloto mapea su vocabulario al del CLI | `operator_updates.py:202-210` (`JOB_EVENT_STATE`) |
| El piloto emite el evento | `publish_job_event` `operator_updates.py:213-247` (args en `:230-232`) |
| Quién lo llama | `publish_update` `operator_updates.py:406-433` (llamada en `:422`) |
| Emisores de ciclo de vida | `_publish_lifecycle` `control_plane/launch_tower.py:190-221`; llamadas en `:287` (`started`), `:297` (`failed`/`cancelled`), `:301` (`cancelled`), `:303` (`done`), `:335` (`done`), `:348` (`started`), `:386` (`done`), `:396` (`failed`/`cancelled`), `:418` (`blocked`) |

**Regla de desempate (afecta a qué estado muestra una tarjeta):** el plegado elige
el evento **más nuevo** por `created_at`, y a igualdad de segundo desempata por
progresión del ciclo de vida (`towerJobFold.ts:46-52`, `:75-82`). Un `job` sin
tag `job` o con `created_at` no finito se descarta, no se adivina
(`towerJobFold.ts:120-127`).

---

## 3. «Bloqueado»: sin productor de ciclo de vida, y hoy llega como `running`

**No es un `WorkState`.** La unión de estados (`desktop/src/features/tower/domain/portfolio.ts:60-65`)
es `requested | running | done | failed | cancelled`; no hay miembro `blocked`. El
«bloqueado» de la superficie es una **celda aparte** (`PortfolioBlocked`,
`portfolio.ts:37-40`).

**Dos productores etiquetan `blocked`, y los dos toman el alias:**

- **(a) bloqueo de lanzamiento:** `control_plane/launch_tower.py:418`
  `_publish_lifecycle(role, job_id(role), "blocked", ...)`.
- **(b) bloqueo de delegación:** `operator_updates.py:449-457` (`publish_delegation`)
  → `publish_update(..., "blocked", ...)`; llamador `capabilities.py:513-515`.

Ambos entran por `JOB_EVENT_STATE["blocked"] = "progress"` (`operator_updates.py:209`)
→ kind **43003** → el plegado lo traduce a **`running`** (`towerJobFold.ts:35`). La
prosa dice «está esperando a una dependencia» (`operator_updates.py:394`) mientras
la máquina dice «trabajando». **Son dos caminos, no uno**; un arreglo del alias que
solo toque el lanzador dejaría el otro.

**La celda `blocked` del plegado committed fabrica un cero «observado».**
`towerJobFold.ts:96`:

```ts
blocked: { count: failed ? 1 : 0, basis: "observed" },
```

Para todo encargo no fallado la celda afirma «0 bloqueados, observado» — un cero
presentado como medición. El propio modelo neutro dice lo contrario:
`portfolio.ts:21-23` documenta que, sin productor mecánico, los adaptadores
**deben** devolver `basis: null` y la UI no debe fabricar la detección.

**Decisión (alineada con el producto): S1 no dibuja la celda de bloqueo.** Ni
«0 bloqueados» (falso-observado de `towerJobFold.ts:96`) ni «bloqueado»
(contaminado aguas arriba). Si el lienzo necesita nombrar el bloqueo, lo hace como
**«sin señal», texto propio y sin cifra**.

**Estado sin productor ⇒ «sin señal», no se dibuja.** El único bloqueo de runtime
intra-turno seguiría sin productor aunque se arreglase el alias; por eso, tras el
arreglo, la columna sigue valiendo «sin señal». El arreglo compra que la columna
**deje de mentir** en las dos filas que hoy llegan mal etiquetadas, no que se llene.

---

## 4. Adyacente con productor y sin superficie: `43008` (`waiting`)

No es un estado del ciclo de vida y **no es «bloqueado»**; se documenta porque el
encargo lo roza y porque el coder debe saber que existe y que no está dibujado.

| Pieza | Dónde |
|---|---|
| Kind | `kinds.ts:40`; CLI `jobs.rs:51-52`, `:62-64` |
| Productor | `control_plane/pursue.py:529-530` → `publish_waiting` `operator_updates.py:347-382` → `jobs publish --state waiting ... --reason ...` (`:365-367`) |
| Vocabulario cerrado de razones | `ladder_exhausted`, `capability_denied` (`operator_updates.py:320-323`; `towerJobWaiting.ts:29-32`) |
| Lector | `desktop/src/shared/api/towerJobWaiting.ts` (`foldWaitingForJob`); se une a la línea en `towerBuzzSource.ts:90-119` |
| Superficie | **ninguna**: `grep -rn "waiting" desktop/src/features/tower/ui/*.tsx` → sin salida |

**Decisión del maestro (2026-09-24, declarada reversible): `43008` no entra en S1.**
Se difiere a la slice siguiente con un requisito de entrada explícito — que su
productor haya emitido al menos una vez **en vivo** —, el mismo requisito que la arista
padre→hijo. Razón: S1 es el andamio del vocabulario de ciclo de vida y de la costura de
proyección; un estado adyacente sin superficie obliga a decidir su vacío y su foco antes
de que exista un encargo que los pida. Este documento deja de tener esa pregunta abierta.
No confundirlo con la celda de bloqueo: son cosas distintas.

---

## 5. Ausencias de **campo** (no de estado)

| Campo | Productor | Qué dice la tarjeta |
|---|---|---|
| **modelo** | ninguno en la lectura; `gen_ai.request.model` vive en el span de turno (`telemetry.py`), que no está vivo ni se lee | «no disponible» con la razón |
| **coste** | ninguno: `towerJobFold.ts:98` `cost: null` | «no disponible», **nunca `$0`**; ningún total |
| **profundidad** | la arista padre→hijo **existe y está mergeada** (`43007`, `kinds.ts:35`; PR #7 → `e2319442d`), pero queda **fuera de S1 por alcance** (aristas = S2) | la tarjeta se agrupa por `role`; no es «sin señal» ni «sin productor» |

---

## 6. Frontera de permiso y de transporte

- **Lectura acotada al owner:** `buildJobEventFilter` `towerBuzzSource.ts:46-57`
  — `kinds` explícitas (sin ellas el relay responde 403 por el p-gate), `#p` =
  owner, `limit 500` (`TOWER_JOB_EVENT_LIMIT`, `:34`).
- **Admisión de escritura del relay:** committed en `ingest.rs:554-561`
  (43001–43008 → `MessagesWrite`).
- **La UI no aprende kinds:** contrato en `towerJobFold.ts:18-21` y
  `towerBuzzSource.ts:30`.
- **El puerto rechaza en fallo, nunca `[]`:** `TowerSource.ts:9-13` y `:15-21`;
  el adaptador lanza `TowerSourceError("adapter_unavailable", ...)` en
  `towerBuzzSource.ts:144-176`.
- **Rendija residual (hallazgo del revisor):** `towerBuzzSource.ts:148` y `:165`
  hacen `events ?? []`. El `catch` cubre el **rechazo**, pero una fuente que
  **resuelva** `null`/`undefined` se convierte en `[]` y pinta «no hay trabajo»
  sobre una fuente muerta — justo lo que el puerto prohíbe. La superficie nueva
  no debe reabrirla: el adaptador debería rechazar si el resultado no es un array
  (`Array.isArray`), no convertirlo en vacío.

---

## 7. Lo que no se puede saber / no verificado

- **No ejecuté el piloto ni publiqué eventos contra un relay.** Todo es código en
  disco en HEAD `ab63b0129`.
- **No verifiqué que el relay desplegado admita 43001–43008**; solo que HEAD lo
  admite. Un relay viejo rechazaría la publicación (leído de informes previos, no
  reproducido).
- **El tag `trace` sigue sin emitirse** (inferido de la lectura):
  `publish_job_event` construye los args sin `--trace` (`operator_updates.py:230-232`)
  y `publish_update` no lo pasa (`:422`), aunque el CLI lo declara (`lib.rs:806-808`) y
  construye el tag (`jobs.rs:227-230`). No lo vi publicado.
- **`43008` no tiene consumidor de UI** (grep): ninguna superficie lo dibuja, coherente
  con que S1 no lo integre.

---

## 8. Decisión y condiciones de revisión

S1 dibuja **cinco estados** (`requested`, `running`, `done`, `cancelled`, `failed`),
**agrupa por `role`** (las aristas padre→hijo son de S2 **por alcance**, no por falta de
dato: `43007` está mergeada, PR #7 → `e2319442d`), **no dibuja bloqueo ni profundidad**,
y declara **modelo y coste «no disponible»** (nunca `$0`, ningún total).

Revisar esta taxonomía si: **(i)** se añade una kind o un tag de bloqueo;
**(ii)** se corrige el alias `blocked→progress` (recordando los **dos** caminos);
**(iii)** la slice siguiente integra `43008` — requisito de entrada: que su productor
haya emitido al menos una vez en vivo.

---

## 9. Handoff

- **A @coder:** usa `work.state` (cinco valores) — `requested` es fila propia, no
  lo fundas con `running`. **No dibujes la celda `blocked`**; si necesitas nombrar
  el bloqueo, es texto «sin señal», sin cifra. No rotules ninguna columna como
  «profundidad». Modelo y coste: «no disponible».
- **A @diseno:** cinco etiquetas de estado; el vacío/error/carga ya existen
  (`TowerEmptyState`/`TowerErrorState`/`TowerLoadingState`); `43008` no está en
  ninguna superficie.
- **A @revisor:** que la superficie renderizada no contenga «blocked», ni un `0`
  de bloqueo, ni «profundidad», ni un nombre de modelo.
- **Decisión cerrada (maestro):** `43008` (reposo) **no entra en S1**; va a la slice
  siguiente con el requisito de que su productor haya emitido en vivo. S1 no dibuja
  bloqueo: se declara «sin señal», sin cifra.

**Límite de este documento:** sin ejecución del piloto, sin publicación contra
relay, sin trazas en vivo. Cada afirmación es código en disco en HEAD
`ab63b0129` o una inferencia marcada como tal.

---

## Apéndice — inventario reutilizable (`desktop/src/features/tower/**`, `desktop/src/shared/api/tower*`)

Leído con `find desktop/src/features/tower -type f` y `ls desktop/src/shared/api | grep tower`.
Lo que S1 **reutiliza**, lo que **referencia** y lo que es de **S2**:

| Fichero | Uso en S1 |
|---|---|
| `features/tower/domain/TowerSource.ts` | **reutiliza** — el puerto (rechaza en fallo, nunca `[]`) |
| `features/tower/domain/portfolio.ts` | **reutiliza** — el modelo neutro (`WorkState`, `PortfolioLine`) |
| `features/tower/domain/handover.ts` | S2 (aristas) |
| `features/tower/ui/TowerScreen.tsx`, `TowerSection.tsx`, `TowerSectionBody.tsx` | **reutiliza** — la carcasa de la sección y sus ramas de fase |
| `features/tower/ui/TowerLoadingState.tsx`, `TowerEmptyState.tsx`, `TowerErrorState.tsx` | **reutiliza** — los tres estados de superficie (carga / vacío / error) |
| `features/tower/ui/portfolioState.ts`, `usePortfolioState.ts` | **reutiliza** — fase/snapshot y reintento |
| `features/tower/ui/portfolioFormat.ts` | **reutiliza** — recencia y formato de cifras |
| `features/tower/ui/TowerPortfolioList.tsx` | **referencia** — el patrón de tabindex móvil para que la tarjeta sea alcanzable por teclado |
| `features/tower/ui/PortfolioRow.tsx` | **referencia** — la fila existente; la tarjeta del lienzo no la sustituye en S1 |
| `features/tower/ui/TowerNeedsAttention.tsx` | **referencia** |
| `features/tower/ui/HandoverSection.tsx`, `handoverState.ts`, `useHandoverState.ts` | S2 (aristas) |
| `shared/api/towerBuzzSource.ts` | **reutiliza** — el adaptador (lectura acotada al owner) |
| `shared/api/towerJobFold.ts` | **reutiliza** — el plegado kind→estado |
| `shared/api/towerJobWaiting.ts` | **reutiliza** — el lector de reposo (43008) |
| `shared/api/towerHandoffEdges.ts` | S2 (aristas) |

Los **tokens** de color/tipografía/radio/sombra/espaciado no se deciden aquí: son la tabla rol Sapira → token de `@diseno`, y la tarjeta debe usar tokens **existentes** de `desktop/src`, sin tokens ni estilos globales nuevos.
