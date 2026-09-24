# Tower Grafo S1 — cierre de la columna `desktop/src` de la tabla de tokens

**Errata de identidad (re-apunte de la cita).** Esta nota abría diciendo que
«**el entregable no vive en el repo: `design/` es el almacén del piloto**»
(`artifacts/design/tower-grafo-s1-tabla-tokens.md`). Dejó de ser cierto al
aterrizar la tabla en el repo: hoy `design/tower-grafo-s1-tabla-tokens.md` **sí
vive en el repo** (commit `6b856c2ca`, dentro de PR #11) y es lo que viaja. El
almacén del piloto sigue ahí y se cita como **procedencia**, con su sha propio,
sin afirmar igualdad con el árbol. Lo demás de aquel párrafo describe mi commit
`45277235e`, no el tip de ahora.

**Errata de identidad (segunda pasada, la de este PR).** El sha de §5 se
re-deriva **al final** de esta revisión, no antes: la tabla dejó de afirmar que
el lienzo vive «byte a byte» en una segunda ruta de `desktop/` (la que retira
#13), y esa edición mueve el blob de `design/tower-grafo-s1-tabla-tokens.md`.
El árbol **antes** de esta revisión (y en `origin/main` = `eebed588e`) era
`76673ae6a97dd7afde60109dcb77943576bd9cc0eeb203c636ee49c7cac08f08`; el que viaja es
`230ea6e100b85e40cd8cf3db3ef87e73a4ae490183b8e1245d324ac078e91467`, medido con
`git cat-file blob <head>:design/tower-grafo-s1-tabla-tokens.md | shasum -a 256`.
La fila del almacén no se mueve: `shasum -a 256` sobre el fichero del almacén y
`git cat-file blob origin/main:reports/tower-grafo-s1-tokens-desktop.md` dan el
mismo `efd00ae2…`, que es este informe en `origin/main` = `eebed588e`.

**Resultado:** la última columna ya no dice «no verificado» en ninguna de las 28
filas. Las 9 clases del handoff quedan resueltas: **5 a `fichero:línea` de
`main` = `ab63b0129`** y **4 declaradas hueco de foundation** con su valor
observado y el paso más cercano, sin inventar ningún token nuevo.

| Clase del handoff | Resuelve a | Veredicto |
|---|---|---|
| `muted-foreground` | `desktop/tailwind.config.js:105` → `theme.css:16` | token del tema |
| `border` | `desktop/tailwind.config.js:115` → `theme.css:31`; default de todo elemento en `theme.css:119` | token del tema |
| `card` | `desktop/tailwind.config.js:88` → `theme.css:7` | token del tema |
| `text-2xs` | `desktop/tailwind.config.js:12` = `calc(var(--buzz-type-rem) * 0.6875)` = 11px | **hueco de foundation** (más cercano: `--text-supporting-size` 13px) |
| `rounded-2xl` | 16px, default de Tailwind; `tailwind.config.js:62-66` no lo reescribe | **hueco de foundation** (más cercano: `--radius-lg` 8px) |
| `py-1.5` | 0.375rem, default de Tailwind (`--spacing: 0.25rem`) | **hueco de foundation** (más cercano: `--space-component-padding-y` 0.5rem) |
| `gap-1.5` | 0.375rem, default de Tailwind; usado en `PanelErrorState.tsx:20` | **hueco de foundation** (más cercano: `--space-component-gap` 0.5rem) |
| `Badge variant="warning"` | `desktop/src/shared/ui/badge.tsx:16`, consumida en `PanelRow.tsx:74` | **no pasa por el token `warning` del tema**: pinta la paleta Tailwind amber |
| `Alert variant="destructive"` | `desktop/src/shared/ui/alert.tsx:12` → `theme.css:29`; consumida en `PanelErrorState.tsx:22` | token del tema, en `/10` |

## 0. Cómo lo he hecho, y por qué el punto de partida bastaba

El `grep` que el handoff sugería llevaba al tema; el tema se cierra con dos
eslabones, no con uno: `desktop/src/shared/styles/globals.css:22` carga
`tailwind.config.js` con `@config`, y ese config apunta cada clase a una
variable CSS que vive en `theme.css` (claro en `:root`, oscuro en `.dark`). Sin
el segundo eslabón, «`muted-foreground` resuelve a `hsl(var(--muted-foreground))`»
sería media respuesta; con él, la fila tiene valor.

Y un hallazgo que cambia el punto de partida del handoff: **los ficheros
`Panel*.tsx` que el diseñador citaba como «observados en el patch de la PR #9»
están en `main`**, con las mismas clases (`PanelRow.tsx:74` con
`variant="warning"`, `PanelList.tsx:58` con `py-1.5`, `PanelEmptyState.tsx:12`
con `rounded-2xl`). Sus candidatos no eran de una propuesta sin mergear: eran el
estado del escritorio. Los he podido citar como hechos, no como candidatos.

## 1. Las 28 filas, cerradas

Detalle completo en la tabla de `design/tower-grafo-s1-tabla-tokens.md`. Lo que
añade el cierre, en corto:

| Filas | Qué se cerró |
|---|---|
| 1, 3, 7, 28 | el rol coincide y **el valor no**: `--background` `#eff1f5`, `--card` = `--background` (el escritorio no distingue tarjeta de página, y ninguna es blanco), `--foreground` `#4c4f69`, margen de página 1.5rem solo desde `sm` |
| 4, 5 | el escritorio declara **un** borde (`--border`), no dos: `--color-border-subtle` no tiene equivalente, y el separador usa el mismo token que el borde |
| 6 | la cita de la entrega anterior era cierta: `PanelRow.tsx:119` usa `ring-2 ring-inset ring-ring` → `--ring` `#4c4f69` |
| 12, 13 | `Badge variant="success"` / `variant="info"` **existen sin una sola llamada** (grep sin coincidencias, §2): el ciclo de vida va en texto, `PanelRow.tsx:18-22` |
| 14 | el chip ámbar es del 43008, no del 43005, y **no usa el token `warning`** del tema pese a que el token existe y se usa en otros sitios (`MemorySection.tsx:224`) |
| 15 | `Alert variant="destructive"` → `--destructive` `#d20f39`, que no es el `#dc2626` de la foundation |
| 16, 17 | confirmado en el escritorio: estado neutro y ausencia van en **texto** (`PanelRow.tsx:18`, `:61`, `:149`), sin chip ni borde discontinuo |
| 18 | el esqueleto **no** usa el fondo hundido: `skeleton.tsx:14` = `rounded-md bg-primary/10` pulsante |
| 20 | el escritorio declara **Inter**, no DM Sans (`tailwind.config.js:77`, `theme.css:155`): el fallback que temía la fila no es el del escritorio |
| 21 | además de `text-2xs` (11px), el escritorio usa `text-xs` 12px y `text-sm` 14px: **tres** pasos sin escalón en la foundation, no uno |
| 23 | `rounded-md` sí se reescribe (`= --radius − 2px` = 8px), `rounded-xl` 12px y `rounded-2xl` 16px no |
| 24 | el contenedor del panel **no lleva sombra** (grep sin coincidencias): la zona se separa por borde; la tarjeta compartida sí (`card.tsx:54`) |
| 25, 26, 27 | no hay **una** escala de huecos: secciones `gap-6` = 1.5rem (exacto a `--space-section-gap`), rejilla `gap-2` 0.5rem (exacto a `--space-component-gap`), relleno `px-3` 0.75rem (exacto) y en Y más fino (`py-2.5`, `py-1.5`) |

## 2. Evidencia: comando y salida

Todo lo de abajo es `main`, commit `ab63b0129` (`git rev-parse main` =
`ab63b012900def60a16ca39d32d3515a0be81e50`). Salida copiada literal.

--- (1) tema Tailwind del escritorio: tema → config ---
$ git show ab63b0129:desktop/src/shared/styles/globals.css | sed -n '22p'
@config "../../../tailwind.config.js";

$ git show ab63b0129:desktop/tailwind.config.js | sed -n '12p'
        "2xs": "calc(var(--buzz-type-rem) * 0.6875)", // 11px at 16px type rem

$ git show ab63b0129:desktop/tailwind.config.js | sed -n '43p'
        5: "calc(var(--buzz-type-rem) * 1.25)",

$ git show ab63b0129:desktop/tailwind.config.js | sed -n '63p'
        lg: "var(--radius)",

$ git show ab63b0129:desktop/tailwind.config.js | sed -n '64p'
        md: "calc(var(--radius) - 2px)",

$ git show ab63b0129:desktop/tailwind.config.js | sed -n '68p'
        4.5: "1.125rem",

$ git show ab63b0129:desktop/tailwind.config.js | sed -n '77p'
          '"Inter Variable"',

$ git show ab63b0129:desktop/tailwind.config.js | sed -n '85p'
        background: "hsl(var(--background))",

$ git show ab63b0129:desktop/tailwind.config.js | sed -n '86p'
        foreground: "hsl(var(--foreground))",

$ git show ab63b0129:desktop/tailwind.config.js | sed -n '88p'
          DEFAULT: "hsl(var(--card))",

$ git show ab63b0129:desktop/tailwind.config.js | sed -n '96p'
          DEFAULT: "hsl(var(--primary))",

$ git show ab63b0129:desktop/tailwind.config.js | sed -n '104p'
          DEFAULT: "hsl(var(--muted))",

$ git show ab63b0129:desktop/tailwind.config.js | sed -n '105p'
          foreground: "hsl(var(--muted-foreground))",

$ git show ab63b0129:desktop/tailwind.config.js | sed -n '112p'
          DEFAULT: "hsl(var(--destructive))",

$ git show ab63b0129:desktop/tailwind.config.js | sed -n '115p'
        border: "hsl(var(--border))",

$ git show ab63b0129:desktop/tailwind.config.js | sed -n '117p'
        ring: "hsl(var(--ring))",

$ git show ab63b0129:desktop/tailwind.config.js | sed -n '136p'
          DEFAULT: "var(--ui-warning)",

--- (2) los valores del tema ---
$ git show ab63b0129:desktop/src/shared/styles/globals/theme.css | sed -n '3p'
    /* Catppuccin Latte (mauve accent) */

$ git show ab63b0129:desktop/src/shared/styles/globals/theme.css | sed -n '4p'
    --radius: 0.625rem;

$ git show ab63b0129:desktop/src/shared/styles/globals/theme.css | sed -n '5p'
    --background: 220 23.08% 94.9%;

$ git show ab63b0129:desktop/src/shared/styles/globals/theme.css | sed -n '6p'
    --foreground: 234 16.02% 35.49%;

$ git show ab63b0129:desktop/src/shared/styles/globals/theme.css | sed -n '7p'
    --card: 220 23.08% 94.9%;

$ git show ab63b0129:desktop/src/shared/styles/globals/theme.css | sed -n '11p'
    --primary: 266 85.05% 58.04%;

$ git show ab63b0129:desktop/src/shared/styles/globals/theme.css | sed -n '15p'
    --muted: 223 15.91% 82.75%;

$ git show ab63b0129:desktop/src/shared/styles/globals/theme.css | sed -n '16p'
    --muted-foreground: 233 12.8% 41.37%;

$ git show ab63b0129:desktop/src/shared/styles/globals/theme.css | sed -n '29p'
    --destructive: 347 86.67% 44.12%;

$ git show ab63b0129:desktop/src/shared/styles/globals/theme.css | sed -n '31p'
    --border: 225 13.56% 76.86%;

$ git show ab63b0129:desktop/src/shared/styles/globals/theme.css | sed -n '33p'
    --ring: 234 16.02% 35.49%;

$ git show ab63b0129:desktop/src/shared/styles/globals/theme.css | sed -n '41p'
    --sidebar-foreground: 234 16.02% 35.49%;

$ git show ab63b0129:desktop/src/shared/styles/globals/theme.css | sed -n '47p'
    --sidebar-accent-foreground: 234 16.02% 35.49%;

$ git show ab63b0129:desktop/src/shared/styles/globals/theme.css | sed -n '73p'
    --card: 232 23.4% 18.43%;

$ git show ab63b0129:desktop/src/shared/styles/globals/theme.css | sed -n '82p'
    --muted-foreground: 228 39.22% 80%;

$ git show ab63b0129:desktop/src/shared/styles/globals/theme.css | sed -n '97p'
    --border: 231 15.61% 33.92%;

$ git show ab63b0129:desktop/src/shared/styles/globals/theme.css | sed -n '119p'
    @apply border-border;

$ git show ab63b0129:desktop/src/shared/styles/globals/theme.css | sed -n '154p'
    @apply bg-background text-foreground antialiased;

$ git show ab63b0129:desktop/src/shared/styles/globals/theme.css | sed -n '155p'
    font-family: "Inter Variable", Inter, "Avenir Next", "Segoe UI", sans-serif;

$ git show ab63b0129:desktop/src/shared/styles/globals/typography.css | sed -n '17p'
    --buzz-type-rem: calc(1rem * var(--buzz-type-scale));

--- (3) los nueve pasos, en el componente que los define o los consume ---
$ git show ab63b0129:desktop/src/shared/ui/badge.tsx | sed -n '7p'
  "inline-flex items-center rounded-full px-2 pb-[3px] pt-[5px] text-2xs font-semibold uppercase leading-none tracking-[0.18em]",

$ git show ab63b0129:desktop/src/shared/ui/badge.tsx | sed -n '11p'
        default: "bg-primary text-primary-foreground",

$ git show ab63b0129:desktop/src/shared/ui/badge.tsx | sed -n '16p'
        warning: "bg-amber-500/15 text-amber-600 dark:text-amber-400",

$ git show ab63b0129:desktop/src/shared/ui/badge.tsx | sed -n '17p'
        success: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",

$ git show ab63b0129:desktop/src/shared/ui/badge.tsx | sed -n '18p'
        info: "bg-blue-500/15 text-blue-600 dark:text-blue-400",

$ git show ab63b0129:desktop/src/shared/ui/alert.tsx | sed -n '7p'
  "relative w-full rounded-2xl px-3.5 py-2.5 text-xs text-foreground",

$ git show ab63b0129:desktop/src/shared/ui/alert.tsx | sed -n '12p'
        destructive: "bg-destructive/10",

$ git show ab63b0129:desktop/src/shared/ui/alert.tsx | sed -n '39p'
    className={cn("mb-1 font-medium leading-4 tracking-tight", className)}

$ git show ab63b0129:desktop/src/shared/ui/alert.tsx | sed -n '50p'
  <div className={cn("text-xs leading-5", className)} ref={ref} {...props} />

$ git show ab63b0129:desktop/src/shared/ui/card.tsx | sed -n '54p'
      default: "rounded-xl border border-border/70 bg-card/80 shadow-xs",

$ git show ab63b0129:desktop/src/shared/ui/skeleton.tsx | sed -n '14p'
        "t-skel-bar rounded-md bg-primary/10",

$ git show ab63b0129:desktop/src/shared/ui/PageHeader.tsx | sed -n '28p'
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>

$ git show ab63b0129:desktop/src/features/panel/ui/panelLayout.ts | sed -n '8p'
  "grid gap-2 px-3 py-2.5 sm:grid-cols-[minmax(9rem,1.2fr)_minmax(11rem,1.8fr)_minmax(9rem,1.2fr)_minmax(9rem,1.2fr)_minmax(7rem,0.9fr)_minmax(8rem,1.1fr)] sm:gap-3";

$ git show ab63b0129:desktop/src/features/panel/ui/PanelList.tsx | sed -n '14p'
      className={`${PANEL_GRID} hidden border-b border-border/50 bg-muted/40 text-2xs font-semibold uppercase tracking-wide text-muted-foreground sm:grid`}

$ git show ab63b0129:desktop/src/features/panel/ui/PanelList.tsx | sed -n '40p'
      className="overflow-hidden rounded-xl border border-border/70 bg-card/40"

$ git show ab63b0129:desktop/src/features/panel/ui/PanelList.tsx | sed -n '46p'
        className="divide-y divide-border/50"

$ git show ab63b0129:desktop/src/features/panel/ui/PanelList.tsx | sed -n '58p'
        <p className="border-t border-border/50 px-3 py-1.5 text-2xs text-muted-foreground">

$ git show ab63b0129:desktop/src/features/panel/ui/PanelLoadingState.tsx | sed -n '16p'
      className="overflow-hidden rounded-xl border border-border/70 bg-card/40"

$ git show ab63b0129:desktop/src/features/panel/ui/PanelLoadingState.tsx | sed -n '25p'
          <Skeleton className="h-3.5 w-32" />

$ git show ab63b0129:desktop/src/features/panel/ui/PanelEmptyState.tsx | sed -n '12p'
      className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border/60 px-4 py-12 text-center"

$ git show ab63b0129:desktop/src/features/panel/ui/PanelEmptyState.tsx | sed -n '15p'
      <Radar aria-hidden="true" className="h-6 w-6 text-muted-foreground" />

$ git show ab63b0129:desktop/src/features/panel/ui/PanelErrorState.tsx | sed -n '20p'
      className="flex flex-col gap-1.5"

$ git show ab63b0129:desktop/src/features/panel/ui/PanelErrorState.tsx | sed -n '22p'
      variant="destructive"

$ git show ab63b0129:desktop/src/features/panel/ui/PanelErrorState.tsx | sed -n '62p'
    <Alert className="flex flex-col gap-1.5" data-testid="panel-stale-banner">

$ git show ab63b0129:desktop/src/features/panel/ui/PanelRow.tsx | sed -n '17p'
const WORK_STATE_TEXT: Record<WorkState, string> = {

$ git show ab63b0129:desktop/src/features/panel/ui/PanelRow.tsx | sed -n '18p'
  requested: "Solicitado",

$ git show ab63b0129:desktop/src/features/panel/ui/PanelRow.tsx | sed -n '19p'
  running: "En curso",

$ git show ab63b0129:desktop/src/features/panel/ui/PanelRow.tsx | sed -n '20p'
  done: "Terminado",

$ git show ab63b0129:desktop/src/features/panel/ui/PanelRow.tsx | sed -n '21p'
  failed: "Falló",

$ git show ab63b0129:desktop/src/features/panel/ui/PanelRow.tsx | sed -n '22p'
  cancelled: "Cancelado",

$ git show ab63b0129:desktop/src/features/panel/ui/PanelRow.tsx | sed -n '61p'
        <span className="text-sm text-muted-foreground">Sin señal</span>

$ git show ab63b0129:desktop/src/features/panel/ui/PanelRow.tsx | sed -n '74p'
      <Badge variant="warning">Espera registrada</Badge>

$ git show ab63b0129:desktop/src/features/panel/ui/PanelRow.tsx | sed -n '119p'
        `${PANEL_GRID} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring`,

$ git show ab63b0129:desktop/src/features/panel/ui/PanelRow.tsx | sed -n '127p'
        <span className="truncate text-sm font-medium">{row.role}</span>

$ git show ab63b0129:desktop/src/features/panel/ui/PanelRow.tsx | sed -n '149p'
              : "sin padre registrado"

$ git show ab63b0129:desktop/src/features/tower/ui/TowerScreen.tsx | sed -n '18p'
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-6 sm:px-6">

$ git show ab63b0129:desktop/src/app/BuzzThemeSurfaces.tsx | sed -n '38p'
          : "relative z-10 mb-2 ml-px mr-2 mt-px flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl bg-background shadow-content-edge"

$ git show ab63b0129:desktop/src/features/projects/ui/ProjectDetailChrome.tsx | sed -n '95p'
          className="absolute flex max-w-[50%] min-w-0 -translate-x-1/2 -translate-y-px items-center gap-0.5 text-xs text-sidebar-foreground/65 transition-[left] duration-200 ease-linear motion-reduce:transition-none"

$ git show ab63b0129:desktop/src/shared/theme/adaptive-theme.ts | sed -n '286p'
      "--ui-warning": accentOrange,

$ git show ab63b0129:desktop/src/features/agent-memory/ui/MemorySection.tsx | sed -n '224p'
        "mb-2 flex items-center gap-2 rounded-md border border-warning/30 bg-warning/5 px-2 py-1.5 text-xs",

$ git show ab63b0129:desktop/package.json | sed -n '106p'
    "tailwindcss": "^4.3.0",

Seis líneas más que la tabla cita, para que ninguna quede sin `sed` propio:

$ git show ab63b0129:desktop/tailwind.config.js | sed -n '127p'
          border: "hsl(var(--sidebar-border))",

$ git show ab63b0129:desktop/src/features/panel/ui/PanelRow.tsx | sed -n '60p'
      <div className="flex min-w-0 flex-col gap-0.5">

$ git show ab63b0129:desktop/src/features/panel/ui/PanelRow.tsx | sed -n '62p'
        <span className="text-2xs text-muted-foreground">

$ git show ab63b0129:desktop/src/features/panel/ui/PanelRow.tsx | sed -n '80p'
      <span className="truncate font-mono text-2xs text-muted-foreground">

$ git show ab63b0129:desktop/src/features/projects/ui/ProjectDetailChrome.tsx | sed -n '101p'
            className="flex shrink-0 items-center gap-1.5 rounded-md px-1 py-1 font-medium transition-colors hover:text-sidebar-accent-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"

$ git show ab63b0129:desktop/src/features/projects/ui/ProjectDetailChrome.tsx | sed -n '125p'
              className="min-w-0 truncate px-0.5 font-medium opacity-60"

## 3. Lo que NO está (y cómo lo sé)

Cinco negativos sostienen filas de la tabla; ninguno es una impresión:

$ git rev-parse main
ab63b012900def60a16ca39d32d3515a0be81e50

$ git rev-parse ab63b0129
ab63b012900def60a16ca39d32d3515a0be81e50

--- negativos (lo que NO está, y cómo lo sé) ---

Comando 1 — la variante `success` del chip no tiene llamadas; comando 2 — la variante
`info`, tampoco; comando 3 — el contenedor del panel no lleva sombra; comando 4 — no
hay banda de procedencia (`fixture`) en la superficie; comando 5 — la superficie no
pinta texto con color explícito. La nota de diseño cita estos números como
«§3, comando N».

$ git grep -n 'variant="success"' ab63b0129 -- desktop/src
(exit 1, sin coincidencias)

$ git grep -n 'variant="info"' ab63b0129 -- desktop/src
(exit 1, sin coincidencias)

$ git grep -n shadow ab63b0129 -- desktop/src/features/panel
(exit 1, sin coincidencias)

$ git grep -in fixture ab63b0129 -- desktop/src/features/tower desktop/src/features/panel
(exit 1, sin coincidencias)

$ git grep -n text-foreground ab63b0129 -- desktop/src/features/tower desktop/src/features/panel
(exit 1, sin coincidencias)

$ git grep -c 'variant="warning"' ab63b0129 -- desktop/src
ab63b0129:desktop/src/features/agents/ui/ManagedAgentRow.tsx:2
ab63b0129:desktop/src/features/agents/ui/RestartDiffBadge.tsx:2
ab63b0129:desktop/src/features/agents/ui/UnifiedAgentsSection.tsx:2
ab63b0129:desktop/src/features/channels/ui/ChannelBrowserDialog.tsx:1
ab63b0129:desktop/src/features/onboarding/ui/MembershipDenied.tsx:1
ab63b0129:desktop/src/features/panel/ui/PanelRow.tsx:1
ab63b0129:desktop/src/features/tower/ui/PortfolioRow.tsx:1

--- la dependencia instalada (NO es un fichero de main) ---

$ node -e "console.log(require(\"./desktop/node_modules/tailwindcss/package.json\").version)"
4.3.0

$ git show ab63b0129:desktop/package.json | sed -n '106p'
    "tailwindcss": "^4.3.0",

$ sed -n '40p' desktop/node_modules/tailwindcss/theme.css
  --color-amber-600: oklch(66.6% 0.179 58.318);

$ sed -n '325p' desktop/node_modules/tailwindcss/theme.css
  --spacing: 0.25rem;

$ sed -n '401p' desktop/node_modules/tailwindcss/theme.css
  --radius-xl: 0.75rem;

$ sed -n '402p' desktop/node_modules/tailwindcss/theme.css
  --radius-2xl: 1rem;

--- los hex de la tabla: conversion mia, no del fichero ---

$ python3 -c "import colorsys; print(..."   # hsl declarado -> sRGB
--background theme.css:5         hsl(220 23.08% 94.9%)  ->  #eff1f5
--foreground :6                  hsl(234 16.02% 35.49%)  ->  #4c4f69
--card :7                        hsl(220 23.08% 94.9%)  ->  #eff1f5
--primary :11                    hsl(266 85.05% 58.04%)  ->  #8839ef
--muted :15                      hsl(223 15.91% 82.75%)  ->  #ccd0da
--muted-foreground :16           hsl(233 12.8% 41.37%)  ->  #5c5f77
--destructive :29                hsl(347 86.67% 44.12%)  ->  #d20f39
--border :31                     hsl(225 13.56% 76.86%)  ->  #bcc0cc
--ring :33                       hsl(234 16.02% 35.49%)  ->  #4c4f69
--muted-foreground :82 (.dark)   hsl(228 39.22% 80.0%)  ->  #b8c0e0
--border :97 (.dark)             hsl(231 15.61% 33.92%)  ->  #494d64

## 4. Límites de este cierre

- **Un hueco de foundation que la tabla no cubre, porque no es una clase:** el
  brief dice «`rounded-2xl` 16px > máximo 12px», y la fila 23 del diseñador
  enumera `--radius-lg` 8px como mayor paso finito. No he leído la foundation
  (`@sapira/ui` 0.13.1): uso su cita. El veredicto no cambia —16px supera a
  cualquiera de los dos— pero la discrepancia es real y queda declarada.
- **El valor de `amber-600` no lo afirmo.** `Tailwind 4.3.0` lo declara en
  `oklch(66.6% 0.179 58.318)`; una conversión mía a sRGB da `#e17100`, que
  probablemente no es lo que pinta el navegador (la de Tailwind está fuera del
  gamut sRGB y el mapeo de gamut no es un recorte de componentes). Así que la
  fila 14 dice «paleta Tailwind amber» y **no** dice «exacto en color» ni «igual
  a #d97706»: eso no lo he medido.
- **No he ejecutado nada de la app.** No hay render, ni gate, ni e2e, ni
  contraste, ni teclado en este encargo: es una lectura de tokens con `git`. La
  puerta del 3% sigue donde la dejó la entrega anterior.
- **No he tocado el prototipo ni la especificación** (`tower-grafo-s1-lienzo.html`,
  `tower-grafo-s1-taxonomia.md`): el encargo lo prohíbe explícitamente.
- **El tema del escritorio no es el tema de la foundation, y lo he mantenido
  separado.** Las coincidencias de valor entre las dos columnas son casuales
  (Catppuccin Latte/Macchiato vs. la paleta Sapira); la tabla no pretende que
  una derive de la otra.

## 5. Entrega y handoff

| Qué | Dónde | Identidad |
|---|---|---|
| Tabla de tokens cerrada — **artefacto que viaja** | `design/tower-grafo-s1-tabla-tokens.md` (repo) | sha256 `230ea6e100b85e40cd8cf3db3ef87e73a4ae490183b8e1245d324ac078e91467` |
| Tabla de tokens — **procedencia en el almacén** (fuera del repo) | `artifacts/design/tower-grafo-s1-tabla-tokens.md` | sha256 `56053d500aa80e716d8d5ccbba5567496614a0f3931ae4d63480a7d5b17cc402`, que **no** es el del árbol |
| Este informe | `reports/tower-grafo-s1-tokens-desktop.md` (repo) — esta revisión lleva las erratas de identidad — y `artifacts/reports/tower-grafo-s1-tokens-desktop.md` (almacén) | **ya no** «igual contenido»: el almacén quedó en sha256 `efd00ae280693e618a8429e26f4f0b092d4aaabb75ab167d825cb6924aa4a780`, que es la copia del repo **antes** de estas erratas |
| Rama / PR | `agent/tower-grafo-s1`, PR #11 `https://github.com/ai-sapira-poc/buzz-v1/pull/11` | commits de documentación, fast-forward sobre `89b85ab3b`; sin fuerza. Mi primer commit es `45277235e` |

- **Al revisor:** los `fichero:línea` son de `main` = `ab63b0129`, no del tip del
  PR. Verificar contra ese commit.
- **Decisión que abre este cierre (una línea de código, fuera de mi contrato):**
  `Badge variant="warning"` (`badge.tsx:16`) pinta la paleta Tailwind y no el
  token `warning` del tema (`tailwind.config.js:136` → `--ui-warning`), que sí
  usan otros sitios. Si el chip del 43008 debe heredar el token adaptativo de la
  comunidad, es cambiar una cadena en `badge.tsx`. No lo he hecho: no es la
  columna que se me pidió cerrar.
- **Estado de las refs:** empujado con `HEAD:refs/heads/agent/tower-grafo-s1`,
  fast-forward `89b85ab3b..45277235e`, sin `--force`. **No he movido ninguna ref
  local** (trabajé en un worktree detached), así que el worktree que tiene la
  rama cogida no queda desincronizado: verá el avance al hacer `git pull`. El
  commit `544a0e258` que vi local en el worktree del arquitecto ya está en el
  remoto como ancestro de `89b85ab3b`; no lo he tocado.
- **Los hooks corrieron, y `--no-verify` no hizo falta.** El push pasó la puerta
  completa del repo: `branch-skew`, `push-head-scope`, `file-size-check`,
  `desktop-check` (biome), `desktop-typecheck` (tsc) y `desktop-test`
  (**6756 pass, 0 fail**, 176 s), en ~200 s de reloj. Las lanes de `desktop/**`
  se disparan por el diff de la rama contra `origin/main`, no por mi fichero: mi
  cambio es un `.md` en `reports/`, que no está en ninguna raíz gobernada por el
  ratchet de tamaño.
- **La nota dentro del PR:** cuando escribí esto, la tabla vivía solo en el
  almacén del piloto y moverla habría creado un `design/` de primer nivel en el
  repo. Hoy ese `design/` ya existe (`design/tower-grafo-s1-tabla-tokens.md`,
  desde `6b856c2ca`, PR #11) y es lo que viaja.

**Confianza:** alta en cada `fichero:línea` de §2 (comando y salida copiados de
`main`); alta en los negativos de §3 (grep acotado, salida vacía); **media** en
los cuatro huecos de foundation, porque su «paso más cercano» sale de la
enumeración del diseñador y no de la foundation leída por mí.
