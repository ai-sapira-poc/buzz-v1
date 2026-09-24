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
legibles de 43001-43006**, de los que S1 **dibuja cuatro** —`requested` es fila
propia, «sin señal» y sin productor, y **no se dibuja** (§2, decisión del maestro
2026-09-24, opción b)—; `bloqueado` declarado «sin señal» y **no dibujado**; y
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

**Añadido en la ronda de cierre: lecturas en vivo.** La frase anterior valía para la
primera versión. Hay ahora un tercer tipo de evidencia, marcada como **observado en
vivo**: lecturas del relay desplegado
(`wss://blockbuzzmain-production-6923.up.railway.app`) con
`buzz messages get --kinds … --limit 200`, **sin publicar ningún evento**. Sostienen
§4 (los 27 eventos `43008`) y §7 (admisión viva de `43002`–`43006` y `43008`). Todo lo
demás sigue siendo código en disco en `ab63b0129`.

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
`experiments/buzz-autonomy/`, con `launch_tower.py` y `pursue.py` dentro de su
`control_plane/`; las de escritorio citadas en forma corta (`kinds.ts`,
`towerJobFold.ts`, `towerBuzzSource.ts`) son relativas a `desktop/src/shared/`. Con
esa base, toda cita de §2 y §4 resuelve con `git show main:<fichero> | sed -n
'<línea>p'`.

**Tercer defecto de la misma clase, corregido en la ronda de cierre.** La fila de
`modelo` de §5 citaba `telemetry.py` sin directorio; bajo la regla anterior, la ruta
relativa a `experiments/buzz-autonomy/` es `telemetry.py`, que no existe (falla
`git cat-file -e ab63b0129:experiments/buzz-autonomy/telemetry.py`). El fichero es
`control_plane/telemetry.py`, y su línea 135 es la que sostiene la afirmación
(`span.set_attribute("gen_ai.request.model", model)`). La cita ahora lo nombra.

**Pasada de cierre tras el veredicto** (`reviews/verdict-tower-grafo-s1-taxonomia.md`).
Tres defectos de la misma clase, corregidos aquí: **(1)** la cita `:388` de §2
pertenece al bloque de prosa `_SAID` (`operator_updates.py:387-395`), que consume
`_line` (`:398-403`), **no** a `publish_waiting` — el número era correcto y el dueño
no; **(2)** el empalme de la espera en §4 es `mergeWaitingIntoPortfolio`
(`towerBuzzSource.ts:85-99`, con el `byJob.get` en `:91`) y las ramas del huérfano
van en `:105-117`: el rango citado antes, `:90-119`, las contenía a las dos y
empezaba cinco líneas tarde; **(3)** el vocabulario de prosa **sin kind** —`delegated` (`:458`) y `summary`
(`mandate.py:62`)— faltaba en el inventario de §2. Verificado línea a línea con
`git show main:<fichero> | sed -n '<línea>p'` sobre `ab63b0129`; las líneas nuevas
citadas en esta pasada (`:331`, `:339-344`, `:387-395`, `:112-118`, `:160-168`,
`:221-223`, `:458`) se leyeron con la misma comprobación.

---

## 2. Taxonomía: los cinco estados que el plegado admite y los cuatro que S1 dibuja

| # | Estado de tarjeta (`WorkState`) | Kind | Constante | Plegado | Mapeo `state → kind` (`JOB_EVENT_STATE`) | Semántica |
|---|---|---|---|---|---|---|
| 1 | `requested` | 43001 | `desktop/src/shared/constants/kinds.ts:26` | `desktop/src/shared/api/towerJobFold.ts:33` | `created` (`operator_updates.py:203`) | pedido, sin arrancar — **sin señal, sin productor, NO dibujada en S1** (decisión del maestro 2026-09-24, opción b) |
| 2 | `running` (aceptado) | 43002 | `kinds.ts:27` | `towerJobFold.ts:34` | `started` (`operator_updates.py:204`) | aceptado |
| 3 | `running` (progreso) | 43003 | `kinds.ts:28` | `towerJobFold.ts:35` | `running` (`operator_updates.py:205`) **y `blocked` (`:209`)** | trabajando / **contaminado** |
| 4 | `done` | 43004 | `kinds.ts:29` | `towerJobFold.ts:36` | `done` (`operator_updates.py:206`) | entregado |
| 5 | `cancelled` | 43005 | `kinds.ts:30` | `towerJobFold.ts:37` | `cancelled` (`operator_updates.py:207`) | detenido por decisión |
| 6 | `failed` | 43006 | `kinds.ts:31` | `towerJobFold.ts:38` | `failed` (`operator_updates.py:208`) | no entregó |

Dos kinds colapsan en `running` (aceptado y progreso): **el plegado admite cinco
valores**, no seis. Es una decisión del plegado, no un defecto. `requested` es fila
propia y distinta de `running` — `towerJobFold.ts:33` mapea `43001 → "requested"`,
no a `running` — y **S1 no la dibuja** (decisión (b), más abajo). **El plegado no
cambia:** `43001` sigue plegándose a `requested`; lo que cambia es el **vocabulario
dibujado**, no la máquina de estados.

**La columna «Mapeo» no prueba que el estado exista.** Es el vocabulario
(`operator_updates.py:202-210`), no un registro de llamadores: que la tabla sepa
traducir `created` a `requested` no significa que algo emita `created`. Repaso de
llamadores reales en el piloto (`publish_update(` / `_publish_lifecycle(` en
`experiments/buzz-autonomy/`, base `ab63b0129`):

| Estado de tarjeta | ¿Llamador hoy? | Llamadores observados |
|---|---|---|
| `requested` (43001) | **No** | ningún llamador pasa `"created"`; los dos únicos literales están en el propio mapeo (`operator_updates.py:203`) y en el bloque de prosa `_SAID` (`:387-395`; el `"created"` en `:388`), que consume `_line` (`:398-403`) — **no** en `publish_waiting`, que usa su propio bloque `_WAITING_SAID` (`:331-336`) vía `_waiting_line` (`:339-344`) |
| `running` (43002/43003) | Sí | latido: `launch_tower.py:244-248` y `supervisor.py:101-103` (`"running"`, no pasan por `_publish_lifecycle`); `started`: `launch_tower.py:287`, `:348`, `supervisor.py:155`, `worker.py:115`; alias `blocked`: `launch_tower.py:418`, `operator_updates.py:454-457` |
| `done` (43004) | Sí | `launch_tower.py:303`, `:335`, `:386`; `supervisor.py:196`; `worker.py:192` |
| `cancelled` (43005) | Sí | `launch_tower.py:297`, `:301`, `:396`; `supervisor.py:225`; `worker.py:207` |
| `failed` (43006) | Sí | `launch_tower.py:297`, `:396`; `supervisor.py:225`; `worker.py:171`, `:207` |
| *(no es estado de tarjeta)* **vocabulario de prosa sin kind**: `delegated`, `summary` | **No emiten kind** | `delegated` (`operator_updates.py:458`: delegación que resuelve sin dependencias pendientes) y `summary` (`mandate.py:62`) **no están** en `JOB_EVENT_STATE` (`operator_updates.py:202-210`), así que `publish_job_event` devuelve `False` (`operator_updates.py:221-223`) y no publica evento de ciclo de vida: dejan prosa en la sala (`format_update`, `operator_updates.py:112-118` y `operator_updates.py:160-168`) y nada más. No son estados de tarjeta; la fila está para que el inventario de «sin señal / sin kind» no oculte un camino mudo |

**Consecuencia, y decisión del maestro (2026-09-24): opción (b).** Por la regla de
esta taxonomía un estado sin productor se declara «sin señal». `requested` **no
tiene ningún llamador que lo emita hoy**: con datos reales el operador no verá esa
etiqueta. El código la pinta porque el pliegue la mapea (`towerJobFold.ts:33`) y el
fixture del spec la siembra — un fixture legítimo, no evidencia de productor.

La decisión es **(b): `requested` (43001) queda «sin señal, sin productor, **no
dibujada** en S1»**, coherente con `bloqueado` (§3): las dos son ausencias
declaradas —no filas dibujadas— y ninguna de las dos se sustituye por un cero.
Efecto sobre la slice: se retira la semilla del fixture que hoy pinta «Requested», y
el vocabulario dibujado pasa de cinco etiquetas a **cuatro** (`running`, `done`,
`cancelled`, `failed`). **El plegado no se toca** (§2 arriba), así que la decisión
es reversible en una línea y el día que exista un llamador de `created` la etiqueta
vuelve sola. Frase de contrato, **literal**:

> `requested`: estado definido y plegado, sin productor observado en vivo a
> 2026-09-24; **no dibujado en S1** (opción b). Se declara «sin señal»; si una línea
> llegase con este estado, se nombra con texto propio y sin cifra — la misma regla
> que el bloqueo, nunca una etiqueta de estado ni un cero.

**Procedencia de la decisión.** Instrucción directa del maestro (2026-09-24) en la
ronda de cierre posterior al veredicto
(`reviews/verdict-tower-grafo-s1-taxonomia.md`, que dejaba (a) y (b) al maestro); no
hay artefacto de decisión aparte. Aviso para quien consuma el informe hermano
`architecture/tower-grafo-s1-taxonomia-r7.md`: registra la **opción (a)** para esta
misma taxonomía. Las dos no pueden regir a la vez: donde `-r7` diga que `requested`
se dibuja, esta revisión lo da por superado.

La diferencia con `blocked` es de **causa, no de trato**: `blocked` no se dibuja
porque **llega** contaminado (el alias `blocked→progress` lo convierte en `running`,
§3); `requested` no se dibuja porque **no llega** (nadie emite `created`). Que las
dos se traten igual es lo que hace que el lienzo no tenga que distinguir «no hay
señal» de «la señal miente»: en los dos casos falta el dato, y el lienzo lo dice sin
inventarlo.

**Cadena de producción completa:**

| Eslabón | Dónde |
|---|---|
| El CLI acepta el estado y lo traduce a kind | `crates/buzz-cli/src/commands/jobs.rs:26-33` (`STATES`), `:58-78` (`kind_for`) |
| El piloto mapea su vocabulario al del CLI | `operator_updates.py:202-210` (`JOB_EVENT_STATE`) |
| El piloto emite el evento | `publish_job_event` `operator_updates.py:213-247` (args en `:230-232`) |
| Quién lo llama | `publish_update` `operator_updates.py:406-433` (llamada en `:422`) |
| Emisores vía `_publish_lifecycle` | `control_plane/launch_tower.py:190-221`; llamadas en `:287` (`started`), `:297` (`failed`/`cancelled`), `:301` (`cancelled`), `:303` (`done`), `:335` (`done`), `:348` (`started`), `:386` (`done`), `:396` (`failed`/`cancelled`), `:418` (`blocked`) |
| Emisor de `running` (latido) | `launch_tower.py:244-248` — `publish_update(..., "running", ...)` directo, **no** por `_publish_lifecycle`; mismo latido en `supervisor.py:101-103` |
| Emisores directos restantes | `supervisor.py:155` (`started`), `:196` (`done`), `:225` (`cancelled`/`failed`); `worker.py:115` (`started`), `:171` (`failed`), `:192` (`done`), `:207` (`cancelled`/`failed`) |

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
| Lector | `desktop/src/shared/api/towerJobWaiting.ts` (`foldWaitingForJob`) |
| Empalme en el portafolio | `mergeWaitingIntoPortfolio` (`desktop/src/shared/api/towerBuzzSource.ts:85-99`; el `byJob.get` va en `:91`) pega la espera a su línea; las ramas del huérfano —una espera sin evento de ciclo de vida en la misma lectura— van en `:105-117` (`orphanWaitingLine`, `basis: null`) |
| Superficie | **ninguna**: `grep -rn "waiting" desktop/src/features/tower/ui/*.tsx` → sin salida |

**Decisión del maestro (2026-09-24, declarada reversible): `43008` no entra en S1.**
Se difiere a la slice siguiente con un requisito de entrada explícito — que su
productor haya emitido al menos una vez **en vivo** —, el mismo requisito que la arista
padre→hijo. Razón: S1 es el andamio del vocabulario de ciclo de vida y de la costura de
proyección; un estado adyacente sin superficie obliga a decidir su vacío y su foco antes
de que exista un encargo que los pida. Este documento deja de tener esa pregunta abierta.
No confundirlo con la celda de bloqueo: son cosas distintas.

**Requisito de entrada: cumplido el 2026-09-23.** La condición era que su productor
emitiera en vivo al menos una vez, y emitió. Lectura propia del relay
`wss://blockbuzzmain-production-6923.up.railway.app`:

```
buzz messages get --channel 55c3438a-e7e8-4d5c-acd9-6e066a8f178d --kinds 43008 --limit 200
→ 27 objetos · 2026-09-23T16:41:26Z → 2026-09-24T02:00:04Z (9,3 h)
  job=tower-coder · reason=ladder_exhausted · un solo firmante

re-lectura propia, --limit 500, leído el 2026-09-24T11:42:16Z
→ 31 objetos (la emisión del productor sigue viva)
```

**Alcance de la lectura (fechado).** Barrió los **nueve canales visibles para mi
identidad** —`sala-tower-grafo`, `sala-tg-d`, `sala-tg-s1`, `panel-agentes`,
`control-plane`, `tower-control`, `vision-e2e`, `Towe Visual`, `general`—, cada uno
con `--kinds 43001,…,43008 --limit 200`. Los 27 objetos de `43008` eran la lectura de
la ronda del 2026-09-23; en la re-lectura del **2026-09-24T11:42:16Z** son **31**, y
siguen estando **todos** en `tower-control`; los otros ocho canales devuelven 0 para
esa kind. Tabla por canal y kind de la primera ronda:
`architecture/tower-grafo-live-kindcheck.md`.

**La ventana sí recorta: un conteo de una sola consulta es un suelo, no un total.**
La lectura anterior afirmaba que «ninguno de esos canales tenía más de 80 eventos de
las kinds pedidas, así que la ventana no recorta los conteos». Esa frase quedó
**falsificada**: la consulta combinada de las ocho kinds en `sala-tower-grafo`
devuelve **200 con `--limit 200` y 200 con `--limit 500`** —está topada— con reloj del
2026-09-24T11:42:16Z. El total sólo lo da el conteo **kind a kind**; una consulta
combinada es una cota inferior.

Reproducido de forma independiente por el maestro (misma cifra, `truncated:false`) en
la ronda del 23-09.
**Esto no mete `43008` en S1**: la decisión de diferirlo sigue en pie y es reversible.
Lo que cambia es que el requisito de entrada de la slice siguiente ya no está pendiente,
no que la slice empiece.

---

## 5. Ausencias de **campo** (no de estado)

| Campo | Productor | Qué dice la tarjeta |
|---|---|---|
| **modelo** | ninguno en la lectura; `gen_ai.request.model` vive en el span de turno (`control_plane/telemetry.py:135`), que no está vivo ni se lee | «no disponible» con la razón |
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
- **Rendija residual — cerrada en esta rama (`a739cd06f`):** `towerBuzzSource.ts`
  hacía `events ?? []` (`:148`, `:165`), que convertía una fuente que **resolvía**
  `null`/`undefined` en `[]` y pintaba «no hay trabajo» sobre una fuente muerta —
  lo que el puerto prohíbe. Ahora ambas lecturas exigen un array (`Array.isArray`)
  y lanzan; el `catch` existente lo traduce al mismo
  `TowerSourceError("adapter_unavailable", ...)` y la superficie pinta su rama de
  error. Hallazgo del revisor; arreglo del coder.

  **Precisión del test, medida por el revisor y no reproducida por mí (2026-09-24).**
  La frase que este documento llevaba —«con test que falla al quitar la guarda»— es
  imprecisa y queda retirada: neutralizar la guarda (`if (!Array.isArray(events))` →
  `if (false) {`) **no** pone rojo el test de nodo (siguió 12/12 verde), porque el
  `throw` aguas abajo ya rechaza y la guarda es **redundante con él**. Lo que sí lo
  pone rojo (12→11/1) es reintroducir `events ?? []`. Es decir: el test ata el
  **comportamiento** («una fuente que resuelve sin lista está muerta, no vacía»),
  no la guarda. El e2e **no** vigila ese guard —entra por la caché de React Query y
  nunca atraviesa el adaptador—, así que un `?? []` futuro volvería a pintar «no hay
  trabajo» sobre una fuente muerta con el e2e en verde; atarlo es deuda nombrada de
  S2. El revisor midió la mutación con su comando y su salida; yo no la ejecuté.

---

## 7. Lo que no se puede saber / no verificado

- **No ejecuté el piloto y no publiqué nada contra un relay** (solo lecturas). El
  código citado es código en disco en HEAD `ab63b0129`; lo observado en vivo va marcado
  como tal, con su comando.
- **Admisión del relay: qué está verificado y qué no.**
  - **Por código (HEAD `ab63b0129`):** las ocho kinds caen en la misma alternativa del
    `match` de scope — `crates/buzz-relay/src/handlers/ingest.rs:554-561`, de
    `KIND_JOB_REQUEST` a `KIND_JOB_WAITING` → `Scope::MessagesWrite`; cualquier otra
    kind termina en `Err("restricted: unknown event kind")` (`:562`). Hasta
    `90bdd0c55` (2026-09-17) ninguna de ellas tenía scope asignado y **toda** escritura
    se rechazaba: el protocolo tenía consumidor y no tenía puerta de entrada.
  - **Observado en vivo:** `43008` está admitido — 31 eventos almacenados y releídos en
    `tower-control` (**leído el 2026-09-24T11:42:16Z**; la lectura del 23-09 dio 27, §4).
    `43002`–`43006` también: 231 eventos en `sala-tower-grafo` (**misma lectura**:
    `43002`×41, `43003`×156, `43004`×20, `43005`×4, `43006`×10); la ronda del 23-09 leyó
    98 (`26/52/11/1/8`). El ciclo sigue emitiendo: toda cifra sin fecha envejece.
  - **Inferido, no publicado:** la alternativa es un bloque contiguo que creció en tres
    commits — `90bdd0c55` (`43001`–`43006`), `aa1fc86c4` (`43007`), `7a6df79d5`
    (`43008`) — y `7a6df79d5` **desciende** de los otros dos (`git merge-base
    --is-ancestor`, `true` en ambos casos). Luego un relay desplegado que admite
    `43008` lleva los tres commits y admite también `43001` y `43007`. Es una
    inferencia sobre el binario desplegado a partir del historial del repositorio,
    **no** una publicación.
  - **Lo que sigue sin verificarse es la emisión, no la admisión:** nadie ha publicado
    `43001` ni `43007` —0 eventos de esas dos kinds en los **nueve** canales barridos
    (§4), `[]` con `--kinds 43007`—, y `created` no tiene llamador. Un cero de emisión no
    es prueba de rechazo.
  - **`43001` (`requested`): sin productor observado y sin dibujar en S1.** Decisión
    vigente (2026-09-24, opción (b)): S1 rotula **cuatro** estados —`running`, `done`,
    `cancelled`, `failed`—, «sin señal» y nunca un cero presentado como medición. El
    plegado de `main` no cambia: `43001` sigue plegándose a `requested`
    (`towerJobFold.ts:33`).
- **El tag `trace` sigue sin emitirse** (inferido de la lectura):
  `publish_job_event` construye los args sin `--trace` (`operator_updates.py:230-232`)
  y `publish_update` no lo pasa (`:422`), aunque el CLI lo declara (`lib.rs:806-808`) y
  construye el tag (`jobs.rs:227-230`). No lo vi publicado.
- **`43008` no tiene consumidor de UI** (grep): ninguna superficie lo dibuja, coherente
  con que S1 no lo integre.

---

## 8. Decisión y condiciones de revisión

S1 dibuja **cuatro estados** (`running`, `done`, `cancelled`, `failed`); el plegado
admite cinco y `requested` (43001) queda **sin señal, sin productor y no dibujada**
por decisión del maestro (2026-09-24, **opción (b)**, reversible) — la misma
declaración que `bloqueado`: ninguna de las dos se dibuja y ninguna se presenta como
cero. **Agrupa por `role`** (las aristas padre→hijo son de S2 **por alcance**, no por falta de
dato: `43007` está mergeada, PR #7 → `e2319442d`), **no dibuja bloqueo ni profundidad**,
y declara **modelo y coste «no disponible»** (nunca `$0`, ningún total).

El juego de cinco es el que el **plegado admite**; S1 dibuja cuatro. **`requested` no
tiene llamador productor hoy** (§2), y por eso la decisión (b) —retirar su semilla y no
dibujarla— deja el vocabulario dibujado alineado con lo que el piloto emite: cada
etiqueta en pantalla corresponde a un productor que existe. La alternativa (a) pintaba
un rótulo que, con datos reales, el operador no habría visto nunca; el coste de (b) es
una línea del seed, y el día que aparezca un llamador de `created` se deshace igual de
barato.

Revisar esta taxonomía si: **(i)** se añade una kind o un tag de bloqueo;
**(i-bis)** aparece el primer llamador de `created` — entonces `requested` deja de ser
«sin señal», vuelve al vocabulario dibujado y la decisión (b) de §2 se revisa en el
mismo movimiento (evidencia: un `git grep -n '"created"' experiments/buzz-autonomy`
con un llamador distinto del mapeo y de la prosa de `operator_updates.py:388`);
**(ii)** se corrige el alias `blocked→progress` (recordando los **dos** caminos);
**(iii)** la slice siguiente integra `43008` — requisito de entrada **cumplido el
2026-09-23** (§4); `43008` sigue fuera de S1.

---

## 9. Handoff

- **A @coder:** usa `work.state` — el plegado admite cinco valores, pero **S1 dibuja
  cuatro etiquetas** (`running`, `done`, `cancelled`, `failed`). **`requested` (43001)
  no se dibuja** (decisión (b) del maestro, §2): retira su semilla del fixture; si
  alguna vez llega una línea con `work.state === "requested"`, se nombra «sin señal»
  con texto propio y sin cifra — nunca como etiqueta de estado ni fundida con
  `running`. **No dibujes la celda `blocked`**; si necesitas nombrar el bloqueo, es
  texto «sin señal», sin cifra. No rotules ninguna columna como «profundidad». Modelo
  y coste: «no disponible».
- **A @diseno:** **cuatro** etiquetas de estado (`running`, `done`, `cancelled`,
  `failed`); `requested` no se dibuja —si el lienzo necesita nombrarlo, es «sin
  señal» con texto propio y sin cifra—; el vacío/error/carga ya existen
  (`TowerEmptyState`/`TowerErrorState`/`TowerLoadingState`); `43008` no está en
  ninguna superficie.
- **A @revisor:** que la superficie renderizada no contenga «blocked», ni un `0`
  de bloqueo, ni la etiqueta de `requested`, ni «profundidad», ni un nombre de
  modelo.
- **Decisión cerrada (maestro, 2026-09-24): (b).** `requested` (43001), fila 1 de §2,
  **no tiene llamador productor**: se declara «sin señal, sin productor, no dibujada
  en S1», coherente con `bloqueado`. Se retira la semilla del spec; **el plegado no
  se toca**. Reversible; se revisa si aparece un llamador de `created` (§8,
  condición i-bis). La rendija del adaptador ya está cerrada por el coder
  (`a739cd06f`).
- **Decisión cerrada (maestro):** `43008` (reposo) **no entra en S1**; va a la slice
  siguiente, cuyo requisito de entrada —que su productor haya emitido en vivo— quedó
  **cumplido el 2026-09-23** (§4). S1 no dibuja bloqueo: se declara «sin señal», sin
  cifra.

**Límite de este documento:** sin ejecución del piloto y sin ninguna publicación
contra relay. Cada afirmación es código en disco en HEAD `ab63b0129`, una lectura en
vivo con su comando (§1), o una inferencia marcada como tal.

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
