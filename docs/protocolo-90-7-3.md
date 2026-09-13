# El protocolo 90/7/3 y el patrón orquestador–ejecutor

Investigación sobre dos ideas que Alex formuló desde su práctica, contrastadas con
literatura y datos públicos (septiembre 2026). El objetivo no es validarlas por
cortesía: es separar qué parte tiene respaldo, qué parte es una aportación propia, y
dónde la evidencia dice algo incómodo.

---

## Parte 1 — Las tres iteraciones

### La formulación

1. **90%** — construir la solución. Aparecen cosas que no funcionan del todo.
2. **7%** — los detalles, casos límite y flujos que se quedaron por el camino.
3. **3%** — diseño y UX: design system, componentes que muestran lo que toca en cada
   ocasión, control de estados, experiencia fluida para el operador.

### Lo que ya existe

La primera parte es una vieja conocida, y con un nombre más pesimista. La **regla
noventa-noventa**, acuñada por Tom Cargill en Bell Labs en 1985: *el primer 90% del
código consume el primer 90% del tiempo; el 10% restante consume el otro 90%*. Suma
180% a propósito — es una broma sobre los plazos que se van al traste
([Wikipedia](https://en.wikipedia.org/wiki/Ninety%E2%80%93ninety_rule)).

La etapa 1 tiene tres nombres consolidados para la misma idea: **tracer bullet** (Dave
Thomas, *The Pragmatic Programmer*), **walking skeleton** (Alistair Cockburn) y **steel
thread**. El camino más fino de punta a punta que atraviesa todas las capas y demuestra
que cada frontera de integración funciona. Importante: **es código de producción, no un
prototipo** — cada línea se queda
([Code Climate](https://codeclimate.com/legacy/kickstart-your-next-project-with-a-walking-skeleton)).

La etapa 3 tiene su precedente más fuerte fuera del software de gestión: en videojuegos,
**la fase de pulido es una etapa de producción reconocida**. Rod Fergusson, productor
ejecutivo de Gears of War 2, la describe como el último 10–20% del esfuerzo, una vez
que todo funciona, dedicado a detalles pequeños con gran impacto en la calidad
percibida: *«puede coger un buen juego y hacerlo grande»*
([Game Developer](https://www.gamedeveloper.com/design/the-art-of-game-polish-developers-speak)).

Y hay un hallazgo que conecta directamente con la intuición del operador: **si la
interfaz responde bien, el usuario percibe todo el producto como de alta calidad**. La
sensación de superficie gobierna el juicio de calidad del conjunto
([hackread](https://hackread.com/the-juice-factor-designing-game-feel/)).

### Lo que es aportación propia

**No encontré prior art para partir ese último 10% en dos etapas con criterios
distintos.** La literatura habla del «último 10%» como un bloque indiferenciado de
dolor. La separación 7/3 es la contribución, y es útil precisamente porque los dos
tienen naturalezas distintas:

| | El 7% | El 3% |
|---|---|---|
| Qué se arregla | Corrección: casos límite, flujos incompletos, integración | Percepción: estados, latencia, consistencia visual |
| Cómo se verifica | Objetivamente: un test falla o pasa | Por juicio: contra un design system y unos umbrales |
| Quién lo ve | Nadie, si está bien hecho | Todo el mundo, siempre |
| Si se omite | Fallos intermitentes en producción | El producto «se siente barato» sin que nadie sepa decir por qué |

Mezclarlos en un solo «pulido» es lo que hace que el 3% se caiga primero: compite por el
mismo hueco de tiempo que un bug, y un bug siempre gana esa discusión.

### Lo que la evidencia dice en contra

Tres objeciones que conviene mirar de frente.

**«3%» invita a presupuestar mal.** Fergusson mide esa fase en 10–20% del esfuerzo. Un
desarrollador indie va más lejos: sostiene que ese «trocito final» es la parte más
importante y merece **la mitad del tiempo de desarrollo o más**, y que llamarlo «poco»
lleva justo a subestimarlo y a correr
([Fancy Fish Games](http://david.fancyfishgames.com/2014/08/dont-get-caught-in-last-10-trap.html)).
Los números 90/7/3 describen bien **la proporción de superficie del sistema**; describen
fatal la proporción de esfuerzo. Conviene decirlo explícitamente o el nombre hará el
daño que la regla 90/90 lleva cuarenta años denunciando.

**Diferir el endurecimiento es exactamente lo que las fuentes desaconsejan.** Un enfoque
no basta con que sea *posible*: tiene que ser escalable, asequible, mantenible,
performante y usable, y eso se construye desde el principio, no se añade después
([The Digital Business Analyst](https://thedigitalbusinessanalyst.co.uk/tracer-bullet-why-we-must-build-features-during-discover-952df9c5a65b)).
En videojuegos la recomendación es la misma en versión práctica: **asignar un 10–20% de
cada hito a pulir**, en lugar de dejar un hito de pulido colosal al final que el
presupuesto se acaba comiendo
([Indie Games 101](https://indiegames101.com/blog/2023-11-07-on-polishing-bits/)).

La lectura que salva la idea: **el 7 y el 3 no son fases del proyecto, son puertas de
cada rebanada**. Cada slice vertical pasa por las tres antes de considerarse cerrado. Si
se convierten en tres fases secuenciales del proyecto entero, la tercera no ocurre
nunca — y eso no es una hipótesis, es lo que documentan las fuentes.

**Pulido no es efecto.** Hay una crítica seria al «juice»: por miedo a que el producto
parezca soso, todo el mundo imita los mismos efectos exagerados, cada interacción
parece una explosión en miniatura y los productos acaban pareciéndose entre sí
([Wayline](https://www.wayline.io/blog/the-juice-problem-how-exaggerated-feedback-is-harming-game-design)).
Para una herramienta de operador esto importa: el 3% no es animación, es **manejo de
estados y latencia**.

### Qué es el 3%, concretamente

Las fuentes de UX convergen en algo muy alineado con «componentes que muestran lo que
tienen que mostrar en cada ocasión»:

- **Los tres estados que siempre se caen**: cargando, vacío y error. El desarrollo suele
  empezar por el estado con contenido y posponer los otros tres; el problema acaba en
  manos de cada desarrollador con diálogos y toasts improvisados, y con varias pantallas
  y varias personas, las soluciones inconsistentes **cambian el comportamiento del
  usuario**.
- **Separación de responsabilidades**: el skeleton es forma, el empty state es
  explicación, la alerta es un problema. Tres componentes distintos, no uno polivalente.
- **Un estado vacío sin texto es el peor de todos**: el usuario no puede distinguir
  entre «no hay nada», «hubo un error» y «sigue cargando», y reintenta
  ([NN/g](https://www.nngroup.com/articles/empty-state-interface-design/)).
- **Umbral de Doherty, ~400 ms**: por debajo se percibe instantáneo; de 400 ms a 1 s hace
  falta feedback para mantener el flujo; por encima de 1 s hace falta progreso real o la
  tarea se abandona.

Eso es un criterio de aceptación comprobable, no una opinión de gusto. Y encaja con que
el design system sea el vehículo: **la mayoría de los design systems ya contemplan
estados vacío, error y éxito** — usarlos es gratis, reinventarlos es lo que cuesta.

---

## Parte 2 — Orquestador fuerte, ejecutores baratos

### La formulación

Un modelo top (Opus, Sonnet) orquesta; subagentes de un modelo más simple pero con
razonamiento al máximo hacen el trabajo; el orquestador **verifica, completa lo que
falta, arregla lo que esté mal** y abre PRs pequeñas.

### Esto tiene respaldo, y con números

El patrón está descrito y medido:

- En **Terminal-Bench 2.0** (89 tareas), Opus 4.8 orquestando un ejecutor GLM-5.2
  puntúa **69.7 frente a 58.4** del GLM-5.2 en solitario: **+11.3**.
- El **system card de Opus 4.5** reporta Opus 4.5 como orquestador con subagentes
  Sonnet 4.5 alcanzando **85.4%**, lo que indica que la elección del subagente afecta
  materialmente al resultado de todo el pipeline.
- El ahorro que se atribuye al patrón es de **5–10x en coste de tokens** sin degradar
  la calidad de forma apreciable
  ([Augment Code](https://www.augmentcode.com/guides/ai-model-routing-guide),
  [Zorost](https://zorost.com/orchestrator-worker-model-loops)).

### Por qué la verificación es la pieza que lo hace funcionar

Hay una razón teórica, no solo empírica: la **asimetría generador–verificador**.
Verificar es discriminativo («¿esto es correcto?»), generar es creativo («¿qué debería
ser esto?»); los errores son más fáciles de detectar que de evitar, porque basta
reconocer **un** problema en lugar de construir una solución perfecta. Existe un
**solver-verifier gap** documentado: los modelos reconocen una solución correcta mejor
de lo que la generan.

Y hay una palanca práctica muy relevante para nosotros: **la asimetría se puede
ensanchar a propósito dándole al verificador herramientas que el generador no tiene**.
Un juez que puede ejecutar código verifica mejor que uno que solo razona.

En nuestro caso eso se traduce en algo concreto: el orquestador verifica pudiendo
ejecutar los tests, leer el repo y pasar el gate del Design System. No opina sobre el
trabajo del subagente: lo comprueba.

### Cómo montar el bucle, según la evidencia

- **Rondas 1 y 2 capturan casi toda la mejora**; conviene topar en 5–6 para evitar
  oscilación.
- **Ancho antes que profundo**: más verificadores en paralelo rinde más que más vueltas.
- **Separar el prompt de generación del de revisión da ~20% sobre la auto-corrección.**
  Es decir: el que revisa no debe ser el que escribió, ni siquiera con el mismo prompt.
- Repartir el trabajo para que los subagentes **ni se solapen ni dejen huecos**, y
  verificar su salida de forma estructural, evidencial e independiente.
- Medir **coste por tarea completada**, no por token: es la única forma de ver dónde el
  trabajador barato deja de ser barato.

Un aviso metodológico honesto de las propias fuentes: **ningún benchmark público mide
grep, listar directorios, resolver símbolos o generar boilerplate**, que es
estructuralmente más simple que una issue de SWE-bench. Así que la diferencia de
calidad entre modelos probablemente está **sobreestimada** para el tipo de subtarea que
se delega. A favor del patrón, no en contra.

### Las PRs pequeñas: el dato más sólido de todo el informe

El estudio de SmartBear y Cisco analizó **2.500 revisiones sobre 3,2 millones de líneas**
y sigue siendo la referencia:

- Revisar **menos de 200–400 líneas** de una vez; por encima, la capacidad de encontrar
  defectos empieza a caer.
- Una revisión de 200–400 líneas en no más de 60–90 minutos alcanza **70–90% de
  descubrimiento de defectos**.
- La tasa de defectos por hora cae por encima de 300 líneas y se desploma pasadas 500.
- La eficiencia del revisor cae también **después de 90 minutos**.

La causa es de capacidad humana: la memoria de trabajo maneja 7±2 elementos; un diff de
mil líneas la desborda y el revisor pasa de análisis profundo a reconocimiento
superficial de patrones. Por eso las PRs enormes suelen recibir **cero comentarios** —
no porque estén bien, sino porque el revisor se pierde.

Y hay novedad de producto relevante: **GitHub lanzó Stacked PRs en preview privada en
abril de 2026**, nativo. El patrón venía de Phabricator en Meta y de `ghstack` /
Graphite. La frase de su PM resume por qué encaja con la fábrica de agentes: *el cuello
de botella ya no es escribir código, es revisarlo*
([InfoWorld](https://www.infoworld.com/article/4158575/github-adds-stacked-prs-to-speed-complex-code-reviews.html)).

Cautela sobre las cifras modernas: los «40% menos defectos / 3x más rápido / 70% menos
detección» proceden de análisis de proveedores, no de revisión por pares, y se repiten
casi literalmente entre fuentes. Direccionalmente consistentes, no validados de forma
independiente. El dato de SmartBear/Cisco es el firme.

---

## Parte 3 — Cómo lo montamos en Buzz

Las dos ideas encajan una dentro de la otra: **el 90/7/3 dice qué se entrega en cada
vuelta; el orquestador–ejecutor dice quién lo hace y quién lo comprueba.**

| Etapa | Quién ejecuta | Quién verifica | Puerta de salida |
|---|---|---|---|
| **90%** | `@coder` en π | `@revisor`, independiente | El camino completo funciona de punta a punta y tiene tests |
| **7%** | `@coder`, con la lista de casos límite de `@producto` | `@revisor` + `@analista` | Cada caso límite enumerado tiene test; los no cubiertos están dichos |
| **3%** | `@diseno` sobre Sapira Design System | El gate del Design System, que ya existe | Estados cargando/vacío/error en cada superficie nueva; respuesta <400 ms o feedback explícito |

Cuatro decisiones que se derivan de la evidencia, no del gusto:

1. **Las tres puertas se aplican por rebanada, no por proyecto.** Es la corrección que
   las fuentes imponen: una fase de pulido al final es una fase que se cancela.
2. **El que revisa nunca es el que escribió.** Vale ~20% sobre la auto-corrección, y ya
   tenemos los roles separados.
3. **El verificador usa herramientas que el ejecutor no tiene.** Ejecutar los tests,
   pasar el gate de diseño. Ensanchar la asimetría a propósito.
4. **PRs por debajo de 400 líneas, duras.** Si una rebanada no cabe, la rebanada está
   mal cortada.

Y una consecuencia para el maestro: su trabajo no es repartir tareas. Es **decidir en
qué etapa está cada pieza, verificar que la puerta se ha pasado de verdad, y no dejar
que el 3% se caiga** — que es lo que se cae siempre.
