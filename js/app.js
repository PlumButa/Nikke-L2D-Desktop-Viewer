const path = require('path');
const { ipcRenderer } = require('electron');
const SpineManager = require('./js/spineManager');
const LipSyncManager = require('./js/lipSyncManager');
const SettingsManager = require('./js/settingsManager');
const BackgroundManager = require('./js/backgroundManager');
const RightClickManager = require('./js/rightClickManager');
const InteractionManager = require('./js/interactionManager');
const CharacterListManager = require('./js/characterListManager');

const canvas = document.getElementById('spine-canvas');
const stageContainer = document.getElementById('stage-container');

// 初始化核心模組
const settingsMgr = new SettingsManager();
const spineMgr = new SpineManager(canvas);
const lipSyncMgr = new LipSyncManager(spineMgr);
const bgMgr = new BackgroundManager(settingsMgr, ipcRenderer, stageContainer);
const interactionMgr = new InteractionManager(spineMgr, lipSyncMgr, settingsMgr, canvas);

let currentConfig = null;
let currentFolder = null;
let currentPose = 'standing'; // 'standing' | 'cover' | 'aim'
let isPetMode = false;
let isOverPetBar = false;
let petBarTimer = null;
let autoExpressionTimer = null;

// 拖曳視角與「攻擊模式按住立繪連射」控制參數
let isDragging = false, dragStartX = 0, dragStartY = 0, movedDistance = 0;
let aimHoldTimer = null;
let isHoldingCharacterFire = false;

// 初始化右鍵管理模組 (桌寵模式下右鍵彈出 全身 / 防守 / 攻擊 選單)
const rightClickMgr = new RightClickManager(canvas, spineMgr, {
  isPetMode: () => isPetMode,
  getCurrentPose: () => currentPose,
  getCurrentFolder: () => currentFolder,
  getCurrentConfig: () => currentConfig,
  onSwitchPose: (nextPose) => switchPose(nextPose)
});

// 初始化角色清單與最愛模組
const charsDir = path.join(__dirname, 'assets', 'characters');
const charListMgr = new CharacterListManager(charsDir, settingsMgr, (folder, cfg) => {
  selectCharacter(folder, cfg);
});

function syncTransformUI(rotation, mirrored) {
  const rotDeg = ((Math.round(rotation) % 360) + 360) % 360;
  document.getElementById('rotation-slider').value = rotDeg;
  document.getElementById('rotation-label').textContent = `${rotDeg}°`;

  document.getElementById('mirror-btn').classList.toggle('active', !!mirrored);
  document.getElementById('toolbar-mirror').classList.toggle('active', !!mirrored);
}

function syncScaleUI(scalePct) {
  const pct = Math.min(250, Math.max(10, Math.round(scalePct)));
  document.getElementById('scale-slider').value = pct;
  document.getElementById('scale-label').textContent = `${pct}%`;
  settingsMgr.save({ scale: pct });
  return pct;
}

// 根據前後姿勢自動換算縮放比例 (Full -> Cover/Aim 變 0.6 倍；Cover/Aim -> Full 變 1.6 倍；Cover <-> Aim 不變)
function adjustScaleForPoseTransition(prevPose, nextPose) {
  if (prevPose === nextPose) return;
  const currentScale = settingsMgr.get().scale || 100;

  if (prevPose === 'standing' && (nextPose === 'cover' || nextPose === 'aim')) {
    syncScaleUI(currentScale * 0.6);
  } else if ((prevPose === 'cover' || prevPose === 'aim') && nextPose === 'standing') {
    syncScaleUI(currentScale * 1.6);
  }
}

function updateExtraItemsButtonUI() {
  const extraBtn = document.getElementById('toggle-extra-btn');
  if (!extraBtn) return;

  if (!spineMgr.hasExtraItems) {
    extraBtn.disabled = true;
    extraBtn.classList.remove('active');
    extraBtn.textContent = '🎡 無額外物品';
  } else {
    extraBtn.disabled = false;
    extraBtn.classList.toggle('active', spineMgr.showExtraItems);
    extraBtn.textContent = spineMgr.showExtraItems ? '🎡 隱藏額外物品' : '🎡 顯示額外物品';
  }
}

function applySavedSettingsToUI() {
  const s = settingsMgr.get();
  spineMgr.timeScale = s.speed;
  spineMgr.aimShakeScale = (s.aimShake !== undefined ? s.aimShake : 100) / 100;
  spineMgr.setRotation(s.rotation || 0);
  spineMgr.setMirror(s.mirrored || false);

  document.getElementById('speed-slider').value = s.speed;
  document.getElementById('speed-label').textContent = Number(s.speed).toFixed(2) + 'x';
  syncScaleUI(s.scale || 100);

  const aimShakeVal = s.aimShake !== undefined ? s.aimShake : 100;
  document.getElementById('aim-shake-slider').value = aimShakeVal;
  document.getElementById('aim-shake-label').textContent = `${aimShakeVal}%`;

  syncTransformUI(s.rotation || 0, s.mirrored || false);
  interactionMgr.syncUI();
  bgMgr.syncUI();
  bgMgr.applyBackground();
}

spineMgr.onTrack0Change = (animName) => {
  const animSelect = document.getElementById('anim-select');
  if (animSelect && animSelect.value !== animName) {
    animSelect.value = animName;
  }
};

function updatePoseButtonsState(folderPath, cfg) {
  const hasCover = !!spineMgr.resolvePoseFiles(folderPath, cfg, 'cover');
  const hasAim = !!spineMgr.resolvePoseFiles(folderPath, cfg, 'aim');

  const coverBtn = document.getElementById('pose-cover-btn');
  const aimBtn = document.getElementById('pose-aim-btn');

  coverBtn.disabled = !hasCover;
  coverBtn.textContent = hasCover ? '🛡️ 防守 (Cover)' : '🛡️ 防守 (無素材)';

  aimBtn.disabled = !hasAim;
  aimBtn.textContent = hasAim ? '🎯 攻擊 (Aim)' : '🎯 攻擊 (無素材)';

  document.querySelectorAll('.pose-btn[data-pose]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.pose === currentPose);
  });
}

// 統一姿勢切換流程 (同時支援主控台按鈕與桌寵模式右鍵選單)
function switchPose(targetPose) {
  if (currentPose === targetPose) return;
  adjustScaleForPoseTransition(currentPose, targetPose);
  currentPose = targetPose;

  if (currentPose !== 'aim') {
    spineMgr.setAimCursorTracking(false);
  }
  loadCurrentPoseModel();
  if (isPetMode) {
    scheduleNextAutoExpression();
  }
}

function loadCurrentPoseModel() {
  if (!currentFolder || !currentConfig) return;
  lipSyncMgr.stopVoice();

  interactionMgr.syncVoiceFilterWithPose(currentPose);
  updatePoseButtonsState(currentFolder, currentConfig);

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
    updateExtraItemsButtonUI();
    // 儲存經邊界防呆校正後的螢幕偏移量
    settingsMgr.save({
      camOffsetX: Math.round(spineMgr.screenOffsetX),
      camOffsetY: Math.round(spineMgr.screenOffsetY)
    });
  }, currentPose);
}

function selectCharacter(folder, cfg) {
  // 若切換新角色前處於 Cover 或 Aim 模式，切回新角色的站姿 (standing) 時自動將縮放還原 2 倍
  if (currentConfig && currentPose !== 'standing') {
    adjustScaleForPoseTransition(currentPose, 'standing');
  }

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

// 綁定左下角「🎡 顯示額外物品」開關按鈕
document.getElementById('toggle-extra-btn').onclick = () => {
  if (!spineMgr.hasExtraItems) return;
  spineMgr.setExtraItemsVisible(!spineMgr.showExtraItems);
  updateExtraItemsButtonUI();
};

// 右上角姿勢切換按鈕事件
document.querySelectorAll('.pose-btn[data-pose]').forEach(btn => {
  btn.addEventListener('click', () => {
    const targetPose = btn.dataset.pose;
    if (currentPose === targetPose && targetPose !== 'standing') {
      switchPose('standing');
    } else if (currentPose !== targetPose) {
      switchPose(targetPose);
    }
  });
});

// 桌寵模式定時隨機自動觸發
function scheduleNextAutoExpression() {
  if (autoExpressionTimer) clearTimeout(autoExpressionTimer);
  if (!isPetMode) return;

  const randomDelay = Math.floor(Math.random() * 3000) + 12000;
  autoExpressionTimer = setTimeout(() => {
    if (isPetMode && !spineMgr.isPaused && !lipSyncMgr.isSpeaking) {
      spineMgr.triggerPetAutoAction();
    }
    scheduleNextAutoExpression();
  }, randomDelay);
}

// 接收全局滑鼠座標 (桌寵攻擊模式 aim_x / aim_y)
ipcRenderer.on('global-cursor-move', (event, { normX, normY }) => {
  if (!isPetMode || currentPose !== 'aim' || spineMgr.isPaused) return;
  spineMgr.setAimCursorTracking(true, normX, normY);
});

function triggerPetBarShow() {
  if (!isPetMode) return;
  const bar = document.getElementById('pet-Floating-Bar');
  bar.classList.add('visible');

  if (petBarTimer) clearTimeout(petBarTimer);
  petBarTimer = setTimeout(() => {
    bar.classList.remove('visible');
  }, 4000);
}

// 滑鼠左鍵互動事件
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
          const pool = interactionMgr.getFilteredVoicePool(currentConfig);
          const randomItem = pool[Math.floor(Math.random() * pool.length)];
          interactionMgr.playVoiceAndBubbleOnly(currentFolder, currentConfig, randomItem);
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
      // 直接以螢幕像素更新角色位置，並透過 updateCameraFromScreenOffset 強制限制在螢幕邊界內
      spineMgr.screenOffsetX += dx;
      spineMgr.screenOffsetY += dy;
      spineMgr.updateCameraFromScreenOffset();
    }
    dragStartX = e.clientX;
    dragStartY = e.clientY;
  }

  if (isPetMode && !isDragging) {
    const alpha = spineMgr.getPixelAlphaAt(e.clientX, e.clientY);
    const isOverMenu = rightClickMgr.isMenuOpen() || !!e.target.closest('#pet-context-menu');
    isOverPetBar = !!e.target.closest('#pet-Floating-Bar') || isOverMenu;
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
      if (alpha > 15) interactionMgr.triggerInteraction(currentFolder, currentConfig);
    } else if (movedDistance >= 6) {
      settingsMgr.save({
        camOffsetX: Math.round(spineMgr.screenOffsetX),
        camOffsetY: Math.round(spineMgr.screenOffsetY)
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
  const pct = syncScaleUI((spineMgr.baseZoom / spineMgr.camZoom) * 100);
  spineMgr.camZoom = spineMgr.baseZoom * (100 / pct);
  spineMgr.updateCameraFromScreenOffset();
}

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

// 左側面板與工具列控制項綁定
document.getElementById('anim-select').onchange = e => {
  spineMgr.clearAimFireTimer();
  if (spineMgr.animationState) {
    if (e.target.value === 'aim_fire') {
      spineMgr.startAimFireWithSubTracks();
    } else {
      spineMgr.clearAimFireSubTracks(0.15);
      spineMgr.setTrack0AnimationSmart(e.target.value, true);
    }
  }
};
document.getElementById('voice-select').onchange = e => {
  if (e.target.value !== '') {
    interactionMgr.triggerInteraction(currentFolder, currentConfig, Number(e.target.value));
  }
};
document.getElementById('speed-slider').oninput = e => {
  const speed = parseFloat(e.target.value);
  spineMgr.timeScale = speed;
  document.getElementById('speed-label').textContent = speed.toFixed(2) + 'x';
  settingsMgr.save({ speed });
};
document.getElementById('scale-slider').oninput = e => {
  const pct = syncScaleUI(parseInt(e.target.value, 10));
  spineMgr.camZoom = spineMgr.baseZoom * (100 / pct);
  spineMgr.updateCameraFromScreenOffset();
};

document.getElementById('rotation-slider').oninput = e => {
  const deg = parseInt(e.target.value, 10);
  spineMgr.setRotation(deg);
  syncTransformUI(deg, spineMgr.isMirrored);
  settingsMgr.save({ rotation: deg });
};
document.getElementById('toolbar-rot-ccw').onclick = () => updateRotationBy(-15);
document.getElementById('toolbar-rot-cw').onclick = () => updateRotationBy(15);

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

document.getElementById('reset-cam-btn').onclick = () => {
  settingsMgr.save({ scale: 100, rotation: 0, mirrored: false, camOffsetX: 0, camOffsetY: 0 });
  spineMgr.screenOffsetX = 0;
  spineMgr.screenOffsetY = 0;
  spineMgr.setRotation(0);
  spineMgr.setMirror(false);
  syncTransformUI(0, false);
  syncScaleUI(100);
  loadCurrentPoseModel();
};

document.getElementById('pause-btn').onclick = e => {
  spineMgr.isPaused = !spineMgr.isPaused;
  e.target.textContent = spineMgr.isPaused ? '繼續' : '暫停';
};

// 📸 截取畫面
document.getElementById('screenshot-btn').onclick = async () => {
  const offCanvas = document.createElement('canvas');
  offCanvas.width = canvas.width;
  offCanvas.height = canvas.height;
  const ctx = offCanvas.getContext('2d');

  await bgMgr.drawToCanvas(ctx, offCanvas.width, offCanvas.height);
  ctx.drawImage(canvas, 0, 0);

  const dataUrl = offCanvas.toDataURL('image/png');
  const charName = currentConfig ? `${currentConfig.name}_${currentConfig.skin || 'default'}` : 'Nikke';
  await ipcRenderer.invoke('save-screenshot', dataUrl, `${charName}_${Date.now()}.png`);
};

// 桌寵模式切換
document.getElementById('enter-pet-btn').onclick = () => {
  isPetMode = true;
  document.getElementById('bg-settings-popover').classList.remove('show');
  rightClickMgr.hideMenu();
  document.body.classList.add('pet-mode');
  ipcRenderer.send('toggle-pet-mode', true);
  triggerPetBarShow();
  scheduleNextAutoExpression();
};

document.getElementById('exit-pet-btn').onclick = () => {
  isPetMode = false;
  isOverPetBar = false;
  rightClickMgr.hideMenu();
  spineMgr.setAimCursorTracking(false);
  if (petBarTimer) clearTimeout(petBarTimer);
  if (autoExpressionTimer) clearTimeout(autoExpressionTimer);
  spineMgr.returnToDefaultAnimation();
  document.getElementById('pet-Floating-Bar').classList.remove('visible');
  document.body.classList.remove('pet-mode');
  ipcRenderer.send('toggle-pet-mode', false);
};

window.addEventListener('keydown', e => {
  if (e.key === 'Escape' && isPetMode && !rightClickMgr.isMenuOpen()) {
    document.getElementById('exit-pet-btn').click();
  }
});

function loop() {
  spineMgr.renderFrame(() => interactionMgr.updateOverlayPositions(isPetMode));
  requestAnimationFrame(loop);
}

applySavedSettingsToUI();
charListMgr.scanCharacters();
requestAnimationFrame(loop);