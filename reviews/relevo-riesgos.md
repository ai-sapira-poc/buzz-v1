# Riesgos del relevo — revisión a ciegas

Derivados del requisito literal; NO he leído product/, innovation/ ni
architecture/relevo-*. Los "tests" son los que deben existir: aún no hay artefacto.

**R1 Estado contaminado: `run.status=blocked` inventado.** Nadie pinta un estado
sin productor. Se vería como «bloqueado, necesita input» en un run solo
idle/terminado. Detección: trazar cada estado visible hasta su productor;
visible ⊆ producido. Test: quitada la lista blanca de lo producido, el panel pinta
«blocked» fabricado → falla.

**R2 Superficie que miente: vacío vs error vs cargando.** Un fetch que falla (o
historial frío) da [] y pinta «Ningún relevo», indistinguible de «no hay» y de
«cargando». Detección: forzar reject y exigir estado de error con texto y
reintento. Test: el que hace reject y exige error; con error→[] pasa en falso.

**R3 Widget en vez de canal.** Un «handoff widget» que no publica en la
maquinaria nativa: no aparece en el canal, no abre hilo, no lleva `p` al
receptor, nadie lo recibe. Detección: crear un relevo y leerlo como mensaje
nativo. Test: E2E que exige el evento con `h` de canal, raíz de hilo y `p` del
destino; sin él el widget pasa.

**R4 La UI aprende Relay/Nostr/kinds.** Literal `kind: 4xxxx`, filtro o `#h` en
`desktop/src/features/`. Se rompería al cambiar el kind. Detección: guard de
lint/grep: features/ no importa relay ni kind. Test: ese guard; quitarlo admite el
literal.

**R5 Botón que no hace nada («Interrumpir»).** El requisito es poder interrumpir.
Botón que solo cambia estado local, o un cancel que la maquinaria ignora.
Detección: pulsarlo a mitad de run y ver que el run se detiene. Test: E2E inicia
run, interrumpe, afirma cancelación mecánica (no un toast).

**R6 HTTP en vez de evento.** POST /handoffs: pierde fan-out, scoping NIP-29 y
auth; solo lo ve quien hace polling. Detección: comparar rutas con el registro de
kinds. Test: exige visibilidad en tiempo real; si solo llega por polling, falla.

**R7 Texto en px (zoom muerto).** `text-[13px]` congela el texto ante Cmd +/-.
Detección: `cd desktop && pnpm check:px-text`. Test: ese check; quitarlo admite el
literal.

No ejercí (no hay artefacto): UI real, feedback <400ms, carga y accesibilidad del
componente nuevo. Riesgo abierto, no cubierto.
