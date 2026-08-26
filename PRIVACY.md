# Política de privacidad de MI SAES 2.0

Última actualización: 26 de agosto de 2026.

MI SAES 2.0 funciona localmente dentro del navegador. No opera servidores propios, no crea perfiles de usuario y no vende, comparte ni transmite información personal o escolar.

## Datos que no se recopilan

- Usuario, contraseña o CAPTCHA de SAES.
- Historial académico para uso externo.
- Contenido de evaluaciones docentes para análisis o publicidad.
- Historial de navegación fuera de páginas SAES compatibles.
- Identificadores publicitarios, telemetría o analítica.

## Datos almacenados localmente

La extensión usa `chrome.storage.local` para conservar:

- Preferencias del planificador.
- Grupos candidatos elegidos en el planificador de horarios.
- Catálogo de horarios escaneado y propuesta guardada para reinscripción.
- Última tabla de ocupabilidad consultada y hora de actualización.

Estos datos permanecen en el perfil local de Chrome. Al desinstalar la extensión, Chrome puede eliminarlos conforme a su comportamiento estándar.

## Procesamiento de páginas SAES

La extensión lee el contenido visible de tablas y formularios. Cuando el usuario pulsa “Escanear periodos y turnos”, realiza solicitudes secuenciales a la misma página de SAES para consultar las combinaciones de Carrera, Turno, Plan y Periodo. Si el usuario activa “Mostrar lugares disponibles”, consulta el reporte oficial de Ocupabilidad de la misma carrera y plan cada dos minutos mientras la pestaña siga abierta. Usa la sesión activa únicamente con SAES y almacena localmente el último catálogo y la última ocupabilidad. La extensión no pulsa botones de inscripción.

## Permisos

- `storage`: guarda preferencias, selecciones, catálogos y ocupabilidad en el navegador.
- Acceso declarado a `*://*.ipn.mx/*`: permite funcionar y consultar horarios dentro de los distintos subdominios usados por planteles del IPN. No permite acceso a sitios externos. El script termina sin inyectar interfaz cuando la página no se identifica como SAES.

## Independencia

MI SAES 2.0 no está afiliado, respaldado ni publicado oficialmente por el Instituto Politécnico Nacional.
