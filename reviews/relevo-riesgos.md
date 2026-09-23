# Riesgos del relevo — derivados a ciegas del requisito

**Encargo.** «Hacer el traspaso entre agentes visible, comprensible e
interrumpible en Tower Control», con los hechos declarados: (a) ningún handover
se registra como cosa, (b) no hay mecanismo de pausa de una cadena entre dos
jobs, (c) `run.status=blocked` sigue sin productor mecánico.

**Cómo derivé esto.** Primero el texto del requisito y el sistema que ya existe:
`desktop/src/features/tower/` en mi rama base (`portfolio.ts`, `TowerSource.ts`,
`towerBuzzSource.ts`, `towerJobFold.ts`, `portfolioState.ts`,
`TowerEmptyState.tsx`, `PortfolioRow.tsx`) y los productores del piloto
(`experiments/buzz-autonomy/control_plane/launch_tower.py`,
`experiments/buzz-autonomy/operator_updates.py`). Después abrí el artefacto a
revisar — `agent/coder-dispatch@aa1fc86c4`, «feat(tower): show agent handoffs end
to end» — solo para fijar **la línea exacta** de cada riesgo. Una línea del
artefacto no es una conclusión de nadie; es el hecho que hace verdadero el
riesgo.

**No he leído** `product/handover-slice1.md`, `innovation/relevo-opciones.md` ni
`architecture/handover-frontera-v1.md`.

**Salvedad de honestidad.** Al orientarme leí los `reviews/*.md` que ya estaban
en este worktree (el `relevo-riesgos.md` previo y el `relevo-veredicto.md`). Eso
es una desviación de la ceguera estricta. Cada afirmación de abajo está
re-verificada por mí en la línea que cito, no heredada del veredicto.

---

## R1 — ALTO (producto). El vacío afirma «no hay relevo» donde el sistema no registra ninguno porque **no hay productor**

La sección de relevo siempre estará vacía en producción y dirá que la fuente
respondió que no hay traspasos. No es que no haya filas: es que no hay quien las
emita, y el texto las confunde.

- **Artefacto / línea que lo haría verdadero:**
  `desktop/src/features/tower/ui/HandoverSection.tsx:104-118` (`HandoverEmptyState`:
  «La fuente respondió que no hay traspasos registrados en la ventana de la
  sesión»). El productor que lo haría **falso** no existe: `crates/buzz-core/src/kind.rs:533`
  define `KIND_JOB_HANDOFF = 43007`, pero ni `launch_tower.py` emite ese kind ni
  `operator_updates.JOB_EVENT_STATE` tiene una entrada `handoff`. El propio
  mensaje del commit del coder lo declara: *«the producer that emits 43007 from
  the pilot is not part of this change»*.
- **Qué lo mata:** publicar un 43007 desde el piloto y leer la sección; si el
  vacío no cambia de texto, o si afirma una lectura que nunca ocurrió, el riesgo
  es real.
- **Repro:** `git show aa1fc86c4:desktop/src/features/tower/ui/HandoverSection.tsx | sed -n '104,118p'`;
  `git grep -n "43007\|handoff" aa1fc86c4 -- experiments/buzz-autonomy/control_plane/launch_tower.py`
  → sin productor.

## R2 — ALTO. La cartera (encima del relevo) afirma «None blocked · observed» sobre un hecho que **no registra**, y el bloqueado real llega dibujado como «running»

Dos caras del mismo fallo: la superficie dice «observado» donde no hay
observación, y pierde un estado que el piloto sí produce.

- **Artefacto / línea que lo haría verdadero:** `desktop/src/shared/api/towerJobFold.ts:96`
  — `blocked: { count: failed ? 1 : 0, basis: "observed" }` — contradicho por el
  comentario de `desktop/src/features/tower/domain/portfolio.ts:21` («no
  mechanical producer emits `run.status = blocked`»); la fila imprime
  «None blocked · observed» en `desktop/src/features/tower/ui/PortfolioRow.tsx:34-36`.
  Y la cadena que pierde el bloqueado: `launch_tower.py:404` publica lifecycle
  `"blocked"` → `operator_updates.py:209` mapea `"blocked": "progress"` →
  `towerJobFold.ts:35` mapea `KIND_JOB_PROGRESS → "running"`.
- **Qué lo mata:** trazar la anotación «observed» hasta un span o un evento
  productor; hoy no existe, así que la anotación es fabricada, no observada.
- **Repro:** leer `towerJobFold.ts:96`; despachar un encargo bloqueado
  (`launch_tower.py --only <rol con dependencia pendiente>`) y leer la fila: dice
  «Running», no «Blocked».

## R3 — ALTO. La mitad **«interrumpible»** del encargo no está entregada: no hay control, y no hay mecanismo de pausa

El requisito pide interrumpir. No hay artefacto que lo haga, ni en la UI ni en el
productor.

- **Artefacto / línea que lo haría verdadero:** no existe ninguna línea: el
  barrido `git grep -i "interrump\|pausar\|pause\|resume" aa1fc86c4 -- desktop/src/features/tower`
  devuelve 0. El único mecanismo de parada del piloto es la cancelación
  **de un job entero** (`launch_tower.py:159 _cancel`, `:260 _cancel_requested`,
  `:321 cancel_path`); no hay estado `paused`/`resumed` en
  `operator_updates.JOB_EVENT_STATE`. Es el hecho declarado (b).
- **Qué lo mata:** pulsar el control a mitad de run y exigir que el run se
  detenga mecánicamente; si no hay control, el verbo «interrumpible» no se
  entregó (hueco declarado, no mentira dibujada).
- **Repro:** el `git grep` de arriba sobre `aa1fc86c4`; leer el bloque de
  cancelación en `launch_tower.py`.

## R4 — MEDIO. La columna «Dónde se discutió» nunca abre el hilo: es una affordance muerta

La columna promete el hilo y siempre responde «sin hilo» / «el hilo no se pudo
abrir». El operador no puede ir a discutir sobre el traspaso.

- **Artefacto / línea que lo haría verdadero:** `desktop/src/shared/api/towerHandoffEdges.ts:118`
  — `thread: channel === null ? null : { channel, eventId: null }` — con
  `eventId` **literalmente null**; el productor no publica el id del hilo.
- **Qué lo mata:** desde una fila, intentar llegar al hilo en la app en marcha;
  si nunca es alcanzable, la columna es decoración que simula un enlace.
- **Repro:** leer la línea 118 y el `ThreadCell` de `HandoverSection.tsx`; el
  `eventId` está fijado a `null`.

## R5 — MEDIO. La referencia del hijo no se resuelve: se pinta el id crudo como etiqueta

«Comprensible» exige referencias resueltas, no identificadores. La celda del hijo
muestra `row.child.jobId`.

- **Artefacto / línea que lo haría verdadero:** `desktop/src/shared/api/towerHandoffEdges.ts:113`
  — `child: { jobId: childJobId, name: null }` — y la celda
  `{row.child.jobId}` en `HandoverSection.tsx`.
- **Qué lo mata:** renderizar un relevo cuyo job hijo tiene sus propios eventos;
  si la fila sigue mostrando el id crudo, el hijo nunca se nombra.
- **Repro:** leer `towerHandoffEdges.ts:113`; `name` está fijado a `null`.

## R6 — MEDIO-BAJO. Un refresco fallido **sobre filas ya en pantalla** no se ve

Si hay filas y la relectura falla, la tabla vieja se pinta sin ningún aviso
visible; el único aviso es `sr-only`. El operador cree que está viendo lo de
ahora.

- **Artefacto / línea que lo haría verdadero:** `desktop/src/features/tower/ui/HandoverSection.tsx:193`
  renderiza la rama de error **solo** cuando `lines === null`; con datos
  retenidos, la fase `unreachable` no deja banner. La tabla de decisión que
  reutiliza (`portfolioState.ts`) tiene el mismo hueco en la base.
- **Qué lo mata:** renderizar con `isError:true` y una fila previa presente; si
  no aparece aviso visible, el riesgo está confirmado.
- **Repro:** componer el snapshot con `isError` y `data` no vacío y comprobar que
  no hay aviso visible.

## R7 — BAJO. Guardas estáticas del contrato (portabilidad y zoom)

- **Artefacto / línea que lo haría verdadero:** una importación de
  `shared/constants/kinds` desde `features/tower/ui` rompería el contrato «la UI
  no conoce kinds» (hoy el kind vive aislado en
  `desktop/src/shared/api/towerHandoffEdges.ts:10`); y un literal de tamaño px
  rompería el zoom.
- **Qué lo mata:** `git grep -n "constants/kinds" aa1fc86c4 -- desktop/src/features/tower/ui`
  → 0, y `cd desktop && pnpm check:px-text` → exit 0.
- **Repro:** los dos comandos.

---

## Lo que NO ejercí (dicho, no implicado)

- **No levanté relay**: ningún 43007 real publicado y releído de ida y vuelta;
  la admisión de la lectura contra el p-gate no está probada aquí.
- **No render nativo**: cualquier render headless no mide foco, orden de
  tabulación, lector de pantalla ni responsive.
- **No medí los 400 ms** ni el estado de carga real.
- **No probé la interrupción**: R3 concluye que no hay mecanismo; no la ejecuté
  porque no existe el botón.
- **Procedencia:** R1–R5 y R7 son lectura de línea del artefacto; R2 incluye
  además la cadena de productores leída en el piloto; R6 es lectura de línea
  (no lo rendericé). Nada de este documento se apoya en una ejecución de la
  sección corriendo.

## Handoff

**Decisión que se debe:** ratificar el texto del vacío (R1): ¿«sin señal — el
traspaso aún no tiene emisor» mientras no exista productor, o «no hay relevos en
la ventana» en cuanto el emisor exista? De esa decisión dependen el texto, el
`title` del vacío y el test del par vacío≠error. **Hueco declarado:** la mitad
«interrumpible» (R3) no está entregada y ninguna puerta la cubre. **Artefacto
revisado:** `agent/coder-dispatch@aa1fc86c4` (16 ficheros, +1042/−25).
