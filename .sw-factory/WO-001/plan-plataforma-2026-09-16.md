# Plan de mejora de la plataforma — 2026-09-16

**Alcance:** no Tower Control como feature, sino el sistema que queremos: Buzz
como plano común + Railway + Linear + harnesses (Hermes/Pi) + colaboración +
autonomía + resiliencia + observabilidad + automejora. El criterio de este plan
es el del handover: *una capacidad observable, verificable y trazable*, no un
job encolado ni un plan publicado.

**Método:** cada ítem nace de una medición sobre `pilot.db` (6.014 eventos,
~220 jobs) o de una traza real, no de una opinión. Se ataca el mecanismo del
harness que hace fallar al agente; nunca se hace el trabajo del agente a mano
(el sistema es el producto; el modelo es barato; iterar es la estrategia).

---

## 0. Estado medido hoy

| Métrica | Valor | Lectura |
|---|---|---|
| Jobs `failed` / `done` | 39 / ~180 (≈18 %) | designer 5/12, research 5/14, innovation 4/19, strategy 4/21 |
| `tool_error` vs `write` | **321 vs 253** | los agentes chocan con la herramienta más veces de las que consiguen escribir |
| `FileNotFoundError` | **106** (33 % de los tool_error) | no existe acción `list`: los agentes *adivinan* rutas |
| `KeyError` | 99 (31 %) | llamadas mal formadas — cubierto hoy por `check_call`/`require_keys` |
| `incomplete` (presupuesto agotado) | 14 | y solo **1** `retry_from`: casi nunca se recupera |
| Entradas en `notebook` (memoria compartida) | **11** en 6.014 eventos | 146 `recall` sobre una memoria casi vacía |
| `learnings.md` (L-001…L-016) leído por algún rol | **no** (grep: 0 referencias en código) | la automejora vive en un markdown que ningún agente consume |
| Linear chronicle | 4 artefactos de 119–523 bytes, último 13-sep | proyección a Linear existe pero no corre en continuo |
| Heartbeats / operator updates | funcionan (133 heartbeats, `publish_update` por estado) | base de observabilidad comunitaria OK |
| Railway | solo lectura vía `analyst`/`operations` | correcto para el POC; sin señal de despliegue en Tower |

---

## 1. Hecho hoy (evidencia en L-016 y en la suite: 183 tests OK)

- CSS gate: eliminados tres falsos positivos insatisfacibles; dialecto del gate
  declarado en `design_guard.POLICY` (llega a `profiles` y a `roster`).
- Dispatcher: `args` no-dict o claves ausentes → error accionable con ejemplo.
- Recuperación: `pursue.diagnose_budget()` lee la traza; si ≥⅓ de los turnos
  murieron en el harness, **mantiene alcance** y reanuda desde artefactos
  validados, en vez de recortar (fin del efecto "tower-diseno-min").
- Honestidad de estado: un `failed` por presupuesto lista los artefactos que
  pasaron el gate ("validados, no aceptados") en texto, evento, update de
  operador y `jobs.result`.
- Designer relanzado: `tower-diseno-c5ab328d` (running). **Medir su traza**
  igual que la anterior: turnos-de-harness vs turnos-de-diseño es el KPI real
  de la iteración.
- En curso (agentes): autopsia de `research` (16/16 + timeout) y de la
  ejecución Pi de `arquitecto` (TimeoutExpired) contra el contrato L-011…L-015.

---

## 2. Backlog por eje, ordenado por impacto/coste

### Eje A — Harness (autonomía): que el agente no pierda turnos en la herramienta

**A1. Acción `list` acotada.** 106 `FileNotFoundError` porque no hay forma de
ver qué existe. Añadir `list {path, depth≤2, limit≤200}` dentro de `safe_path`,
para todos los roles con `read`. Test: la ruta inexistente devuelve además
las 5 entradas hermanas más parecidas (difflib), para que el error enseñe.
*Coste: pequeño. Impacto: el error más frecuente del sistema.*

**A2. Errores que enseñan, como política.** Regla ejecutable en `operate()`:
ningún `except` puede devolver solo el nombre de la excepción. Test que recorre
todas las acciones con args vacíos y exige que cada mensaje contenga la forma
esperada. (Generaliza lo hecho hoy para `write/read`.)

**A3. Resultados de herramienta grandes.** Verificar en la autopsia de
`research` si los `read` de 46k chars (visto en la traza del designer, turno 2)
fuerzan relecturas por trozos. Si sí: `read` devuelve por defecto un índice
(cabeceras + offsets) cuando el fichero supera 12k, y el contenido bajo `limit`.

**A4. Presupuesto de turnos por rol, no global.** `BUZZ_TURN_BUDGET=16` para
todos. Un designer que escribe HTML no es un analista que lee. Mover a
`roster.CONTRACTS[role]["budget"]` con 16 por defecto y 24 para roles que
producen artefactos largos; `pursue` respeta el del rol.

### Eje B — Resiliencia (largo plazo): un modelo puede tardar horas

**B1. Reanudación real tras `incomplete`.** 14 incompletos, 1 `retry_from`.
El supervisor debe encolar automáticamente el peldaño de `pursue.approach`
(ya diagnostica) cuando un job muere por presupuesto y hay artefactos
validados, sin esperar a un humano. Límite: 3 intentos, luego `blocked` con
la razón en lenguaje de operador.

**B2. Cierre de la brecha Pi (según autopsia en curso):** wall clock que mata
modelo vivo, timeout por comando ausente, checkpoint perdido en cancel, lease
stale no recuperado. Cada gap → test que falla si se quita la guarda.

**B3. Generación única de listeners.** El handover avisa: matar el supervisor
deja huérfano `buzz-acp`. `serve.py --status` debe listar el árbol y
`--stop` debe rechazar si detecta dos generaciones.

### Eje C — Automejora: cerrar el bucle learnings → agente

**C1. Learnings ejecutables.** Hoy L-001…L-016 no llegan a ningún rol.
Añadir a `roster.instruction()` una sección "Lecciones vigentes para tu rol"
generada desde `learnings.md` (bloques etiquetados con `roles: [diseno,...]`
en el frontmatter de cada L-0NN). Test: cambiar una lección cambia la
instrucción del rol afectado y de ningún otro.

**C2. Notebook con uso real.** 11 entradas. Cada job `done` debe dejar una
entrada `experience` mínima (qué funcionó / qué costó turnos) escrita por el
harness desde la traza — determinista, no por el modelo — y `recall` la
prioriza por rol. Medir: entradas/semana y `recall` con hit.

**C3. Autopsia automática.** Lo hecho hoy a mano (contar turnos por causa) es
`pursue.diagnose_budget`. Extenderlo a todo job fallido y publicar el desglose
como evento `autopsy` + línea en el update de operador ("perdió 8/17 turnos en
el gate"). Es la métrica de salud del harness.

### Eje D — Colaboración y observabilidad comunitaria (Buzz)

**D1. Un mensaje de negocio por estado, siempre.** `operator_updates` ya
responde objetivo/estado/impacto/evidencia/siguiente acción. Falta el caso
`incomplete` con artefactos (hecho hoy) y el caso `blocked` con quién puede
desbloquear (viene del peldaño `blocked` de `pursue`).

**D2. Deduplicación de heartbeats.** 133 heartbeats no deben ser 133 mensajes.
TTL + muestreo; Tower marca `stale`, no la conversación.

**D3. Enlace, no sustitución, de la observabilidad profunda.** Cada update
lleva `trace_id` (ya existe) y, si hay collector, el enlace; si no,
`coverage=partial` explícito.

### Eje E — Linear y Railway (integraciones)

**E1. Chronicle continuo.** `linear_chronicle.py` es correcto por diseño (no
infiere, proyecta). Ejecutarlo desde `serve.py` cada N horas con `--publish`
cuando `LINEAR_API_KEY` exista; artefacto local siempre. Test: dos ejecuciones
seguidas sin eventos nuevos no publican dos veces.

**E2. Railway solo lectura, pero visible.** Estado de despliegue del relay
(último deploy, salud) como señal de `coverage` en los updates de `operations`,
sin escribir nada en Railway. Cambios reales en Railway = otra entrega.

### Eje F — Diseño y producto (patrón golden skills Sapira)

**F1. Verificación visual obligatoria del designer.** Rasterizar su HTML
(Playwright ya existe en `tester`) y adjuntar la imagen como evidencia, no
solo el sha. Paso 3 de `sapira-maquetacion.skill`.

**F2. Verificador que avisa además de bloquear.** Convenciones editoriales
(sin em dashes, sin símbolos de sección, títulos numerados) como *warnings*
en el recibo de `write` para `product`/`editor`, no como rechazo.

---

## 3. Orden propuesto (siguiente sesión)

1. **A1 + A2** — atacan el 64 % de los tool_error. Medibles en `pilot.db` a
   la semana.
2. **B1 + C3** — la recuperación automática con diagnóstico: convierte el
   trabajo de hoy en comportamiento del sistema.
3. **C1** — cerrar el bucle de automejora; sin esto los L-0NN son literatura.
4. **B2/B3** — según lo que devuelva la autopsia Pi.
5. **E1, D2, F1** — bajo coste, alta visibilidad.

## 4. Cómo sabremos que funciona

- `tool_error / write` < 0,5 (hoy 1,27).
- `FileNotFoundError` < 10/semana (hoy 106 acumulados).
- `incomplete` con `retry_from` automático ≥ 80 % (hoy 1/14).
- Tasa de `failed` < 8 % por rol (hoy 18 % global; designer 42 %).
- `notebook` ≥ 1 entrada por job `done` (hoy 11/180).
- Cada rol recibe ≥ 1 lección vigente en su instrucción (hoy 0).

## 5. Reglas que no se negocian

- Nada de `git push` ni cambios en Railway sin autorización explícita.
- Un `failed` no se convierte en `done` por conveniencia; un artefacto
  validado se **lista**, no se acepta.
- Toda mejora del harness nace de una traza o de una consulta a `pilot.db`
  y deja un L-0NN con evidencia, acción y estado.
- Los tests se atan al seam de producción y deben fallar si se quita la guarda.

---

## 6. Estado al cierre de sesión (2026-09-16, Claude Code / Fable 5.1)

**Commit local:** ninguno; 27 rutas modificadas/nuevas en el worktree, sin push.
**Work Order:** in_progress. Producto Desktop (/tower) sin empezar por decisión
explícita: primero el sistema.

### Hecho y verificado
- A1 `list` + `read` con vecinos (`capabilities.py`, `test_controls.py` 2 tests OK).
- A2 parcial: `check_call`/`require_keys` (agente; 180 OK).
- CSS gate sin falsos positivos + dialecto en `POLICY` (18/18).
- `pursue.diagnose_budget` + peldaño que mantiene alcance (41/41).
- `validated_artifacts` en `failed` por presupuesto (agente; 183 OK).
- **C1 automejora cerrada en código:** `roster.lessons_for(role)` inyecta en la
  instrucción del rol las L-0NN etiquetadas con `- **Roles:** …`. Verificado a
  mano: `diseno` recibe L-016 y L-017; `coder` solo L-017. **Sin test aún.**
- L-016, L-017 en learnings.md; memoria de sesión guardada.

### En vuelo (comprobar al volver)
- `tower-diseno-c5ab328d` running desde 01:50 (ventana 900 s, budget 16).
  KPI: en su traza, turnos-de-harness vs turnos-de-diseño (`pursue.diagnose_budget`).
  Log: `/tmp/buzz-pursue/diseno.log`. Si falla por budget, `pursue` aplicará
  solo el peldaño nuevo en -r2.
- Agente `autopsy-research`: traza de `tower-research-cb003434` (16/16, timeout).
- Agente `autopsy-pi`: `tower-arquitecto` (TimeoutExpired) contra L-011…L-015;
  reporta huérfanos sin matarlos.
  Ambos tenían prohibido tocar capabilities/worker/design_guard/pursue.

### Pendiente inmediato
1. Test falsable para `lessons_for` (cambiar una lección cambia solo el rol
   etiquetado; lección sin `Roles` no llega a nadie).
2. Suite completa una vez (`python3 -m unittest discover -s experiments/buzz-autonomy -p 'test_*.py'`)
   tras integrar lo de los dos agentes; `git diff --check`.
3. Partir en commits por cambio lógico (`-s`): gate, dispatcher, pursue,
   artefactos validados, list, lessons, docs.
4. Retroetiquetar L-001…L-015 con `Roles` donde aplique (hoy solo L-016/L-017).
5. Seguir el orden de §3: B1+C3 (recuperación automática con autopsia), luego
   B2/B3 según autopsia Pi, luego E1/D2/F1.

### Llegado al cierre — autopsia `research` (agente `autopsy-research`)
`tower-research-cb003434` (16/16, sin artefacto): 70 pasos de batch pedidos,
43 ejecutados, 27 descartados porque `run_batch` hace `break` en el primer
paso fallido (docstring dice lo contrario); la allowlist `PUBLIC_HOSTS` no
aparece en esquema, roster ni error ("Source outside public research
allowlist" no la nombra) → 18 fetches a 13 hosts denegados, uno por turno;
un batch de 105k chars fue truncado por Hermes a 1,5k (turno 8 perdido y
re-fetches). Nunca se llamó a `write`. Además, la fuente primaria de la
pregunta (spec OTel semconv) es inalcanzable con esa allowlist: **decisión de
producto pendiente** (¿opentelemetry.io / github.com/open-telemetry?).

Ya hecho por el agente: sección `sources` en el contrato `research` de
`roster.py` (hosts, "los fetch dudosos al final y solos", un arXiv completo
por turno, `write` antes del turno 12) + `test_research_turns.py` (5 OK, 3
skip que pinean el fix de capabilities y fallan hoy si se des-skipean).

**Pendiente #1 (capabilities.py, dueño: sesión principal):** `break`→`continue`
en `run_batch`; error de fetch que nombra la allowlist; tope de 60k chars por
batch recortando los payloads mayores; esquema actualizado. Des-skipear los 3
tests al aplicarlo. Mismo mecanismo mató T5 de `tower-producto-e8c4e0b0-r2`.

### Llegado al cierre — autopsia Pi `tower-arquitecto` (agente `autopsy-pi`)
Matado por un wall clock de **300 s** con `--no-session` (código antiguo del
harness): sin checkpoint, sin sesión, stdout descartado en el pipe; lo que
hacía al morir es incognoscible por construcción. El "reintento" fue otro job
(`arq-tower-frontier-verify`, brief distinto) cuyo intento 1 corrió en Hermes
por error de enrutado (L-012 exacto) y el 2 en Pi (45 min, 88 heartbeats,
checkpoint 3,3 MB, `done`). El árbol actual ya no tiene wall clock por defecto
(L-011 cumplido). Sin procesos huérfanos; 8 pidfiles muertos (stale files).

**Fix hecho (`supervisor.py` + `test_tower_project.py`, 21/21, falsable):**
G1 — un job Pi `running` cuyo supervisor murió quedaba así para siempre y
bloqueaba a sus dependientes (ruta que tomará `coder-tower-slice1-implementation`).
`recover_stale_pi_leases()` en `tick()`: sin heartbeat > `BUZZ_JOB_LEASE_TTL`
(120 s) → `queued` (attempts<3) o `failed` visible; checkpoint y `--session-id`
se conservan, así que el reintento reanuda. Evento `stale_recovered`.

**Pendiente (Pi):**
- G2 el checkpoint `runs/pi-checkpoints/{job}.jsonl` se sobreescribe en cada
  intento (launch_tower usa `.attempt-{n}`): unificar antes de confiar en reanudar.
- G5 la ruta Hermes (`worker.py`) **no emite heartbeats** → la recuperación de
  lease no aplica a `tower-diseno-c5ab328d` ni a ningún job Hermes. Añadir
  heartbeat por turno desde `worker.py` (hook de Hermes o hilo).
- G4 `cancel_check` cada 1 s sobre sqlite: un `database is locked` transitorio
  mata un Pi sano; capturar y reintentar.
- G3 `_terminate_tree` puede lanzar TimeoutExpired tras SIGKILL; G6 el guard
  cubre solo `bash` (grep/find/read nativos de pi sin límite); NO verificado si
  pi mata el árbol del comando al expirar.
- Limpiar pidfiles muertos en `serve.py --status` (relacionado con B3).
- Verificar en vivo que un reintento Pi→Pi reanuda la sesión por id.
