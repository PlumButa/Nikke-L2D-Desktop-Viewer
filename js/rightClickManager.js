class RightClickManager {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {SpineManager} spineMgr
   * @param {Object} callbacks - { isPetMode, getCurrentPose, getCurrentFolder, getCurrentConfig, onSwitchPose }
   */
  constructor(canvas, spineMgr, callbacks) {
    this.canvas = canvas;
    this.spineMgr = spineMgr;
    this.callbacks = callbacks;

    this.menuEl = document.getElementById('pet-context-menu');
    this.menuItems = Array.from(this.menuEl.querySelectorAll('.pet-menu-item[data-pose]'));
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
    // 僅在桌寵模式且右鍵點擊在妮姬立繪像素上時彈出選單
    if (!this.callbacks.isPetMode()) return;

    const alpha = this.spineMgr.getPixelAlphaAt(e.clientX, e.clientY);
    if (alpha <= 15) {
      this.hideMenu();
      return;
    }

    this.showMenuAt(e.clientX, e.clientY);
    this.customActions.forEach(fn => fn(e));
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

    // 更新每個選項的可用狀態與當前選中狀態
    this.menuItems.forEach((btn) => {
      const pose = btn.dataset.pose;
      const hasAsset = !!this.spineMgr.resolvePoseFiles(folder, cfg, pose);
      btn.disabled = !hasAsset;
      btn.classList.toggle('active', pose === currentPose);
      btn.textContent = hasAsset ? labels[pose] : `${labels[pose]} (無素材)`;
    });

    this.menuEl.classList.add('show');

    // 防止選單超出螢幕右邊或下邊界
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