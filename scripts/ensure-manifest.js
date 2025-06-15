import { existsSync, rmSync } from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const manifestPath = path.join(__dirname, '..', 'public', 'notebooks.json');
const generateScript = path.join(__dirname, 'generate-notebook-manifest.js');

if (existsSync(manifestPath)) {
  console.log('Deleting existing notebooks.json...');
  try {
    rmSync(manifestPath);
  } catch (error) {
    console.error(`Failed to delete existing notebooks.json: ${error.message}`);
    process.exit(1);
  }
}

console.log('Generating notebooks.json...');
try {
  execSync(`node ${generateScript}`, { stdio: 'inherit' });
} catch (error) {
  console.error('Failed to generate notebooks.json:', error.message);
  process.exit(1);
} 