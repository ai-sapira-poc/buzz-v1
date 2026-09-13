# Qué trae Buzz y qué falta para la AI Product Factory

Inventario del código, no de la documentación: cada afirmación va con `fichero:línea`
y distingue **implementado de punta a punta** de **definido pero sin usar**. Esa
distinción es el objeto del documento — varias piezas que parecían listas no lo están,
y una que creíamos que faltaba ya está construida entera salvo la pantalla.

Investigado sobre `poc/buzz-autonomous-team` el 2026-09-13, en cuatro frentes
paralelos: observabilidad, proyectos y agentes, workflows y gobernanza, memoria y
conocimiento.

---

## 1. La corrección que más importa

**Dije que la puerta de aprobación estaba construida. No lo está.**

En `docs/estado-final-metodologia-buzz.md` escribí que `request_approval` era una
«puerta de aprobación **ya construida**». Es falso, y el error tiene consecuencias
porque la usé para argumentar que la gobernanza humana salía gratis.

Lo que ocurre de verdad: `request_approval` evalúa sus parámetros, genera un token y
devuelve `Suspended` (`crates/buzz-workflow/src/executor.rs:725-744`), con un TODO
explícito de que falta crear el registro y emitir el kind 46010. Y quien recibe ese
`Suspended` **falla la ejecución a propósito**:

```rust
// crates/buzz-workflow/src/lib.rs:229-236
if result.approval_token.is_some() {
    // Approval gates are not yet implemented (WF-08).
    // Fail explicitly rather than creating unreachable WaitingApproval rows.
```

Es decir: hoy, cualquier workflow que llegue a un paso de aprobación **muere ahí**.

Lo llamativo es que la otra mitad sí está entera. `handle_approval_grant` y
`handle_approval_deny` (`crates/buzz-relay/src/handlers/command_executor.rs:1020-1270`)
validan el registro, comprueban caducidad, reanudan la ejecución desde el paso
siguiente o la cancelan. Código correcto y completo, **inalcanzable**, porque nadie
crea nunca el registro que busca.

Dos límites más de la misma zona: el aprobador solo puede ser `any` o una pubkey
hexadecimal exacta — los aprobadores por rol tipo `@engineering-lead`, que usa el
**propio ejemplo del esquema** (`schema.rs:433`), se rechazan
(`command_executor.rs:1014-1017`). Y la caducidad solo se comprueba cuando alguien
intenta aprobar: no hay barrido que cierre una aprobación vencida.

---

## 2. El hallazgo con más palanca

**El protocolo de trabajo de agentes tiene toda la parte consumidora construida y
ningún productor.**

Los kinds 43001-43006 están definidos (`crates/buzz-core/src/kind.rs:518-528`), el
relay los agrega como actividad de primera clase en su feed materializado
(`crates/buzz-db/src/store/feed.rs:930-1002`), y el escritorio ya les pinta tarjetas
semánticas: «Job requested», «Job failed»… (`desktop/src/features/home/lib/inbox.ts:149-160`,
`FeedSection.tsx:65-76`).

Y **nadie los emite**. Cero referencias en `buzz-acp`, `buzz-agent`, `buzz-cli` o
`buzz-sdk`. No hay subcomando `buzz jobs`.

Esto invierte el orden de trabajo. No hay que construir una vista de ejecución: hay
que **emitir los eventos que la vista ya sabe pintar**. Nuestros agentes publicando
43001-43006 encienden el Inbox nativo sin tocar una línea de interfaz.

---

## 3. Observabilidad: el conducto existe, falta la pantalla

| Pieza | Estado | Evidencia |
|---|---|---|
| **NIP-AM kind 44200** — métrica de turno | **Productor real** | `buzz-acp/src/pool.rs:4910`, 13 puntos de llamada |
| Qué registra | tokens in/out/total, `cost_usd`, caché, modelo, harness, `stop_reason`, identidad de precio | `buzz-core/src/agent_turn_metric.rs` |
| Cifrado y acceso | NIP-44 al dueño; lectura p-gated con NIP-42 **en todas las rutas**, incluso por `ids` | `docs/nips/NIP-AM.md:238-241` |
| Archivo local | SQLite opcional con índice contable | `desktop/src-tauri/src/archive/metric_store.rs`, `agent_usage.rs` |
| **Visor** | **No existe** | Ningún componente consume coste/tokens; solo el interruptor de archivado |

El algoritmo de contabilidad está escrito y **no tiene consumidor**. Tower Control es,
literalmente, la pantalla que falta sobre datos que ya se producen y se archivan.

**NIP-AO kind 24200** (`buzz-acp/src/observer.rs`) da telemetría de sesión cifrada y
efímera agente↔dueño, con frames `acp_read`, `acp_write`, `turn_started`,
`session_resolved`. Y trae el control **`cancel_turn`** (`buzz-acp/src/lib.rs:1774`):
**intervenir un turno atascado es nativo**. Es exactamente la mitad operativa de la
resiliencia que estaba escribiendo en Python.

Dos avisos: NIP-AO es efímero por diseño —el relay no lo persiste ni lo indexa— y el
OTel del relay (`crates/buzz-relay/src/telemetry.rs`) es **solo trazas**, sin
métricas. Nuestra puerta OTel con semconv `gen_ai.*` sigue siendo nuestra, y es la que
da portabilidad.

Y una confusión que conviene deshacer: **Pulse no es observabilidad de agentes**. Es un
feed social de kind:1; su pestaña «agents» filtra notas por pubkeys conocidas
(`pulse/lib/groupAgentNotes.ts:21-55`). Nada de herramientas, ficheros ni turnos.

---

## 4. Memoria y conocimiento: lo mejor cubierto

| Pieza | Estado | Qué da |
|---|---|---|
| **`mem`** (NIP-AE, kind 30174) | Entero | Cifrado NIP-44, por par `(agente, dueño)`. `set`/`patch` con `--base-hash` contra conflictos, tombstones. **El `core` se inyecta solo al empezar sesión** (`buzz-acp/src/engram_fetch.rs:20-58`) |
| **`notes`** (NIP-23, kind 30023) | Entero | Base de conocimiento del equipo, en claro, reemplazable por coordenada, buscable |
| **`search`** | Entero | FTS de Postgres sobre **todos** los kinds por defecto, reautorizado por resultado |
| **`canvas`** (kind 40100) | Funciona, garantías débiles | **No es reemplazable ni NIP-33** (`kind.rs:776-788`): cada `set` es un evento nuevo, `get` coge `events.first()` sin orden explícito. Sin detección de conflictos |

La regla práctica: `notes` para lo compartido, `mem` para lo privado del agente,
`search` para reencontrar ambos. **`canvas` no sirve como memoria** — dos escritores
concurrentes se pisan sin que nadie se entere.

Nota: los engramas están indexados por FTS pero su contenido es cifrado, así que
buscarlos no devuelve nada útil.

---

## 5. Proyectos, agentes y equipos: agrupación, no orquestación

**Projects** (NIP-MP kind 30621) está completo y es **solo metadatos**: slug, nombre,
hasta 64 repos, un canal, visibilidad. Sin hitos, sin miembros, sin estados. Y la
pertenencia a un proyecto **no otorga ninguna autoridad** sobre sus repos.

**Personas** (30175), **Teams** (30176), **Managed Agents** (30177) y **Team Catalog**
(30178) están vivos. Un Team es `nombre + descripción + lista ordenada de personas`:
un censo, no un grafo de trabajo. Y el CRUD de personas y equipos **no tiene CLI** —
es exclusivo del escritorio.

**La gobernanza de identidad sí está bien resuelta**: `buzz agents` solo sabe hacer
borradores. Un agente no puede crear otro agente; abre un formulario en tu Desktop
para que lo revises. La fábrica puede proponer expandirse, no expandirse sola.

**Issues NIP-34 — y aquí matizo otra cosa que dije.** Afirmé que eran «asignables a
agentes» con estados, como si fuera garantía del relay. Mecánicamente es cierto, pero
**asignación y estado son convención de cliente**: `buzz issues assign` publica un
kind:1 con `t=assignment` y una reducción de confianza en el cliente
(`buzz-cli/src/commands/issues.rs:143-216,301-323`), y los kinds de estado 1630-1633
solo requieren `Scope::MessagesWrite` — el mismo permiso que cualquier mensaje. No hay
comprobación relay-side de quién puede cambiar un estado. Sirven perfectamente como
unidad de trabajo de un equipo que coopera; **no son una puerta de autoridad**.

Una discrepancia que conviene verificar con quien lleve el NIP: `NIP-PMA.md:3-5` dice
que el kind 30179 debe rechazarse hasta desplegar sus garantías, pero
`buzz-relay/src/handlers/ingest.rs:437-445` ya lo acepta.

---

## 6. Automatización: el cron es sólido, el resto tiene bordes

**Cron** es real y bien hecho: corre dentro del relay (`buzz-relay/src/main.rs:720-722`),
tick de 60 s, y cada disparo se reclama de forma **durable y at-most-once** por
`(community, workflow, scheduled_for)` (`buzz-workflow/src/lib.rs:624-647`), así que
sobrevive a reinicios y a varios pods. Revalida la autoridad del dueño antes de cada
disparo. **No hay backfill**: lo que se pierde mientras el relay está caído, se pierde.

**`send_message` sí resuelve `@Nombre` a tag `p`** (`buzz-relay/src/workflow_sink.rs:152`),
con un matiz de seguridad bien pensado: solo las menciones presentes en la plantilla
escrita por el dueño reciben el tag con autoridad `buzz:workflow-mention`; una mención
inyectada por una variable del trigger obtiene un `p` pelado. Ya han pensado en
inyección de prompt.

Bordes que hay que conocer antes de diseñar encima:

- `send_dm` y `set_channel_topic` **no están implementados** (`executor.rs:655-665`).
- `delay` está limitado a 270 s, en proceso.
- **No hay reintentos ni backoff en ningún punto del motor.** El primer fallo de un
  paso mata la ejecución entera.
- **`buzz workflows runs` es un stub documentado**: el propio comentario del CLI dice
  que el relay no emite eventos de ejecución y que devolverá un array vacío
  (`buzz-cli/src/commands/workflows.rs:60-95`). El historial solo existe en la tabla
  `workflow_runs`, sin ninguna ruta de lectura expuesta.

**Auditoría**: la cadena de hash es real y está enganchada en 16 ficheros del relay,
pero su enum de acciones es genérico (`buzz-audit/src/action.rs:8-31`). La actividad de
workflows y aprobaciones aparece como un `EventCreated` opaco — está registrada, pero
no es distinguible como acción de gobernanza sin decodificarla tú.

---

## 7. Autodescubrimiento: el hueco real

**Un agente no puede publicar una capacidad nueva para el equipo.** No hay
`write_skill` ni `publish_skill` (cero resultados en `crates/`), no hay kind de Nostr
para una skill (cero resultados en `kind.rs`), y `buzz pack` solo sabe `validate` e
`inspect`.

Las skills son ficheros `SKILL.md` bajo `$AGENT_CWD/.agents/skills/`, escaneados **al
lanzar el proceso** vía `--skill <dir>`. La única herramienta de ejecución es
`load_skill`, que lee (`buzz-agent/src/builtin.rs:16-40`). Y el paso que permitiría a
un pack repartir sus skills está marcado como «planned for a future release» en el
propio spec (`PERSONA_PACK_SPEC.md:312-314`).

Hay una vía emergente: un agente con herramienta de edición puede escribir un
`SKILL.md` en ese directorio. Pero al ser un escaneo de arranque, **no surtiría efecto
hasta la siguiente sesión**, y no llegaría a sus compañeros.

El diseño natural, si lo construimos, es el que ya insinúa el producto: publicar la
skill como **nota NIP-23 con una etiqueta `t: skill`** —las notas ya son compartidas,
reemplazables y buscables— y que el harness sincronice las notas que casen hacia
`.agents/skills/`. Eso reusa tres primitivas existentes en lugar de inventar un kind.

---

## 8. El mapa

| Capacidad de la fábrica | Veredicto |
|---|---|
| Memoria del agente y conocimiento del equipo | **Ya está.** `mem` + `notes` + `search` |
| Coste y consumo por turno | **El conducto está; falta la pantalla** |
| Ver la ejecución paso a paso | **La vista está; faltan los eventos** (43001-43006 sin productor) |
| Intervenir un turno atascado | **Ya está.** `cancel_turn` de NIP-AO |
| Cadencia y despertar a un agente | **Ya está.** Cron + `send_message` con mención resuelta |
| Identidad de agentes con revisión humana | **Ya está.** `buzz agents` solo hace borradores |
| Agrupar repos y equipos | **Ya está**, como censo |
| **Aprobación humana en un workflow** | **Media construida.** El request falla la ejecución |
| **Reintentos y recuperación** | **No existe** en el motor de workflows |
| **Historial de ejecuciones legible** | **No expuesto.** El CLI es un stub |
| **Juicio sobre el registro** (atascado/bloqueado/improductivo) | **Nuestro.** Buzz no lo tiene |
| **Telemetría portable fuera de Buzz** | **Nuestra.** NIP-AO es efímero; el OTel del relay no tiene métricas |
| **Publicar capacidades nuevas** | **Hueco real.** Ni kind, ni verbo, ni herramienta |

---

## 9. Lo que significa para el trabajo

Nuestra capa se estrecha y se aclara: **gobernanza, observabilidad ampliada y
orquestación**, encima de un sustrato que ya resuelve identidad, memoria, mensajería,
cadencia y control de turno.

Tres de nuestros huecos son, en realidad, contribuciones al producto Buzz más que
parches nuestros: emitir el protocolo de trabajo, cerrar WF-08, y publicar skills. Vale
la pena tratarlos como tales.

Y antes de nada, **sincronizar el fork**: 29 comits por detrás, con el adaptador propio
de π (que retira nuestra dependencia de un tercero en 0.0.x), el scope de sesión por
agente, y un arreglo de hilos ACP retenidos que es el primer sitio donde mirar el
silencio del maestro.
