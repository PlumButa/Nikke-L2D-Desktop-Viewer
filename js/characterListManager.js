const fs = require('fs');
const path = require('path');

class CharacterListManager {
  constructor(charsDir, settingsMgr, onSelectCharacter) {
    this.charsDir = charsDir;
    this.settingsMgr = settingsMgr;
    this.onSelectCharacter = onSelectCharacter;
    this.currentTab = 'all'; // 'all' | 'fav'
    this.currentFolderKey = '';
    this.hasInitialized = false;

    this.initEvents();
  }

  initEvents() {
    document.getElementById('fav-toggle-btn').onclick = () => {
      if (!this.currentFolderKey) return;
      const favs = new Set(this.settingsMgr.get().favorites || []);
      if (favs.has(this.currentFolderKey)) {
        favs.delete(this.currentFolderKey);
      } else {
        favs.add(this.currentFolderKey);
      }
      this.settingsMgr.save({ favorites: Array.from(favs) });
      this.updateFavoriteButtonUI();
      this.scanCharacters(document.getElementById('search-input').value.trim());
    };

    document.getElementById('tab-all-btn').onclick = () => {
      this.currentTab = 'all';
      document.getElementById('tab-all-btn').classList.add('active');
      document.getElementById('tab-fav-btn').classList.remove('active');
      this.scanCharacters(document.getElementById('search-input').value.trim());
    };

    document.getElementById('tab-fav-btn').onclick = () => {
      this.currentTab = 'fav';
      document.getElementById('tab-fav-btn').classList.add('active');
      document.getElementById('tab-all-btn').classList.remove('active');
      this.scanCharacters(document.getElementById('search-input').value.trim());
    };

    document.getElementById('search-input').oninput = (e) => {
      this.scanCharacters(e.target.value.trim());
    };
  }

  updateFavoriteButtonUI() {
    const favBtn = document.getElementById('fav-toggle-btn');
    if (!favBtn || !this.currentFolderKey) return;
    const favs = this.settingsMgr.get().favorites || [];
    const isFav = favs.includes(this.currentFolderKey);
    favBtn.classList.toggle('favorited', isFav);
    favBtn.textContent = isFav ? '⭐ 已在我的最愛' : '☆ 加入我的最愛';
  }

  scanCharacters(filterText = '') {
    const listEl = document.getElementById('char-list');
    listEl.innerHTML = '';

    if (!fs.existsSync(this.charsDir)) return;
    const folders = fs.readdirSync(this.charsDir);

    const s = this.settingsMgr.get();
    const savedFolder = s.lastCharacterFolder;
    const favList = s.favorites || [];
    let targetToSelect = null;

    folders.forEach((folder) => {
      if (this.currentTab === 'fav' && !favList.includes(folder)) {
        return;
      }

      const configPath = path.join(this.charsDir, folder, 'config.json');
      if (!fs.existsSync(configPath)) return;
      const cfg = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

      if (filterText && !cfg.name.includes(filterText) && !(cfg.skin || '').includes(filterText)) {
        return;
      }

      const isFav = favList.includes(folder);
      const iconPath = path.join(this.charsDir, folder, 'icon.png').replace(/\\/g, '/');
      const card = document.createElement('div');
      card.className = 'char-card';
      card.dataset.folder = folder;
      card.innerHTML = `
        <img src="file:///${iconPath}" />
        <div class="char-info">
          <div class="name">${cfg.name}</div>
          <div class="skin">時裝: ${cfg.skin || 'default'}</div>
        </div>
        ${isFav ? '<span class="fav-badge" title="我的最愛">⭐</span>' : ''}
      `;
      card.onclick = () => {
        document.querySelectorAll('.char-card').forEach(c => c.classList.remove('active'));
        card.classList.add('active');
        this.currentFolderKey = folder;
        this.updateFavoriteButtonUI();
        this.onSelectCharacter(folder, cfg);
      };
      listEl.appendChild(card);

      if (!targetToSelect || folder === savedFolder) {
        targetToSelect = { folder, cfg, card };
      }
    });

    if (!this.hasInitialized && targetToSelect) {
      this.hasInitialized = true;
      targetToSelect.card.classList.add('active');
      this.currentFolderKey = targetToSelect.folder;
      this.updateFavoriteButtonUI();
      this.onSelectCharacter(targetToSelect.folder, targetToSelect.cfg);
    } else if (this.currentFolderKey) {
      const activeCard = listEl.querySelector(`[data-folder="${this.currentFolderKey}"]`);
      if (activeCard) activeCard.classList.add('active');
    }
  }
}

module.exports = CharacterListManager;