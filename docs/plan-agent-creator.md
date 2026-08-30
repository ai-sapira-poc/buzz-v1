# Plan — Agent Builder conversacional ("crear-agentes")

Status: **Bloque 1 implementado y verificado; Bloque 2 pendiente.**
Decisiones de §11 cerradas. Verificación: `~/.buzz/.agents/skills/crear-agentes/scripts/verificar.sh`.
Scope: `crates/buzz-cli`, `crates/buzz-agent`, `desktop/src/features/agents`, `desktop/src-tauri`.
Companion: `docs/plan-artifact-preview.md` (§ colisión de ramas, §8).

> Este documento está en castellano, a diferencia del resto de `docs/`, porque el
> encargo y la revisión son en castellano. Los identificadores de código, rutas y
> nombres de comando se mantienen literales.

---

## 0. Resumen ejecutivo — la respuesta a la pregunta central

**¿Puede un agente dar de alta a otro agente de principio a fin?**

Hoy: **no**, y falla por **un solo punto**, no por muchos. Todo el ciclo de alta es
ejecutable por un agente con shell salvo **un paso**: firmar el tag `auth` de
**NIP-OA**, que vincula el agente nuevo a su dueño humano. Esa firma requiere la
**clave secreta del dueño**, que vive en el keyring del Desktop y **nunca** se
expone al proceso del agente.

La evidencia es directa:

```rust
// crates/buzz-sdk/src/nip_oa.rs:146
pub fn compute_auth_tag(owner_keys: &Keys, agent_pubkey: &PublicKey, conditions: &str)
    -> Result<String, SdkError> {
    ...
    let sig = owner_keys.sign_schnorr(&message);   // ← clave secreta del DUEÑO
}
```

```rust
// desktop/src-tauri/src/commands/agents.rs:475  (create_managed_agent, Fase 2)
let owner_keys = state.signing_keys()?;           // ← keyring del Desktop
let tag = buzz_sdk_pkg::nip_oa::compute_auth_tag(&compat_owner, &compat_agent, "")?;
```

Y el agente sólo recibe **su propia** identidad, nunca la del dueño
(`desktop/src-tauri/src/managed_agents/runtime.rs:533`):
`BUZZ_PRIVATE_KEY` (clave del propio agente), `BUZZ_RELAY_URL`, `BUZZ_AUTH_TAG`
(el tag ya firmado que prueba *su* dueño). `BUZZ_PRIVATE_KEY` y `BUZZ_AUTH_TAG`
están además en `RESERVED_ENV_KEYS`
(`desktop/src-tauri/src/managed_agents/reserved_env_keys.rs:28`), así que no hay
ruta de escape por configuración.

**Corolario de diseño:** la hipótesis del encargo se **corrige parcialmente**.
El master agent sí puede ser "un agente con shell + una meta-skill", y esa
meta-skill cubre el 90 % del trabajo de valor (entrevista, redacción de persona,
redacción de skills, validaciones L1–L4, escritura en filesystem). Pero la
**creación directa desde el chat exige código del fork**: hace falta un
componente privilegiado que sostenga la clave del dueño y ejecute el alta en su
nombre. No es opcional ni evitable con más prompt.

**La buena noticia:** ese componente **ya existe y ya está conectado**. El canal
`agent_management_request` (frame observer cifrado kind 24200, CLI →
Desktop del dueño) transporta hoy `draft-create`, y el Desktop ya sabe ejecutar
el alta completa al recibirlo — sólo que **exige un clic humano en el
AgentDialog**. Convertir (c) en (b) **no requiere transporte nuevo, ni endpoint
HTTP nuevo, ni socket local**: requiere extender el payload existente y añadir
una ruta de auto-aplicación en el Desktop, con una prueba de aprobación
verificable. Eso es lo que propone el **Bloque 2**.

**Segunda corrección a la hipótesis:** el registro en la comunidad **no es un
paso**. Es un efecto secundario automático de la primera conexión autenticada
(§1.4). Eso simplifica el alta más de lo que el encargo asumía.

---

## 1. El ciclo de alta, paso por paso, clasificado

Clasificación pedida: **(a)** un agente con shell lo hace hoy · **(b)** lo haría
con un comando/endpoint pequeño a añadir · **(c)** requiere al humano en la UI.
Para todo (c) se propone su conversión a (b) — ninguno se acepta como manual.

| # | Paso | Hoy | Evidencia | Destino |
|---|---|---|---|---|
| 1 | Generar par de claves | **(a)** | `Keys::generate()`; cualquier utilidad nostr sirve. Un agente con shell puede generarlas. | (a) — pero ver §1.1: **conviene que no lo haga él** |
| 2 | **Firmar el tag `auth` NIP-OA** | **(c)** | `nip_oa.rs:146` exige `owner_keys.sign_schnorr`. Sin clave del dueño no hay alta legítima. | **(b)** — §2 |
| 3 | Escribir la persona (prompt, runtime, modelo) | **(c)** | La persona vive en el store unificado `managed-agents.json` (app_data_dir), junto a claves privadas. `storage.rs:48`. | **(b)** — §2 |
| 4 | Escribir las skills en el filesystem | **(a)** | `~/.buzz/.agents/skills/<nombre>/SKILL.md` con shell. Ver §4 (L2). | (a) ✔ |
| 5 | Configurar MCP del agente nuevo | **(a)/(n-a)** | Ver §5: no es configurable por agente; se hereda del runtime. | (a) para claude/goose; **no configurable** para buzz-agent/codex |
| 6 | Registro en la comunidad | **(a) automático** | §1.4 — no es un paso. | (a) ✔ |
| 7 | Elegir runtime | **(a)** | Catálogo estático de 4: `goose`, `claude`, `codex`, `buzz-agent` (`discovery.rs:88–116`). El agente puede elegir por nombre; la validación de disponibilidad la hace el Desktop. | (a) para elegir, (b) para validar |
| 8 | Arrancar el proceso | **(c)** | El spawn lo hace el Desktop (`runtime.rs:523`), que mantiene el registro de PIDs, logs, reconciliación y sweep de huérfanos. | **(b)** — §2 |
| 9 | Añadir al canal como miembro | **(a)** | `buzz channels add-member --channel <uuid> --pubkey <hex> --role bot` (`lib.rs:684`). | (a) ✔ |
| 10 | Presentarlo en el canal | **(a)** | `buzz messages send --channel <uuid> --text ...` | (a) ✔ |

### 1.1 Por qué el agente **no debe** generar las claves aunque pueda

Técnicamente (a). Operativamente, mala idea: la nsec del agente nuevo tendría que
viajar del master agent al Desktop para persistirse en `managed-agents.json`, lo
que la expone en el prompt, en los logs del harness y en el frame observer. El
Desktop ya genera claves en un bloque con lock y sin salida
(`agents.rs:440`, Fase 1). **Recomendación: el paso 1 se delega al Desktop
junto con el 2 y el 3.** El master agent nunca toca material de clave.

### 1.2 Los tres pasos que hay que desbloquear son en realidad uno

Los pasos 2, 3 y 8 caen todos del mismo lado de la frontera de confianza y los
ejecuta **la misma función**: `create_managed_agent`
(`desktop/src-tauri/src/commands/agents.rs:380`), seguida de
`start_managed_agent`. No hacen falta tres desbloqueos: hace falta **una** ruta
autenticada para invocar la secuencia que el Desktop ya ejecuta cuando el humano
pulsa Guardar.

### 1.3 Lo que el Desktop ya hace al pulsar Guardar

`useAgentManagement.submitCreate` (`desktop/src/features/agents/useAgentManagement.ts:178`)
ejecuta exactamente la secuencia que queremos automatizar:

1. `assertAgentCanActFromOrigin(channelId)` — el agente peticionario y el canal
   destino deben ser ambos miembros de un canal al que el dueño pertenece.
2. Resolver runtime disponible (`availableRuntimesForStart`).
3. `createPersonaMutation` → persona persistida.
4. `createAgentMutation` → claves + tag NIP-OA + registro + spawn.
5. `presentCreatedAgent` → `attachManagedAgentToChannel(role: "bot", ensureRunning: true)`.

**Ya existe una comprobación de autorización agente→canal.** El Bloque 2 no
inventa gobernanza desde cero: la endurece (§3).

### 1.4 El registro en la comunidad es automático — no es un paso

Hallazgo relevante para el plan: **no hay que registrar el agente en la
comunidad**. Ocurre solo, la primera vez que el agente se conecta al relay con
un tag `auth` válido:

```rust
// crates/buzz-relay/src/api/mod.rs:176  materialize_nip_oa_owner
for (role, pubkey) in [("agent", agent), ("owner", owner)] {
    state.db.ensure_user(tenant.community(), pubkey.as_bytes()).await   // ← alta implícita
}
state.db.set_agent_owner(tenant.community(), agent.as_bytes(), owner.as_bytes()).await
```

El relay da de alta a **agente y dueño** y materializa el vínculo de propiedad a
partir del tag. Consecuencia: **quien controla el tag `auth`, controla la
propiedad**. Refuerza que el paso 2 es el único cuello de botella real, y que
protegerlo protege todo lo demás.

### 1.5 Un agente sin modelo no se cuelga: entra en *setup mode*

`crates/buzz-acp/src/setup_mode.rs:309` — un agente creado sin configuración
válida arranca igualmente, se suscribe a menciones y responde con un *nudge* de
configuración en vez de trabajar. Útil para el Bloque 1: **un alta incompleta
degrada de forma visible y recuperable**, no en un fallo silencioso.

---

## 2. Convertir cada (c) en (b): el mecanismo mínimo

### 2.1 El transporte ya existe — no hace falta inventar ninguno

Un `#[tauri::command]` **no es invocable desde un subproceso**: sólo desde el
webview. Así que "añadir un comando Tauri" no basta por sí solo; hace falta un
transporte. Se evaluaron tres:

| Opción | Coste | Superficie nueva | Veredicto |
|---|---|---|---|
| Socket unix / HTTP local en el Desktop | Alto | Puerto/socket nuevo, autenticación nueva, `lib.rs` tocado en la zona de protocolos | **Descartada** — colisiona con A2 (§8) y duplica seguridad ya resuelta |
| Escritura directa del agente en `managed-agents.json` | Bajo | Ninguna | **Descartada** — el fichero contiene nsecs, el Desktop lo cachea en memoria y no recarga; además no resuelve el paso 2 |
| **Extender el frame observer `agent_management_request`** | Bajo | Ninguna — canal ya cifrado, ya autenticado, ya *owner-scoped* | **Elegida** |

El canal elegido ya está construido y probado de punta a punta:

```
buzz agents draft-create                      (crates/buzz-cli/src/agent_management.rs:137)
  → ObserverEvent{kind:"agent_management_request", action:"create", requestId, request{…}}
  → encrypt_observer_payload(agent_keys → owner_pubkey)        NIP-44 al dueño
  → build_agent_observer_frame  kind 24200, tag p=<owner>      firmado por el agente
  → relay (sólo el dueño puede descifrarlo)
  → observerRelayStore.handleRelayObserverEvent               (observerRelayStore.ts:545)
       · verifica que el frame venga de un agente conocido
       · verifica event.pubkey == agente declarado
  → parseAgentManagementRequest                                (agentManagement.ts:55)
  → useAgentManagement → AgentDialog                           ← ÚNICO punto manual
```

**Todo el pipeline es reutilizable. El único cambio es el último salto.**

### 2.2 Los cambios mínimos del fork

**(b1) — Payload de creación completo.** Hoy `draft-create` sólo transporta
`channelId`, `displayName`, `systemPrompt`
(`agentManagement.ts:12`, con `hasOnlyKeys` cerrando el contrato a esos tres).
Un alta real necesita además `runtime`, `provider`, `model`, `respondTo`,
`envVars`, `skills`. Cambio: nueva `action: "create_direct"` con su propio
validador estricto — **sin tocar** el contrato `create` existente, para que
`draft-create` siga funcionando igual.

- `crates/buzz-cli/src/lib.rs` — nuevo subcomando `buzz agents create`.
- `crates/buzz-cli/src/agent_management.rs` — `build_create_direct`.
- `desktop/src/features/agents/agentManagement.ts` — parser de `create_direct`.

**(b2) — Prueba de aprobación verificable.** El master agent adjunta
`approvalEventId`: el id del mensaje del humano en el canal que aprueba el
resumen. El Desktop lo obtiene del relay y comprueba, **antes de crear nada**:

1. el evento existe y su `pubkey` **es el del dueño de este Desktop**;
2. su tag `h` es el `channelId` de la petición;
3. su `created_at` es posterior al del resumen publicado por el master agent;
4. su contenido contiene el `requestId` (o un token corto derivado de él);
5. el `requestId` no se ha consumido antes (anti-replay; ya existe
   `seenRequestIds` en `useAgentManagement.ts:73`).

Esto es **más fuerte** que la disciplina de la meta-skill: la aprobación se
verifica criptográficamente contra la clave del dueño, no se asume del relato
del agente. Un master agent comprometido o alucinando no puede fabricarla.

- `desktop/src/features/agents/agentManagement.ts` — campo + validación.
- `desktop/src/features/agents/useAgentManagement.ts` — verificación previa.
- Lectura del evento: reutiliza el camino de `get_channel_messages_before` /
  `get_feed` (`desktop/src-tauri/src/commands/messages.rs:50,364`).

**(b3) — Ruta de auto-aplicación.** Al validar (b2), invocar directamente la
secuencia de `submitCreate` (§1.3) sin abrir el diálogo. Es refactor de una
función ya escrita, no lógica nueva.

**(b4) — Acuse de vuelta al canal.** El Desktop publica el resultado
(pubkey del agente nuevo, estado, error de spawn si lo hubo) para que el master
agent pueda presentarlo. Vía más simple: `send_managed_agent_channel_message`
(`messages.rs:698`), que ya existe.

**(b5) — Reinicio de agentes (para L1, §4).** `buzz agents restart --name <n>`,
por el mismo canal observer. Necesario porque las skills se enumeran al crear la
sesión; sin esto, la meta-skill puede avisar del reinicio pero no ejecutarlo.

### 2.3 Lo que este diseño deliberadamente **no** hace

- No expone la clave del dueño al agente, en ningún momento ni forma.
- No añade puerto, socket, ni esquema URI nuevo.
- No toca `desktop/src-tauri/src/lib.rs` en la zona de protocolos (§8).
- No permite crear un agente sin aprobación humana verificable.
- No permite a un agente crear agentes para un dueño que no sea el suyo (§3.1).

---

## 3. Gobernanza de la creación directa

### 3.1 Propiedad — el punto delicado, y tiene una trampa

Requisito: el agente nuevo debe quedar vinculado **al humano que lo pidió**,
nunca al master agent.

La primera mitad está garantizada por construcción y es imposible de violar:
`compute_auth_tag` **rechaza la auto-atestación** (`nip_oa.rs:152`,
`owner == agent` → error), y el Desktop firma siempre con `state.signing_keys()`.
Un agente **no puede** ser dueño de otro agente. ✔

**La trampa está en la segunda mitad.** El dueño resultante es siempre *el humano
de este Desktop*, que es también el dueño del master agent — pero **no
necesariamente quien pidió el agente en el canal**. Si Ana pide un agente en un
canal donde corre el master agent de Beto, el alta directa lo crearía como
propiedad de **Beto**, en la máquina de Beto, silenciosamente.

Esto **no** es hipotético: el master agent conoce el pubkey del peticionario
—llega en el bloque `[Context]` del prompt, campo `From: <label> (npub:…, hex:…)`
(`crates/buzz-acp/src/queue.rs:1136`)— y el `BUZZ_AUTH_TAG` le dice quién es su
propio dueño (`crates/buzz-acp/src/lib.rs:143`). Es decir: **la información para
detectarlo está disponible en ambos lados**.

**Requisito de diseño (bloqueante para el Bloque 2):** el Desktop debe comparar
el `pubkey` del `approvalEventId` con su propio dueño y **rechazar el alta si no
coinciden**, con un error explícito que el master agent devuelve al canal:
*"sólo <dueño> puede dar de alta agentes en este Desktop; pídeselo a él"*.
La meta-skill debe además detectarlo antes y no llegar a intentarlo.

Esta comprobación es **estrictamente más fuerte** que la que existe hoy
(`assertAgentCanActFromOrigin`, `useAgentManagement.ts:160`), que sólo verifica
co-membresía en el canal. Hay que añadirla; no está.

### 3.2 Confirmación previa — los approval gates de buzz-workflow **no sirven**

Investigado y descartado con evidencia. Los gates están **sin implementar** y el
código falla el run explícitamente:

```rust
// crates/buzz-workflow/src/lib.rs:229
if result.approval_token.is_some() {
    // Approval gates are not yet implemented (WF-08).
    // Fail explicitly rather than creating unreachable WaitingApproval rows.
    ... RunStatus::Failed, code: "approval_not_supported"
}
```

Existen los tipos (`executor.rs:477`, `1026`) y el schema los parsea
(`schema.rs:428`), pero el ejecutor los convierte en fallo. **Usarlos hoy
rompería el flujo.** Implementar WF-08 es un proyecto propio, fuera de alcance.

**Decisión:**
- **Bloque 1** — disciplina de la meta-skill: publicar resumen, esperar respuesta
  afirmativa, no proceder sin ella. Suficiente porque el alta la remata un humano
  en la UI de todos modos.
- **Bloque 2** — **no basta la disciplina**. La aprobación se convierte en
  `approvalEventId` verificado por el Desktop (§2.2 b2). La disciplina de la
  skill se mantiene como capa de UX; la garantía la da la verificación.

### 3.3 Límites de nacimiento — inventario real

Configurable en el alta hoy (`CreateManagedAgentRequest`,
`desktop/src-tauri/src/managed_agents/types/requests.rs:132`):

| Límite | Campo | Estado |
|---|---|---|
| Modelo | `model` | ✔ configurable |
| Proveedor | `provider` | ✔ configurable |
| Runtime | `agent_command` + `harness_override` | ✔ configurable (4 del catálogo) |
| Quién puede invocarlo | `respond_to` (`owner-only` \| `allowlist` \| `anyone`) + `respond_to_allowlist` | ✔ configurable; **defecto `OwnerOnly`** (`types.rs:800`) |
| Canales donde actúa | `env_vars["BUZZ_ACP_CHANNELS"]` + `BUZZ_ACP_SUBSCRIBE` | ✔ configurable — **no** están en `RESERVED_ENV_KEYS`. **Pero ver aviso ↓** |
| Concurrencia | `parallelism` (1–32) | ✔ configurable |
| Inactividad / duración de turno | `idle_timeout_seconds`, `max_turn_duration_seconds` | ✔ configurable |
| Arranque automático | `start_on_app_launch`, `spawn_after_create` | ✔ configurable |
| Relay | `relay_url` | ✔ configurable |
| Variables de entorno | `env_vars` (validadas contra `RESERVED_ENV_KEYS`) | ✔ configurable |

**Aviso importante sobre "canales donde puede actuar":** `BUZZ_ACP_CHANNELS`
(`crates/buzz-acp/src/config.rs:341`) es un **filtro de suscripción, no una
frontera de permisos**. Limita a qué canales *escucha*; no impide que publique en
cualquier canal del que sea miembro. La frontera real es la **membresía de canal**
más `respond_to`. La meta-skill debe decirlo así al usuario y no prometer un
aislamiento que no existe.

**No configurable hoy — hueco documentado:**

- **Límites de gasto / presupuesto: no existen.** No hay `budget`, `spend_limit`,
  `cost_limit` ni `token_limit` en ninguna parte de la configuración de agente
  (verificado sobre `buzz-acp/src/config.rs` y `types/requests.rs`). El único
  control indirecto es la elección de modelo y `parallelism`. **La meta-skill no
  debe prometer límites de gasto.** Si se quieren, son un proyecto aparte.
- **MCP por agente: no configurable.** Ver §5.
- **`turn_timeout_seconds` y `mcp_command`** se aceptan por compatibilidad de
  wire pero están marcados `@deprecated — sending this field has no effect`
  (`requests.rs:150–162`).

---

## 4. Las lecciones L1–L4, verificadas contra el código

Cada lección se verificó en el fuente antes de convertirla en contenido de skill.
Las secciones de la meta-skill que las materializan van en §7.

### L1 — Las skills se enumeran al crear la sesión ✔ confirmado

`crates/buzz-agent/src/lib.rs:442`, dentro de `session_new`:

```rust
let (hints_text, skills) = if app.cfg.hints_enabled {
    hints::build_hints_section(std::path::Path::new(&p.cwd))
} else { (String::new(), Vec::new()) };
```

Es la **única** llamada a `build_hints_section` en todo el repo. El resultado se
concatena al system prompt de la sesión y las `skills` quedan fijadas en el
`SkillEntry[]` de esa sesión, que alimenta la herramienta `load_skill`
(`agent.rs:390`, `824`).

**Consecuencia operativa:** una skill nueva **no la ve ningún agente con sesión
viva**. La ven los agentes que abran sesión después de escribirla.

**Lo que el master agent debe saber decir:** tras escribir una skill, enumerar
qué agentes la verán (los que aún no tienen sesión abierta o reinicien) y cuáles
necesitan reinicio explícito. En Bloque 1 lo *avisa*; en Bloque 2 lo *ejecuta*
con (b5).

### L2 — El descubrimiento depende del runtime ✔ confirmado, con un matiz importante

`crates/buzz-agent/src/hints.rs:8` y `:204`:

```rust
const SKILL_DIRS: &[&str] = &[".agents/skills", ".goose/skills", ".claude/skills"];

fn discover_skills_impl(cwd: &Path, home: Option<&Path>) -> Vec<SkillEntry> {
    for dir_suffix in SKILL_DIRS { scan_skill_dir(&cwd.join(dir_suffix), …); }
    if let Some(home) = home { scan_skill_dir(&home.join(".agents/skills"), …); }
}
```

Orden de precedencia y deduplicación **por nombre**: `.agents` → `.goose` →
`.claude` (todos relativos a `cwd`), y por último `~/.agents/skills`. El primero
que reclama un nombre gana (`seen` en `hints.rs:136`); los demás se descartan en
silencio.

**El matiz que cambia el diseño:** `cwd` **no es un directorio por agente**.
Todos los agentes gestionados comparten el mismo:

```rust
// desktop/src-tauri/src/managed_agents/runtime.rs:523
if let Some(home) = super::default_agent_workdir() { command.current_dir(home); }
// mod.rs:107 → nest_dir()  →  ~/.buzz   (o ~/.buzz-dev en dev)
```

Verificado en disco: `~/.buzz/.agents/skills/`, con `~/.buzz/.claude/skills/` y
`~/.buzz/.goose/skills/` como **symlinks** al canónico
(`nest.rs:291` `ensure_skill_symlinks`, `CANONICAL_SKILL_DIR = ".agents/skills/buzz-cli"`).

**Por tanto: una skill escrita en `~/.buzz/.agents/skills/<n>/SKILL.md` es global
a todos los agentes de la máquina en runtimes que escanean `cwd`.** No hay
scoping por agente en este camino. Es la consecuencia más importante de L2 y la
meta-skill tiene que tratarla como restricción de primera clase (nombres únicos,
descripciones que no capturen a agentes ajenos — ver L4).

Regla de escritura resultante:

| Runtime destino | Dónde escribe el master agent | Alcance real |
|---|---|---|
| `buzz-agent`, `codex` | `~/.buzz/.agents/skills/<nombre>/SKILL.md` | **Global** a todos los agentes gestionados |
| `claude` | igual — `cwd` = `~/.buzz` es el "proyecto" de Claude Code, y `~/.buzz/.claude/skills` ya está symlinkeado | Global + lo que el usuario tenga en `~/.claude/skills` |
| `goose` | igual, vía `~/.buzz/.goose/skills` | Global |

Escribir **siempre** en el canónico `.agents/skills` y dejar que los symlinks
hagan el resto. Escribir en `.claude/skills` o `.goose/skills` directamente
rompería la invariante del nest.

### L3 — Skill sin herramientas es manual sin manos ✔ confirmado, y hay un límite duro

Herramientas reales por runtime:

- **`buzz-agent` y `codex`**: reciben `mcp_command: Some("buzz-dev-mcp")`
  (`discovery.rs:82,116`), que expone `shell`, `read_file`, `view_image`,
  `str_replace`, `todo` (`crates/buzz-dev-mcp/src/lib.rs:41–115`). **Tienen
  shell.** ✔
- **`claude` y `goose`**: `mcp_command: None` (`discovery.rs:49,14`). Traen sus
  propias herramientas y su propio MCP desde su configuración de usuario
  (`~/.claude.json` → `mcpServers`, leído en
  `config_bridge/claude.rs:23`). El Desktop **lee** esa config para mostrarla;
  no la escribe.
- Además, todo agente tiene `load_skill` cuando hay skills
  (`buzz-agent/src/agent.rs:390`).

**El límite duro:** el MCP **no es configurable por agente**. `mcp_command` se
acepta en el request pero está anotado *"Accepted for wire compatibility; not
applied to the record… a per-record override is never read"*
(`requests.rs:150`), y en el spawn se deriva exclusivamente del catálogo de
runtime (`runtime.rs:480`). **El master agent no puede dar MCPs nuevos a un
agente nuevo.** Puede elegir un runtime que ya los tenga, y avisar.

**Lo que la entrevista debe capturar:** por cada skill propuesta, qué
herramientas asume. Y el master agent valida contra esta tabla, avisando
explícitamente cuando una skill asume shell y el runtime elegido es `claude` o
`goose` (donde depende de la config del usuario, no del alta).

### L4 — La descripción del frontmatter decide la autoactivación ✔ confirmado

`hints.rs:98` extrae exactamente dos campos del frontmatter, `name` y
`description`, y `build_hints_section_impl` (`:239`) los inyecta así:

```
## Available Skills
- <name>: <description>

Use the `load_skill` tool to read the full content of a skill before using it.
```

**El cuerpo del `SKILL.md` no se carga hasta que el modelo llama a `load_skill`.**
La descripción es literalmente lo único que el modelo ve al decidir. Una skill
con mala descripción es una skill que no existe.

Y por L2, esa línea entra en el prompt de **todos** los agentes de la máquina:
una descripción demasiado genérica no sólo falla en activarse cuando toca —
**secuestra** turnos de otros agentes. Doble motivo para estandarizarlas.

Se requiere también: sin `name` la skill se descarta en silencio
(`hints.rs:105` → `parse_skill_frontmatter` devuelve `None`); un `SKILL.md`
ilegible se salta sin aviso (`hints.rs:130`). **Fallos silenciosos** — la
meta-skill debe verificar tras escribir, no asumir.

---

## 5. Subida de ejemplos de referencia — cómo llega el material al master agent

Es el insumo de "destilar guía de diseño desde ejemplos". Camino verificado:

**1. El adjunto llega en el prompt como URL.** El composer del Desktop añade al
cuerpo del mensaje una línea por adjunto — `![image|video](url)` para media,
`[etiqueta](url)` para ficheros genéricos
(`desktop/src/features/messages/lib/imetaMediaMarkdown.ts:110–121`) — y emite
además tags `imeta` NIP-92.

**2. El agente ve ambas cosas.** El bloque de contexto que arma el harness
incluye `Content:` **y** `Tags:` completos (`crates/buzz-acp/src/queue.rs:1136`,
`:1150`), así que la URL llega por partida doble.

**3. Descarga.** `buzz media get <url|sha256> -o <fichero>`
(`crates/buzz-cli/src/lib.rs:1788`), que firma la autorización Blossom `t=get`
con la clave del agente. Para imágenes hay además `view_image` en el MCP, que
hace lo mismo internamente (`crates/buzz-dev-mcp/src/view_image.rs:292`) e
inyecta la cabecera `x-auth-tag`.

**4. Lectura.** `read_file` sirve para texto (md, txt, csv, json, código).
**PDF, PPTX y DOCX no son legibles directamente** — requieren conversión por
shell (`pdftotext`, `python-pptx`, `pandoc`…), que puede no estar instalada.

**Consecuencia para la meta-skill:** la fase de ejemplos debe (i) pedir
preferentemente formatos de texto, (ii) probar la conversión antes de prometerla,
(iii) degradar con elegancia — si no puede leer el fichero, decirlo y pedir que
peguen lo esencial en el canal, nunca inventar el contenido. Es un fallo probable
y hay que guionarlo.

---

## 6. Persona packs: ¿vehículo correcto? — **No en v1**

Recomendación clara, con la evidencia que la sostiene.

### 6.1 Qué es un persona pack

Formato bien diseñado (`crates/buzz-persona/src/pack.rs:14`):

```
<pack_root>/
  .plugin/plugin.json      manifiesto
  personas/<n>.persona.md
  instructions.md
  .mcp.json
  skills/
```

E incluye justo lo que echamos de menos en §4: **scoping de skills por persona**.
`resolve_skills` (`pack.rs:249`) reparte — las listadas en el array `skills:` de
una persona van sólo a ella; las no listadas son compartidas.

### 6.2 Por qué aun así no es el vehículo hoy

**No hay instalador, ni consumidor en runtime.** Verificado:

- `buzz pack` sólo ofrece `validate` e `inspect` (`lib.rs:1884`). No hay
  `install`.
- `crates/buzz-acp` **no importa `buzz_persona` en absoluto** (declara la
  dependencia en `Cargo.toml:22` pero no la usa en ningún `.rs`).
- El Desktop usa `buzz_persona_pkg` en **un único sitio**:
  `split_frontmatter` dentro de una migración (`migration.rs:1126`).

Es decir: el `skills_dir` y `resolve_skills` **no los lee nadie**. Un pack escrito
hoy es un directorio validable que ningún agente descubre. Usarlo exigiría
construir el instalador *además* de todo lo demás.

Tampoco sirve el `agent snapshot` para esto: su propia cabecera lo dice —
*"Zip is NOT in v1 — deferred to v2 for skills bundling"*
(`agent_snapshot.rs:17`).

### 6.3 Recomendación

| Vía | Ventajas | Inconvenientes | Veredicto |
|---|---|---|---|
| **Escritura directa en `~/.buzz/.agents/skills/`** | Funciona hoy; efecto inmediato en sesiones nuevas; sólo shell; verificable con `ls`/`cat` | Sin scoping por agente (§4 L2); sin versionado ni desinstalación | ✅ **Bloque 1 y 2** |
| Persona pack | Scoping por persona; portable; ya validado por `buzz pack validate` | Sin instalador ni consumidor; trabajo de fork considerable | ⏭ **Bloque 3** — camino correcto a medio plazo |
| Agent snapshot `.agent.json` | Ya se renderiza como tarjeta importable en el canal (§9.1) | No lleva skills (v1) | ✅ como **entrega intermedia** de la *definición*, no de las skills |

**Recomendación:** escribir directo a los directorios de skills. Mantener el
formato de pack como **objetivo de exportación** y **estructura de plantillas**
—la meta-skill puede generar árboles compatibles con `buzz pack validate` desde
el principio— para que el día que exista el instalador la migración sea trivial.
Coste hoy: cero. Opcionalidad futura: alta.

---

## 7. Esqueleto de la meta-skill "crear-agentes"

Ubicación: `~/.buzz/.agents/skills/crear-agentes/`.
Modelo de estilo: el `buzz-cli` que ya se despacha en el nest
(`nest.rs:45`, visible en `~/.buzz/.agents/skills/buzz-cli/SKILL.md`).

### 7.1 Ficheros  *(construido — ver §9.1 para el árbol real)*

```
crear-agentes/
  SKILL.md                              ← el guion; ~200 líneas
  plantillas/
    persona-base.md                     ← esqueleto de system prompt
    persona-ejemplos.md                 ← 3 personas reales comentadas
    skill-procedimiento.md              ← SKILL.md tipo "sigue estos pasos"
    skill-referencia.md                 ← tipo "consulta estos criterios"
    skill-herramienta.md                ← tipo "envuelve esta CLI"
  referencia/
    descripciones.md                    ← L4: buenas vs malas, con porqués
    runtimes.md                         ← L3: tabla runtime → herramientas
    limites-nacimiento.md               ← §3.3, incluido lo NO soportado
  checklist-validacion.md               ← L1–L4 en forma de lista ejecutable
```

Los ficheros de apoyo **no** entran en el prompt: se cargan con `load_skill`
(`hints.rs:21`, `supporting_files` se preenumeran al descubrir). Por eso el
`SKILL.md` puede ser breve y el detalle vivir aparte — es el patrón que el
runtime premia.

### 7.2 Frontmatter (aplicando L4 a la propia meta-skill)

```yaml
---
name: crear-agentes
description: >
  Entrevistar a una persona para diseñar un agente de Buzz nuevo y escribir su
  persona, sus skills y su configuración. Usar cuando alguien pida crear, dar de
  alta, montar o diseñar un agente, o pida cambiar la persona o las skills de uno
  existente. No usar para responder dudas sobre agentes ya creados.
version: 1
---
```

Incluye el "no usar para" a propósito: por L2 esta línea entra en el prompt de
**todos** los agentes de la máquina, y sin la exclusión secuestraría cualquier
conversación que mencione la palabra "agente".

### 7.3 La entrevista, por fases

Principio rector, tomado del `buzz-cli` existente (*"ask for at most two things"*):
**preguntar poco y deducir mucho.** Cada fase define qué se pregunta, qué se
infiere y cuándo se para.

**Fase 1 — Propósito.** Dos preguntas: cómo se llama y qué hace en su día a día.
De ahí se deduce tipo de agente, tono y borrador de persona. *No* preguntar por
runtime, modelo, credenciales ni permisos todavía. Salida: párrafo de propósito
en una frase, devuelto al usuario para que lo corrija.

**Fase 2 — Ejemplos de referencia.** Pedir material sólo si el propósito implica
un estándar ("que escriba como nosotros", "que siga nuestra guía"). Procedimiento
literal de §5: leer las URLs del mensaje, `buzz media get`, `read_file`,
convertir si hace falta. **Guion de degradación obligatorio:** si un fichero no
se puede leer, decirlo por su nombre y pedir el extracto pegado. Nunca inventar.
Salida: 5–10 reglas destiladas, citando de qué fichero sale cada una.

**Fase 3 — Herramientas (L3).** Por cada tarea del propósito, qué herramienta
hace falta. Consultar `referencia/runtimes.md`. Elegir runtime en función de eso,
no al revés. **Avisar explícitamente** si alguna skill asume shell y el runtime
elegido es `claude` o `goose`. **Decir con todas las letras** que no se pueden
añadir MCPs nuevos en el alta.

**Fase 4 — Quién lo usa y criterios de calidad.** Quién puede invocarlo
(`respond_to`, defecto `owner-only`), en qué canales, qué es una respuesta buena y
qué es un fallo. De aquí sale la sección "Criterios" de la persona y los casos de
la prueba de humo. **Prohibido prometer límites de gasto** (§3.3).

**Fase 5 — Validaciones L1–L4.** Recorrer `checklist-validacion.md` **antes** de
escribir nada:
- L4: ¿la descripción de cada skill nueva dice *cuándo* usarla, no sólo qué hace?
  ¿Tiene cláusula de exclusión? ¿Colisiona con una skill ya presente?
- L2: ¿el nombre está libre? (`ls ~/.buzz/.agents/skills/`) — la deduplicación es
  silenciosa.
- L3: ¿toda herramienta asumida existe en el runtime elegido?
- L1: ¿qué agentes tendrán que reiniciar?

**Fase 6 — Resumen y aprobación.** Publicar en el canal: nombre, propósito,
persona (íntegra), skills con sus descripciones, runtime, modelo, `respond_to`,
canales, y **qué NO tendrá** (sin límite de gasto, sin MCPs nuevos). Esperar un sí
explícito. En Bloque 2, este mensaje es el que el `approvalEventId` referencia
(§2.2 b2), así que debe llevar el `requestId` visible.

**Fase 7 — Escritura.** Skills a `~/.buzz/.agents/skills/<n>/SKILL.md` (siempre
el canónico, §4 L2). Alta: `buzz agents draft-create` en Bloque 1,
`buzz agents create` en Bloque 2. **Verificar tras escribir** — releer el fichero
y confirmar que el frontmatter parsea; los fallos son silenciosos (§4 L4).

**Fase 8 — Prueba de humo.** Comprobar que el agente aparece como miembro,
mandarle uno de los casos de la Fase 4, verificar la respuesta. Si está en *setup
mode* (§1.5), explicar qué falta. Informar qué agentes necesitan reinicio (L1).

### 7.4 Contenido de `referencia/descripciones.md` (L4)

El fichero que convierte L4 en algo aplicable. Estándar propuesto:

> Una descripción es **cuándo llamarme**, no **qué soy**. Tres partes: acción,
> disparadores concretos, exclusión.

| Mala | Por qué falla | Buena |
|---|---|---|
| `Ayuda con documentos.` | Sin disparador. Compite con todo y no gana nada. | `Revisar y corregir documentos contra la guía de estilo de la empresa. Usar cuando pidan revisar, corregir o dar formato a un texto interno. No usar para redactar desde cero.` |
| `Skill de facturación.` | Nombra el dominio, no el momento. | `Conciliar facturas emitidas contra movimientos bancarios. Usar al cerrar el mes o cuando pregunten qué facturas siguen sin cobrar.` |
| `Usar siempre que se hable de agentes.` | Por L2 entra en el prompt de todos los agentes de la máquina y secuestra sus turnos. | `Diseñar y dar de alta agentes nuevos. Usar cuando pidan crear o montar un agente. No usar para dudas sobre agentes existentes.` |
| `Herramienta interna avanzada v2.` | Versión y adjetivos no son disparadores. | `Consultar el estado de despliegue en staging. Usar cuando pregunten si algo está desplegado o qué versión corre.` |

Reglas: 1–3 frases · empezar por verbo en infinitivo · disparadores con las
palabras que el usuario usaría de verdad · exclusión explícita si el nombre es
ambiguo · **nunca** "siempre que", "cualquier cosa sobre", "en general".

---

## 8. Colisión con `feat/artifact-preview-a2` — 🟢 verde, con una condición

Comprobado sin cambiar de rama ni tocar el estado de git.

**Estado actual.** La rama presente en el checkout es `feat/artifact-preview-a1`
(`a2` aún no existe localmente). Su diff contra `main` son **26 ficheros, todos
frontend TS/TSX + docs**. **Cero Rust.**

**Qué tocará A2**, según su propio plan (`docs/plan-artifact-preview.md:435`,
`:452`):

| Fichero | Cambio de A2 |
|---|---|
| `desktop/src-tauri/src/artifact_protocol.rs` | **nuevo** |
| `desktop/src-tauri/src/lib.rs` | registrar el esquema `artifact` — *"~8 lines, copy of line 216"* |
| `desktop/src-tauri/tauri.conf.json` | `frame-src 'self' artifact:` |
| `desktop/src/features/artifacts/ui/ArtifactFrame.tsx` | `srcDoc` → `src` |

**Qué tocaría este plan en los mismos ficheros:** sólo `lib.rs`, y en **otras
dos regiones**: la lista `use` (~línea 82) y el `invoke_handler!` (~líneas
690–735, junto a `create_managed_agent` y `create_persona`). A2 toca la zona de
`register_asynchronous_uri_scheme_protocol` (~línea 216, verificado en
`lib.rs:216`).

**Veredicto: 🟢 sin colisión.** Regiones separadas por ~400 líneas; git las funde
sin conflicto. Ningún otro fichero se solapa: A2 vive en
`desktop/src/features/artifacts/` y `shared/ui/markdown*`; este plan en
`desktop/src/features/agents/`, `crates/buzz-cli` y `desktop/src-tauri/src/commands/`.

**🔴 La única condición que lo volvería rojo** — y es exactamente el motivo por el
que §2.1 descarta el socket/HTTP local: **si el Bloque 2 introdujera un esquema
URI o un servidor local**, tocaría `lib.rs` en la **misma zona de registro de
protocolos** que A2, con conflicto casi seguro y revisión de CSP compartida. El
diseño elegido (reutilizar el frame observer) evita esa zona por completo. **Es
una razón de peso para no cambiar de transporte más adelante sin re-evaluar
esto.**

**Secuencia recomendada.** No hace falta serializar, pero conviene:
1. **Bloque 1 en paralelo con A2** — riesgo cero, no toca Rust ni `desktop/src`.
2. **Bloque 2 después de que A2 aterrice en `main`**, o en rama propia rebasada
   sobre A2. Si hay que solapar, ordenar por fichero: A2 se queda con `lib.rs:216`
   y `tauri.conf.json`; el Bloque 2 con `lib.rs:~82` y `lib.rs:~690`. Sin
   `tauri.conf.json` por parte del Bloque 2 en ningún caso.

---

## 9. Plan de implementación

### 9.1 Bloque 1 — Meta-skill completa + alta con pasos (a) — ✅ IMPLEMENTADO

**Estado: implementado y verificado.** `scripts/verificar.sh` pasa en verde:
20/20 asserts del humo, 3/3 packs generados válidos, estructura completa.

**Decisión de remate: `draft-create`** (ver §11.1). El agent snapshot queda
descartado para el Bloque 1.

**Entregado**, en `~/.buzz/.agents/skills/crear-agentes/`:

```
SKILL.md                              guion de 8 fases
checklist-validacion.md               L1–L4 como lista ejecutable
plantillas/
  persona-base.md                     esqueleto de system prompt
  skill-procedimiento.md              tipo "sigue estos pasos"
  skill-referencia.md                 tipo "aplica estos criterios"
  skill-herramienta.md                tipo "envuelve esta CLI"
  pack/                               plantilla de árbol pack-válido (.tmpl)
referencia/
  descripciones.md                    L4: 6 pares malo/bueno + reglas
  runtimes.md                         L3: runtime → herramientas
  limites-nacimiento.md               qué se configura y qué NO
ejemplos/
  entrevista-presentaciones.md        PDF legible, runtime sin shell
  entrevista-ingenieria.md            shell, y el aviso de MCP cambia el alcance
  entrevista-pptx-degradacion.md      PPTX ilegible → guion de degradación
scripts/
  generar-pack.sh                     renderiza un pack válido
  humo-draft-create.mjs               20 asserts sobre el contrato
  verificar.sh                        punto de entrada único
```

**Criterios de aceptación — estado**

| # | Criterio | Estado |
|---|---|---|
| B1.1 | Estructura completa en disco | ✅ `verificar.sh` §1 |
| B1.2 | Frontmatter válido y con exclusión (L4) | ✅ `verificar.sh` §2 |
| B1.2b | `buzz pack validate` limpio sobre árboles generados | ✅ `verificar.sh` §3, 3 casos, exit 0 |
| B1.3 | La entrevista arranca sin nombrar la skill | ⏳ manual — §9.4 paso 3 |
| B1.4 | Fase 2 lee un `.md`/`.pdf` y degrada con `.pptx` | ⏳ manual — §9.4 pasos 4–5 |
| B1.5 | Fase 6 no procede sin sí explícito | ⏳ manual — §9.4 paso 6 |
| B1.6 | `SKILL.md` escrito + AgentDialog prefilled | ⏳ manual — §9.4 paso 7 |
| B1.7 | Fase 8 nombra los reinicios correctos | ⏳ manual — §9.4 paso 9 |
| B1.8 | Nunca promete gasto ni MCPs | ✅ codificado como los 4 avisos obligatorios; ⏳ confirmación manual paso 6 |

**Sobre B1.2b — por qué el pack aunque no haya instalador.** §6 concluye que los
persona packs no son el vehículo hoy. El generador existe igualmente porque el
coste es cero y compra opcionalidad: el día que exista instalador, los árboles
que la meta-skill produce ya son válidos. Es exportación, no instalación.

**Sobre el humo (B1.2/§2) — qué prueba y qué no.** `humo-draft-create.mjs` no
envía un frame real, y eso **no es una carencia del test sino la propiedad de
seguridad del sistema bajo prueba**. Enviarlo exigiría un tag NIP-OA válido, que
el CLI verifica criptográficamente (`buzz-cli/src/lib.rs:2061` →
`nip_oa::verify_auth_tag`), y firmarlo requiere la clave secreta del dueño — que
por diseño el agente nunca tiene. El test cubre en su lugar:

1. el contrato `hasOnlyKeys` **leído del fuente real** (no copiado): si el
   Desktop y el CLI divergen, el test falla;
2. el payload bien formado y seis casos negativos;
3. los límites de longitud leídos de `agent_management.rs`;
4. **el gate vivo del binario**: `buzz agents draft-create` sin `BUZZ_AUTH_TAG`
   se rechaza — verificación empírica de que el tag es obligatorio.

Los tres tramos no automatizables quedan documentados en la cabecera del script:
(a) tag NIP-OA, (b) relay vivo, (c) Desktop con la clave del dueño.


### 9.2 Bloque 2 — Creación directa desde el chat

**Alcance**
1. **(b1)** `buzz agents create` + `action: "create_direct"` con payload completo.
   – `crates/buzz-cli/src/lib.rs`, `crates/buzz-cli/src/agent_management.rs`,
   `desktop/src/features/agents/agentManagement.ts`.
2. **(b2)** `approvalEventId` verificado: autoría del dueño, canal, orden
   temporal, `requestId`, anti-replay.
   – `desktop/src/features/agents/useAgentManagement.ts`.
3. **(b2-bis)** **Guardia de propiedad de §3.1** — rechazar si el aprobador no es
   el dueño de este Desktop. *Bloqueante: sin esto, el Bloque 2 no sale.*
4. **(b3)** Auto-aplicación: refactor de `submitCreate` para invocarse sin
   diálogo.
5. **(b4)** Acuse al canal vía `send_managed_agent_channel_message`.
6. **(b5)** `buzz agents restart` para cerrar L1.
7. Actualizar la meta-skill: Fase 6 emite `requestId`, Fase 7 usa
   `buzz agents create`, Fase 8 ejecuta reinicios en vez de sugerirlos.

**Criterio de aceptación principal — literal, tal como se pidió:**

> **En un canal, pido un agente, respondo la entrevista, confirmo el resumen, y
> el agente nuevo aparece como miembro y responde.**

Sin clic en ningún diálogo. Un solo hilo de canal de principio a fin.

**Criterios de aceptación derivados**
- B2.1 — El principal, arriba. Verificación manual, extremo a extremo.
- B2.2 — Sin `approvalEventId`, `create_direct` se rechaza y el error vuelve al
  canal.
- B2.3 — Con un `approvalEventId` **de otra persona**, se rechaza citando §3.1.
  *Prueba de seguridad obligatoria.*
- B2.4 — Reenviar el mismo `requestId` no crea un segundo agente (anti-replay).
- B2.5 — El agente nuevo tiene un tag NIP-OA válido cuyo dueño es el humano:
  `buzz users get <pubkey>` muestra el tag `auth`, y
  `nip_oa::verify_auth_tag` lo valida contra el pubkey del dueño.
- B2.6 — `buzz agents create` con un runtime inexistente falla limpio, sin dejar
  ningún registro a medias.
- B2.7 — `buzz agents restart` reinicia y el agente ve una skill escrita después
  de su arranque anterior (prueba directa de L1).
- B2.8 — `just check` y `just desktop-test` pasan.

**Verificación manual tuya (imprescindible):**
- **B2.3** — la prueba de dos identidades. Requiere una segunda persona o un
  segundo Desktop; **no se puede automatizar en este repo** y es el control de
  seguridad más importante del bloque.
- **B2.1** — el recorrido completo, con ojo en el estado del canal cuando el
  spawn falla (`created.spawnError`, `useAgentManagement.ts:212`).
- **B2.5** — verificación criptográfica del vínculo de propiedad.
- Revisión del diff de `desktop/src-tauri/src/lib.rs` contra A2 antes de fundir
  (§8).

### 9.3 Fuera de alcance, y por qué

| Tema | Motivo |
|---|---|
| Approval gates de `buzz-workflow` (WF-08) | Sin implementar; el ejecutor falla el run (§3.2). Proyecto propio. |
| Instalador de persona packs | Sin consumidor en runtime (§6.2). Bloque 3. |
| Scoping de skills por agente | Requiere lo anterior; hoy `cwd` es compartido (§4 L2). |
| Límites de gasto/presupuesto | No existen en la configuración (§3.3). Requiere diseño de producto. |
| MCP por agente | Derivado del catálogo por construcción (§4 L3). |
| Creación cross-owner | Prohibida por diseño (§3.1). |

---

### 9.4 Guion de la prueba manual de punta a punta (Bloque 1)

Lo que el verificador automático **no** puede cubrir. Unos 20 minutos.
Todo lo previo se comprueba solo:

```bash
~/.buzz/.agents/skills/crear-agentes/scripts/verificar.sh
```

Debe terminar en `BLOQUE 1: VERIFICADO`. Si no, para aquí.

---

**Preparación**

1. **Reinicia un agente `buzz-agent` con shell** (o crea uno). Es obligatorio:
   por L1 las skills se enumeran al abrir sesión, así que un agente que ya
   estuviera corriendo **no verá** `crear-agentes`. Este paso es en sí mismo la
   prueba viva de L1.

2. **Comprueba que la ve.** En su canal:
   > ¿qué skills tienes disponibles?

   ✅ Debe listar `crear-agentes` con su descripción.
   ❌ Si no aparece: el frontmatter no parsea (fallo silencioso) o el agente no
   reinició. `head -8 ~/.buzz/.agents/skills/crear-agentes/SKILL.md`.

---

**Entrevista — camino feliz** *(cubre B1.3, B1.5, B1.8)*

3. **Dispara sin nombrar la skill:**
   > necesito un agente que me revise los textos antes de publicarlos

   ✅ Arranca la Fase 1 y pregunta **dos cosas**: nombre y qué hace.
   ❌ Si pregunta por runtime, modelo o permisos de entrada → falla B1.3.

4. **Responde con un propósito vago a propósito:** «que me ayude con textos».
   ✅ Debe pedir **un ejemplo concreto**, no rellenar el hueco él.

5. **Da un propósito real** y sigue hasta la Fase 4. Comprueba de paso:
   ✅ devuelve el propósito destilado **en una frase** y pide corrección;
   ✅ agrupa las cuatro preguntas de la Fase 4 en un mensaje, no de una en una.

6. **En el resumen de la Fase 6**, verifica que están **los cuatro avisos**:
   - [ ] sin límite de gasto
   - [ ] sin MCPs nuevos
   - [ ] canales = filtro de escucha, **no** permiso
   - [ ] qué agentes hay que reiniciar, **con nombres concretos**

   Luego **responde con una pregunta**, no con un sí: «¿y cuánto cuesta esto?»
   ✅ Debe contestar y **volver a pedir aprobación**. No debe dar por aprobado.
   ❌ Si escribe ficheros aquí → falla B1.5, y es el fallo más grave del bloque.

---

**Adjuntos** *(cubre B1.4 — el que más probablemente falle)*

7. **Sube un `.md` o `.pdf`** cuando pida material de referencia.
   ✅ Sonda con `command -v pdftotext`, descarga con `buzz media get`, y devuelve
   reglas **citando de qué fichero sale cada una**.
   ❌ Si cita reglas sin origen, o describe el fichero sin haberlo abierto → falla.

8. **Sube un `.pptx`.** Es la prueba clave.
   ✅ Dice que no puede leerlo, **lo nombra**, y ofrece las tres salidas.
   ❌ Si describe su contenido por el nombre del fichero → **falla, y es el fallo
   que la transcripción `entrevista-pptx-degradacion.md` existe para prevenir.**

---

**Escritura y alta** *(cubre B1.6, B1.7)*

9. **Aprueba** («dale») y observa la Fase 7:
   ✅ escribe en `~/.buzz/.agents/skills/<n>/SKILL.md` — **el canónico**;
   ❌ si escribe en `.claude/skills` o `.goose/skills` → falla (son symlinks);
   ✅ **relee el fichero** para verificar el frontmatter;
   ✅ ejecuta `buzz agents draft-create` y reporta **«listo para revisar»**,
      nunca «creado»;
   ✅ **te dice qué marcar** en el formulario (runtime, modelo, acceso), porque
      `draft-create` no los transporta.

10. **En Buzz Desktop:** debe abrirse el AgentDialog con nombre e instrucciones
    ya rellenos. Marca lo que te dijo y guarda.
    ❌ Si no se abre: mira los logs del Desktop. El frame es NIP-44 al dueño; si
    no descifra, el problema está en la identidad, no en la meta-skill.

11. **Prueba de humo (Fase 8):**
    ✅ `buzz channels members` lo muestra;
    ✅ responde al caso de calidad de la Fase 4;
    ✅ **repite el aviso de reinicios con nombres concretos** (B1.7).

---

**Verificación final en disco**

```bash
ls ~/.buzz/.agents/skills/
head -8 ~/.buzz/.agents/skills/<nombre-nuevo>/SKILL.md
```

✅ La skill nueva existe, el `name` coincide con el directorio, y la
`description` dice **cuándo** usarla y tiene exclusión.

---

**Qué invalida el Bloque 1 (por orden de gravedad)**

1. Escribe ficheros o da el alta **sin** aprobación explícita (paso 6).
2. Describe el contenido de un fichero que no ha podido leer (paso 8).
3. Omite alguno de los cuatro avisos (paso 6).
4. Escribe en `.claude/skills` o `.goose/skills` (paso 9).
5. Dice «creado» en vez de «listo para revisar» (paso 9).


## 10. Riesgos

| Riesgo | Prob. | Impacto | Mitigación |
|---|---|---|---|
| **Agente creado para el dueño equivocado** | Media | **Alto** — propiedad silenciosamente errónea, irreversible sin NIP-IA | §3.1 bloqueante + B2.3 |
| Skills globales colisionando entre agentes | **Alta** | Medio — un agente secuestra turnos de otro | L4 con exclusiones (§7.4) + comprobación de nombre en Fase 5 |
| El master agent alucina una aprobación | Media | Alto | (b2): verificación criptográfica, no confianza en el relato |
| Fallos silenciosos de skill (frontmatter roto) | **Alta** | Bajo pero desconcertante | Verificar tras escribir (Fase 7); B1.2 |
| PDF/PPTX ilegibles en Fase 2 | **Alta** | Bajo | Guion de degradación (§5); B1.4 |
| Colisión con A2 en `lib.rs` | Baja | Medio | §8: mismo fichero, regiones lejanas; nunca introducir esquema URI |
| Alta a medias (persona sí, spawn no) | Media | Medio | Ya cubierto: *setup mode* (§1.5) + `spawnError` propagado; B2.6 |
| El usuario espera límites de gasto | Media | Medio — confianza | Decirlo explícitamente en el resumen de la Fase 6 |

---

## 11. Decisiones tomadas

Las cuatro quedaron cerradas al fijar el objetivo del Bloque 1.

### 11.1 Remate del Bloque 1 → **`draft-create`**

Descartado el agent snapshot. El argumento no es de payload —el snapshot lleva
más configuración— sino de inversión: `draft-create` viaja por el frame observer,
que es **exactamente el camino que el Bloque 2 automatiza**. Estrenarlo con un
humano de red de seguridad significa que los fallos de transporte aparecen ahora
y no cuando ya no haya clic que los rescate. El snapshot va por el importador de
`AgentsView`, un código que después se abandona.

Coste asumido: `draft-create` sólo transporta nombre y prompt. Se compensa en la
Fase 7, donde la meta-skill **dice explícitamente qué marcar** en el formulario
(runtime, modelo, `respond_to`). Las tres transcripciones lo hacen.

### 11.2 Alcance de la Fase 2 → **texto + PDF con sonda; PPTX y DOCX fuera**

Comprobado en esta máquina: `pdftotext` ✓, `python3` ✓; `pandoc` ✗,
`libreoffice` ✗, `python-pptx` ✗, `python-docx` ✗, `pypdf` ✗.

La sonda (`command -v`) es obligatoria aunque `pdftotext` esté hoy: la meta-skill
corre en máquinas que no son ésta.

**Consecuencia incómoda, asumida a propósito:** el encargo nombraba
«presentaciones» como insumo típico, y PPTX es justo el formato no soportado. Por
eso el guion de degradación no es una nota al pie sino **una de las tres
transcripciones de ejemplo**, con su ofrecimiento de tres salidas (exportar a
PDF · pegar los principios · construir sin playbook y dejarlo escrito).

Si las presentaciones resultan ser el insumo dominante, instalar conversores es
un proyecto aparte — no entra aquí.

### 11.3 Idioma → **meta-skill en castellano; descripciones en el idioma del canal**

Lo decide un detalle técnico, no el gusto: la `description` es el disparador de
autoactivación (L4) y sólo dispara si coincide con las palabras que la gente
escribe. Si el equipo pide en castellano, la descripción va en castellano.

Los `name` van siempre en kebab-case ASCII: son identificadores y la
deduplicación es por nombre. Convivir con el `buzz-cli` en inglés no da problema.

Nota: `docs/` es inglés por convención de repo, y este plan ya la rompe por
decisión explícita (ver cabecera). Las skills no son `docs/`: son producto.

### 11.4 Secuencia → **Bloque 1 ya (hecho); Bloque 2 se funde después de A2**

Técnicamente pueden solaparse (§8). El motivo para no hacerlo es la carga de
revisión: **B2.3** —que un agente no pueda crearse para el dueño equivocado— es
la revisión de seguridad más delicada del proyecto, y A2 trae la suya de CSP. Dos
revisiones de seguridad simultáneas sobre el mismo checkout es cómo se cuela una.

Desarrollar el Bloque 2 en paralelo es aceptable; fundirlo antes que A2, no.
