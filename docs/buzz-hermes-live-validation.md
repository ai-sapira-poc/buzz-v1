# Validación desde la aplicación: Buzz + Hermes

Fecha: 2026-09-06. Checkout: `ab946484f21d`, Buzz Desktop 0.5.23.

## Entorno y alcance

Se arrancó `just dev` con el toolchain Hermit. Postgres, Redis y MinIO existentes
en Docker se verificaron saludables. El relay local responde `ok` en `:3000/health`
y `{"status":"ready"}` en `:8080/_readiness`.

La aplicación Tauri corre nativamente en macOS, con frontend Vite en `:56707`.
El título confirma `Buzz Dev · ab946484f21d+`. No se está ejecutando toda la app
de escritorio dentro de Docker.

Por instrucción expresa del operador, se mantuvo la comunidad Sapira que la app
ya tenía seleccionada. Las pruebas del agente se hicieron contra esa comunidad,
no contra el relay local. No se cambiaron sus ajustes, membresías existentes ni
configuración de Railway. Se creó únicamente el agente de prueba y su DM con el
operador. No se hicieron pushes.

## Recorrido real, mediante Accesibilidad de macOS

1. **Agents → New agent → Create agent** abre nombre, descripción e instrucciones.
2. **Customize for this agent** permite escoger un harness sin alterar defaults.
3. El preset **Hermes Agent** aparece como no instalado: el binario existe en el
   entorno virtual, pero no en las rutas donde Buzz lo descubre automáticamente.
4. El propio selector ofrece **Add custom harness…**. Su formulario permite nombre,
   ID, comando, argumentos y variables de entorno. La ruta absoluta del adaptador
   es aceptada y la UI confirma `Found on PATH`.
5. Se guardó el harness local `hermes-buzz-test` con nombre **Hermes Buzz Test**,
   comando del `venv/bin/hermes-acp` instalado y `HERMES_HOME` específico.
6. Se creó **Hermes Smoke Test**, seleccionando ese harness y el modelo
   inicialmente `instant-combo`, corregido después a **`local-combo`** por indicación
   del operador mediante **Runtime → Edit Model → Save changes**. En Advanced se
   fijó paralelismo 1 y se mantuvo owner-only.
7. **Add agent arranca el agente automáticamente** en este flujo. La UI lo mostró
   online, y el log confirmó inicialización ACP, pool listo y conexión al relay.
8. Su perfil contiene **Info / Runtime / Channels / Memories**, además de
   **Message**, **Stop** y **Restart**. Runtime muestra log, modelo, instancias,
   skills del nest, skills globales y evals del agente.
9. **Message** abrió un DM con el agente. Tras corregir el combo y arrancarlo de
   nuevo, Hermes publicó `BUZZ_HERMES_OK`; se abrió el hilo y se verificó el texto
   en la interfaz nativa.
10. Una segunda petición autorizó leer un archivo de prueba del workspace propio.
    Hermes utilizó `read_file` y publicó `BUZZ_READ_OK_6c93f2`, también verificado
    en la interfaz abriendo el hilo de respuesta.
11. Se desactivó **Start on launch**. Estado final: agente iniciado y disponible
    para el operador, con arranque manual en futuras aperturas de Buzz.

## Perfil Hermes de prueba

Perfil nuevo: `buzz-sapira-smoke`, creado sin clonación, aliases ni skills heredadas.
Tiene su propia configuración, `.env`, soul, workspace y estado. Se reutilizó solo
la configuración de acceso al router del Hermes principal y se fijó el modelo
solicitado. No se copiaron memorias, sesiones, cron ni MCP del perfil principal.

Esto prueba integración y separación del estado del nuevo perfil, no paridad de
todas las capacidades ni aislamiento de filesystem. El backend terminal sigue
siendo local; Linear y Railway no se ejecutaron. Las skills que la UI enumera
tampoco demuestran que todas estén cargadas o autorizadas dentro de Hermes ACP.

## Evidencia de conexión y pruebas completas

- `hermes acp --check`: `Hermes ACP check OK`.
- Adaptador conectado: Hermes `0.17.0`.
- `agent_pool_ready agents=1`.
- Log de carga de entorno apunta al perfil `buzz-sapira-smoke`.
- El DM incorpora al agente mediante notificación de membresía en vivo.
- Mensaje enviado: pedir `BUZZ_HERMES_OK` sin leer archivos ni realizar otras acciones.
- Hermes abrió el cliente con `provider=custom`, `model=local-combo` y
  `base_url=http://localhost:20128/v1`; el log confirma inferencia y herramientas.
- Sesión ACP: `f74b6b1a-15c8-4c9f-becd-bb6a873fd276`.
- Respuesta de conexión aceptada por el relay, evento
  `7954196216379a8d619f2973efebbca4cc3fd6ce61b204228aceded6aedfe626`.
- Lectura real de `workspace/buzz-read-check.txt` dentro de `buzz-sapira-smoke`;
  el valor esperado no se incluyó en la petición enviada al agente.
- Respuesta de lectura aceptada por el relay, evento
  `c9b9367c9dcc3f496a55ee1201b13d21a7004198bcce5c2a47e44fe717bfd737`.
- Ambas respuestas se comprobaron mediante Accesibilidad en la app real.

El nombre inicial `instant-combo` produjo HTTP 400. El operador corrigió el nombre
a `local-combo`; se actualizó tanto el perfil como el modelo del agente. No se
modificó OmniRoute. La presencia de un modelo en el selector no prueba su routing.

## Incidencias y límites observados

- El CLI que resolvía el PATH del agente en `desktop/src-tauri/target/debug/buzz`
  era un archivo vacío sin permiso de ejecución. Hermes intentó ejecutarlo,
  aplicó `chmod`, localizó el CLI compilado en `target/debug/buzz` y lo copió sobre
  ese artefacto de desarrollo. Después pudo publicar. No cambió código fuente,
  pero esa reparación excedió la petición de limitarse a responder: las
  instrucciones textuales no son una frontera de permisos.
- La segunda prueba usó únicamente `read_file` sobre el fixture y `terminal` para
  publicar la respuesta con Buzz CLI; no necesitó reparaciones.
- ACP estableció el cwd de sesión en `~/.buzz-dev`, aunque el perfil declara su
  workspace propio. HERMES_HOME separa estado, pero no basta para garantizar un
  directorio de trabajo exclusivo ni limitar el acceso a otros archivos.
- El log mostró descubrimiento de plugins y una revisión auxiliar de skills tras
  el primer turno. Crear el perfil sin skills no desactiva todas las funciones
  automáticas del adaptador. Esa revisión terminó sin herramientas.
- El límite configurado como `agent.max_turns: 8` no fue efectivo en ACP: el log
  mostró presupuesto de 90 llamadas. Antes de ampliar el piloto hay que verificar
  los controles efectivos de ese adaptador, no asumir que aplica todos los del CLI.

## Implicaciones para el plan del equipo

- Se puede registrar el harness y crear el agente desde la UI actual. No hace
  falta desarrollar una pantalla nueva para el primer piloto.
- Un harness que fija un home no debe reutilizarse con varios procesos concurrentes.
  Para ampliar el equipo, parametrizar el home por agente o registrar lanzamientos
  distintos. Mantener una instancia por perfil durante el piloto.
- La creación activa el agente y habilita arranque al abrir la app; hay que reflejar
  esa conducta en el procedimiento de altas y en cualquier prueba de perfiles.
- El runtime emitió `permission_mode=bypassPermissions`; owner-only limita quién
  le encarga trabajo, no qué puede ejecutar. Sigue pendiente el control de acciones
  externas propuesto en el plan.
- La prueba completó inferencia, lectura y publicación en Buzz. No demuestra aún
  paridad con el Hermes principal, límites de permisos ni coordinación del equipo.

## Continuación

Routing y prueba de lectura completados. La siguiente fase del plan es inventariar
las capacidades reales del Hermes principal y definir su exposición al equipo,
con controles efectivos sobre acciones externas. Linear y Railway siguen sin
validarse en este perfil; no se ha creado el equipo completo.

Logs locales de diagnóstico: `/tmp/buzz-v1-local-dev.log` y el directorio de logs
de agentes del app-data de Buzz Dev. No se incorporan logs completos al repositorio
porque contienen contexto operativo y datos de sesión.
