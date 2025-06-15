import { BASE_URL } from './config.js';

export class Sidebar {
  constructor() {
    this.notebookList = document.getElementById('notebook-list');
    this.currentPath = '';
  }

  async loadNotebooks() {
    try {
      const response = await fetch(`${BASE_URL}notebooks.json`);
      const flatNotebooks = await response.json();
      
      const tree = this.buildTree(flatNotebooks);
      this.renderNotebooks(tree);
    } catch (error) {
      console.error('Error loading notebooks manifest:', error);
      this.notebookList.innerHTML = '<div class="error">Error loading notebooks list</div>';
    }
  }

  buildTree(flatNotebooks) {
    const tree = [];

    flatNotebooks.sort((a, b) => a.path.localeCompare(b.path));

    flatNotebooks.forEach(notebook => {
      const relativePath = notebook.path;
      const parts = relativePath.split('/');
      let currentLevel = tree;

      for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i];
        let dir = currentLevel.find(item => item.name === part && item.type === 'directory');
        
        if (!dir) {
          dir = {
            name: part,
            type: 'directory',
            children: []
          };
          currentLevel.push(dir);
        }
        currentLevel = dir.children;
      }

      currentLevel.push({
        name: notebook.title && notebook.title.trim() !== '' ? notebook.title : parts[parts.length - 1].replace('.md', ''),
        type: 'file',
        path: relativePath,
        root: notebook.root
      });
    });

    this._sortTreeRecursively(tree);

    return tree;
  }

  _sortTreeRecursively(items) {
    items.sort((a, b) => {
      if (a.root && !b.root) return -1;
      if (!a.root && b.root) return 1;

      if (a.type === 'file' && b.type === 'directory') {
        return -1;
      }
      if (a.type === 'directory' && b.type === 'file') {
        return 1;
      }

      return a.name.localeCompare(b.name);
    });

    items.forEach(item => {
      if (item.type === 'directory' && item.children) {
        this._sortTreeRecursively(item.children);
      }
    });
  }

  renderNotebooks(notebooks) {
    this.notebookList.innerHTML = '';
    this.notebookList.appendChild(this._renderStructure(notebooks));
  }

  _renderStructure(items) {
    const fragment = document.createDocumentFragment();

    items.forEach(item => {
      const itemDiv = document.createElement('div');
      itemDiv.className = 'notebook-item';

      if (item.type === 'file') {
        itemDiv.setAttribute('data-path', item.path);
        itemDiv.innerHTML = `
          <div class="file">
            <span class="file-icon">📄</span>
            <span class="file-name">${item.name}</span>
          </div>
        `;
        itemDiv.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.selectNotebook(item.path);
        });
      } else if (item.type === 'directory') {
        itemDiv.classList.add('expanded');
        itemDiv.innerHTML = `
          <div class="folder">
            <span class="folder-icon">📁</span>
            <span class="folder-name">${item.name}</span>
          </div>
        `;
        itemDiv.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          this._toggleFolder(itemDiv);
        });

        const childrenContainer = document.createElement('div');
        childrenContainer.className = 'folder-container';
        childrenContainer.appendChild(this._renderStructure(item.children));
        
        fragment.appendChild(itemDiv);
        fragment.appendChild(childrenContainer);
        return;
      }
      fragment.appendChild(itemDiv);
    });
    return fragment;
  }

  _toggleFolder(element) {
    element.classList.toggle('expanded');
  }

  selectNotebook(path) {
    document.querySelectorAll('.notebook-item').forEach(item => {
      item.classList.remove('active');
    });
    
    const selectedItem = document.querySelector(`[data-path="${path}"]`);
    if (selectedItem) {
      selectedItem.classList.add('active');
    }
    
    const newUrl = new URL(window.location);
    newUrl.pathname = path;
    window.history.pushState({}, '', newUrl);
    
    const event = new CustomEvent('notebookSelected', { detail: { path } });
    document.dispatchEvent(event);
  }
} 