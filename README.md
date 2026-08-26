# MI SAES 2.0

Extensión de Chrome Manifest V3 para mejorar la experiencia del Sistema de Administración Escolar del IPN. Funciona como una capa local sobre SAES: no reemplaza al sistema oficial, no usa una cuenta propia y no envía datos escolares a servidores externos.

## Herramienta principal: Arma tu Horario

- Lee la oferta visible de `Academica/horarios.aspx` sin modificar la tabla de SAES.
- Escanea bajo demanda todos los turnos, planes y periodos de la carrera seleccionada, respetando el modo Actual/Próximo elegido en SAES.
- Une filas complementarias de la misma materia y grupo, incluso cuando aparecen varios profesores.
- Permite combinar materias de distintos periodos y turnos —por ejemplo 4.º y 6.º o clases matutinas y vespertinas— cuando no se traslapan.
- Marca en verde los grupos compatibles y en rojo los que provocan un traslape, indicando materia, día y horario exacto.
- Genera hasta 30 propuestas eligiendo una alternativa por materia y descartando empalmes reales por intervalo.
- Muestra cada propuesta en un calendario semanal y permite cambiar entre resultados.
- Exporta la propuesta elegida o el horario personal como calendario `.ics` con fecha de inicio y duración configurables.
- Guarda una propuesta como “Horario preparado” y la muestra durante la reinscripción como guía de captura, sin marcar ni enviar materias automáticamente.
- Puede consultar en segundo plano el reporte oficial de Ocupabilidad cada 2 minutos y mostrar Cupo, Inscritos y Disponibles por grupo.
- Si un grupo seleccionado está lleno, bloquea la generación y propone hasta tres alternativas de la misma materia, priorizando lugares disponibles y ausencia de traslapes.

## Funcionamiento

- Panel independiente dedicado a **Arma tu Horario** que no modifica colores, tamaños ni distribución del SAES original.
- Compatibilidad por detección con páginas SAES alojadas bajo `*.ipn.mx`.
- Atajo `Alt + M` para abrir o cerrar el panel.

## Instalar para desarrollo

1. Abre `chrome://extensions` en Chrome.
2. Activa **Modo de desarrollador**.
3. Pulsa **Cargar descomprimida**.
4. Selecciona esta carpeta: `MI SAES`.
5. Abre el SAES de tu plantel y busca el botón **MI** en la esquina inferior derecha.

También puedes descomprimir el ZIP generado en `dist/` y cargar la carpeta resultante. Chrome no instala directamente un ZIP en modo desarrollador.

## Verificación

```bash
npm test
npm run check
npm run package
```

No hay proceso de compilación ni dependencias npm. Todo el JavaScript que ejecuta la extensión está incluido en el repositorio.

## Permisos

La extensión declara `storage` para preferencias, catálogos escaneados y selecciones locales. El acceso de host se limita a `*://*.ipn.mx/*` para consultar secuencialmente las variantes de Horarios dentro de la sesión activa; no se conecta a servidores de MI SAES. Antes de inyectar el panel independiente, el código comprueba que la página sea realmente SAES. La extensión no reemplaza ni rediseña la interfaz original.

## Alcance y límites actuales

- La página pública de ESIME Culhuacán fue verificada durante el desarrollo.
- Las pantallas autenticadas pueden variar entre planteles. Los lectores de tablas evitan selectores rígidos y se basan en encabezados y contenido visible, pero necesitan QA con sesiones reales de distintos planteles.
- El detector de empalmes informa el día, el intervalo exacto y ambos grupos; no sustituye la validación oficial de disponibilidad o inscripción.
- MI SAES 2.0 no resuelve CAPTCHA y nunca solicita ni almacena contraseñas.

## Identidad

La interfaz usa como ancla el guinda institucional `#750946` descrito en el Manual de Identidad Gráfica del IPN 2026. MI SAES 2.0 es un proyecto independiente y no está afiliado oficialmente al Instituto Politécnico Nacional.
