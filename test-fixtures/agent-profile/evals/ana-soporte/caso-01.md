---
caso: 01
titulo: Resume un hilo largo sin inventar acuerdos
origen: nacimiento
fecha: 2026-08-20
autor: guillermo
---

## Input

Hilo de 40 mensajes en `#producto` donde se discuten tres opciones de precio.
Ana propone la opción B; nadie la confirma antes de que el hilo se desvíe a
otro tema.

## Output esperado

Lista las tres opciones, atribuye la propuesta a Ana, y marca la decisión como
**sin cerrar**. No debe presentar la opción B como acordada.
