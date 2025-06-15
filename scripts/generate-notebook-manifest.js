import { promises as fs } from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { fileURLToPath } from 'url';

// __dirname is not available in ES modules, reconstruct it
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const notebooksDir = path.join(__dirname, '..', 'notebooks');
const outputDir = path.join(__dirname, '..', 'public');
const manifestFilePath = path.join(outputDir, 'notebooks.json');

async function readMarkdownFile(filePath) {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    const match = content.match(/^---\n([\s\S]+?)\n---/);
    let metadata = {};
    let title = path.basename(filePath, '.md');
    let isRoot = false;

    if (match) {
      try {
        metadata = yaml.load(match[1]);
        
        if (metadata.meta && Array.isArray(metadata.meta) && metadata.meta.length > 0) {
          const metaTitleObj = metadata.meta.find(item => item && typeof item === 'object' && 'title' in item);
          if (metaTitleObj && metaTitleObj.title !== undefined && metaTitleObj.title !== null) {
            title = String(metaTitleObj.title);
          }
        }

        if (title === path.basename(filePath, '.md') && metadata.title !== undefined && metadata.title !== null) {
          title = String(metadata.title);
        }

        isRoot = false;

        if (metadata.root !== undefined && metadata.root !== null) {
          isRoot = Boolean(metadata.root);
        }

        if (!isRoot && metadata.meta && Array.isArray(metadata.meta) && metadata.meta.length > 0) {
          const metaRootObj = metadata.meta.find(item => item && typeof item === 'object' && 'root' in item);
          if (metaRootObj && metaRootObj.root !== undefined && metaRootObj.root !== null) {
            isRoot = Boolean(metaRootObj.root);
          }
        }

        if (!isRoot && metadata.meta && Array.isArray(metadata.meta) && metadata.meta.includes('root')) {
            isRoot = true;
        }

      } catch (e) {
        console.warn(`Warning: Could not parse YAML front matter in ${filePath}:`, e);
      }
    }
    return { title, path: path.relative(notebooksDir, filePath), root: isRoot };
  } catch (error) {
    console.error(`Error reading file ${filePath}:`, error);
    return null;
  }
}

async function collectNotebooks(dir) {
  let notebooks = [];
  const items = await fs.readdir(dir, { withFileTypes: true });

  for (const item of items) {
    const fullPath = path.join(dir, item.name);
    if (item.isDirectory()) {
      notebooks = notebooks.concat(await collectNotebooks(fullPath));
    } else if (item.isFile() && item.name.endsWith('.md')) {
      const notebookData = await readMarkdownFile(fullPath);
      if (notebookData) {
        notebooks.push(notebookData);
      }
    }
  }
  return notebooks;
}

async function generateManifest() {
  try {
    // Ensure output directory exists
    await fs.mkdir(outputDir, { recursive: true });

    const allNotebooks = await collectNotebooks(notebooksDir);
    
    // Sort notebooks by path for consistent ordering
    allNotebooks.sort((a, b) => a.path.localeCompare(b.path));

    await fs.writeFile(manifestFilePath, JSON.stringify(allNotebooks, null, 2), 'utf8');
    console.log(`Notebook manifest generated at ${manifestFilePath}`);
  } catch (error) {
    console.error('Error generating notebook manifest:', error);
    process.exit(1);
  }
}

generateManifest(); 