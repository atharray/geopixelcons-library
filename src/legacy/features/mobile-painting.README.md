# Painting Menu Overhaul

`mobile-painting.js` builds the compact palette and mirrors Ghost++ controls
into the second painting panel. It leaves the real Ghost++ controls in their
modal and forwards mirrored interactions to them.

The upload panel owns the **Use manual palette** checkbox. Ghost++ may refresh
its mirrored controls during a pointer gesture, so the checkbox stays mounted
while the mirrors rebuild. Its state is saved in the existing
`mobilePaintingManualPalette` setting.

Template mode appends one checkerboard transparent paint swatch after sorted or
filtered template colors. The swatch selects the site's native transparent
paint color and never changes the template's Ghost++ mask. Manual mode uses
the site's `activeColors` order and does not add the template-only swatch.
