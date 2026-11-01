# GODDESS OF VICTORY: NIKKE - L2D Viewer & Desktop Pet

**[ [繁體中文](./README.md) | English ]**

A Windows Spine 2D Character Viewer and Transparent Desktop Pet application for *GODDESS OF VICTORY: NIKKE*, built with Electron and Spine WebGL (supporting both Spine 4.0 and 4.1 runtimes seamlessly).

![Main Interface Preview](./docs/preview_main_en.jpg)

---

## ⚖️ Disclaimer & Copyright

1. **Intellectual Property**: All *GODDESS OF VICTORY: NIKKE* game assets (including Spine 2D models, character illustrations, voice audio, and text lines) are the sole property and copyright of **SHIFT UP Corp.** and **Level Infinite**. I do not own any of these assets.
2. **Non-Commercial Fan Project**: This software is a fan-made, non-profit tool created purely for educational and preview purposes. Commercial use of this repository or its assets is strictly prohibited.
3. **Support the Official Game**: For the full story, music, and gameplay experience, **please download and play the official game *GODDESS OF VICTORY: NIKKE*** ([nikke-en.com](https://nikke-en.com/)).

---

## ✨ Key Features

### 1. Three Pose Modes: Full Body (Standing) / Cover / Aim
Switch seamlessly between Standing, Cover, and Aim postures for each character. The animation list and voice trigger pool automatically adapt to the active pose.

![Pose Switching Demo](./docs/demo_poses.gif)

### 2. Click Voice Interaction, Real-time Lip-Sync & Speech Bubble
* **Interactive Voices & Animations**: Click on the character to play random voice lines and trigger corresponding animations (e.g., `action` in standing mode, triple `cover_reload` in cover mode, or `aim_fire` burst in aim mode).
* **Real-time Audio Lip-Sync**: Analyzes voice amplitude via the Web Audio API to drive `talk_start` and `talk_end` mouth animations in real time.
* ** customizable Speech Bubble**: Anchors dynamically above the character's head with adjustable X/Y offsets and font size sliders.

![Voice & Lip-Sync Demo](./docs/demo_interaction.gif)
![Voice & Lip-Sync Demo 2](./docs/demo_interaction2.gif)

### 3. 🎯 Aim Mode: Adjustable Recoil/Shake Multiplier & Hold-to-Fire
* **Aim Shake Slider (0% ~ 300%)**: Customize the recoil and physics jiggle intensity during `aim_fire`, automatically syncing sub-tracks such as `aim_fire_hair` and `aim_fire_hip`.
* **Hold to Continuous Fire**: Click and hold on the character in Aim mode for continuous firing.

![Aim Mode & Shake Demo](./docs/demo_aim_fire.gif)
![Aim Mode & Shake Demo 2](./docs/demo_aim_fire2.gif)

### 4. 🐾 Borderless Transparent Windows Desktop Pet
* **Smart Click-Through**: Pin your favorite Nikke directly onto your Windows desktop! Transparent areas automatically pass mouse clicks through to your desktop icons and windows, while hovering over the character allows dragging and interaction.
* **Auto Idle Expressions**: Automatically plays random `expression_X` animations or reload/fire actions every 15–20 seconds in Desktop Pet mode.
* **Global Cursor Aim Tracking**: In Aim + Desktop Pet mode, the character dynamically tracks your mouse cursor across the screen (`aim_x` / `aim_y`), turning her body to aim wherever your cursor moves!

![Desktop Pet Demo](./docs/demo_desktop_pet.gif)
![Desktop Pet Demo 2](./docs/demo_desktop_pet2.gif)
![Desktop Pet Demo 3](./docs/demo_desktop_pet3.gif)

### 5. Canvas Tools & Favorites System
* **Transform Controls**: Zoom (25%–250%), 360° Rotation, Horizontal Mirroring, and Animation Speed control (0.1x–2.0x).
* **Custom Background & PNG Screenshot**: Load custom background images, pick solid background colors, or export high-resolution PNG screenshots.
* **Favorites & Auto-Save**: Bookmark your favorite Nikkes and costumes under the "⭐ Favorites" tab. All slider settings and camera positions are saved automatically.

---

## 🚀 Quick Start (No Node.js Installation Required!)

You **do NOT need to manually install Node.js** or run any terminal commands!

### Option A: Download Full Portable ZIP (Recommended)
1. Go to the **Releases** section on the right side of this page and download **`NikkeDesktopViewer_v1.0.zip`**.
2. Extract the ZIP to any folder on your PC.
3. Double-click **`啟動檢視器.bat`** to launch immediately!

### Option B: Download Source ZIP
1. Click the green **`<> Code`** button at the top right ➔ Select **`Download ZIP`** and extract it.
2. Double-click **`啟動檢視器.bat`**:
   * **First Launch**: The script will automatically download and extract the portable Electron runtime into the folder (takes ~1 minute).
   * **Subsequent Launches**: Double-clicking **`啟動檢視器.bat`** will open the viewer instantly!

---

## 📅 Changelog

### 💃 Character Roster Log
* **`2026/11/01`**: Added all released Nikkes (including costumes) **up to 2023**.

### 🛠️ Project Version History
* **`Ver 1.0.0` (2026/11/01) — Initial Release**
  * Dual Spine 4.0 & 4.1 runtime support with seamless switching between Full Body (Standing), Cover, and Aim poses.
  * Interactive voice playback, customizable speech bubbles, real-time audio lip-sync, and lip-sync conflict blacklist support.
  * Aim mode recoil/shake multiplier slider (0%–300%) and hold-to-fire continuous shooting.
  * Borderless transparent Windows Desktop Pet mode featuring smart click-through, periodic idle expressions, and global cursor aim tracking.
  * Built-in canvas tools (zoom, 360° rotation, horizontal mirror, custom background image, PNG screenshot export), Favorites system, and auto-saved user settings.