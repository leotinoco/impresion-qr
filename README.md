# Impresión QR — Generador de PDF para Mesas

Aplicación web local, rápida y sin instalaciones que toma imágenes cuadradas con códigos QR y genera automáticamente un archivo **PDF listo para imprimir, cortar y doblar** (formato tipo hablador/caballete de mesa).

## Cómo abrir y usar

No requiere instalar Node.js, Python ni servidores. Funciona **100% offline** directamente en tu navegador:

1. Haz doble clic en **`index.html`** (o en **`Abrir.bat`** en Windows).
2. Haz clic en **Seleccionar imágenes** o arrastra tus archivos QR (`PNG`, `JPG` o `WebP`).
3. Revisa la vista previa hoja por hoja (puedes reordenar, duplicar o eliminar tarjetas).
4. Haz clic en **Descargar PDF** (o en **Abrir / Imprimir**).

## Formato del PDF generado

Por defecto utiliza el formato exacto de hoja de impresión para caballetes de mesa:

- **Hoja:** Carta Horizontal (`27.9 × 21.6 cm` / `11 × 8.5 in`) — también soporta A4 Horizontal en *Ajustes de formato*.
- **Distribución:** Hasta **3 tarjetas por hoja** organizadas en 3 columnas × 2 filas.
- **Fila superior:** Rotada automáticamente **180°**, de modo que al cortar verticalmente y doblar por la mitad horizontal, ambos lados quedan derechos.
- **Fila inferior:** Orientación normal (`0°`).
- **Calidad:** Cada imagen se incrusta en alta resolución una sola vez por archivo (manteniendo el PDF nítido y liviano).
- **Opcional:** Desde *Ajustes de formato* puedes activar guías suaves de corte y doblez, centrar verticalmente o ajustar las separaciones.

## Estructura del proyecto

```text
impresion-qr/
├── index.html          # Interfaz principal (doble clic para abrir)
├── styles.css          # Estilos de la aplicación y vista previa
├── app.js              # Lógica de carga, vista previa WYSIWYG y generación de PDF
├── lib/
│   └── pdf-lib.min.js  # Librería local para generar PDF sin conexión
└── Abrir.bat           # Acceso rápido para Windows
```
