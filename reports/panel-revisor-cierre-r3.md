# El panel — F1 y F3: verificación independiente del cierre (r3)

**Veredicto: F1 CERRADA y F3 CERRADA**, ambas con test falsable: quité cada
guard y el test que lo protege falla, con la salida pegada abajo. La suite del
escritorio pasa **6730/6730** en `src/**/*.test.mjs` y **6742/6742** con los
globos completos del repo, en el commit `9fad7b22c`.

**Dos correcciones de premisa, antes del resto:**

1. **El PR #9 no está abierto: está MERGED.** `gh pr view 9` (repo
   `ai-sapira-poc/buzz-v1`) devuelve `"state":"MERGED"`,
   `mergedAt 2026-09-23T12:13:58Z`, `mergedBy AlexHHPS` (humano),
   merge commit `053289a14`. Y `git merge-base --is-ancestor 9fad7b22c
   origin/main` sale **sí**: el arreglo ya está en `main`. El "PR #9 OPEN" del
   informe del coder **era verdad cuando se escribió** (mtime del fichero
   `12:07:09Z`, el merge fue a `12:13:58Z`), y es falso ahora. El encargo se
   apoya en esa premisa caducada: lo que yo verifiqué es contenido **ya
   fusionado**, no una propuesta pendiente.
2. **La cifra "6727/0 declarada" del encargo es la de *antes* del arreglo.** No
   es lo que declara el coder (declara 6742/0, con los dos globos). Medido:
   `7a6df79d5` (padre) = **6739/0**; `9fad7b22c` = **6742/0**. El delta es
   **exactamente +3**, los tres tests que añade el commit. El propio coder dejó
   ese delta **sin aislar** ("no afirmo que la diferencia sean solo mis 3
   tests"); aquí queda aislado.

---

## Lo que ejecuté (no leído)

| # | Comando | Salida real |
|---|---|---|
| 1 | `node --test "src/**/*.test.mjs"` (el comando del encargo, sin loader) | **No corre.** `ERR_MODULE_NOT_FOUND: Cannot find package '@/features'`, 0 tests. El comando del encargo no es ejecutable tal cual |
| 2 | `node --import ./test-loader.mjs --experimental-strip-types --test "src/**/*.test.mjs"` en `9fad7b22c` | `tests 6730 / pass 6730 / fail 0` |
| 3 | `… --test "src/**/*.test.mjs" "scripts/*.test.mjs"` en `9fad7b22c` | `tests 6742 / suites 86 / pass 6742 / fail 0` |
| 4 | igual, en `9fad7b22c^` (`7a6df79d5`) | `tests 6739 / suites 86 / pass 6739 / fail 0` |
| 5 | `./node_modules/.bin/tsc --noEmit` en `9fad7b22c` | exit **0** (los tests corren con `--experimental-strip-types`, que **borra** los tipos sin comprobarlos; el typecheck sí los comprueba) |
| 6 | `gh pr view 9 --json …` | `MERGED`, `headRefOid 9fad7b22c…`, `base main`, `isDraft false` |
| 7 | `git diff --name-only 9fad7b22c^ 9fad7b22c` | 4 ficheros (abajo) |
| 8 | `git diff 9fad7b22c origin/main -- <los dos ficheros arreglados>` | **vacío**: `main` lleva el arreglo sin cambios posteriores |

Las corridas 2–5 las hice en un worktree temporal mío (`/tmp/revisor-verify`,
detached en `9fad7b22c`, retirado al terminar) y la 2 también en el worktree del
coder, que quedó **idéntico a su baseline** (`git status --porcelain` = 0 líneas,
comprobado antes y después). La corrida 3 reproduce la cifra que declara el
coder de forma independiente.

## F1 — espera huérfana: CERRADA

**Falsación ejecutada.** `git checkout 9fad7b22c^ -- src/features/panel/ui/PanelRow.tsx`
(el fichero de producción al padre, los tests nuevos intactos) y a correr:

```
✖ an orphan wait is reported as a wait with no activity in the window
  AssertionError [ERR_ASSERTION]: The input did not match the regular expression
  /Espera registrada para un encargo sin actividad en la ventana/
ℹ tests 11 / pass 10 / fail 1
```

Y el HTML capturado en ese fallo **es la reproducción del defecto**: la fila
huérfana sale con `Espera registrada` + `capability_denied` + `El encargo
necesita una capacidad…` + `Desde …`, es decir **como fila corriente**, sin
nada que la distinga. Restaurado con `git checkout 9fad7b22c -- …`, árbol
limpio.

**La línea que lo demuestra** (`9fad7b22c`, contenido idéntico en `main`):

- `desktop/src/features/panel/ui/PanelRow.tsx:163` —
  `orphan={row.waiting !== null && row.workState === null}`
- `desktop/src/features/panel/ui/PanelRow.tsx:77` — la frase, que **coincide
  literalmente** con el texto que fija el contrato: `architecture/panel-frontera-v1.md`
  §7 caso 5 («espera registrada para un encargo sin actividad en la ventana») y
  `designer/panel-slice1-spec.md:50` («Espera registrada para un encargo sin
  actividad en la ventana»). No es texto inventado por el implementador.

**Riesgos que derivé por mi cuenta y comprobé (no estaban en el encargo):**

- **¿El caso huérfano existe en producción, o el test inyecta un estado
  imposible?** El test de render inyecta `work: null` + `waiting` en una
  `PortfolioLine`; si el adaptador no produjese nunca esa fila, el arreglo
  sería inerte. **Ningún test del repo lo afirma.** Lo medí ejecutando el
  adaptador real (`createTowerBuzzSource` con fetch inyectados) contra **un
  único evento 43008 con tag `h`** y sin ningún evento de ciclo de vida:

  ```
  A) ADAPTER lines for a lone 43008 (no lifecycle event):
     [{"project":{"id":"j-orphan","name":"coder"},"recency":{…},"blocked":{"count":0,"basis":null},
       "cost":null,"work":null,"waiting":{"reason":"capability_denied","at":"…"}}]
  ```

  Fila con `work: null` y `waiting` presente: **el guard `workState === null`
  selecciona exactamente lo que produce `orphanWaitingLine`
  (`desktop/src/shared/api/towerBuzzSource.ts:105-118`, el `work: null` en `:114`)**, no un estado de
  laboratorio.
- **¿Puede `workState === null` ser cierto en una fila que *no* es huérfana?**
  No: `lineFrom` (`towerJobFold.ts:84-105`, el `work` en `:103`) siempre emite
  `work: {state, summary}`, así que una fila del plegado nunca tiene `work`
  nulo; `null` sólo lo emite la rama huérfana. Lo comprobé leyendo el plegado y
  con la corrida A; la lectura sola no habría bastado.
- **Regresión de la fila normal**: el test `an ordinary wait of an active job
  does not claim the orphan sentence` pasa (guard presente) y el render real de
  la mutación F1 confirma que la frase sólo aparece en el huérfano.

**Matiz menor, no defecto:** la frase empieza por «Espera registrada», el mismo
texto que el badge de la celda, así que la fila dice dos veces «Espera
registrada». Es la frase del contrato **verbatim**; lo señalo como cosmético, no
como hallazgo.

## F3 — 43008 en el pill de no-leídos: CERRADA

**Falsación ejecutada.** `git checkout 9fad7b22c^ -- src/shared/constants/kinds.ts`:

```
✖ isConversationalUnreadKind_jobWaiting_excluded
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
  actual: true / expected: false
ℹ tests 9 / pass 8 / fail 1
```

**Y medí el efecto de usuario, no sólo el predicado.** Ejecuté el mismo pipeline
que usa el pill (`filter(isConversationalUnreadKind)` → `computeChannelUnreadMarker`)
sobre una ventana que contiene **sólo el 43008**:

```
                       arreglo puesto        arreglo revertido
B) sólo el 43008    {"unreadCount":0}     {"unreadCount":1}   ← el defecto
C) control (1 mensaje real) {"unreadCount":1}   {"unreadCount":1}
```

El control existe porque mi primera sonda devolvía 0 también para un mensaje
real: `computeChannelUnreadMarker` lee `createdAt`, no `created_at`
(`unreadMarker.ts:64`). Sin ese control, la sonda no probaba nada.

**La línea que lo demuestra:** `desktop/src/shared/constants/kinds.ts:177`
(`KIND_JOB_WAITING,` dentro de `NON_CONVERSATIONAL_UNREAD_KINDS`, que a su vez
lee `isConversationalUnreadKind`, `kinds.ts:187-188`), consumida por
`desktop/src/features/channels/ui/useChannelUnreadState.ts:203` — **el único
llamante en producción**, así que el arreglo llega al pill y no queda en una
lista muerta.

**Riesgo derivado por mi cuenta:** ¿hay *otras* superficies de no-leídos que
inflen con un 43008 por otra vía? No:
`communityUnreadObserver.ts:355-358` filtra por `CHANNEL_MESSAGE_EVENT_KINDS`
(allowlist de 4 kinds de mensaje, `kinds.ts:100-105`) y `useUnreadChannels.ts`
usa esa misma allowlist; el 43008 nunca estuvo en ellas. Y `NON_CONVERSATIONAL_UNREAD_KINDS`
tiene un solo consumidor, así que añadir 43008 no cambia nada más.

## Alcance del commit (paso 3 del encargo)

`git diff --name-only 9fad7b22c^ 9fad7b22c` — 4 ficheros, 76 inserciones / 3 borrados:

| Fichero | Dentro de `features/**`? |
|---|---|
| `desktop/src/features/panel/ui/PanelRow.tsx` | sí |
| `desktop/src/features/panel/ui/panelRender.test.mjs` | sí |
| `desktop/src/shared/constants/kinds.test.mjs` | **no** — `shared/` |
| `desktop/src/shared/constants/kinds.ts` | **no** — `shared/` |

**Dos ficheros fuera de `desktop/src/features/`.** Nada fuera de `desktop/src/`:
ningún fichero Rust, Python ni de `experiments/`. La desviación está **declarada
en el propio commit y en el informe** del coder. La juzgo **correcta**: la lista
de exclusión y su invariante viven en `shared/constants/kinds.ts` y los consumen
otras superficies (badges, catch-up); duplicarla dentro de `features/panel/`
dejaría la compartida mintiendo. La restricción «sólo `features/`» del encargo y
el cierre de F3 son incompatibles; el coder eligió cerrar F3 y lo dijo.

## Lo que NO ejercí (dicho, no implicado)

- **Ningún navegador, ni webview Tauri, ni relay vivo.** F1 está probada con
  `renderToStaticMarkup` (markup estático), no pintada en la app; F3 por función
  + contador, no con un 43008 real con tag `h` contra un relay. F5 del veredicto
  r2 sigue abierto como límite declarado.
- **El hook del pill (`useChannelUnreadState`) no tiene test** en el repo: lo que
  yo ejercí es el predicado y el contador que ese hook llama, no el hook. Si el
  hook dejase de aplicar el filtro, ningún test lo notaría.
- **La creación de la fila huérfana en el adaptador no está cubierta por ningún
  test del repo**; la medí con una sonda desechable (script abajo). Un cambio
  futuro en `mergeWaitingIntoPortfolio` que dejase de emitir la fila huérfana
  pasaría la suite entera y apagaría F1 en silencio.
- **No ejecuté `just ci`** (fmt/lint/clippy/otras superficies): sólo la suite de
  unidad del escritorio y `tsc --noEmit`.
- **`KIND_JOB_HANDOFF` (43007) no está en la lista de exclusión** — lo comprobé
  leyendo `kinds.ts:166-181`. Es el hermano que el coder declara fuera de
  alcance; F3 nombraba el 43008, así que el alcance se respeta, pero el hueco de
  no-leídos sigue ahí para 43007 (impacto real sólo si el handoff se publica con
  tag `h`, que no verifiqué).

### Sonda reproducible (F1-A y F3-B/C)

En `desktop/`, guardar como `probe-revisor.mjs` y correr
`node --import ./test-loader.mjs --experimental-strip-types probe-revisor.mjs`:

```js
import { createTowerBuzzSource } from "./src/shared/api/towerBuzzSource.ts";
import { isConversationalUnreadKind, KIND_STREAM_MESSAGE } from "./src/shared/constants/kinds.ts";
import { computeChannelUnreadMarker } from "./src/features/messages/lib/unreadMarker.ts";
const OWNER = "owner";
const waitEvent = { id: "w1", pubkey: "agent", kind: 43008, created_at: 1000, content: "", sig: "s",
  tags: [["p", OWNER], ["h", "chan-1"], ["job", "j-orphan"], ["reason", "capability_denied"], ["role", "coder"]] };
const src = createTowerBuzzSource(async () => [waitEvent], async () => OWNER, async () => []);
console.log("A) " + JSON.stringify(await src.getPortfolio()));
const pill = (m) => computeChannelUnreadMarker(m.filter((x) => isConversationalUnreadKind(x.kind)), 900);
const waitMsg = { id: "w1", pubkey: "agent", kind: 43008, createdAt: 1000, content: "", tags: [["h", "chan-1"]], parentId: null };
const realMsg = { id: "m1", pubkey: "agent", kind: KIND_STREAM_MESSAGE, createdAt: 1000, content: "hola", tags: [], parentId: null };
console.log("B) " + JSON.stringify(pill([waitMsg])));
console.log("C) " + JSON.stringify(pill([realMsg])));
```

## Nota de contenido no confiable

El mensaje de handoff del coder que recibí contiene un pasaje conversacional
ajeno a la tarea (una respuesta de estilo chat sobre «jerarquía vs sociedad» de
agentes, con un `Wait — that's wrong. Let me redo properly.`). No está en el
commit ni invalida el artefacto —lo inspeccioné y es limpio—, pero es señal de
contaminación en la cadena de mensajes. Lo reporto y sigo con mi encargo.

## Handoff

- **Decisión que sigue abierta (del director):** ratificar `KIND_JOB_WAITING = 43008`
  y la desviación de alcance de F3 (fuera de `features/`). Ninguna de las dos es
  mía ni del coder.
- **Para el siguiente revisor, en orden de valor:** (1) atar un test a
  `mergeWaitingIntoPortfolio` que afirme la fila huérfana — hoy el eslabón
  adaptador→fila es el único sin red; (2) un test del hook del pill, o el
  arreglo es de una función, no de la superficie; (3) el mismo hueco para 43007.
- **Aviso de estado:** PR #9 ya está **fusionado** en `main` (`053289a14`).
  Cualquier encargo que pida "cerrar antes del merge" llega tarde; el arreglo se
  puede seguir verificando, pero ya no se puede bloquear.
- **Confianza:** alta en los hechos ejecutados (suite completa en dos revisiones,
  dos mutaciones restauradas, sonda del pill con control, `tsc` exit 0, estado
  del PR por `gh`). Media en el impacto de usuario de F3: probado en la función
  y el contador del pill, no en la app pintada ni contra un relay.
