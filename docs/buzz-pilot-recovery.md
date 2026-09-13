# Recuperación del piloto Sapira — 6 de septiembre de 2026

Estado: prueba en curso; no constituye una validación completa de autonomía.

Los informes del adaptador Hermes incluían nombres con `@`. Buzz los resolvía
como menciones y activaba nuevos turnos. Una respuesta del editor interrumpió al
maestro y produjo dos planes para una misma petición. Se detuvieron los 14
procesos `native_entry.py` del piloto, verificando después su ausencia. No se
detuvieron agentes ajenos al piloto ni se modificaron servicios de Railway.

Se conservaron las seis tareas del primer plan
`acp-ec8a2ec9fb0047a386d9ba9f2fdbded7` y se cancelaron las siete tareas todavía
en cola del plan duplicado `acp-1e33d6e909274176b430c43564aa38b8`. El registro
`report-loop-recovery` del SQLite privado conserva la intervención y su motivo.

El publicador compartido por ACP y el ejecutor de cola neutraliza `@` y los
URI `nostr:` en los informes. La delegación explícita sigue siendo una operación
separada. La prueba real en el canal privado `limonada-lab` de Sapira produjo el
evento `fbab79f0ed82900744748cca57d2e21f89c82cdf669ce59ccea73c830ad10b38`,
aceptado por el relay con `mention_pubkeys: []`. Los siete controles locales
pasan; no sustituyen las pruebas de capacidades con Hermes.

Pendiente: probar otra vez el ciclo nativo completo, correlacionar y deduplicar
mandatos entrantes, verificar los artefactos con navegador y revisión
independiente, completar el acceso aislado a Linear y las rondas de aprendizaje.
Las afirmaciones previas de validación escritas por agentes no se consideran
resultados aprobados sin sus correspondientes pruebas observables.
