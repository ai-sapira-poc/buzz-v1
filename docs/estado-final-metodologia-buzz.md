# Estado final: la metodología sobre Buzz

Qué hay construido, qué de Buzz se reaprovecha, qué sobra de lo que hice, y qué
falta de verdad. Escrito después de revisar la superficie del producto, no antes.

La regla que ordena todo el documento: **no reinventar Buzz**. Si una pieza de la
metodología ya tiene sitio nativo, se usa el nativo aunque yo hubiera escrito una
versión propia.

---

## 1. El hallazgo: casi todo tiene sitio nativo

Revisada la superficie del fork, la mayor parte de la fontanería que escribí en
Python duplica algo que ya existe:

| Lo que construí | Dónde vive nativamente en Buzz | Veredicto |
|---|---|---|
| `pilot.db` tabla `jobs` | **Issues NIP-34** (`issues create/status/assign`), kinds 1621 y 1630-1633. Se pueden **asignar a agentes** | Retirar |
| Notebook del piloto | **`mem`** — NIP-AE, memoria por agente con slug, `patch` y `hash` | Retirar |
| `artifacts/` | **`notes`** (NIP-23, base de conocimiento) y **`canvas`** (documento del canal) | Retirar |
| `supervisor.py`, cola con dependencias | **Workflows**: `on: message_posted` con filtro `evalexpr` encadena pasos | Retirar |
| `launch_tower.py`, mis 8 encargos y su grafo | El **maestro** mencionando en el canal | Retirar |
| `config.json` con 15 identidades | **Managed Agents** kind 30177 / 30179 | Migrar |
| `profiles.py` / `roster.py` contratos | **Agent Persona** y **Agent Team** (NIP-AP) | Migrar |
| Coste en `pilot.db` | **NIP-AM kind 44200**, métrica de turno durable | Migrar |
| Estado de ejecución propio | **Job protocol** kinds 43001-43006 | Migrar |

Esto es trabajo mío que sobra. Lo digo aquí porque el coste de no decirlo es que
alguien lo mantenga.

### Lo que sí aporta valor y se queda

- `control_plane/roster.py` — los **contratos de rol**. El contenido es el activo;
  su envase migra a personas NIP-AP.
- `control_plane/telemetry.py` — la puerta única de OTel. Buzz instrumenta el relay,
  no a los agentes. Esto no existía.
- `control_plane/serve.py` + `supervise_one.py` — mantener agentes vivos. Es
  infraestructura, no metodología.
- `design_guard.py` y `context.py` — el acceso a estándares Sapira y el gate del
  Design System. No tienen equivalente en Buzz.

## 2. La metodología, en primitivas nativas

| Pieza de la metodología | Primitiva de Buzz |
|---|---|
| Briefing diario | Workflow `on: cron` → `send_message` al canal |
| Encadenar fases | Workflow `on: message_posted` + filtro `evalexpr` |
| Tu visto bueno | `request_approval` — **media construida, no usable hoy**: el paso falla la ejecución (WF-08). Ver `docs/inventario-buzz-para-la-fabrica.md` §1 |
| Señal humana ligera | `on: reaction_added` — un ✅ tuyo avanza la fase |
| Revisión de código | `on: diff_posted` → mención al revisor |
| Unidad de trabajo | Issue NIP-34 asignada a un agente, con sus estados |
| Entregable | Nota NIP-23; el brief del proyecto en el canvas del canal |
| Memoria del agente | `mem`, con `patch` en vez de reescritura |
| Coste | Kind 44200 por turno |
| Proyecto | Project NIP-MP con sus repos y su canal |

La pieza que lo une: **`send_message` en un canal donde hay agentes escuchando es la
orquestación**. El workflow publica, el agente responde, otro workflow se dispara con
la respuesta. Ninguna cola propia.

## 3. Lo que falta de verdad

Solo cuatro cosas, y tres son pequeñas.

### 3.1 Los roles de código no son mencionables

El maestro no puede encargar código porque `coder`, `arquitecto` y `revisor` solo
existen cuando un dispatcher los invoca. Deben ser agentes ACP como los de Hermes,
para que el maestro los mencione **sin saber que por debajo hay π**.

Existe `pi-acp` en npm (`ACP adapter for pi coding agent`, MIT, deps:
`@agentclientprotocol/sdk` + `zod`, repo `svkozak/pi-acp`). Encaja con lo que
`buzz-acp` espera: un proceso que habla ACP por stdio, lanzado vía
`BUZZ_ACP_AGENT_COMMAND`.

Advertencia honesta: es de un tercero, versión `0.0.33`, un solo mantenedor. Va en el
camino que conecta nuestros agentes de código al relay. Es aceptable para un piloto y
conviene fijar la versión; no lo daría por bueno para producción sin leerlo.

### 3.2 Los agentes tienen prohibido mencionarse

`reporting.py` convierte cada `@` en `＠`, y además verifica que no se notificó a
nadie:

```python
def report_text(text):
    """Neutralize both mention syntaxes recognized by the Buzz CLI."""
    return re.sub(r"nostr:", "nostr：", text.replace("@", "＠"), flags=re.I)
```

No es un descuido: es una defensa deliberada contra bucles, de cuando nadie debía
orquestar a nadie. Para que el maestro orqueste hay que quitarla, y **quitarla sin
sustituirla es un bucle de agentes con dinero real detrás**.

Sustituto: profundidad de delegación, presupuesto por proyecto, y la regla que ya
existe y se conserva — un mensaje que empieza por `[job-id]` es un informe, nunca un
encargo.

### 3.3 Falta comprobar si un workflow puede mencionar

La acción `send_message` lleva `text`, `channel` y `reply_in_thread`. **No tiene campo
de menciones.** Hay que comprobar si un `@nombre` dentro de `text` se resuelve a un tag
`p` al publicarse. Si no lo hace, el workflow no puede despertar a un agente, y eso es
una mejora al producto Buzz — no un parche nuestro.

### 3.4 No se pueden publicar kinds arbitrarios desde el CLI

Sigue abierto desde el análisis de Tower Control. Bloquea la proyección Nostr, y
probablemente se resuelve con un subcomando en `buzz-cli`, que es donde el repo dice
que van las operaciones de agente.

## 4. Estado construido hoy

| Pieza | Estado |
|---|---|
| 10 agentes con contratos, dos harnesses | Funcionando, 66 tests |
| Modelo único `cheap-combo` | Verificado con llamadas reales en ambos harnesses |
| Telemetría OTel, puerta única | Trazas reales en Jaeger con semconv `gen_ai.*` |
| Collector | Jaeger `buzz-jaeger`, OTLP 4317/4318, UI 16686 |
| Canal `control-plane` | El equipo. El maestro responde sin mención |
| Canal `tower-control` | El proyecto. Entregado el encargo de `producto` |
| Supervisión de agentes | `serve.py`, con reinicio y backoff |
| Preview activado | Projects, Pulse, Workflows y Forum por defecto |

Pendiente de crear: el **Project NIP-MP** (`projects list` devuelve `[]`), la
escritura en Linear (el conector solo hace `get_project`), y el enrutado por harness
si se conservara alguna cola.

## 5. Orden de trabajo

1. **`pi-acp`** → los tres roles de código pasan a ser mencionables. Desbloquea todo
   lo demás.
2. **Menciones entre agentes**, con profundidad y presupuesto sustituyendo a la
   prohibición.
3. **Comprobar la mención desde workflow** (§3.3). Determina si la cadencia se escribe
   en YAML o necesita una mejora del motor.
4. **Migrar a primitivas nativas**: issues por trabajos, notes y canvas por
   artefactos, `mem` por notebook, personas NIP-AP por contratos.
5. **Retirar** `supervisor.py`, `launch_tower.py` y la tabla `jobs`.
6. **Dar el proyecto al maestro** y dejar que research e innovación lo evolucionen.

Los pasos 4 y 5 son los que convierten esto de «un piloto en Python que habla con
Buzz» en «una metodología escrita en Buzz». Hasta hacerlos, seguimos manteniendo dos
sistemas para lo mismo.
