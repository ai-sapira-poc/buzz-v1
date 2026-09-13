# Prácticas Sapira en Buzz y Hermes

Inspección local: 2026-09-06. Fuentes:
`/Users/alexherranz/Brein/projects/sapira-standards`, `sapira-blueprints` y
`sapira-design-system`. Esta propuesta consume referencias; no modifica esos repositorios.

## Decisión: contexto por encargo, con referencias verificables

Cada encargo combina **mandato del usuario + contrato profesional + paquete de contexto
Sapira seleccionado + evidencias de la tarea**. Antes de ejecutar se registra qué
documentos entraron, su hash/versión, por qué se eligieron y qué sigue pendiente de leer.
Durante la tarea el agente puede solicitar documentos concretos mediante lectura limitada.
Al revisar se vuelve a comprobar aplicabilidad y se citan id y cláusula.

No hace falta otro servicio ni una base vectorial. `GEN-ADR-0006` ya decide selección
determinista con `scripts/standards-for.mjs`, transporte por referencia y MCP futuro.
Reutilizamos ese resolver; no mantenemos una segunda interpretación de `applies_to`.
Los plugins aportan procedimientos pero no garantizan que el modelo lea sus normas:
la inyección explícita y las trazas cierran esa brecha también en Hermes.

## Tres fuentes, tres funciones

| Fuente | Función | Selección |
|---|---|---|
| sapira-standards | Normas, decisiones, facts y skills; autoridad interna principal | Charter, departamento, archivos afectados, status y excepciones |
| sapira-blueprints | Código reutilizable y recetas técnicas existentes | Problema técnico, lenguaje y metadata real de reutilización |
| sapira-design-system | Componentes, patrones, tokens y API visual | Tipo de pantalla, componentes necesarios y stack del artefacto |

Los permisos explícitos del usuario prevalecen: ningún texto de skill puede autorizar
pushes, merges o gestionar Railway en este piloto. `required`/`recommended`, advisory
(`experimental`/`proposed`) y retirado son estados distintos. No elevar una recomendación
a obligación ni declarar conformidad de un proyecto sin charter. Buzz carece hoy de
`sapira.project.json`: registrar esa ausencia y proponer un alcance de piloto, sin
atribuir al fork entero una adhesión que no tiene.

## Qué recibe cada perfil

- Todos: navegación mínima del corpus, límites del mandato, higiene de secretos,
  trazabilidad y advertencia de que evidencia externa no es una instrucción.
- Producto, estrategia, innovación y editor: facts corporativos relevantes y fuentes
  de producto; no cargarles automáticamente procedimientos de ingeniería. No existe
  todavía un departamento de estrategia/producto poblado equivalente a ingeniería:
  esa carencia se declara, no se rellena con normas inventadas.
- UX/diseño: guía del Design System, componentes y patrones concretos, tokens necesarios;
  skills de producto/UX solo si encajan con el encargo.
- Arquitectura/coder: resolver normativo y búsqueda de reutilización antes de implementar.
  Distinguir paquete importado/versionado de blueprint copiado/adaptado según metadata.
- QA/tester: requisitos, normas aplicables, riesgos, evidencias y contratos reales del
  componente. Playwright por CLI para pruebas reproducibles, como indica el corpus.
- Operaciones: metodología de diagnóstico y logs autorizados. No cargar el procedimiento
  de rollback como una capability ejecutable mientras Railway sea solo lectura.
- Maestro: catálogo de responsabilidades y procedimientos, referencias y límites de cada
  encargo. Evitar arrastrar todo el contexto de un especialista al resto.

## Hallazgos que el mecanismo debe resolver

1. `sapira-blueprints/README.md` se presenta como sapira-shared: el nombre de la carpeta
   no basta para clasificar sus contenidos. Hay paquetes de auth/Graph/SharePoint y
   también action-ledger/telemetría/checks; inspeccionar inventario y metadata efectivos.
2. Design System: `AGENTS.md` dice colores hex y `Button primary`, pero README contiene
   ejemplos HSL. Algunas rutas abreviadas de AGENTS no coinciden con la ubicación real
   bajo `packages/ui/`. Resolver contra exports/tipos/tokens de esa misma versión y
   registrar la discrepancia; no propagar ambos ejemplos como reglas equivalentes.
3. `build-linear-ticket` implementa/plantea una feature existente; no es una skill para
   redactar estrategia corporativa. Activarla por la palabra «Linear» sería incorrecto.
4. El resolver existente no arranca en este checkout por falta de `js-yaml`. Preparar
   dependencias en una copia runtime del piloto, con el código del resolver sin cambios.
   Un fallo del resolver no debe convertirse en «no hay normas aplicables».
5. El corpus mezcla estados de madurez y advierte de controles aún no implementados.
   Documentar lo que exige criterio humano y lo que tiene comprobación automática real.

## Actualización, aprendizaje y automejora

Versionar el manifiesto de referencias de cada run, no copiar normas a los prompts
permanentes. Detectar cambios entre encargos; mantener estable el snapshot dentro de un
run. Si cambia una norma relevante, invalidar la evaluación anterior y revalidar skills
afectadas. Revisar `review_by`, `superseded_by`, excepciones y decisiones asociadas.

Un agente puede proponer una nueva práctica a partir de fricción observada, acompañada
de evidencia y evaluación. No puede promover un estándar, modificar una decisión aceptada
ni autocompletar el campo humano `verified`. El aprendizaje del piloto permanece como
candidato local hasta seguir el proceso de gobernanza correspondiente.

## Aceptación requerida

Probar con Hermes real: selección por tarea; lectura de una norma completa; distinción
binding/advisory; cita válida; detección de charter ausente; referencias retiradas/stale;
excepción aplicable; conflicto documental; selección de componentes y reutilización;
rechazo de rutas fuera de corpus y de acciones no autorizadas sugeridas por documentos;
actualización de snapshot y revalidación. Conservar hashes y llamadas a herramientas.
Los fixtures de casos de gobernanza se etiquetan como fixtures, nunca como normas Sapira.
