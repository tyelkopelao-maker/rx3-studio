# RX3 Studio

Editor web local para RX3 de FIFA 16 Mobile.

## Funciones
- Lee cabecera RX3 y tabla de chunks.
- Relaciona `NAME_TABLE`, `TEXTURE_BATCH` y los cinco chunks `TEXTURE`.
- Decodifica y codifica texturas RGBA32, DXT1 y DXT5.
- Reemplaza individualmente `crest_cm`, `jersey_cm`, `jersey_coeff`, `shorts_cm` y `shorts_coeff`.
- Regenera mipmaps, actualiza dimensiones, tabla batch, tamaños y offsets.
- Mantiene los chunks no relacionados con texturas.
- Procesamiento en el navegador, sin subir archivos.

## Resolución
El lado mayor de cada textura se amplía hasta 1024 px y se conserva la relación de aspecto original para no alterar el mapeado UV. Una textura cuadrada se exporta a 1024x1024.

## Publicación
Subir el contenido de esta carpeta a un repositorio GitHub y activar GitHub Pages (Deploy from branch / main / root), o publicarlo en Cloudflare Pages.

## Nota
La aplicación valida de nuevo la estructura RX3 antes de descargar. Aun así, se debe probar el resultado dentro del juego antes de reemplazar archivos originales. La compresión DXT usa un encoder sencillo y puede generar pequeñas diferencias visuales.
