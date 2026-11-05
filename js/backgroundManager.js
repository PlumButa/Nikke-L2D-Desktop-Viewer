const fs = require('fs');

class BackgroundManager {
  constructor(settingsMgr, ipcRenderer, stageContainer) {
    this.settingsMgr = settingsMgr;
    this.ipcRenderer = ipcRenderer;
    this.stageContainer = stageContainer;

    this.bgLayer = document.getElementById('bg-layer');
    this.bgImgEl = document.getElementById('bg-image-el');
    this.popover = document.getElementById('bg-settings-popover');

    this.naturalWidth = 0;
    this.naturalHeight = 0;

    this.initEvents();
  }

  initEvents() {
    // 開啟 / 切換「背景設置」氣泡面板
    document.getElementById('bg-settings-btn').onclick = (e) => {
      e.stopPropagation();
      this.popover.classList.toggle('show');
    };

    // 確認並關閉按鈕
    document.getElementById('bg-close-btn').onclick = () => {
      this.popover.classList.remove('show');
    };

    // 背景載入按鈕
    document.getElementById('bg-upload-btn').onclick = async () => {
      const filePath = await this.ipcRenderer.invoke('select-bg-image');
      if (filePath) {
        // 載入新背景時重置移動、縮放與旋轉為預設值
        this.settingsMgr.save({
          bgImage: filePath,
          bgOffsetX: 0,
          bgOffsetY: 0,
          bgScale: 100,
          bgRotation: 0
        });
        this.syncUI();
        this.applyBackground();
      }
    };

    // 取消背景按鈕 (清除圖片並重設滑桿)
    document.getElementById('bg-clear-btn').onclick = () => {
      this.settingsMgr.save({
        bgImage: '',
        bgOffsetX: 0,
        bgOffsetY: 0,
        bgScale: 100,
        bgRotation: 0
      });
      this.syncUI();
      this.applyBackground();
    };

    // 背景底色選擇器
    document.getElementById('bg-color').oninput = (e) => {
      const color = e.target.value;
      this.settingsMgr.save({ bgColor: color });
      this.applyBackground();
    };

    // 背景 X 軸移動滑桿
    document.getElementById('bg-x-slider').oninput = (e) => {
      const val = parseInt(e.target.value, 10);
      document.getElementById('bg-x-label').textContent = `${val}px`;
      this.settingsMgr.save({ bgOffsetX: val });
      this.updateTransform();
    };

    // 背景 Y 軸移動滑桿
    document.getElementById('bg-y-slider').oninput = (e) => {
      const val = parseInt(e.target.value, 10);
      document.getElementById('bg-y-label').textContent = `${val}px`;
      this.settingsMgr.save({ bgOffsetY: val });
      this.updateTransform();
    };

    // 背景縮放滑桿
    document.getElementById('bg-scale-slider').oninput = (e) => {
      const val = parseInt(e.target.value, 10);
      document.getElementById('bg-scale-label').textContent = `${val}%`;
      this.settingsMgr.save({ bgScale: val });
      this.updateTransform();
    };

    // 背景旋轉滑桿
    document.getElementById('bg-rot-slider').oninput = (e) => {
      const val = parseInt(e.target.value, 10);
      document.getElementById('bg-rot-label').textContent = `${val}°`;
      this.settingsMgr.save({ bgRotation: val });
      this.updateTransform();
    };

    // 視窗大小改變時重新計算自適應基底比例
    window.addEventListener('resize', () => this.updateTransform());
  }

  syncUI() {
    const s = this.settingsMgr.get();
    document.getElementById('bg-color').value = s.bgColor || '#141720';

    const bx = s.bgOffsetX || 0;
    const by = s.bgOffsetY || 0;
    const bScale = s.bgScale !== undefined ? s.bgScale : 100;
    const bRot = s.bgRotation || 0;

    document.getElementById('bg-x-slider').value = bx;
    document.getElementById('bg-x-label').textContent = `${bx}px`;

    document.getElementById('bg-y-slider').value = by;
    document.getElementById('bg-y-label').textContent = `${by}px`;

    document.getElementById('bg-scale-slider').value = bScale;
    document.getElementById('bg-scale-label').textContent = `${bScale}%`;

    document.getElementById('bg-rot-slider').value = bRot;
    document.getElementById('bg-rot-label').textContent = `${bRot}°`;
  }

  applyBackground() {
    const s = this.settingsMgr.get();
    document.body.style.backgroundColor = s.bgColor || '#141720';

    if (s.bgImage && fs.existsSync(s.bgImage)) {
      const normalizedUrl = 'file:///' + s.bgImage.replace(/\\/g, '/');
      this.bgImgEl.onload = () => {
        this.naturalWidth = this.bgImgEl.naturalWidth || 1920;
        this.naturalHeight = this.bgImgEl.naturalHeight || 1080;
        this.bgLayer.classList.add('has-image');
        this.updateTransform();
      };
      this.bgImgEl.src = normalizedUrl;
    } else {
      this.bgImgEl.src = '';
      this.bgLayer.classList.remove('has-image');
    }
  }

  updateTransform() {
    if (!this.bgLayer.classList.contains('has-image') || !this.naturalWidth) return;
    const s = this.settingsMgr.get();

    const stageW = this.stageContainer.clientWidth || 1280;
    const stageH = this.stageContainer.clientHeight || 800;

    // 100% 時預設剛好填滿畫布 (同 cover 比例)
    const baseCoverScale = Math.max(stageW / this.naturalWidth, stageH / this.naturalHeight);
    const finalScale = baseCoverScale * ((s.bgScale !== undefined ? s.bgScale : 100) / 100);
    const ox = s.bgOffsetX || 0;
    const oy = s.bgOffsetY || 0;
    const rot = s.bgRotation || 0;

    this.bgImgEl.style.transform =
      `translate(calc(-50% + ${ox}px), calc(-50% + ${oy}px)) rotate(${rot}deg) scale(${finalScale})`;
  }

  // 供「截取畫面」將當前移動/縮放/旋轉後的背景合成至畫布
  async drawToCanvas(ctx, width, height) {
    const s = this.settingsMgr.get();
    ctx.fillStyle = s.bgColor || '#141720';
    ctx.fillRect(0, 0, width, height);

    if (s.bgImage && fs.existsSync(s.bgImage) && this.naturalWidth > 0) {
      const baseCoverScale = Math.max(width / this.naturalWidth, height / this.naturalHeight);
      const finalScale = baseCoverScale * ((s.bgScale !== undefined ? s.bgScale : 100) / 100);
      const ox = s.bgOffsetX || 0;
      const oy = s.bgOffsetY || 0;
      const rad = ((s.bgRotation || 0) * Math.PI) / 180;

      ctx.save();
      ctx.translate(width / 2 + ox, height / 2 + oy);
      ctx.rotate(rad);
      ctx.scale(finalScale, finalScale);
      ctx.drawImage(this.bgImgEl, -this.naturalWidth / 2, -this.naturalHeight / 2);
      ctx.restore();
    }
  }
}

module.exports = BackgroundManager;