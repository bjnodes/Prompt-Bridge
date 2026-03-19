const dom = {
  startSessionButton: document.getElementById("startSessionButton"),
  refreshStatusButton: document.getElementById("refreshStatusButton"),
  sessionBrowserStatus: document.getElementById("sessionBrowserStatus"),
  sessionLoginStatus: document.getElementById("sessionLoginStatus"),
  sessionMessage: document.getElementById("sessionMessage"),
  selectedCutTitle: document.getElementById("selectedCutTitle"),
  selectedCutSubtitle: document.getElementById("selectedCutSubtitle"),
  selectedCutThumbnail: document.getElementById("selectedCutThumbnail"),
  selectedCutUploadButton: document.getElementById("selectedCutUploadButton"),
  selectedCutThumbnailInput: document.getElementById("selectedCutThumbnailInput"),
  cutSummaryInput: document.getElementById("cutSummaryInput"),
  cutNotesInput: document.getElementById("cutNotesInput"),
  startFrameUploadButton: document.getElementById("startFrameUploadButton"),
  startFrameClearButton: document.getElementById("startFrameClearButton"),
  startFrameInput: document.getElementById("startFrameInput"),
  startFramePreviewWrap: document.getElementById("startFramePreviewWrap"),
  startFramePreview: document.getElementById("startFramePreview"),
  startFrameStatus: document.getElementById("startFrameStatus"),
  startFrameHint: document.getElementById("startFrameHint"),
  promptInput: document.getElementById("promptInput"),
  generateButton: document.getElementById("generateButton"),
  modelList: document.getElementById("modelList"),
  englishPromptOutput: document.getElementById("englishPromptOutput"),
  notesSummary: document.getElementById("notesSummary"),
  copyPromptButton: document.getElementById("copyPromptButton"),
  promptOutputCard: document.getElementById("promptOutputCard"),
  segmentsOutputList: document.getElementById("segmentsOutputList"),
  historyList: document.getElementById("historyList"),
  modeTabs: Array.from(document.querySelectorAll(".mode-tab")),
  videoSettingsPanel: document.getElementById("videoSettingsPanel"),
  totalDurationInput: document.getElementById("totalDurationInput"),
  multiCutPanel: document.getElementById("multiCutPanel"),
  multiCutToggle: document.getElementById("multiCutToggle"),
  multiCutFields: document.getElementById("multiCutFields"),
  multiCutCountInput: document.getElementById("multiCutCountInput"),
  cutDialog: document.getElementById("cutDialog"),
  cutPickerDialog: document.getElementById("cutPickerDialog"),
  cutForm: document.getElementById("cutForm"),
  cutListButton: document.getElementById("cutListButton"),
  newCutButton: document.getElementById("newCutButton"),
  closeDialogButton: document.getElementById("closeDialogButton"),
  cancelDialogButton: document.getElementById("cancelDialogButton"),
  closeCutPickerButton: document.getElementById("closeCutPickerButton"),
  cutPickerList: document.getElementById("cutPickerList"),
  newCutNameInput: document.getElementById("newCutNameInput")
};

const VIEW_KEY = "prompt-bridge-view-state";
const API_BASE_KEY = "prompt-bridge-api-base";
const MULTI_CUT_SUPPORTED_MODELS = new Set(["kling-3.0", "seedance-2.0"]);
const EMPTY_CUT_SUBTITLE = "컷 제목이나 요약을 입력하면 이 컷의 방향이 여기에 표시됩니다.";

let state = {
  mode: "image",
  selectedModelId: "",
  selectedCutId: "",
  cuts: [],
  models: { image: [], video: [] },
  latestResult: null,
  session: null,
  multiCutEnabled: false,
  multiCutCount: 4,
  totalDurationSec: 5,
  isGenerating: false
};

let saveTimer = null;
let pendingCutPatch = {};
let pendingCutId = "";

function normalizeApiBase(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function getConfiguredApiBase() {
  const queryBase = normalizeApiBase(new URLSearchParams(window.location.search).get("apiBase"));
  if (queryBase) {
    localStorage.setItem(API_BASE_KEY, queryBase);
    return queryBase;
  }

  const runtimeBase = normalizeApiBase(window.PROMPT_BRIDGE_CONFIG?.apiBaseUrl);
  if (runtimeBase) {
    return runtimeBase;
  }

  return normalizeApiBase(localStorage.getItem(API_BASE_KEY));
}

function buildApiUrl(url) {
  const apiBase = getConfiguredApiBase();
  return apiBase ? `${apiBase}${url}` : url;
}

function loadViewState() {
  try {
    return JSON.parse(localStorage.getItem(VIEW_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveViewState() {
  localStorage.setItem(
    VIEW_KEY,
    JSON.stringify({
      mode: state.mode,
      selectedModelId: state.selectedModelId,
      selectedCutId: state.selectedCutId,
      multiCutEnabled: state.multiCutEnabled,
      multiCutCount: state.multiCutCount,
      totalDurationSec: state.totalDurationSec
    })
  );
}

async function request(url, options = {}) {
  const response = await fetch(buildApiUrl(url), {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...options
  });

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    const rawText = await response.text();
    const preview = rawText.replace(/\s+/g, " ").trim().slice(0, 120);

    if (preview.includes("<!doctype") || preview.includes("<html") || preview.includes("The page could not be found")) {
      throw new Error(
        "현재 배포 환경에서 Prompt Bridge API가 실행되지 않고 있습니다. 이 앱은 Vercel 정적/서버리스 배포로는 동작하지 않고, Node + Playwright + 지속 세션 저장이 가능한 서버가 필요합니다."
      );
    }

    throw new Error(`API 응답이 JSON이 아닙니다. 서버 응답: ${preview || "empty response"}`);
  }

  const data = await response.json();
  if (!response.ok || !data.ok) {
    throw new Error(data.error || "요청 처리에 실패했습니다.");
  }
  return data;
}

function getSelectedCut() {
  return state.cuts.find((cut) => cut.id === state.selectedCutId) || null;
}

function getSelectedModel() {
  return state.models[state.mode]?.find((model) => model.id === state.selectedModelId) || null;
}

function getCurrentOutputEntry() {
  return state.latestResult || getSelectedCut()?.promptHistory?.at(-1) || null;
}

function supportsMultiCut(modelId = state.selectedModelId) {
  return MULTI_CUT_SUPPORTED_MODELS.has(modelId);
}

function normalizeMultiCutCount(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 4;
  }
  return Math.max(2, Math.min(8, Math.round(parsed)));
}

function normalizeDuration(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 5;
  }
  return Math.max(1, Math.min(60, Math.round(parsed)));
}

function replaceCuts(cuts) {
  state.cuts = cuts;
  if (!state.cuts.some((cut) => cut.id === state.selectedCutId)) {
    state.selectedCutId = state.cuts[0]?.id || "";
  }
  saveViewState();
}

function mergeSelectedCutLocally(fields) {
  const cut = getSelectedCut();
  if (!cut) {
    return null;
  }

  const merged = { ...cut, ...fields };
  state.cuts = state.cuts.map((item) => (item.id === cut.id ? merged : item));
  return merged;
}

function updateSelectedCutPreviewText(cut) {
  dom.selectedCutSubtitle.textContent = (cut?.summary || "").trim() || EMPTY_CUT_SUBTITLE;
}

function scheduleCutSave(fields) {
  const updatedCut = mergeSelectedCutLocally(fields);
  if (!updatedCut) {
    return;
  }

  if (pendingCutId && pendingCutId !== updatedCut.id) {
    pendingCutPatch = {};
  }

  pendingCutId = updatedCut.id;
  pendingCutPatch = { ...pendingCutPatch, ...fields };

  if ("summary" in fields) {
    updateSelectedCutPreviewText(updatedCut);
  }

  if (saveTimer) {
    window.clearTimeout(saveTimer);
  }

  saveTimer = window.setTimeout(async () => {
    try {
      await flushPendingCutSave();
    } catch (error) {
      alert(error.message);
    }
  }, 420);
}

async function flushPendingCutSave() {
  if (!pendingCutId || !Object.keys(pendingCutPatch).length) {
    return;
  }

  if (saveTimer) {
    window.clearTimeout(saveTimer);
    saveTimer = null;
  }

  const cutId = pendingCutId;
  const body = { ...pendingCutPatch };
  pendingCutPatch = {};
  pendingCutId = "";

  const data = await request(`/api/cuts/${cutId}`, {
    method: "PATCH",
    body: JSON.stringify(body)
  });

  replaceCuts(data.cuts);
}

async function bootstrap() {
  const viewState = loadViewState();
  const data = await request("/api/bootstrap");

  state.models = data.models;
  state.cuts = data.cuts;
  state.session = data.session;
  state.mode = viewState.mode === "video" ? "video" : "image";
  state.selectedModelId =
    data.models[state.mode].find((model) => model.id === viewState.selectedModelId)?.id || data.models[state.mode][0]?.id || "";
  state.selectedCutId = data.cuts.find((cut) => cut.id === viewState.selectedCutId)?.id || data.cuts[0]?.id || "";
  state.multiCutEnabled = Boolean(viewState.multiCutEnabled);
  state.multiCutCount = normalizeMultiCutCount(viewState.multiCutCount || 4);
  state.totalDurationSec = normalizeDuration(viewState.totalDurationSec || 5);
  state.latestResult = getSelectedCut()?.promptHistory?.at(-1) || null;

  if (!supportsMultiCut()) {
    state.multiCutEnabled = false;
  }

  render();
}

function render() {
  renderSession();
  renderSelectedCut();
  renderModels();
  renderVideoSettings();
  renderMultiCutPanel();
  renderOutputs();
  renderHistory();
  renderCutPicker();
  updatePromptLoadingState();
}

function renderSession() {
  const session = state.session || {};
  dom.sessionBrowserStatus.textContent = session.browserOpen ? "브라우저 열림" : "브라우저 닫힘";
  dom.sessionLoginStatus.textContent = session.loggedIn ? "로그인 완료" : "로그인 필요";
  dom.sessionMessage.textContent = session.message || "세션 상태를 불러오는 중입니다.";
}

function renderSelectedCut() {
  const cut = getSelectedCut();
  if (!cut) {
    dom.selectedCutTitle.textContent = "컷을 선택해 주세요";
    dom.selectedCutSubtitle.textContent = EMPTY_CUT_SUBTITLE;
    dom.selectedCutThumbnail.style.backgroundImage = "";
    dom.selectedCutUploadButton.textContent = "이미지 +";
    dom.selectedCutUploadButton.disabled = true;
    dom.cutSummaryInput.value = "";
    dom.cutNotesInput.value = "";
    renderStartFrame("");
    dom.promptInput.value = "";
    return;
  }

  dom.selectedCutTitle.textContent = cut.name;
  updateSelectedCutPreviewText(cut);
  dom.selectedCutThumbnail.style.backgroundImage = cut.thumbnailDataUrl
    ? `linear-gradient(180deg, rgba(0, 0, 0, 0.08), rgba(0, 0, 0, 0.62)), url('${cut.thumbnailDataUrl}')`
    : "";
  dom.selectedCutUploadButton.textContent = cut.thumbnailDataUrl ? "이미지 변경" : "이미지 +";
  dom.selectedCutUploadButton.disabled = false;
  dom.cutSummaryInput.value = cut.summary || "";
  dom.cutNotesInput.value = cut.notes || "";
  renderStartFrame(cut.startFrameDataUrl || "");
  dom.promptInput.value = cut.promptDraft || "";
}

function renderStartFrame(dataUrl) {
  if (!dataUrl) {
    dom.startFramePreviewWrap.classList.add("hidden");
    dom.startFramePreview.style.backgroundImage = "";
    dom.startFrameClearButton.classList.add("hidden");
    dom.startFrameStatus.textContent = "스타트 프레임 없음";
    dom.startFrameHint.textContent = "첨부하면 이미지 구도와 피사체 정보를 바탕으로 프롬프트를 생성합니다.";
    return;
  }

  dom.startFramePreviewWrap.classList.remove("hidden");
  dom.startFramePreview.style.backgroundImage = `url('${dataUrl}')`;
  dom.startFrameClearButton.classList.remove("hidden");
  dom.startFrameStatus.textContent = "스타트 프레임 첨부됨";
  dom.startFrameHint.textContent =
    state.mode === "video" && supportsMultiCut() && state.multiCutEnabled
      ? "멀티컷에서는 Shot 01이 이 이미지 구도와 정보를 기준으로 작성됩니다."
      : "이 이미지 구도와 피사체 정보를 기준으로 프롬프트를 작성합니다.";
}

function renderModels() {
  dom.modeTabs.forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.mode === state.mode);
  });

  dom.modelList.innerHTML = state.models[state.mode]
    .map((model) => {
      const activeClass = model.id === state.selectedModelId ? "active" : "";
      return `
        <button type="button" class="model-card compact-model-card ${activeClass}" data-model-id="${model.id}">
          <strong>${escapeHtml(model.name)}</strong>
        </button>
      `;
    })
    .join("");
}

function renderVideoSettings() {
  const isVideo = state.mode === "video";
  dom.videoSettingsPanel.classList.toggle("hidden", !isVideo);
  dom.totalDurationInput.value = String(state.totalDurationSec);
}

function renderMultiCutPanel() {
  const enabledForModel = state.mode === "video" && supportsMultiCut();
  dom.multiCutPanel.classList.toggle("hidden", !enabledForModel);

  if (!enabledForModel) {
    state.multiCutEnabled = false;
  }

  dom.multiCutToggle.checked = state.multiCutEnabled;
  dom.multiCutFields.classList.toggle("hidden", !enabledForModel || !state.multiCutEnabled);
  dom.multiCutCountInput.value = String(state.multiCutCount);
}

function renderOutputs() {
  const latest = getCurrentOutputEntry();
  dom.englishPromptOutput.value = latest?.rawPrompt || latest?.prompt || "";
  renderNotesSummary(latest?.notes || "");
  renderSegments(latest?.segments || []);
}

function renderNotesSummary(notes) {
  const text = String(notes || "").trim();
  if (!text) {
    dom.notesSummary.classList.add("hidden");
    dom.notesSummary.innerHTML = "";
    return;
  }

  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 3);

  dom.notesSummary.innerHTML = lines.map((line) => `<span class="notes-chip">${escapeHtml(line)}</span>`).join("");
  dom.notesSummary.classList.remove("hidden");
}

function renderSegments(segments) {
  const isVideo = state.mode === "video";
  const multiCutReady = isVideo && supportsMultiCut();

  dom.segmentsOutputList.classList.toggle("collapsed", !multiCutReady);

  if (!isVideo) {
    dom.segmentsOutputList.innerHTML = `
      <article class="segment-closed-card">
        <div class="segments-state-header">
          <div>
            <p class="segments-state-label">Shot Prompts</p>
            <strong>이미지 모드에서는 샷 분할을 사용하지 않습니다.</strong>
          </div>
        </div>
        <p class="segments-state-copy">비디오 모드에서 Kling 3.0 또는 Seedance 2.0을 선택하면 샷별 프롬프트가 열립니다.</p>
        <div class="segment-closed-preview"></div>
      </article>
    `;
    return;
  }

  if (!multiCutReady) {
    dom.segmentsOutputList.innerHTML = `
      <article class="segment-closed-card">
        <div class="segments-state-header">
          <div>
            <p class="segments-state-label">Shot Prompts</p>
            <strong>이 모델은 멀티컷을 지원하지 않습니다.</strong>
          </div>
        </div>
        <p class="segments-state-copy">Veo 3.1, Seedance 1.5, Sora 2는 메인 프롬프트 중심으로 생성됩니다.</p>
        <div class="segment-closed-preview"></div>
      </article>
    `;
    return;
  }

  if (!segments.length) {
    dom.segmentsOutputList.innerHTML = `
      <article class="segments-empty-card">
        <div class="segments-state-header">
          <div>
            <p class="segments-state-label">Shot Prompts</p>
            <strong>샷별 프롬프트가 여기에 표시됩니다.</strong>
          </div>
        </div>
        <p class="segments-state-copy">멀티컷을 켜고 생성하면 Shot 01, Shot 02 형식으로 각 샷을 따로 복사할 수 있습니다.</p>
      </article>
    `;
    return;
  }

  dom.segmentsOutputList.innerHTML = segments
    .map(
      (segment, index) => `
        <article class="segment-card" data-segment-index="${index}">
          <div class="segment-card-header">
            <div>
              <strong>${escapeHtml(segment.shot || `Shot ${String(index + 1).padStart(2, "0")}`)}</strong>
              <p>${escapeHtml(formatSeconds(segment.durationSec || 0))}</p>
            </div>
            <button class="segment-copy-button" type="button" data-segment-copy="${index}">복사</button>
          </div>
          <textarea readonly>${escapeHtml(segment.prompt || "")}</textarea>
        </article>
      `
    )
    .join("");
}

function renderHistory() {
  const cut = getSelectedCut();
  if (!cut || !cut.promptHistory?.length) {
    dom.historyList.innerHTML = '<div class="empty-state">이 컷에는 아직 생성된 프롬프트가 없습니다.</div>';
    return;
  }

  dom.historyList.innerHTML = [...cut.promptHistory]
    .reverse()
    .map((entry) => {
      const text = entry.rawPrompt || entry.prompt || "";
      return `
        <button type="button" class="history-tile" data-history-id="${entry.id}">
          <div class="history-body">
            <strong>${escapeHtml(entry.title)}</strong>
            <p>${escapeHtml(text.slice(0, 220))}${text.length > 220 ? "..." : ""}</p>
            <div class="history-meta">
              <span class="history-badge">${entry.mode === "image" ? "Image" : "Video"}</span>
              <span class="history-badge">${escapeHtml(entry.modelName)}</span>
              ${entry.totalDurationSec ? `<span class="history-badge">${escapeHtml(formatSeconds(entry.totalDurationSec))}</span>` : ""}
              ${entry.multiCutEnabled ? `<span class="history-badge">Multi cut ${entry.segmentCount || 0}</span>` : ""}
              <span class="history-badge">${escapeHtml(formatTime(entry.createdAt))}</span>
            </div>
          </div>
        </button>
      `;
    })
    .join("");
}

function renderCutPicker() {
  if (!state.cuts.length) {
    dom.cutPickerList.innerHTML = '<div class="empty-state">생성된 컷이 없습니다.</div>';
    return;
  }

  dom.cutPickerList.innerHTML = state.cuts
    .map((cut, index) => {
      const activeClass = cut.id === state.selectedCutId ? "active" : "";
      const style = cut.thumbnailDataUrl ? `style="background-image:url('${cut.thumbnailDataUrl}')"` : "";
      const summary = (cut.summary || "").trim() || "컷 요약을 입력하면 여기에 표시됩니다.";
      return `
        <button type="button" class="cut-picker-tile ${activeClass}" data-picker-cut-id="${cut.id}">
          <div class="cut-picker-thumb" ${style}></div>
          <div class="cut-picker-copy">
            <div class="cut-item-title-row">
              <strong>${escapeHtml(cut.name)}</strong>
              <span class="cut-index">Shot ${String(index + 1).padStart(2, "0")}</span>
            </div>
            <p>${escapeHtml(summary)}</p>
          </div>
        </button>
      `;
    })
    .join("");
}

function updatePromptLoadingState() {
  dom.promptOutputCard.classList.toggle("loading", state.isGenerating);
}

async function startSession() {
  dom.startSessionButton.disabled = true;
  dom.startSessionButton.textContent = "세션 준비 중...";

  try {
    const data = await request("/api/session/start", { method: "POST", body: "{}" });
    state.session = data.session;
    renderSession();
  } catch (error) {
    alert(error.message);
  } finally {
    dom.startSessionButton.disabled = false;
    dom.startSessionButton.textContent = "ChatGPT 세션 시작";
  }
}

async function refreshSession() {
  try {
    const data = await request("/api/session/status", { method: "POST", body: "{}" });
    state.session = data.session;
    renderSession();
  } catch (error) {
    alert(error.message);
  }
}

async function generatePrompt() {
  await flushPendingCutSave();

  const cut = getSelectedCut();
  const model = getSelectedModel();
  const isVideo = state.mode === "video";

  if (!cut) {
    alert("먼저 컷을 선택하거나 새 컷을 만들어 주세요.");
    return;
  }

  if (!state.session?.loggedIn) {
    alert("먼저 ChatGPT 세션을 시작하고 열린 브라우저에서 로그인해 주세요.");
    return;
  }

  if (!dom.promptInput.value.trim()) {
    alert("한글 설명을 입력해 주세요.");
    return;
  }

  state.totalDurationSec = normalizeDuration(dom.totalDurationInput.value || state.totalDurationSec);
  state.multiCutCount = normalizeMultiCutCount(dom.multiCutCountInput.value || state.multiCutCount);

  if (isVideo && state.multiCutEnabled && supportsMultiCut() && state.totalDurationSec < state.multiCutCount) {
    alert("총 영상 길이가 너무 짧습니다. 멀티컷은 컷당 최소 1초가 필요합니다.");
    return;
  }

  saveViewState();
  state.isGenerating = true;
  updatePromptLoadingState();
  dom.generateButton.disabled = true;
  dom.generateButton.textContent = model ? `${model.name} 생성 중...` : "생성 중...";

  try {
    const data = await request("/api/generate", {
      method: "POST",
      body: JSON.stringify({
        cutId: cut.id,
        mode: state.mode,
        modelId: state.selectedModelId,
        userInput: dom.promptInput.value.trim(),
        totalDurationSec: isVideo ? state.totalDurationSec : 0,
        multiCutEnabled: isVideo && state.multiCutEnabled && supportsMultiCut(),
        multiCutCount: isVideo && state.multiCutEnabled && supportsMultiCut() ? state.multiCutCount : 0
      })
    });

    replaceCuts(data.cuts);
    state.latestResult = data.result;
    renderOutputs();
    renderHistory();
  } catch (error) {
    alert(error.message);
  } finally {
    state.isGenerating = false;
    updatePromptLoadingState();
    dom.generateButton.disabled = false;
    dom.generateButton.textContent = "Generate Prompt";
  }
}

async function createCut(event) {
  event.preventDefault();
  await flushPendingCutSave();
  const name = dom.newCutNameInput.value.trim();

  if (!name) {
    return;
  }

  const data = await request("/api/cuts", {
    method: "POST",
    body: JSON.stringify({
      name,
      summary: name,
      notes: "",
      thumbnailDataUrl: "",
      startFrameDataUrl: ""
    })
  });

  replaceCuts(data.cuts);
  state.selectedCutId = data.cuts[0]?.id || "";
  state.latestResult = null;
  dom.cutForm.reset();
  dom.cutDialog.close();
  render();
}

async function uploadSelectedCutThumbnail(file) {
  const cut = getSelectedCut();
  if (!cut || !file) {
    return;
  }

  const thumbnailDataUrl = await fileToDataUrl(file);
  const data = await request(`/api/cuts/${cut.id}`, {
    method: "PATCH",
    body: JSON.stringify({ thumbnailDataUrl })
  });

  replaceCuts(data.cuts);
  render();
}

async function uploadStartFrame(file) {
  const cut = getSelectedCut();
  if (!cut || !file) {
    return;
  }

  const startFrameDataUrl = await fileToDataUrl(file);
  const data = await request(`/api/cuts/${cut.id}`, {
    method: "PATCH",
    body: JSON.stringify({ startFrameDataUrl })
  });

  replaceCuts(data.cuts);
  renderSelectedCut();
  renderCutPicker();
}

async function clearStartFrame() {
  const cut = getSelectedCut();
  if (!cut) {
    return;
  }

  const data = await request(`/api/cuts/${cut.id}`, {
    method: "PATCH",
    body: JSON.stringify({ startFrameDataUrl: "" })
  });

  replaceCuts(data.cuts);
  renderSelectedCut();
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatSeconds(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds)) {
    return "0s";
  }
  if (Number.isInteger(seconds)) {
    return `${seconds}s`;
  }
  return `${seconds.toFixed(1)}s`;
}

function formatTime(isoString) {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(isoString));
}

async function copyPrompt() {
  const text = dom.englishPromptOutput.value.trim();
  if (!text) {
    return;
  }

  await navigator.clipboard.writeText(text);
  const original = dom.copyPromptButton.textContent;
  dom.copyPromptButton.textContent = "복사 완료";
  window.setTimeout(() => {
    dom.copyPromptButton.textContent = original;
  }, 1200);
}

async function copySegment(index) {
  const latest = getCurrentOutputEntry();
  const segment = latest?.segments?.[index];
  if (!segment) {
    return;
  }

  await navigator.clipboard.writeText(String(segment.prompt || "").trim());
}

dom.startSessionButton.addEventListener("click", startSession);
dom.refreshStatusButton.addEventListener("click", refreshSession);
dom.generateButton.addEventListener("click", generatePrompt);
dom.copyPromptButton.addEventListener("click", copyPrompt);

dom.selectedCutUploadButton.addEventListener("click", () => {
  if (!getSelectedCut()) {
    return;
  }
  dom.selectedCutThumbnailInput.click();
});

dom.startFrameUploadButton.addEventListener("click", () => {
  if (!getSelectedCut()) {
    return;
  }
  dom.startFrameInput.click();
});

dom.startFrameClearButton.addEventListener("click", () => {
  clearStartFrame().catch((error) => {
    alert(error.message);
  });
});

dom.selectedCutThumbnailInput.addEventListener("change", async () => {
  try {
    const file = dom.selectedCutThumbnailInput.files?.[0];
    if (!file) {
      return;
    }

    await uploadSelectedCutThumbnail(file);
    dom.selectedCutThumbnailInput.value = "";
  } catch (error) {
    alert(error.message);
  }
});

dom.startFrameInput.addEventListener("change", async () => {
  try {
    const file = dom.startFrameInput.files?.[0];
    if (!file) {
      return;
    }

    await uploadStartFrame(file);
    dom.startFrameInput.value = "";
  } catch (error) {
    alert(error.message);
  }
});

dom.modeTabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    state.mode = tab.dataset.mode;
    state.selectedModelId = state.models[state.mode]?.[0]?.id || "";
  if (!supportsMultiCut(state.selectedModelId)) {
      state.multiCutEnabled = false;
    }
    saveViewState();
    renderModels();
    renderVideoSettings();
    renderMultiCutPanel();
    renderSelectedCut();
    renderOutputs();
  });
});

dom.modelList.addEventListener("click", (event) => {
  const card = event.target.closest("[data-model-id]");
  if (!card) {
    return;
  }

  state.selectedModelId = card.dataset.modelId;
  if (!supportsMultiCut(state.selectedModelId)) {
    state.multiCutEnabled = false;
  }

  saveViewState();
  renderModels();
  renderMultiCutPanel();
  renderSelectedCut();
  renderOutputs();
});

dom.totalDurationInput.addEventListener("input", () => {
  state.totalDurationSec = normalizeDuration(dom.totalDurationInput.value || state.totalDurationSec);
  saveViewState();
});

dom.multiCutToggle.addEventListener("change", () => {
  state.multiCutEnabled = dom.multiCutToggle.checked;
  state.multiCutCount = normalizeMultiCutCount(dom.multiCutCountInput.value || state.multiCutCount);
  saveViewState();
  renderMultiCutPanel();
  renderSelectedCut();
});

dom.multiCutCountInput.addEventListener("input", () => {
  state.multiCutCount = normalizeMultiCutCount(dom.multiCutCountInput.value || state.multiCutCount);
  saveViewState();
});

dom.historyList.addEventListener("click", (event) => {
  const item = event.target.closest("[data-history-id]");
  if (!item) {
    return;
  }

  const cut = getSelectedCut();
  const entry = cut?.promptHistory?.find((history) => history.id === item.dataset.historyId);
  if (!entry) {
    return;
  }

  state.latestResult = entry;
  renderOutputs();
});

dom.cutPickerList.addEventListener("click", (event) => {
  const item = event.target.closest("[data-picker-cut-id]");
  if (!item) {
    return;
  }

  handleCutSelection(item.dataset.pickerCutId)
    .then(() => {
      dom.cutPickerDialog.close();
    })
    .catch((error) => {
      alert(error.message);
    });
});

dom.cutListButton.addEventListener("click", () => {
  renderCutPicker();
  dom.cutPickerDialog.showModal();
});
dom.closeCutPickerButton.addEventListener("click", () => {
  dom.cutPickerDialog.close();
});

dom.newCutButton.addEventListener("click", () => {
  dom.cutDialog.showModal();
});
dom.closeDialogButton.addEventListener("click", () => dom.cutDialog.close());
dom.cancelDialogButton.addEventListener("click", () => dom.cutDialog.close());

dom.cutForm.addEventListener("submit", createCut);

dom.segmentsOutputList.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-segment-copy]");
  if (!button) {
    return;
  }

  await copySegment(Number(button.dataset.segmentCopy));
  const original = button.textContent;
  button.textContent = "복사 완료";
  window.setTimeout(() => {
    button.textContent = original;
  }, 1000);
});

async function handleCutSelection(cutId) {
  if (!cutId || cutId === state.selectedCutId) {
    return;
  }

  await flushPendingCutSave();
  state.selectedCutId = cutId;
  state.latestResult = getSelectedCut()?.promptHistory?.at(-1) || null;
  saveViewState();
  render();
}

dom.cutSummaryInput.addEventListener("input", () => {
  scheduleCutSave({ summary: dom.cutSummaryInput.value });
});

dom.cutNotesInput.addEventListener("input", () => {
  scheduleCutSave({ notes: dom.cutNotesInput.value });
});

dom.promptInput.addEventListener("input", () => {
  const updatedCut = mergeSelectedCutLocally({ promptDraft: dom.promptInput.value });
  if (!updatedCut) {
    return;
  }

  if (pendingCutId && pendingCutId !== updatedCut.id) {
    pendingCutPatch = {};
  }

  pendingCutId = updatedCut.id;
  pendingCutPatch = { ...pendingCutPatch, promptDraft: dom.promptInput.value };

  if (saveTimer) {
    window.clearTimeout(saveTimer);
  }

  saveTimer = window.setTimeout(() => {
    flushPendingCutSave().catch((error) => {
      alert(error.message);
    });
  }, 1400);
});

dom.promptInput.addEventListener("blur", () => {
  flushPendingCutSave().catch((error) => {
    alert(error.message);
  });
});

async function request(url, options = {}) {
  const response = await fetch(buildApiUrl(url), {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...options
  });

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    const rawText = await response.text();
    const preview = rawText.replace(/\s+/g, " ").trim().slice(0, 120);

    if (preview.includes("<!doctype") || preview.includes("<html") || preview.includes("The page could not be found")) {
      throw new Error(
        "현재 이 주소에서는 Prompt Bridge API가 실행되고 있지 않습니다. Vercel에 프론트만 올린 경우라면 별도 백엔드 주소가 필요합니다. ?apiBase=https://your-backend.example.com 형태로 접속하거나 runtime-config.js에 apiBaseUrl을 넣어 주세요."
      );
    }

    throw new Error(`API 응답이 JSON이 아닙니다. 서버 응답: ${preview || "empty response"}`);
  }

  const data = await response.json();
  if (!response.ok || !data.ok) {
    throw new Error(data.error || "요청 처리에 실패했습니다.");
  }
  return data;
}

bootstrap().catch((error) => {
  alert(error.message);
});
