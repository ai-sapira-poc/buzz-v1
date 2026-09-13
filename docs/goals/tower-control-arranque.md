# Tower Control — plan de arranque

Feature nueva, pestaña propia, reutilizando la fontanería de Pulse. Requisito
añadido y decisivo: **si mañana nos movemos de Buzz a otra cosa que hable OTel, la
migración debe ser barata.**

Complementa a [tower-control-plan.md](tower-control-plan.md), que mantiene el
contexto, los kinds existentes y el análisis del estado de OTel en Sapira.

---

## 1. La inversión que obliga el requisito de portabilidad

El plan anterior proponía la espina dorsal en eventos Nostr, con OTel como
profundidad opcional. **Con el requisito de portabilidad eso se invierte**, y lo digo
explícitamente porque es un cambio de recomendación, no un matiz:

| | Plan anterior | Ahora |
|---|---|---|
| Fuente de verdad | Eventos Nostr (kinds 43001–43006, 44200) | **El span de OTel** |
| Papel de los eventos Nostr | La espina | **Proyección derivada**, caché legible dentro de Buzz |
| Coste de migrar | Reescribir el modelo entero | Escribir un adaptador |

El motivo es de fidelidad, no de gusto. Si lo canónico son los eventos Nostr y OTel
se deriva de ellos, al migrar te llevas lo que cupo en el evento y pierdes el resto.
Si lo canónico es el span, los eventos Nostr son desechables: una proyección que
existe para que la pestaña vaya rápida y funcione sin backend, y que se puede
regenerar o abandonar sin perder nada.

Lo que **no** cambia: Tower Control sigue funcionando sin Collector. La proyección
Nostr es lo que lo permite. La diferencia es quién manda cuando ambos existen.

## 2. La frontera de portabilidad: un puerto, dos adaptadores

Todo lo que la UI sabe del mundo pasa por una interfaz. Moverse de Buzz = escribir un
adaptador nuevo, sin tocar ni una pantalla.

```
  features/tower/ui/          ← pantallas. No conocen Buzz ni Nostr ni OTLP.
         │
         ▼
  features/tower/domain/      ← modelo neutro + el puerto TowerSource
         │
    ┌────┴─────────────────────────┐
    ▼                              ▼
  shared/api/towerBuzzSource.ts   shared/api/towerOtlpSource.ts
  (kinds 43001–43006, 44200)      (consulta a un backend OTel)
  se construye ahora              se construye el día que haga falta
```

**Regla que hace que esto sea cierto y no un diagrama bonito:** ningún fichero bajo
`features/tower/ui/` puede importar de `shared/api/relay*`, `nostr`, ni mencionar un
kind. Es verificable con una prueba, y va con una (§5).

### El modelo neutro habla OTel, no Buzz

Los campos se nombran según las convenciones semánticas que Sapira ya fijó
(`gen_ai.*`, `mcp.*`), de modo que el mapeo hacia un backend OTel sea la identidad y
no una traducción:

| Concepto Tower | Campo | Origen OTel |
|---|---|---|
| Proyecto | `project.id`, `project.name` | atributo de recurso |
| Encargo | `run.id` = `trace_id` | traza raíz |
| Turno | `turn.id` = `span_id` | span |
| Agente | `gen_ai.agent.name`, `gen_ai.agent.id` | semconv |
| Modelo | `gen_ai.request.model`, `gen_ai.response.model` | semconv |
| Coste | `gen_ai.usage.input_tokens`, `.output_tokens` | semconv |
| Estado | `run.status` ∈ requested/running/blocked/done/failed | derivado |

`run.id = trace_id` es el detalle que hace barata la migración: el identificador del
encargo **ya es** el de la traza, así que no hay tabla de correspondencias que
mantener ni que migrar.

## 3. Qué se reutiliza de Pulse

Sin copiar y pegar: se extrae a `shared/` lo que sirve a ambos y se deja Pulse
funcionando igual.

| Pieza de Pulse | Uso en Tower |
|---|---|
| `pulseFocusRefetchPolicy`, `useFocusedRefetchInterval`, cadencias 30 s/60 s | Idéntico. Se promueve a `shared/lib/feedRefetchPolicy` con su test |
| Patrón de `pulseQueryKeys` (clave estable ordenada) | Mismo patrón para `towerQueryKeys`; el bug de churn por referencia ya está resuelto ahí |
| `PulseScreen` + `PulseTabBar` (shell y pestañas) | El shell se generaliza; Tower tiene sus propias pestañas |
| `AgentActivityCard` + `groupAgentNotes` | La agrupación por agente y el `StatusDot` son exactamente lo que pide la fila de cartera |
| Ruta con `React.lazy` + `FeatureGate` + search params de perfil | Se copia el patrón para `/tower` |

Lo que **no** se reutiliza: `hooks.ts` de Pulse está atado a notas sociales
(`getGlobalNotes`, reacciones). Tower no tiene notas. Reutilizar ese módulo sería
arrastrar un modelo que no es el nuestro.

## 4. Primeros pasos, en orden

### Paso 1 — Agregado de coste: DECIDIDO (owner-scoped, con cobertura explícita)

Kind 44200 está cifrado hacia el owner. La vista muestra **solo los agentes cuyo
owner es quien mira**, y no se define de momento ningún agregado entre owners.

Por qué: hoy el operador es owner de los diez agentes, así que owner-scoped cubre el
100% del caso real y no pierde nada. Y la reversibilidad es asimétrica — añadir un
agregado después es barato; despublicar coste que no debía compartirse es imposible.
Un agregado entre owners obliga además a decidir si el gasto de los agentes de otra
persona es visible en una comunidad compartida, y eso es una decisión de producto que
no urge tomar para ver funcionar la pestaña.

**La consecuencia que sí hay que construir desde el primer día.** El riesgo no es el
dato que falta: es el subconteo que parece completo. Un total de proyecto que suma en
silencio solo los turnos legibles es un número erróneo presentado como correcto. Por
eso el modelo neutro lleva cobertura, no solo importe:

```ts
cost: {
  inputTokens: number;
  outputTokens: number;
  coverage: { observedAgents: number; totalAgents: number };
}
```

La UI **nunca** muestra un total pelado. Cuando `observedAgents < totalAgents` lo dice
en la propia cifra. Y va con prueba: un proyecto con un agente cuyas métricas no se
pueden leer no puede renderizar su total como si estuviera completo.

### Paso 2 — El módulo de telemetría, una puerta por harness

ENG-STD-0018. Un módulo por harness, no llamadas dispersas:

- `control_plane/telemetry.py` — SDK de Python de OTel, ya presente en el venv de
  Hermes. Abre el span raíz del encargo, uno por turno, y adjunta `gen_ai.*`.
- Para π: el dispatcher abre el span a partir del `usage` que π ya devuelve. No se
  instrumenta π por dentro.
- Emisión **fuera del camino caliente**, y se mide el coste de medir. Si
  instrumentar cambia lo instrumentado, la observabilidad miente.

*Aceptación:* un encargo real produce una traza que va de dispatcher a agente a
llamada al modelo, y los tokens del span cuadran con los que reportó el harness.

### Paso 3 — La proyección Nostr, derivada del span

El mismo módulo publica 43001/43003/43004/43006 y 44200, **con `trace_id` dentro**.
Derivado del span, nunca al revés.

*Aceptación:* una consulta por kinds devuelve el ciclo completo de un encargo y su
`trace_id` coincide con el de la traza.

### Paso 4 — El puerto y el adaptador de Buzz

`features/tower/domain/TowerSource.ts` y `shared/api/towerBuzzSource.ts`. El
adaptador se prueba contra eventos fijos, sin relay.

### Paso 5 — La pestaña

`/tower` en `app/routes.ts`, entrada en `AppSidebarPinnedHeader`, feature `tower` en
`preview-features.json`. Una fila por proyecto: verbo, objeto, resultado — el criterio
de `VISION_ACTIVITY.md`. Sobre Sapira Design System, con vacío, carga y error.

### Paso 6 — El descenso

Proyecto → encargos → turnos → coste, y enlace a la traza **solo si hay Collector
configurado**. Sin él, el enlace no se muestra; no falla.

## 5. Las pruebas que hacen que esto sea verdad

Una guarda que no falla al romperse no protege nada:

1. **Aislamiento del puerto**: un test recorre `features/tower/ui/` y falla si algún
   fichero importa relay, nostr o nombra un kind. Es la prueba de portabilidad;
   sin ella, la frontera se erosiona en la tercera PR.
2. **Identidad del mapeo**: para un span de ejemplo, el objeto del dominio y los
   atributos OTel tienen los mismos valores en los mismos nombres.
3. **Fidelidad de la proyección**: un encargo emitido produce eventos Nostr cuyo
   `trace_id` y tokens coinciden con el span. Si divergen, la caché miente.
4. **El adaptador sin red**: `towerBuzzSource` contra eventos fijos.
5. **Coste de medir**: el mismo encargo con y sin telemetría; si la diferencia no es
   despreciable, se reporta.

## 6. Reparto

| Paso | Rol | Harness |
|---|---|---|
| 1 Agregado de coste | producto (decide con el operador) | Hermes |
| Frontera y puerto | arquitecto — solo lectura, decide antes de que se escriba UI | π |
| 2 y 3 Telemetría y proyección | coder | π |
| 4 Adaptador | coder | π |
| 5 Pantalla | diseño primero, luego coder | Hermes → π |
| Métricas honestas | analista | Hermes |
| 1–6 Revisión | revisor, riesgos derivados antes de leer la implementación | π |
| Cartera y briefing | maestro | Hermes |

Estrategia e innovación entran antes del paso 2, mientras cambiar de idea sigue
siendo barato: si la respuesta correcta es comprar observabilidad hecha en vez de
construirla, es ahora cuando sale barato saberlo.

## 7. Riesgos propios de este arranque

| Riesgo | Qué hacemos |
|---|---|
| La frontera del puerto se erosiona | Test de aislamiento desde la primera PR, no al final |
| La proyección Nostr se convierte de facto en la fuente | Test de fidelidad; si diverge, falla |
| Extraer de Pulse rompe Pulse | Se extrae a `shared/` con sus tests, y la suite de Pulse debe seguir verde |
| Instrumentar contamina la medición | Emisión asíncrona y medición del coste de medir |
| `run.id = trace_id` resulta insuficiente | Es reversible: añadir un id propio después es barato; quitarlo, no. Empezamos por lo simple |

---

## 8. Estado de lanzamiento

Lo que está montado y verificado a día de hoy, antes de que el equipo empiece.

| Pieza | Estado | Evidencia |
|---|---|---|
| Collector OTLP | Jaeger `buzz-jaeger`, UI en 16686, OTLP en 4317/4318 | `curl` 200 en ambos |
| Puerta única de telemetría | `control_plane/telemetry.py` | Traza real en Jaeger con atributos `gen_ai.*` |
| Emisión desde π | El dispatcher registra el turno con el `usage` que π devuelve | `gen_ai.usage.input_tokens = 157` en una ejecución real |
| Emisión desde Hermes | `worker.run` abre el span raíz del encargo | `trace_opened` en el registro de eventos |
| `run.id = trace_id` | Devuelto en el record y registrado | — |
| Canal del proyecto | `tower-control` `55c3438a-e7e8-4d5c-acd9-6e066a8f178d`, 11 miembros | — |
| Encargos | `control_plane/tower_project.py`, 8 briefs con dependencias | — |
| Lanzador | `control_plane/launch_tower.py`, idempotente y reanudable | `--dry-run` resuelve el orden correcto |
| Modelo | Todo a `cheap-combo`, en ambos harnesses | Llamadas reales en ambos |

### Cómo se lanza

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 \
  ~/.hermes/hermes-agent/venv/bin/python control_plane/launch_tower.py --dry-run
```

Sin `--dry-run` despacha de verdad. Cada encargo ya hecho se salta, así que un
lanzamiento interrumpido se reanuda en vez de duplicar trabajo. `--only <rol>` despacha
uno solo.

Se usa el intérprete del venv de Hermes porque es el único que tiene a la vez el
runtime del agente y el SDK de OpenTelemetry. Con el python del sistema la telemetría
se desactiva sola y el trabajo sigue: comprobado en una ejecución real, no supuesto.

### Coste de medir

Medido, no estimado: **0,0008 ms por span apagado, 0,0155 ms encendido**, frente a
turnos de ~2.900 ms. La instrumentación no cambia lo instrumentado.

### Lo que el equipo tiene que construir y aún no existe

La proyección Nostr (Paso 3) necesita publicar kinds arbitrarios, y **el CLI no lo
permite hoy**: no hay subcomando para enviar un evento firmado de un kind cualquiera,
solo los kinds con superficie propia. Es un hueco real del producto, está en el brief
del arquitecto para que lo verifique y busque los demás, y probablemente se resuelva
con un subcomando nuevo en `buzz-cli` — que es donde el repo dice que van las
operaciones de agente.

No lo he tapado con un atajo a propósito: taparlo habría escondido justo el tipo de
carencia que este proyecto existe para hacer visible.
