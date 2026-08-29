Estado final: (A) las skills de los agentes están versionadas con
git, (B) el cliente desktop tiene una vista de "perfil del agente" de
solo lectura con sus skills y evals, y (C) existe una "Skills library"
global con importación de skills existentes y creación de nuevas.
Todo verificado con tests, en trabajo autónomo con estas condiciones:

ETAPA 0 · Contrato de archivos (primero, bloquea el resto):
- Escribe docs/spec-agent-profile.md definiendo el contrato en disco,
  coherente con lo existente y con docs/plan-agent-creator.md:
  estructura de una skill (SKILL.md + archivos de apoyo) y estructura
  de evals por agente: evals/caso-NN.md (input, output esperado,
  origen: nacimiento o feedback, con fecha y autor),
  evals/feedback-log.md (anotaciones normalizadas) y
  evals/boletin-ultimo.md (resultado del runner: puntuación por caso
  y tendencia). Nombres y formatos exactos.
- Crea fixtures de ejemplo del contrato en test-fixtures/ para
  desarrollar y testear sin datos reales.
- Crea el spec y los fixtures DENTRO del worktree de la Etapa B
  (créalo primero si hace falta), de modo que viajen commiteados en
  la rama feat/agent-profile y no queden como archivos sin trackear
  en el checkout principal.

ETAPA A · Versionado (fuera del repo):
- git init en ~/.buzz/.agents/skills con .gitignore sensato y commit
  inicial "estado actual". Documenta en el spec la convención de
  commits (un commit por cambio de skill, mensaje con agente/origen y
  motivo) que meta-skill, Library y futuros agentes deberán seguir.
- Sin remotos ni hooks; local y simple.

ETAPA B · Perfil del agente (worktree ~/Projects/buzz-v1-perfil, rama
feat/agent-profile desde main):
- En desktop/src/features/agents, siguiendo el patrón de secciones de
  AgentConfigPanel: sección "Skills" (las que el runtime de ESE agente
  descubriría según las reglas reales — cwd y home de
  buzz-agent/src/hints.rs, y las del runtime claude — distinguiendo
  "globales de la máquina" de específicas, con el SKILL.md renderizado
  al abrir) y sección "Evals" (casos con origen, último boletín y log
  de feedback, renderizados desde el contrato).
- SOLO LECTURA en el perfil: nada de crear/editar/borrar aquí.

ETAPA C · Skills library (misma rama):
- En la página de Agents, junto a "Agent defaults", botón "Skills
  library" que abre un panel lateral derecho expandible y
  redimensionable reutilizando el patrón de panel del visor de
  artefactos (pane acoplado), NO un modal.
- Contenido: inventario global de skills de la máquina con buscador
  simple y, por skill: nombre, descripción de activación, qué
  runtimes/agentes la ven, y SKILL.md renderizado.
- PRIORIDAD 1, importar (el caso de uso principal es migrar skills
  existentes de Claude Code): acción de importar que permite elegir
  un directorio de skills o carpeta de skill del disco (p. ej.
  ~/.claude/skills o el .claude/skills de un proyecto) y muestra
  antes de confirmar un resumen por skill: nombre (kebab-case validado
  y COLISIONES con las existentes — si choca, pedir renombrar, nunca
  sobrescribir en silencio), descripción de activación detectada
  (marcando en rojo las skills sin descripción o con descripción
  genérica, editable en el momento: es el campo que decide la
  autoactivación y, en Buzz, el riesgo de secuestrar turnos de otros
  agentes) y archivos de apoyo. Al confirmar: copia al canónico
  ~/.buzz/.agents/skills/<nombre>/, symlinks por runtime
  (.claude/skills, .goose/skills), un commit de git POR skill
  (mensaje "importada de <origen>") y aviso de qué agentes la verán
  y cuáles necesitan reinicio (L1).
- PRIORIDAD 2, crear desde cero: formulario mínimo (nombre kebab-case
  validado, descripción de activación con ayuda contextual que la
  trate como campo de primera clase e incluya exclusiones, cuerpo en
  markdown). Misma escritura: canónico + symlinks + commit + aviso de
  reinicios.
- Edición: v1 solo cuerpo y descripción, commit por guardado. Sin
  borrado en v1.

TAURI Y SEGURIDAD:
- Comandos nuevos de lectura/escritura en archivos propios con
  registro mínimo; rutas permitidas acotadas a los directorios de
  skills y evals (nunca acceso arbitrario al filesystem), con tests
  de ese límite.

TESTS:
- Unitarios: descubrimiento por runtime, parseo del contrato (con
  fixtures), validación de nombres, escritura conforme (canónico +
  symlinks + commit).
- e2e: render de las dos secciones del perfil; flujo completo de
  importación con fixture de 2-3 skills que incluya una colisión de
  nombre y una sin descripción (para ejercitar ambos avisos) y
  verificación en lista, perfil y log de git; crear una skill desde
  el formulario y verla aparecer.
- Tests dirigidos durante el desarrollo; suite completa una sola vez
  al cierre.

ENTREGA: la rama queda lista pero SIN mergear — el merge lo apruebo
yo tras verificación manual. Reporte final con qué construiste, qué
verificaste, hallazgos, y el guion de mi verificación manual paso a
paso (incluyendo cómo arrancar la app desde el worktree para verla).

RESTRICCIONES: no toques markdown.tsx, la zona de chat/link-previews,
el ArtifactPanel ni la CSP de tauri.conf.json (otra sesión trabaja la
Fase B ahí); ninguna operación de git que mueva checkouts o worktrees
ajenos, y toda operación de git se anuncia antes de ejecutarla;
máximo 30 iteraciones, y en el límite o ante un bloqueo, para y
resume el estado en vez de forzar el objetivo.
