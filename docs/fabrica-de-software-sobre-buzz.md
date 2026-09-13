# La fábrica de software, sobre Buzz

Estudio del [modelo de Uber](https://www.uber.com/gb/en/blog/efficient-software-factory/)
(septiembre 2026) y qué parte se aplica a nuestro control plane. No todo: parte de lo
que hacen solo tiene sentido a su escala, y decirlo es más útil que copiarlo.

El cambio de perspectiva que aporta, y que es más importante que cualquiera de sus
herramientas: **una fábrica de software con agentes es un sistema económico, no solo
técnico.** Si no puedes atribuir una subida de gasto a un factor concreto, la discusión
se vuelve una opinión sobre si los agentes «salen caros».

Sus resultados, para calibrar: entre febrero y agosto de 2026, **7x usuarios semanales**
y **9,4x peticiones agénticas**, con el **coste por 1.000 peticiones bajando un 34%** y
el **coste por sesión un 52%**. Y **más del 70% de sus pull requests** los atribuyen a
agentes.

---

## 1. La ecuación de coste

Es el corazón del artículo. El gasto total se descompone en seis factores
multiplicativos:

```
usuarios × sesiones/usuario × turnos/sesión × peticiones/turno × tokens/petición × precio/token
```

La virtud no es la fórmula, es lo que hace con una discusión: **los dos primeros factores
son adopción** —si suben, es que el sistema se usa, y recortarlos es recortar el
producto—, **los tres del medio son las palancas de ingeniería**, y **el último es del
proveedor**. Una subida de gasto deja de ser un susto y pasa a tener una dirección.

**Implementado.** `economics.py` calcula los seis factores desde nuestro registro de
eventos, en nuestros términos (operadores, encargos, turnos). Con una prueba que verifica
que **los factores se multiplican y reconstruyen el total** — si no, la descomposición es
decoración.

Y una decisión deliberada: si no hay precio configurado, las columnas de dinero dicen
«desconocido» en vez de inventar una cifra. Un coste inventado es peor que ninguno,
porque acaba citado como dato.

### Lo que nos faltaba para poder calcularla

El consumo por turno no se guardaba en ningún sitio consultable. Iba a un span de OTel
—que va a un colector opcional, muestreado y ausente en un día normal— y Buzz publica el
suyo (NIP-AM kind 44200) **cifrado al dueño y sin ruta de descifrado desde el CLI**.
Ninguno de los dos podía responder «cuánto costó esto».

Ahora `telemetry.record_usage` escribe además un evento durable. Es un espejo local de un
número que el harness ya reporta, no una segunda medición.

## 2. Coste por resultado, no por token

*«Para cada agente gestionado: coste denominado en resultado (coste por PR mergeada, por
revisión, por alerta), señal de calidad (tasa de revert, F1, MTTR), volumen.»*

Esto corrige un error fácil: un turno más barato que falla **no es más barato**, es un
pago más pequeño por nada. Medir tokens premia al agente que se rinde rápido.

**Implementado.** `economics.per_outcome()` da coste por encargo y marca explícitamente
`desperdicio` cuando el encargo no cerró. Nuestro equivalente a «coste por PR mergeada»
es, de momento, coste por encargo entregado; cuando abramos PRs de verdad, el
denominador mejora solo.

## 3. Los anti-patrones de gasto

Uber tiene un panel que analiza todas las trazas de sesión y **señala 16 anti-patrones,
cada uno con su impacto financiero y su remedio concreto**. El artículo nombra cuatro:
enrutado subóptimo a un modelo caro para tareas simples, hinchazón de contexto, caché de
prompt expirada, y sobrecarga de inicialización (más de 100.000 tokens antes de que el
usuario escriba nada).

**Implementado, cuatro de ellos**, elegidos porque son los que nuestro propio sistema
comete:

| Patrón | Por qué nos pasa |
|---|---|
| **Preámbulo repetido** | Inyectamos contrato de rol + handoff en cada turno. Un encargo largo paga el mismo preámbulo N veces |
| **Contexto que se hincha** | La entrada crece turno a turno dentro de un encargo |
| **Reintento contra un muro** | El freno de repetición ya lo detecta; esto le pone precio |
| **Gasto sin entrega** | El más caro de todos: 100% desperdicio por definición |

Con una regla que me impuse: **todo hallazgo lleva un remedio**, con prueba que lo exige.
Un hallazgo sin qué hacer es una queja.

## 4. Code-mode: el mayor ahorro medido

*«El bucle corre en un subproceso, y solo vuelve el resumen.»*

Lo caro de una llamada a herramienta no es el trabajo: es que **cada resultado
intermedio vuelve al contexto del modelo y se factura otra vez en el siguiente turno**.
Uber midió **55-71% menos tokens en consultas simples y más del 90% en trabajo masivo**
moviendo el bucle fuera del modelo.

**Implementado.** Una acción `batch` que ejecuta hasta 12 operaciones en un turno. Tres
lecturas y una escritura cuestan un turno de contexto en vez de cuatro.

Tres garantías, con prueba cada una:

- **Un batch no concede ningún permiso.** Cada paso pasa por `operate` igual que si se
  llamara solo. Cambia cuántos turnos cuesta el trabajo, nunca qué puede hacer.
- **No anida.** `batch` dentro de `batch` sería un bucle sin frontera de turno que lo
  pare, y `delegate` dentro crearía trabajo que nadie vio nacer.
- **Un paso fallido conserva lo ya hecho.** Tirar el batch entero al primer error lo
  haría más arriesgado que las llamadas secuenciales que sustituye, y eso lo derrotaría.

## 5. Resolución de herramientas por CLI

Uber proyecta **más de 1.000 servidores MCP como comandos de shell**, eliminando
**50-70K tokens** de esquema. Su ejemplo: una suite ofimática son ~22K tokens solo de
descripciones.

**Ya lo tenemos, y sin querer.** Nuestros agentes usan `buzz`, un CLI, no MCP. Y el sync
de upstream trajo justo esto: el #7584 renderiza **un árbol de comandos pensado para
agentes** en `buzz --help`, y el #7586 apunta a los agentes ahí en vez de a una tabla de
comandos en el prompt. Es la misma idea, llegando desde el lado del producto.

Queda una deuda nuestra en la dirección contraria: el esquema de nuestra herramienta
`pilot` es un párrafo largo que viaja en cada turno. Medirlo es el siguiente paso obvio.

## 6. Enrutado por modelo: la palanca que NO activamos

Uber selecciona modelos por benchmark propio y **enruta subtareas bien definidas a
modelos baratos mientras el modelo principal descompone**. Es exactamente el patrón
orquestador–ejecutor.

**No implementado, a propósito.** Hoy todo va a un único combo por decisión explícita, y
tener un solo modelo hace que cualquier comparación entre agentes sea limpia. Activar
enrutado antes de tener la contabilidad sería optimizar sin poder demostrar la mejora.

Con `economics.py` funcionando, el orden correcto queda claro: **medir primero, enrutar
después**. La ecuación dirá si el precio/token es siquiera nuestro problema — sospecho
que hoy lo es más el preámbulo repetido.

## 7. Lo que aplazamos y por qué

**El grafo de contexto** (24 millones de nodos, 80 millones de aristas, 30+ sistemas
internos). El dato que lo justifica es contundente: una consulta con grafo tardó **38
segundos y acertó**; sin grafo, **más de 20 minutos y falló**. Pero es infraestructura de
años, y nuestro equivalente barato ya existe en Buzz: `notes` como base de conocimiento
del equipo, `mem` como memoria por agente, y FTS para reencontrar ambos.

**La caché de prompt con TTL elegido** (5 min a 1,25x de coste de escritura frente a 1 h
a 2x; ellos adoptaron 1 h para sesiones interactivas con pausas de más de 5 minutos).
Depende del proveedor y de OmniRoute; no es nuestro a decidir todavía.

**El tope de contexto a 400K con compactación automática** y **razonamiento medio por
defecto**. Ambos son configuración de harness razonable, pero no sabemos si nos afectan
hasta medir.

**Los tramos de gasto con avisos al 50/80/100%.** Fácil y útil, pero sin precio
configurado avisaría en tokens, que no es la unidad en la que decide un operador.

## 8. El modelo de cuatro capas

Uber organiza el uso de IA de lo específico a lo general, y dice que **las capas altas
dan más control sobre coste, calidad y elección de modelo**. En nuestro sistema:

| Capa | Uber | Nosotros |
|---|---|---|
| 1 — más especializada | Agentes gestionados: revisión de código, auto-reparación de CI, triaje | El equipo de roles: `@coder`, `@revisor`, `@diseno`… |
| 2 | Flujos de generación y validación | El protocolo 90/7/3 y sus puertas |
| 3 | Despliegue y observación | Tower Control |
| 4 — más general | Interfaces interactivas | El canal de Buzz, y esta conversación |

La lección operativa: **cuanto más especializada la tarea, más barato debe ser el modelo
y más estricta la puerta de salida.** Es la misma conclusión a la que llegó el protocolo
orquestador–ejecutor por otro camino.

## 9. Qué queda encima de la mesa

1. **Medir el esquema de la herramienta `pilot`** — probable candidato a los 50-70K
   tokens que Uber elimina.
2. **Recortar el preámbulo repetido**, que es nuestro anti-patrón más caro por diseño.
3. **Enrutado por modelo**, cuando la ecuación diga que el precio/token importa.
4. **Coste por PR**, cuando el equipo abra PRs y el denominador sea de verdad un
   resultado.
5. **Tramos de gasto con aviso**, cuando haya precio configurado.

Nada de esto requiere inventar primitivas: la contabilidad es nuestra porque Buzz cifra
la suya al dueño, y el resto se apoya en lo que ya existe.
