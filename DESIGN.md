# Diseño — MI SAES 2.0

## Modo

Operate. La interfaz existe para comparar grupos y cerrar una propuesta de horario con el menor cambio de contexto posible.

## Dirección

Mesa de trabajo académica clara, compacta y serena. El guinda IPN identifica acciones y selección; verde, ámbar y rojo se reservan para compatibilidad, cupo y conflictos. MI SAES mantiene una identidad independiente y nunca modifica la presentación del SAES original.

## Composición

- Cabecera de producto compacta con contexto y versión.
- Estado de oferta y ocupabilidad en una franja operativa única.
- Escritorio de dos columnas: oferta flexible y selección estable.
- Calendario a ancho completo como comprobación antes de guardar.
- En ventanas estrechas, el flujo se apila en el mismo orden: oferta, selección y calendario.

## Tipografía

- UI y títulos: IBM Plex Sans.
- Marca y datos breves: IBM Plex Mono.
- Los controles y datos densos priorizan legibilidad; no se usan fuentes decorativas.

## Color

Los valores canónicos viven en `tokens.css`. La interfaz es exclusivamente clara. Los fondos de estado son tenues y siempre incluyen texto explícito; el color no es la única señal.

## Espaciado y forma

- Escala base de 4 px mediante tokens semánticos.
- Radios moderados; píldoras sólo para filtros, etiquetas y contadores.
- Una sola capa de borde o elevación por superficie.
- La densidad se obtiene reduciendo redundancia, no reduciendo objetivos táctiles.

## Movimiento

Transiciones de 120–220 ms únicamente para cambios de estado y apertura del panel. `prefers-reduced-motion` elimina el desplazamiento espacial.

## Accesibilidad

Foco visible, controles de al menos 44 px cuando la entrada es táctil, nombres accesibles, estados anunciados y composición funcional desde 320 px.

## Restricciones permanentes

- Sin modo oscuro.
- Sin rediseñar el SAES original.
- Sin automatizar inscripción o reinscripción.
- Sin credenciales ni datos escolares fuera del navegador.
