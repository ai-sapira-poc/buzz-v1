# WO-001 — Operational learnings

Registro vivo de observaciones de la iteración auto-construible. Cada entrada
separa evidencia, interpretación y el cambio propuesto. Una oportunidad solo se
promueve a código cuando tiene una prueba o criterio de aceptación asociado.

## 2026-09-15 — primera ejecución

### L-001 — Los roles Pi no tienen estado durable de ejecución

- **Evidencia:** `launch_tower.py::dispatch_pi` llama directamente a
  `pi_harness.run(...)`, guarda el artefacto al terminar y no crea/actualiza una
  fila `jobs` ni emite un estado `running`. Durante la ejecución de
  `tower-arquitecto`, el proceso estaba activo pero `pilot.db` no tenía un job
  actual para ese intento.
- **Impacto:** Tower no puede mostrar que arquitectura/coder/revisor están
  trabajando, ni distinguir una ejecución viva de una perdida.
- **Acción propuesta:** envolver también Pi en el mismo ciclo durable de job:
  `queued → running → done|failed`, con heartbeat, attempt id, `trace_id` y
  resultado. El proceso debe ser recuperable sin duplicar el trabajo.
- **Prioridad:** P0. **Estado:** abierto.

### L-002 — La idempotencia no entiende la genealogía de reintentos

- **Evidencia:** `status_of` solo consulta `tower-<role>`, mientras la base
  contiene trabajos derivados como `tower-diseno-min`,
  `tower-producto-e8c4e0b0-r2` y varios intentos fallidos. Un resultado correcto
  con un sufijo no evita que el launcher programe de nuevo el id canónico.
- **Impacto:** trabajo y coste duplicados; el estado de Tower puede decir que un
  rol está pendiente cuando ya produjo un artefacto válido.
- **Acción propuesta:** separar `job_id` estable de `attempt_id`, registrar
  lineage y resolver la reanudación por artefacto/estado, no por coincidencia
  textual de ids.
- **Prioridad:** P0. **Estado:** abierto.

### L-003 — Un agente puede salirse del alcance con una búsqueda costosa

- **Evidencia:** el agente arquitecto lanzó un `find /` durante varios minutos;
  el proceso hijo se identificó y se terminó de forma segura. Después continuó
  con búsquedas limitadas al repositorio.
- **Impacto:** latencia impredecible y consumo no acotado; el agente puede
  inspeccionar rutas que no pertenecen al proyecto.
- **Acción propuesta:** hacer que el tool de shell rechace o limite raíces fuera
  del checkout para roles de código, añadir timeout por comando y una prueba que
  falle si se intenta recorrer `/`.
- **Prioridad:** P0. **Estado:** mitigación manual aplicada; hardening abierto.

### L-004 — El launcher no ofrece telemetría de progreso al operador

- **Evidencia:** la salida de `launch_tower.py` permanece sin líneas durante la
  ejecución larga de Pi; el proceso sí seguía activo y conectado al gateway del
  modelo. El primer estado visible fiable fue la inspección externa de procesos.
- **Impacto:** el silencio se parece a bloqueo, fallo o ausencia de agente.
- **Acción propuesta:** emitir eventos estructurados `assignment_started`,
  `tool_progress`, `heartbeat`, `assignment_finished` y `assignment_failed`, y
  hacerlos visibles en el canal/proyección Tower. Los prints deben llevar
  `flush=True`, pero no son sustituto del estado durable.
- **Prioridad:** P1. **Estado:** abierto.

### L-005 — La ruta Pi no publica el handoff en Buzz pese a que el comentario lo afirma

- **Evidencia:** `dispatch_pi` guarda `artifacts/tower/<role>.md/.json` y llama a
  `telemetry.flush()`. No llama a `reporting.publish`, `buzz messages send` ni a
  una función equivalente. La lectura del canal mostró informes de Hermes, pero
  no un handoff nuevo de arquitectura durante el intento activo.
- **Impacto:** el equipo no ve el resultado en su plano común; el objetivo de
  “construirse a sí mismo en Buzz” se rompe justo en los roles de código.
- **Acción propuesta:** publicar un evento/handoff durable después de persistir
  el artefacto y antes de marcar `done`; si la publicación falla, dejar el job en
  estado reintentable, nunca en éxito silencioso.
- **Prioridad:** P0. **Estado:** abierto.

### L-006 — Salud HTTP y salud del trabajo son señales distintas

- **Evidencia:** Hermes y el relay responden correctamente a sus healthchecks,
  pero los logs de Hermes muestran un `project-config.json` ausente y fallos de
  integridad referencial para `project_id=pr-review`. El relay y Hermes no
  registraron 5xx en la ventana observada.
- **Impacto:** un dashboard basado solo en Railway/HTTP reportaría verde cuando
  el trabajo de agentes está degradado.
- **Acción propuesta:** Tower debe combinar disponibilidad, worker health, job
  state, freshness y cobertura; un healthcheck nunca cierra una ejecución.
- **Prioridad:** P0. **Estado:** requisito de diseño confirmado.

### L-007 — El canal comunitario requiere una identidad de operador visible

- **Evidencia:** la identidad `operator` del piloto recibió `403
  relay_membership_required` al leer el canal; la identidad `maestro` sí pudo
  leerlo y encontró 25 mensajes históricos.
- **Impacto:** el sistema puede estar trabajando y aun así ser invisible para la
  identidad que intenta monitorizarlo.
- **Acción propuesta:** separar explícitamente identidad de bootstrap, identidad
  del maestro y viewer humano; probar membresía del viewer antes de arrancar y
  mostrar un error accionable si falta.
- **Prioridad:** P1. **Estado:** abierto; no se cambió membresía automáticamente.

### L-008 — La telemetría local tiene un puerto, pero la ingestión debe verificarse

- **Evidencia:** el launcher se inició con
  `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318`; el puerto respondió 404
  en `/`, que no prueba por sí solo que el endpoint OTLP `/v1/traces` acepte
  spans.
- **Impacto:** podemos creer que medimos cuando solo estamos ejecutando un
  exporter sin Collector receptor.
- **Acción propuesta:** añadir un smoke test OTLP que publique un span sintético,
  compruebe recepción y registre `trace_id`; si no hay Collector, la ejecución
  debe marcar cobertura `unavailable`, no `complete`.
- **Prioridad:** P1. **Estado:** abierto.

### L-009 — La app no puede mostrar actividad si el arranque no emite un estado común

- **Evidencia:** durante el intento real, el proceso `arquitecto` estuvo activo
  más de 30 minutos, pero el canal comunitario no recibió `started`, heartbeat,
  progreso ni handoff; la app permaneció visualmente quieta. Al detener el
  proceso no apareció ningún estado de fallo en Buzz. El launcher fue detenido
  antes de que `coder` trabajase sin arquitectura.
- **Impacto:** para la persona que opera Buzz, “agente trabajando”, “agente
  bloqueado” y “no se lanzó nada” son indistinguibles. La observabilidad existe
  solo para quien inspecciona procesos y una base local.
- **Acción propuesta:** publicar un evento de arranque antes de invocar cualquier
  harness, emitir heartbeats con TTL y cerrar siempre con `done`, `blocked` o
  `failed`. La UI debe mostrar la frescura del último evento y la identidad que
  no tiene membresía como error accionable.
- **Prioridad:** P0. **Estado:** confirmado en ejecución; abierto en código.

### L-010 — El heartbeat local todavía no es observabilidad comunitaria

- **Evidencia:** la ejecución corregida publicó `assignment_started` y, tras
  cinco minutos, `assignment_failed` en Buzz; entre ambos extremos produjo
  heartbeats en `pilot.db`, pero no `buzz_report` intermedios. La app puede
  conocer el inicio y el final, pero no el progreso de una ejecución larga si
  no consulta esa máquina concreta.
- **Impacto:** el modelo “cada ingeniero tiene su Buzz local conectado a la
  comunidad” aún no está realizado para la frescura: Tower no puede agregar el
  estado de procesos locales a nivel comunidad solo con el relay central.
- **Acción propuesta:** proyectar un resumen acotado de heartbeat/frescura a
  Buzz u OTel (con TTL, muestreo y deduplicación), y hacer que el adaptador Tower
  marque `stale`/`coverage=partial` cuando la fuente local deje de reportar.
  No convertir cada heartbeat en una conversación ni sustituir Grafana,
  Phoenix, Loki o Prometheus.
- **Prioridad:** P1. **Estado:** confirmado; abierto para la siguiente slice.

## Cómo se usarán estos aprendizajes

Antes de cerrar WO-001, el revisor debe comprobar L-001, L-002, L-003, L-005 y
L-009. Las entradas L-006–L-008 se convierten en criterios de la siguiente iteración
de Tower y no se resuelven maquillando la vista.

## 2026-09-15 — corrección P0 y reanudación

### L-011 — Un límite de pared no es un criterio de calidad

- **Evidencia:** los procesos que ejecutaron la captura del operador llevaban
  `--max-turn-duration 600/900`, `--idle-timeout 300` y una ventana externa de
  1.800 s. Los tres encargos terminaron como `timeout` aunque el trabajo podía
  requerir más tiempo. La flota corregida arranca con un techo operativo de siete
  días y sin caducidad de inactividad por defecto; el canal publica que una
  respuesta lenta sigue en curso.
- **Impacto:** el sistema confundía calidad lenta con fallo y dejaba al operador
  sin saber si había trabajo perdido.
- **Acción:** mantener `timeout=None` por defecto, conservar checkpoint/sesión,
  latidos y cancelación explícita; aceptar límites cortos solo como diagnóstico
  configurado. **Estado:** implementado y cubierto por la suite; verificación
  prolongada en curso.

### L-012 — El rol de ejecución forma parte del contrato, no es plumbing

- **Evidencia:** los tres jobs visibles del pantallazo fueron creados, pero el
  driver genérico los ejecutó con el worker Hermes confinado a `artifacts/`.
  Arquitectura intentó leer rutas del checkout como `desktop/src/` y terminó en
  `timeout`; el handoff no llegó a publicarse.
- **Impacto:** un encargo podía parecer bien delegado y aun así no tener acceso
  a la superficie que debía verificar; la causa quedaba escondida detrás de un
  resultado técnico críptico.
- **Acción:** resolver la identidad del job contra el roster y enviar roles Pi
  (`arquitecto`, `coder`, `revisor`) por `pi_harness`, manteniendo diseño y roles
  de negocio en Hermes cuando su entregable es un artefacto del piloto. **Estado:**
  implementado; la reanudación viva ya muestra arquitectura `running` con
  checkpoint y heartbeat.

### L-013 — Crear un encargo no es comunicar progreso

- **Evidencia:** el Maestro publicó una lista de tres IDs y después acumuló
  errores de herramienta (`buzz` no disponible y lecturas mal formadas). Aunque
  las filas existían en `pilot.db`, la interfaz de la comunidad no recibió una
  actualización humana de creación, inicio ni resumen.
- **Impacto:** para el operador, “se ha creado”, “se está ejecutando” y “se ha
  quedado bloqueado” eran visualmente equivalentes.
- **Acción:** separar handoff técnico y proyección de operador: cada delegación
  publica inmediatamente objetivo/estado/próxima señal; cada inicio y estado
  terminal publica su impacto; el driver publica un resumen determinista de
  hijos y mantiene los IDs como detalle secundario. **Estado:** implementado y
  cubierto por `COV_TOWER_004`; falta comprobarlo en la vista Tower final.

### L-014 — El directorio de trabajo no basta como barrera de alcance Pi

- **Evidencia:** en la reanudación real de `arq-tower-frontier-verify`, el
  checkpoint registró llamadas `find /Users/alexherranz` desde una herramienta
  `bash`, aunque el proceso Pi se lanzó con `cwd` igual al checkout de Buzz.
  La búsqueda estaba limitada por profundidad y no produjo una lectura de
  secretos en la evidencia observada, pero sí salió del proyecto.
- **Impacto:** una ejecución puede ser duradera y visible y aun así consumir
  tiempo fuera del proyecto o exponer datos que no forman parte del encargo.
  `cwd` orienta la resolución de rutas; no constituye una contención del árbol
  de procesos ni de los comandos del modelo.
- **Acción:** añadir un adaptador de shell para los roles Pi que rechace raíces
  fuera del checkout, limite duración/salida por comando y registre el rechazo
  como evidencia; mantener la capacidad de ejecutar tests del repositorio.
  **Estado:** abierto, no se interrumpe el trabajo actual porque la búsqueda
  observada es acotada y el rol es de lectura.

### L-015 — La resiliencia necesita límites por herramienta, no solo por modelo

- **Evidencia:** la misma reanudación dejó un `grep -r` sin timeout activo más
  de siete minutos dentro de un turno Pi. Se terminó únicamente ese grupo de
  shell; el proceso Pi siguió vivo y su checkpoint conservó la evidencia. El
  turno no debía fallar por ser lento, pero tampoco debía quedar a merced de
  una búsqueda recursiva sin alcance.
- **Impacto:** un proceso puede tener heartbeat y seguir siendo operacionalmente
  inútil si una herramienta auxiliar monopoliza el turno; además, el operador
  no distingue fácilmente razonamiento largo de herramienta atascada.
- **Acción:** el contrato Pi exige timeout finito por comando, búsquedas `rg`
  con rutas explícitas y exclusión de artefactos; la siguiente iteración debe
  convertirlo en una barrera ejecutable que rechace o mate el árbol del comando
  sin cancelar la sesión ni borrar el checkpoint. **Estado:** instrucción
  añadida; enforcement ejecutable pendiente.

## 2026-09-16 — autopsia del rol designer (Claude Code)

### L-016 — El presupuesto de turnos no lo agota el diseño; lo agota el harness

- **Roles:** diseno
- **Evidencia:** traza completa de `diseno-tower-slice1-screen` (16/16). El
  HTML pasó el gate en el turno 8. De los 8 turnos restantes, 6 se perdieron
  en el bucle de rechazo del CSS gate (19→5→4→3 infracciones, reescribiendo
  el documento entero cada vez) y 2 en llamadas mal formadas
  (`{"action":"write","args":""}` devolvió un `TypeError: string indices…`
  sin pista de esquema). El rol `designer` ha fallado 4 de 5 encargos en
  una semana siempre así; el único `done` recortó el alcance a una fila.
- **Causa raíz del bucle:** tres de las infracciones eran falsos positivos
  insatisfacibles: `border-collapse: collapse`, `background-size: 100% 100%`
  y `box-shadow: 0 -1px 0 0 var(--color-border-subtle)`. El gate decía
  "no hay token; no la uses" para mecánica de tabla y fondo que no tiene
  paleta, y rechazaba una sombra cuyo único color YA era token Sapira. Un
  rechazo que no se puede cumplir es el más caro que existe: el modelo lo
  reintenta hasta morir.
- **Acción realizada:** `design_css.cjs` excluye las propiedades de mecánica
  (`border-collapse|spacing|image`, `background-size|repeat|position|clip|
  origin|attachment|blend-mode`) y trata offsets/blur/inset de las sombras
  como geometría. Tests rojos→verdes en `test_design_guard.py` (18/18).
  **Replay:** el artefacto rechazado en el turno 29 pasa el gate corregido:
  el designer habría terminado con ~3 turnos de margen. El dispatcher ahora
  devuelve el ejemplo de esquema cuando `args` no es un dict.
- **Abierto (siguiente iteración):** `design/tower-slice1-screen.html`
  (11.965 bytes, 17:25) existe en disco y pasó el gate, pero el job se marcó
  `failed` y su texto se publicó como "EJECUCIÓN INCOMPLETA". El sistema no
  distingue "presupuesto agotado sin entregable" de "presupuesto agotado con
  entregable validado en disco". Debe registrar `partial` con los artefactos
  que pasaron el gate y su sha, sin fingir `done`. Además, cada rechazo del
  gate cuesta un turno completo + reescritura total: exponer `lint` como
  acción de solo validación (sin escribir) abarataría la corrección a un
  `write` con `old_text/new_text` en vez de un documento nuevo.
- **Referencia externa (golden skills Sapira, `pharo-platform/internal_docs/
  golden-skills/sapira-maquetacion.skill`):** el patrón que sí funciona allí
  es (1) dialecto y convenciones declaradas en la instrucción antes de
  escribir, (2) verificador mecánico que avisa en vez de solo bloquear, y
  (3) verificación visual obligatoria: rasterizar el artefacto y mirarlo
  antes de entregar. El paso 1 queda aplicado en `design_guard.POLICY`; el 3
  es la siguiente iteración natural para `diseno` (Playwright ya existe en
  el rol `tester`): que el designer capture su propio HTML y reporte la
  imagen como evidencia, no solo el sha.

### L-017 — El error más frecuente del sistema era no poder mirar

- **Roles:** todos
- **Evidencia:** `pilot.db`: 321 `tool_error` frente a 253 `write`; 106 de
  ellos `FileNotFoundError` en `read` (33 %), seguidos de 99 `KeyError`
  (31 %). No existía ninguna acción para listar el árbol de artefactos: los
  agentes adivinaban rutas y pagaban un turno por cada fallo, y el mensaje era
  `[Errno 2] No such file`, que no enseña nada para el siguiente intento.
- **Acción realizada:** acción `list {path, depth≤3, limit≤500}` disponible
  para todo rol con `read` (listar es estrictamente más débil que leer),
  anunciada en el esquema de la herramienta con la regla "mira antes de leer";
  y `read` de ruta inexistente responde con los vecinos más parecidos
  (difflib) y la sugerencia de `list`. Tests en `test_controls.py`.
- **Métrica de éxito:** `FileNotFoundError` < 10/semana; ratio
  `tool_error/write` < 0,5 (hoy 1,27). Plan completo en
  `plan-plataforma-2026-09-16.md`.

### L-018 — Un gate que no distingue citar código de ejecutarlo bloquea la prosa

- **Roles:** diseno, producto, revisor
- **Evidencia:** `tower-diseno-c5ab328d` (16/16). Escribió su especificación en
  markdown citando TSX; `design_guard.is_ui()` casó `<div` y `{color:` dentro
  de las vallas y la rechazó con "UI source requires a supported design
  adapter; self-contained HTML only" — insatisfacible para un documento. En
  los turnos 9-14 el agente escribió `probe-a.md`, `probe-b.md` y `probe-c.md`
  **para hacer ingeniería inversa de la regla**. Misma clase que L-016 con
  otra regla: 7 de 17 turnos.
- **Acción:** `is_ui` lee el código entre vallas como cita, no como fuente;
  sigue siendo UI si el markup aparece fuera de las vallas, o si las vallas
  son >60 % del fichero (el disfraz que POLICY sí prohíbe). Tests en
  `test_design_guard.py` (20/20).

### L-019 — El presupuesto de turnos debe caber en el rol y en el reloj

- **Roles:** todos
- **Evidencia:** 16 turnos era un número único para doce trabajos distintos.
  Medido en las trazas: **≈47 s por turno** en este modelo (17 turnos = 13,4
  min; 8 turnos = 7,4 min). El modelo es lento y bueno porque itera, así que
  el presupuesto tiene que caber en el trabajo del rol.
- **Acción:** `roster.turn_budget(role)` — basal 24, y 32 para `diseno`,
  `research` y `coder`, 28 para `producto` y `arquitecto`; `worker.turn_budget`
  lo resuelve por identidad y `BUZZ_TURN_BUDGET` sigue mandando para que la
  escalera de `pursue` pueda comprar turnos. **Y la ventana deriva del
  presupuesto** (`pursue.fits`, 75 s/turno): 32 turnos dentro de 900 s solo
  reetiqueta la misma muerte como "timeout". Ningún peldaño de recuperación
  arranca por debajo del basal del rol.
- **Aviso:** el presupuesto no cura la atrición. `diseno-tower-slice1-screen`
  tenía 16 turnos y perdió 8 en rechazos insatisfacibles; con 32 habría
  comprado 16 sondas más. Primero que cada turno sirva.

### L-020 — Un batch que aborta al primer fallo fabrica los reintentos

- **Roles:** research, producto, analista
- **Evidencia:** `tower-research-cb003434` (16/16, **sin artefacto**): 70 pasos
  pedidos, 43 ejecutados, 27 descartados porque `run_batch` hacía `break`
  (su propio docstring decía lo contrario). Los turnos 5, 9, 12 y 13
  devolvieron 153 bytes cada uno: un host denegado en el paso 0 mataba cuatro
  lecturas legales. Además la allowlist de `fetch` no se declaraba en ningún
  sitio, así que se descubrió a un host denegado por turno (18 fetches, 13
  hosts), y un batch de 105k chars fue sustituido por un stub por Hermes.
- **Acción:** los pasos independientes siguen corriendo y el fallo se reporta
  en su sitio; el error de `fetch` nombra la allowlist completa; tope de salida
  por batch recortando los payloads mayores. Los tests que afirmaban "debe
  parar" se actualizaron: su propio razonamiento pedía lo contrario.
