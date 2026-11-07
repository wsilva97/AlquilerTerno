# Alquiler de Prendas

Demo web para controlar el alquiler de ternos y vestidos: contratos, devoluciones (también parciales), garantía, mora por atraso, daños, pagos/adelantos, deuda del cliente y constancia en PDF para compartir por WhatsApp.

Página estática (HTML + CSS + JavaScript). Los datos se guardan en el navegador (`localStorage`); desde **Ajustes** se puede exportar/importar un respaldo y cargar datos de ejemplo.

## Reglas

| Concepto | Cálculo |
|---|---|
| Alquiler | Σ cantidad × precio unitario |
| Garantía | Se cobra al alquilar y se devuelve al entregar todas las prendas, descontando daños y deuda |
| Mora | S/ 10 (configurable) por día, por contrato, desde la fecha límite hasta la última devolución |
| Saldo | alquiler + garantía + mora + daños − pagado − garantía reintegrable + garantía devuelta |

## Publicar en GitHub Pages

1. Subir el contenido de esta carpeta a un repositorio.
2. En GitHub: **Settings → Pages → Deploy from a branch → `main` / `(root)`**.
3. El sitio queda en `https://<usuario>.github.io/<repositorio>/`.
