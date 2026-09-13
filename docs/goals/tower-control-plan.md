# Tower Control: la capa de visibilidad del control plane en Buzz

Plan para construir una pestaña nueva en el fork que responda, de un vistazo, **qué
proyectos están en marcha y qué agente está haciendo qué sobre cada uno**, con
descenso progresivo hasta la ejecución, el coste y la traza.

Y una restricción sobre el método, que es la mitad del experimento: **la feature se
desarrolla con el equipo de diez agentes que acabamos de montar**, dentro de Buzz. El
producto y la herramienta de construcción son el mismo sistema.

---

## 1. Lo que ya existe (y por tanto no se construye)

Antes de diseñar nada conviene ver cuánto de esto ya tiene sitio en el producto. La
respuesta es: casi todo el esqueleto.

| Pieza | Estado en el fork | Dónde |
|---|---|---|
| Protocolo de trabajo de agentes | **Definido**: kinds 43001–43006 (request, accepted, progress, result, cancel, error) | `crates/buzz-core/src/kind.rs` |
| Coste por turno | **Definido**: NIP-AM kind 44200, registro durable de tokens por turno | `kind.rs`, `docs/nips/NIP-AM.md` |
| Proyectos multi-repo | **Existe** (NIP-MP) con pantallas en preview | `app/routes/projects.tsx`, `features/projects/` |
| Actividad de agentes | **Visión escrita** con doce clases de render | `VISION_ACTIVITY.md` |
| Pulse | **Existe** como superficie | `app/routes/pulse.tsx` |
| OpenTelemetry en el relay | **Cableado**: capa OTLP, no-op si `OTEL_EXPORTER_OTLP_ENDPOINT` no está | `crates/buzz-relay/src/telemetry.rs` |
| Navegación de primer nivel | `app/routes.ts` + `AppSidebarPinnedHeader.tsx` tras `FeatureGate` | `desktop/src/` |

**Consecuencia para el plan:** Tower Control no es una integración nueva ni un backend
nuevo. Es una **lectura** sobre kinds que ya existen, más el trabajo de hacer que
nuestros agentes los emitan. Añadir endpoints HTTP propios iría contra la regla del
repo de preferir eventos Nostr, y además duplicaría lo que ya está modelado.

## 2. Una corrección a la premisa de partida

El encargo dice que la capa OpenTelemetry «ya está funcionando a través de Sapira».
El propio corpus de estándares de Sapira dice lo contrario, en su primera línea de
estado:

> **Almost none of it is built.** Read the *Status* column before planning around
> anything here.
> — `departments/engineering/facts/observability.md`

Lo que sí está **decidido** (ENG-ADR-0002 a 0004, ENG-STD-0018 a 0020): OTel como
contrato de instrumentación, un Collector configurado por Sapira como punto de
política, almacenamiento en la nube del cliente, Grafana como superficie. Lo que está
**construido** es poco.

Esto no invalida el objetivo, lo reordena: no podemos «traernos» un stack que todavía
no opera. La decisión tomada es no esperarlo: montamos la versión mínima del contrato ya
decidido (§4), de modo que el día que exista el Collector de Sapira no haya que
reinstrumentar nada, solo repuntar la dirección. En
concreto, ENG-STD-0018 («la telemetría sale de una aplicación por una sola puerta»)
obliga a un único módulo de telemetría por aplicación, no a llamadas dispersas.

Hay además un hueco real: **el relay emite OTel, pero los agentes no.** Ni Hermes ni π
publican trazas hoy. La visibilidad que se pide es sobre los agentes, así que ese es
el trabajo, no el relay.

## 3. Decisión de arquitectura

Dos planos, y no mezclarlos:

- **Espina dorsal legible: eventos Nostr.** El estado que Tower Control muestra —
  quién trabaja en qué, en qué fase, con qué resultado y a qué coste — son kinds
  43001–43006 y 44200. Son consultables, tienen el pipeline de auth existente, se
  reparten en tiempo real y no requieren tocar los crates.
- **Profundidad: OTel.** La traza detallada (llamadas al modelo, herramientas,
  latencias, spans anidados) sale por OTLP hacia el Collector, siguiendo las
  convenciones `gen_ai.*` / `mcp.*` que Sapira ya fijó. Tower Control **no** almacena
  trazas: enlaza a ellas por `trace_id`.

El puente entre ambos es un campo: cada evento de trabajo lleva su `trace_id`. Barato,
y suficiente para pasar de la vista de cartera al span concreto.

**Por qué no al revés.** Construir Tower Control leyendo directamente del Collector
ataría el producto a un backend que hoy no existe, y dejaría la pestaña vacía en
cualquier instalación sin observabilidad. Con la espina en Nostr, Tower Control
funciona sin Collector; la traza es el lujo, no el requisito.

### Restricción que hay que mirar de frente

Kind 44200 está **cifrado con NIP-44 hacia el owner** y sus lecturas son
owner-scoped. Es la decisión correcta de privacidad, pero significa que la vista de
coste **solo puede mostrar los agentes cuyo owner sea quien mira**. Para un director
que orquesta su propio equipo esto encaja. Para «visibilidad sobre otros proyectos»
de otras personas, no, y no se resuelve con UI: requiere una decisión de producto
sobre agregados de coste por proyecto. Hay que decidirlo antes de dibujar la pantalla,
no después.

## 4. El PoC ligero de OpenTelemetry

Decisión tomada: no esperamos al stack de Sapira, montamos la versión mínima que
sostiene la visión. «Ligero» aquí significa **un proceso nuevo y tres emisores**, no
una plataforma.

| Pieza | Qué usamos | Por qué |
|---|---|---|
| Punto de recogida | Un Collector OTLP local en Docker | Es el *policy point* que ENG-ADR-0002 ya fija. Montarlo ahora significa que el día que exista el de Sapira solo cambia la dirección |
| Superficie de traza | Jaeger all-in-one (recibe OTLP y trae UI) | Una sola imagen. Grafana/Tempo es la superficie decidida a largo plazo, pero para el PoC añade tres piezas sin añadir respuesta |
| Emisor: relay | Ya cableado | Basta con poner `OTEL_EXPORTER_OTLP_ENDPOINT` |
| Emisor: agentes Hermes | SDK de Python de OTel, ya presente en el venv de Hermes | Un único módulo de telemetría, por ENG-STD-0018 |
| Emisor: agentes π | Lo emite el dispatcher a partir del `usage` que π ya devuelve | π no lleva OTel y no vamos a instrumentarlo por dentro para un PoC |

Comprobado hoy: Docker Hub vuelve a responder (el fallo anterior era transitorio) y el
SDK de Python está disponible. No hay que instalar nada más.

Lo que el PoC **no** hace, y conviene decirlo antes de que parezca una regresión: no
hay redacción, ni muestreo, ni retención por clase de dato (ENG-STD-0020). Son
propiedades del Collector de producción. El PoC usa datos de nuestro propio equipo en
local, así que el riesgo es asumible; convertirlo en algo que toque datos de cliente
exige esas tres cosas y no es un ajuste de configuración.

*Aceptación del PoC:* un encargo real del control plane produce una traza única que
atraviesa dispatcher → agente → llamada al modelo, visible en la UI, y su `trace_id`
aparece en el evento Nostr del trabajo. Sin ese enlace no hay descenso posible y el
PoC no vale.

## 5. Fases

### Fase 0 — Hacer legibles a nuestros propios agentes

Sin esto la pestaña nace vacía: los diez agentes no publican hoy ni 43001–43006 ni
44200. Es la fase que más valor tiene y la que nadie pediría primero.

- El dispatcher publica `43001` al encargar, `43003` en hitos, `43004`/`43006` al
  cerrar, con `h` del canal y referencia al proyecto.
- Cada turno de Hermes y de π publica `44200` con tokens reales. π ya devuelve
  `usage` en su stream; Hermes lo tiene en el resultado de la conversación.
- Un único módulo de telemetría por harness (ENG-STD-0018), no llamadas dispersas.

*Aceptación:* una consulta por kinds 43001–43006 sobre el canal devuelve el ciclo
completo de un encargo real, y la suma de 44200 de ese encargo cuadra con el coste que
el harness reportó. Verificado con una consulta, no leyendo un canal.

### Fase 1 — La vista de cartera

Pestaña `/tower` junto a Agents y Pulse, tras `FeatureGate` como el resto de preview.

Una fila por proyecto: qué es, quién trabaja ahora, desde cuándo, estado, y la señal
de si algo necesita al operador. El criterio de VISION_ACTIVITY aplica tal cual —
**verbo, objeto, resultado** — y cada fila se gana sus píxeles respondiendo a
comprensión, confianza o control.

*Aceptación:* con dos proyectos y varios encargos en vuelo, la pantalla distingue sin
interacción cuál está bloqueado. Capturas por el camino de `just desktop-screenshot`.

### Fase 2 — El descenso

Proyecto → encargos → turnos → coste. Cada nivel es el mismo modelo con más
resolución, no una pantalla distinta. El `trace_id` enlaza al Collector cuando esté
configurado, y cuando no, el enlace no se muestra en lugar de fallar.

*Aceptación:* desde una fila de cartera se llega en dos clics al turno concreto y a su
coste, y el coste agregado del proyecto es la suma de sus turnos, no una estimación.

### Fase 3 — Linear como espejo, no como fuente

Los proyectos de Linear se enlazan y su estado se proyecta; Buzz no se convierte en un
segundo backlog. El mapeo `area → linear_project ↔ buzz_project` ya está descrito en
`docs/vision-control-plane-en-buzz.md`.

*Aceptación:* un proyecto muestra su ticket de Linear y su estado real, y una
discrepancia entre ambos se ve en vez de resolverse en silencio.

## 6. Cómo lo desarrollamos: el equipo construyendo su propia visibilidad

Un proyecto de Buzz, en el canal `control-plane`, con encargos reales:

| Rol | Encargo | Harness |
|---|---|---|
| producto | Problema, outcome y aceptación medible. Decidir el agregado de coste entre owners | Hermes |
| estrategia | Si esta capa es la apuesta correcta frente a comprar observabilidad hecha | Hermes |
| innovación | La opción que nadie pidió: qué permitiría esta capa que hoy ni planteamos | Hermes |
| research | Convenciones `gen_ai.*`/`mcp.*` y arte previo en observabilidad de agentes | Hermes |
| arquitecto | Frontera: qué es evento Nostr, qué es span, y qué NO se guarda. Solo lectura | π |
| diseño | La pantalla sobre Sapira Design System, con estados vacío/carga/error | Hermes |
| analista | Qué métricas son honestas: denominadores, ventanas, qué no se puede afirmar | Hermes |
| coder | Implementación por fases | π |
| revisor | Riesgos derivados del requisito antes de leer la implementación | π |
| maestro | Cartera, dependencias, briefing diario y brief de Linear | Hermes |

Orden: producto y arquitecto primero, porque fijan qué se mide; research en paralelo;
estrategia e innovación antes de escribir código, mientras cambiar de idea es barato.

**Esto es a la vez la feature y la prueba del sistema.** Si el equipo no consigue
construir la capa que haría visible su propio trabajo, eso es un resultado sobre el
equipo, y hay que reportarlo como tal en lugar de terminar la feature a mano.

## 7. Riesgos

| Riesgo | Por qué importa | Qué hacemos |
|---|---|---|
| El coste owner-scoped no agrega entre owners | Rompe «visibilidad sobre otros proyectos» | Decisión de producto en Fase 0, antes de diseñar |
| Instrumentar el harness contamina el trabajo | Medir cambia lo medido si se hace en el camino caliente | Emisión asíncrona, y medir el coste de medir |
| El Collector de Sapira no existe todavía | La Fase 2 podría quedar a medias | La espina Nostr funciona sin él; la traza degrada a no mostrarse |
| Reimplementar Projects o Pulse | Trabajo duplicado sobre superficies en preview | El arquitecto evalúa primero si Tower extiende Pulse en vez de nacer aparte |
| Que el equipo no sea capaz y lo terminemos a mano | Falsearía el experimento | Se reporta el fallo; no se disfraza de éxito |

## 8. Lo que hay que decidir antes de empezar

1. **Agregado de coste entre owners**: ¿la vista muestra solo lo tuyo, o definimos un
   agregado por proyecto? Condiciona el modelo de datos, no solo la pantalla.
2. **Tower como pestaña nueva o como profundidad de Pulse.** Pulse ya existe; el
   arquitecto debe responderlo con evidencia antes de crear la ruta.
3. **Alcance de la instrumentación**: ¿solo los diez agentes del control plane, o
   cualquier agente de Buzz? Lo segundo es la feature de producto; lo primero es el
   camino corto para tener algo que mirar.
