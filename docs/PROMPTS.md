# Prompts para crear fondos y personajes con ChatGPT

Antes de empezar, abre el juego (`npm start`) y entra a **http://localhost:3000/plantillas.html**.
Desde ahí descargas las imágenes de referencia que se suben a ChatGPT junto con tu imagen.

---

## 1. Fondo (escenario)

**Sube a ChatGPT 2 imágenes, en este orden:**
1. `referencia-estilo-fondo.png` (de la página de plantillas)
2. La imagen que quieres convertir en fondo

**Prompt:**

```text
Te adjunto dos imágenes.
- Imagen 1: REFERENCIA DE ESTILO. Es el fondo actual de mi videojuego.
- Imagen 2: el LUGAR / TEMA que quiero.

Crea un fondo nuevo para un videojuego 2D de pelea que muestre el lugar de la Imagen 2,
dibujado con exactamente el mismo estilo visual de la Imagen 1.

FORMATO
- Imagen horizontal 16:9 (1600 x 900 px o lo más cercano posible).

ESTILO (igual a la Imagen 1)
- Ilustración vectorial plana, formas simples y limpias, SIN contornos negros.
- Profundidad con capas de siluetas superpuestas: cielo al fondo, elementos lejanos más claros
  y desaturados, capas cercanas más oscuras.
- Cielo con degradado suave. Paleta limitada de 5 a 7 colores armónicos.
- Sin texturas, sin ruido, sin detalle fotográfico ni realista, sin brillos complicados.
- Un elemento focal grande y simple en el centro-arriba (como la luna de la Imagen 1:
  un sol, una luna, un astro, un edificio emblemático, etc.).

COMPOSICIÓN (muy importante, el juego dibuja cosas encima)
- La franja inferior (el 12 % de abajo de la imagen) debe ser lisa, de un solo tono oscuro y sin
  detalles: ahí el juego dibuja el suelo.
- No dibujes plataformas, suelo detallado, personajes, animales en primer plano, texto, logos,
  marcos ni interfaz.
- La zona central, donde pelean los personajes, con poco detalle y poco contraste.
- Los elementos altos (árboles, torres, edificios) van hacia los bordes izquierdo y derecho.
- Las esquinas de arriba, despejadas (ahí van los marcadores de vida).
- Colores un poco apagados para que los personajes resalten encima.
```

**Si sale mal, pídele por ejemplo:**
- "Hazlo más simple y plano, con menos detalle, como la Imagen 1."
- "Deja la franja de abajo lisa y oscura, sin objetos."
- "Quita los personajes / el texto."

**Para agregarlo:** en la página de plantillas, sección **4 · Probar un fondo**, elige la imagen,
ajusta el color del suelo para que combine y sigue las 2 instrucciones que aparecen
(copiar la imagen a `public/fondos/` y pegar la línea en `public/catalog.json`).

---

## 2. Personaje (sprite sheet)

**Sube a ChatGPT 2 imágenes, en este orden:**
1. `plantilla-personaje.png` (de la página de plantillas)
2. La imagen de tu personaje

**Prompt:**

```text
Te adjunto dos imágenes.
- Imagen 1: PLANTILLA de sprite sheet de mi videojuego (cuadrícula de 4 x 6 con un ninja de ejemplo).
- Imagen 2: el PERSONAJE que quiero usar.

Crea el sprite sheet del personaje de la Imagen 2 con EXACTAMENTE la misma distribución de la
Imagen 1: una cuadrícula invisible de 4 columnas por 6 filas, una pose por celda, en este orden
(fila.columna). El personaje lleva una ESPADA propia (katana, sable, etc., la que combine con él).

Fila 1 – PARADO (respirando, 4 cuadros casi iguales que suben y bajan un poco; espada envainada):
  1.1 parado · 1.2 parado · 1.3 parado · 1.4 parado
Fila 2 – CORRIENDO (ciclo de carrera de 4 cuadros):
  2.1 pierna derecha adelante · 2.2 piernas juntas · 2.3 pierna izquierda adelante · 2.4 piernas juntas
Fila 3 – SALTO y GOLPE:
  3.1 saltando hacia arriba (rodillas recogidas, brazos arriba)
  3.2 en la cima del salto (hecho bolita)
  3.3 cayendo (piernas estiradas, brazos abiertos)
  3.4 recibiendo un golpe (echado hacia atrás, ojos en X o gesto de dolor)
Fila 4 – LANZAR y K.O.:
  4.1 preparando el lanzamiento (brazo de adelante hacia atrás, con un shuriken pequeño en la mano)
  4.2 lanzando (brazo estirado hacia adelante, mano vacía)
  4.3 K.O.: tirado en el suelo, acostado horizontal, ojos en X
  4.4 celda VACÍA (solo fondo)
Fila 5 – ESPADA y PARRY:
  5.1 preparando el espadazo (espada levantada hacia atrás, por encima de la cabeza)
  5.2 cortando (brazo y espada estirados al frente, horizontal)
  5.3 terminando el corte (espada apuntando hacia abajo y al frente)
  5.4 parry / guardia (espada vertical delante de la cara, sostenida con las dos manos)
Fila 6 – ATURDIDO:
  6.1 aturdido, tambaleándose a un lado (ojos en X, brazos colgando)
  6.2 aturdido, tambaleándose al otro lado
  6.3 celda VACÍA · 6.4 celda VACÍA

REGLAS OBLIGATORIAS
- Imagen vertical de 1024 x 1536 px; las 24 celdas son iguales (256 x 256 px).
- Cada pose cabe COMPLETA dentro de su celda, CON LA ESPADA INCLUIDA, con margen, sin tocar los bordes
  ni a las poses vecinas. En el corte (5.2) deja al personaje un poco a la izquierda para que la espada quepa.
- Fondo: verde plano puro #00FF00, uniforme en toda la imagen. Sin sombras, sin degradados,
  sin suelo dibujado. No uses verde en el personaje ni en la espada.
- El personaje mira hacia la DERECHA en todas las poses (vista de perfil / tres cuartos).
- Es el mismo personaje en las 22 poses: mismas proporciones, ropa, colores, espada y tamaño.
  Cuerpo completo, de la cabeza a los pies.
- En las poses de pie, los pies quedan cerca de la parte de abajo de su celda.
- Estilo como la Imagen 1: caricatura 2D tipo chibi (cabeza grande), contorno oscuro,
  colores planos con una sombra suave. Debe entenderse bien en tamaño pequeño (~75 px de alto).
- Sin texto, sin números, sin líneas de cuadrícula, sin marcos, sin efectos de movimiento.
```

**Si sale mal, pídele por ejemplo:**
- "Las poses se salen de su celda. Hazlas más pequeñas y centradas en cada celda de 256 x 256."
- "El personaje debe mirar a la derecha en todas las celdas."
- "El fondo debe ser verde #00FF00 liso, sin sombras."
- "La fila 2 debe ser un ciclo de carrera; ahora parece caminando."
- "Mantén el mismo tamaño del personaje en todas las celdas."
- "La espada se sale de la celda 5.2; haz al personaje más chico y córrelo a la izquierda."
- "Usa la misma espada en todas las poses de la fila 5."
- "No dibujes el arco del corte ni líneas de velocidad; el juego las agrega."

> Si ChatGPT te da la imagen con **fondo transparente**, también sirve.
> Si te da una imagen **cuadrada de 4×4** (sin las filas 5 y 6), funciona, pero sin poses de
> espada, parry ni aturdido: el juego usa las de lanzar, parado y golpe en su lugar.
> Si sale **mirando a la izquierda** en todas, marca la casilla "El personaje mira a la izquierda"
> en el probador (se agrega `"facing": "left"` al catálogo).

**Para agregarlo:** en la página de plantillas, sección **3 · Probar un personaje**, elige la imagen.
Revisa que los recuadros verdes encierren cada pose, que el punto rojo quede en los pies y que las
animaciones se vean bien. Luego sigue las 2 instrucciones que aparecen (copiar la imagen a
`public/personajes/` y pegar la línea en `public/catalog.json`).

---

## Ejemplo de `public/catalog.json` con contenido nuevo

```json
{
  "stages": [
    { "id": "atardecer", "name": "Atardecer", "builtin": "atardecer" },
    { "id": "noche", "name": "Noche azul", "builtin": "noche" },
    { "id": "bosque", "name": "Bosque", "image": "fondos/bosque.png", "floor": "#2f3b33" }
  ],
  "characters": [
    { "id": "ninja", "name": "Ninja", "builtin": "ninja" },
    { "id": "samurai", "name": "Samurái", "image": "personajes/samurai.png" }
  ]
}
```

- `id`: minúsculas, números, `-` o `_` (sin espacios ni acentos), y no puede repetirse.
- Después de editar el catálogo, **reinicia el servidor** (`Ctrl + C` y `npm start`), porque el servidor lo lee al arrancar.
