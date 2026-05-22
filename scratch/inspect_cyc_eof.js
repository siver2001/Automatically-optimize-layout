import fs from 'fs';

const ref = fs.readFileSync('EOR-13/10.5Q_1.CYC');
const gen = fs.readFileSync('scratch/gen_10.5Q_1.CYC');

console.log('Ref CYC length:', ref.length);
console.log('Gen CYC length:', gen.length);

console.log('\nLast 20 bytes of Ref CYC (hex):');
console.log(JSON.stringify(ref.slice(-20).toString('hex')));
console.log(ref.slice(-20).toString('utf8'));

console.log('\nLast 20 bytes of Gen CYC (hex):');
console.log(JSON.stringify(gen.slice(-20).toString('hex')));
console.log(gen.slice(-20).toString('utf8'));
