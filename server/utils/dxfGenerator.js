/**
 * server/utils/dxfGenerator.js
 * Utility to generate simple DXF (Drawing Exchange Format) files.
 * Supports: LWPOLYLINE, TEXT
 * Features: True Color (Group 420) + Safe ACI Fallback
 */

// Simple ACI Map for Fallback (Standard 7 colors)
// Basic ACI Map for Fallback
const STANDARD_COLORS = [
    { rgb: [0, 0, 0], aci: 7 },       // Black -> White (7)
    { rgb: [255, 255, 255], aci: 7 }, // White -> White (7)
    { rgb: [255, 0, 0], aci: 1 },     // Red
    { rgb: [255, 255, 0], aci: 2 },   // Yellow
    { rgb: [0, 255, 0], aci: 3 },     // Green
    { rgb: [0, 255, 255], aci: 4 },   // Cyan
    { rgb: [0, 0, 255], aci: 5 },     // Blue
    { rgb: [255, 0, 255], aci: 6 },   // Magenta
    { rgb: [128, 128, 128], aci: 8 }, // Gray
    { rgb: [192, 192, 192], aci: 9 }, // Light Gray
    { rgb: [255, 127, 0], aci: 30 },  // Orange
    { rgb: [127, 255, 0], aci: 70 },  // Chartreuse
    { rgb: [0, 255, 127], aci: 130 }, // Spring Green
    { rgb: [0, 127, 255], aci: 150 }, // Azure
    { rgb: [127, 0, 255], aci: 170 }, // Violet
    { rgb: [255, 0, 127], aci: 210 }, // Rose
    { rgb: [165, 42, 42], aci: 14 },  // Brown
];

function getDistance(rgb1, rgb2) {
    return Math.sqrt(
        Math.pow(rgb1[0] - rgb2[0], 2) +
        Math.pow(rgb1[1] - rgb2[1], 2) +
        Math.pow(rgb1[2] - rgb2[2], 2)
    );
}

function parseColorStr(colorStr) {
    if (!colorStr) return [255, 255, 255]; // Default to White if missing

    // Hex
    if (colorStr.startsWith('#')) {
        const hex = colorStr.slice(1);
        if (hex.length === 3) {
            return [
                parseInt(hex[0] + hex[0], 16),
                parseInt(hex[1] + hex[1], 16),
                parseInt(hex[2] + hex[2], 16)
            ];
        }
        if (hex.length === 6) {
            return [
                parseInt(hex.slice(0, 2), 16),
                parseInt(hex.slice(2, 4), 16),
                parseInt(hex.slice(4, 6), 16)
            ];
        }
    }

    // RGB format: rgb(r, g, b)
    if (colorStr.startsWith('rgb')) {
        const match = colorStr.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
        if (match) {
            return [parseInt(match[1]), parseInt(match[2]), parseInt(match[3])];
        }
    }

    return [255, 255, 255];
}

function rgbToAci(rgb) {
    let closestProximity = Infinity;
    let closestAci = 7;

    STANDARD_COLORS.forEach(item => {
        const dist = getDistance(rgb, item.rgb);
        if (dist < closestProximity) {
            closestProximity = dist;
            closestAci = item.aci;
        }
    });
    return closestAci;
}

function rgbToTrueColor(rgb) {
    // 24-bit integer: (R << 16) + (G << 8) + B
    return (rgb[0] << 16) + (rgb[1] << 8) + rgb[2];
}

class DxfWriter {
    constructor() {
        this.content = '';
        this.addHeader();
        this.startEntities();
    }

    addHeader() {
        this.content += `0\nSECTION\n2\nHEADER\n9\n$ACADVER\n1\nAC1018\n0\nENDSEC\n`; // AC1018 = 2004 (supports true color)
    }

    startEntities() {
        this.content += `0\nSECTION\n2\nENTITIES\n`;
    }

    endEntities() {
        this.content += `0\nENDSEC\n`;
    }

    endFile() {
        this.endEntities();
        this.content += `0\nEOF\n`;
        return this.content;
    }

    // Add LWPOLYLINE (Lightweight Polyline)
    // Points: [{x, y}, {x, y}...]
    addPolyline(points, aciColor = 7, trueColor = null, layer = '0') {
        const count = points.length;
        this.content += `0\nLWPOLYLINE\n`; // Entity Type
        this.content += `8\n${layer}\n`;     // Layer Name
        this.content += `62\n${aciColor}\n`; // Fallback Color
        if (trueColor !== null) {
            this.content += `420\n${trueColor}\n`; // True Color
        }
        this.content += `100\nAcDbEntity\n`;
        this.content += `100\nAcDbPolyline\n`;
        this.content += `90\n${count}\n`;    // Number of vertices
        this.content += `70\n1\n`;           // 1 = Closed loop, 0 = Open

        points.forEach(p => {
            this.content += `10\n${p.x.toFixed(3)}\n`; // X
            this.content += `20\n${p.y.toFixed(3)}\n`; // Y
        });
    }

    // Add TEXT
    addText(text, x, y, height, aciColor = 7, layer = 'TEXT', rotation = 0) {
        this.content += `0\nTEXT\n`;
        this.content += `8\n${layer}\n`;
        this.content += `62\n${aciColor}\n`;
        this.content += `10\n${x.toFixed(3)}\n`; // Insertion X
        this.content += `20\n${y.toFixed(3)}\n`; // Insertion Y
        this.content += `40\n${height.toFixed(3)}\n`; // Height
        this.content += `1\n${text}\n`; // Content
        if (rotation !== 0) {
            this.content += `50\n${rotation}\n`; // Rotation angle in degrees
        }
    }
}

/**
 * Generate DXF content from packing data
 */
export function generateDxf(data) {
    const { container, allLayouts } = data;
    const writer = new DxfWriter();

    const SHEET_GAP = 200; // 200mm gap between sheets

    // Helper remove accents
    function removeAccents(str) {
        if (!str) return '';
        return str.normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/đ/g, 'd').replace(/Đ/g, 'D');
    }

    // ACI Color Table Construction (Approximation)
    // We will build a lookup or just use a dense list for better matching.
    // For brevity/efficiency, let's use a standard list of 256 ACI colors derived values.
    // Since hardcoding 256 RGBs is long, we can use a helper or a more extensive list.
    // Here we will add a more robust map for common colors and specific ranges.

    // Helper to find closest ACI from a larger palette
    function getClosestAci(r, g, b) {
        // Standard (1-9)
        const standards = [
            { i: 1, r: 255, g: 0, b: 0 }, { i: 2, r: 255, g: 255, b: 0 }, { i: 3, r: 0, g: 255, b: 0 },
            { i: 4, r: 0, g: 255, b: 255 }, { i: 5, r: 0, g: 0, b: 255 }, { i: 6, r: 255, g: 0, b: 255 },
            { i: 7, r: 255, g: 255, b: 255 }, { i: 8, r: 128, g: 128, b: 128 }, { i: 9, r: 192, g: 192, b: 192 }
        ];

        let bestIdx = 7;
        let minDist = Infinity;

        // Check standards first
        for (let c of standards) {
            const d = (c.r - r) ** 2 + (c.g - g) ** 2 + (c.b - b) ** 2;
            if (d < minDist) { minDist = d; bestIdx = c.i; }
        }

        // If exact match or very close, return
        if (minDist < 100) return bestIdx;

        // Full ACI loop (10-249) - Simplified algorithm or hardcoded steps
        // To save space, we check distance against specific known "Pastel" colors often used in UI
        const extras = [
            { i: 10, r: 255, g: 0, b: 0 }, { i: 11, r: 255, g: 127, b: 127 }, { i: 30, r: 255, g: 127, b: 0 },
            { i: 40, r: 255, g: 191, b: 0 }, { i: 50, r: 255, g: 255, b: 0 }, { i: 51, r: 255, g: 255, b: 127 },
            { i: 70, r: 127, g: 255, b: 0 }, { i: 90, r: 0, g: 255, b: 0 }, { i: 91, r: 127, g: 255, b: 127 },
            { i: 130, r: 0, g: 255, b: 255 }, { i: 131, r: 127, g: 255, b: 255 },
            { i: 150, r: 0, g: 0, b: 255 }, { i: 151, r: 127, g: 127, b: 255 },
            { i: 210, r: 255, g: 0, b: 127 }, { i: 211, r: 255, g: 127, b: 191 },
            { i: 250, r: 51, g: 51, b: 51 }, { i: 251, r: 80, g: 80, b: 80 }, { i: 252, r: 105, g: 105, b: 105 },
            { i: 253, r: 130, g: 130, b: 130 }, { i: 254, r: 190, g: 190, b: 190 } // Greys
        ];

        // Checking generalized "Hue" logic would be better but complex.
        // Let's rely on standard + these common variations.
        for (let c of extras) {
            const d = (c.r - r) ** 2 + (c.g - g) ** 2 + (c.b - b) ** 2;
            if (d < minDist) { minDist = d; bestIdx = c.i; }
        }

        return bestIdx;
    }

    // Generates a consistent hex color from a string
    function stringToColor(str) {
        if (!str) return '#CCCCCC';
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            hash = str.charCodeAt(i) + ((hash << 5) - hash);
        }
        const c = (hash & 0x00FFFFFF).toString(16).toUpperCase();
        return '#' + '00000'.substring(0, 6 - c.length) + c;
    }

    allLayouts.forEach((layout, index) => {
        // Offset for this sheet
        const offsetX = index * (container.length + SHEET_GAP);
        const offsetY = 0;

        // 1. Draw Container Border (Layer: BORDER, Color: 7/White)
        const borderPoints = [
            { x: offsetX, y: offsetY },
            { x: offsetX + container.length, y: offsetY },
            { x: offsetX + container.length, y: offsetY + container.width },
            { x: offsetX, y: offsetY + container.width }
        ];
        writer.addPolyline(borderPoints, 7, null, 'BORDER');

        // Label for Sheet
        const layerCount = layout.layers ? layout.layers.length : 1;
        const sheetLabel = removeAccents(`Sheet ${index + 1} - ${layout.description || ''} - ${layerCount} lop`);
        writer.addText(
            sheetLabel,
            offsetX,
            offsetY - 20,
            10,
            7,
            'TEXT'
        );

        // 2. Draw Rectangles
        const placedRectangles = layout.layers
            ? layout.layers.flatMap(layer => layer.rectangles.filter(Boolean))
            : [];

        placedRectangles.forEach(rect => {

            const rectX = offsetX + rect.y; // X axis = Rect.y (Landscape)
            const rectY = offsetY + rect.x; // Y axis = Rect.x

            const rW = rect.length;
            const rH = rect.width;

            const points = [
                { x: rectX, y: rectY },
                { x: rectX + rW, y: rectY },
                { x: rectX + rW, y: rectY + rH },
                { x: rectX, y: rectY + rH }
            ];

            // Color processing with Fallback
            let colorToUse = rect.color;
            if (!colorToUse || colorToUse === '#000000' || colorToUse === '#ffffff') {
                // If color is missing or black/white (often default), generate from name
                colorToUse = stringToColor(rect.name);
            }

            const rgb = parseColorStr(colorToUse);
            // Use improved mapping
            const aci = getClosestAci(rgb[0], rgb[1], rgb[2]);
            const trueColor = rgbToTrueColor(rgb);

            // Layer Name: Use sanitized Rect Name to allow grouping in CAD
            let layerName = removeAccents(rect.name || 'Unknown');
            layerName = layerName.replace(/[^a-zA-Z0-9_\-]/g, '_'); // Safe chars only
            if (!layerName) layerName = 'Items';

            if (index === 0 && placedRectangles.length < 5) {
                console.log(`[DXF DEBUG] Rect: ${rect.width}x${rect.length}, Name: "${rect.name}", Layer: ${layerName}, FinalColor: "${colorToUse}", ACI: ${aci}`);
            }

            // Write Entity with Specific Layer and Entity Color
            writer.addPolyline(points, aci, trueColor, layerName);

            // ... Text Label Logic ...
            const textSize = Math.min(Math.min(rW, rH) * 0.15, 20);
            const useRotatedText = rH > rW * 1.5;

            const centerX = rectX + rW / 2;
            const centerY = rectY + rH / 2;
            const label = `${rect.width}x${rect.length}`;

            const estimatedTextWidth = 0.6 * textSize * label.length;

            let textX = centerX - (estimatedTextWidth / 2);
            let textY = centerY - (textSize / 2);
            let rotation = 0;

            if (useRotatedText) {
                rotation = 90;
                textX = centerX + (textSize / 2);
                textY = centerY - (estimatedTextWidth / 2);
            }

            // Text on "TEXT_LABELS" layer, usually White
            writer.addText(label, textX, textY, textSize, 7, 'TEXT_LABELS', rotation);
        });
    });

    return writer.endFile();
}
