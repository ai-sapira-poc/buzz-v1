# Spec — Contrato en disco de skills y evals

Status: **normativo para el perfil del agente y la Skills library.**
Companion: `docs/plan-agent-creator.md` (lecciones L1–L4), `docs/goal-agent-profile-library.md` (encargo).
Consumidores: `desktop/src-tauri/src/skills_library/`, `desktop/src/features/agents/`,
la meta-skill `crear-agentes` y cualquier agente que escriba skills o evals.

> Este documento está en castellano, como `docs/plan-agent-creator.md`, porque el
> encargo y la revisión son en castellano. Rutas, nombres de fichero y claves de
> frontmatter se mantienen literales y en el idioma que ya tienen en disco.

---

## 0. Por qué hace falta un contrato

El descubrimiento de skills ya existe y es real: `crates/buzz-agent/src/hints.rs`
lo implementa y `docs/plan-agent-creator.md` §4 lo verifica lección por lección.
Lo que **no** existía era un contrato escrito de:

1. qué ficheros componen una skill y cuáles son opcionales,
2. dónde viven las evals de un agente y con qué formato,
3. qué convención de commits sigue el repositorio de skills.

Sin ese contrato, el perfil del agente y la Skills library tendrían que adivinar,
y cada agente que escriba skills inventaría su propio formato. Este documento fija
los tres puntos. **Nombres y formatos son exactos, no orientativos.**

Regla transversal: **todo fallo de parseo es silencioso en el runtime**
(`hints.rs:105` descarta una skill sin `name`; `hints.rs:130` se salta un
`SKILL.md` ilegible). Las superficies de lectura de este contrato — perfil y
Library — hacen lo contrario: **muestran el problema**. Una skill que el runtime
descartaría se lista igualmente, marcada como inválida y con el motivo. Es la
única forma de que el usuario vea por qué su skill "no existe".

---

## 1. Raíces canónicas

| Qué | Ruta | Notas |
|---|---|---|
| Nest del agente | `~/.buzz` (`~/.buzz-dev` en dev) | `managed_agents::default_agent_workdir()`; es el `cwd` de **todos** los agentes gestionados |
| Skills, canónico | `~/.buzz/.agents/skills/<nombre>/` | Única raíz de escritura |
| Skills, vista `claude` | `~/.buzz/.claude/skills/<nombre>` | **Symlink** a `../../.agents/skills/<nombre>` |
| Skills, vista `goose` | `~/.buzz/.goose/skills/<nombre>` | **Symlink** a `../../.agents/skills/<nombre>` |
| Evals | `~/.buzz/.agents/evals/<agente>/` | Hermano de `skills/`, fuera del repo git de skills |

`<nombre>` es el nombre de la skill en kebab-case (§2.1). `<agente>` es el slug
del agente (§3.1).

**Se escribe siempre en el canónico.** Escribir directamente en
`.claude/skills/` o `.goose/skills/` rompe la invariante del nest
(`desktop/src-tauri/src/managed_agents/nest.rs:291` `ensure_skill_symlinks`) y
crea skills que sólo ve un runtime. El symlink es **por skill**, no por
directorio: así lo hace `ensure_skill_symlinks` hoy para `buzz-cli`, y así lo
hace la Library para cada skill nueva.

### 1.1 Alcance real: toda skill del canónico es global

`cwd` **no es un directorio por agente**: `runtime.rs:523` fija el mismo
`~/.buzz` para todos los agentes gestionados. Por tanto una skill escrita en
`~/.buzz/.agents/skills/<n>/SKILL.md` **la ven todos los agentes de la máquina**
cuyo runtime escanee `cwd`. No hay scoping por agente en este camino.

Consecuencias que este contrato asume como restricciones de primera clase:

- **Nombres únicos.** El primero que reclama un nombre gana y los demás se
  descartan en silencio (`hints.rs:136`, el `seen`). Colisión = skill invisible.
- **Descripciones que no capturen turnos ajenos.** Ver §2.3 y L4.

### 1.2 Orden de descubrimiento (literal, de `hints.rs:204`)

```rust
const SKILL_DIRS: &[&str] = &[".agents/skills", ".goose/skills", ".claude/skills"];

fn discover_skills_impl(cwd: &Path, home: Option<&Path>) -> Vec<SkillEntry> {
    for dir_suffix in SKILL_DIRS { scan_skill_dir(&cwd.join(dir_suffix), …); }
    if let Some(home) = home { scan_skill_dir(&home.join(".agents/skills"), …); }
}
```

Es decir, en este orden y deduplicando **por nombre**:

1. `<cwd>/.agents/skills` ← canónico del nest
2. `<cwd>/.goose/skills`  ← symlinks al canónico
3. `<cwd>/.claude/skills` ← symlinks al canónico
4. `<home>/.agents/skills` ← global de la máquina, **no** del nest

Dentro de cada directorio los subdirectorios se recorren **ordenados**
(`subdirs.sort()`), de modo que el descubrimiento es determinista.

**El paso 4 es el único que no pasa por el nest**, y es lo que este contrato
llama *global de la máquina* frente a *del nest*. En la práctica, con
`cwd = ~/.buzz` y `home = ~`, son directorios distintos y ambos reales.

`~/.claude/skills` (el de Claude Code del usuario) **no** aparece en esta lista:
`buzz-agent` no lo escanea. Sí lo escanea el runtime `claude` por su cuenta, con
sus propias reglas. De ahí que la Library lo trate como **origen de importación**
(§4), no como raíz gestionada.

### 1.3 Tabla de visibilidad por runtime

Esta es la tabla que el perfil del agente renderiza. Fuente:
`docs/plan-agent-creator.md` §4 L2/L3 y `managed_agents/discovery.rs`.

| Runtime | Directorios que ve | `skill_dir` declarado |
|---|---|---|
| `buzz-agent`, `codex` | `<cwd>/.agents/skills`, `<cwd>/.goose/skills`, `<cwd>/.claude/skills`, `~/.agents/skills` | `.agents/skills` |
| `claude` | lo anterior vía symlink del nest, **más** lo que el usuario tenga en `~/.claude/skills` y en el `.claude/skills` del proyecto | `.claude/skills` |
| `goose` | lo anterior vía symlink del nest | `.goose/skills` |

`known_skill_dirs()` (`discovery.rs:225`) es la fuente de verdad de la columna
derecha; la Library crea un symlink por cada valor que devuelve.

---

## 2. Contrato de una skill

### 2.1 Estructura de ficheros

```
~/.buzz/.agents/skills/<nombre>/
├── SKILL.md            ← OBLIGATORIO
├── referencia/         ← opcional, cualquier estructura
│   └── *.md
├── plantillas/         ← opcional
├── scripts/            ← opcional
└── <cualquier otro fichero de apoyo>
```

- **`SKILL.md` es el único fichero obligatorio.** Sin él, el directorio no es una
  skill y el runtime lo ignora (`hints.rs`: `read_to_string(&skill_md)` falla y
  hace `continue`).
- Todo fichero del árbol que **no** se llame `SKILL.md` es un *fichero de apoyo*
  (`SkillEntry::supporting_files`). Se pre-enumeran en el descubrimiento.
- Un subdirectorio que contenga su propio `SKILL.md` es **otra skill**, no un
  fichero de apoyo de la de arriba (`collect_supporting_files` no desciende).
  El contrato **desaconseja** anidar skills: sólo el nivel superior de cada
  directorio de la §1.2 se escanea, así que una skill anidada no la descubre
  nadie.

**`<nombre>` del directorio y `name` del frontmatter deben coincidir.** El
runtime usa el `name` del frontmatter y **no** el nombre del directorio; si
divergen, la skill funciona pero es imposible de localizar en disco desde la
línea que el modelo ve. La Library trata la divergencia como error de validación.

### 2.2 Frontmatter de `SKILL.md`

YAML entre `---`, primera línea del fichero. `hints.rs:98` extrae **exactamente
dos** campos:

```yaml
---
name: mi-skill                # OBLIGATORIO, kebab-case
description: >                # decide la autoactivación (L4)
  Frase de activación.
version: 1                    # opcional, informativo; el runtime lo ignora
---
```

| Campo | Obligatorio | Reglas |
|---|---|---|
| `name` | **sí** | `^[a-z0-9]+(-[a-z0-9]+)*$`, 1–64 caracteres. Sin `name`, o con `name` vacío tras `trim`, la skill **se descarta en silencio**. Debe coincidir con el nombre del directorio. Debe ser único en la máquina (§1.1). |
| `description` | de facto sí | Se lee con `trim`, y su ausencia degrada a `""` — la skill se lista pero con descripción vacía, y **el modelo no tiene con qué decidir**. La Library lo trata como error rojo. Ver §2.3. |
| resto | no | Cualquier otra clave se ignora. `version` es convención nuestra, no del runtime. |

El cuerpo (todo lo que sigue al frontmatter) **no se carga** hasta que el modelo
llama a `load_skill`. Límite duro: `MAX_SKILL_BODY_BYTES = 32 KiB`
(`hints.rs:7`); por encima, el cuerpo se trunca en frontera de carácter.

### 2.3 La `description` es un campo de primera clase

`build_hints_section_impl` (`hints.rs:239`) inyecta en el system prompt de cada
sesión, y nada más:

```
## Available Skills
- <name>: <description>

Use the `load_skill` tool to read the full content of a skill before using it.
```

De ahí las dos reglas que la Library valida y muestra en rojo:

1. **Sin descripción → la skill no existe.** El modelo no ve el cuerpo al decidir.
2. **Descripción genérica → la skill secuestra turnos ajenos.** Por §1.1 esa
   línea entra en el prompt de *todos* los agentes de la máquina. Una skill
   descrita como "ayuda con tareas" se activa en conversaciones que no le tocan.

Forma canónica de una descripción, aplicando L4 y
`~/.buzz/.agents/skills/crear-agentes/referencia/descripciones.md`:

> **Qué hace** + **cuándo usarla** (disparadores concretos) + **cuándo NO usarla**
> (exclusiones explícitas).

La cláusula de exclusión no es adorno: es lo que impide el secuestro. Ejemplo
real, de la propia meta-skill:

```yaml
description: >
  Entrevistar a una persona para diseñar un agente de Buzz nuevo y escribir su
  persona, sus skills y su configuración. Usar cuando alguien pida crear, dar de
  alta, montar o diseñar un agente, o cambiar la persona o las skills de uno que
  ya existe. No usar para responder dudas sobre agentes ya creados ni para
  arrancar, parar o depurar agentes en marcha.
```

**Heurística de "descripción genérica"** que implementa la Library (§4.3): se
marca en rojo si la descripción está vacía, tiene menos de 40 caracteres, o no
contiene ningún disparador reconocible (`usar cuando`, `use when`, `cuando`,
`when`, `trigger`). Es deliberadamente conservadora: marca de más, y el usuario
la corrige en el momento o la acepta.

### 2.4 Aviso de reinicio (L1)

`session_new` (`crates/buzz-agent/src/lib.rs:442`) es la **única** llamada a
`build_hints_section` del repo. Las skills quedan fijadas en el `SkillEntry[]` de
esa sesión.

**Una skill nueva no la ve ningún agente con sesión viva.** Toda escritura de
este contrato — importar, crear, editar — va acompañada del mismo aviso, con dos
listas:

- **La verán**: agentes parados, o que abran sesión después.
- **Necesitan reinicio**: agentes con sesión viva ahora mismo.

---

## 3. Contrato de evals por agente

### 3.1 Estructura de ficheros

```
~/.buzz/.agents/evals/<agente>/
├── caso-01.md          ← un fichero por caso, numerado
├── caso-02.md
├── …
├── feedback-log.md     ← anotaciones normalizadas, append-only
└── boletin-ultimo.md   ← último resultado del runner
```

`<agente>` es el **slug kebab-case del nombre del agente**
(`ManagedAgentRecord::name`): minúsculas, espacios y `_` a `-`, se eliminan los
caracteres fuera de `[a-z0-9-]`, se colapsan los `-` repetidos. Ejemplo:
`"Ana — Soporte"` → `ana-soporte`.

Como respaldo, si ese directorio no existe se busca `~/.buzz/.agents/evals/<pubkey>/`
(hex de 64 caracteres, `ManagedAgentRecord::pubkey`). El slug es el camino
preferente porque es legible y lo puede escribir un humano; el pubkey es el
desempate estable si dos agentes comparten nombre.

Las evals **no** están dentro del repositorio git de skills (§5): el repo tiene
su raíz en `.agents/skills`, y `.agents/evals` queda fuera a propósito. Versionar
evals es trabajo posterior y con otra política de retención.

### 3.2 `caso-NN.md`

`NN` es un entero de **dos dígitos con cero a la izquierda**, `01`–`99`,
consecutivo y sin huecos por agente. Se ordena por número, no lexicográficamente
por nombre.

```markdown
---
caso: 01
titulo: Resume un hilo largo sin inventar acuerdos
origen: nacimiento          # nacimiento | feedback
fecha: 2026-08-29           # ISO-8601, fecha de creación del caso
autor: guillermo            # quién lo escribió: usuario, o nombre del agente
---

## Input

Texto literal de lo que recibe el agente. Se admite cualquier markdown,
incluidos bloques de código.

## Output esperado

Descripción de lo que debe producir. No tiene por qué ser literal: puede ser
una rúbrica ("menciona las tres decisiones y ningún acuerdo no tomado").
```

| Campo | Obligatorio | Reglas |
|---|---|---|
| `caso` | sí | Entero. Debe coincidir con el `NN` del nombre de fichero. |
| `titulo` | sí | Una línea. Es lo que se lista en el perfil. |
| `origen` | sí | Exactamente `nacimiento` o `feedback`. `nacimiento` = escrito al dar de alta al agente; `feedback` = derivado de una anotación de `feedback-log.md`. |
| `fecha` | sí | `YYYY-MM-DD`. |
| `autor` | sí | Texto libre corto. |

Las dos secciones `## Input` y `## Output esperado` son **obligatorias y con ese
título exacto**. Un caso al que le falte alguna se lista en el perfil marcado
como inválido, con el motivo.

### 3.3 `feedback-log.md`

Registro **append-only** de anotaciones normalizadas. Cabecera fija y una entrada
por bloque `##`, la más reciente **arriba**:

```markdown
# Feedback log

## 2026-08-29 · guillermo · corregido
Pidió el resumen y devolvió un acuerdo que nadie tomó.
→ caso-02
```

Formato de la línea de encabezado de cada entrada, exacto:

```
## <fecha ISO> · <autor> · <estado>
```

| Parte | Reglas |
|---|---|
| `<fecha ISO>` | `YYYY-MM-DD`. |
| `<autor>` | Texto libre corto, sin `·`. |
| `<estado>` | `abierto`, `corregido` o `descartado`. |

Tras el encabezado, el cuerpo libre de la anotación. Una línea que empiece por
`→ ` enlaza el caso derivado (`caso-NN`); es opcional y sólo tiene sentido con
estado `corregido`. Esa línea es lo que cierra el círculo: la anotación de
feedback y el `caso-NN.md` con `origen: feedback` se refieren mutuamente.

### 3.4 `boletin-ultimo.md`

Resultado de la **última** pasada del runner. Se sobrescribe entero cada vez —
el histórico no vive aquí.

```markdown
---
fecha: 2026-08-29
runner: manual              # manual | <nombre del runner>
puntuacion: 0.83            # media de los casos, 0.00–1.00, dos decimales
tendencia: sube             # sube | baja | estable | primera
---

| Caso | Puntuación | Nota |
|------|-----------|------|
| caso-01 | 1.00 | Correcto. |
| caso-02 | 0.50 | Menciona el acuerdo inventado, aunque con reservas. |
```

| Campo | Obligatorio | Reglas |
|---|---|---|
| `fecha` | sí | `YYYY-MM-DD`. |
| `runner` | sí | `manual` o el nombre del runner. |
| `puntuacion` | sí | Decimal `0.00`–`1.00`, dos decimales. |
| `tendencia` | sí | `sube`, `baja`, `estable` o `primera` (primer boletín, sin comparación). |

La tabla tiene esas tres columnas, con esos encabezados exactos. La columna
`Caso` referencia `caso-NN`. Un caso presente en la tabla pero sin
`caso-NN.md` en disco, o al revés, se muestra en el perfil como discrepancia.

---

## 4. Escritura: qué hace exactamente la Library

Toda escritura de skills, venga de la Library, de la meta-skill o de un agente
futuro, ejecuta **estos cuatro pasos, en este orden**:

1. **Copia al canónico** — `~/.buzz/.agents/skills/<nombre>/`, con sus ficheros
   de apoyo. Nunca sobrescribe un directorio existente (§4.3).
2. **Symlinks por runtime** — uno por cada `skill_dir` de `known_skill_dirs()`:
   `~/.buzz/.claude/skills/<nombre>` y `~/.buzz/.goose/skills/<nombre>`, ambos
   apuntando a `../../.agents/skills/<nombre>` (relativo, como
   `ensure_skill_symlinks`).
3. **Un commit de git por skill** — §5.
4. **Aviso de reinicio** — §2.4.

Un fallo en el paso 1 aborta la operación entera. Un fallo en 2 o 3 **no**
revierte la copia: la skill ya está en disco y ya es visible; se reporta el fallo
y se deja constancia. Es preferible una skill visible sin commit a una operación
"atómica" que borra trabajo del usuario.

### 4.1 Importar (prioridad 1)

Origen: un directorio *de skills* (que contiene varias carpetas de skill, p. ej.
`~/.claude/skills` o el `.claude/skills` de un proyecto) o una *carpeta de skill*
suelta (la que contiene el `SKILL.md`). La Library detecta cuál de los dos es:
si el directorio elegido tiene `SKILL.md`, es una skill; si no, se listan sus
subdirectorios que lo tengan.

**Antes de confirmar** se muestra, por skill: nombre (validado y con colisiones),
descripción de activación detectada (marcada en rojo si falla §2.3, editable en
el sitio), y la lista de ficheros de apoyo.

Mensaje de commit: `importada de <origen>` (§5.2).

### 4.2 Crear desde cero (prioridad 2)

Formulario mínimo: nombre kebab-case validado, descripción de activación con la
ayuda contextual de §2.3 (incluida la exclusión), y cuerpo en markdown. El
`SKILL.md` resultante se escribe con el frontmatter de §2.2 (`name`,
`description`, `version: 1`).

Mensaje de commit: `creada desde la Library` (§5.2).

### 4.3 Validación de nombres y colisiones

- **Kebab-case**: `^[a-z0-9]+(-[a-z0-9]+)*$`, 1–64 caracteres. Un nombre que no
  valida no se puede importar ni crear; se pide corregirlo.
- **Colisión**: si `~/.buzz/.agents/skills/<nombre>/` ya existe, la importación
  **se bloquea** para esa skill y pide un nombre nuevo. **Nunca** se sobrescribe
  en silencio — por §1.1 una colisión no es un detalle cosmético: es una skill
  que desaparece del prompt.
- La colisión se comprueba también contra los nombres del propio lote a importar.
- Renombrar en la importación cambia el nombre del directorio destino **y** el
  `name` del frontmatter, para no romper §2.1.

### 4.4 Editar (v1)

Sólo **cuerpo** y **descripción**. No se renombra (rompería symlinks y el
`name` del frontmatter a la vez) y **no se borra** en v1. Un commit por guardado.

Mensaje de commit: `editada desde la Library`.

---

## 5. Convención de commits del repositorio de skills

`~/.buzz/.agents/skills` es un repositorio git **local**: sin remotos y sin
hooks. Su única función es que ningún cambio de skill sea irrecuperable, y que
se pueda responder "quién cambió esto y por qué".

### 5.1 Regla base

**Un commit por cambio de skill.** No se agrupan dos skills en un commit, ni
siquiera dentro de la misma importación: importar tres skills produce **tres**
commits. Es lo que permite revertir una sola skill sin tocar las demás.

Excepción única: el commit inicial, `estado actual`, que fotografía lo que ya
había en disco antes de que existiera el repositorio.

### 5.2 Formato del mensaje

```
<verbo> <nombre-skill>: <motivo>

Agente: <quién lo hizo>
Origen: <de dónde viene>
```

- **Asunto**: `<verbo> <nombre-skill>: <motivo>`, en una línea, sin punto final.
  Verbos: `importa`, `crea`, `edita`.
- **`Agente:`** quién ejecutó el cambio — `Library` cuando lo hizo el usuario
  desde el desktop, o el nombre del agente cuando lo hizo un agente.
- **`Origen:`** procedencia — la ruta de origen en una importación
  (`importada de <origen>` en el motivo), `formulario` en una creación, o
  `edición` en un guardado.

Ejemplos:

```
importa qa-inspeccion-visual: importada de ~/.claude/skills

Agente: Library
Origen: /Users/william/.claude/skills/qa-inspeccion-visual
```

```
edita crear-agentes: aclara la exclusión de la descripción

Agente: Library
Origen: edición
```

### 5.3 `.gitignore`

El repositorio versiona el contenido de las skills y nada más:

```gitignore
# Artefactos de ejecución de las skills
.DS_Store
*.log
*.tmp
__pycache__/
node_modules/
.venv/

# Estado transitorio
.scratch/
```

### 5.4 Qué sigue esta convención

La meta-skill `crear-agentes`, la Skills library del desktop y cualquier agente
futuro que escriba en `~/.buzz/.agents/skills`. Un cambio hecho a mano sin commit
no rompe nada, pero deja el árbol sucio: la Library lo detecta y lo incluye en
el commit siguiente, atribuido a `Agente: desconocido`.

---

## 6. Superficies de lectura

### 6.1 Perfil del agente — sólo lectura

Dos secciones nuevas en el panel de configuración del agente, con el patrón de
secciones que ya usa `AgentConfigPanel`:

- **Skills**: las que el runtime **de ese agente** descubriría, según §1.2 y
  §1.3, separando *del nest* (`~/.buzz/...`) de *globales de la máquina*
  (`~/.agents/skills`), y marcando las que quedan **ensombrecidas** por una
  anterior con el mismo nombre. Al abrir una, se renderiza su `SKILL.md`.
- **Evals**: los `caso-NN.md` con su origen, el `boletin-ultimo.md` y el
  `feedback-log.md`, renderizados desde §3.

**Nada de crear, editar ni borrar en el perfil.** Toda escritura vive en la
Library.

### 6.2 Skills library — inventario global

Panel lateral derecho acoplado y redimensionable (el patrón de
`AuxiliaryPanel`), no un modal. Inventario global de la máquina con buscador, y
por skill: nombre, descripción de activación, qué runtimes/agentes la ven, y el
`SKILL.md` renderizado. Escritura según §4.

---

## 7. Límites de acceso a disco

Los comandos de Tauri que implementan este contrato **no** aceptan rutas
arbitrarias. Toda ruta se canonicaliza y se comprueba contra una lista de raíces
permitidas antes de leer o escribir:

**Lectura y escritura:**
- `<nest>/.agents/skills`
- `<nest>/.claude/skills`, `<nest>/.goose/skills` (los symlinks por runtime)
- `<nest>/.agents/evals`

**Sólo lectura** (orígenes de importación):
- `~/.agents/skills`
- `~/.claude/skills`, `~/.goose/skills`
- cualquier `.claude/skills`, `.goose/skills` o `.agents/skills` **elegido por el
  usuario en el diálogo del sistema** — la elección explícita del usuario es lo
  que autoriza esa raíz, y sólo para esa operación de importación.

Fuera de esas raíces, el comando falla. La comprobación se hace sobre la ruta
**canonicalizada** (`std::fs::canonicalize`), de modo que `..` y los symlinks que
apunten fuera quedan descartados por construcción.

---

## 8. Fixtures

`test-fixtures/agent-profile/` materializa este contrato para desarrollo y
tests, sin datos reales:

```
test-fixtures/agent-profile/
├── skills/                     ← un "canónico" de mentira
│   ├── resumir-hilos/SKILL.md + referencia/tono.md
│   ├── revisar-pr/SKILL.md
│   └── sin-nombre/SKILL.md     ← frontmatter sin `name`: inválida a propósito
├── import-origen/              ← origen de importación para el e2e
│   ├── resumir-hilos/SKILL.md  ← COLISIONA con el canónico
│   ├── redactar-notas/SKILL.md ← SIN descripción
│   └── traducir-actas/SKILL.md ← correcta
└── evals/ana-soporte/
    ├── caso-01.md              ← origen: nacimiento
    ├── caso-02.md              ← origen: feedback
    ├── feedback-log.md
    └── boletin-ultimo.md
```

`import-origen/` está construido para ejercitar **los dos avisos a la vez**:
una colisión de nombre y una descripción ausente.
