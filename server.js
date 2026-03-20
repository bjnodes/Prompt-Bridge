const http = require("node:http");
const path = require("node:path");
const fs = require("node:fs");
const { randomUUID } = require("node:crypto");

const { ChatGPTAutomation } = require("./lib/chatgpt-automation");

const PORT = process.env.PORT ? Number(process.env.PORT) : 4310;
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DIR = path.join(ROOT, "data");
const CUTS_DIR = path.join(DATA_DIR, "cuts");
const UPLOADS_DIR = path.join(DATA_DIR, "uploads");
const SESSION_DIR = path.join(DATA_DIR, process.env.SESSION_DIR_NAME || "chatgpt-session");
const MULTI_CUT_SUPPORTED_MODELS = new Set(["kling-3.0", "seedance-2.0"]);

const MODEL_LIBRARY = {
  image: [
    {
      id: "nanobanana",
      name: "Nanobanana",
      provider: "Nanobanana",
      description: "피사체와 조명, 질감, 구도를 또렷하게 정리한 이미지 프롬프트에 잘 맞습니다.",
      optimization: "Write a clean, vivid image prompt with clear subject, composition, lighting, texture, and finish."
    },
    {
      id: "midjourney",
      name: "Midjourney",
      provider: "Midjourney",
      description: "스타일과 무드, 예술적인 질감이 강한 이미지 프롬프트에 적합합니다.",
      optimization: "Use stylish, evocative visual language with strong composition, art direction, texture, and aesthetic mood."
    },
    {
      id: "seedream",
      name: "Seedream",
      provider: "Seedream",
      description: "구체적인 피사체 설명과 완성도 높은 렌더 지시가 필요한 이미지 프롬프트에 어울립니다.",
      optimization: "Favor descriptive subject detail, polished lighting, premium realism, and clear render-quality cues."
    }
  ],
  video: [
    {
      id: "kling-3.0",
      name: "Kling 3.0",
      provider: "Kling",
      description: "카메라 움직임과 액션 흐름을 시간 순서대로 정리한 영상 프롬프트에 적합합니다.",
      optimization: "Describe shots in cinematic order with camera movement, subject action, environment motion, and continuity."
    },
    {
      id: "veo-3.1",
      name: "Veo 3.1",
      provider: "Veo",
      description: "사실감과 고급 시네마틱 디테일을 강조하는 리얼한 영상 프롬프트에 어울립니다.",
      optimization: "Favor realism, believable motion, lens direction, premium cinematic detail, and physically grounded staging."
    },
    {
      id: "seedance-2.0",
      name: "Seedance 2.0",
      provider: "Seedance",
      description: "감정선과 리듬을 살리면서 여러 컷 흐름을 설계하기 좋은 영상 프롬프트에 맞습니다.",
      optimization: "Blend cinematic motion, emotional pacing, transitions, atmosphere, and shot-by-shot progression."
    },
    {
      id: "seedance-1.5",
      name: "Seedance 1.5",
      provider: "Seedance",
      description: "장면 무드와 움직임, 공기감을 부드럽게 정리하는 영상 프롬프트에 적합합니다.",
      optimization: "Use smooth cinematic direction, emotional pacing, atmosphere, and clear motion cues."
    },
    {
      id: "sora-2",
      name: "Sora 2",
      provider: "Sora",
      description: "장면 구성과 시간 흐름을 선명하게 잡는 고품질 영상 프롬프트에 잘 맞습니다.",
      optimization: "Build a clear scene progression with strong cinematic language, motion logic, continuity, and visual specificity."
    }
  ]
};

const automation = new ChatGPTAutomation({
  sessionDir: SESSION_DIR,
  chatUrl: "https://chatgpt.com/"
});

ensureDirectories();

function ensureDirectories() {
  fs.mkdirSync(PUBLIC_DIR, { recursive: true });
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(CUTS_DIR, { recursive: true });
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function sendText(res, statusCode, contentType, body) {
  res.writeHead(statusCode, { "Content-Type": contentType });
  res.end(body);
}

function safeReadJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 48);
}

function getCutDirectories() {
  return fs.readdirSync(CUTS_DIR, { withFileTypes: true }).filter((entry) => entry.isDirectory());
}

function getAllCuts() {
  ensureStarterCut();
  return getCutDirectories()
    .map((entry) => safeReadJson(path.join(CUTS_DIR, entry.name, "meta.json"), null))
    .filter(Boolean)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

function ensureStarterCut() {
  const existing = getCutDirectories();
  if (existing.length > 0) {
    return;
  }

  createCut({
    name: "Cut 01 - Neon Alley",
    summary: "Neon Alley Intro",
    notes: "비 오는 새벽 골목, 네온 반사, 검은 코트, 천천히 걸어오는 인물, 차갑고 영화적인 분위기.",
    thumbnailDataUrl: ""
  });
}

function createCut({ name, summary = "", notes = "", thumbnailDataUrl = "", startFrameDataUrl = "" }) {
  const id = randomUUID();
  const folderName = `${slugify(name) || "cut"}-${id.slice(0, 8)}`;
  const cutDir = path.join(CUTS_DIR, folderName);
  fs.mkdirSync(cutDir, { recursive: true });

  const now = new Date().toISOString();
  const meta = {
    id,
    name,
    summary,
    notes,
    thumbnailDataUrl,
    startFrameDataUrl,
    promptDraft: "",
    promptHistory: [],
    createdAt: now,
    updatedAt: now
  };

  writeJson(path.join(cutDir, "meta.json"), meta);
  return meta;
}

function updateCut(cutId, fields) {
  const targetDir = getCutDirectories().find((entry) => {
    const meta = safeReadJson(path.join(CUTS_DIR, entry.name, "meta.json"), null);
    return meta?.id === cutId;
  });

  if (!targetDir) {
    throw new Error("Cut not found");
  }

  const metaPath = path.join(CUTS_DIR, targetDir.name, "meta.json");
  const current = safeReadJson(metaPath, null);
  const nextMeta = {
    ...current,
    ...fields,
    updatedAt: new Date().toISOString()
  };
  writeJson(metaPath, nextMeta);
  return nextMeta;
}

function normalizeMultiCutCount(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return Math.max(2, Math.min(8, Math.round(parsed)));
}

function normalizeTotalDuration(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 5;
  }
  return Math.max(1, Math.min(60, Math.round(parsed)));
}

function buildAutomationPrompt({ cut, userInput, mode, model, multiCutEnabled, multiCutCount, totalDurationSec, hasReferenceImage }) {
  const recentHistory = (cut.promptHistory || []).slice(-2).map((entry) => ({
    title: entry.title,
    source_ko: entry.sourceKo,
    prompt: entry.prompt
  }));

  const durationInstruction =
    mode === "video"
      ? `Target total duration: ${totalDurationSec} seconds. Optimize the prompt for that exact runtime.`
      : "No duration target is needed because this is an image prompt.";

  const multiCutInstructions =
    multiCutEnabled && MULTI_CUT_SUPPORTED_MODELS.has(model.id)
      ? [
          "Multi-cut mode is enabled.",
          `Split the user's Korean idea into exactly ${multiCutCount} sequential shots.`,
          `The sum of all durationSec values must equal exactly ${totalDurationSec} seconds.`,
          "Each durationSec must be an integer number of seconds.",
          "Each shot must contain:",
          "- shot number",
          "- durationSec",
          "- prompt as an English prompt optimized for the selected model",
          "Keep continuity across shots."
        ].join("\n")
      : [
          "Multi-cut mode is disabled.",
          "Return one optimized English prompt for the selected model."
        ].join("\n");

  const referenceImageInstructions = hasReferenceImage
    ? [
        "A reference start-frame image is attached.",
        "Analyze the image for subject identity, pose, camera angle, composition, styling, environment, lighting, lens feel, and mood.",
        multiCutEnabled && MULTI_CUT_SUPPORTED_MODELS.has(model.id)
          ? "For multi-cut mode, Shot 01 must closely match the attached image composition and visible details. All following shots must continue naturally from that same scene and preserve continuity."
          : "Use the attached image as the main visual anchor for the final prompt."
      ].join("\n")
    : "No reference image is attached.";

  const schemaLine =
    multiCutEnabled && MULTI_CUT_SUPPORTED_MODELS.has(model.id)
      ? 'JSON schema: {"title":"string","prompt":"string","notes":"string","segments":[{"shot":"string","durationSec":number,"prompt":"string"}]}'
      : 'JSON schema: {"title":"string","prompt":"string","notes":"string"}';

  return [
    "You are refining prompts for AI image and video generators.",
    "The user writes rough Korean descriptions. Convert them into polished English prompts optimized for the target model.",
    `Target mode: ${mode}.`,
    `Target model: ${model.name} (${model.provider}).`,
    `Model optimization: ${model.optimization}`,
    durationInstruction,
    referenceImageInstructions,
    multiCutInstructions,
    "Use the selected cut as continuity context.",
    "Return JSON only.",
    schemaLine,
    "Do not include markdown fences.",
    "",
    "Selected cut context:",
    JSON.stringify(
      {
        cut_name: cut.name,
        cut_summary: cut.summary,
        cut_notes: cut.notes,
        recent_history: recentHistory
      },
      null,
      2
    ),
    "",
    "User request in Korean:",
    userInput
  ].join("\n");
}

function parseJsonFromText(text) {
  const raw = String(text || "").trim();
  const fencedMatch = raw.match(/```json\s*([\s\S]*?)```/i);
  if (fencedMatch) {
    return JSON.parse(fencedMatch[1]);
  }

  const objectMatch = raw.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    return JSON.parse(objectMatch[0]);
  }

  const titleIndex = raw.indexOf('"title"');
  if (titleIndex >= 0) {
    const start = raw.lastIndexOf("{", titleIndex);
    const end = raw.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(raw.slice(start, end + 1));
    }
  }

  throw new Error("No JSON object found in ChatGPT response");
}

function padSegments(segments, requiredCount, fallbackPrompt) {
  const next = [...segments];
  while (next.length < requiredCount) {
    next.push({
      shot: `Shot ${String(next.length + 1).padStart(2, "0")}`,
      durationSec: 1,
      prompt: fallbackPrompt
    });
  }
  return next.slice(0, requiredCount);
}

function rebalanceSegmentDurations(segments, totalDurationSec) {
  const totalUnits = normalizeTotalDuration(totalDurationSec);
  if (totalUnits < segments.length) {
    throw new Error("Total duration is too short for the requested multi-cut count");
  }

  const units = segments.map((segment) => Math.max(1, Math.round(Number(segment.durationSec) || 1)));
  let currentUnits = units.reduce((sum, value) => sum + value, 0);

  while (currentUnits > totalUnits) {
    const largestIndex = units.reduce((best, value, index, arr) => {
      if (arr[best] > 1 && value > arr[best]) {
        return index;
      }
      if (arr[best] <= 1 && value > 1) {
        return index;
      }
      return best;
    }, 0);

    if (units[largestIndex] <= 1) {
      break;
    }

    units[largestIndex] -= 1;
    currentUnits -= 1;
  }

  while (currentUnits < totalUnits) {
    const smallestIndex = units.reduce((best, value, index, arr) => (value < arr[best] ? index : best), 0);
    units[smallestIndex] += 1;
    currentUnits += 1;
  }

  return segments.map((segment, index) => ({
    shot: segment.shot || `Shot ${String(index + 1).padStart(2, "0")}`,
    durationSec: units[index],
    prompt: String(segment.prompt || "").trim()
  }));
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

function formatSegments(segments) {
  return segments
    .map((segment, index) => {
      const shotLabel = segment.shot || `Shot ${String(index + 1).padStart(2, "0")}`;
      return `${shotLabel} (${formatSeconds(segment.durationSec)})\n${String(segment.prompt || "").trim()}`;
    })
    .join("\n\n");
}

function formatPromptOutput(rawPrompt, segments) {
  if (!segments.length) {
    return String(rawPrompt || "").trim();
  }

  return [String(rawPrompt || "").trim(), "Multi-cut breakdown", formatSegments(segments)].filter(Boolean).join("\n\n");
}

function formatNotesOutput({ notes, modelName, multiCutEnabled, totalDurationSec, segments }) {
  const parts = [`Model: ${modelName}`];

  if (totalDurationSec) {
    parts.push(`Target total duration: ${formatSeconds(totalDurationSec)}`);
  }

  if (multiCutEnabled && segments.length > 0) {
    const actualTotal = segments.reduce((sum, segment) => sum + (Number(segment.durationSec) || 0), 0);
    parts.push(`Multi cut: ${segments.length} shots / actual total ${formatSeconds(actualTotal)}`);
  }

  if (notes) {
    parts.push(String(notes).trim());
  }

  return parts.join("\n\n");
}

function dataUrlToTempImageFile(dataUrl) {
  const match = String(dataUrl || "").match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) {
    return null;
  }

  const mimeType = match[1];
  const base64 = match[2];
  const extensionMap = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif"
  };

  const extension = extensionMap[mimeType] || ".png";
  const filePath = path.join(UPLOADS_DIR, `${randomUUID()}${extension}`);
  fs.writeFileSync(filePath, Buffer.from(base64, "base64"));
  return filePath;
}

async function readRequestBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function serveStaticFile(reqPath, res) {
  const pathname = reqPath === "/" ? "/index.html" : reqPath;
  const filePath = path.join(PUBLIC_DIR, pathname);

  if (!filePath.startsWith(PUBLIC_DIR) || !fs.existsSync(filePath)) {
    sendText(res, 404, "text/plain; charset=utf-8", "Not found");
    return;
  }

  const extension = path.extname(filePath);
  const contentTypeMap = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".svg": "image/svg+xml; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".ico": "image/x-icon"
  };

  sendText(res, 200, contentTypeMap[extension] || "application/octet-stream", fs.readFileSync(filePath));
}

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);

  try {
    if (req.method === "GET" && requestUrl.pathname === "/api/bootstrap") {
      sendJson(res, 200, {
        ok: true,
        cuts: getAllCuts(),
        models: MODEL_LIBRARY,
        session: await automation.getStatus()
      });
      return;
    }

    if (req.method === "GET" && requestUrl.pathname === "/api/health") {
      sendJson(res, 200, {
        ok: true,
        service: "prompt-bridge",
        timestamp: new Date().toISOString()
      });
      return;
    }

    if (req.method === "POST" && requestUrl.pathname === "/api/session/start") {
      sendJson(res, 200, { ok: true, session: await automation.start() });
      return;
    }

    if (req.method === "POST" && requestUrl.pathname === "/api/session/status") {
      sendJson(res, 200, { ok: true, session: await automation.getStatus() });
      return;
    }

    if (req.method === "POST" && requestUrl.pathname === "/api/cuts") {
      createCut(await readRequestBody(req));
      sendJson(res, 200, { ok: true, cuts: getAllCuts() });
      return;
    }

    if (req.method === "PATCH" && requestUrl.pathname.startsWith("/api/cuts/")) {
      const cutId = requestUrl.pathname.split("/").pop();
      updateCut(cutId, await readRequestBody(req));
      sendJson(res, 200, { ok: true, cuts: getAllCuts() });
      return;
    }

    if (req.method === "POST" && requestUrl.pathname === "/api/generate") {
      const body = await readRequestBody(req);
      const cut = getAllCuts().find((item) => item.id === body.cutId);
      const model = MODEL_LIBRARY[body.mode]?.find((item) => item.id === body.modelId);
      const totalDurationSec = body.mode === "video" ? normalizeTotalDuration(body.totalDurationSec) : 0;
      const multiCutEnabled = Boolean(body.multiCutEnabled) && MULTI_CUT_SUPPORTED_MODELS.has(body.modelId);
      const multiCutCount = multiCutEnabled ? normalizeMultiCutCount(body.multiCutCount) : 0;
      const referenceImagePath = dataUrlToTempImageFile(cut?.startFrameDataUrl);

      if (!cut) {
        sendJson(res, 404, { ok: false, error: "Cut not found" });
        return;
      }

      if (!model) {
        sendJson(res, 400, { ok: false, error: "Invalid model" });
        return;
      }

      if (body.mode === "video" && totalDurationSec <= 0) {
        sendJson(res, 400, { ok: false, error: "Video duration must be set" });
        return;
      }

      if (multiCutEnabled && totalDurationSec < multiCutCount) {
        sendJson(res, 400, { ok: false, error: "Total duration is too short for the requested multi-cut count" });
        return;
      }

      let rawResponse = "";
      try {
        rawResponse = await automation.sendPrompt(
          buildAutomationPrompt({
            cut,
            userInput: body.userInput,
            mode: body.mode,
            model,
            multiCutEnabled,
            multiCutCount,
            totalDurationSec,
            hasReferenceImage: Boolean(referenceImagePath)
          }),
          { imagePath: referenceImagePath }
        );
      } finally {
        if (referenceImagePath && fs.existsSync(referenceImagePath)) {
          fs.rmSync(referenceImagePath, { force: true });
        }
      }

      const parsed = parseJsonFromText(rawResponse);
      let segments = [];

      if (multiCutEnabled) {
        const rawSegments = Array.isArray(parsed.segments) ? parsed.segments : [];
        segments = padSegments(rawSegments, multiCutCount, parsed.prompt || "");
        segments = rebalanceSegmentDurations(segments, totalDurationSec);
      }

      const rawPrompt = String(parsed.prompt || "").trim();
      const formattedPrompt = formatPromptOutput(rawPrompt, segments);
      const formattedNotes = formatNotesOutput({
        notes: parsed.notes,
        modelName: model.name,
        multiCutEnabled,
        totalDurationSec,
        segments
      });

      const historyEntry = {
        id: randomUUID(),
        title: parsed.title || cut.name,
        prompt: formattedPrompt,
        rawPrompt,
        notes: formattedNotes,
        segments,
        sourceKo: body.userInput,
        mode: body.mode,
        modelId: model.id,
        modelName: model.name,
        multiCutEnabled,
        segmentCount: segments.length,
        totalDurationSec,
        createdAt: new Date().toISOString()
      };

      updateCut(cut.id, {
        promptDraft: body.userInput,
        promptHistory: [...(cut.promptHistory || []), historyEntry]
      });

      sendJson(res, 200, {
        ok: true,
        result: {
          title: historyEntry.title,
          prompt: historyEntry.prompt,
          rawPrompt: historyEntry.rawPrompt,
          notes: historyEntry.notes,
          segments: historyEntry.segments,
          multiCutEnabled: historyEntry.multiCutEnabled,
          totalDurationSec: historyEntry.totalDurationSec,
          rawResponse
        },
        cuts: getAllCuts()
      });
      return;
    }

    if (req.method === "GET" && !requestUrl.pathname.startsWith("/api/")) {
      serveStaticFile(requestUrl.pathname, res);
      return;
    }

    sendJson(res, 404, { ok: false, error: "Not found" });
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { ok: false, error: error.message || "Internal server error" });
  }
});

server.listen(PORT, () => {
  console.log(`Prompt generator web server running on http://localhost:${PORT}`);
});
