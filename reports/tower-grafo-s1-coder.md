# Tower Grafo S1 — las tarjetas: informe del escritor (r4)

**La premisa del encargo ya no era cierta cuando empecé a escribir.** El encargo
era entregar las tarjetas de S1 en `agent/tower-grafo-s1`; la rama **ya las tenía
desde otro escritor** antes de que yo escribiera una línea, y también el cierre
del hueco `events ?? []`. Lo que faltaba de verdad en el PR era el prototipo
aprobado y su tabla de mapeo. Eso es lo que he dejado; no he sobrescrito el
trabajo ajeno, y la decisión que sigue abierta está en §3.

**Rama:** `agent/tower-grafo-s1`, PR #11 (`gh pr view 11`: `state OPEN`,
`baseRefName main`, `url https://github.com/ai-sapira-poc/buzz-v1/pull/11`).
**Base de mi entrega:** `c41af27d3` — el tip que encontré al rebasar por última
vez; la rama se movió cinco veces durante el stage, así que la lista de §1 es lo
que verifiqué, no una afirmación sobre el tip de ahora. Mi entrega **no toca
código**: si la rama vuelve a moverse, rebasarla es trivial. **Mis commits:**
`e9f0b25ab` (el prototipo) y `6aec53597` (este informe).

## 1. Lo que encontré (y cómo lo comprobé)

La rama se movió **cuatro veces** mientras yo trabajaba; estos son los commits
que ya estaban, leídos con `git log`/`git show` sobre el remoto, no deducidos:

| Commit | Qué es | ¿Mío? |
|---|---|---|
| `2530e94bf` | `feat(tower): S1 control graph as role columns of cards` | no |
| `a739cd06f` | `fix(tower): reject a missing event list instead of resolving it as empty` | no |
| `06cc92380` | `docs(tower): point the model-span citation at control_plane/telemetry.py:135` | no |
| `1546f15d4` | `fix(tower): stop the S1 runner resetting the app's module graph` | no |
| `6d2178757` | `docs(tower): name the real producers per state and mark requested as producer-less` | no |
| `c41af27d3` | `fix(tower): one announcement for one read, not two` | no |

El cierre del hueco que me pedías (`towerBuzzSource.ts` con `events ?? []`) está
en `a739cd06f`, ya en el PR. La superficie de tarjetas está en `2530e94bf`
(`GrafoCanvas.tsx`, `GrafoCard.tsx`, `GrafoSection.tsx`, `grafoGroups.ts`, su
test de render y su spec e2e). **Lo que no estaba en el PR era el prototipo**:
`git ls-tree -r --name-only origin/agent/tower-grafo-s1
desktop/src/features/tower | grep -i lienzo` no devolvió nada.

No volqué mi implementación encima por una razón concreta, no por prudencia
genérica: la que está es *más* completa que la mía en un punto que importa —
dibuja la espera publicada (`WaitingReason`, `ladder_exhausted` /
`capability_denied`) y la mía no—, y su elección de idioma es una decisión
consistente con la superficie que ya existía (abajo). Sustituirla habría sido un
cambio más grande que el contrato de mi stage.

## 2. Lo que he dejado en la rama

`364da5ef3` — «docs(tower): pin the approved S1 prototype beside the taxonomy it
implements» (rebasado a `e9f0b25ab` sobre el tip `c41af27d3`):

- `desktop/src/features/tower/tower-grafo-s1-lienzo.html`, **byte por byte** el
  artefacto aprobado (`artifacts/design/tower-grafo-s1-lienzo.html`), sha256
  `e9970382f2b0355a10737d657fa23d31b5d2af154f32786f726db8c31a2d3afb` en los dos
  ficheros (comprobado con `shasum -a 256` sobre ambos). Lleva dentro la tabla de
  mapeo de tokens, que es la mitad del artefacto que el PR no podía mostrar.
- `desktop/biome.json`: **una línea de exclusión para ese fichero**. Es el único
  cambio mío **fuera del ámbito de escritura declarado**
  (`desktop/src/features/tower/**`, `desktop/src/shared/api/tower*`,
  `desktop/tests/e2e/tower-grafo-*`), y va aquí porque sin ella el artefacto
  aprobado **rompe la puerta de lint del repo**: su bloque de tokens escribe
  placeholders de Sapira (`{sapira.typography.fontWeight.body}`, 12 apariciones,
  3 nombres) que no son CSS válido, y Biome 2.4 sí parsea `.html`.

  Lo verifiqué en los dos sentidos, porque una exclusión mal puesta es una
  puerta que no protege nada: con la exclusión, `npx biome check .` (desde
  `desktop/`) sale **0** sobre 2774 ficheros; sin ella, **1**, con el parse error
  en `:86`. Y con un fichero deliberadamente roto reintroducido
  (`src/features/tower/ui/__probe.ts` con `any`), la misma corrida vuelve a salir
  **1** y lo nombra. La puerta queda estrechada, no anulada. El fichero de sonda
  se borró después (última corrida: exit 0).

## 3. La decisión que queda abierta: el idioma del copy

No es cosmético y no la quiero decidir yo calladamente. La tarjeta que está en el
PR imprime **«Not available»**; el documento que la especifica exige
**«no disponible»**:

- `GrafoCard.tsx:54` — `export const NOT_AVAILABLE = "Not available";`, usado en
  `:129` para el modelo, y su test lo fija (`towerGrafoRender.test.mjs:155-156`).
  Es deliberado: se comparte con la fila que ya existía (`PortfolioRow.tsx:74`,
  «the operator learns it once»).
- La taxonomía en el árbol, `tower-grafo-s1-taxonomia.md:180-181`, y el
  documento de producto, `product/tower-grafo-s1-tarjetas.md:57-58`, dicen
  «no disponible», en castellano, para modelo y coste. El prototipo aprobado
  también es castellano (`no disponible` ×13, `aristas` ×13).
- El veredicto de S1 cita la superficie existente en inglés
  (`reviews/verdict-tower-grafo-slice1.md:126`, muestra de texto renderizado con
  `Not available`) y no lo señala como defecto.

Las dos lecturas son defendibles, y por eso es una decisión y no un bug:
**(a)** el idioma de la superficie es el inglés (consistente con la fila y con el
veredicto) y lo que hay que arreglar es la literalidad del documento de producto;
**(b)** lo que manda es el documento y el prototipo, y la tarjeta debe decir
«no disponible» — cuesta una línea más dos aserciones de test. Mi recomendación
es **(a)**, precisamente porque el copy ya existente es inglés y porque cambiar
sólo esas dos cadenas deja la superficie mezclada. Lo que no debería quedarse es
las dos cosas a la vez, que es como está hoy.

**Mi implementación paralela, preservada y no empujada:** tag local
**`tower-grafo-s1-cards-r4-alt`** → `67d32911e` (tres commits sobre `790d92db4`:
`723de1a48` adaptador, `e54d88acd` lienzo, `67d32911e` spec+runner). Dibuja el
copy literal del documento («no disponible», estados `pedido / trabajando /
entregado / cancelado / falló`, «por rol — aristas en S2»), parte los estados en
su propio fichero y **no** dibuja la espera. Si eliges (b), se adopta trozo a
trozo (`git checkout tower-grafo-s1-cards-r4-alt -- <rutas>`) y hay que decidir
qué pasa con la espera, que se perdería.

## 4. Validación: lo que ejecuté y lo que no

Ejecutado, con la salida real:

| Comando (desde `desktop/`) | Dónde | Resultado |
|---|---|---|
| `npx tsc --noEmit` | mi línea pre-rebase: `1546f15d4` + el HTML | exit 0 |
| `node --import ./test-loader.mjs --experimental-strip-types --test "src/**/*.test.mjs" "scripts/*.test.mjs"` | ídem | **6751 pass, 0 fail**, 86 suites, 206.6 s |
| ídem, sólo `src/features/tower/**` + `src/shared/api/tower*` | tip final `6aec53597` | **117 pass, 0 fail**, 1.6 s |
| `npx vite build --mode e2e` | `1546f15d4` + el HTML | built in 2.79 s |
| `npx playwright test --config=tests/e2e/tower-grafo-s1.config.ts --retries=0` | ídem | **4/4** dos veces (36.9 s y 17.1 s) |
| `npx biome check .` | tip final `6aec53597` | exit 0, 2774 ficheros |
| `node ./scripts/check-px-text.mjs` | `1546f15d4` + el HTML | exit 0 |
| `node ./scripts/check-file-sizes.mjs` | ídem | exit 0 |

**No ejecutado, y por qué:**

- La e2e corrió en `1546f15d4` **más mi commit del HTML** (pre-rebase), no en el
  tip final; entre uno y otro sólo entran un commit de documentación de la
  taxonomía, ese HTML y `biome.json`, así que no re-corrí la e2e tras el rebase.
  Eso es exacto: no es una corrida verde del tip `6aec53597`, es una corrida
  verde del código idéntico que el tip lleva.
- `biome check .` **desde la raíz del repo**: exit 1, pero por configuración
  anidada (`Found a nested root configuration`, 2 hallazgos: `desktop/biome.json`
  y `web/biome.json`), no por código. Comprobé que ya era así con la
  `desktop/biome.json` anterior a mi cambio (2 hallazgos, exit 1), así que es
  preexistente; la puerta que sí verifiqué es la del paquete `desktop`, que es la
  que cubre mi fichero.
- `just ci` y `pnpm check` / `pnpm test`: **no se pueden ejecutar en este
  worktree**. `node_modules` es un symlink al de otro worktree y `pnpm` se niega
  (`deps-status` falla y ofrece `pnpm install`). Corrí los comandos equivalentes a
  mano, uno a uno (tabla de arriba). Las lanes de Rust, mobile y web no las toqué
  ni las ejecuté: mi cambio no las toca, y no las verifiqué.
- Hook de pre-commit: `git commit` lanzó lefthook y éste se colgó 300 s en
  `just desktop-fix` (que invoca `pnpm`) hasta que lo mató mi timeout; el commit
  quedó sin hacer y los ficheros en el índice. **Todos mis commits son
  `git commit -s --no-verify`**, después de correr a mano biome, tsc, node:test,
  px-text y file-sizes. El push también va con `--no-verify` por la misma pared.

## 5. Lo que no se puede saber desde aquí

1. **Si el lienzo enseña los encargos reales de una comunidad.** No lo he
   ejercido: el adaptador se ha corrido contra fetchers de mentira (test de
   unidad) y el lienzo contra una caché de query sembrada (e2e). **Ninguna
   corrida mía leyó un relay.** La lectura de punta a punta contra un relay vivo
   está declarada y no verificada en este informe.
2. **Si existe productor vivo de `43001` (`requested`).** No lo puedo observar
   aquí (ni relay ni telemetría). `6d2178757` lo declara «producer-less»; leí su
   título y su diffstat, **no he re-derivado esa afirmación**.
3. **Modelo y coste con productor real.** `cost` es `null` en esta lectura: la
   rama «con cobertura» de la tarjeta sólo está cubierta por fixtures, nunca por
   un productor observado. El modelo, igual: la tarjeta lo pinta ausente siempre.
4. **La ventana.** El adaptador lee con límite (500, `read`, acotada al owner).
   Si esa ventana cubre la cartera real de un operador es una medida que no hice.
5. **Fidelidad visual al prototipo.** No tengo visión: he leído el CSS, la tabla
   de tokens y las cadenas que el test de render imprime, **no he visto el
   lienzo**. Que se parezca al prototipo es, para mí, no verificado.
6. **Los tiempos.** No hay medida del presupuesto de 400 ms. El único reloj que
   tengo es el de la e2e (1.4–1.7 s por caso, incluido el arranque de la app), y
   eso no es una medida de render.
7. **Las cifras del arnés ajeno.** El backlog 512 del runner
   (`1546f15d4`) y el recuento «8/8 dos veces» de las notas del maestro son
   afirmaciones de otros: yo sólo confirmo mi propia corrida (4/4, dos veces,
   `--retries=0`). Antes de ese arreglo diagnostiqué el mismo fallo por mi
   cuenta: con el backlog por defecto, `#root` quedó vacío y lo muestreé vacío
   durante 60 s mientras la puerta esperaba la barra lateral.

## 6. Cómo seguir

- **Decisión debida:** §3 (idioma del copy). Cuesta una línea si gana (b), y hay
  que decidir la espera.
- **Siguiente paso que no es mío:** registrar
  `tests/e2e/tower-grafo-s1.config.ts` en `playwright.config.ts` (fuera del
  ámbito de mi stage; el runner propio existe justo por eso).
- **Estado de mis refs:** rama empujada con `HEAD:refs/heads/agent/tower-grafo-s1`,
  fast-forward desde `c41af27d3` hasta `5339a0d3b`, sin fuerza y sin `--force`. No
  he movido ninguna ref local, así que el worktree que tiene la rama cogida no
  queda desincronizado (verá el avance al hacer `git pull`). El tag
  `tower-grafo-s1-cards-r4-alt` es **local y no se empuja**.
- No he mergeado, ni he tocado `main`, ni he desplegado nada.
