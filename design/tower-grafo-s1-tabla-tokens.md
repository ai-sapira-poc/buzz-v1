---
type: design-note (cierre del entregable 1 de S1 — mitad «tabla de tokens»)
owner: "@diseno"
date: 2026-09-24
prototipo: "design/tower-grafo-s1-lienzo.html (= desktop/src/features/tower/tower-grafo-s1-lienzo.html, byte a byte) — 49.795 caracteres, sha256 a91fb3ccd683e9d37158b0e4724a0ef17dd2be849bca519abe0a81b3b8e5db88. Es el lienzo que viaja en esta PR; el sha y el recuento se miden con `wc -c` y `shasum -a 256` sobre el fichero del arbol de trabajo, no se heredan de la sesion del disenador. Lo que esa sesion (2026-09-24) leyo integro fue la revision sha256 e9970382…, 51.198 caracteres: superseded por esta PR (chip «pedido» retirado y citas de cabecera resueltas en F-B), ya no es la que viaja"
foundation: "context {operation:design} de esta sesión: @sapira/ui 0.13.1, foundation_block verbatim; fuente declarada por la herramienta packages/ui/src/tokens/tokens.json sha256 129bc936cea170e82c1ad4722d2a9dac647fe962bfacb7ae5b1acfaad0e910e7"
desktop: "DOS PASADAS. (1) @diseno, 2026-09-24: NO LEÍDO — `list desktop/` y `read desktop/src/...` devolvieron FileNotFoundError en su sesión (tres consultas). (2) @coder, misma fecha, rama agent/tower-grafo-s1: SÍ leído sobre `main` = ab63b0129 con shell+git. Los 9 pasos del handoff quedan resueltos en §1bis: 5 a un fichero:línea de `main` y 4 declarados hueco de foundation con su valor observado. La columna «no verificado» queda cerrada en las 28 filas (§1). Ningún path de este documento es del diseñador ni inventado: cada uno lleva comando y salida en reports/tower-grafo-s1-tokens-desktop.md"
candidatos: "tower/panel-pr-9.patch — 81.951 caracteres, leído íntegro, sha256 e131b742dedcfa082e39befd19153ae2598245606108224f9f85511dd20afb13; architecture/tower-grafo-s1-taxonomia-estados.md — leído entero (sus path:línea son citas del arquitecto, re-verificadas por @revisor en REV-TOWER-S1-CITAS-0004, no por mí)"
repo: "@diseno: intacto; sin push, merge, PR ni deploy. @coder: commits de documentación en reports/ sobre origin/agent/tower-grafo-s1 (PR #11), fast-forward, sin fuerza; sin push a main, sin merge, sin deploy"
---

# Tabla rol Sapira → token — cierre del entregable 1 de S1

## 0. Una línea sobre `desktop/src` (pasada de @diseno — se conserva como historia)

Sigue sin existir en el árbol que mi herramienta ve: `list {desktop}` y
`read {desktop/src/features/tower/ui/TowerSection.tsx}` devolvieron
`FileNotFoundError` en esta sesión. Por tanto **ninguna fila nombra un token
existente de `desktop/src`**: todas llevan la marca «no verificado» con ese
motivo común, y la última columna nombra —solo cuando existe y solo de fuente que
yo haya leído— el **candidato** observado en código de escritorio real dentro del
almacén: el patch de la PR #9 (`tower/panel-pr-9.patch`, propuesta, estado de
merge desconocido para mí) y el apéndice de dominio de la taxonomía del
arquitecto (sin tokens). No se inventa ningún path.

**Esa marca ya no está en la tabla.** @coder leyó `desktop/src` sobre `main` en
la pasada (2) y la columna «no verificado» no aparece en ninguna de las 28 filas;
la §1bis resuelve, una por una y con comando, las 9 clases que pedía el handoff.

## 1. La tabla

Procedencia de la columna «token»: una sola para todas las filas — el
`foundation_block` devuelto por `context {operation:design}` en esta sesión, que
el prototipo inserta verbatim (auditado sobre mi lectura del CSS de composición
del fichero, no sobre la tabla que el propio HTML lleva dentro).

Procedencia de la última columna: `desktop/src` **sí leído**, sobre `main` =
`ab63b0129`, por @coder. Cada `fichero:línea` va acompañado de su
`git show ab63b0129:<fichero> | sed -n '<línea>p'` en
`reports/tower-grafo-s1-tokens-desktop.md` §2. Los valores `hsl(a b% c%)` se citan
como están declarados; el hex entre paréntesis es **conversión mía** (python3,
`colorsys`), no una declaración del fichero.

| # | Rol de superficie | Token de la foundation (valor) | Exactitud del match | Resolución en `desktop/src` (`ab63b0129`) |
|---|---|---|---|---|
| 1 | Fondo de página | `--color-surface-default` #f6f6f3 | exacto | `theme.css:154` (`body { @apply bg-background … }`) → `tailwind.config.js:85` → `--background` `theme.css:5` hsl(220 23.08% 94.9%) (#eff1f5). **El rol coincide; el valor no** |
| 2 | Fondo de columna (hundido) | `--color-surface-sunken` #ebe8e6 | exacto | `bg-muted/40` `PanelList.tsx:14` → `tailwind.config.js:104` → `--muted` `theme.css:15` (#ccd0da); el contenedor usa `bg-card/40` en su lugar (`PanelList.tsx:40`) |
| 3 | Fondo de tarjeta y zona de estado | `--color-surface-elevated` #ffffff | exacto | `card.tsx:54` (`bg-card/80`) → `tailwind.config.js:88` → `--card` `theme.css:7` = **el mismo valor que `--background`**: el escritorio no distingue tarjeta de página, y ninguna de las dos es blanco |
| 4 | Borde de tarjeta, chip y botón | `--color-border-default` #d8d4cf | exacto | borde por defecto de todo elemento: `theme.css:119` (`* { @apply border-border }`) → `tailwind.config.js:115` → `--border` `theme.css:31` hsl(225 13.56% 76.86%) (#bcc0cc). Las opacidades `/60` (`PanelEmptyState.tsx:12`) y `/70` (`PanelList.tsx:40`) siguen sin paso |
| 5 | Separadores internos (cabecera de columna, campos, reglas, `th/td`) | `--color-border-subtle` #26251e1a | **inexacto**: es un alfa pensado para pelo fino y aquí carga separadores de bloque | `divide-border/50` `PanelList.tsx:46` y `border-b border-border/50` `PanelList.tsx:14` apuntan al **mismo `--border`** que la fila 4: el tema de escritorio solo declara `--border` (`tailwind.config.js:115`) y `--sidebar-border` (`:127`) — no hay un borde sutil separado, tampoco en opacidad cero |
| 6 | Anillo de foco de teclado | `--color-border-focus` #a93737 | exacto | `PanelRow.tsx:119` (`focus-visible:ring-2 ring-inset ring-ring`) → `tailwind.config.js:117` → `--ring` `theme.css:33` (#4c4f69). Cierra el «no lo reproduzco» del handoff: la cita era cierta |
| 7 | Texto principal (títulos de tarjeta, columna, sección) | `--color-text-primary` #25231d | exacto | `theme.css:154` (`text-foreground`) → `tailwind.config.js:86` → `--foreground` `theme.css:6` hsl(234 16.02% 35.49%) (#4c4f69). La superficie de S1 no pinta texto con color explícito: lo hereda del `body` |
| 8 | Texto secundario (razón, rol, cita) | `--color-text-secondary` #68615a | exacto | `text-muted-foreground` `PanelEmptyState.tsx:15` → `tailwind.config.js:105` → `--muted-foreground` `theme.css:16` hsl(233 12.8% 41.37%) (#5c5f77) |
| 9 | Texto apagado (notas, `caption`, `th`, migas) | `--color-text-muted` #68615a | **inexacto**: comparte valor con el secundario en este tema; el rol «apagado» no tiene token propio | misma clase `text-muted-foreground` que la fila 8 (`PanelRow.tsx:186`), y es la **única** clase de texto apagado del escritorio: el rol tampoco se separa aquí (el modo oscuro sí baja el valor: `theme.css:82`, #b8c0e0) |
| 10 | Enlace de migas | `--color-text-link` #25231d | **inexacto**: comparte valor con el primario; solo lo separa el subrayado nativo | `ProjectDetailChrome.tsx:95` (`text-xs text-sidebar-foreground/65`) + `:101` (`hover:text-sidebar-accent-foreground`); el actual va a `opacity-60` (`:125`). La miga se distingue por hover y opacidad, no por color de enlace: confirma la fila. La superficie de S1 no tiene migas |
| 11 | Acento de marca | `--color-brand` #c54444 | **declarado no usado**: nombrado por existir; emplearlo en chips fundiría marca con estado | `--primary` `theme.css:11` hsl(266 85.05% 58.04%) (#8839ef, mauve de Catppuccin) vía `tailwind.config.js:96`; el escritorio sí lo usa (`badge.tsx:11`, `skeleton.tsx:14`). No es #c54444: la marca de la foundation y el acento del escritorio son colores distintos |
| 12 | Estado «trabajando» (43002/43003) | `--color-feedback-info` #2563eb + `--color-feedback-info-bg` #eff6ff | **inexacto**: «trabajando» no es feedback informativo, es el estado vivo; no hay token de ciclo de vida y el texto del chip carga el significado | la variante existe sin llamadas: `badge.tsx:18` (`variant: info`), **cero usos en `desktop/src`** (§3, comando 1). En la superficie de S1 el estado va en texto: `PanelRow.tsx:19` (`running: "En curso"`) |
| 13 | Estado «entregado» (43004) | `--color-feedback-success` #16a34a + bg #f0fdf4 | exacto en color; **inexacto en semántica** (feedback, no ciclo de vida) → el texto es obligatorio | igual: `badge.tsx:17` (`variant: success`), **cero usos** (§3, comando 2); el texto es `PanelRow.tsx:20` (`done: "Terminado"`) |
| 14 | Estado «cancelado» (43005) | `--color-feedback-warning` #d97706 + bg #fffbeb | **inexacto**: cancelar no es una advertencia; ámbar por descarte, y el texto distingue | el chip ámbar que existe es el del 43008, no el del 43005: `PanelRow.tsx:74` (`Badge variant="warning"` «Espera registrada») → `badge.tsx:16`, que pinta la **paleta Tailwind** (`amber-500/15`, `amber-600`), **no** el token `warning` del tema (`tailwind.config.js:136` → `--ui-warning`, `adaptive-theme.ts:286`), que otros sitios sí usan (`MemorySection.tsx:224`). Cancelado solo tiene texto: `PanelRow.tsx:22` |
| 15 | Estado «falló» (43006) y rama de error | `--color-feedback-error` #dc2626 + bg #fef2f2 | exacto en color; el texto «falló» sigue siendo obligatorio | `PanelErrorState.tsx:22` (`Alert variant="destructive"`) → `alert.tsx:12` (`bg-destructive/10`) → `--destructive` `theme.css:29` hsl(347 86.67% 44.12%) (#d20f39), que **no es** #dc2626. Texto del estado: `PanelRow.tsx:21` (`failed: "Falló"`) |
| 16 | Chip de estado neutro (43001, «pedido») — **el lienzo lo retiró en esta PR** | neutros: `--color-surface-elevated` + `--color-border-default` + `--color-text-primary` | **inexacto**: no hay chip sólido propio ni token de «estado neutro» en la foundation | el lienzo no dibuja ese chip: 43001 no tiene productor en vivo y el maestro decidió no dibujarlo, nunca como un cero. En el escritorio el plegado sí lo mapea (`PanelRow.tsx:18`, `requested: "Solicitado"`) pero lo pinta como texto de celda, sin chip ni color |
| 17 | «No disponible» (modelo y coste ausentes) | `--color-border-default` discontinuo + `--color-text-secondary` | **inexacto**: no hay token de ausencia declarada | el escritorio usa texto apagado sin borde discontinuo: `PanelRow.tsx:61` (`text-sm text-muted-foreground` «Sin señal»), `:62`, y `:149` («sin padre registrado»); el discontinuo vive en el vacío de sección (`PanelEmptyState.tsx:12`, `border-dashed`) |
| 18 | Carga (esqueleto) | `--color-surface-sunken` (mismo valor que la columna) + `--radius-sm` | exacto en valor; rol «carga» sin token propio | el esqueleto **no** usa el hundido: `skeleton.tsx:14` (`t-skel-bar rounded-md bg-primary/10`, pulsante). El tamaño va por clases, no por token: `PanelLoadingState.tsx:25` (`h-3.5 w-32`) |
| 19 | Banda de fixture ilustrativo | `--color-feedback-warning` + bg | **inexacto en rol**: marca de procedencia, no aviso de sistema | el handoff no nombraba path para esta banda, y buscarla por `fixture` en `desktop/src/features/{tower,panel}` no devuelve nada (§3, comando 4). El análogo más cercano es la banda de aviso `MemorySection.tsx:224` (`border-warning/30 bg-warning/5`); la marca de datos viejos del panel va en `Alert` neutro y con palabras: `PanelErrorState.tsx:62` |
| 20 | Tipografía: familias y pesos | `--font-sans`, `--font-mono`, `--font-weight-body` 400, `--font-weight-label` 500, `--font-weight-heading` 600, `--font-weight-bold` 700 | exacto en token; **inexacto en render**: el dialecto del gate no admite recursos externos, DM Sans no se carga y cae al fallback | `tailwind.config.js:77` (`"Inter Variable"`) y `theme.css:155` (`font-family: "Inter Variable", Inter, …`) — el escritorio declara **Inter**, no DM Sans; `font-mono` en `PanelRow.tsx:80`; pesos en `badge.tsx:7` (`font-semibold`) |
| 21 | Escala tipográfica | `--text-body-size` 1rem, `--text-heading-1-size` 1.75rem, `--text-heading-3-size` 1.1875rem, `--text-heading-4-size` 1rem, `--text-heading-5-size` 0.8125rem, `--text-supporting-size` 0.8125rem | **inexacto en un punto**: heading-4 y cuerpo miden lo mismo; la jerarquía del título de tarjeta se apoya en el peso | `text-2xs` = `tailwind.config.js:12` (`calc(var(--buzz-type-rem) * 0.6875)` = 11px) → **hueco de foundation**: valor 11px, paso más cercano `--text-supporting-size` 0.8125rem (13px). El escritorio tiene además `text-xs` 12px (`alert.tsx:7`), `text-sm` 14px (`PanelRow.tsx:127`) y `text-2xl` 24px (`PageHeader.tsx:28`), ninguno con paso en la foundation |
| 22 | Interlineados | `--text-body-leading` 1.5rem, `--text-supporting-leading` 1.25rem, heading-1/3/4/5 | exacto | `leading-4` `alert.tsx:39`, `leading-5` `alert.tsx:50`, `leading-none` `badge.tsx:7`; los tres pasos están reescritos sobre el rem virtual en `tailwind.config.js:41-46` |
| 23 | Radios | `--radius-lg` 8px, `--radius-md` 6px, `--radius-full` 9999px, `--radius-sm` 4px | exacto; nota: `--radius-xs` = `--radius-sm` (4px), dos nombres un valor | `rounded-2xl` = 16px (`tailwindcss/theme.css:402` de la dependencia instalada; **no** hay override en `tailwind.config.js:62-66`) → **hueco de foundation**: valor 16px, paso más cercano `--radius-lg` 8px. `rounded-xl` = 12px (`:401`) tampoco tiene paso. `rounded-md` sí se reescribe: `tailwind.config.js:64` = `--radius` − 2px = 8px (`--radius` = 0.625rem = 10px, `theme.css:4`) |
| 24 | Sombra de tarjeta y zona | `--shadow-subtle` | exacto | la tarjeta compartida: `card.tsx:54` (`shadow-xs`); el lienzo de app: `BuzzThemeSurfaces.tsx:38` (`shadow-content-edge`, definida en `tailwind.config.js:50`). El contenedor de la lista del panel **no** lleva sombra (§3, comando 3): la zona se separa por borde |
| 25 | Hueco entre columnas y entre bloques | `--space-section-gap` 1.5rem | **inexacto**: un paso para dos escalas (columnas del lienzo y secciones de página) | en el escritorio son **dos** escalas distintas: secciones de página `gap-6` = 1.5rem (`TowerScreen.tsx:18`), que coincide con `--space-section-gap`; rejilla interna `gap-2` 0.5rem / `sm:gap-3` 0.75rem (`panelLayout.ts:8`). `gap-1.5` = 0.375rem (`PanelErrorState.tsx:20`) → **hueco de foundation**, sin paso |
| 26 | Hueco interno de tarjeta y entre campos | `--space-component-gap` 0.5rem | exacto | `gap-2` `panelLayout.ts:8` = 0.5rem: exacto. `gap-0.5` 0.125rem (`PanelRow.tsx:60`) no tiene paso |
| 27 | Relleno (tarjeta, chip, celda, botón) | `--space-component-padding-y` 0.5rem / `--space-component-padding-x` 0.75rem | exacto | `px-3` `panelLayout.ts:8` = 0.75rem: exacto en X. En Y el escritorio trabaja más fino: `py-2.5` 0.625rem (`panelLayout.ts:8`) y `py-1.5` 0.375rem (`PanelList.tsx:58`) → **hueco de foundation**: valor 0.375rem, paso más cercano `--space-component-padding-y` 0.5rem |
| 28 | Margen de página | `--space-page-margin` 1.5rem | exacto | `TowerScreen.tsx:18`: `px-4 py-6 sm:px-6` — el margen de la foundation (1.5rem) es el de `sm` en adelante; en móvil baja a 1rem, sin paso |

## 1bis. Los nueve pasos del handoff, resueltos (comando y salida en el informe)

| Clase observada por el diseñador | Resuelve a | Cómo |
|---|---|---|
| `muted-foreground` | `tailwind.config.js:105` → `--muted-foreground` `theme.css:16` (claro) / `:82` (oscuro) | color del tema, `hsl(var(--muted-foreground))` |
| `border` | `tailwind.config.js:115` → `--border` `theme.css:31` / `:97`; borde por defecto de todo elemento en `theme.css:119` | color del tema |
| `card` | `tailwind.config.js:88` → `--card` `theme.css:7` / `:73`; consumido en `card.tsx:54` y `PanelList.tsx:40` | color del tema |
| `text-2xs` | `tailwind.config.js:12` = `calc(var(--buzz-type-rem) * 0.6875)`, con `--buzz-type-rem` en `typography.css:17` | **hueco de foundation** (11px; más cercano `--text-supporting-size` 13px) |
| `rounded-2xl` | 1rem = 16px, por defecto de Tailwind (`tailwindcss/theme.css:402`); `tailwind.config.js:62-66` no lo reescribe | **hueco de foundation** (16px; más cercano `--radius-lg` 8px) |
| `py-1.5` | 0.375rem, por defecto de Tailwind (`--spacing: 0.25rem`, `tailwindcss/theme.css:325`) | **hueco de foundation** (0.375rem; más cercano `--space-component-padding-y` 0.5rem) |
| `gap-1.5` | 0.375rem, mismo defecto; usado en `PanelErrorState.tsx:20` | **hueco de foundation** (0.375rem; más cercano `--space-component-gap` 0.5rem) |
| `Badge variant="warning"` | variante en `badge.tsx:16`; consumida en `PanelRow.tsx:74` y en 6 ficheros más (10 llamadas en total) | **no** pasa por el token `warning` del tema: pinta la paleta Tailwind amber |
| `Alert variant="destructive"` | variante en `alert.tsx:12` → `--destructive` `theme.css:29`; consumida en `PanelErrorState.tsx:22` | token del tema, en opacidad `/10` |

Los dos `tailwindcss/theme.css:…` de esta tabla son de la **dependencia instalada**
(Tailwind 4.3.0, declarada en `desktop/package.json:106`), no ficheros de `main`:
son los valores por defecto que el tema del escritorio **no** reescribe, y por eso
donde aparecen la fila es un hueco y no un token. Los cuatro huecos lo son por
ausencia de paso en la foundation, no por ausencia de valor en el escritorio.

Dos avisos de lectura, para que nadie los lea de más:

- La columna «Exactitud del match» compara **rol ↔ token de la foundation**; la
  última columna compara **clase de escritorio ↔ token del tema de escritorio**.
  Que casi ningún valor coincida entre ambas no contradice la segunda columna: es
  el tema del escritorio (Catppuccin Latte/Macchiato, `theme.css:3`), no una
  desviación de la foundation.
- Los hex de la tabla son conversión mía del `hsl()` declarado, no valores
  escritos en el fichero. La conversión cae en la paleta que el propio comentario
  del fichero nombra (Catppuccin Latte/Macchiato), lo que la corrobora pero no la
  convierte en fuente.

## 2. Los matches inexactos, por clase (13 filas marcadas)

Trece filas llevan marca en negrita (5, 9, 10, 11, 12, 13, 14, 16, 17, 19, 20, 21, 25), agrupadas por clase de inexactitud porque la clase es lo que se hereda como decisión:

- **A. El conjunto no nombra el rol (filas 9, 11, 12, 14, 16, 17, 19).** Texto apagado, el acento de marca nombrado y no usado, y los estados de ciclo de vida que el lienzo dibuja «trabajando/entregado/cancelado/falló», «no disponible» y la marca de fixture: la foundation no tiene tokens de ciclo de vida, de ausencia ni de procedencia. Consecuencia heredable: **el significado lo carga el texto visible, nunca el color**; si un chip pierde su palabra, la fila deja de ser defendible. **Comprobado en el escritorio en la pasada (2):** los cinco estados del ciclo de vida van en texto (`PanelRow.tsx:18-22`) y las dos variantes de chip que sí existen (`success`, `info`) no tienen una sola llamada.
- **B. Token correcto por valor, otro por semántica (filas 5, 13, 20-render).** El alfa de pelo fino como separador de bloque; «entregado» con token de feedback; DM Sans declarada y no cargada.
- **C. Escalas con un escalón de menos (filas 21, 25).** Heading-4 = cuerpo (1rem), así que la jerarquía se apoya en el peso; `section-gap` sirve a dos escalas (columnas del lienzo y secciones de página).
- **D. Dos nombres, un valor (fila 10).** `text-link` = `text-primary`: un enlace no se distingue del texto por color y solo lo separa el subrayado. La misma nota vale para la 9 (`text-muted` = `text-secondary`) y la 23 (`radius-xs` = `radius-sm`), que van declaradas sin marca.
- **Nota fuera de las trece (filas 18 y 23, sin marca en negrita porque el valor coincide):** el escritorio usa pasos que la foundation **no** tiene — `text-2xs`, `rounded-2xl` (16px, mayor que el radio máximo de la foundation, 12px), `py-1.5` y `gap-1.5`. No es un defecto del prototipo: es el límite del conjunto, y no se tapa con tokens nuevos. **La pasada (2) añade dos pasos más del mismo tipo**, que el handoff no nombraba: `text-xs` (12px) y `text-sm` (14px), que son los tamaños dominantes de la superficie.

## 3. Qué demuestra esta tabla y qué no

- **Demuestra:** qué token de la foundation usa cada rol de la superficie, auditado (§1) contra el `foundation_block` devuelto hoy, sobre la lectura íntegra que hizo @diseno de la revisión entonces vigente (`e9970382…`, 51.198 caracteres). El lienzo que **esta PR** entrega es `a91fb3cc…` / 49.795 caracteres (el mismo fichero en las dos rutas, byte a byte); respecto de la revisión auditada, esta PR retiró el chip «pedido» y reescribió el comentario de cabecera, así que la comprobación de los 28 roles hay que re-correrla sobre el fichero entregado, no darla por heredada. Re-verificable con `grep` sobre el HTML. Y, desde la pasada (2), a qué `fichero:línea` de `main` (`ab63b0129`) resuelve cada paso de escritorio de las 28 filas —o, en los cuatro que no tienen paso en la foundation, a su valor observado y su hueco—, con el comando y su salida en `reports/tower-grafo-s1-tokens-desktop.md`.
- **No demuestra:** que la superficie de S1 se *vea* como el prototipo (nadie la ha renderizado), ni el contraste de los pares de color, ni el teclado. La pasada (2) lee tokens, no píxeles. La puerta del 3% (contraste, teclado, render) sigue exactamente donde la dejó la entrega anterior.

## 4. Handoff

- **Al revisor (PR #11):** la columna que faltaba está cerrada. Los `fichero:línea` son de `main` = `ab63b0129`, no de la rama: verificar contra ese commit, no contra el tip del PR.
- **Una decisión que la pasada (2) abre y no cierra:** `Badge variant="warning"` pinta la paleta Tailwind (`badge.tsx:16`) y **no** el token `warning` del tema, que existe y se usa en otros sitios. Si el chip del 43008 debe heredar el token (y con él el acento adaptativo de la comunidad), es un cambio de una línea en `badge.tsx` — pero sale del contrato de esta tabla y no lo he hecho.
- **Si el maestro quiere esta nota dentro del PR:** hoy vive en el almacén del piloto, como todas las notas de diseño anteriores; el PR #11 solo lleva el prototipo porque el revisor tenía que poder abrirlo. Meterla en el repo crearía un `design/` de primer nivel que hoy no existe; no lo he decidido yo.
- **Para la slice siguiente:** 43008 («espera») ya se emite en vivo (27 eventos, `tower-grafo-live-kindcheck.md`) y su único precedente de escritorio es `Badge variant="warning"` (`PanelRow.tsx:74`). Cuando entre, necesitará su propia fila en esta tabla y probablemente su propio rol de color.

**Confianza:** alta en la columna de la foundation (mi lectura, verificable por grep); **alta en la última columna**, que ahora es de @coder con comando y salida por fila sobre `ab63b0129`; media en que los candidatos del patch sigan siendo el estado del escritorio (es una propuesta, no lo vi mergeado — aunque los ficheros `Panel*.tsx` que citaba **sí están en `main`**, con las mismas clases).
