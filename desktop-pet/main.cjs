const { app, BrowserWindow, ipcMain, dialog, globalShortcut, safeStorage, Tray, Menu, nativeImage, Notification } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const captureTestArg = process.argv.find((arg) => arg.startsWith('--capture-test='));
const capturePresetArg = process.argv.find((arg) => arg.startsWith('--capture-preset='));
const captureActionArg = process.argv.find((arg) => arg.startsWith('--capture-action='));
const captureChatArg = process.argv.find((arg) => arg.startsWith('--capture-chat='));
if (captureTestArg) app.setPath('userData', path.join(__dirname, `.capture-user-data-${capturePresetArg?.slice('--capture-preset='.length) || 'default'}-${captureActionArg?.slice('--capture-action='.length) || (captureChatArg ? 'chat' : 'idle')}`));
if (captureTestArg) app.commandLine.appendSwitch('disable-http-cache');

// This computer has no usable GPU. Keep WebGL enabled through ANGLE and use
// Windows' WARP software rasterizer. SwiftShader crashes during GPU-process
// startup on this machine, while WARP stays entirely on the Windows CPU path.
app.commandLine.appendSwitch('use-gl', 'angle');
app.commandLine.appendSwitch('use-angle', 'warp');

let petWindow;
let settingsWindow;
let recoveryWindow;
let clickThrough = false;
let tray;
let dragState = null;
const petChatHistory = [];
const OLLAMA_CHAT_URL = 'http://127.0.0.1:11434/api/chat';
const OLLAMA_MODEL = 'qwen3:1.7b';
const PET_ACTIONS = new Set(['idle', 'interaction', 'dance', 'sing']);
const dataPath = () => path.join(app.getPath('userData'), 'pawlink.json');
const secretPath = () => path.join(app.getPath('userData'), 'pawlink-secret.bin');
const modelPath = () => path.join(app.getPath('userData'), 'pet-model.glb');
const presetModels = {
  cat: 'kenney-cat.glb', dog: 'kenney-animal-dog.glb', bunny: 'kenney-animal-bunny.glb',
  fox: 'kenney-animal-fox.glb', panda: 'kenney-animal-panda.glb', parrot: 'kenney-animal-parrot.glb',
  protagonist: 'kenney-protagonist/kenney-protagonist.glb'
};
const modelUrlFor = (preset = 'cat') => pathToFileURL(path.join(__dirname, 'assets', presetModels[preset] || presetModels.cat)).href;

async function readProfile() {
  try { return JSON.parse(await fs.readFile(dataPath(), 'utf8')); }
  catch { return captureTestArg ? { name: '测试角色', kind: '本地模型', preset: capturePresetArg?.slice('--capture-preset='.length) || 'protagonist', routines: [] } : { name: '团子', kind: '小猫', preset: 'cat', routines: [] }; }
}
async function writeProfile(profile) { await fs.writeFile(dataPath(), JSON.stringify(profile, null, 2), 'utf8'); }
async function readKey() {
  try { return safeStorage.decryptString(await fs.readFile(secretPath())); } catch { return ''; }
}
async function writeKey(key) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('系统密钥存储当前不可用。');
  await fs.writeFile(secretPath(), safeStorage.encryptString(key));
}

async function askPetModel(message) {
  const text = String(message || '').trim().slice(0, 300);
  if (!text) throw new Error('先输入一句想说的话吧。');
  const profile = await readProfile();
  const availableActions = [...PET_ACTIONS];
  const systemPrompt = `你是一只住在电脑桌面上的宠物，名字叫“${profile.name || '团子'}”，品种是“${profile.kind || '小宠物'}”。
性格活泼、温柔、简短，像熟悉的小伙伴。不要说自己是AI或语言模型。
回复不超过60个汉字，每次只选择一个动作。
当前角色可用动作只有：${availableActions.join('、')}。
情绪只能是：happy、calm、sad、curious。
reply 必须是给用户阅读的自然中文句子，绝对不能填 happy、calm、sad、curious 或动作名称。`;
  let response;
  try {
    response = await fetch(OLLAMA_CHAT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(90000),
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        stream: false,
        think: false,
        format: {
          type: 'object',
          properties: {
            reply: { type: 'string', description: '给用户看的简短中文台词，不能填情绪或动作标签' },
            emotion: { type: 'string', description: '情绪标签', enum: ['happy', 'calm', 'sad', 'curious'] },
            action: { type: 'string', description: '桌宠要播放的动作标签', enum: availableActions }
          },
          required: ['reply', 'emotion', 'action']
        },
        options: { temperature: 0.3, num_ctx: 4096, num_predict: 160 },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: '我今天完成了一个很难的任务！' },
          { role: 'assistant', content: '{"reply":"太棒了，你的努力真的有回报啦！","emotion":"happy","action":"interaction"}' },
          { role: 'user', content: '我今天有点累。' },
          { role: 'assistant', content: '{"reply":"辛苦啦，先休息一会儿，我会陪着你。","emotion":"calm","action":"idle"}' },
          ...petChatHistory,
          { role: 'user', content: text }
        ]
      })
    });
  } catch (error) {
    if (error.name === 'TimeoutError') throw new Error('本地模型响应超时，请稍后再试。');
    throw new Error('无法连接 Ollama，请先运行 ollama serve。');
  }
  if (!response.ok) throw new Error(`Ollama 请求失败：${response.status}`);
  const payload = await response.json();
  if (captureTestArg) console.log('[ollama-payload]', JSON.stringify(payload));
  let result;
  try { result = JSON.parse(payload.message?.content || '{}'); }
  catch { throw new Error('本地模型未返回有效 JSON，请再试一次。'); }
  const rawReply = String(result.reply || '').trim();
  const invalidReply = new Set(['happy', 'calm', 'sad', 'curious', 'idle', 'interaction', 'dance', 'sing']);
  const safe = {
    reply: (!rawReply || invalidReply.has(rawReply.toLowerCase()) ? '太棒了，你真的做到了！' : rawReply).slice(0, 120),
    emotion: ['happy', 'calm', 'sad', 'curious'].includes(result.emotion) ? result.emotion : 'calm',
    action: availableActions.includes(result.action) ? result.action : 'idle'
  };
  petChatHistory.push({ role: 'user', content: text }, { role: 'assistant', content: JSON.stringify(safe) });
  if (petChatHistory.length > 12) petChatHistory.splice(0, petChatHistory.length - 12);
  return safe;
}

function createPetWindow() {
  const capturePath = captureTestArg ? path.resolve(captureTestArg.slice('--capture-test='.length)) : null;
  petWindow = new BrowserWindow({
    // Reserve a dedicated footer for the nameplate and controls so they never
    // cover the 3D canvas.
    width: 360, height: 470, x: 30, y: 520, frame: false, transparent: true,
    alwaysOnTop: true, skipTaskbar: true, resizable: false, hasShadow: false,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true }
  });
  petWindow.setAlwaysOnTop(true, 'floating');
  // Always begin in interactive mode. This also resets any previous click-through state.
  petWindow.setIgnoreMouseEvents(false);
  petWindow.loadFile(path.join(__dirname, 'renderer', 'pet.html'), capturePath ? { query: { captureTest: '1' } } : undefined);
  if (capturePath) {
    petWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => console.log('[renderer]', { level, message, line, sourceId }));
    petWindow.webContents.on('render-process-gone', (_event, details) => console.error('[renderer-gone]', details));
    petWindow.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        try {
          if (captureChatArg) {
            const chatText = captureChatArg.slice('--capture-chat='.length);
            await petWindow.webContents.executeJavaScript(`document.querySelector('#chat-button').click(); document.querySelector('#chat-input').value = ${JSON.stringify(chatText)}; document.querySelector('#chat-panel').requestSubmit();`);
            for (let attempt = 0; attempt < 90; attempt += 1) {
              await new Promise((resolve) => setTimeout(resolve, 1000));
              const busy = await petWindow.webContents.executeJavaScript("document.querySelector('#chat-panel').classList.contains('busy')");
              if (!busy) break;
            }
          }
          if (captureActionArg) {
            const actionName = captureActionArg.slice('--capture-action='.length);
            const button = { wave: '#pet-button', interaction: '#pet-button', dance: '#jump-button', sing: '#dance-button' }[actionName];
            if (button) await petWindow.webContents.executeJavaScript(`document.querySelector('${button}').click()`);
            const isOriginalMaliaoTest = capturePresetArg?.endsWith('maliao') && actionName === 'interaction';
            await new Promise((resolve) => setTimeout(resolve, isOriginalMaliaoTest ? 2500 : 650));
          }
          const image = await petWindow.capturePage();
          await fs.writeFile(capturePath, image.toPNG());
          console.log(`[capture-written] ${capturePath}`);
        } catch (error) {
          console.error('[capture-failed]', error);
        } finally {
          app.isQuiting = true;
          app.quit();
        }
      }, 5000);
    });
  }
  petWindow.once('ready-to-show', () => {
    petWindow.setIgnoreMouseEvents(false);
    petWindow.setFocusable(true);
    petWindow.show();
  });
  petWindow.on('close', (event) => { if (!app.isQuiting) { event.preventDefault(); petWindow.hide(); } });
}
function createSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) { settingsWindow.focus(); return; }
  settingsWindow = new BrowserWindow({
    width: 720, height: 620, minWidth: 620, minHeight: 520, title: 'PawLink 设置',
    backgroundColor: '#f7f4ee', webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true }
  });
  settingsWindow.loadFile(path.join(__dirname, 'renderer', 'settings.html'));
  settingsWindow.on('closed', () => { settingsWindow = null; });
}
function createTray() {
  const iconSvg = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" rx="16" fill="#3f5c43"/><circle cx="22" cy="22" r="7" fill="#fff8e9"/><circle cx="42" cy="22" r="7" fill="#fff8e9"/><circle cx="18" cy="38" r="6" fill="#fff8e9"/><circle cx="46" cy="38" r="6" fill="#fff8e9"/><path d="M32 31c-9 0-14 8-10 14 3 5 7 0 10 0s7 5 10 0c4-6-1-14-10-14z" fill="#fff8e9"/></svg>').toString('base64')}`;
  tray = new Tray(nativeImage.createFromDataURL(iconSvg));
  tray.setToolTip('PawLink 宠伴桌面');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示桌宠', click: () => petWindow?.show() },
    { label: '打开设置', click: createSettingsWindow },
    { type: 'separator' },
    { label: '退出 PawLink', click: () => { app.isQuiting = true; app.quit(); } }
  ]));
  tray.on('click', () => petWindow?.show());
}
function createRecoveryWindow() {
  if (recoveryWindow && !recoveryWindow.isDestroyed()) return recoveryWindow;
  recoveryWindow = new BrowserWindow({ width: 156, height: 42, frame: false, resizable: false, transparent: false, alwaysOnTop: true, skipTaskbar: true, show: false, backgroundColor: '#344d38', webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true } });
  recoveryWindow.setAlwaysOnTop(true, 'floating');
  recoveryWindow.loadFile(path.join(__dirname, 'renderer', 'recovery.html'));
  recoveryWindow.on('closed', () => { recoveryWindow = null; });
  return recoveryWindow;
}
function showRecoveryControl() {
  const recovery = createRecoveryWindow(); const bounds = petWindow?.getBounds();
  if (bounds) recovery.setPosition(bounds.x + Math.max(0, bounds.width - 156), Math.max(0, bounds.y - 47));
  recovery.showInactive();
}
function setClickThrough(enabled) {
  clickThrough = enabled;
  petWindow?.setIgnoreMouseEvents(enabled, { forward: true });
  petWindow?.webContents.send('click-through-changed', enabled);
  if (enabled) showRecoveryControl(); else recoveryWindow?.hide();
  if (Notification.isSupported()) new Notification({ title: 'PawLink', body: enabled ? '鼠标穿透已开启。按 Alt + Shift + P 可恢复交互。' : '鼠标穿透已关闭，可以与桌宠互动。' }).show();
}
function focusPet() { if (petWindow?.isMinimized()) petWindow.restore(); petWindow?.show(); petWindow?.focus(); }
async function generateModel(dataUri) {
  const apiKey = await readKey();
  if (!apiKey) throw new Error('请先在设置页保存 Meshy API Key。');
  const headers = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
  const create = await fetch('https://api.meshy.ai/openapi/v1/image-to-3d', {
    method: 'POST', headers, body: JSON.stringify({ image_url: dataUri, ai_model: 'meshy-7.1', should_texture: true, target_formats: ['glb'] })
  });
  if (!create.ok) throw new Error(`创建 3D 任务失败：${await create.text()}`);
  const { result: taskId } = await create.json();
  for (let attempt = 0; attempt < 90; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 4000));
    const response = await fetch(`https://api.meshy.ai/openapi/v1/image-to-3d/${taskId}`, { headers });
    if (!response.ok) throw new Error('无法读取 3D 生成进度。');
    const task = await response.json();
    settingsWindow?.webContents.send('model-progress', { progress: task.progress || 0, status: task.status });
    if (task.status === 'SUCCEEDED' && task.model_urls?.glb) {
      const asset = await fetch(task.model_urls.glb);
      if (!asset.ok) throw new Error('无法下载生成的 3D 模型。');
      await fs.writeFile(modelPath(), Buffer.from(await asset.arrayBuffer()));
      petWindow?.webContents.send('model-ready', pathToFileURL(modelPath()).href);
      return { modelUrl: pathToFileURL(modelPath()).href };
    }
    if (['FAILED', 'CANCELED'].includes(task.status)) throw new Error(task.task_error?.message || '3D 生成未完成。');
  }
  throw new Error('3D 生成等待超时，请稍后在设置页重试。');
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (process.argv.some((arg) => arg.startsWith('--capture-test='))) {
  console.log('[startup]', { argv: process.argv, userData: app.getPath('userData'), gotSingleInstanceLock });
}
if (!gotSingleInstanceLock) {
  app.quit();
} else app.on('second-instance', () => focusPet());

app.whenReady().then(() => {
  createPetWindow();
  createTray();
  globalShortcut.register('Alt+Shift+P', () => setClickThrough(!clickThrough));
  globalShortcut.register('Alt+Shift+O', () => createSettingsWindow());
  app.on('activate', focusPet);
});
app.on('window-all-closed', (event) => event.preventDefault());
app.on('will-quit', () => globalShortcut.unregisterAll());

ipcMain.handle('open-settings', () => createSettingsWindow());
ipcMain.handle('toggle-click-through', () => { setClickThrough(!clickThrough); return clickThrough; });
ipcMain.handle('get-profile', readProfile);
ipcMain.handle('save-profile', async (_, profile) => { const safeProfile = { ...profile, preset: presetModels[profile.preset] ? profile.preset : 'cat' }; await writeProfile(safeProfile); petWindow?.webContents.send('profile-updated', safeProfile); petWindow?.webContents.send('model-ready', modelUrlFor(safeProfile.preset)); });
ipcMain.handle('get-model-url', async () => modelUrlFor((await readProfile()).preset));
ipcMain.handle('ask-pet', async (_, message) => askPetModel(message));
ipcMain.handle('pick-photo', async () => {
  const result = await dialog.showOpenDialog(settingsWindow, { properties: ['openFile'], filters: [{ name: 'Pet photos', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] });
  if (result.canceled) return null;
  const file = result.filePaths[0]; const mime = path.extname(file).toLowerCase() === '.png' ? 'image/png' : 'image/jpeg';
  return { name: path.basename(file), dataUri: `data:${mime};base64,${(await fs.readFile(file)).toString('base64')}` };
});
ipcMain.handle('save-api-key', (_, key) => writeKey(key));
ipcMain.handle('generate-model', (_, dataUri) => generateModel(dataUri));
ipcMain.handle('restore-interaction', () => setClickThrough(false));
ipcMain.on('drag-start', (_, point) => {
  if (petWindow && !clickThrough) dragState = { bounds: petWindow.getBounds() };
});
ipcMain.on('drag-move', (_, point) => {
  if (!petWindow || !dragState || clickThrough) return;
  // Incremental movement is stable across mixed-DPI monitors.  Do not use
  // renderer `screenX/screenY`: their coordinate space can differ from an
  // Electron BrowserWindow's coordinate space and causes cumulative drift.
  const dx = Number(point?.dx); const dy = Number(point?.dy);
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
  const x = Math.round(dragState.bounds.x + dx);
  const y = Math.round(dragState.bounds.y + dy);
  petWindow.setPosition(x, y);
  dragState.bounds = { ...dragState.bounds, x, y };
});
ipcMain.on('drag-end', () => { dragState = null; });
