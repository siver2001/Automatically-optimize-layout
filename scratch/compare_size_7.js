import fs from 'fs';

const oldLayouts = JSON.parse(fs.readFileSync('scratch/old_layouts.json', 'utf8'));
const newLayouts = JSON.parse(fs.readFileSync('scratch/new_layouts.json', 'utf8'));

console.log("=== SIZE 7 OLD LAYOUT ===");
console.log(oldLayouts['7'] || "No Size 7 found");

console.log("\n=== SIZE 7 NEW LAYOUT ===");
console.log(newLayouts['7'] || "No Size 7 found");
