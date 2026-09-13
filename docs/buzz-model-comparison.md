# Mac B frente a Flash 3.8 — prueba exploratoria, 7 septiembre 2026

## Conectividad y ruta real

`local-combo` está configurado como fill-first: Mac B / `ornith-1.5-35b-a3b`, después `antigravity/gemini-3.8-flash-tiered`, después Flash 3.6 y Flash 3.7. No se modificó el combo.

La primera causa fue Tailscale detenido en este Mac: DNS ENOTFOUND al resolver `alexs-macbook-pro.tailf5106c.ts.net`; OmniRoute devolvía502 y recurría a Flash. Se reconectó Tailscale usando la configuración existente; el usuario confirmó también su inicio. Mac B apareció online, DNS resolvió100.74.177.9 y respondió al ping por enlace local en5ms. Una llamada real mediante OmniRoute a cada modelo devolvió READY: Mac B0,962s y Flash1,257s. Esto acredita conectividad puntual, no rendimiento general.

En la continuación aparecieron otros fallos: SSE sin contenido durante80000ms, expiración de ejecución del limitador local de OmniRoute a60000ms y timeouts TCP al puerto11434. Estos diagnósticos no permiten atribuir todo a velocidad de inferencia o tamaño de contexto del modelo. No se reinició el servidor remoto ni se modificaron parámetros de OmniRoute.

Última comprobación, **17:07 CEST**: Tailscale local sigue `Running`, pero Mac B figura `Online: false` (última presencia registrada 17:00 CEST) y el ping agotó 5 segundos. La disponibilidad remota es intermitente. No se ha determinado si la causa es suspensión, conexión o servicio remoto. Evidencia: `tailscale-final-status.json`.

## Método

Llamadas directas a ambas rutas a través de OmniRoute, mismos prompts, temperatura0, máximo768tokens. Cuatro tareas: inventario/idempotencia; parada ante fallo crítico aunque falten datos; decisión de negocio con incertidumbre; emisión de llamada a una herramienta ficticia de lectura. Esta última prueba evalúa el protocolo, no ejecuta una herramienta externa.

La repetición inmediata salió de caché semántica (11–20ms) y se excluyó. Dos variantes posteriores añadieron un identificador de ensayo compartido por ambos modelos. El Mac B agotó100s en sus dos primeros intentos posteriores; se detuvo la ráfaga local y se excluyó la petición cancelada en curso. No son muestras exitosas de calidad ni inferencias independientes del modelo. Hubo carga concurrente del piloto: las latencias no son un benchmark aislado de throughput.

## Resultados observados

| Tarea, primera tanda sin caché | Mac B / Ornith | Flash 3.8 |
| --- | --- | --- |
| Inventario e idempotencia | Incorrecto:stock0,2ventas; esperado stock1,1venta | Correcto |
| Cinco decisiones de seguridad | Contenido correcto; devuelve fences pese a pedir JSON puro | Correcto, JSON válido |
| Llamada inspect_stock(sku=agua) | Correcta | Correcta |
| Decisión de negocio | Inventa coste de preparación nulo y demanda alta; afirma recuperar tiempo gastado | Más prudente, pero aún generaliza escaso valor de lectura y coste hundido mínimo |
| Latencia inventario |2,100s|4,012s|
| Latencia decisiones críticas |1,538s|2,979s|
| Latencia negocio |6,515s|8,200s|
| Latencia llamada herramienta |2,725s|1,702s|

Flash completó12/12peticiones no servidas desde caché:9/9checks objetivos correctos (3tareas×3variantes) y3propuestas de negocio. Las propuestas posteriores todavía contienen juicios no medidos sobre lectura pasiva y reparto de tiempos; no son una aprobación automática de estrategia.

Mac B completó4/6peticiones registradas sin caché:2/3checks objetivos semánticamente correctos en la primera tanda; los2intentos adicionales terminaron en timeout. Los dos outputs estructurados de texto incumplieron JSON puro por usar fences. No hay base suficiente para una comparación estadística de calidad general o disponibilidad sostenida.

Para estos encargos, Flash3.8 mostró mejor corrección y continuidad. Mac B sirve respuestas cortas y herramientas, pero esta configuración aún requiere resolver estabilidad y evaluar inventario/criterio de negocio antes de confiarle trabajo autónomo de mayor impacto. No se aplicó esta conclusión como cambio de routing.

## Evidencia

Peticiones, respuestas, tiempos y hashes: `~/.local/share/buzz-autonomy-pilot/sapira/evidence/model-comparison/`. `assessment.json` identifica muestras excluidas y checks recalculables. El informe distingue fallos del modelo, formato, caché y entorno; no mezcla los ensayos directos con la matriz del goal, cuyas conversaciones requieren Hermes y local-combo.
