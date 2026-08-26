# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Estudiantes del IPN que consultan SAES y necesitan comparar grupos antes de reinscribirse, revisar su información académica y reducir tareas repetitivas sin delegar decisiones sensibles.

## Product Purpose

MI SAES 2.0 añade herramientas locales sobre las páginas existentes de SAES. La primera herramienta permite construir y comparar propuestas de horario antes de la inscripción, detectar empalmes y conservar o exportar elecciones.

## Positioning

La extensión interpreta los datos visibles de SAES y los convierte en herramientas independientes dentro de un panel propio; no sustituye el sitio, no automatiza la inscripción y no envía datos escolares a servidores externos.

## Operating Context

Se usa dentro de Chrome mientras el estudiante consulta horarios, ocupabilidad, calendarios, evaluaciones y páginas autenticadas de SAES. La oferta de horarios contiene alternativas de grupo, materia y profesor que deben compararse antes de formar una propuesta.

## Capabilities and Constraints

- Extensión Chrome Manifest V3 sin dependencias remotas.
- Conserva intactos colores, tamaños, distribución y navegación del SAES original.
- La interfaz propia es únicamente clara; no incluye modo oscuro.
- Guarda preferencias, catálogos y selecciones sólo en `chrome.storage.local`.
- Puede escanear bajo demanda los turnos, planes y periodos de la carrera seleccionada mediante consultas secuenciales de sólo lectura a la misma página de SAES.
- Puede combinar materias de distintos periodos y turnos, buscar, seleccionar alternativas, detectar empalmes, guardar una propuesta para reinscripción y exportar datos.
- Puede consultar opcionalmente la ocupabilidad oficial y sugerir alternativas con lugares cuando un grupo está lleno.
- Nunca resuelve CAPTCHA, guarda credenciales, pulsa el envío de evaluaciones ni ejecuta inscripción o reinscripción.

## Brand Commitments

- Nombre: MI SAES 2.0.
- Identidad profesional basada en el guinda institucional del IPN, presentada siempre como proyecto independiente.
- La utilidad y la claridad operativa tienen prioridad sobre cambios decorativos.

## Evidence on Hand

- Capturas reales de Horarios de clase de ESIME Culhuacán antes y después de usar MODS SAES.
- Tabla real con Grupo, Asignatura, Profesor, Edificio, Salón y días de la semana.
- Código local y fuentes abiertas de extensiones de horarios usadas sólo para estudiar selectores y flujos.

## Product Principles

- Mantener SAES intacto y concentrar las mejoras en herramientas propias.
- Explicar la diferencia entre oferta académica, propuesta y horario inscrito.
- Mantener al estudiante al mando de cualquier acción con consecuencias académicas.
- Hacer que conflictos, alternativas y estados incompletos sean visibles antes de exportar.
- Conservar los datos en el navegador y pedir los permisos mínimos.

## Accessibility & Inclusion

La interfaz debe operar con teclado, mantener foco visible, anunciar cambios relevantes y funcionar en ventanas estrechas sin depender sólo del color.
