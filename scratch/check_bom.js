import fs from 'fs';

const cycPath = 'c:/Users/long.nh/Desktop/Automatically-optimize-layout/EOR-13/10.5Q_1.CYC';
const dxfPath = 'c:/Users/long.nh/Desktop/Automatically-optimize-layout/EOR-13/10.5Q_1.DXF';

function checkBOM(filePath) {
  const buffer = fs.readFileSync(filePath);
  console.log(`File: ${filePath}`);
  console.log(`  First 10 bytes:`, buffer.slice(0, 10));
  
  // UTF-8 BOM is EF BB BF
  if (buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) {
    console.log(`  -> Has UTF-8 BOM!`);
  } else if (buffer[0] === 0xFE && buffer[1] === 0xFF) {
    console.log(`  -> Has UTF-16 BE BOM!`);
  } else if (buffer[0] === 0xFF && buffer[1] === 0xFE) {
    console.log(`  -> Has UTF-16 LE BOM!`);
  } else {
    console.log(`  -> No BOM (Standard UTF-8 or ASCII)`);
  }
}

checkBOM(cycPath);
checkBOM(dxfPath);
