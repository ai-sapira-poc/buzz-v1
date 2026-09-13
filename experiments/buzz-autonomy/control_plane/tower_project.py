"""The Tower Control assignments: the team builds its own visibility layer.

One place holds the briefs and their dependency order, so what the operator was
told the team would do and what the team was actually asked are the same text.

The order is not ceremony. Product and the architect come first because they fix
what gets measured; strategy and innovation are deliberately scheduled *before*
any code, while changing our minds is still cheap — if the right answer is to
buy observability instead of building it, now is when that is cheap to learn.
"""
CHANNEL = "55c3438a-e7e8-4d5c-acd9-6e066a8f178d"
PLAN = "docs/goals/tower-control-arranque.md"

SHARED = """Proyecto: Tower Control, la capa de visibilidad del control plane dentro de Buzz.

Documentos del proyecto, legibles con la herramienta `read`:
  tower/plan-arranque.md    el plan de arranque: decisiones, pasos y pruebas
  tower/plan-contexto.md    el contexto largo: kinds existentes, estado de OTel
  tower/vision-actividad.md el criterio de presentación (verbo, objeto, resultado)

Lee solo lo que tu encargo necesite. Los ficheros son largos: `read` admite
`offset`/`limit` y trunca; sigue `next_offset` si necesitas el resto. No repitas lo que
esos documentos ya deciden, construye sobre ellos.

Restricciones que ya están decididas y no se reabren sin evidencia nueva:
- La fuente de verdad es el span de OpenTelemetry. Los eventos Nostr son proyección
  derivada. Se decidió por portabilidad: migrar debe costar un adaptador.
- El coste es owner-scoped, y toda cifra agregada viaja con su cobertura.
- run.id = trace_id. No hay tabla de correspondencias.
- Toda inferencia va a cheap-combo.

Si crees que alguna es un error, dilo en las dos primeras frases con el motivo, y
haz el encargo igualmente bajo el supuesto vigente."""

ASSIGNMENTS = {
    "producto": {
        "identity": "product",
        "depends_on": [],
        "brief": """Fija el problema y la aceptación de Tower Control.

Qué decide un director de ingeniería mirando esta pantalla que hoy no puede decidir, y
qué evidencia le hace falta para decidirlo. Separa lo que resuelve la vista de cartera
de lo que solo resuelve el descenso.

Entrega: problema, outcome, y criterios de aceptación medibles para la Fase 1. Incluye
explícitamente qué NO entra. Si la línea base es desconocida, dilo y propon cómo
medirla primero en vez de inventarla.""",
    },
    "arquitecto": {
        "identity": "architect",
        "depends_on": ["producto"],
        "brief": """Solo lectura. Responde dos preguntas con evidencia de ficheros, no con opinión.

1. ¿Tower debe ser pestaña nueva o profundidad de Pulse? El operador ya decidió
   pestaña nueva reutilizando la fontanería; tu trabajo es confirmar que eso es
   sostenible o señalar con pruebas dónde se rompe. Mira desktop/src/features/pulse/.

2. Define la frontera del puerto TowerSource: qué operaciones expone, qué tipos del
   dominio neutro, y qué queda explícitamente fuera. El criterio es que la UI no pueda
   saber si detrás hay Buzz o un backend OTel.

Señala también qué hace falta en el producto que hoy no existe. Ya detecté uno: no hay
forma de publicar un kind arbitrario desde el CLI, así que la proyección Nostr necesita
un subcomando nuevo en buzz-cli. Verifícalo y busca los demás.""",
    },
    "research": {
        "identity": "research",
        "depends_on": [],
        "brief": """Convenciones y arte previo, con fuentes primarias.

1. Estado de las convenciones semánticas gen_ai.* y mcp.* de OpenTelemetry: qué está
   estable, qué sigue en experimental, y qué nombres usamos hoy que podrían cambiar.
   Nuestro módulo está en tower/telemetry.py, legible con `read`.

2. Cómo resuelven la observabilidad de agentes los productos que ya lo hacen. Qué
   enseñan en la vista de cartera frente al detalle.

Di claramente cuándo el campo no lo sabe. Etiqueta lo leído solo en abstract.""",
    },
    "estrategia": {
        "identity": "strategy",
        "depends_on": ["producto"],
        "brief": """¿Construir esta capa es la elección correcta?

Compara construir, comprar observabilidad hecha, y no hacer nada. Incluye la economía:
qué cuesta mantener una capa propia frente a lo que da. Recomienda una elección con su
secuencia y los falsadores que te harían retirarla.

Es ahora cuando cambiar de idea es barato. Si la respuesta es comprar, dilo.""",
    },
    "innovacion": {
        "identity": "innovation",
        "depends_on": ["producto"],
        "brief": """La opción que nadie pidió.

Con trazas de lo que hacen los agentes, ¿qué se vuelve posible que hoy ni planteamos?
Genera hipótesis materialmente distintas de "una pantalla para mirar", no variaciones.
Prioriza por valor de aprendizaje y diseña el experimento más barato que discrimine
entre ellas, con umbrales de abandono fijados antes de correrlo.""",
    },
    "analista": {
        "identity": "analyst",
        "depends_on": ["producto"],
        "brief": """Qué métricas son honestas en esta pantalla.

Para cada cifra que Tower muestre: denominador, población, ventana temporal, y qué NO
se puede afirmar con ella. Presta atención especial al coste: es owner-scoped, así que
un total de proyecto puede ser un subconteo que parece completo.

Entrega la regla de presentación: cuándo una cifra se muestra, cuándo se muestra con
aviso de cobertura, y cuándo no debe mostrarse.""",
    },
    "diseno": {
        "identity": "designer",
        "depends_on": ["producto", "analista"],
        "brief": """La vista de cartera, sobre Sapira Design System.

Una fila por proyecto que responda sin interacción: qué está pasando, va bien o está
atascado, y necesita al operador. El criterio de VISION_ACTIVITY.md es verbo, objeto,
resultado.

Entrega un prototipo concreto con jerarquía, estados de vacío, carga y error, y
comportamiento de teclado y foco. Reutiliza los componentes del catálogo; no recrees
primitivas. Una descripción en prosa no es un diseño.""",
    },
    "revisor": {
        "identity": "reviewer",
        "depends_on": ["arquitecto"],
        "brief": """Deriva los riesgos del requisito antes de leer las conclusiones de nadie.

El requisito: una capa de visibilidad portable, donde migrar de Buzz a otro backend
OTel cueste un adaptador. Enumera cómo puede fallar eso en la práctica y qué prueba
detectaría cada fallo.

Después, y solo después, revisa control_plane/telemetry.py y su test. Ejecútalo, no lo
leas. Di qué NO has ejercitado.""",
    },
}

ORDER = ["producto", "research", "arquitecto", "estrategia", "innovacion",
         "analista", "diseno", "revisor"]


# Where the project documents live differs by harness, and getting this wrong is
# expensive: the shared frame used to tell every teammate that its `read` could
# not reach the repository, while the architect's own brief asked it to look at
# `desktop/src/features/pulse/`. Told it could not do the one thing it was asked
# to do, it spent its whole 900-second window and returned nothing.
SCOPE_HERMES = """Las rutas son relativas a tus artefactos; tu `read` no alcanza el
repositorio. Si necesitas algo del código, pídeselo a un compañero del plano de código."""

SCOPE_PI = """Las rutas de `tower/...` son relativas a tus artefactos. El resto de rutas
son relativas al repositorio, que sí puedes leer: estás trabajando dentro de él."""


def brief_for(role: str) -> str:
    """The full text one teammate receives: shared frame plus its own brief."""
    from control_plane.roster import CONTRACTS, PI

    scope = SCOPE_PI if CONTRACTS[role]["harness"] == PI else SCOPE_HERMES
    return SHARED + "\n\n" + scope + "\n\n---\n\n" + ASSIGNMENTS[role]["brief"]


def ready(role: str, done: set[str]) -> bool:
    return all(d in done for d in ASSIGNMENTS[role]["depends_on"])
