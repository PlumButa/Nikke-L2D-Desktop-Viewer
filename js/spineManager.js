const fs = require('fs');
const path = require('path');

class SpineManager {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = null;
    this.context = null;
    this.sceneRenderer = null;
    this.assetManager = null;
    this.skeleton = null;
    this.animationState = null;

    this.runtimeEnvs = {};
    this.activeVersion = null;
    this.waitLoadTimer = null;
    this.loadToken = 0;
    this.currentPose = 'standing'; // 'standing' | 'cover' | 'aim'
    this.currentCfg = null;
    this.currentFolderName = '';

    // 外部口型衝突黑名單 (由根目錄 lip_sync_blacklist.json 載入)
    this.blacklistPath = path.join(__dirname, '..', 'lip_sync_blacklist.json');
    this.lipSyncBlacklist = this.loadLipSyncBlacklist();

    // 攻擊 (Aim) 連射與延續計時器狀態
    this.aimFireTimer = null;
    this.emotionReturnTimer = null;
    this.isMouseHoldingFire = false;

    // 攻擊 (Aim) 桌寵模式滑鼠瞄準追蹤 (aim_x / aim_y, 0.5 為螢幕正中央)
    this.aimTrackingEnabled = false;
    this.targetAimX = 0.5;
    this.targetAimY = 0.5;
    this.currentAimX = 0.5;
    this.currentAimY = 0.5;
    this.aimXAnim = null;
    this.aimYAnim = null;
    this.aimXCenterPose = null;
    this.aimYCenterPose = null;

    this.timeScale = 1.0;
    this.aimShakeScale = 1.0;
    this.rotationDeg = 0;    // 0 ~ 360 度旋轉
    this.isMirrored = false; // 左右鏡射
    this.aimIdleBase = null;
    this.isPaused = false;
    this.lastFrameTime = Date.now() / 1000;

    this.camX = 0;
    this.camY = 0;
    this.defaultCamX = 0;
    this.defaultCamY = 0;
    this.camZoom = 1.0;
    this.baseZoom = 1.0;
    this.charBounds = { minX: 0, minY: 0, maxX: 0, maxY: 0, centerX: 0, width: 0, height: 0 };

    this.defaultAnimName = 'idle';
    this.expressionAnimations = [];
    this.aimFireSubAnimations = [];
    this.onTrack0Change = null;
  }

  loadLipSyncBlacklist() {
    try {
      if (fs.existsSync(this.blacklistPath)) {
        const raw = fs.readFileSync(this.blacklistPath, 'utf-8');
        return JSON.parse(raw);
      }
    } catch (err) {
      console.error('讀取 lip_sync_blacklist.json 失敗:', err);
    }
    return {};
  }

  isLipSyncBlockedForCurrentAnim(overrideAnimName = null) {
    if (!this.skeleton || !this.animationState) return false;
    const currentTrack0 = this.animationState.getCurrent(0);
    const activeAnimName = overrideAnimName || currentTrack0?.animation?.name || '';
    if (!activeAnimName) return false;

    const keysToCheck = [
      this.currentFolderName,
      this.currentCfg?.name,
      this.currentCfg?.id,
      this.currentCfg?.skel
    ].filter(Boolean);

    const blockedSet = new Set(this.currentCfg?.disableLipSyncAnimations || []);
    for (const key of keysToCheck) {
      const list = this.lipSyncBlacklist[key];
      if (Array.isArray(list)) {
        list.forEach(a => blockedSet.add(a));
      }
    }

    return blockedSet.has('*') || blockedSet.has(activeAnimName);
  }

  // 判斷是否為需要更換手部/身體部件的大動作 (如 action / special)
  isFullBodyActionAnim(animName) {
    if (!animName) return false;
    return animName === 'action' || animName === 'special' || animName.startsWith('to_');
  }

  clearEntryMixingChain(entry) {
    if (!entry || !this.animationState) return;
    let from = entry.mixingFrom;
    while (from) {
      const nextFrom = from.mixingFrom;
      from.mixingFrom = null;
      from.mixingTo = null;
      if (this.animationState.trackEntryPool) {
        this.animationState.trackEntryPool.free(from);
      }
      from = nextFrom;
    }
    entry.mixingFrom = null;
    entry.mixDuration = 0;
  }

  clearAimFireTimer() {
    if (this.aimFireTimer) {
      clearTimeout(this.aimFireTimer);
      this.aimFireTimer = null;
    }
    if (this.emotionReturnTimer) {
      clearTimeout(this.emotionReturnTimer);
      this.emotionReturnTimer = null;
    }
    this.isMouseHoldingFire = false;
  }

  setAimCursorTracking(enabled, normX = 0.5, normY = 0.5) {
    this.aimTrackingEnabled = enabled;
    if (enabled) {
      this.targetAimX = normX;
      this.targetAimY = normY;
    } else {
      this.targetAimX = 0.5;
      this.targetAimY = 0.5;
    }
  }

  // 設定左右鏡射
  setMirror(mirrored) {
    this.isMirrored = !!mirrored;
    if (this.skeleton) {
      this.skeleton.scaleX = this.isMirrored ? -1 : 1;
      this.skeleton.x = this.isMirrored ? (this.charBounds.centerX * 2) : 0;
    }
  }

  // 設定旋轉角度 (0 ~ 360)
  setRotation(deg) {
    this.rotationDeg = ((deg % 360) + 360) % 360;
  }

  detectSpineVersion(skelFilePath, cfg) {
    try {
      const buf = fs.readFileSync(skelFilePath);
      const headerStr = buf.subarray(0, 64).toString('latin1');
      if (headerStr.includes('4.1')) return '4.1';
      if (headerStr.includes('4.0')) return '4.0';
    } catch (err) {
      console.error('讀取 skel 檔頭失敗:', err);
    }
    return cfg?.spineVersion === '4.1' ? '4.1' : '4.0';
  }

  resolvePoseFiles(baseFolderPath, cfg, poseType) {
    if (poseType === 'standing') {
      return {
        targetDir: baseFolderPath,
        skelFile: cfg.skel,
        atlasFile: cfg.atlas
      };
    }

    const subDir = path.join(baseFolderPath, poseType);
    if (!fs.existsSync(subDir)) return null;

    const files = fs.readdirSync(subDir);
    const skelFile = files.find(f => f.toLowerCase().endsWith('.skel'));
    const atlasFile = files.find(f => f.toLowerCase().endsWith('.atlas'));

    if (!skelFile || !atlasFile) return null;
    return {
      targetDir: subDir,
      skelFile,
      atlasFile
    };
  }

  async getOrCreateRuntimeEnv(version) {
    if (!this.gl) {
      const glConfig = {
        alpha: true,
        premultipliedAlpha: true,
        preserveDrawingBuffer: true
      };
      this.gl = this.canvas.getContext('webgl2', glConfig) || this.canvas.getContext('webgl', glConfig);
    }

    if (this.runtimeEnvs[version]) {
      window.spine = this.runtimeEnvs[version].spine;
      return this.runtimeEnvs[version];
    }

    await new Promise((resolve, reject) => {
      const old = document.querySelector(`script[data-spine-runtime="${version}"]`);
      if (old) old.remove();

      const script = document.createElement('script');
      script.dataset.spineRuntime = version;
      script.src = version === '4.1' ? './libs/spine-webgl-4.1.js' : './libs/spine-webgl-4.0.js';
      script.onload = () => resolve();
      script.onerror = (err) => reject(err);
      document.head.appendChild(script);
    });

    const spineLib = window.spine;
    const context = new spineLib.ManagedWebGLRenderingContext(this.gl);
    const sceneRenderer = new spineLib.SceneRenderer(this.canvas, context, true);

    this.runtimeEnvs[version] = {
      spine: spineLib,
      context,
      sceneRenderer
    };

    return this.runtimeEnvs[version];
  }

  async loadCharacter(folderPath, cfg, savedSettings, onReadyCallback, poseType = 'standing') {
    const currentToken = ++this.loadToken;
    this.currentPose = poseType;
    this.currentCfg = cfg;
    this.currentFolderName = path.basename(folderPath);
    this.clearAimFireTimer();
    this.lipSyncBlacklist = this.loadLipSyncBlacklist();

    if (this.waitLoadTimer) {
      clearInterval(this.waitLoadTimer);
      this.waitLoadTimer = null;
    }

    const resolved = this.resolvePoseFiles(folderPath, cfg, poseType);
    if (!resolved) {
      console.warn(`⚠️ 找不到姿勢 [${poseType}] 的 Spine 檔案！`);
      return;
    }

    const { targetDir, skelFile, atlasFile } = resolved;

    this.skeleton = null;
    this.animationState = null;
    this.aimIdleBase = null;
    this.aimXAnim = null;
    this.aimYAnim = null;
    this.aimXCenterPose = null;
    this.aimYCenterPose = null;
    this.aimFireSubAnimations = [];

    if (this.assetManager) {
      try {
        this.assetManager.dispose();
      } catch (e) {
        console.warn('釋放舊 AssetManager 略過:', e);
      }
      this.assetManager = null;
    }

    const skelFullPath = path.join(targetDir, skelFile);
    const detectedVer = this.detectSpineVersion(skelFullPath, cfg);

    const env = await this.getOrCreateRuntimeEnv(detectedVer);
    if (currentToken !== this.loadToken) return;

    window.spine = env.spine;
    this.context = env.context;
    this.sceneRenderer = env.sceneRenderer;
    this.activeVersion = detectedVer;

    const baseUrl = 'file:///' + targetDir.replace(/\\/g, '/') + '/';
    this.assetManager = new env.spine.AssetManager(this.context, baseUrl);
    this.assetManager.loadBinary(skelFile);
    this.assetManager.loadTextureAtlas(atlasFile);

    this.waitLoadTimer = setInterval(() => {
      if (currentToken !== this.loadToken) {
        clearInterval(this.waitLoadTimer);
        return;
      }
      if (this.assetManager && this.assetManager.isLoadingComplete()) {
        clearInterval(this.waitLoadTimer);
        this.waitLoadTimer = null;

        if (this.assetManager.hasErrors()) {
          console.error('AssetManager 載入錯誤:', this.assetManager.getErrors());
          return;
        }
        this.setupSkeleton(cfg, savedSettings, skelFile, atlasFile);
        if (onReadyCallback && this.skeleton) {
          onReadyCallback(this.skeleton.data.animations, this.defaultAnimName);
        }
      }
    }, 40);
  }

  captureSkeletonSnapshot() {
    return {
      bones: this.skeleton.bones.map(b => ({
        x: b.x,
        y: b.y,
        rotation: b.rotation,
        scaleX: b.scaleX,
        scaleY: b.scaleY,
        shearX: b.shearX,
        shearY: b.shearY
      })),
      slotDeforms: this.skeleton.slots.map(s =>
        (s.deform && s.deform.length > 0) ? Float32Array.from(s.deform) : null
      )
    };
  }

  restoreSkeletonSnapshot(snapshot) {
    if (!snapshot || !this.skeleton) return;
    for (let i = 0; i < this.skeleton.bones.length; i++) {
      const b = this.skeleton.bones[i];
      const s = snapshot.bones[i];
      if (s) {
        b.x = s.x; b.y = s.y; b.rotation = s.rotation;
        b.scaleX = s.scaleX; b.scaleY = s.scaleY;
        b.shearX = s.shearX; b.shearY = s.shearY;
      }
    }
    for (let i = 0; i < this.skeleton.slots.length; i++) {
      const slot = this.skeleton.slots[i];
      const def = snapshot.slotDeforms[i];
      if (def) {
        slot.deform = Array.from(def);
      } else {
        slot.deform.length = 0;
      }
    }
  }

  setupSkeleton(cfg, savedSettings = null, skelFile = null, atlasFile = null) {
    const spine = window.spine;
    const finalSkel = skelFile || cfg.skel;
    const finalAtlas = atlasFile || cfg.atlas;

    const atlas = this.assetManager.require(finalAtlas);
    const atlasLoader = new spine.AtlasAttachmentLoader(atlas);
    const skeletonBinary = new spine.SkeletonBinary(atlasLoader);
    const skeletonData = skeletonBinary.readSkeletonData(this.assetManager.require(finalSkel));

    this.skeleton = new spine.Skeleton(skeletonData);
    this.skeleton.setToSetupPose();
    this.skeleton.updateWorldTransform();

    const offset = new spine.Vector2();
    const size = new spine.Vector2();
    this.skeleton.getBounds(offset, size, []);

    this.charBounds = {
      minX: offset.x,
      minY: offset.y,
      maxX: offset.x + size.x,
      maxY: offset.y + size.y,
      centerX: offset.x + size.x / 2,
      width: size.x,
      height: size.y
    };

    this.defaultCamX = this.charBounds.centerX;
    this.defaultCamY = offset.y + size.y * 0.54;
    this.baseZoom = Math.max(size.x / this.canvas.clientWidth, size.y / this.canvas.clientHeight) * 1.25;

    const scalePct = savedSettings?.scale || 100;
    this.camZoom = this.baseZoom * (100 / scalePct);
    this.camX = this.defaultCamX + (savedSettings?.camOffsetX || 0);
    this.camY = this.defaultCamY + (savedSettings?.camOffsetY || 0);

    // 套用記憶的鏡射與旋轉設定
    this.setMirror(savedSettings?.mirrored || false);
    this.setRotation(savedSettings?.rotation || 0);

    const stateData = new spine.AnimationStateData(skeletonData);
    stateData.defaultMix = 0;

    this.animationState = new spine.AnimationState(stateData);

    // 紀錄前一個 Track 0 動作名稱，用於判斷是否剛從 action 切換出來
    this.lastTrack0AnimName = '';

    this.animationState.addListener({
      start: (entry) => {
        if (entry.trackIndex === 0 && entry.animation && this.skeleton) {
          const newName = entry.animation.name;
          const prevName = this.lastTrack0AnimName;
          this.lastTrack0AnimName = newName;

          // 只有當進入或離開 action/special 大動作時，才執行強制斷鏈與 SetupPose 重置以消除手臂殘影
          if (this.isFullBodyActionAnim(newName) || this.isFullBodyActionAnim(prevName)) {
            this.clearEntryMixingChain(entry);
            this.skeleton.setToSetupPose();
            this.setMirror(this.isMirrored);
          }

          if (this.isLipSyncBlockedForCurrentAnim(newName)) {
            this.animationState.clearTrack(1);
          }

          if (this.onTrack0Change) {
            this.onTrack0Change(newName);
          }
        }
      }
    });

    const allAnimNames = skeletonData.animations.map(a => a.name);
    this.expressionAnimations = allAnimNames.filter(name => /^expression_\d+$/.test(name));
    this.aimFireSubAnimations = allAnimNames.filter(name => /^aim_fire_.+/.test(name));

    let candidates = [cfg.defaultAnimation || 'idle', 'idle'];
    if (this.currentPose === 'cover') candidates = ['cover_idle', 'idle'];
    if (this.currentPose === 'aim') candidates = ['aim_idle', 'idle'];

    const foundDefault = candidates.find(name => skeletonData.findAnimation(name));
    this.defaultAnimName = foundDefault || allAnimNames[0] || 'idle';

    this.aimIdleBase = null;
    this.aimXAnim = skeletonData.findAnimation('aim_x');
    this.aimYAnim = skeletonData.findAnimation('aim_y');
    this.aimXCenterPose = null;
    this.aimYCenterPose = null;

    if (this.currentPose === 'aim') {
      const idleAnim = skeletonData.findAnimation(this.defaultAnimName);
      if (idleAnim) {
        this.skeleton.setToSetupPose();
        idleAnim.apply(this.skeleton, 0, 0, false, [], 1.0, spine.MixBlend.first, spine.MixDirection.mixIn);
        this.skeleton.updateWorldTransform();
        this.aimIdleBase = this.captureSkeletonSnapshot();

        if (this.aimXAnim) {
          this.restoreSkeletonSnapshot(this.aimIdleBase);
          this.aimXAnim.apply(this.skeleton, 0, this.aimXAnim.duration * 0.5, false, [], 1.0, spine.MixBlend.first, spine.MixDirection.mixIn);
          this.aimXCenterPose = this.captureSkeletonSnapshot();
        }

        if (this.aimYAnim) {
          this.restoreSkeletonSnapshot(this.aimIdleBase);
          this.aimYAnim.apply(this.skeleton, 0, this.aimYAnim.duration * 0.5, false, [], 1.0, spine.MixBlend.first, spine.MixDirection.mixIn);
          this.aimYCenterPose = this.captureSkeletonSnapshot();
        }

        this.skeleton.setToSetupPose();
        this.setMirror(this.isMirrored);
      }
    }

    if (this.defaultAnimName && skeletonData.findAnimation(this.defaultAnimName)) {
      this.animationState.setAnimation(0, this.defaultAnimName, true);
      this.animationState.apply(this.skeleton);
      this.skeleton.updateWorldTransform();
    }
  }

  // 【智慧動作切換】消除 shy / delight / expression 切換時的呼吸斷差，同時保留 action 無殘影效果
  setTrack0AnimationSmart(animName, loop = true) {
    if (!this.skeleton || !this.animationState) return null;
    const targetAnim = this.skeleton.data.findAnimation(animName);
    if (!targetAnim) return null;

    if (this.emotionReturnTimer) {
      clearTimeout(this.emotionReturnTimer);
      this.emotionReturnTimer = null;
    }

    const prevEntry = this.animationState.getCurrent(0);
    const prevAnim = prevEntry?.animation;
    const prevTrackTime = prevEntry ? prevEntry.trackTime : 0;

    const isActionTransition =
      this.isFullBodyActionAnim(animName) ||
      (prevAnim && this.isFullBodyActionAnim(prevAnim.name));

    // 若是從表情/待機切換到另一個表情/待機 (如 idle <-> shy / delight / expression_0)
    if (!isActionTransition && prevAnim && this.currentPose === 'standing') {
      const sameBreathingCycle =
        targetAnim.duration > 0.5 &&
        Math.abs(prevAnim.duration - targetAnim.duration) < 0.08;

      // 若兩者共享相同的呼吸週期長度，直接繼承當前呼吸秒數 (trackTime) 並柔和過渡
      if (sameBreathingCycle) {
        const entry = this.animationState.setAnimation(0, animName, true);
        entry.mixDuration = 0.22;
        entry.attachmentThreshold = 1.0;
        entry.trackTime = prevTrackTime % targetAnim.duration;
        entry.animationLast = entry.trackTime;
        entry.nextAnimationLast = entry.trackTime;

        // 若呼叫端要求只播放 1 次 (如點擊立繪或桌寵隨機表情)，則在 1 個週期後無縫同步接回 defaultAnimName
        if (!loop && animName !== this.defaultAnimName) {
          this.emotionReturnTimer = setTimeout(() => {
            this.emotionReturnTimer = null;
            this.setTrack0AnimationSmart(this.defaultAnimName, true);
          }, targetAnim.duration * 1000);
        }
        return entry;
      }

      // 若是短秒數或純臉部關鍵幀的 expression 動畫，使用柔和過渡不重置 SetupPose
      const entry = this.animationState.setAnimation(0, animName, loop);
      entry.mixDuration = 0.2;
      entry.attachmentThreshold = 1.0;
      if (!loop && animName !== this.defaultAnimName) {
        const holdTime = targetAnim.duration < 1.0 ? 2.5 : 0;
        const backEntry = this.animationState.addAnimation(0, this.defaultAnimName, true, holdTime);
        backEntry.mixDuration = 0.2;
      }
      return entry;
    }

    // 針對 action / special 等換手部圖層的大動作：0 秒切換 + SetupPose 重置，100% 杜絕殘影
    const entry = this.animationState.setAnimation(0, animName, loop);
    if (!loop && animName !== this.defaultAnimName) {
      this.animationState.addAnimation(0, this.defaultAnimName, true, 0);
    }
    this.animationState.apply(this.skeleton);
    this.skeleton.updateWorldTransform();
    return entry;
  }

  startAimFireWithSubTracks() {
    if (!this.skeleton || !this.animationState) return false;
    if (!this.skeleton.data.findAnimation('aim_fire')) return false;

    const current = this.animationState.getCurrent(0);
    if (!current || current.animation.name !== 'aim_fire' || !current.loop || current.next) {
      this.animationState.setAnimation(0, 'aim_fire', true);
    }

    this.aimFireSubAnimations.forEach((subAnimName, idx) => {
      const trackIdx = 2 + idx;
      const subCurrent = this.animationState.getCurrent(trackIdx);
      if (!subCurrent || !subCurrent.animation || subCurrent.animation.name !== subAnimName || !subCurrent.loop) {
        this.animationState.setAnimation(trackIdx, subAnimName, true);
      }
    });

    return true;
  }

  clearAimFireSubTracks(mixDuration = 0) {
    if (!this.animationState || !this.aimFireSubAnimations.length) return;
    this.aimFireSubAnimations.forEach((_, idx) => {
      const trackIdx = 2 + idx;
      if (this.animationState.getCurrent(trackIdx)) {
        if (mixDuration > 0) {
          this.animationState.setEmptyAnimation(trackIdx, mixDuration);
        } else {
          this.animationState.clearTrack(trackIdx);
        }
      }
    });
  }

  playCoverReloadTriple() {
    if (!this.skeleton || !this.animationState) return false;
    const reloadAnim = this.skeleton.data.findAnimation('cover_reload');
    if (!reloadAnim) return false;

    this.animationState.setAnimation(0, 'cover_reload', false);
    this.animationState.addAnimation(0, 'cover_reload', false, 0);
    this.animationState.addAnimation(0, this.defaultAnimName, true, 0);
    return true;
  }

  triggerAimFireDuration(durationMs = 2000) {
    if (this.currentPose !== 'aim') return false;
    if (!this.startAimFireWithSubTracks()) return false;

    if (this.aimFireTimer) clearTimeout(this.aimFireTimer);
    this.aimFireTimer = setTimeout(() => {
      this.aimFireTimer = null;
      if (!this.isMouseHoldingFire && this.currentPose === 'aim') {
        this.returnToDefaultAnimation();
      }
    }, durationMs);
    return true;
  }

  startAimFireHold() {
    if (this.currentPose !== 'aim') return;
    this.isMouseHoldingFire = true;
    if (this.aimFireTimer) {
      clearTimeout(this.aimFireTimer);
      this.aimFireTimer = null;
    }
    this.startAimFireWithSubTracks();
  }

  stopAimFireHold(durationMs = 2000) {
    this.isMouseHoldingFire = false;
    if (this.currentPose !== 'aim' || !this.skeleton || !this.animationState) return;

    if (this.aimFireTimer) clearTimeout(this.aimFireTimer);
    this.aimFireTimer = setTimeout(() => {
      this.aimFireTimer = null;
      if (!this.isMouseHoldingFire && this.currentPose === 'aim') {
        this.returnToDefaultAnimation();
      }
    }, durationMs);
  }

  playInteractionAnimation(standingConfigAnim) {
    if (!this.skeleton || !this.animationState) return;

    if (this.currentPose === 'cover') {
      if (!this.playCoverReloadTriple()) {
        this.returnToDefaultAnimation();
      }
      return;
    }

    if (this.currentPose === 'aim') {
      if (!this.triggerAimFireDuration(2000)) {
        this.returnToDefaultAnimation();
      }
      return;
    }

    // 站姿 (standing)：使用智慧切換，兼顧 action 無殘影與 shy/delight 無斷差
    const targetName = standingConfigAnim || this.defaultAnimName;
    if (this.skeleton.data.findAnimation(targetName)) {
      this.setTrack0AnimationSmart(targetName, false);
    } else {
      this.returnToDefaultAnimation();
    }
  }

  returnToDefaultAnimation() {
    this.clearAimFireTimer();
    this.clearAimFireSubTracks(0);
    if (!this.skeleton || !this.animationState) return;
    const currentEntry = this.animationState.getCurrent(0);
    if (!currentEntry || currentEntry.animation.name !== this.defaultAnimName || !currentEntry.loop) {
      if (this.skeleton.data.findAnimation(this.defaultAnimName)) {
        this.setTrack0AnimationSmart(this.defaultAnimName, true);
      }
    }
  }

  triggerPetAutoAction() {
    if (!this.skeleton || !this.animationState) return false;

    if (this.currentPose === 'standing') {
      if (!this.expressionAnimations || this.expressionAnimations.length === 0) return false;
      const randomExp = this.expressionAnimations[
        Math.floor(Math.random() * this.expressionAnimations.length)
      ];
      if (!this.skeleton.data.findAnimation(randomExp)) return false;

      this.setTrack0AnimationSmart(randomExp, false);
      return true;
    }

    if (this.currentPose === 'cover') {
      return this.playCoverReloadTriple();
    }

    if (this.currentPose === 'aim') {
      if (this.isMouseHoldingFire) return false;
      return this.triggerAimFireDuration(2000);
    }

    return false;
  }

  setMouthTalking(isTalking, clearAfter = false) {
    if (!this.skeleton || !this.animationState) return;

    if (this.isLipSyncBlockedForCurrentAnim()) {
      if (this.animationState.getCurrent(1)) {
        this.animationState.clearTrack(1);
        this.skeleton.setSlotsToSetupPose();
      }
      return;
    }

    const hasTalkStart = this.skeleton.data.findAnimation('talk_start');
    const hasTalkEnd = this.skeleton.data.findAnimation('talk_end');

    if (isTalking && hasTalkStart) {
      const entry = this.animationState.setAnimation(1, 'talk_start', true);
      this.clearEntryMixingChain(entry);
    } else if (!isTalking) {
      if (hasTalkEnd) {
        const entry = this.animationState.setAnimation(1, 'talk_end', false);
        this.clearEntryMixingChain(entry);
        if (clearAfter) {
          this.animationState.addEmptyAnimation(1, 0, 0);
        }
      } else {
        this.animationState.clearTrack(1);
      }
    }
  }

  applyAimFireShakeMultiplier() {
    if (this.currentPose !== 'aim' || !this.aimIdleBase || this.aimShakeScale === 1.0) return;
    const current = this.animationState.getCurrent(0);
    if (!current || !current.animation || !current.animation.name.startsWith('aim_fire')) return;

    const k = this.aimShakeScale;

    for (let i = 0; i < this.skeleton.bones.length; i++) {
      const bone = this.skeleton.bones[i];
      const base = this.aimIdleBase.bones[i];
      if (!base) continue;

      bone.x = base.x + (bone.x - base.x) * k;
      bone.y = base.y + (bone.y - base.y) * k;

      let diffRot = bone.rotation - base.rotation;
      while (diffRot > 180) diffRot -= 360;
      while (diffRot < -180) diffRot += 360;
      bone.rotation = base.rotation + diffRot * k;

      bone.scaleX = base.scaleX + (bone.scaleX - base.scaleX) * k;
      bone.scaleY = base.scaleY + (bone.scaleY - base.scaleY) * k;
      bone.shearX = base.shearX + (bone.shearX - base.shearX) * k;
      bone.shearY = base.shearY + (bone.shearY - base.shearY) * k;
    }

    for (let s = 0; s < this.skeleton.slots.length; s++) {
      const slot = this.skeleton.slots[s];
      const deform = slot.deform;
      if (!deform || deform.length === 0) continue;

      const baseDeform = this.aimIdleBase.slotDeforms[s];
      const attachment = slot.getAttachment();

      if (baseDeform && baseDeform.length === deform.length) {
        for (let j = 0; j < deform.length; j++) {
          deform[j] = baseDeform[j] + (deform[j] - baseDeform[j]) * k;
        }
      } else if (attachment && attachment.bones) {
        for (let j = 0; j < deform.length; j++) {
          deform[j] *= k;
        }
      } else if (attachment && attachment.vertices && attachment.vertices.length === deform.length) {
        const verts = attachment.vertices;
        for (let j = 0; j < deform.length; j++) {
          deform[j] = verts[j] + (deform[j] - verts[j]) * k;
        }
      }
    }
  }

  applyAimCursorOffset() {
    if (this.currentPose !== 'aim' || !this.aimIdleBase) return;
    if (!this.aimXAnim && !this.aimYAnim) return;

    this.currentAimX += (this.targetAimX - this.currentAimX) * 0.18;
    this.currentAimY += (this.targetAimY - this.currentAimY) * 0.18;

    if (Math.abs(this.currentAimX - 0.5) < 0.002 && Math.abs(this.currentAimY - 0.5) < 0.002) {
      return;
    }

    const spine = window.spine;
    const animPose = this.captureSkeletonSnapshot();

    let poseX = null;
    if (this.aimXAnim && this.aimXCenterPose) {
      this.restoreSkeletonSnapshot(this.aimIdleBase);
      const tX = this.currentAimX * this.aimXAnim.duration;
      this.aimXAnim.apply(this.skeleton, 0, tX, false, [], 1.0, spine.MixBlend.first, spine.MixDirection.mixIn);
      poseX = this.captureSkeletonSnapshot();
    }

    let poseY = null;
    if (this.aimYAnim && this.aimYCenterPose) {
      this.restoreSkeletonSnapshot(this.aimIdleBase);
      const tY = this.currentAimY * this.aimYAnim.duration;
      this.aimYAnim.apply(this.skeleton, 0, tY, false, [], 1.0, spine.MixBlend.first, spine.MixDirection.mixIn);
      poseY = this.captureSkeletonSnapshot();
    }

    for (let i = 0; i < this.skeleton.bones.length; i++) {
      const b = this.skeleton.bones[i];
      const base = animPose.bones[i];

      let dx = 0, dy = 0, dRot = 0, dScaleX = 0, dScaleY = 0, dShearX = 0, dShearY = 0;

      if (poseX && this.aimXCenterPose) {
        const px = poseX.bones[i], cx = this.aimXCenterPose.bones[i];
        dx += px.x - cx.x;
        dy += px.y - cx.y;
        let r = px.rotation - cx.rotation;
        while (r > 180) r -= 360;
        while (r < -180) r += 360;
        dRot += r;
        dScaleX += px.scaleX - cx.scaleX;
        dScaleY += px.scaleY - cx.scaleY;
        dShearX += px.shearX - cx.shearX;
        dShearY += px.shearY - cx.shearY;
      }

      if (poseY && this.aimYCenterPose) {
        const py = poseY.bones[i], cy = this.aimYCenterPose.bones[i];
        dx += py.x - cy.x;
        dy += py.y - cy.y;
        let r = py.rotation - cy.rotation;
        while (r > 180) r -= 360;
        while (r < -180) r += 360;
        dRot += r;
        dScaleX += py.scaleX - cy.scaleX;
        dScaleY += py.scaleY - cy.scaleY;
        dShearX += py.shearX - cy.shearX;
        dShearY += py.shearY - cy.shearY;
      }

      b.x = base.x + dx;
      b.y = base.y + dy;
      b.rotation = base.rotation + dRot;
      b.scaleX = base.scaleX + dScaleX;
      b.scaleY = base.scaleY + dScaleY;
      b.shearX = base.shearX + dShearX;
      b.shearY = base.shearY + dShearY;
    }

    for (let s = 0; s < this.skeleton.slots.length; s++) {
      const slot = this.skeleton.slots[s];
      const animDef = animPose.slotDeforms[s];
      const xDef = poseX?.slotDeforms[s];
      const cxDef = this.aimXCenterPose?.slotDeforms[s];
      const yDef = poseY?.slotDeforms[s];
      const cyDef = this.aimYCenterPose?.slotDeforms[s];

      const len = Math.max(
        animDef?.length || 0,
        xDef?.length || 0,
        yDef?.length || 0
      );

      if (len === 0) {
        slot.deform.length = 0;
        continue;
      }

      const attachment = slot.getAttachment();
      const isUnweighted = attachment && !attachment.bones && attachment.vertices?.length === len;
      const fallbackArr = isUnweighted ? attachment.vertices : null;

      slot.deform.length = len;
      for (let j = 0; j < len; j++) {
        const defVal = fallbackArr ? fallbackArr[j] : 0;
        const baseV = animDef && j < animDef.length ? animDef[j] : defVal;
        const dxV = (xDef && cxDef && j < xDef.length) ? (xDef[j] - cxDef[j]) : 0;
        const dyV = (yDef && cyDef && j < yDef.length) ? (yDef[j] - cyDef[j]) : 0;
        slot.deform[j] = baseV + dxV + dyV;
      }
    }
  }

  // 將世界座標轉換為考慮旋轉角度後的螢幕座標
  worldToScreen(wx, wy) {
    const rad = (this.rotationDeg * Math.PI) / 180;
    const relX = wx - this.camX;
    const relY = wy - this.camY;
    const rotX = relX * Math.cos(rad) + relY * Math.sin(rad);
    const rotY = -relX * Math.sin(rad) + relY * Math.cos(rad);

    const screenX = (this.canvas.clientWidth / 2) + rotX / this.camZoom;
    const screenY = (this.canvas.clientHeight / 2) - rotY / this.camZoom;
    return { x: screenX, y: screenY };
  }

  getCharacterAnchors() {
    if (!this.skeleton) return null;
    const headWorldY = this.charBounds.minY + this.charBounds.height * 0.92;
    const footWorldY = this.charBounds.minY;
    const headPos = this.worldToScreen(this.charBounds.centerX, headWorldY);
    const footPos = this.worldToScreen(this.charBounds.centerX, footWorldY);
    return { head: headPos, foot: footPos };
  }

  getPixelAlphaAt(clientX, clientY) {
    if (!this.gl) return 0;
    const rect = this.canvas.getBoundingClientRect();
    const x = Math.floor(clientX - rect.left);
    const y = Math.floor(this.canvas.height - (clientY - rect.top));
    if (x < 0 || y < 0 || x >= this.canvas.width || y >= this.canvas.height) return 0;
    const pixel = new Uint8Array(4);
    this.gl.readPixels(x, y, 1, 1, this.gl.RGBA, this.gl.UNSIGNED_BYTE, pixel);
    return pixel[3];
  }

  renderFrame(onFrameUpdate) {
    const now = Date.now() / 1000;
    const delta = now - this.lastFrameTime;
    this.lastFrameTime = now;

    if (this.skeleton && this.animationState && this.sceneRenderer && this.gl) {
      if (this.canvas.width !== this.canvas.clientWidth || this.canvas.height !== this.canvas.clientHeight) {
        this.canvas.width = this.canvas.clientWidth;
        this.canvas.height = this.canvas.clientHeight;
      }

      this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      this.gl.clearColor(0, 0, 0, 0);
      this.gl.clear(this.gl.COLOR_BUFFER_BIT);

      if (!this.isPaused) {
        if (this.currentPose === 'aim' && this.aimIdleBase) {
          this.restoreSkeletonSnapshot(this.aimIdleBase);
        }

        // 確保鏡射狀態持續生效
        this.skeleton.scaleX = this.isMirrored ? -1 : 1;
        this.skeleton.x = this.isMirrored ? (this.charBounds.centerX * 2) : 0;

        this.animationState.update(delta * this.timeScale);
        this.animationState.apply(this.skeleton);

        this.applyAimFireShakeMultiplier();
        this.applyAimCursorOffset();

        this.skeleton.updateWorldTransform();
      }

      const camera = this.sceneRenderer.camera;
      camera.position.x = this.camX;
      camera.position.y = this.camY;
      camera.viewportWidth = this.canvas.width * this.camZoom;
      camera.viewportHeight = this.canvas.height * this.camZoom;

      // 套用 0 ~ 360 度順時針相機旋轉向量
      const rad = (this.rotationDeg * Math.PI) / 180;
      camera.up.set(-Math.sin(rad), Math.cos(rad), 0);
      camera.update();

      this.sceneRenderer.begin();
      this.sceneRenderer.drawSkeleton(this.skeleton, true);
      this.sceneRenderer.end();

      if (onFrameUpdate) onFrameUpdate();
    }
  }
}

module.exports = SpineManager;