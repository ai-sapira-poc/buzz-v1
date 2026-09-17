# Guion de demo — Buzz Delivery Team

Fecha: 17 de septiembre de 2026.

## 1. Estado del sistema antes de empezar

Comprobado en vivo, no supuesto:

| Pieza | Estado |
|---|---|
| Relay de Railway | sano |
| Buzz Desktop | levantado y conectado, 8 canales |
| Flota de agentes | **los 12 roles escuchando** |
| Canal de trabajo | `0af36b11-a89b-4071-8388-6a985ed2aa7d` |

El maestro escucha menciones en ese canal, así que **el encargo se lo pasas tú
escribiendo en Buzz**. No hace falta ejecutar ningún comando.

## 2. Las dos pestañas

Buzz ya soporta varias comunidades, cada una respaldada por un relay distinto.
Eso te da dos pestañas sin construir nada:

| Comunidad | Qué se ve | Relay |
|---|---|---|
| La de siempre | La orquestación en vivo, los agentes hablando | Railway |
| Nueva, `ws://localhost:3000` | Tower Control leyendo el ciclo de vida | local |

En la pestaña local hay ocho eventos de job reales en la base de datos, pero son
**datos de prueba publicados a mano**, no agentes trabajando en vivo. Dilo al
enseñarlo. Los agentes corren en tu máquina pero publican contra Railway, y ese
relay todavía no acepta estos eventos.

En la comunidad de Railway, Tower Control saldrá vacío. Hoy sale vacío de forma
honesta pero sosa; el encargo incluye precisamente arreglar eso.

## 3. El encargo

Escríbelo en el canal mencionando al maestro. Tienes dos versiones según lo que
quieras que se vea.

### Versión A — recomendada para hoy

Tamaño medio. En la medición de este piloto (215 encargos terminados), esta
banda falla alrededor del 10 por ciento de las veces. Es la apuesta segura.

```
@maestro Quiero una vista nueva dentro de Tower Control que enseñe el estado
del equipo como un dibujo, no como una lista: cada agente y cada unidad de
trabajo un nodo, la relación entre ellos una arista, y que de un vistazo se
distinga lo que está activo de lo terminado y lo fallido.

Incluye la pantalla sin datos como parte del encargo, no como un flequillo:
cuando no haya trabajo, la vista explica qué enseña y puede ilustrarlo con un
ejemplo, pero ese ejemplo tiene que estar marcado de forma que nadie lo
confunda con agentes trabajando de verdad. Sin trabajo, sin poder leer y
cargando son tres cosas distintas y se tienen que seguir distinguiendo.

Empieza por lo que ya se puede leer hoy. Si algo no está en los datos, dilo en
voz alta en vez de inventarlo. Córtalo en trozos y dime cómo lo has cortado
antes de ponerte.
```

### Versión B — la que enseña el troceo

Es el encargo real completo, deliberadamente grande. Sirve para enseñar que el
sistema **se da cuenta de que el encargo es demasiado grande y lo trocea** en
vez de tragárselo entero. Está en
`experiments/buzz-autonomy/control_plane/liveruns_project.py`.

El riesgo es real y conviene decirlo: en esa banda de tamaño el 71 por ciento de
los encargos de este piloto no llegó a entregar. La puerta de troceo es
exactamente la respuesta a ese dato, pero es lo que estarías enseñando en vivo.

## 4. Qué va a pasar, y qué señalar mientras pasa

1. **El maestro acusa recibo** en el canal y empieza a pensar. El modelo es
   barato y lento a propósito, así que esto tarda. El punto que merece la pena
   señalar es que el sistema está diseñado para aguantar muchas iteraciones
   baratas en vez de pocas caras.

2. **El maestro trocea y delega.** Aquí está lo que de verdad hay que contar:
   antes de mandar nada, el sistema mide el tamaño del encargo y se niega si
   pasa de 3000 caracteres, nombrando la evidencia. Es una regla aprendida de
   215 encargos reales, no una opinión.

3. **Los ejecutores trabajan.** Verás mensajes de `@producto`, `@arquitecto`,
   `@coder` en el canal. Cada rol tiene su contrato y su presupuesto de turnos.

4. **Si algo falla, no se esconde.** La escalera de recuperación clasifica el
   fallo y cambia de enfoque en vez de reintentar lo mismo. Un permiso denegado
   nunca se responde con más presupuesto.

## 5. El mensaje de fondo

El producto no es el agente, es el sistema. Cada fallo de estos meses se ha
convertido en una regla que el sistema aplica solo: la puerta de troceo salió de
medir que los encargos grandes fallan, la escalera de recuperación salió de ver
reintentos ciegos, y la regla 90/7/3 salió de entregas que funcionaban en el
camino feliz y en nada más.

## 6. Si algo se atasca en vivo

- La flota se consulta con
  `~/.hermes/hermes-agent/venv/bin/python control_plane/serve.py --status`
  desde `experiments/buzz-autonomy`.
- Si un rol aparece `parado`, arráncalo con el mismo script sin argumentos.
- Los agentes escriben en el canal pase lo que pase: si algo se cae, se ve.
