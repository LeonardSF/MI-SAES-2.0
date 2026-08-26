# Contribuir a MI SAES 2.0

Gracias por ayudar a que MI SAES 2.0 sea más claro, seguro y compatible con más planteles.

## Antes de comenzar

- Revisa los Issues abiertos y evita duplicar trabajo
- Para cambios amplios abre primero una propuesta breve
- Mantén el proyecto independiente del IPN y no uses identidad institucional como si fuera oficial
- Nunca adjuntes capturas, HTML o registros con nombre, boleta, calificaciones, cookies o datos de sesión reales

## Preparar el proyecto

El proyecto usa Node.js 20 o superior y no necesita instalar dependencias.

```bash
git clone https://github.com/LeonardSF/MI-SAES-2.0.git
cd MI-SAES-2.0
npm test
npm run check
```

Carga la carpeta como extensión descomprimida desde `chrome://extensions` para revisar los cambios dentro de una sesión propia.

## Flujo recomendado

1. Crea una rama enfocada en un solo cambio
2. Añade un fixture mínimo y anónimo cuando cambie un parser
3. Escribe o ajusta la prueba que demuestra el comportamiento
4. Ejecuta `npm test` y `npm run check`
5. Explica el impacto visible y las páginas SAES verificadas en el pull request

## Datos de prueba

Usa nombres como `PERSONA DOCENTE UNO` y boletas como `2026000000`. Reduce las páginas HTML al fragmento indispensable para reproducir el caso.

No se aceptarán credenciales, CAPTCHA, cookies, tokens, expedientes ni información académica real aunque ya aparezcan en una página pública.

## Alcance técnico

- Conserva JavaScript, HTML y CSS nativos salvo que exista una razón revisada para añadir una dependencia
- Mantén `storage` como único permiso normal y limita el acceso de host a `*.ipn.mx`
- No añadas código remoto, telemetría ni servicios que reciban información escolar
- No automatices evaluaciones docentes, inscripción o reinscripción
- Conserva navegación por teclado, foco visible y estados que no dependan sólo del color

## Reportes de seguridad

Consulta [SECURITY.md](SECURITY.md) y usa el canal privado para vulnerabilidades. Un Issue público es adecuado para errores funcionales que no expongan información sensible.

Al enviar una contribución aceptas que se publique bajo la [licencia MIT](LICENSE).
