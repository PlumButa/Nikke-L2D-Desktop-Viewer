const path = require('path');

class LipSyncManager {
  constructor(spineManager) {
    this.spineManager = spineManager;
    this.audioCtx = null;
    this.analyser = null;
    this.dataArray = null;
    this.currentAudio = null;
    this.isSpeaking = false;
    this.mouthOpen = false;
    this.rafId = null;
  }

  initAudioContext() {
    if (!this.audioCtx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      this.audioCtx = new AudioContext();
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 256;
      this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);
    }
    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
  }

  playVoice(folderPath, audioRelPath, onEndedCallback) {
    this.stopVoice();
    this.initAudioContext();

    const fullUrl = 'file:///' + path.join(folderPath, audioRelPath).replace(/\\/g, '/');
    this.currentAudio = new Audio(fullUrl);
    this.currentAudio.crossOrigin = 'anonymous';

    const source = this.audioCtx.createMediaElementSource(this.currentAudio);
    source.connect(this.analyser);
    this.analyser.connect(this.audioCtx.destination);

    this.isSpeaking = true;
    this.mouthOpen = false;

    this.currentAudio.onplay = () => {
      this.startLipSyncLoop();
    };

    this.currentAudio.onended = () => {
      this.stopLipSyncLoop();
      if (onEndedCallback) onEndedCallback();
    };

    this.currentAudio.play().catch(err => {
      console.error('語音播放失敗:', err);
      this.stopLipSyncLoop();
    });
  }

  startLipSyncLoop() {
    const checkVolume = () => {
      if (!this.isSpeaking || !this.analyser) return;

      this.analyser.getByteFrequencyData(this.dataArray);
      // 計算人聲主要頻段平均音量
      let sum = 0;
      const count = 40;
      for (let i = 2; i < count; i++) {
        sum += this.dataArray[i];
      }
      const avgVolume = sum / (count - 2);

      // 音量大於門檻值(18) -> 觸發 talk_start 張嘴動作；小於門檻(停頓氣口) -> 觸發 talk_end 閉嘴
      if (avgVolume > 18 && !this.mouthOpen) {
        this.mouthOpen = true;
        this.spineManager.setMouthTalking(true);
      } else if (avgVolume <= 12 && this.mouthOpen) {
        this.mouthOpen = false;
        this.spineManager.setMouthTalking(false);
      }

      this.rafId = requestAnimationFrame(checkVolume);
    };
    this.rafId = requestAnimationFrame(checkVolume);
  }

  stopLipSyncLoop() {
    this.isSpeaking = false;
    this.mouthOpen = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.spineManager.setMouthTalking(false, true);
  }

  stopVoice() {
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio = null;
    }
    this.stopLipSyncLoop();
  }
}

module.exports = LipSyncManager;