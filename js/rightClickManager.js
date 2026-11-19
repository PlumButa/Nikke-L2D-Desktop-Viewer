class RightClickManager {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {SpineManager} spineMgr
   * @param {Object} callbacks - { isPetMode, getCurrentPose, getCurrentFolder, getCurrentConfig, onSwitchPose, onExtraItemsChange }
   */
  constructor(canvas, spineMgr, callbacks) {
    this.canvas = canvas;
    this.spineMgr = spineMgr;
    this.callbacks = callbacks;

    this.menuEl = document.getElementById('pet-context-menu');
    this.menuItems = Array.from(this.menuEl.querySelectorAll('.pet-menu-item[data-pose]'));
    this.extraListEl = document.getElementById('pet-menu-extra-list');
    this.customActions = [];

    this.initEvents();
  }

  initEvents() {
    // 在畫布上點擊右鍵
    this.canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.handleRightClick(e);
    });

    // 點擊右鍵選單內的姿態項目
    this.menuItems.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (btn.disabled) return;
        const targetPose = btn.dataset.pose;
        this.hideMenu();
        if (targetPose && targetPose !== this.callbacks.getCurrentPose()) {
          this.callbacks.onSwitchPose(targetPose);
        }
      });
    });

    // 點擊選單外部時自動關閉選單
    window.addEventListener('mousedown', (e) => {
      if (this.isMenuOpen() && !this.menuEl.contains(e.target)) {
        this.hideMenu();
      }
    });

    // 按下 Escape 時關閉選單
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isMenuOpen()) {
        this.hideMenu();
      }
    });
  }

  isMenuOpen() {
    return this.menuEl && this.menuEl.classList.contains('show');
  }

  hideMenu() {
    if (this.menuEl) {
      this.menuEl.classList.remove('show');
    }
  }

  handleRightClick(e) {
    if (!this.callbacks.isPetMode()) return;

    const alpha = this.spineMgr.getPixelAlphaAt(e.clientX, e.clientY);
    if (alpha <= 15) {
      this.hideMenu();
      return;
    }

    this.showMenuAt(e.clientX, e.clientY);
    this.customActions.forEach(fn => fn(e));
  }

  // 依據目前模型的額外 Skin 數量，動態建立右鍵選單下方的「額外物品顯示」選項
  renderExtraItemsSection() {
    if (!this.extraListEl) return;
    this.extraListEl.innerHTML = '';

    const skins = this.spineMgr.extraSkins || [];
    const activeIdx = this.spineMgr.extraSkinModeIndex;

    // 情況 1：沒有任何額外物品 -> 顯示變暗且無法點擊的按鈕
    if (!this.spineMgr.hasExtraItems || skins.length === 0) {
      const btn = document.createElement('button');
      btn.className = 'pet-menu-item';
      btn.disabled = true;
      btn.textContent = '🎡 無額外物品';
      this.extraListEl.appendChild(btn);
      return;
    }

    // 情況 2：僅有 1 組額外物品 -> 單顆顯示/隱藏切換開關
    if (skins.length === 1) {
      const isShowing = activeIdx === 0;
      const btn = document.createElement('button');
      btn.className = `pet-menu-item${isShowing ? ' active' : ''}`;
      btn.textContent = isShowing ? '🎡 隱藏額外物品' : '🎡 顯示額外物品';
      btn.onclick = (e) => {
        e.stopPropagation();
        this.spineMgr.setExtraSkinMode(isShowing ? -1 : 0);
        if (this.callbacks.onExtraItemsChange) this.callbacks.onExtraItemsChange();
        this.hideMenu();
      };
      this.extraListEl.appendChild(btn);
      return;
    }

    // 情況 3：有 2 組以上額外物品 -> 展開列出「隱藏」與各組獨立 Skin，點擊直達無須反覆切換
    const hideBtn = document.createElement('button');
    hideBtn.className = `pet-menu-item${activeIdx === -1 ? ' active' : ''}`;
    hideBtn.textContent = '🎡 隱藏額外物品';
    hideBtn.onclick = (e) => {
      e.stopPropagation();
      this.spineMgr.setExtraSkinMode(-1);
      if (this.callbacks.onExtraItemsChange) this.callbacks.onExtraItemsChange();
      this.hideMenu();
    };
    this.extraListEl.appendChild(hideBtn);

    skins.forEach((skin, idx) => {
      const btn = document.createElement('button');
      btn.className = `pet-menu-item${activeIdx === idx ? ' active' : ''}`;
      btn.textContent = `🎡 [${idx + 1}/${skins.length}] ${skin.name}`;
      btn.onclick = (e) => {
        e.stopPropagation();
        this.spineMgr.setExtraSkinMode(idx);
        if (this.callbacks.onExtraItemsChange) this.callbacks.onExtraItemsChange();
        this.hideMenu();
      };
      this.extraListEl.appendChild(btn);
    });
  }

  showMenuAt(clientX, clientY) {
    const folder = this.callbacks.getCurrentFolder();
    const cfg = this.callbacks.getCurrentConfig();
    if (!folder || !cfg) return;

    const currentPose = this.callbacks.getCurrentPose();

    const labels = {
      standing: '🧜‍♀️ 全身 (Full)',
      cover: '🛡️ 防守 (Cover)',
      aim: '🎯 攻擊 (Aim)'
    };

    // 1. 更新姿態模式選項
    this.menuItems.forEach((btn) => {
      const pose = btn.dataset.pose;
      const hasAsset = !!this.spineMgr.resolvePoseFiles(folder, cfg, pose);
      btn.disabled = !hasAsset;
      btn.classList.toggle('active', pose === currentPose);
      btn.textContent = hasAsset ? labels[pose] : `${labels[pose]} (無素材)`;
    });

    // 2. 更新額外物品區塊 (在計算邊界前渲染，確保選單高度精準不超出螢幕)
    this.renderExtraItemsSection();

    this.menuEl.classList.add('show');

    const rect = this.menuEl.getBoundingClientRect();
    const maxX = window.innerWidth - rect.width - 12;
    const maxY = window.innerHeight - rect.height - 12;
    const finalX = Math.max(12, Math.min(clientX, maxX));
    const finalY = Math.max(12, Math.min(clientY, maxY));

    this.menuEl.style.left = `${finalX}px`;
    this.menuEl.style.top = `${finalY}px`;
  }

  registerCustomAction(actionFn) {
    if (typeof actionFn === 'function') {
      this.customActions.push(actionFn);
    }
  }
}

module.exports = RightClickManager;