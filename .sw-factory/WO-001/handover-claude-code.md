# Handover para continuar WO-001 en Claude Code

**Fecha del snapshot:** 2026-09-16  
**Repositorio:** /Users/alexherranz/Brein/projects/buzz-v1  
**Rama:** poc/buzz-autonomous-team  
**Work Order:** WO-001 — Tower Control community POC  
**Estado del Work Order:** in_progress

Este documento es el punto de entrada para continuar la ejecución en Claude
Code. Debe leerse junto con AGENTS.md, VISION.md,
.sw-factory/WO-001/work-order.md, implementation-plan.md, checklist.md y
learnings.md. El código y la base local son la fuente del estado operativo;
este documento es el resumen de transferencia y debe actualizarse después de
cada hito relevante.

## Prompt de arranque para Claude Code

Copiar este bloque como primer mensaje de la nueva sesión:

```text
Estamos continuando el Work Order WO-001 — Tower Control community POC en
/Users/alexherranz/Brein/projects/buzz-v1, rama poc/buzz-autonomous-team.

Lee primero:
1. AGENTS.md completo.
2. .sw-factory/WO-001/handover-claude-code.md.
3. .sw-factory/WO-001/work-order.md, implementation-plan.md, checklist.md,
   review-log.md y learnings.md.
4. VISION.md, VISION_ACTIVITY.md, VISION_PROJECTS.md,
   VISION_REMOTE_AGENTS.md y docs/goals/tower-control-arranque.md.

Después haz un diagnóstico de solo lectura del worktree, de la base de jobs y
de los procesos locales. No borres ni reviertas cambios existentes. Usa rtk
delante de cada comando de shell, apply_patch para editar y no hagas ningún
git push.

Objetivo: completar el primer vertical slice de Tower Control dentro de Buzz
Desktop. La pantalla debe mostrar, a nivel de comunidad, qué proyecto está
activo, qué agente trabaja, qué está bloqueado, qué progreso/evidencia existe y
qué acción corresponde al operador. Cada ingeniero puede ejecutar agentes en su
Buzz local, pero la comunidad compartida es el plano común; GitHub conserva los
commits/cambios de código y Tower Control los correlaciona. La observabilidad
profunda existente (Railway/Grafana/Phoenix/Loki/Prometheus/OTel) se conserva y
se enlaza; no se sustituye.

No empieces por el coder si las dependencias no están justificadas. El lote
actual tiene arquitectura y revisión de contrato terminadas, diseño fallido
por presupuesto de iteraciones y coder en cola. Lee los artefactos antes de
decidir si se recupera/reintenta diseño o si existe un entregable válido que
pueda aceptarse explícitamente. No marques un job como done solo para forzar el
orden.

La siguiente entrega técnica debe ser la mínima implementación verificable de
la frontera TowerSource + dominio/adaptador + ruta /tower + estados de carga,
vacío, error, running, blocked, failed y cobertura parcial, siguiendo Pulse,
Projects, FeatureGate, Sapira y los tokens rem de Desktop. Añade pruebas que
fallen si la UI conoce Relay/Nostr/kinds o si se confunde silencio con progreso.

Mantén los contratos de ejecución larga: un modelo puede tardar horas o días;
heartbeat, lease, checkpoint, cancelación explícita y reanudación son parte del
producto. El límite de modelo no debe ser corto por defecto. Sí debe existir un
límite finito y seguro por comando auxiliar, con salida acotada y terminación
del árbol de procesos.

Al terminar cada unidad, informa con evidencia real: archivos modificados,
tests ejecutados, resultado, limitaciones y siguiente decisión. Actualiza el
checklist/learnings/review-log cuando corresponda. No publiques éxito si solo
hay un artefacto histórico o un job en cola.
```

## Estado operativo confirmado

La última inspección de
/Users/alexherranz/.local/share/buzz-autonomy-pilot/sapira/pilot.db
encontró el siguiente lote principal, bajo la genealogía
native-19ff35e42381161defce49403d7bb121e0c8866f:

| Trabajo | Estado | Lectura correcta |
|---|---|---|
| arq-tower-frontier-verify | done, intento 2 | Entregó arquitectura y contrato en modo read-only; no modificó el repositorio. |
| diseno-tower-slice1-screen | failed, intento 2 | Hermes terminó con max_iterations_reached(16/16); no es un fallo por timeout de pared. |
| revisor-v3-contract | done, intento 2 | Hizo una revisión independiente del contrato; su veredicto no equivale a aprobar la implementación. |
| coder-tower-slice1-implementation | queued, intento 0 | No ha empezado porque el diseño requerido no está aceptado. |

Hay jobs históricos con nombres parecidos (tower-diseno-min,
tower-arquitecto, etc.). No mezclar su estado con el lote actual ni usar un
artefacto antiguo para cerrar silenciosamente una dependencia. Si se reutiliza
uno, registrar la decisión, el artefacto exacto y la razón de suficiencia.

La salud del relay local fue ok en http://localhost:3000/health. En la última
generación se observaron cuatro listeners de larga duración (Maestro,
Producto, Research y Arquitecto), configurados con una ventana de hasta siete
días. Revalidar con serve.py --status antes de relanzar: una generación vieja
de buzz-acp puede quedar huérfana si se mata solo al supervisor.

Validaciones ya ejecutadas:

- python3 -m unittest discover -s experiments/buzz-autonomy -p 'test_*.py' → 174 tests, OK.
- py_compile de los Python modificados → correcto.
- git diff --check → limpio.
- Carga del guard de comandos de Pi (pi_command_guard.ts) → correcta con PI_OFFLINE=1.
- Relay local → ok.

El estado global es: la resiliencia y el control plane tienen una base
funcional; la feature de Desktop aún no está construida y el Work Order no está
aceptado.

## Cambios ya realizados

Los cambios actuales se concentran en experiments/buzz-autonomy/ y cubren:

- Ciclo durable para Hermes y Pi: queued → running → done|failed|blocked|cancelled.
- Jobs Pi con intento, checkpoint, handoff y trace_id.
- Heartbeat y lease para trabajos lentos; recuperación de ejecuciones stale.
- Cancelación explícita sin borrar el checkpoint ni convertir el fallo en éxito.
- Tiempo de modelo largo por defecto; límite independiente por comando shell.
- Salida incremental acotada y terminación de descendientes/procesos anidados.
- Publicación de estados de operador y resumen determinista en lenguaje de negocio.
- Separación entre handoff técnico interno y comunicación dirigida a la persona.
- Pruebas en test_tower_project.py y cobertura adicional del control plane.
- Registro de aprendizajes L-001…L-015 en learnings.md.

El mensaje de negocio debe responder siempre: qué objetivo se ejecuta, en qué
estado está, qué impacto tiene, qué evidencia existe y cuál es la siguiente
acción. Los IDs, kinds y trazas son detalle secundario. Los mensajes crípticos
anteriores son históricos; no hace falta reescribirlos para validar la nueva
proyección.

## Lo que todavía falta

### Bloqueo inmediato

El diseñador no produjo el contrato de la sección completa dentro de 16 turnos.
La recuperación correcta es una de estas dos, documentada explícitamente:

1. Reintentar el mismo encargo con más presupuesto de turnos y un brief más
   acotado, conservando el intento anterior y su evidencia.
2. Aceptar un artefacto existente únicamente después de comprobar que cubre el
   brief actual: sección completa, vacío, error, foco/teclado, diferencia entre
   bloqueado y silencioso, y cobertura incompleta.

No basta con que tower/fila-cartera.html renderice: ese artefacto cubre una fila
y no necesariamente el shell de la sección.

### Entrega de producto pendiente

- Crear el dominio neutral de Tower y el puerto TowerSource.
- Crear el adaptador Buzz basado en eventos 43001–43006 y coste 44200.
- Implementar /tower detrás de FeatureGate y añadir la entrada de navegación.
- Mostrar proyectos una sola vez y agregar sus ejecuciones, agentes,
  workspaces, commits, PRs, trace_id y cobertura.
- Distinguir quiet, running, blocked, failed y unknown sin inventar causas ni
  convertir falta de datos en éxito.
- Añadir la prueba E2E de la cartera con bridge mock y estados reales de la UI.
- Hacer una revisión independiente sobre la implementación y una prueba manual
  de la tarea del operador.

### Puntos de diseño que no se deben perder

- La UI no importa Relay, Nostr ni kinds. Esa frontera se prueba mecánicamente.
- En el modelo portátil, run.id = trace_id y turn.id = span_id cuando hay
  traza; si no hay Collector, se muestra cobertura unavailable/partial, no un
  enlace roto.
- OTel es la profundidad portable; Buzz/Nostr es la proyección comunitaria
  legible y realtime. Tower no sustituye la observabilidad existente.
- El coste 44200 es owner-scoped. Nunca mostrar un total parcial como total
  completo: acompañarlo de observedAgents/totalAgents.
- Los proyectos y commits se correlacionan con GitHub; no crear un segundo
  historial de código dentro de Tower.
- Un heartbeat no debe convertirse en una conversación ruidosa. Usar TTL,
  muestreo y deduplicación; Tower debe poder marcar stale o coverage=partial.
- No añadir endpoints HTTP nuevos si un evento Nostr o el adaptador existente
  resuelve el caso.

## Archivos y artefactos de referencia

### Contrato y planificación

- .sw-factory/WO-001/work-order.md — alcance y criterios REQ-TOWER-POC-*.
- .sw-factory/WO-001/implementation-plan.md — estructura propuesta y pruebas.
- .sw-factory/WO-001/checklist.md — fases y certificación pendiente.
- .sw-factory/WO-001/learnings.md — fallos observados y decisiones de resiliencia.
- docs/goals/tower-control-plan.md — plan de producto y fases.
- docs/goals/tower-control-arranque.md — portabilidad, OTel y TowerSource.
- VISION_ACTIVITY.md — criterio de presentación: verbo, objeto, resultado.
- VISION_PROJECTS.md — proyectos, ramas, GitHub y agentes como contribuidores.

### Control plane

- experiments/buzz-autonomy/control_plane/tower_project.py — roles,
  dependencias, briefs y canal tower-control.
- experiments/buzz-autonomy/control_plane/launch_tower.py — launcher
  idempotente y reanudable.
- experiments/buzz-autonomy/control_plane/serve.py — listeners y parada del
  árbol de procesos.
- experiments/buzz-autonomy/control_plane/pi_harness.py — ejecución Pi,
  stream y checkpoint.
- experiments/buzz-autonomy/control_plane/runtime_policy.py — política de
  duración larga.
- experiments/buzz-autonomy/control_plane/pi_command_guard.ts — límite por
  comando auxiliar.
- experiments/buzz-autonomy/operator_updates.py — proyección para operador.
- experiments/buzz-autonomy/reporting.py — handoff y resumen legible.
- experiments/buzz-autonomy/test_tower_project.py — pruebas del ciclo Tower.

### Evidencia fuera del repositorio

- Base de jobs: /Users/alexherranz/.local/share/buzz-autonomy-pilot/sapira/pilot.db.
- Artefactos: /Users/alexherranz/.local/share/buzz-autonomy-pilot/sapira/artifacts/tower/.
- Canal comunitario Tower Control:
  55c3438a-e7e8-4d5c-acd9-6e066a8f178d.
- Relay local: http://localhost:3000.
- Railway compartido que debe conservarse y validarse solo en lectura durante
  este POC: proyectos 85c410fe-c0a5-46a1-b353-f8aece9ec435 y
  2014d617-6c0d-4cba-86a0-365a5622d69b.

### Referencia de configuración de agentes

Existe un checkout relacionado en
`/Users/alexherranz/Brein/projects/sapira-agent-fleet`. Es útil para entender
la configuración de agentes, pero tiene otra responsabilidad:

- `configs/fleet.registry.json` define quién existe (roster).
- `profiles/` define identidades y hogares aislados.
- `agents/<name>/` contiene código propio de cada agente.
- `hermes-agent-railway` es el runtime que los arranca; este repositorio de
  Buzz no debe asumir que el roster es el runtime.
- La regla de seguridad es un agente = un profile home = una GitHub App; las
  librerías declaradas en `reads[]` se leen, no se escriben.

Para WO-001, `sapira-agent-fleet` es una referencia de identidad, ownership y
aislamiento. No copiar su roster a Buzz ni hacer que Tower lea su base interna:
la ejecución local se registra en el control plane de Buzz y su resumen se
proyecta a la comunidad compartida. Si se modifica el roster o Railway, eso es
otra entrega y requiere su propio cambio/revisión.

## Bootstrap y diagnóstico seguro

Ejecutar desde la raíz, siempre revalidando el estado antes de mutar nada:

```bash
rtk git status --short --branch
rtk proxy curl -fsS http://localhost:3000/health
rtk proxy ~/.hermes/hermes-agent/venv/bin/python experiments/buzz-autonomy/control_plane/serve.py --status
rtk proxy sqlite3 -header -column /Users/alexherranz/.local/share/buzz-autonomy-pilot/sapira/pilot.db "SELECT id, role, status, attempts, datetime(created,'unixepoch','localtime') AS created, substr(replace(COALESCE(result,''), char(10), ' '), 1, 220) AS result FROM jobs WHERE id LIKE '%tower%' ORDER BY created;"
rtk proxy ~/.hermes/hermes-agent/venv/bin/python experiments/buzz-autonomy/control_plane/launch_tower.py --dry-run
```

Para listeners, usar --stop solo si se han identificado la generación y el
alcance exactos; después comprobar que no quedaron descendientes y arrancar una
sola generación. No lanzar duplicados de Maestro/roles ni ejecutar dos coders
que modifiquen los mismos archivos.

Para una ejecución del launcher, conservar la telemetría si está disponible:

```bash
rtk proxy env OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 \
  /Users/alexherranz/.hermes/hermes-agent/venv/bin/python \
  experiments/buzz-autonomy/control_plane/launch_tower.py --dry-run
```

El lanzamiento real no debe hacerse hasta resolver la dependencia de diseño:

```bash
rtk proxy env BUZZ_TURN_BUDGET=32 OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 \
  /Users/alexherranz/.hermes/hermes-agent/venv/bin/python \
  experiments/buzz-autonomy/control_plane/launch_tower.py --only diseno
```

El valor 32 es una propuesta diagnóstica, no una obligación: Claude debe
comprobar primero cómo se resuelve el lineage del lote actual para no crear un
job paralelo o pisar un intento existente. Si el encargo actual pertenece al
driver de mandato y no al launcher canónico, reanudar mediante el mecanismo de
ese driver y registrar el vínculo en la base.

## Secuencia recomendada de continuación

1. **Auditar sin mutar.** Leer este handover y el Work Order, comprobar git
   status, salud del relay, pilot.db, listeners y artefactos.
2. **Cerrar la decisión de diseño.** Leer el brief del diseñador, el resultado
   fallido y fila-cartera.html; decidir reintento o aceptación explícita de un
   artefacto suficiente. Registrar la decisión en learnings.md y en el job.
3. **No desbloquear por apariencia.** Solo permitir coder cuando el contrato
   de diseño cubra los estados y la interacción requerida.
4. **Implementar el dominio primero.** Crear tipos neutrales, normalización,
   cobertura y precedence de estados; añadir tests falsables.
5. **Implementar el adaptador Buzz.** Consultar eventos con kinds explícitos,
   respetar h para canales, conservar trazas/commits/PRs y marcar cobertura.
6. **Implementar la shell Desktop.** Reutilizar Pulse/Projects, registrar ruta,
   gate y navegación; usar tokens rem y semántica accesible.
7. **Verificar sobre el comportamiento real.** Ejecutar tests unitarios,
   typecheck, check:px-text, build E2E y una prueba manual de /tower.
8. **Revisar con independencia.** El revisor debe probar estados negativos,
   frontera de portabilidad, stale/coverage y que las pruebas fallen si se
   retira la guarda que protegen.
9. **Actualizar registros.** Marcar checklist solo con evidencia, añadir
   learnings nuevos y dejar review-log.md con veredicto explícito.

## Definition of Done de esta transferencia

- [ ] /tower existe, está gated y se abre desde la navegación Desktop.
- [ ] La UI consume TowerSource y no conoce Relay/Nostr/kinds.
- [ ] Buzz adapter y fixtures proyectan proyectos, runs, agentes, estados,
      cobertura, coste y referencias de GitHub/OTel.
- [ ] Running, blocked, quiet, failed, unknown, loading, empty y error son
      distinguibles y accesibles.
- [ ] Una persona entiende el estado y la siguiente acción sin descifrar IDs.
- [ ] Un modelo lento permanece visible/reanudable; cancelación y pérdida de
      lease dejan evidencia durable.
- [ ] No se sustituye la observabilidad profunda existente; se enlaza a ella.
- [ ] Suite del control plane, dominio, typecheck, check:px-text y E2E pasan.
- [ ] Revisión independiente registrada como APPROVED.
- [ ] No hay git push ni cambios en Railway sin autorización explícita.

## Regla de salida de Claude Code

Al cerrar una sesión, dejar en este documento o en learnings.md un bloque con:

```text
Fecha / commit local (si existe):
Estado del Work Order:
Trabajo realmente ejecutado:
Archivos modificados:
Pruebas ejecutadas y resultado:
Jobs/artefactos/eventos de evidencia:
Bloqueos o cobertura pendiente:
Siguiente acción concreta:
```

Un trabajo que solo creó un job, publicó un plan o dejó un proceso vivo no se
presenta como avance de producto. El criterio de progreso es una capacidad
observable, verificable y trazable.
