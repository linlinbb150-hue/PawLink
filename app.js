const defaultRoutines = [
  { id: 1, time: "08:15", title: "早餐", note: "湿粮 + 清水", done: true },
  { id: 2, time: "17:30", title: "晚餐", note: "还有 6 小时", done: false },
  { id: 3, time: "21:00", title: "互动时间", note: "逗猫棒 15 分钟", done: true },
];

const state = {
  routines: JSON.parse(localStorage.getItem("pawlink-routines") || "null") || defaultRoutines,
  pet: JSON.parse(localStorage.getItem("pawlink-pet") || "null") || { name: "团子", kind: "英国短毛猫" },
  stream: null,
};

const $ = (selector) => document.querySelector(selector);
const toast = (message) => {
  const el = $("#toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(window.toastTimer);
  window.toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
};

function save() {
  localStorage.setItem("pawlink-routines", JSON.stringify(state.routines));
  localStorage.setItem("pawlink-pet", JSON.stringify(state.pet));
}

function updateSummary() {
  const done = state.routines.filter((item) => item.done).length;
  const total = state.routines.length;
  const percent = total ? Math.round((done / total) * 100) : 0;
  $("#done-count").textContent = done;
  $("#total-count").textContent = total;
  $("#care-percent").textContent = percent;
  $("#progress-fill").style.width = `${percent}%`;
  const next = state.routines.find((item) => !item.done);
  $("#next-task").textContent = next ? `${next.time} · ${next.title}` : "今天已全部完成";
}

function renderRoutines() {
  const list = $("#routine-list");
  list.innerHTML = state.routines
    .sort((a, b) => a.time.localeCompare(b.time))
    .map((item) => `<article class="routine card ${item.done ? "done" : ""}">
      <div class="routine-top"><span class="routine-time">${item.time}</span><button class="routine-check" data-id="${item.id}" aria-label="切换 ${item.title} 完成状态"></button></div>
      <h3>${item.title}</h3><p>${item.done ? "已完成" : item.note}</p>
    </article>`)
    .join("");
  list.querySelectorAll(".routine-check").forEach((button) => {
    button.addEventListener("click", () => {
      const item = state.routines.find((routine) => routine.id === Number(button.dataset.id));
      item.done = !item.done;
      save(); renderRoutines(); updateSummary();
      toast(item.done ? `已记录：${item.title}完成` : `已恢复：${item.title}`);
    });
  });
}

function renderPet() {
  $("#side-name").textContent = state.pet.name;
  $("#stage-name").textContent = state.pet.name;
  $(".pet-switch small").textContent = state.pet.kind;
  $("#pet-name-input").value = state.pet.name;
  $("#pet-kind-input").value = state.pet.kind;
}

function setDate() {
  const date = new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "long" }).format(new Date());
  $("#date-label").textContent = date.toUpperCase();
}

function petReact(message, mood = "开心地看着你") {
  $("#speech").innerHTML = `${message}<span></span>`;
  $("#mood-label").textContent = mood;
  $("#pet-wrap").animate([{ transform: "translateY(0)" }, { transform: "translateY(-15px) rotate(-3deg)" }, { transform: "translateY(0)" }], { duration: 650, easing: "ease-out" });
}

async function toggleCamera(enabled) {
  const video = $("#camera"), placeholder = $("#camera-placeholder");
  if (!enabled) {
    state.stream?.getTracks().forEach((track) => track.stop());
    state.stream = null; video.srcObject = null; video.style.display = "none";
    placeholder.style.display = "grid"; $("#camera-status").textContent = "未启用摄像头";
    $("#camera-preview").classList.remove("detected"); return;
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    toast("当前环境不支持摄像头访问"); $("#camera-switch").checked = false; return;
  }
  try {
    state.stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    video.srcObject = state.stream; video.style.display = "block"; placeholder.style.display = "none";
    $("#camera-status").textContent = "仅在本机分析 · 未保存画面";
    toast("视觉感知已开启，画面仅在本机处理");
  } catch {
    $("#camera-switch").checked = false;
    toast("未取得摄像头权限，请在浏览器设置中允许访问");
  }
}

function simulateDetection() {
  if (!$("#camera-switch").checked) { toast("请先开启视觉感知"); return; }
  const preview = $("#camera-preview"); preview.classList.add("detected");
  $("#camera-status").textContent = `刚刚 · 检测到${state.pet.name}入画`;
  petReact(`我看到你啦！原来你就在身边。`, "开心地摇着尾巴");
  toast(`检测到${state.pet.name}入画 · 已触发陪伴互动`);
  setTimeout(() => preview.classList.remove("detected"), 5000);
}

$("#add-routine").addEventListener("click", () => $("#routine-dialog").showModal());
$("#edit-pet").addEventListener("click", () => $("#pet-dialog").showModal());
$("#save-routine").addEventListener("click", (event) => {
  const title = $("#new-title").value.trim(), time = $("#new-time").value;
  if (!title || !time) { event.preventDefault(); toast("请填写事项名称和时间"); return; }
  state.routines.push({ id: Date.now(), title, time, note: "即将到来", done: false });
  save(); renderRoutines(); updateSummary(); toast(`已添加「${title}」提醒`);
});
$("#save-pet").addEventListener("click", () => {
  state.pet.name = $("#pet-name-input").value.trim() || "团子";
  state.pet.kind = $("#pet-kind-input").value.trim() || "小宠物";
  save(); renderPet(); petReact(`我是${state.pet.name}，以后也请多关照！`, "期待和你相伴"); toast("宠物档案已保存在本机");
});
$("#camera-switch").addEventListener("change", (event) => toggleCamera(event.target.checked));
$("#simulate-detect").addEventListener("click", simulateDetection);
$("#pet-action").addEventListener("click", () => petReact("嘿，摸摸我吧！", "享受互动中"));
document.querySelectorAll(".nav-item").forEach((button) => button.addEventListener("click", () => {
  document.querySelectorAll(".nav-item").forEach((item) => item.classList.remove("active")); button.classList.add("active");
  const panel = button.dataset.panel;
  document.querySelectorAll(".panel-view").forEach((section) => {
    if (section.dataset.view !== panel) section.style.display = "none";
    else section.style.display = panel === "home" ? "" : "block";
  });
}));

window.addEventListener("beforeunload", () => state.stream?.getTracks().forEach((track) => track.stop()));
setDate(); renderPet(); renderRoutines(); updateSummary();
