import fs from 'fs';
import path from 'path';
import { generateDieCutDxf } from '../server/utils/diecutDxfGenerator.js';
import { generateDieCutCyc } from '../server/utils/diecutCycGenerator.js';

// Parsers for verification
function parseCyc(cycContent) {
  const lines = cycContent.split(/\r?\n/);
  const cycles = [];
  let currentCycle = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('<Cycle Name="DXFData">')) {
      currentCycle = {};
    } else if (trimmed.startsWith('</Cycle>')) {
      if (currentCycle) cycles.push(currentCycle);
      currentCycle = null;
    } else if (trimmed.startsWith('<Field ')) {
      const nameMatch = trimmed.match(/Name="([^"]+)"/);
      const valueMatch = trimmed.match(/Value="([^"]+)"/);
      if (nameMatch && valueMatch && currentCycle) {
        currentCycle[nameMatch[1]] = valueMatch[1];
      }
    }
  }
  return cycles;
}

function parseDxfEntities(dxfContent) {
  const lines = dxfContent.split(/\r?\n/);
  const entities = [];
  let currentEntity = null;
  let inEntitiesSection = false;

  for (let i = 0; i < lines.length - 1; i += 2) {
    const code = parseInt(lines[i].trim(), 10);
    const val = lines[i+1]?.trim();
    
    if (code === 0) {
      if (val === 'SECTION') {
        // Start section
      } else if (val === 'ENDSEC') {
        inEntitiesSection = false;
      }
      
      if (inEntitiesSection) {
        if (currentEntity) {
          entities.push(currentEntity);
        }
        currentEntity = { type: val, properties: [] };
      }
    } else if (code === 2 && lines[i-2]?.trim() === '0' && lines[i-1]?.trim() === 'SECTION') {
      if (val === 'ENTITIES') {
        inEntitiesSection = true;
      }
    } else {
      if (inEntitiesSection && currentEntity) {
        currentEntity.properties.push({ code, val });
      }
    }
  }
  if (currentEntity) {
    entities.push(currentEntity);
  }
  return entities;
}

// Custom parser to extract placed items from a reference DXF file
function extractPlacedItemsFromRefDxf(dxfPath, sizeName) {
  const dxfContent = fs.readFileSync(dxfPath, 'utf8');
  const entities = parseDxfEntities(dxfContent);
  
  const placed = [];
  let index = 0;
  
  // Find all POLYLINE groups
  let i = 0;
  while (i < entities.length) {
    const ent = entities[i];
    if (ent.type === 'POLYLINE') {
      const vertices = [];
      let layer = '';
      for (const prop of ent.properties) {
        if (prop.code === 8) layer = prop.val;
      }
      
      let j = i + 1;
      while (j < entities.length && entities[j].type === 'VERTEX') {
        const vProps = entities[j].properties;
        let x = 0, y = 0;
        for (const p of vProps) {
          if (p.code === 10) x = parseFloat(p.val);
          if (p.code === 20) y = parseFloat(p.val);
        }
        vertices.push({ x, y });
        j++;
      }
      
      // If it's a 5-vertex border frame, skip it from placed items
      if (vertices.length === 5 && 
          Math.abs(vertices[0].x - vertices[3].x) < 0.01 && 
          Math.abs(vertices[1].x - vertices[2].x) < 0.01) {
        i = j;
        if (j < entities.length && entities[j].type === 'SEQEND') i++;
        if (i < entities.length && entities[i].type === 'TEXT') i++;
        continue;
      }
      
      let hasSeqend = false;
      if (j < entities.length && entities[j].type === 'SEQEND') {
        hasSeqend = true;
        j++;
      }
      
      let label = '';
      if (j < entities.length && entities[j].type === 'TEXT') {
        const tProps = entities[j].properties;
        for (const p of tProps) {
          if (p.code === 1) label = p.val;
        }
        j++;
      }
      
      // Calculate simple centroid
      let sumX = 0, sumY = 0;
      vertices.forEach(v => { sumX += v.x; sumY += v.y; });
      const centroid = { x: sumX / vertices.length, y: sumY / vertices.length };
      
      placed.push({
        id: `placed_${index++}`,
        sizeName: sizeName,
        foot: 'L',
        x: centroid.x,
        y: centroid.y,
        angle: 0.0,
        polygon: vertices,
        centroid,
        label // This is the reference label N=X
      });
      
      i = j;
    } else {
      i++;
    }
  }
  
  return placed;
}

async function verifyAllReferencePairs() {
  const eorDir = 'c:/Users/long.nh/Desktop/Automatically-optimize-layout/EOR-13';
  const cycFiles = fs.readdirSync(eorDir).filter(f => f.endsWith('.CYC'));
  
  console.log(`=== STARTING DEEP VALIDATION FOR ALL ${cycFiles.length} REFERENCE FILES ===\n`);
  
  let totalPassed = 0;
  
  for (const cycFile of cycFiles) {
    const baseName = path.basename(cycFile, '.CYC');
    const dxfFile = `${baseName}.DXF`;
    
    const cycPath = path.join(eorDir, cycFile);
    const dxfPath = path.join(eorDir, dxfFile);
    
    if (!fs.existsSync(dxfPath)) {
      console.log(`⚠️ Warning: DXF match not found for ${cycFile}`);
      continue;
    }
    
    // 1. Extract reference details
    const refCycContent = fs.readFileSync(cycPath, 'utf8');
    const refCycles = parseCyc(refCycContent);
    const refDxfContent = fs.readFileSync(dxfPath, 'utf8');
    const refEntities = parseDxfEntities(refDxfContent);
    
    const refTextLabels = refEntities
      .filter(e => e.type === 'TEXT')
      .map(e => {
        const textProp = e.properties.find(p => p.code === 1);
        return textProp?.val;
      });
      
    // 2. Perform sequence check on reference file itself
    const refCycNs = refCycles.map(c => `N=${c.N}`);
    let refSyncOk = true;
    for (let idx = 0; idx < refCycNs.length; idx++) {
      if (refCycNs[idx] !== refTextLabels[idx]) {
        refSyncOk = false;
      }
    }
    
    if (!refSyncOk) {
      console.log(`❌ Reference file ${baseName} itself is out of sync!`);
      continue;
    }
    
    // Determine the size and tool code from the file name
    const sizeName = baseName.split('_')[0]; // e.g. "10.5Q"
    const toolCodeVal = refCycles[0]?.T || '7';

    // 3. Extract items to mock our database and nesting state
    const placedItems = extractPlacedItemsFromRefDxf(dxfPath, sizeName);
    
    const payload = {
      title: 'ASICS-DC-EOR-13',
      sheetWidth: 1789.4647,
      sheetHeight: 1027.5245,
      isLuxin: true,
      toolCodeMap: { [sizeName]: toolCodeVal },
      sheets: [
        {
          sheetIndex: 0,
          sheetWidth: 1789.4647,
          sheetHeight: 1027.5245,
          placed: placedItems
        }
      ]
    };
    
    // 4. Generate our DXF and CYC
    const genDxf = generateDieCutDxf(payload);
    const genCyc = generateDieCutCyc(payload);
    
    // 5. Parse and verify our generated outputs
    const genCycles = parseCyc(genCyc);
    const genEntities = parseDxfEntities(genDxf);
    
    const genTextLabels = genEntities
      .filter(e => e.type === 'TEXT')
      .map(e => {
        const textProp = e.properties.find(p => p.code === 1);
        return textProp?.val;
      });
      
    const genPolylines = genEntities.filter(e => e.type === 'POLYLINE');
    // Note: genPolylines[0] is the border/frame
    const genCutPolylines = genPolylines.slice(1);
    
    // ASSERTIONS
    const assertionErrors = [];
    
    if (genCycles.length !== refCycles.length) {
      assertionErrors.push(`Cycle count mismatch: generated=${genCycles.length}, reference=${refCycles.length}`);
    }
    
    if (genTextLabels.length !== refTextLabels.length) {
      assertionErrors.push(`Text label count mismatch: generated=${genTextLabels.length}, reference=${refTextLabels.length}`);
    }
    
    if (genCutPolylines.length !== genTextLabels.length) {
      assertionErrors.push(`DXF Polyline vs Text mismatch: polylines=${genCutPolylines.length}, texts=${genTextLabels.length}`);
    }
    
    // Check perfect sync between generated DXF texts and CYC cycles
    for (let idx = 0; idx < genCycles.length; idx++) {
      const cycLabel = `N=${genCycles[idx].N}`;
      const dxfLabel = genTextLabels[idx];
      if (cycLabel !== dxfLabel) {
        assertionErrors.push(`Mismatch at index ${idx}: CYC has ${cycLabel}, DXF has ${dxfLabel}`);
      }
    }
    
    if (assertionErrors.length === 0) {
      console.log(`✅ SUCCESS: ${baseName} - Perfect 100% Parity. Cycles=${genCycles.length}, Polylines=${genCutPolylines.length}, N-sequence matched.`);
      totalPassed++;
    } else {
      console.log(`❌ FAILED: ${baseName}`);
      assertionErrors.forEach(err => console.log(`   - ${err}`));
    }
  }
  
  console.log(`\n=== FINAL VERIFICATION SUMMARY ===`);
  console.log(`Passed: ${totalPassed} / ${cycFiles.length} files.`);
  if (totalPassed === cycFiles.length) {
    console.log(`🏆 ALL FILES PASSED 100% PERFECTLY!`);
  } else {
    console.log(`⚠️ Some files failed deep validation. Please check errors.`);
  }
}

verifyAllReferencePairs().catch(console.error);
