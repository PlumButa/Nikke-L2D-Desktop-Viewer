const fs = require('fs');
const path = require('path');
const { ipcRenderer } = require('electron');
const SpineManager = require('./js/spineManager');
const LipSyncManager = require('./js/lipSyncManager');
const SettingsManager = require('./js/settingsManager');

const canvas = document.getElementById('spine-canvas');
const settingsMgr = new SettingsManager();
const spineMgr = new SpineManager(canvas);
const lipSyncMgr = new LipSyncManager(spineMgr);

let currentConfig = null;
let currentFolder = null;
let currentFolderKey = '';
let currentPose = 'standing'; // 'standing' | 'cover' | 'aim'
let currentTab = 'all';       // 'all' | 'fav'
let isPetMode = false;
let isOverPetBar = false;
let bubbleTimer = null;
let petBarTimer = null;
let autoExpressionTimer = null;

// 從 user_settings.json 載入記憶設定
const userSettings = settingsMgr.get();
let bubbleOffsetX = userSettings.bubbleOffsetX;
let bubbleOffsetY = userSettings.bubbleOffsetY;
let bubbleFontSize = userSettings.bubbleFontSize;

// 拖曳視角與「攻擊模式按住立繪連射」控制參數
let isDragging = false, dragStartX = 0, dragStartY = 0, movedDistance = 0;
let aimHoldTimer = null;
let isHoldingCharacterFire = false;

// 套用背景顏色或自訂背景圖片
function applyBackgroundStyle(bgColor, bgImage) {
  document.body.style.backgroundColor = bgColor || '#141720';
  if (bgImage && fs.existsSync(bgImage)) {
    const normalizedUrl = 'file:///' + bgImage.replace(/\\/g, '/');
    document.body.style.backgroundImage = `url("${normalizedUrl}")`;
  } else {
    document.body.style.backgroundImage = 'none';
  }
}

// 同步旋轉與鏡射的 UI 狀態
function syncTransformUI(rotation, mirrored) {
  const rotDeg = ((Math.round(rotation) % 360) + 360) % 360;
  document.getElementById('rotation-slider').value = rotDeg;
  document.getElementById('rotation-label').textContent = `${rotDeg}°`;

  const mirrorBtn = document.getElementById('mirror-btn');
  const toolbarMirrorBtn = document.getElementById('toolbar-mirror');
  mirrorBtn.classList.toggle('active', !!mirrored);
  toolbarMirrorBtn.classList.toggle('active', !!mirrored);
}

// 1. 初始化左側控制面板數值
function applySavedSettingsToUI() {
  const s = settingsMgr.get();
  spineMgr.timeScale = s.speed;
  spineMgr.aimShakeScale = (s.aimShake !== undefined ? s.aimShake : 100) / 100;
  spineMgr.setRotation(s.rotation || 0);
  spineMgr.setMirror(s.mirrored || false);

  document.getElementById('voice-filter').value = s.voiceFilter || 'lobby';
  document.getElementById('speed-slider').value = s.speed;
  document.getElementById('speed-label').textContent = Number(s.speed).toFixed(2) + 'x';

  document.getElementById('scale-slider').value = s.scale;
  document.getElementById('scale-label').textContent = `${s.scale}%`;

  syncTransformUI(s.rotation || 0, s.mirrored || false);

  const aimShakeVal = s.aimShake !== undefined ? s.aimShake : 100;
  document.getElementById('aim-shake-slider').value = aimShakeVal;
  document.getElementById('aim-shake-label').textContent = `${aimShakeVal}%`;

  document.getElementById('bubble-y-slider').value = s.bubbleOffsetY;
  document.getElementById('bubble-y-label').textContent = `${s.bubbleOffsetY}px`;

  document.getElementById('bubble-x-slider').value = s.bubbleOffsetX;
  document.getElementById('bubble-x-label').textContent = `${s.bubbleOffsetX}px`;

  document.getElementById('bubble-font-slider').value = s.bubbleFontSize;
  document.getElementById('bubble-font-label').textContent = `${s.bubbleFontSize}px`;
  document.getElementById('bubble-text').style.fontSize = `${s.bubbleFontSize}px`;

  document.getElementById('bg-color').value = s.bgColor;
  applyBackgroundStyle(s.bgColor, s.bgImage);
}

spineMgr.onTrack0Change = (animName) => {
  const animSelect = document.getElementById('anim-select');
  if (animSelect && animSelect.value !== animName) {
    animSelect.value = animName;
  }
};

function syncVoiceFilterWithPose(poseType) {
  const voiceFilterEl = document.getElementById('voice-filter');
  if (!voiceFilterEl) return;

  if (poseType === 'standing') {
    voiceFilterEl.value = 'lobby';
  } else if (poseType === 'cover') {
    voiceFilterEl.value = 'cover';
  } else if (poseType === 'aim') {
    voiceFilterEl.value = 'aim';
  }
  settingsMgr.save({ voiceFilter: voiceFilterEl.value });
}

// 更新右上角「加入我的最愛」按鈕狀態
function updateFavoriteButtonUI() {
  const favBtn = document.getElementById('fav-toggle-btn');
  if (!favBtn || !currentFolderKey) return;
  const favs = settingsMgr.get().favorites || [];
  const isFav = favs.includes(currentFolderKey);
  favBtn.classList.toggle('favorited', isFav);
  favBtn.textContent = isFav ? '⭐ 已在我的最愛' : '☆ 加入我的最愛';
}

// 2. 掃描角色資料夾 (支援「所有妮姬」與「我的最愛」分頁過濾)
function scanCharacters(filterText = '') {
  const charsDir = path.join(__dirname, 'assets', 'characters');
  const listEl = document.getElementById('char-list');
  listEl.innerHTML = '';

  if (!fs.existsSync(charsDir)) return;
  const folders = fs.readdirSync(charsDir);

  const s = settingsMgr.get();
  const savedFolder = s.lastCharacterFolder;
  const favList = s.favorites || [];
  let targetToSelect = null;

  folders.forEach((folder) => {
    if (currentTab === 'fav' && !favList.includes(folder)) {
      return;
    }

    const configPath = path.join(charsDir, folder, 'config.json');
    if (!fs.existsSync(configPath)) return;
    const cfg = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

    if (filterText && !cfg.name.includes(filterText) && !(cfg.skin || '').includes(filterText)) {
      return;
    }

    const isFav = favList.includes(folder);
    const iconPath = path.join(charsDir, folder, 'icon.png').replace(/\\/g, '/');
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
      selectCharacter(folder, cfg);
    };
    listEl.appendChild(card);

    if (!targetToSelect || folder === savedFolder) {
      targetToSelect = { folder, cfg, card };
    }
  });

  if (!currentConfig && targetToSelect) {
    targetToSelect.card.classList.add('active');
    selectCharacter(targetToSelect.folder, targetToSelect.cfg);
  } else if (currentConfig) {
    const activeCard = listEl.querySelector(`[data-folder="${currentFolderKey}"]`);
    if (activeCard) activeCard.classList.add('active');
  }
}

function updatePoseButtonsState(folderPath, cfg) {
  const hasCover = !!spineMgr.resolvePoseFiles(folderPath, cfg, 'cover');
  const hasAim = !!spineMgr.resolvePoseFiles(folderPath, cfg, 'aim');

  const coverBtn = document.getElementById('pose-cover-btn');
  const aimBtn = document.getElementById('pose-aim-btn');

  coverBtn.disabled = !hasCover;
  coverBtn.textContent = hasCover ? '🛡️ 防守 (Cover)' : '🛡️ 防守 (無素材)';

  aimBtn.disabled = !hasAim;
  aimBtn.textContent = hasAim ? '🎯 攻擊 (Aim)' : '🎯 攻擊 (無素材)';

  document.querySelectorAll('.pose-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.pose === currentPose);
  });
}

function loadCurrentPoseModel() {
  if (!currentFolder || !currentConfig) return;
  lipSyncMgr.stopVoice();

  syncVoiceFilterWithPose(currentPose);
  updatePoseButtonsState(currentFolder, currentConfig);
  updateFavoriteButtonUI();

  spineMgr.loadCharacter(currentFolder, currentConfig, settingsMgr.get(), (animations, defaultAnimName) => {
    const animSelect = document.getElementById('anim-select');
    animSelect.innerHTML = '';
    animations.forEach(anim => {
      const opt = document.createElement('option');
      opt.value = anim.name;
      opt.textContent = anim.name;
      if (anim.name === defaultAnimName) opt.selected = true;
      animSelect.appendChild(opt);
    });
  }, currentPose);
}

function selectCharacter(folder, cfg) {
  currentFolderKey = folder;
  currentFolder = path.join(__dirname, 'assets', 'characters', folder);
  currentConfig = cfg;
  currentPose = 'standing';

  settingsMgr.save({ lastCharacterFolder: folder });
  loadCurrentPoseModel();

  const voiceSelect = document.getElementById('voice-select');
  voiceSelect.innerHTML = '<option value="">-- 點選播放語音 --</option>';
  (cfg.interactions || []).forEach((item, i) => {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = `[${item.category}] ${item.text.slice(0, 14)}...`;
    voiceSelect.appendChild(opt);
  });
}

// 綁定「加入我的最愛」按鈕與右側分頁切換
document.getElementById('fav-toggle-btn').onclick = () => {
  if (!currentFolderKey) return;
  const favs = new Set(settingsMgr.get().favorites || []);
  if (favs.has(currentFolderKey)) {
    favs.delete(currentFolderKey);
  } else {
    favs.add(currentFolderKey);
  }
  settingsMgr.save({ favorites: Array.from(favs) });
  updateFavoriteButtonUI();
  scanCharacters(document.getElementById('search-input').value.trim());
};

document.getElementById('tab-all-btn').onclick = () => {
  currentTab = 'all';
  document.getElementById('tab-all-btn').classList.add('active');
  document.getElementById('tab-fav-btn').classList.remove('active');
  scanCharacters(document.getElementById('search-input').value.trim());
};

document.getElementById('tab-fav-btn').onclick = () => {
  currentTab = 'fav';
  document.getElementById('tab-fav-btn').classList.add('active');
  document.getElementById('tab-all-btn').classList.remove('active');
  scanCharacters(document.getElementById('search-input').value.trim());
};

// 右上角姿勢切換按鈕事件
document.querySelectorAll('.pose-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const targetPose = btn.dataset.pose;
    if (currentPose === targetPose && targetPose !== 'standing') {
      currentPose = 'standing';
    } else if (currentPose !== targetPose) {
      currentPose = targetPose;
    } else {
      return;
    }
    loadCurrentPoseModel();
  });
});

// 3. 依目前語音範圍設定篩選語音池
function getFilteredVoicePool() {
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

function playVoiceAndBubbleOnly(item) {
  if (!item) return;

  const bubble = document.getElementById('speech-bubble');
  document.getElementById('bubble-name').textContent = `${currentConfig.name} (${item.category})`;
  const textEl = document.getElementById('bubble-text');
  textEl.textContent = item.text;
  textEl.style.fontSize = `${bubbleFontSize}px`;
  bubble.classList.add('show');

  if (bubbleTimer) clearTimeout(bubbleTimer);

  lipSyncMgr.playVoice(currentFolder, item.audio, () => {
    bubbleTimer = setTimeout(() => bubble.classList.remove('show'), 1500);
  });
}

function triggerInteraction(specificIndex = null) {
  if (!currentConfig || !currentConfig.interactions?.length) return;

  let targetItem = null;
  if (specificIndex !== null) {
    targetItem = currentConfig.interactions[specificIndex];
  } else {
    const pool = getFilteredVoicePool();
    targetItem = pool[Math.floor(Math.random() * pool.length)];
  }

  if (!targetItem) return;

  spineMgr.playInteractionAnimation(targetItem.animation);
  playVoiceAndBubbleOnly(targetItem);
}

// 4. 桌寵模式定時隨機自動觸發
function scheduleNextAutoExpression() {
  if (autoExpressionTimer) clearTimeout(autoExpressionTimer);
  if (!isPetMode) return;

  const randomDelay = Math.floor(Math.random() * 3000) + 12000; //12~15秒
  autoExpressionTimer = setTimeout(() => {
    if (isPetMode && !spineMgr.isPaused && !lipSyncMgr.isSpeaking) {
      spineMgr.triggerPetAutoAction();
    }
    scheduleNextAutoExpression();
  }, randomDelay);
}

// 5. 【桌寵攻擊 (Aim) 模式專用】接收全局滑鼠座標
ipcRenderer.on('global-cursor-move', (event, { normX, normY }) => {
  if (!isPetMode || currentPose !== 'aim' || spineMgr.isPaused) return;
  spineMgr.setAimCursorTracking(true, normX, normY);
});

// 6. 桌寵控制條：滑鼠靠近立繪時顯示並維持 4 秒
function triggerPetBarShow() {
  if (!isPetMode) return;
  const bar = document.getElementById('pet-Floating-Bar');
  bar.classList.add('visible');

  if (petBarTimer) clearTimeout(petBarTimer);
  petBarTimer = setTimeout(() => {
    bar.classList.remove('visible');
  }, 4000);
}

// 7. 每一幀更新氣泡與桌寵控制條的錨點位置
function updateOverlayPositions() {
  const anchors = spineMgr.getCharacterAnchors();
  if (!anchors) return;

  const bubble = document.getElementById('speech-bubble');
  const bx = Math.min(Math.max(190, anchors.head.x + bubbleOffsetX), canvas.clientWidth - 190);
  const by = Math.max(85, anchors.head.y + bubbleOffsetY);
  bubble.style.left = `${bx}px`;
  bubble.style.top = `${by}px`;

  if (isPetMode) {
    const bar = document.getElementById('pet-Floating-Bar');
    const barX = Math.min(Math.max(140, anchors.foot.x), canvas.clientWidth - 140);
    const barY = Math.min(canvas.clientHeight - 35, Math.max(60, anchors.foot.y + 20));
    bar.style.left = `${barX}px`;
    bar.style.top = `${barY}px`;
    bar.style.bottom = 'auto';
  }
}

// 8. 滑鼠互動事件 (支援旋轉角度下的精準方向拖曳)
canvas.addEventListener('mousedown', e => {
  if (e.button !== 0) return;
  isDragging = true;
  movedDistance = 0;
  dragStartX = e.clientX;
  dragStartY = e.clientY;
  isHoldingCharacterFire = false;

  if (aimHoldTimer) {
    clearTimeout(aimHoldTimer);
    aimHoldTimer = null;
  }

  if (currentPose === 'aim' && e.target === canvas) {
    const alpha = spineMgr.getPixelAlphaAt(e.clientX, e.clientY);
    if (alpha > 15) {
      aimHoldTimer = setTimeout(() => {
        if (isDragging && movedDistance < 6) {
          isHoldingCharacterFire = true;
          spineMgr.startAimFireHold();
          const pool = getFilteredVoicePool();
          const randomItem = pool[Math.floor(Math.random() * pool.length)];
          playVoiceAndBubbleOnly(randomItem);
        }
      }, 180);
    }
  }
});

window.addEventListener('mousemove', e => {
  if (isDragging) {
    const dx = e.clientX - dragStartX;
    const dy = e.clientY - dragStartY;
    movedDistance += Math.abs(dx) + Math.abs(dy);

    if (movedDistance >= 6 && aimHoldTimer) {
      clearTimeout(aimHoldTimer);
      aimHoldTimer = null;
    }

    if (!isHoldingCharacterFire) {
      // 將螢幕拖曳向量根據當前旋轉角度換算回世界座標，確保任何角度下拖曳方向都跟隨滑鼠
      const rad = (spineMgr.rotationDeg * Math.PI) / 180;
      const worldDx = dx * Math.cos(rad) - dy * Math.sin(rad);
      const worldDy = dx * Math.sin(rad) + dy * Math.cos(rad);
      spineMgr.camX -= worldDx * spineMgr.camZoom;
      spineMgr.camY += worldDy * spineMgr.camZoom;
    }
    dragStartX = e.clientX;
    dragStartY = e.clientY;
  }

  if (isPetMode && !isDragging) {
    const alpha = spineMgr.getPixelAlphaAt(e.clientX, e.clientY);
    isOverPetBar = !!e.target.closest('#pet-Floating-Bar');
    const isCharacterHit = alpha > 15;

    if (isCharacterHit || isOverPetBar) {
      triggerPetBarShow();
    }
    ipcRenderer.send('set-ignore-mouse', !isCharacterHit && !isOverPetBar);
  }
});

window.addEventListener('mouseup', e => {
  if (aimHoldTimer) {
    clearTimeout(aimHoldTimer);
    aimHoldTimer = null;
  }

  if (isDragging) {
    if (isHoldingCharacterFire) {
      spineMgr.stopAimFireHold(3000);
      isHoldingCharacterFire = false;
    } else if (movedDistance < 6 && e.target === canvas) {
      const alpha = spineMgr.getPixelAlphaAt(e.clientX, e.clientY);
      if (alpha > 15) triggerInteraction();
    } else if (movedDistance >= 6) {
      settingsMgr.save({
        camOffsetX: Math.round(spineMgr.camX - spineMgr.defaultCamX),
        camOffsetY: Math.round(spineMgr.camY - spineMgr.defaultCamY)
      });
    }
  }
  isDragging = false;
});

canvas.addEventListener('wheel', e => {
  const factor = e.deltaY > 0 ? 1.1 : 0.9;
  zoomBy(factor);
});

function zoomBy(factor) {
  spineMgr.camZoom *= factor;
  const pct = Math.min(250, Math.max(25, Math.round((spineMgr.baseZoom / spineMgr.camZoom) * 100)));
  document.getElementById('scale-slider').value = pct;
  document.getElementById('scale-label').textContent = `${pct}%`;
  settingsMgr.save({ scale: pct });
}

// 旋轉與鏡射控制函式
function updateRotationBy(deltaDeg) {
  const nextDeg = (((spineMgr.rotationDeg + deltaDeg) % 360) + 360) % 360;
  spineMgr.setRotation(nextDeg);
  syncTransformUI(nextDeg, spineMgr.isMirrored);
  settingsMgr.save({ rotation: nextDeg });
}

function toggleMirror() {
  const nextMirror = !spineMgr.isMirrored;
  spineMgr.setMirror(nextMirror);
  syncTransformUI(spineMgr.rotationDeg, nextMirror);
  settingsMgr.save({ mirrored: nextMirror });
}

// 9. 左側面板與左上角工具列綁定
document.getElementById('anim-select').onchange = e => {
  spineMgr.clearAimFireTimer();
  if (spineMgr.animationState) {
    if (e.target.value === 'aim_fire') {
      spineMgr.startAimFireWithSubTracks();
    } else {
      spineMgr.clearAimFireSubTracks(0.15);
      // 使用智慧切換，讓下拉選單切到 shy / delight 時同樣保持呼吸同步無斷差
      spineMgr.setTrack0AnimationSmart(e.target.value, true);
    }
  }
};
document.getElementById('voice-filter').onchange = e => {
  settingsMgr.save({ voiceFilter: e.target.value });
};
document.getElementById('voice-select').onchange = e => {
  if (e.target.value !== '') triggerInteraction(Number(e.target.value));
};
document.getElementById('speed-slider').oninput = e => {
  const speed = parseFloat(e.target.value);
  spineMgr.timeScale = speed;
  document.getElementById('speed-label').textContent = speed.toFixed(2) + 'x';
  settingsMgr.save({ speed });
};
document.getElementById('scale-slider').oninput = e => {
  const pct = parseInt(e.target.value, 10);
  document.getElementById('scale-label').textContent = `${pct}%`;
  spineMgr.camZoom = spineMgr.baseZoom * (100 / pct);
  settingsMgr.save({ scale: pct });
};

// 旋轉滑桿與左上角順/逆時針旋轉按鈕
document.getElementById('rotation-slider').oninput = e => {
  const deg = parseInt(e.target.value, 10);
  spineMgr.setRotation(deg);
  syncTransformUI(deg, spineMgr.isMirrored);
  settingsMgr.save({ rotation: deg });
};
document.getElementById('toolbar-rot-ccw').onclick = () => updateRotationBy(-15);
document.getElementById('toolbar-rot-cw').onclick = () => updateRotationBy(15);

// 鏡射按鈕 (左側面板與左上角工具列同步)
document.getElementById('mirror-btn').onclick = toggleMirror;
document.getElementById('toolbar-mirror').onclick = toggleMirror;

document.getElementById('aim-shake-slider').oninput = e => {
  const pct = parseInt(e.target.value, 10);
  document.getElementById('aim-shake-label').textContent = `${pct}%`;
  spineMgr.aimShakeScale = pct / 100;
  settingsMgr.save({ aimShake: pct });

  if (currentPose === 'aim' && spineMgr.animationState) {
    spineMgr.triggerAimFireDuration(2000);
  }
};

document.getElementById('bubble-y-slider').oninput = e => {
  bubbleOffsetY = parseInt(e.target.value, 10);
  document.getElementById('bubble-y-label').textContent = `${bubbleOffsetY}px`;
  settingsMgr.save({ bubbleOffsetY });
};
document.getElementById('bubble-x-slider').oninput = e => {
  bubbleOffsetX = parseInt(e.target.value, 10);
  document.getElementById('bubble-x-label').textContent = `${bubbleOffsetX}px`;
  settingsMgr.save({ bubbleOffsetX });
};
document.getElementById('bubble-font-slider').oninput = e => {
  bubbleFontSize = parseInt(e.target.value, 10);
  document.getElementById('bubble-font-label').textContent = `${bubbleFontSize}px`;
  document.getElementById('bubble-text').style.fontSize = `${bubbleFontSize}px`;
  settingsMgr.save({ bubbleFontSize });
};

document.getElementById('reset-cam-btn').onclick = () => {
  settingsMgr.save({ scale: 100, rotation: 0, mirrored: false, camOffsetX: 0, camOffsetY: 0 });
  spineMgr.setRotation(0);
  spineMgr.setMirror(false);
  syncTransformUI(0, false);
  loadCurrentPoseModel();
  document.getElementById('scale-slider').value = 100;
  document.getElementById('scale-label').textContent = '100%';
};
document.getElementById('pause-btn').onclick = e => {
  spineMgr.isPaused = !spineMgr.isPaused;
  e.target.textContent = spineMgr.isPaused ? '繼續' : '暫停';
};
document.getElementById('bg-color').oninput = e => {
  const color = e.target.value;
  settingsMgr.save({ bgColor: color, bgImage: '' });
  applyBackgroundStyle(color, '');
};

// 🖼️ 載入背景圖片
document.getElementById('load-bg-btn').onclick = async () => {
  const filePath = await ipcRenderer.invoke('select-bg-image');
  if (filePath) {
    settingsMgr.save({ bgImage: filePath });
    applyBackgroundStyle(settingsMgr.get().bgColor, filePath);
  }
};

// 📸 截取畫面 (合成當前背景與 Spine 立繪畫布並彈出存檔視窗)
document.getElementById('screenshot-btn').onclick = async () => {
  const s = settingsMgr.get();
  const offCanvas = document.createElement('canvas');
  offCanvas.width = canvas.width;
  offCanvas.height = canvas.height;
  const ctx = offCanvas.getContext('2d');

  // 1. 填滿背景顏色
  ctx.fillStyle = s.bgColor || '#141720';
  ctx.fillRect(0, 0, offCanvas.width, offCanvas.height);

  // 2. 若有載入自訂背景圖，按 cover 比例繪製背景圖
  if (s.bgImage && fs.existsSync(s.bgImage)) {
    await new Promise((resolve) => {
      const bgImg = new Image();
      bgImg.onload = () => {
        const scale = Math.max(offCanvas.width / bgImg.width, offCanvas.height / bgImg.height);
        const w = bgImg.width * scale;
        const h = bgImg.height * scale;
        ctx.drawImage(bgImg, (offCanvas.width - w) / 2, (offCanvas.height - h) / 2, w, h);
        resolve();
      };
      bgImg.onerror = resolve;
      bgImg.src = 'file:///' + s.bgImage.replace(/\\/g, '/');
    });
  }

  // 3. 疊加當前 Spine WebGL 立繪畫布
  ctx.drawImage(canvas, 0, 0);

  const dataUrl = offCanvas.toDataURL('image/png');
  const charName = currentConfig ? `${currentConfig.name}_${currentConfig.skin || 'default'}` : 'Nikke';
  await ipcRenderer.invoke('save-screenshot', dataUrl, `${charName}_${Date.now()}.png`);
};

document.getElementById('search-input').oninput = e => {
  scanCharacters(e.target.value.trim());
};

// 桌寵模式切換
document.getElementById('enter-pet-btn').onclick = () => {
  isPetMode = true;
  document.body.classList.add('pet-mode');
  ipcRenderer.send('toggle-pet-mode', true);
  triggerPetBarShow();
  scheduleNextAutoExpression();
};
document.getElementById('exit-pet-btn').onclick = () => {
  isPetMode = false;
  isOverPetBar = false;
  spineMgr.setAimCursorTracking(false);
  if (petBarTimer) clearTimeout(petBarTimer);
  if (autoExpressionTimer) clearTimeout(autoExpressionTimer);
  spineMgr.returnToDefaultAnimation();
  document.getElementById('pet-Floating-Bar').classList.remove('visible');
  document.body.classList.remove('pet-mode');
  ipcRenderer.send('toggle-pet-mode', false);
};
window.addEventListener('keydown', e => {
  if (e.key === 'Escape' && isPetMode) document.getElementById('exit-pet-btn').click();
});

function loop() {
  spineMgr.renderFrame(updateOverlayPositions);
  requestAnimationFrame(loop);
}

applySavedSettingsToUI();
scanCharacters();
requestAnimationFrame(loop);