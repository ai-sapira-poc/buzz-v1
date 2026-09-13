# Buzz: autonomía dirigida, resiliencia y aprendizaje de Hermes

Análisis del 7 de septiembre de 2026. Propuesta de arquitectura; no implementación ni activación. El desarrollo del producto de limonada está detenido por instrucción del operador.

## Objetivo corregido

Linear contiene el trabajo y las decisiones del operador. El sistema resuelve encargos complejos con autonomía de ejecución, investiga lo que necesita, propone mejoras y aprende de sus resultados. Las propuestas de producto, cambios de alcance y adopción compartida de mejoras requieren aprobación del operador en Linear. No se busca actividad sin objetivos ni una agenda autoautorizada.

La intervención humana se descompone: dirigir y aprobar es parte del producto; rescatar al sistema explicándole cómo resolver un fallo es lo que queremos reducir. Deben medirse por separado.

## Evidencia de las conversaciones de Buzz

Se recuperaron 199 mensajes kind 9 del canal de piloto limonada-lab en la comunidad Sapira mediante paginación. Se verificaron las 199 firmas. Se contrastaron las cadenas de aprendizaje, revisión, síntesis y fallos finales con los prompts, herramientas y estados locales. No es una auditoría de todas las conversaciones de la comunidad ni una evaluación semántica independiente de cada uno de los 199 mensajes.

Archivo: `~/.local/share/buzz-autonomy-pilot/sapira/evidence/buzz-conversation-analysis/channel-events.json`. Los informes archivados previos aportan 191 eventos únicos, contenidos en esta recuperación. Ninguno de los 199 mensajes recuperados tiene referencia de respuesta `e`: esta muestra es un flujo plano de informes, con relaciones por identificador de job y por el ledger local. Esto no significa que Buzz no soporte hilos ni que no haya habido delegación.

El ledger contiene 187 jobs: 166 done, 19 failed, 10 cancelled y 2 queued; 25 tienen parent. Hay además 3 entradas inbound done. Son unidades de ejecución de un ensayo, incluyen pruebas negativas y correcciones; no son porcentajes de autonomía, tareas de negocio independientes ni una tasa de resiliencia.

### Hallazgos concretos

1. **Revisión que detecta el defecto pero aprueba igualmente.** `round2-review-innovation-base` da 8/8 y PASS, pero describe que una muestra parcial con un fallo conocido de integridad sigue midiendo en vez de parar. El defecto se degrada a recomendación. Evento `a4833e8acd5dfa02781ede29ffaa63705d9ded87ed910f6f19ee003ff755b519`. El problema no se resuelve solo con otro revisor: hace falta una regla de aceptación que impida compensar un fallo crítico con otros puntos.
2. **Corrección real, pero provocada desde fuera.** `product-review-learning` aceptó convertir preferencias en pedidos y generalizó una mejora de usabilidad. `strategy-learning-correction` rectificó al recibir los hallazgos del evaluador; `innovation-skill-revision` actualizó el procedimiento a petición expresa. Eventos `3703c3fdc4f0420413381eca59e83521aed002055b30014718e4aad1f8ee6f45`, `7f9236ed29eafe1bdfb66c2d005155dc6d0ca0cb924f7eebf1974202ac76e1e7` y `e391ecae3bf6a86a3a5a572038dfe987c018973acacfa247a52cb2a172786967`. Hay capacidad de incorporar crítica; no demuestra detección y recuperación autónomas.
3. **Exploración sin cierre.** La última ejecución de estrategia hizo 17 lecturas, 1 recall y 2 consultas de contexto, sin escribir el entregable. Agotó 16 iteraciones del modelo. El número de herramientas puede superar las iteraciones. Evento `4c1cd4433989d6574eb446a13c74cdbb6cacd1c869496ea6666ef018efd6d8c2`.
4. **Reescritura sin progreso suficiente.** Innovación adversa realizó 6 escrituras del mismo JSON, sin persistir el Markdown pedido, y agotó el mismo límite. Su informe incluye el contenido propuesto del documento, pero el supervisor lo etiqueta correctamente como incompleto. Evento `1cbb15471c94559124f5c6a5971e01a7578d87fee9374214f2e57097f9382e8a`. Redactar un resultado en Buzz no acredita haber entregado el artefacto.
5. **La síntesis puede heredar errores.** El maestro necesitó corregir supuestos de coste cero e inviabilidad de actividades del club de lectura. El handoff funciona, pero la síntesis todavía necesita contrastar afirmaciones importantes con evidencia primaria.
6. **La comunicación se orienta al evaluador.** Los mensajes contienen rúbricas, hashes y declaraciones formales extensas. Aportan auditoría, pero dificultan ver la decisión de negocio, el cambio real y el bloqueo. La evolución propuesta debe separar conversación de trabajo, evidencia técnica y reporte al operador.

## Arquitectura mínima

`Linear → supervisor/manager → especialistas Hermes → evidencia y revisión → Linear`

Buzz es el espacio de colaboración y trazabilidad, con un hilo por encargo enlazado a su issue. OmniRoute sirve la inferencia seleccionada. El manager es una evolución del supervisor existente, no un servicio adicional obligatorio ni un LLM revisando cada llamada.

Dos responsabilidades separadas dentro del mismo proceso:

- **Control determinista:** autoridad, ámbito de herramientas, presupuesto, versiones, estados y condiciones verificables de entrega.
- **Coordinación razonada:** descomposición, elección de especialista, diagnóstico de estancamiento y estrategia de recuperación. Puede usar un modelo cuando hay una decisión que tomar.

Cada intento fija issue y versión del mandato, entradas, artefactos esperados, reglas aplicables, skills/versiones, combo, presupuesto y comprobaciones. Reanudar conserva los efectos ya realizados; un nuevo intento no repite escrituras externas a ciegas.

## Manager de reglas compatible con Sapira Standards

No mezclar tres ejes: procedencia/alcance, estado de adopción y enforcement efectivo. Una skill externa puede tener autoridad por adopción; una nota interna no la adquiere por sonar normativa.

| Capa | Ejemplo | Tratamiento propuesto |
| --- | --- | --- |
| Permisos del operador | Solo proyecto Buzz para escrituras de sus agentes; Railway lectura | Control en la herramienta; no lo puede cambiar una skill o un revisor |
| Corpus aplicable | Company/departamento, charter, superficie afectada | Resolver canónico, referencias por ID/cláusula, status, excepciones y frescura |
| Mandato del encargo | Resultado y aceptación aprobados en Linear | Contrato versionado; las propuestas no lo amplían por sí mismas |
| Métodos y skills | Procedimiento de entrevista, investigación o QA | Se seleccionan por tarea; pueden evolucionar como candidatas sin adquirir autoridad normativa |

La gobernanza define `recommended` como default que puede omitirse sin justificación, aunque el resolver lo incluya en el conjunto llamado binding. No convertir esa etiqueta en bloqueo. `required` exige tratar sus desviaciones según la gobernanza y aplicabilidad concretas; `experimental/proposed` son asesoría; los retirados/deprecados no se cargan como reglas actuales.

El corpus distingue `enforcement` y `enforcement_target`: una aspiración no es un control existente. La regla de Sapira Design System para este piloto procede además de la instrucción explícita del operador; no debe inventarse un ID de estándar para justificarla.

Puntos de control:

1. **Al tomar el encargo:** comprobar aprobación y resolver contexto aplicable.
2. **Al ejecutar efectos:** comprobar permiso, destino y límites fuera del modelo, incluyendo herramientas dentro de scripts, skills y procesos de revisión.
3. **Al entregar:** comprobar artefactos y estado real; un fallo crítico no se compensa con puntuaciones altas. Para requisitos visuales/editoriales hace falta evidencia renderizada o revisión semántica calibrada, además de checks estructurales.
4. **Al adoptar mejoras:** ligar el paquete exacto/versionado a la decisión del operador. El autor no puede editar el criterio de aceptación ni autovalidar su promoción.

Cada rechazo devuelve una causa y una siguiente acción permitida. El manager necesita un mecanismo de revisión de falsos positivos; si bloquea una solución válida, eso es un defecto del sistema. Probarlo con casos válidos e inválidos; no resolverlo convirtiendo toda recomendación en prohibición.

## Resiliencia: cambiar de estrategia con evidencia

Un encargo aprobado debería incluir una reserva de recuperación. Es autonomía para investigar y reparar dentro del mandato, no autorización para cambiar sus objetivos.

Secuencia propuesta:

1. Detectar fallo o falta de progreso: error de herramienta, contradicción, artefacto ausente, reescrituras sin mejora, presupuesto restante incompatible con la entrega.
2. Clasificar provisionalmente: entorno, contexto ausente, error de razonamiento, falta de método, falta de herramienta/permiso o requisito ambiguo.
3. Escoger la prueba discriminante más barata y una estrategia distinta: consultar documentación concreta, reproducir un contraejemplo, dividir la tarea, cambiar de especialista/combo o desarrollar un procedimiento candidato.
4. Ejecutar la recuperación con presupuesto acotado y checkpoint. Cambiar de modelo puede ayudar al razonamiento; no crea datos, acceso ni permisos inexistentes.
5. Comprobar el resultado con criterios conservados e independientes del autor.
6. Guardar el aprendizaje propuesto y, si procede, solicitar su adopción en Linear. Si no hay siguiente acción autorizada útil, escalar con una pregunta o decisión concreta y la evidencia recopilada.

En los dos fallos finales, aumentar ciegamente 16 a 100 iteraciones no acredita resiliencia. El supervisor debería reconocer lectura repetitiva o reescritura sin entrega, conservar el trabajo válido y encargar solo el bloque pendiente con una estrategia explícitamente distinta.

Medir por familia de tarea y fallo, sin mezclar indisponibilidad con calidad:

- Resolución inicial sin rescate.
- Recuperación verificada entre los encargos que fallaron inicialmente; denominador y presupuesto explícitos.
- Tiempo/coste hasta detectar el fallo y hasta recuperarse.
- Repetición del mismo fallo después de incorporar una mejora.
- Transferencia a tareas nuevas reservadas, sin acceso a sus respuestas durante el aprendizaje.
- Calidad de escalado cuando falta acceso o información: reconocer el límite también puede ser el resultado correcto, pero no cuenta como tarea resuelta.
- Intervención de dirección/aprobación separada de intervención de rescate.
- Regresiones, ampliaciones de alcance y cambios indebidos en criterios: indicadores independientes del éxito aparente.

## Aprovechar Hermes en lugar de sustituirlo

El piloto actual configura solo el toolset `pilot_<role>`, con `skip_memory=True`. Las skills candidatas probadas fueron archivos y entradas del cuaderno propio, no el ciclo nativo completo de Hermes.

En el código instalado, `agent/turn_finalizer.py` exige que `skill_manage` esté entre las herramientas válidas para disparar la revisión de skills. El piloto no lo expone. Por tanto, el empate y sobrecoste de aproximadamente 39 % no evalúa el máximo potencial de aprendizaje de Hermes. Tampoco hay garantía de mejora por activar esas herramientas.

Reutilizar sus herramientas de listado, lectura y gestión de skills, la carga bajo demanda, la revisión posterior a sesiones y el curator donde aporten valor. Hermes distingue conocimiento factual de procedimientos; mantener esa distinción. Sus capacidades no equivalen por sí mismas a entrenamiento de los pesos del modelo.

Distribución propuesta:

- Cada especialista mantiene candidatas propias en su perfil aislado de Buzz. Una candidata contiene cuándo usarla, fuentes, procedimiento, errores conocidos, verificación y límites; puede incluir referencias, plantillas y scripts.
- Las skills compartidas aprobadas se distribuyen como versiones inmutables para esa ejecución. Las candidatas se ensayan en un espacio de prueba autorizado; no se cargan automáticamente en futuros encargos por haber sido creadas.
- El procedimiento general puede compartirse entre proyectos solo tras eliminar datos particulares y aprobar la transferencia. Las observaciones del proyecto permanecen en su contexto.
- Las correcciones a una skill ya adoptada generan una candidata nueva. El paquete previo sigue disponible para rollback.
- Los ciclos de background review y curator deben heredar ámbito y presupuesto. En workers efímeros hay que comprobar que el proceso no termina antes de persistir su resultado; que una función exista en Hermes no demuestra que nuestro modo ACP la ejecute hasta el final.

Hay una sutileza importante en el código instalado: el pin de una skill impide borrarla en el agente foreground, pero permite parches. No sirve como protección de inmutabilidad de Sapira. Los directorios externos tampoco sustituyen permisos de filesystem para todos los actores. La versión aprobada debe ser de solo lectura por construcción, y las modificaciones deben dirigirse al espacio candidato.

El curator administra uso, obsolescencia y consolidación, con archivo recuperable y mecanismos de rollback; la consolidación LLM es opt-in. No es un evaluador de éxito de negocio. Además, la documentación web y el checkout local difieren en detalles del ciclo de vida: fijar la versión instalada y probar su comportamiento antes de activar mantenimiento sobre la biblioteca del equipo.

Esto aplica a producto, estrategia e innovación —no solo a código—: distinguir evidencia de preferencia frente a compra, formular entrevistas no dirigidas, comparar alternativas con costes desconocidos, escribir decisiones ejecutivas, leer papers y buscar contradicciones. El disparador es una dificultad o una corrección útil, no escribir una skill después de cada tarea.

## Flujo de Linear y aceptación

Una issue aprobada autoriza resolver ese encargo, con exploración y recuperación acotadas. El sistema informa de avances significativos y bloqueos; no pide permiso por cada paso. Una idea nueva se registra como propuesta vinculada y no entra en ejecución por haberla redactado un agente. Una mejora compartida presenta problema, cambio, evidencia a favor/en contra, coste y decisión solicitada en lenguaje de negocio. Aprobarla permite adoptar la versión exacta evaluada.

La integración actual únicamente prueba lectura Linear: falta el flujo de escritura acotada, ingestión de trabajo aprobado, deduplicación, control de versiones de aprobación y reconciliación de estado. No afirmar que ese ciclo ya está implementado.

## Próxima validación propuesta, sin retomar la limonada

Usar encargos pequeños de investigación, producto y operaciones con obstáculos inéditos: documentación contradictoria, preferencias presentadas como demanda, fallo de herramienta y salida incumplidora de un requisito. Separar tres condiciones: Hermes genérico; perfiles sin aprendizaje; perfiles con aprendizaje nativo y manager. Mantener comparable el presupuesto, inputs y modelos; reservar variantes nuevas y una prueba de retención posterior.

El agente debe diagnosticar el fallo sin recibir la solución, recuperar el encargo, crear una candidata cuando aporte valor y reutilizarla en otro caso. Revisar tanto las soluciones como los falsos bloqueos del manager. La evaluación de mejora se basa en resolución, intervención de rescate, coste y regresiones; no en número de skills ni extensión del informe.

La búsqueda evolutiva de muchas variantes es una opción posterior para procedimientos con evaluador estable. Imbue propone ese patrón; no aporta por sí solo un criterio válido para estrategia o diseño. Empezar por pocas variantes discriminantes evita optimizar contra un evaluador defectuoso.

## Fuentes

- Código local del piloto: `worker.py`, `capabilities.py`, `context.py`, `profiles.py`, `adapter.py` y ledger/trazas; los cambios de enforcement iniciados antes de detener desarrollo son locales y no acreditan un rollout completo.
- [Sapira Governance](../../sapira-standards/GOVERNANCE.md) y `scripts/lib/applies.mjs` del corpus local: aplicabilidad, lifecycle, excepciones y enforcement real.
- [Hermes Skills](https://hermes-agent.nousresearch.com/docs/user-guide/features/skills/) y [Working with Skills](https://hermes-agent.nousresearch.com/docs/guides/work-with-skills/): gestión y carga de procedimientos.
- [Hermes Curator](https://hermes-agent.nousresearch.com/docs/user-guide/features/curator/), contrastado con `agent/curator.py`, `agent/background_review.py`, `agent/turn_finalizer.py` y `tools/skill_manager_tool.py` locales.
- [Anthropic: Harness design](https://www.anthropic.com/engineering/harness-design-long-running-apps): separación de producción y evaluación, con complejidad proporcional a los resultados.
- [Imbue: LLM-based evolution](https://imbue.com/blog/2026-02-27-darwinian-evolver): explorar variantes contra una función de evaluación; no validación de nuestro sistema.
