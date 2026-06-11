import fs from 'fs';
import readline from 'readline';

async function readPrompts() {
  const filePath = 'C:/Users/long.nh/.gemini/antigravity-ide/brain/11a066c1-b46b-418f-9088-3783b6bc10b9/.system_generated/logs/transcript.jsonl';
  const fileStream = fs.createReadStream(filePath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  const prompts = [];
  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line);
      if (obj.source === 'USER_EXPLICIT' && obj.type === 'USER_INPUT') {
        prompts.push({
          step: obj.step_index,
          time: obj.created_at,
          request: obj.content
        });
      }
    } catch (e) {
      // ignore parse errors
    }
  }

  for (const p of prompts) {
    console.log(`\n=== STEP ${p.step} (${p.time}) ===`);
    console.log(p.request);
  }
}

readPrompts().catch(console.error);
