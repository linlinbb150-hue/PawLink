const $=(s)=>document.querySelector(s); const toast=(text)=>{const el=$('#toast');el.textContent=text;el.classList.add('show');setTimeout(()=>el.classList.remove('show'),2600)};
// Single source of truth for the preset picker.  Every id here must also exist
// in `presetModels` inside main.cjs, otherwise the main process falls back to
// the cat model when the profile is saved.
const PRESETS = [
  { id: 'cat', icon: '🐈', label: '猫' },
  { id: 'dog', icon: '🐕', label: '狗' },
  { id: 'bunny', icon: '🐇', label: '兔子' },
  { id: 'fox', icon: '🦊', label: '狐狸' },
  { id: 'panda', icon: '🐼', label: '熊猫' },
  { id: 'parrot', icon: '🦜', label: '鹦鹉' },
  { id: 'protagonist', icon: '🧍', label: '卡通人偶' }
];
let selectedPreset='cat';
$('#preset-grid').innerHTML = PRESETS.map((preset) => `<button type="button" data-preset="${preset.id}" title="${preset.label}">${preset.icon}<span>${preset.label}</span></button>`).join('');
function paintPreset(){document.querySelectorAll('[data-preset]').forEach((button)=>button.classList.toggle('active',button.dataset.preset===selectedPreset));}
window.pawlink.getProfile().then((p)=>{$('#name').value=p.name;$('#kind').value=p.kind;selectedPreset=p.preset||'cat';paintPreset();});
document.querySelectorAll('[data-preset]').forEach((button)=>button.onclick=()=>{selectedPreset=button.dataset.preset;paintPreset();});
$('#save-profile').onclick=async()=>{await window.pawlink.saveProfile({name:$('#name').value.trim()||'团子',kind:$('#kind').value.trim()||'小宠物',preset:selectedPreset,routines:[]});toast('宠物档案和角色已保存到本机');};
