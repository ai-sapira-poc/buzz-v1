# Work Order: WO-001 — Tower Control community POC

## Summary

Construir el primer vertical slice de Tower Control dentro de Buzz Desktop y
usarlo como prueba de que el propio equipo de agentes puede construir la
superficie que hace visible su trabajo. El POC debe mostrar una cartera de
proyectos con agentes, workspaces, ejecuciones, progreso y bloqueos, usando la
comunidad Buzz como plano de coordinación y dejando GitHub y la observabilidad
profunda como sistemas enlazados, no duplicados.

## In Scope

- Reanudar el equipo de diez roles definido en
  `experiments/buzz-autonomy/control_plane/tower_project.py` y publicar sus
  encargos en el canal de proyecto `tower-control`.
- Crear el modelo de dominio neutro de Tower y el puerto `TowerSource`, de
  forma que la UI no conozca Nostr, Relay ni un backend OTel concreto.
- Crear un adaptador POC de Buzz que proyecte los eventos de trabajo existentes
  (43001–43006), perfiles/agentes y proyectos en filas de cartera.
- Añadir la entrada `/tower` al escritorio, detrás del mecanismo de
  `FeatureGate` existente, reutilizando patrones de Pulse y Projects.
- Renderizar estados de carga, vacío, ejecución, bloqueo, error y cobertura
  incompleta, con enlaces de evidencia cuando existan `trace_id`, commit o PR.
- Añadir pruebas unitarias del dominio/adaptador y una prueba E2E de la cartera.
- Hacer resiliente la ejecución de agentes lentos: no usar un timeout de pared
  corto como criterio de calidad; conservar lease/heartbeat, checkpoint,
  cancelación explícita y reanudación segura.
- Separar la comunicación interna de la comunicación al operador: los agentes
  pueden usar handoffs técnicos estructurados, pero cada delegación debe dejar
  un estado humano legible y un resumen de avance, bloqueo, resultado y siguiente
  acción en el canal comunitario.
- Registrar el trabajo, las decisiones, los handoffs y la evidencia en
  `.sw-factory/WO-001/`.

## Out of Scope

- Cambios, despliegues o rotaciones de secretos en Railway.
- Federación entre relays locales, sincronización offline o `buzz-edge-sync`.
- Reemplazar Grafana, Phoenix, Loki o Prometheus.
- Ingesta completa de OTLP desde Macs; en el POC solo se conserva el contrato
  de correlación y el enlace a la traza.
- Webhooks de GitHub de producción; se usan referencias/fixtures y se deja
  preparada la correlación por repository, commit SHA y PR.
- Agregado de costes entre owners que no puedan leer sus métricas NIP-44.
- Nuevos endpoints HTTP cuando un evento Nostr o el adaptador existente sea
  suficiente.

## Requirements

- **REQ-TOWER-POC-001 — Vista comunitaria de trabajo:** derivado de
  `docs/goals/tower-control-plan.md` §3–§5 y `docs/goals/tower-control-arranque.md`
  §2–§6. Una persona debe poder identificar qué proyecto está activo, qué
  agente trabaja, si está bloqueado y qué evidencia respalda el estado.
- **REQ-TOWER-POC-002 — Construcción auto-observable:** derivado de
  `docs/goals/tower-control-plan.md` §6. El equipo debe recibir encargos
  distintos con dependencias, producir handoffs persistentes y dejar una
  revisión independiente antes de cerrar el slice.
- **REQ-TOWER-POC-003 — Portabilidad y honestidad:** el modelo de UI no puede
  quedar acoplado al relay; los estados desconocidos y la cobertura parcial se
  deben mostrar como tales.
- **REQ-TOWER-POC-004 — Ejecuciones de larga duración:** derivado de la
  decisión operativa del equipo (2026-09-15). Un modelo puede tardar horas o
  días: el sistema debe mantenerlo visible y reanudable mientras haya lease,
  distinguir lentitud de pérdida de proceso, y solo interrumpir por cancelación
  explícita, pérdida de lease o límite operativo configurado.
- **REQ-TOWER-POC-005 — Comunicación operativa legible:** derivado de la
  observación del operador (2026-09-15). La persona no debe tener que descifrar
  IDs, códigos AC ni el protocolo entre agentes para saber qué se ha iniciado,
  qué ha avanzado, qué está bloqueado, qué resultado existe y cuál es la próxima
  acción. Los mensajes dirigidos al operador deben empezar por el impacto/estado
  de negocio; el detalle técnico queda como evidencia secundaria y los handoffs
  internos conservan su formato estructurado.

## Blueprints

- `docs/goals/tower-control-plan.md` — fases, equipo, tipos de evidencia y
  restricciones del POC.
- `docs/goals/tower-control-arranque.md` — frontera `TowerSource`, modelo
  OTel-neutro, correlación `run.id = trace_id` y criterios de prueba.
- `VISION.md` — comunidad Buzz como workspace y eventos Nostr como protocolo.
- `VISION_PROJECTS.md` — proyectos, repositorios, ramas, agentes y evidencia de
  GitHub.
- `crates/buzz-core/src/kind.rs` — kinds de jobs, agentes y métricas existentes.

## E2E Acceptance Tests

### COV_TOWER_001: Cartera comunitaria

**File:** `desktop/tests/e2e/tower-control.spec.ts`

**Tags:** `@tower @smoke` | **Priority:** P1

**@COV_TOWER_001.1 - muestra proyectos y líneas de trabajo activas**

1. Instalar el bridge mock y abrir `/tower` en una comunidad con dos proyectos.
2. Sembrar ejecuciones de dos agentes en proyectos distintos.
3. Assertar que cada proyecto aparece una sola vez y que la fila identifica
   proyecto, agente, acción y resultado.
4. Assertar que el estado se mantiene tras navegar a otra ruta y volver.

**@COV_TOWER_001.2 - distingue bloqueo, ejecución y ausencia de datos**

1. Sembrar una ejecución `running`, una `blocked` con razón y un proyecto sin
   ejecuciones.
2. Assertar que los tres estados tienen texto y semántica distintos.
3. Assertar que el bloqueo muestra la evidencia disponible y no inventa una
   causa cuando la cobertura es incompleta.

### COV_TOWER_002: Frontera de portabilidad

**File:** `desktop/src/features/tower/domain/towerSource.test.mjs`

**Tags:** `@tower @contract` | **Priority:** P1

**@COV_TOWER_002.1 - la UI consume el puerto neutro**

1. Ejecutar el dominio con un `TowerSource` fixture.
2. Assertar que los datos usan `project.id`, `run.id`, `turn.id`, `agent.id`,
   `trace_id` y `vcs.commit.sha` sin importar un módulo de relay.
3. Hacer fallar el test si una pantalla Tower importa Nostr, Relay o un kind.

### COV_TOWER_003: Evidencia de delegación

**File:** `experiments/buzz-autonomy/test_tower_project.py`

**Tags:** `@tower @orchestration` | **Priority:** P1

**@COV_TOWER_003.1 - el equipo se reanuda con dependencias y no duplica trabajo**

1. Ejecutar el launcher en modo dry-run y comprobar el orden de roles y
   dependencias.
2. Ejecutar una asignación pendiente contra el canal del proyecto.
3. Assertar que un job completado no se vuelve a ejecutar y que cada fallo deja
   un resultado persistente para reintento o revisión.

**@COV_TOWER_003.2 - el trabajo es visible durante la ejecución**

1. Lanzar una asignación Hermes y una Pi con el relay disponible.
2. Assertar que cada una publica un estado de arranque antes del harness y un
   estado terminal después; el intento Pi también queda en `jobs` con su
   resultado y `trace_id` cuando hay Collector.
3. Forzar un fallo de arquitectura y assertar que `coder` queda bloqueado por
   dependencia y no se inicia sin ese handoff.

**@COV_TOWER_003.3 - un agente lento no se convierte en fallo**

1. Ejecutar un harness fixture que permanezca activo más allá del antiguo
   timeout corto y emita heartbeats/checkpoints.
2. Assertar que el job continúa `running`, que su descendiente no se inicia por
   error y que la UI puede mostrar frescura y progreso parcial.
3. Completar el fixture y assertar que el handoff se publica una sola vez y el
   job pasa a `done`.

**@COV_TOWER_003.4 - una interrupción se recupera sin perder evidencia**

1. Interrumpir un harness después de escribir un checkpoint.
2. Assertar que queda `failed`/`cancelled` con el checkpoint y una razón
   durable, nunca `done`.
3. Reanudar el mismo job y assertar que reutiliza el checkpoint sin duplicar el
   handoff ya publicado.

### COV_TOWER_004: Comunicación operativa

**File:** `experiments/buzz-autonomy/test_tower_project.py`

**Tags:** `@tower @operator-comms` | **Priority:** P0

**@COV_TOWER_004.1 - la delegación es visible inmediatamente**

1. Crear un encargo desde el maestro.
2. Assertar que se publica una actualización legible con objetivo, responsable,
   estado y próxima señal esperada, sin depender de la respuesta posterior del
   modelo.

**@COV_TOWER_004.2 - el cierre resume movimiento y no protocolo**

1. Cerrar una ejecución con éxito, bloqueo y fallo.
2. Assertar que cada resumen contiene avance/resultado, impacto y siguiente
   acción; los identificadores técnicos no son el titular y un fallo no se
   presenta como progreso.
