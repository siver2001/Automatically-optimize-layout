import fs from 'fs';

const ref = fs.readFileSync('EOR-13/10.5Q_1.DXF');
const gen = fs.readFileSync('scratch/gen_10.5Q_1.DXF');

console.log('Ref length in bytes:', ref.length);
console.log('Gen length in bytes:', gen.length);

console.log('\nLast 20 bytes of Ref:');
console.log(JSON.stringify(ref.slice(-20).toString('hex')));
console.log(ref.slice(-20).toString('utf8'));

console.log('\nLast 20 bytes of Gen:');
console.log(JSON.stringify(gen.slice(-20).toString('hex')));
console.log(gen.slice(-20).toString('utf8'));

// Check for BOM
console.log('\nFirst 5 bytes of Ref:', ref.slice(0, 5).toString('hex'));
console.log('First 5 bytes of Gen:', gen.slice(0, 5).toString('hex'));
