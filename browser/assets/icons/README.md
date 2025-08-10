# Extension Icons

This directory contains icon files for the browser extension in various sizes.

## Required Icons

### Chrome Web Store
- 128x128 pixels (PNG) - Main extension icon
- 48x48 pixels (PNG) - Toolbar icon  
- 16x16 pixels (PNG) - Favicon

### Firefox Add-ons
- 128x128 pixels (PNG or SVG) - Main icon
- 48x48 pixels (PNG or SVG) - Toolbar icon
- 96x96 pixels (PNG or SVG) - Optional larger icon

### Edge Add-ons
- Same as Chrome requirements

### Store Promotional Images
- 440x280 pixels - Small promo tile (Chrome)
- 920x680 pixels - Large promo tile (Chrome) 
- 1280x800 pixels - Marquee promo (Chrome)
- Screenshots: 1280x800 or 640x400 pixels

## Icon Design Guidelines

1. Use a simple, recognizable design
2. Ensure good contrast and visibility at small sizes
3. Follow Material Design principles for Chrome
4. Test icons on both light and dark backgrounds
5. Include transparent background for PNG files

## File Naming Convention

- icon-16.png
- icon-48.png
- icon-128.png
- icon.svg (if using SVG)

## Generating Icons

To generate icons from a high-resolution source:

```bash
# Using ImageMagick
convert source.png -resize 128x128 icon-128.png
convert source.png -resize 48x48 icon-48.png
convert source.png -resize 16x16 icon-16.png
```