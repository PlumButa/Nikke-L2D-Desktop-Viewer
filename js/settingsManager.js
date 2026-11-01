const fs = require('fs');
const path = require('path');

class SettingsManager {
  constructor() {
    this.filePath = path.join(__dirname, '..', 'user_settings.json');
    this.defaults = {
      lastCharacterFolder: '',
      voiceFilter: 'lobby',
      speed: 1.0,
      scale: 100,
      rotation: 0,       // 角色旋轉角度 (0 ~ 360)
      mirrored: false,   // 是否左右鏡射
      aimShake: 100,     // 攻擊 (Aim) 抖動幅度百分比 (預設 100%)
      bubbleOffsetY: -55,
      bubbleOffsetX: 105,
      bubbleFontSize: 19,
      bgColor: '#141720',
      bgImage: '',       // 自訂背景圖片路徑
      camOffsetX: 0,
      camOffsetY: 0,
      favorites: []      // 我的最愛角色資料夾清單
    };
    this.settings = this.load();
  }

  load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        return { ...this.defaults, ...JSON.parse(raw) };
      }
    } catch (err) {
      console.error('讀取 user_settings.json 失敗，使用預設值:', err);
    }
    return { ...this.defaults };
  }

  save(partialSettings = {}) {
    this.settings = { ...this.settings, ...partialSettings };
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(this.settings, null, 2), 'utf-8');
    } catch (err) {
      console.error('儲存 user_settings.json 失敗:', err);
    }
    return this.settings;
  }

  get() {
    return this.settings;
  }
}

module.exports = SettingsManager;