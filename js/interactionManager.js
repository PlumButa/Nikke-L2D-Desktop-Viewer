class InteractionManager {
  constructor(spineMgr, lipSyncMgr, settingsMgr, canvas) {
    this.spineMgr = spineMgr;
    this.lipSyncMgr = lipSyncMgr;
    this.settingsMgr = settingsMgr;
    this.canvas = canvas;

    const s = this.settingsMgr.get();
    this.bubbleOffsetX = s.bubbleOffsetX;
    this.bubbleOffsetY = s.bubbleOffsetY;
    this.bubbleFontSize = s.bubbleFontSize;
    this.bubbleTimer = null;

    this.initEvents();
  }

  initEvents() {
    document.getElementById('voice-filter').onchange = (e) => {
      this.settingsMgr.save({ voiceFilter: e.target.value });
    };

    document.getElementById('bubble-y-slider').oninput = (e) => {
      this.bubbleOffsetY = parseInt(e.target.value, 10);
      document.getElementById('bubble-y-label').textContent = `${this.bubbleOffsetY}px`;
      this.settingsMgr.save({ bubbleOffsetY: this.bubbleOffsetY });
    };

    document.getElementById('bubble-x-slider').oninput = (e) => {
      this.bubbleOffsetX = parseInt(e.target.value, 10);
      document.getElementById('bubble-x-label').textContent = `${this.bubbleOffsetX}px`;
      this.settingsMgr.save({ bubbleOffsetX: this.bubbleOffsetX });
    };

    document.getElementById('bubble-font-slider').oninput = (e) => {
      this.bubbleFontSize = parseInt(e.target.value, 10);
      document.getElementById('bubble-font-label').textContent = `${this.bubbleFontSize}px`;
      document.getElementById('bubble-text').style.fontSize = `${this.bubbleFontSize}px`;
      this.settingsMgr.save({ bubbleFontSize: this.bubbleFontSize });
    };
  }

  syncUI() {
    const s = this.settingsMgr.get();
    this.bubbleOffsetX = s.bubbleOffsetX;
    this.bubbleOffsetY = s.bubbleOffsetY;
    this.bubbleFontSize = s.bubbleFontSize;

    document.getElementById('voice-filter').value = s.voiceFilter || 'lobby';
    document.getElementById('bubble-y-slider').value = s.bubbleOffsetY;
    document.getElementById('bubble-y-label').textContent = `${s.bubbleOffsetY}px`;
    document.getElementById('bubble-x-slider').value = s.bubbleOffsetX;
    document.getElementById('bubble-x-label').textContent = `${s.bubbleOffsetX}px`;
    document.getElementById('bubble-font-slider').value = s.bubbleFontSize;
    document.getElementById('bubble-font-label').textContent = `${s.bubbleFontSize}px`;
    document.getElementById('bubble-text').style.fontSize = `${s.bubbleFontSize}px`;
  }

  // 根據當前姿勢自動切換「點擊觸發語音範圍」
  syncVoiceFilterWithPose(poseType) {
    const voiceFilterEl = document.getElementById('voice-filter');
    if (!voiceFilterEl) return;

    if (poseType === 'standing') {
      voiceFilterEl.value = 'lobby';
    } else if (poseType === 'cover') {
      voiceFilterEl.value = 'cover';
    } else if (poseType === 'aim') {
      voiceFilterEl.value = 'aim';
    }
    this.settingsMgr.save({ voiceFilter: voiceFilterEl.value });
  }

  getFilteredVoicePool(currentConfig) {
    if (!currentConfig || !currentConfig.interactions?.length) return [];
    const pool = currentConfig.interactions;
    const filterMode = document.getElementById('voice-filter').value;

    if (filterMode === 'lobby') {
      const lobbyKeywords = ['大廳', '基地', '好感度'];
      const filtered = pool.filter(v => lobbyKeywords.some(kw => v.category.includes(kw)));
      if (filtered.length > 0) return filtered;
    } else if (filterMode === 'cover') {
      const coverKeywords = ['換彈', '編隊', '野外', '進入戰鬥', '開始戰鬥', '可使用爆裂'];
      const filtered = pool.filter(v => coverKeywords.some(kw => v.category.includes(kw)));
      if (filtered.length > 0) return filtered;
    } else if (filterMode === 'aim') {
      const aimKeywords = ['爆裂', '進入戰鬥', '開始戰鬥', '消滅敵人', '戰鬥勝利', '被擊'];
      const filtered = pool.filter(v => aimKeywords.some(kw => v.category.includes(kw)));
      if (filtered.length > 0) return filtered;
    }

    return pool;
  }

  playVoiceAndBubbleOnly(currentFolder, currentConfig, item) {
    if (!item || !currentConfig) return;

    const bubble = document.getElementById('speech-bubble');
    document.getElementById('bubble-name').textContent = `${currentConfig.name} (${item.category})`;
    const textEl = document.getElementById('bubble-text');
    textEl.textContent = item.text;
    textEl.style.fontSize = `${this.bubbleFontSize}px`;
    bubble.classList.add('show');

    if (this.bubbleTimer) clearTimeout(this.bubbleTimer);

    this.lipSyncMgr.playVoice(currentFolder, item.audio, () => {
      this.bubbleTimer = setTimeout(() => bubble.classList.remove('show'), 1500);
    });
  }

  triggerInteraction(currentFolder, currentConfig, specificIndex = null) {
    if (!currentConfig || !currentConfig.interactions?.length) return;

    let targetItem = null;
    if (specificIndex !== null) {
      targetItem = currentConfig.interactions[specificIndex];
    } else {
      const pool = this.getFilteredVoicePool(currentConfig);
      targetItem = pool[Math.floor(Math.random() * pool.length)];
    }

    if (!targetItem) return;

    this.spineMgr.playInteractionAnimation(targetItem.animation);
    this.playVoiceAndBubbleOnly(currentFolder, currentConfig, targetItem);
  }

  updateOverlayPositions(isPetMode) {
    const anchors = this.spineMgr.getCharacterAnchors();
    if (!anchors) return;

    const bubble = document.getElementById('speech-bubble');
    const bx = Math.min(Math.max(190, anchors.head.x + this.bubbleOffsetX), this.canvas.clientWidth - 190);
    const by = Math.max(85, anchors.head.y + this.bubbleOffsetY);
    bubble.style.left = `${bx}px`;
    bubble.style.top = `${by}px`;

    if (isPetMode) {
      const bar = document.getElementById('pet-Floating-Bar');
      const barX = Math.min(Math.max(140, anchors.foot.x), this.canvas.clientWidth - 140);
      const barY = Math.min(this.canvas.clientHeight - 35, Math.max(60, anchors.foot.y + 20));
      bar.style.left = `${barX}px`;
      bar.style.top = `${barY}px`;
      bar.style.bottom = 'auto';
    }
  }
}

module.exports = InteractionManager;