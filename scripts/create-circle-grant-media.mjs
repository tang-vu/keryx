import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { access, cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { renderDeck, renderScene, renderThumbnail } from "./grant-media/render.mjs";

const repo = process.cwd();
const outputDir = path.join(repo, "deliverables", "circle-grant-2026");
const workDir = await mkdtemp(path.join(os.tmpdir(), "keryx-circle-grant-"));
const screensDir = path.join(workDir, "screens");
const scenesDir = path.join(workDir, "scenes");
const audioDir = path.join(workDir, "audio");
const clipsDir = path.join(workDir, "clips");

const videoPath = path.join(outputDir, "keryx-circle-grant-demo.mp4");
const subtitlesPath = path.join(outputDir, "keryx-circle-grant-demo.en.srt");
const deckPath = path.join(outputDir, "keryx-circle-investor-deck.pdf");
const thumbnailPath = path.join(outputDir, "keryx-circle-grant-thumbnail.png");
const asrReportPath = path.join(outputDir, "mimo-asr-verification.json");
const uploadPath = path.join(outputDir, "youtube-upload.md");
const readmePath = path.join(outputDir, "README.md");
const voicePlaybackRate = 1.06;

for (const dir of [outputDir, screensDir, scenesDir, audioDir, clipsDir]) await mkdir(dir, { recursive: true });

function log(message) {
  process.stdout.write(`[grant-media] ${message}\n`);
}

function loadLocalEnv() {
  const localPath = path.join(repo, ".env.local");
  if (!existsSync(localPath)) return;
  const lines = readFileSync(localPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]]) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[match[1]] = value;
  }
}

function findExecutable(name, candidates = []) {
  for (const candidate of candidates) if (existsSync(candidate)) return candidate;
  try {
    const found = execFileSync("where.exe", [name], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
      .split(/\r?\n/)
      .map((value) => value.trim())
      .find(Boolean);
    if (found) return found;
  } catch {
    // Report one actionable error below.
  }
  throw new Error(`${name} was not found. Install it and rerun npm run grant:media.`);
}

const chrome = findExecutable("chrome", [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
]);
const ffmpeg = findExecutable("ffmpeg");
const ffprobe = findExecutable("ffprobe");
const magick = findExecutable("magick", ["C:\\Program Files\\ImageMagick-7.1.2-Q16-HDRI\\magick.exe"]);

function run(exe, args, options = {}) {
  return execFileSync(exe, args, {
    cwd: options.cwd ?? repo,
    encoding: options.encoding ?? "utf8",
    stdio: options.stdio ?? ["ignore", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
  });
}

async function fetchJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return response.json();
}

function chromeArgs(output, width, height, target, pdf = false) {
  const common = [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--no-sandbox",
    "--allow-file-access-from-files",
    "--force-device-scale-factor=1",
    `--window-size=${width},${height}`,
    "--virtual-time-budget=7000",
  ];
  if (pdf) common.push(`--print-to-pdf=${output}`, "--print-to-pdf-no-header", "--no-pdf-header-footer");
  else common.push(`--screenshot=${output}`);
  common.push(target);
  return common;
}

function capture(url, file, height = 1080) {
  run(chrome, chromeArgs(file, 1920, height, url), { stdio: "ignore" });
  if (!existsSync(file)) throw new Error(`Chrome did not create ${file}`);
}

function crop(source, target, y) {
  run(magick, [source, "-crop", `1920x1080+0+${y}`, "+repage", target], { stdio: "ignore" });
}

function codeRange(relativePath, start, end) {
  const lines = readFileSync(path.join(repo, relativePath), "utf8").split(/\r?\n/);
  return lines
    .slice(start - 1, end)
    .map((line, index) => `${String(start + index).padStart(3, " ")}  ${line}`)
    .join("\n");
}

function fileUri(file) {
  return pathToFileURL(file).href;
}

function renderHtmlToPng(html, basename, width = 1920, height = 1080) {
  const htmlPath = path.join(workDir, `${basename}.html`);
  const pngPath = path.join(scenesDir, `${basename}.png`);
  return writeFile(htmlPath, html, "utf8").then(() => {
    run(chrome, chromeArgs(pngPath, width, height, fileUri(htmlPath)), { stdio: "ignore" });
    if (!existsSync(pngPath)) throw new Error(`Failed to render ${basename}`);
    return pngPath;
  });
}

async function mimoRequest(body, attempts = 3) {
  const endpoint = `${process.env.KERYX_MIMO_BASE_URL?.replace(/\/$/, "") ?? "https://api.xiaomimimo.com/v1"}/chat/completions`;
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "api-key": process.env.MIMO_API_KEY, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(180_000),
      });
      if (!response.ok) {
        const detail = (await response.text()).slice(0, 500);
        throw new Error(`MiMo HTTP ${response.status}: ${detail}`);
      }
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
    }
  }
  throw lastError;
}

const voiceDirection = [
  "Premium English technology documentary narrator.",
  "Warm, assured male voice with crisp articulation and a measured pace around 145 words per minute.",
  "Sound like a founder calmly demonstrating a serious production system to technical grant reviewers.",
  "Use short natural pauses between ideas, emphasize concrete proof, and avoid hype, radio-announcer energy, or exaggerated emotion.",
].join(" ");

async function synthesize(text, target) {
  const response = await mimoRequest({
    model: "mimo-v2.5-tts",
    messages: [
      { role: "user", content: voiceDirection },
      { role: "assistant", content: text },
    ],
    audio: { format: "wav", voice: "Milo" },
  });
  const encoded = response?.choices?.[0]?.message?.audio?.data;
  if (!encoded) throw new Error("MiMo TTS response did not include choices[0].message.audio.data");
  await writeFile(target, Buffer.from(encoded, "base64"));
}

async function transcribe(audioPath) {
  const encoded = (await readFile(audioPath)).toString("base64");
  const response = await mimoRequest({
    model: "mimo-v2.5-asr",
    messages: [{
      role: "user",
      content: [{ type: "input_audio", input_audio: { data: `data:audio/wav;base64,${encoded}` } }],
    }],
    asr_options: { language: "en" },
  });
  const text = response?.choices?.[0]?.message?.content;
  if (typeof text !== "string" || !text.trim()) throw new Error("MiMo ASR returned an empty transcript");
  return text.trim();
}

function normaliseTranscript(value) {
  return value
    .toLowerCase()
    .replace(/carrax|kerrex|carex|carracks|kerricks/g, "keryx")
    .replace(/x\s*(?:four|4)\s*(?:oh|o|zero|0)\s*(?:two|2)/g, "x402")
    .replace(/u\.?s\.?d\.?c\.?/g, "usdc")
    .replace(/source\s+registry/g, "sourceregistry")
    .replace(/gateway\s+client/g, "gatewayclient")
    .replace(/[^a-z0-9$]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function wordErrorRate(expected, actual) {
  const a = normaliseTranscript(expected);
  const b = normaliseTranscript(actual);
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const prior = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = prior;
    }
  }
  return row[b.length] / Math.max(1, a.length);
}

function durationOf(file) {
  return Number(run(ffprobe, ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", file]).trim());
}

function srtTime(seconds) {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const milli = ms % 1000;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(milli).padStart(3, "0")}`;
}

function wrapSubtitle(text, width = 40) {
  const words = text.split(/\s+/);
  const lines = [];
  let line = "";
  for (const word of words) {
    if (!line || `${line} ${word}`.length <= width) line = line ? `${line} ${word}` : word;
    else { lines.push(line); line = word; }
  }
  if (line) lines.push(line);
  if (lines.length <= 2) return lines.join("\n");
  const midpoint = Math.ceil(words.length / 2);
  return `${words.slice(0, midpoint).join(" ")}\n${words.slice(midpoint).join(" ")}`;
}

function sentenceGroups(text, maxWords = 11) {
  const sentences = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g)?.map((part) => part.trim()).filter(Boolean) ?? [text];
  const groups = [];
  for (const sentence of sentences) {
    const words = sentence.split(/\s+/).filter(Boolean);
    let chunk = [];
    for (const word of words) {
      chunk.push(word);
      const naturalBreak = /[,;:]$/.test(word) && chunk.length >= 7;
      if (chunk.length >= maxWords || naturalBreak) {
        groups.push(chunk.join(" "));
        chunk = [];
      }
    }
    if (chunk.length) {
      if (groups.length && chunk.length <= 3 && groups.at(-1).split(/\s+/).length + chunk.length <= maxWords) {
        groups[groups.length - 1] += ` ${chunk.join(" ")}`;
      } else {
        groups.push(chunk.join(" "));
      }
    }
  }
  return groups;
}

function createSrt(sceneResults) {
  const entries = [];
  let sceneStart = 0;
  for (const result of sceneResults) {
    const groups = sentenceGroups(result.narration);
    const weights = groups.map((group) => Math.max(1, group.split(/\s+/).length));
    const totalWeight = weights.reduce((sum, value) => sum + value, 0);
    let cursor = sceneStart + 0.12;
    const usable = Math.max(1, result.audioDuration - 0.2);
    for (let index = 0; index < groups.length; index++) {
      const length = usable * (weights[index] / totalWeight);
      entries.push({ start: cursor, end: cursor + length, text: wrapSubtitle(groups[index]) });
      cursor += length;
    }
    sceneStart += result.clipDuration;
  }
  return entries.map((entry, index) => `${index + 1}\n${srtTime(entry.start)} --> ${srtTime(entry.end)}\n${entry.text}\n`).join("\n");
}

function createClip(image, audio, target, duration, reversePan = false) {
  const frames = Math.max(1, Math.round(duration * 30));
  const x = reversePan
    ? `(in_w-out_w)*(1-n/${frames})`
    : `(in_w-out_w)*n/${frames}`;
  const fadeOut = Math.max(0, duration - 0.28).toFixed(3);
  const videoFilter = `scale=1958:1102,crop=1920:1080:x='${x}':y='(in_h-out_h)/2',fade=t=in:st=0:d=0.22,fade=t=out:st=${fadeOut}:d=0.28,format=yuv420p`;
  const audioFilter = `atempo=${voicePlaybackRate},apad=pad_dur=0.8,afade=t=in:st=0:d=0.12,afade=t=out:st=${Math.max(0, duration - 0.35).toFixed(3)}:d=0.3`;
  run(ffmpeg, [
    "-y", "-loop", "1", "-framerate", "30", "-i", image, "-i", audio,
    "-filter_complex", `[0:v]${videoFilter}[v];[1:a]${audioFilter}[a]`,
    "-map", "[v]", "-map", "[a]", "-t", duration.toFixed(3), "-r", "30",
    "-c:v", "libx264", "-preset", "medium", "-crf", "19", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "192k", "-ar", "48000", target,
  ], { stdio: "ignore" });
}

function validateVideo(file) {
  const raw = run(ffprobe, ["-v", "error", "-show_entries", "format=duration:stream=codec_type,width,height", "-of", "json", file]);
  const info = JSON.parse(raw);
  const video = info.streams.find((stream) => stream.codec_type === "video");
  const audio = info.streams.find((stream) => stream.codec_type === "audio");
  const duration = Number(info.format.duration);
  if (!video || video.width !== 1920 || video.height !== 1080) throw new Error("Final video is not 1920x1080");
  if (!audio) throw new Error("Final video has no audio stream");
  if (!(duration > 30 && duration < 300)) throw new Error(`Final video duration ${duration}s is outside the grant limit`);
  return { duration, width: video.width, height: video.height };
}

function gitSafeRelative(file) {
  return path.relative(repo, file).replaceAll("\\", "/");
}

loadLocalEnv();
if (!process.env.MIMO_API_KEY) throw new Error("MIMO_API_KEY is missing from the environment or .env.local");

let completed = false;
try {
  log("Fetching the live settled-only production snapshot");
  const [health, metrics, treasury] = await Promise.all([
    fetchJson("https://keryx.cc/api/health"),
    fetchJson("https://keryx.cc/api/metrics"),
    fetchJson("https://keryx.cc/api/treasury"),
  ]);
  if (!health.ok || health.settles !== "real") throw new Error("Production health does not report real settlement");
  if (!treasury.available || treasury.via !== "@circle-fin/unified-balance-kit") throw new Error("Unified Balance Kit treasury proof is unavailable");
  const capturedAt = new Date(health.time).toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC");

  log("Capturing the public Keryx product and proof surfaces");
  const raw = Object.fromEntries([
    ["home", ["https://keryx.cc", 1080]],
    ["status", ["https://keryx.cc/status", 1080]],
    ["arcscan", ["https://testnet.arcscan.app/tx/0x4789b7541a23acea3c6f9c03ffbab1ffa241ff1961629e6aa5deb50de6226908", 1080]],
    ["proofFull", ["https://keryx.cc/proof", 5200]],
    ["dashboardFull", ["https://keryx.cc/dashboard", 5200]],
    ["dispatchFull", ["https://keryx.cc/dispatch/5b5c801e-de1a-45bf-a18a-df3f30dc8ea2", 6200]],
    ["creatorFull", ["https://keryx.cc/creator/stablecoin-ledger-dadb40", 5200]],
  ].map(([name, [url, height]]) => {
    const file = path.join(screensDir, `${name}.png`);
    capture(url, file, height);
    log(`Captured ${name}`);
    return [name, file];
  }));

  const cropped = {
    dashboardTop: path.join(screensDir, "dashboard-top.png"),
    proofTop: path.join(screensDir, "proof-top.png"),
    dispatchTop: path.join(screensDir, "dispatch-top.png"),
    dispatchAnswer: path.join(screensDir, "dispatch-answer.png"),
    dispatchRewards: path.join(screensDir, "dispatch-rewards.png"),
    creatorTop: path.join(screensDir, "creator-top.png"),
  };
  crop(raw.dashboardFull, cropped.dashboardTop, 0);
  crop(raw.proofFull, cropped.proofTop, 0);
  crop(raw.dispatchFull, cropped.dispatchTop, 0);
  crop(raw.dispatchFull, cropped.dispatchAnswer, 2400);
  crop(raw.dispatchFull, cropped.dispatchRewards, 3200);
  crop(raw.creatorFull, cropped.creatorTop, 0);

  const media = Object.fromEntries(Object.entries({ ...raw, ...cropped }).map(([name, file]) => [name, fileUri(file)]));
  const code = {
    realGateway: codeRange("lib/payments/real-gateway.ts", 56, 67),
    x402Server: codeRange("lib/x402-server.ts", 30, 44),
    browserCosign: codeRange("lib/payments/browser-cosign-gateway.ts", 219, 237),
    registry: codeRange("contracts/source-registry.sol", 25, 43),
  };
  const context = { media, metrics, health, treasury, code, capturedAt };

  const m = metrics.metrics;
  const t = health.traction;
  const scenes = [
    {
      id: "01-hook",
      narration: "AI agents can read thousands of pages, but the creators whose evidence shapes an answer usually receive nothing. Keryx changes that. A user asks a question and sets a hard USDC budget. The agent discovers sources, explains every buy, skip, and cache decision, buys only the evidence it values, cites what survives verification, and pays those creators.",
    },
    {
      id: "02-loop",
      narration: "This is the entire economic loop. The browser holds the session key and funds a capped Circle Gateway balance. Keryx decomposes the question, discovers articles from the on-chain Source Registry, and prices each exact version. An X four oh two access toll unlocks selected content. After synthesis, the evidence gate measures contribution. A second, weighted reward goes only to cited sources. The cap, decisions, payments, and settlement state remain visible throughout.",
    },
    {
      id: "03-dispatch",
      narration: "Here is a real public dispatch on Arc testnet. The agent was asked how long X four oh two payments take to finalize, with a five-cent ceiling. It discovered candidates, rejected sources that were off-topic or too expensive, and bought three relevant pieces. The trace records the reason for every choice. It stopped within budget, produced a cited answer, and allocated the citation pool by measured contribution: forty percent, forty percent, and twenty percent.",
    },
    {
      id: "04-receipts",
      narration: "Payment is not a decorative success badge. Each purchased article first returned HTTP four oh two. Keryx authorized the exact network, USDC asset, amount, and creator-controlled payee, then retried with the signed payment header. Circle Gateway returned settlement references for the access tolls and citation rewards. The completed dispatch preserves the answer, citations, spend, and receipts as one audit trail.",
    },
    {
      id: "05-circle-code",
      narration: "The code uses Circle's official packages directly. In real gateway dot T S, Batch E V M Scheme and Gateway Client connect the buyer to Arc. In X four oh two server dot T S, each challenge binds the Arc network, USDC, integer micro-USDC amount, creator pay-to address, and Gateway verifying contract. The seller verifies and settles before serving paid content. Unified Balance Kit powers the public treasury view. These are the production integration points reviewers can inspect in the repository and validate in the running product.",
    },
    {
      id: "06-authority-code",
      narration: "For browser users, Keryx remains non-custodial. Before a bearer authorization can exist, the server atomically reserves the amount against the session cap. The browser independently validates the challenge and co-signs it. After submission, missing confirmation is pending, never quietly marked failed or settled. Payout authority comes from Source Registry on Arc, not an editable database row. Finally, run agent dot T S allocates every citation reward in integer micro-USDC, including multi-author splits, so the payment legs add up exactly.",
    },
    {
      id: "07-proof",
      narration: `The proof pages separate scale from adoption. At this production snapshot, Keryx has settled ${m.totalPayments.toLocaleString("en-US")} payments and ${m.totalVolumeUsdc.toFixed(6)} in Arc testnet USDC volume, with ${m.totalCreatorPayoutsUsdc.toFixed(6)} paid to creator wallets. Independently initiated usage is reported separately: ${t.externalQueries} queries, ${t.externalPayments} payments, ${t.identifiedExternalActors} identified external actors, all ${t.returningExternalActors} returning, and ${t.externalSettlementAttempts} of ${t.externalSettlementAttempts} measured external settlement attempts successful. Twenty registry records match Arc with zero mismatches, and creator withdrawals resolve to individual ArcScan transactions. Simulated and pending payments never enter these totals.`,
    },
    {
      id: "08-roadmap",
      narration: "Keryx already integrates USDC, Agent Stack through Gateway Nanopayments and X four oh two, App Kits, and Gateway. The next six months move this proven testnet loop toward production: independent security review, C C T P and Forwarding Service for cross-chain funding, optional Circle Wallets for programmatic callers, external creator and agent pilots, and an audited Arc mainnet launch. Keryx turns citation from attribution into settlement: every decision visible, every reward evidence-weighted, every payment verifiable.",
    },
  ];

  log("Rendering the eight branded 1080p scenes");
  for (const scene of scenes) {
    scene.image = await renderHtmlToPng(renderScene(scene.id, context), scene.id);
  }

  const verification = [];
  const sceneResults = [];
  for (let index = 0; index < scenes.length; index++) {
    const scene = scenes[index];
    const audioPath = path.join(audioDir, `${scene.id}.wav`);
    let transcript = "";
    let wer = 1;
    for (let attempt = 1; attempt <= 2; attempt++) {
      log(`MiMo TTS ${index + 1}/${scenes.length}: ${scene.id}${attempt > 1 ? " (retry)" : ""}`);
      await synthesize(scene.narration, audioPath);
      transcript = await transcribe(audioPath);
      wer = wordErrorRate(scene.narration, transcript);
      if (wer <= 0.24) break;
    }
    if (wer > 0.24) throw new Error(`MiMo ASR verification failed for ${scene.id} (word error rate ${wer.toFixed(3)})`);
    const sourceAudioDuration = durationOf(audioPath);
    const audioDuration = sourceAudioDuration / voicePlaybackRate;
    const clipDuration = audioDuration + 0.72;
    const clipPath = path.join(clipsDir, `${scene.id}.mp4`);
    createClip(scene.image, audioPath, clipPath, clipDuration, index % 2 === 1);
    verification.push({ scene: scene.id, model: "mimo-v2.5-asr", voiceModel: "mimo-v2.5-tts", voice: "Milo", playbackRate: voicePlaybackRate, wordErrorRate: Number(wer.toFixed(4)), expected: scene.narration, transcript });
    sceneResults.push({ ...scene, audioPath, sourceAudioDuration, audioDuration, clipDuration, clipPath });
    log(`Verified ${scene.id}: WER ${wer.toFixed(3)}, ${audioDuration.toFixed(1)}s mastered`);
  }
  await writeFile(asrReportPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), threshold: 0.24, scenes: verification }, null, 2)}\n`, "utf8");
  await writeFile(subtitlesPath, createSrt(sceneResults), "utf8");

  log("Assembling, captioning, mastering, and encoding the final MP4");
  const concatPath = path.join(workDir, "clips.txt");
  await writeFile(concatPath, sceneResults.map((scene) => `file '${scene.clipPath.replaceAll("\\", "/")}'`).join("\n"), "utf8");
  const roughPath = path.join(workDir, "rough.mp4");
  run(ffmpeg, ["-y", "-f", "concat", "-safe", "0", "-i", concatPath, "-c", "copy", roughPath], { stdio: "ignore" });
  const roughDuration = durationOf(roughPath);
  const subtitleFilterPath = gitSafeRelative(subtitlesPath).replaceAll(":", "\\:");
  const bed = `0.006*(sin(2*PI*110*t)+0.65*sin(2*PI*164.81*t)+0.45*sin(2*PI*220*t)+0.25*sin(2*PI*329.63*t))`;
  run(ffmpeg, [
    "-y", "-i", roughPath,
    "-f", "lavfi", "-i", `aevalsrc=${bed}:s=48000:d=${roughDuration.toFixed(3)}`,
    "-filter_complex",
    `[0:v]subtitles=${subtitleFilterPath}:force_style='FontName=Segoe UI,FontSize=19,PrimaryColour=&H00F5F1E8,OutlineColour=&HCC11110F,BorderStyle=3,BackColour=&H9911110F,Outline=1,Shadow=0,MarginV=42,Alignment=2'[v];[0:a]volume=1.0[voice];[1:a]lowpass=f=650,afade=t=in:st=0:d=2,afade=t=out:st=${Math.max(0, roughDuration - 2).toFixed(3)}:d=2[bed];[voice][bed]amix=inputs=2:weights='1 1':normalize=0,loudnorm=I=-16:TP=-1.5:LRA=7[a]`,
    "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", videoPath,
  ], { stdio: "ignore" });

  log("Rendering the 10-slide investor deck and YouTube thumbnail");
  const deckHtmlPath = path.join(workDir, "investor-deck.html");
  await writeFile(deckHtmlPath, renderDeck(context), "utf8");
  run(chrome, chromeArgs(deckPath, 1920, 1080, fileUri(deckHtmlPath), true), { stdio: "ignore" });
  const thumbFull = await renderHtmlToPng(renderThumbnail(context), "youtube-thumbnail");
  run(magick, [thumbFull, "-resize", "1280x720!", "-strip", "-quality", "92", thumbnailPath], { stdio: "ignore" });

  const video = validateVideo(videoPath);
  const deckStats = await stat(deckPath);
  if (deckStats.size < 100_000 || !((await readFile(deckPath)).subarray(0, 4).toString("ascii") === "%PDF")) {
    throw new Error("Investor deck PDF validation failed");
  }

  const chapterStarts = [];
  let cursor = 0;
  const chapterNames = ["Why Keryx", "The economic loop", "Live dispatch", "Settlement receipts", "Circle integration code", "Non-custodial authority", "Proof and traction", "Roadmap"];
  for (let index = 0; index < sceneResults.length; index++) {
    chapterStarts.push(`${Math.floor(cursor / 60)}:${String(Math.floor(cursor % 60)).padStart(2, "0")} ${chapterNames[index]}`);
    cursor += sceneResults[index].clipDuration;
  }
  await writeFile(uploadPath, `# YouTube upload copy\n\n## Title\n\nKeryx — Every Citation Pays Its Creator | Circle x Arc Technical Demo\n\n## Description\n\nKeryx is a citation-toll reading agent. Given a question and a budget, it discovers sources, explains BUY/SKIP/CACHE decisions, buys selected x402 content, synthesizes a cited answer, and settles weighted USDC rewards to the creators it actually cites.\n\nThis technical demo walks through the production code and a real Arc testnet dispatch powered by Circle USDC, Agent Stack / Gateway Nanopayments, x402, and Unified Balance Kit. Current production metrics are settled-only; first-party autonomous volume is separated from independently initiated usage.\n\nLive product: https://keryx.cc\nPublic proof: https://keryx.cc/proof\nGitHub: https://github.com/tang-vu/keryx\nSourceRegistry: https://testnet.arcscan.app/address/${health.registry.address}\n\nArc testnet snapshot captured ${capturedAt}: ${m.totalPayments.toLocaleString("en-US")} settled payments, ${m.totalVolumeUsdc.toFixed(6)} testnet USDC volume, ${m.totalCreatorPayoutsUsdc.toFixed(6)} paid to creator wallets. Testnet figures are not revenue and simulations/pending payments are excluded.\n\n## Chapters\n\n${chapterStarts.join("\n")}\n\n## Tags\n\nKeryx, Circle, Arc, USDC, x402, Gateway Nanopayments, Agent Stack, AI agents, creator economy, micropayments\n\n## Upload settings\n\n- Visibility: Unlisted\n- Audience: No, it is not made for kids\n- Language: English\n- Captions: upload keryx-circle-grant-demo.en.srt\n- Thumbnail: upload keryx-circle-grant-thumbnail.png\n`, "utf8");
  await writeFile(readmePath, `# Circle 2026 Cohort 2 deliverables\n\nUpload-ready files generated from the live product on ${capturedAt}.\n\n- **Video:** \`keryx-circle-grant-demo.mp4\` (${video.width}×${video.height}, ${video.duration.toFixed(1)} seconds)\n- **Investor deck:** \`keryx-circle-investor-deck.pdf\` (10 slides)\n- **YouTube captions:** \`keryx-circle-grant-demo.en.srt\`\n- **YouTube thumbnail:** \`keryx-circle-grant-thumbnail.png\`\n- **Upload copy:** \`youtube-upload.md\`\n- **Voice verification:** \`mimo-asr-verification.json\`\n\nThe narration was synthesized with \`mimo-v2.5-tts\` using the Milo voice. Every scene was transcribed again with \`mimo-v2.5-asr\`; the report records the transcript and word-error score. No API key or secret is stored in these files.\n\n## Submission\n\n1. Upload the MP4 to YouTube as **Unlisted**. Use the supplied title, description, chapters, thumbnail, and English SRT.\n2. Upload the PDF deck to Google Drive. Set access to **Anyone with the link — Viewer**.\n3. Open both links in an incognito window before pasting them into the Circle form.\n`, "utf8");

  completed = true;
  log(`Done: ${gitSafeRelative(videoPath)} (${video.duration.toFixed(1)}s)`);
  log(`Done: ${gitSafeRelative(deckPath)} (${(deckStats.size / 1024 / 1024).toFixed(1)} MiB)`);
} finally {
  const tempRoot = path.resolve(os.tmpdir());
  const resolvedWork = path.resolve(workDir);
  if (resolvedWork.startsWith(`${tempRoot}${path.sep}`)) await rm(resolvedWork, { recursive: true, force: true });
  if (!completed) log("Build failed; generated submission files were left untouched.");
}
