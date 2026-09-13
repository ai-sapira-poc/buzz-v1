# Especialización profesional de los agentes Buzz

Investigación: 2026-09-06. Es una propuesta fundamentada y evaluable; no un ranking
que demuestre que estos agentes superan a todos los demás. Los contratos ejecutables
están en `experiments/buzz-autonomy/profiles.py`; permisos separados en `capabilities.py`.

## Qué tomamos de las fuentes

- SVPG separa responsabilidad sobre valor/viabilidad, usabilidad y factibilidad. Lo
  aplicamos a producto, diseño e ingeniería con entregables propios.
  [Product vs Feature Teams](https://www.svpg.com/product-vs-feature-teams/).
- Anthropic describe delegación con objetivo, límites, herramientas y formato; también
  costes de coordinación y evaluación de resultados. Adoptamos encargos explícitos y
  revisión; sus mejoras internas no predicen las nuestras.
  [Multi-agent research](https://www.anthropic.com/engineering/multi-agent-research-system).
- Las evaluaciones deben inspeccionar trazas y estado final, con calibración humana para
  juicios abiertos. Un documento persuasivo no acredita una operación ejecutada.
  [Agent evals](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents).
- McKinsey vincula innovación con ambición de crecimiento, elección de oportunidades,
  descubrimiento y capacidades de ejecución. Lo convertimos en hipótesis de negocio y
  experimentos con criterios de abandonar o escalar, sin importar cifras de su estudio
  como resultados de Sapira.
  [Eight essentials](https://www.mckinsey.com/capabilities/strategy-and-corporate-finance/our-insights/the-eight-essentials-of-innovation).
- Google Design enfatiza investigación y necesidades del usuario. UX debe distinguir
  observación de conjetura y comprobar fricción; un paseo de un agente no es una entrevista.
  [Putting users first](https://design.google/library/its-a-marathon-putting-users-first).
- HEART vincula objetivos, señales y métricas. Analítica debe declarar denominadores,
  población, plazo y límites de inferencia.
  [Trabajo original](https://research.google/pubs/measuring-the-user-experience-on-a-large-scale-user-centered-metrics-for-web-applications/).
- Google Testing propone orientar pruebas al riesgo; SRE describe diagnóstico mediante
  hipótesis y conocimiento del sistema. QA y operaciones quedan diferenciados y las
  operaciones de este piloto son exclusivamente de lectura.
  [Risk-driven testing](https://testing.googleblog.com/2014/05/testing-on-toilet-risk-driven-testing.html),
  [Effective troubleshooting](https://sre.google/sre-book/effective-troubleshooting/).
- Linear favorece tareas concretas, títulos claros y contexto proporcionado. Adoptamos
  lenguaje de negocio para briefs y decisiones, sin imponer una plantilla extensa a
  cada incidencia técnica.
  [Write issues](https://linear.app/method/write-issues-not-user-stories).

## Taxonomía y entrega

Un runtime Hermes, perfiles bajo demanda, un maestro. Una especialidad no implica un
microservicio ni un modelo dedicado. En estas pruebas todos usan `local-combo`; elegir
otro combo requiere medir rendimiento/coste por especialidad, no inferirlo del título.

| Perfil | Responsabilidad y artefacto | Control de calidad distintivo |
|---|---|---|
| Maestro | Encargos, dependencias, síntesis y siguiente decisión | Cobertura, no duplicación, evidencia, presupuesto |
| Producto/PM | Problema, opciones, prioridad, outcome | Valor/viabilidad, supuestos, aceptación medible |
| Estrategia corporativa | Tesis, elecciones, capacidades, secuencia | Economía explícita, alternativas y falsadores |
| Innovación | Oportunidades, modelo de negocio, experimentos | Diferenciación, aprendizaje, abandonar/escalar |
| Research | Fuentes/papers, contradicciones, implicaciones | Exactitud, trazabilidad, límites metodológicos |
| UX | Usuarios, tareas, recorrido, plan de estudio | Conducta observable, accesibilidad, no inventar investigación |
| Diseño UI/visual | Prototipo y sistema visual coherente | Jerarquía, componentes, estados, interacción |
| Arquitectura | Decisión y límites del sistema | Alternativas, fallos, permisos, reversibilidad |
| Coder | Implementación pequeña y reproducible | Contrato, errores, legibilidad, pruebas ejecutadas |
| QA/revisor | Riesgos, contraejemplos, hallazgos | Independencia, reproducción, impacto, regresión |
| Tester exploratorio | Interacción real y evidencia | Caminos positivos/negativos, observado/esperado |
| Analítica | Métricas y lectura de impacto | Denominadores, incertidumbre, no causalidad inventada |
| Operaciones | Diagnóstico sobre logs existentes | Síntoma/hipótesis, alcance, solo lectura |
| Editor de Linear | Briefs y decisiones de producto/negocio | Claridad ejecutiva, hechos vs hipótesis, acción concreta |

El editor no cambia los hechos del especialista al traducirlos. Por ejemplo:
«Reducir el tiempo que tarda el equipo en convertir una oportunidad en un experimento
validado; medir primero el proceso actual» es una hipótesis de producto útil.
«Implantar un dispatcher ACP» puede ir en la tarea técnica vinculada, pero no sustituye
la razón de negocio. Ninguno justifica inventar un ahorro del 30 %.

## Cómo se acredita la calidad

Por perfil: caso representativo, caso adverso y transferencia a un problema no utilizado
para diseñar el contrato. Rúbrica de cuatro criterios, cada uno 0 (ausente/incorrecto),
1 (parcial), 2 (respaldado). Umbral piloto: al menos 6/8 y ningún fallo crítico de
veracidad, permisos o evidencia. Es un umbral interno propuesto, no un benchmark industrial.

Separar checks mecánicos, juicio especializado independiente y valoración humana.
Comparar contra perfil genérico con el mismo combo, herramientas y presupuesto cuando
sea viable. No entrenar el perfil contra el caso reservado de transferencia. Registrar
versión de instrucciones, referencias Sapira, herramientas, combo y coste/latencia
disponibles. Una promoción de skill requiere mejora sin regresión en casos reservados;
el autor no puede aprobarla por autodeclaración.

## Encaje con Sapira

Las fuentes públicas orientan métodos profesionales; `sapira-standards` selecciona las
normas internas aplicables. Los contratos de agentes viven aquí, coherente con
`GEN-ADR-0005`: los roles no se duplican dentro del corpus. Consultar la propuesta de
inyección en `docs/inyeccion-practicas-sapira-buzz.md`.
