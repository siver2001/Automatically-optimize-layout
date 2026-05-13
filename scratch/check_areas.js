import fs from 'fs';
import path from 'path';
import { parseDxfToPolygons } from '../server/algorithms/diecut/core/dxfParser.js';
import { area as polygonArea } from '../server/algorithms/diecut/core/polygonUtils.js';

const dxfPath = 'ASICS-DC-EOR-13(DAO GO LUXIN)-MS FS-BEESCO-2025-08-25(DINH DANG LUXIN).dxf';
const content = fs.readFileSync(dxfPath, 'utf-8');
const polygons = parseDxfToPolygons(content);

console.log('Index | Polygon Area | Expected Count (100% Efficiency)');
console.log('-------------------------------------------------------');

const workArea = (1100 - 10) * (2000 - 40);

polygons.forEach((polygon, index) => {
    const a = polygonArea(polygon);
    const maxPieces = Math.floor(workArea / a);
    const maxPairs = maxPieces / 2;
    console.log(`${String(index).padEnd(5)} | ${a.toFixed(0).padStart(12)} | ${maxPairs.toFixed(1)}`);
});
