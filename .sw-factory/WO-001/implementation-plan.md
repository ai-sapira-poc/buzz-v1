<!--lint disable no-undefined-references strong-marker-->

# Implementation Plan: WO-001

**Work Order:** WO-001 — Tower Control community POC
**Created At (UTC):** 2026-09-15T12:51:25Z

## Summary

El POC entregará una primera cartera Tower Control visible en Buzz Desktop y
alimentada por un adaptador de eventos de trabajo. El dominio será OTel-neutro y
la UI dependerá de `TowerSource`; Buzz/Nostr será el adaptador inicial y los
enlaces a GitHub, Phoenix y Grafana serán evidencia externa. El equipo de
`tower_project.py` construirá el slice siguiendo sus dependencias; el trabajo
local se limita a integrar, verificar y mantener los artefactos de ejecución.

## Code Reuse And Package Structure

Se reutilizarán:

- `desktop/src/features/pulse/` para hooks, carga, error, refresco y composición
  de una superficie de actividad.
- `desktop/src/features/projects/` y `desktop/src/features/projects/hooks.ts`
  para enumeración de proyectos, repositorios y enlaces externos.
- `desktop/src/shared/api/readOnlyRelayClient.ts`, las funciones de query del
  relay y los tipos de eventos existentes para el adaptador Buzz.
- `desktop/src/features/sidebar/ui/AppSidebarPinnedHeader.tsx`, las rutas de
  `desktop/src/app/routes/` y `FeatureGate` para navegación y rollout.
- `desktop/tests/e2e/e2eBridge.ts` y los helpers de animación para la prueba
  visual sin depender de un relay real.
- `crates/buzz-core/src/kind.rs` como fuente única de los kinds; no se duplican
  números en la UI.

Archivos y directorios intencionados:

- `desktop/src/features/tower/domain/` — tipos neutrales, `TowerSource`,
  normalización, cobertura y reglas de estado; tests junto al dominio.
- `desktop/src/features/tower/ui/` — `TowerScreen`, cartera, fila, estados y
  descenso mínimo; sin imports de relay, Nostr o kinds.
- `desktop/src/shared/api/towerBuzzSource.ts` — adaptador de eventos Buzz a
  `TowerSource`, con fixtures/contrato.
- `desktop/src/app/routes/tower.tsx`, `desktop/src/app/routes.ts`,
  `desktop/src/features/sidebar/ui/AppSidebarPinnedHeader.tsx` y el registro de
  feature preview — wiring de navegación, sujeto al patrón existente.
- `desktop/tests/e2e/tower-control.spec.ts` — recorrido operativo del POC.
- `experiments/buzz-autonomy/test_tower_project.py` — cobertura del launcher y
  de la persistencia de delegación, si el hueco no está ya cubierto.
- `.sw-factory/WO-001/` — contexto, plan, checklist, revisión y handoff.
- `experiments/buzz-autonomy/control_plane/pi_harness.py` y los lanzadores ACP —
  ejecución larga, sesiones/checkpoints y límites operativos configurables.
- `experiments/buzz-autonomy/reporting.py` y
  `experiments/buzz-autonomy/operator_updates.py` — proyección legible para el
  operador, separada de los handoffs técnicos y con resumen determinista de los
  trabajos hijos.

## Components And Flow

Componentes y contratos:

```ts
type TowerSource = {
  listProjects(scope: TowerScope): Promise<TowerProject[]>;
  getProject(projectId: string): Promise<TowerProjectDetail>;
  getEvidence(runId: string): Promise<TowerEvidence>;
};

type TowerScope = { communityId: string; projectIds?: string[] };

type TowerProject = {
  id: string;
  name: string;
  repositories: TowerRepository[];
  workspaces: TowerWorkspace[];
  activeRuns: TowerRun[];
  status: "quiet" | "running" | "blocked" | "failed" | "unknown";
  coverage: TowerCoverage;
};

type TowerRun = {
  id: string; // trace_id cuando existe
  projectId: string;
  agentId?: string;
  workspaceId?: string;
  status: "requested" | "running" | "blocked" | "done" | "failed" | "unknown";
  commitSha?: string;
  pullRequestUrl?: string;
  traceId?: string;
  evidence: TowerEvidence[];
};
```

Flujo: `TowerScreen` obtiene la comunidad activa y llama a `useTowerProjects`;
el hook solo conoce `TowerSource`. `towerBuzzSource` consulta eventos y
proyectos, agrupa por `project.id`, resuelve los kinds 43001–43006 y conserva
`trace_id`, commit y PR como referencias. El dominio calcula el estado con
precedencia explícita (`failed/blocked` antes que `running`, y `unknown` cuando
la cobertura no permite afirmar el total). La fila renderiza la evidencia; para
detalle profundo abre GitHub o la URL configurada de Phoenix/Grafana.

El launcher del equipo es paralelo al producto: `launch_tower.py` usa el canal
de proyecto y la base de jobs como outbox de delegación. Producto, research y
arquitectura fijan el contrato; diseño y coder implementan; revisor y probador
falsan el resultado. Los dos harnesses pasan por el mismo ciclo de estado y
publican `started`/terminal; una dependencia fallida bloquea sus descendientes.
Una duración larga no es un fallo: el lease se renueva con heartbeat y el
checkpoint conserva el estado si el proceso muere. La cancelación es explícita;
el watchdog solo recupera una ejecución cuando desaparece el lease, no por
haber superado una cantidad arbitraria de minutos. No se deben crear
asignaciones paralelas que modifiquen los mismos archivos.

La comunicación tiene dos salidas: el protocolo técnico de handoff queda en los
eventos y artefactos para que los agentes lo consuman sin ambigüedad; una salida
determinista de operador publica inmediatamente el propósito, responsable,
estado, movimiento observable y próxima acción en lenguaje de negocio. El
resumen no depende de que el modelo termine su turno ni traduce silencio en
progreso.

## Steps

1. **Contexto y bootstrap** — documentar el Work Order, preservar el cambio
   preexistente del worktree y arrancar/reanudar el launcher del equipo. No tocar
   Railway ni publicar cambios Git.
2. **Observabilidad del launcher (corrección P0 observada)** — hacer durable el
   ciclo Pi igual que Hermes, publicar el arranque y el estado terminal, registrar
   heartbeat/trace cuando estén disponibles y detener descendientes cuando falta
   un handoff obligatorio. Añadir pruebas de fallo, reanudación e idempotencia.
3. **Resiliencia para modelos lentos** — retirar los límites de pared cortos de
   los wrappers de Tower, mantener un límite duro solo cuando esté configurado,
   conservar sesión y stream JSONL por intento, y cerrar el árbol de procesos al
   cancelar o alcanzar ese límite. El shell de Pi mantiene además un límite
   independiente por comando: el razonamiento puede durar días, pero una
   búsqueda o proceso auxiliar no puede monopolizar el turno indefinidamente.
   Validar un fixture que tarda más que el antiguo límite sin ser marcado como
   fallo y que `serve --stop` no deja listeners anidados huérfanos.
4. **Comunicación operativa (corrección P0 observada)** — publicar el estado de
   cada delegación y un resumen determinista de sus hijos, con lenguaje de
   negocio para el operador y detalle técnico relegado a evidencia. Cubrir
   publicación fallida, bloqueo, fallo y ausencia de avance sin fabricar éxito.
5. **Contrato de producto y arquitectura (delegado, paralelo)** — aceptar los
   entregables de `producto`, `research` y `arquitecto`; resolver explícitamente
   bloqueo, cobertura y coste owner-scoped antes de fijar la UI.
6. **Dominio y adaptador (delegado, conjuntos disjuntos)** — implementar
   `TowerSource`, tipos, normalización y tests; el adaptador Buzz no debe filtrarse
   en `domain` ni en `ui`.
7. **Shell y cartera (delegado tras 2–6)** — añadir ruta, sidebar, gate y fila
   con estados accesibles; reutilizar Pulse/Projects y tokens rem basados en
   Tailwind.
8. **Delegación real del POC** — el maestro publica handoffs en el canal
   `55c3438a-e7e8-4d5c-acd9-6e066a8f178d`; el coder trabaja sobre el checkout y
   el probador usa la app en ejecución. Cada resultado queda en el job/artifact
   correspondiente.
9. **Integración local** — revisar cambios del equipo, resolver conflictos,
   añadir únicamente wiring que no pertenezca a otro conjunto y conectar la
   fixture E2E.
10. **Review y verificación** — ejecutar tests, `pnpm check:px-text`, typecheck,
   E2E smoke y una prueba manual de `/tower`; un revisor distinto del coder
   registra `APPROVED` o solicita cambios.

## Testing

Automatización:

- `node --test desktop/src/features/tower/domain/*.test.mjs` y tests del
  adaptador.
- `python3 -m unittest discover -s experiments/buzz-autonomy -p 'test_tower*.py'`
  para el launcher si se añade esa cobertura.
- `cd desktop && pnpm check:px-text` y `pnpm exec tsc --noEmit`.
- `cd desktop && pnpm build:e2e && pnpm test:e2e:smoke -- tower-control` usando
  `installMockBridge` y `waitForAnimations` antes de cualquier captura.
- `rtk proxy env OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
  /Users/alexherranz/.hermes/hermes-agent/venv/bin/python
  experiments/buzz-autonomy/control_plane/launch_tower.py --dry-run` para
  comprobar el orden y la reanudación sin mutar el relay.
- `rtk proxy python3 -m unittest experiments/buzz-autonomy/test_tower_project.py`
  para comprobar que Pi y Hermes dejan estados terminales, que una publicación
  fallida no se convierte en éxito y que las dependencias impiden arrancar
  `coder` sin arquitectura.
- La misma suite debe cubrir que un proceso lento con heartbeat permanece
  `running`, que un proceso muerto deja checkpoint y que una cancelación explícita
  termina el árbol sin borrar el registro de reanudación.

Manual: con la app levantada, abrir `/tower`, comprobar que una línea bloqueada
no se confunde con una línea silenciosa, abrir una evidencia GitHub/trace cuando
exista y comprobar que los estados de vacío, error y carga tienen explicación.
