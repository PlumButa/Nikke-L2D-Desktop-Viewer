class RosterToolsManager {
  /**
   * @param {CharacterListManager} charListMgr
   * @param {SettingsManager} settingsMgr
   */
  constructor(charListMgr, settingsMgr) {
    this.charListMgr = charListMgr;
    this.settingsMgr = settingsMgr;

    this.drawBtn = document.getElementById('random-draw-btn');
    this.overviewBtn = document.getElementById('nikke-overview-btn');

    this.toastEl = document.getElementById('gacha-toast');
    this.toastTextEl = document.getElementById('gacha-toast-text');
    this.toastTimer = null;

    this.modalEl = document.getElementById('nikke-overview-modal');
    this.gridEl = document.getElementById('overview-grid');
    this.countEl = document.getElementById('overview-count');
    this.tooltipEl = document.getElementById('overview-tooltip');

    this.initEvents();
  }

  initEvents() {
    if (this.drawBtn) {
      this.drawBtn.onclick = () => this.drawRandomCharacter();
    }

    if (this.overviewBtn) {
      this.overviewBtn.onclick = () => this.openOverview();
    }

    const closeBtn = document.getElementById('overview-close-btn');
    const closeX = document.getElementById('overview-close-x');
    if (closeBtn) closeBtn.onclick = () => this.closeOverview();
    if (closeX) closeX.onclick = () => this.closeOverview();

    // 點擊遮罩背景關閉總覽視窗
    if (this.modalEl) {
      this.modalEl.addEventListener('mousedown', (e) => {
        if (e.target === this.modalEl) {
          this.closeOverview();
        }
      });
    }

    // 按 Escape 關閉總覽視窗
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOverviewOpen()) {
        this.closeOverview();
      }
    });

    // 使用事件委派處理頭像懸浮提示 (即時跟隨滑鼠、不會被捲軸裁切)
    if (this.gridEl) {
      this.gridEl.addEventListener('mousemove', (e) => {
        const itemBtn = e.target.closest('.overview-avatar-btn');
        if (!itemBtn) {
          this.hideTooltip();
          return;
        }
        this.showTooltip(itemBtn.dataset.name, itemBtn.dataset.skin, e.clientX, e.clientY);
      });

      this.gridEl.addEventListener('mouseleave', () => {
        this.hideTooltip();
      });
    }
  }

  formatDisplayName(cfg) {
    const skin = cfg.skin || '預設';
    return `${cfg.name} - ${skin}`;
  }

  // 1. 「抽一個!」隨機抽選功能
  drawRandomCharacter() {
    const allChars = this.charListMgr.getAllCharacters();
    if (!allChars.length) return;

    // 盡量避免連續抽到目前畫面上同一位
    const currentKey = this.charListMgr.currentFolderKey;
    const candidates = allChars.length > 1
      ? allChars.filter(c => c.folder !== currentKey)
      : allChars;

    const chosen = candidates[Math.floor(Math.random() * candidates.length)];
    if (!chosen) return;

    this.charListMgr.selectByFolder(chosen.folder);
    this.showGachaToast(chosen.cfg);
  }

  // 顯示類似對話氣泡淡入淡出效果的系統提示視窗
  showGachaToast(cfg) {
    if (!this.toastEl || !this.toastTextEl) return;

    const displayName = this.formatDisplayName(cfg);
    this.toastTextEl.textContent = `抽到了「${displayName}」 !!!`;
    this.toastEl.classList.add('show');

    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      this.toastEl.classList.remove('show');
    }, 2600);
  }

  // 2. 「妮姬總覽」15 欄頭像表格視窗
  openOverview() {
    if (!this.modalEl || !this.gridEl) return;

    const allChars = this.charListMgr.getAllCharacters();
    const favSet = new Set(this.settingsMgr.get().favorites || []);
    const activeKey = this.charListMgr.currentFolderKey;

    if (this.countEl) {
      this.countEl.textContent = `(共 ${allChars.length} 位)`;
    }

    const fragment = document.createDocumentFragment();
    allChars.forEach(({ folder, cfg, iconPath }) => {
      const skinLabel = cfg.skin || '預設';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'overview-avatar-btn';
      if (folder === activeKey) btn.classList.add('active');
      if (favSet.has(folder)) btn.classList.add('is-fav');

      btn.dataset.folder = folder;
      btn.dataset.name = cfg.name;
      btn.dataset.skin = skinLabel;
      btn.innerHTML = `<img src="file:///${iconPath}" loading="lazy" alt="${cfg.name}" />`;

      btn.onclick = () => {
        this.charListMgr.selectByFolder(folder);
        this.closeOverview();
      };
      fragment.appendChild(btn);
    });

    this.gridEl.innerHTML = '';
    this.gridEl.appendChild(fragment);
    this.modalEl.classList.add('show');
  }

  closeOverview() {
    if (this.modalEl) {
      this.modalEl.classList.remove('show');
    }
    this.hideTooltip();
  }

  isOverviewOpen() {
    return !!(this.modalEl && this.modalEl.classList.contains('show'));
  }

  showTooltip(name, skin, clientX, clientY) {
    if (!this.tooltipEl) return;
    this.tooltipEl.innerHTML = `
      <div class="tooltip-name">${name}</div>
      <div class="tooltip-skin">${skin}</div>
    `;
    this.tooltipEl.classList.add('show');

    const rect = this.tooltipEl.getBoundingClientRect();
    let left = clientX + 14;
    let top = clientY - rect.height - 12;

    if (left + rect.width > window.innerWidth - 12) {
      left = clientX - rect.width - 14;
    }
    if (top < 12) {
      top = clientY + 18;
    }

    this.tooltipEl.style.left = `${left}px`;
    this.tooltipEl.style.top = `${top}px`;
  }

  hideTooltip() {
    if (this.tooltipEl) {
      this.tooltipEl.classList.remove('show');
    }
  }
}

module.exports = RosterToolsManager;