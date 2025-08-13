---
id: task-27
title: Add local page classification with fine-tuned language model
status: To Do
assignee: []
created_date: "2025-08-13 11:17"
labels: []
dependencies: []
---

## Description

Implement fully local page classification functionality using a fine-tuned language model. Options include using transformers.js with models like SmolLM v2 (e.g., SmolLM2-135M-Instruct) or MobileBERT. This will enable offline, privacy-preserving content classification without requiring external API calls. The system should support custom classification models that users can train or fine-tune based on their specific needs and preferences.

## Acceptance Criteria

- [ ] Research and decide which library to use for local language model inference. Ideally it would also support fine-tuning.
- [ ] Research and decide which model to use.
- [ ] Research and decide whether this should happen in the browser extension (see notes below) or in the VSCode extension where we have more control e.g. access to the Node API etc.
- [ ] Local language model integration (e.g. transformers.js with SmolLM v2 or MobileBERT) implemented
- [ ] Page classification works entirely offline without API calls
- [ ] Model inference runs efficiently in browser/extension context
- [ ] Support for multiple predefined classification categories
- [ ] Clear documentation on how to use local classification
- [ ] Performance benchmarks showing classification speed and accuracy

## Notes on Browser Extension Implementation

Short answer: yes – you can handle requests concurrently/asynchronously, but for long-running, GPU-accelerated inference you should **not** run it inside the MV3 background service worker. Put the heavy work in an **offscreen document** (or an extension page) and have the background worker act as a queue/router.

Below are two solid patterns. Pick the one that fits your setup.

---

### Pattern A — Offscreen document + async job queue (recommended)

Why: MV3 background is a **service worker** – it can be suspended, and it doesn’t expose `navigator.gpu`. An **offscreen document** is a real page, stays alive during work, and can use WebGPU. The background script stays lean and can keep receiving new messages.

#### 1) `manifest.json` (key bits)

```json
{
  "manifest_version": 3,
  "name": "Your Extension",
  "version": "1.0.0",
  "permissions": ["offscreen"],
  "background": { "service_worker": "background.js" }
}
```

#### 2) `background.js` – queue + offscreen management

```js
// Simple async queue with 1-N concurrency
class JobQueue {
  constructor(concurrency = 1) {
    this.concurrency = concurrency;
    this.running = 0;
    this.q = [];
  }
  push(run) {
    return new Promise((resolve, reject) => {
      this.q.push({ run, resolve, reject });
      this._drain();
    });
  }
  _drain() {
    while (this.running < this.concurrency && this.q.length) {
      const { run, resolve, reject } = this.q.shift();
      this.running++;
      (async () => {
        try {
          resolve(await run());
        } catch (e) {
          reject(e);
        } finally {
          this.running--;
          this._drain();
        }
      })();
    }
  }
}

const queue = new JobQueue(1);

// Ensure an offscreen document exists
async function ensureOffscreen() {
  const exists = await chrome.offscreen.hasDocument?.();
  if (!exists) {
    await chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: ["IFRAME_SCRIPTING"],
      justification: "Run WebGPU/transformers.js inference off the UI thread",
    });
  }
}

// Helper to call the offscreen page and await a response
function callOffscreen(method, payload, signal) {
  return new Promise((resolve, reject) => {
    const msgId = crypto.randomUUID();
    const abort = () => chrome.runtime.onMessage.removeListener(listener);

    const listener = (message, _sender, _sendResponse) => {
      if (message?.msgId !== msgId) return;
      abort();
      if (message.error) reject(new Error(message.error));
      else resolve(message.result);
    };

    chrome.runtime.onMessage.addListener(listener);

    chrome.runtime
      .sendMessage({ scope: "offscreen", method, payload, msgId })
      .catch((err) => {
        abort();
        reject(err);
      });

    if (signal) {
      signal.addEventListener(
        "abort",
        () => {
          abort();
          chrome.runtime.sendMessage({
            scope: "offscreen",
            method: "cancel",
            msgId,
          });
          reject(new DOMException("Aborted", "AbortError"));
        },
        { once: true }
      );
    }
  });
}

// Receive work from content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.scope !== "inference") return; // ignore other messages
  const { input, options, requestId } = message;

  // Keep the channel open for async reply
  let responded = false;
  const respond = (data) => {
    if (!responded) {
      sendResponse(data);
      responded = true;
    }
  };

  (async () => {
    await ensureOffscreen();
    // Optional: pass an AbortController if you support cancellation
    const controller = new AbortController();

    const result = await queue.push(() =>
      callOffscreen("generate", { input, options }, controller.signal)
    );

    respond({ ok: true, requestId, result });
  })().catch((err) => respond({ ok: false, requestId, error: String(err) }));

  return true; // tells Chrome we'll reply asynchronously
});
```

#### 3) `offscreen.html`

```html
<!DOCTYPE html>
<html>
  <body>
    <script type="module" src="offscreen.js"></script>
  </body>
</html>
```

#### 4) `offscreen.js` – load model once, serve many requests

```js
import { pipeline } from "@huggingface/transformers";
// Or your TF.js/ONNX setup

let generator;
let busy = false; // simple re-entrancy guard if needed
const pending = new Map(); // track cancel, etc.

async function ensureModel() {
  if (!generator) {
    // WebGPU should be available here via navigator.gpu
    generator = await pipeline("text-generation", "Xenova/Qwen1.5-0.5B-Chat");
  }
}

async function handleGenerate({ input, options }) {
  await ensureModel();
  const out = await generator(input, options || { max_new_tokens: 64 });
  return out[0].generated_text ?? out;
}

chrome.runtime.onMessage.addListener((message, _sender, _sendResponse) => {
  if (message?.scope !== "offscreen") return;

  const { method, payload, msgId } = message;
  const reply = (result, error) =>
    chrome.runtime.sendMessage({
      scope: "offscreen-reply",
      msgId,
      result,
      error,
    });

  (async () => {
    try {
      switch (method) {
        case "generate": {
          const result = await handleGenerate(payload);
          reply(result, null);
          break;
        }
        case "cancel": {
          // implement if you wire cancellation into your model runner
          reply(null, null);
          break;
        }
        default:
          reply(null, `Unknown method: ${method}`);
      }
    } catch (e) {
      reply(null, String(e?.message || e));
    }
  })();

  // No async sendResponse from offscreen; we reply via runtime.sendMessage
});
```

**How it behaves**

- Content scripts keep firing requests.
- Background **never blocks**: each request is queued and dispatched to the offscreen page.
- The queue lets you set concurrency (e.g. 1 for big models, 2–3 for smaller ones).
- The offscreen page loads the model once and reuses it.

---

### Pattern B — Background routes to a long-lived extension page (alt to offscreen)

If you don’t want `chrome.offscreen`, open a hidden window or the options page and run inference there. The wiring is the same: background holds the queue, sends messages to the page via `chrome.tabs.sendMessage` or `chrome.runtime.sendMessage` (if it’s an extension page), gets async replies, and returns to the content script.

---

### Notes and gotchas

- **Don’t do heavy compute in the service worker**. It can be suspended; no `navigator.gpu`; and it has tighter time/CPU budgets.
- **Async responses**: in `onMessage.addListener`, return `true` to respond later with `sendResponse`. Or use a persistent `Port` via `chrome.runtime.connect` if you want streaming tokens/progress.
- **Throughput vs latency**: with WebGPU, keep **batch size 1** and pipeline requests – you’ll get better interactive latency than micro-batching, unless your model is tiny.
- **Message sizes**: avoid shipping large tensors through messaging. Send just text/prompts and small options. If you must send arrays, prefer **transferable `ArrayBuffer`s** over copies.
- **Cancellation**: support `AbortController` on the background side, and wire a `cancel` message that your offscreen page can honour (e.g. by breaking a generation loop).
- **Keep-alive**: you don’t need keep-alives when using offscreen; the offscreen doc itself keeps things alive while work is ongoing.

## Notes on VSCode Extension Implementation

In **plain Node.js** right now, you don’t get `navigator.gpu` – that API only exists in browser contexts.

If you want **WebGPU in Node.js**, you need a native binding or a polyfill that talks to a GPU backend. There are a few options:

---

### 1. **Official WebGPU in Node.js (via Chrome’s Dawn)**

- The Chrome team’s **Dawn** WebGPU implementation can be used from Node through wrappers like:

  - [`@webgpu/types`](https://www.npmjs.com/package/@webgpu/types) + experimental Node flags (future direction, not stable yet).
  - [`@webgpu/glslang`](https://www.npmjs.com/package/@webgpu/glslang) + [`@webgpu/wgpu`](https://www.npmjs.com/package/wgpu) for low-level access.

- Not standardised for Node yet – this is the “closest to spec” but still behind flags/unstable.

---

### 2. **wgpu-native bindings**

- Rust’s [`wgpu`](https://github.com/gfx-rs/wgpu) project has Node.js bindings such as:

  - [`@webgpu/node`](https://www.npmjs.com/package/@webgpu/node) (thin wrapper)
  - [`wgpu-native`](https://github.com/gfx-rs/wgpu-native) plus your own FFI bindings.

- Cross-platform (Windows, Linux, macOS), maps closely to the WebGPU API, but you have to build/install the native module.

---

### 3. **GPU.js and other GPGPU-in-JS libraries**

- [`gpu.js`](https://github.com/gpujs/gpu.js) works in Node but **uses WebGL** under the hood, not WebGPU.
- This means less modern GPU features and no full WebGPU speedups, but zero native install – runs in pure JS + headless GL.

---

### 4. **ONNX Runtime Web + Node**

- If your goal is _model inference_, not arbitrary GPU code:

  - In the browser, ONNX Runtime Web can use WebGPU.
  - In Node, ONNX Runtime has its **native** backend (`onnxruntime-node`) which uses CUDA, DirectML, or CoreML – not WebGPU, but gives GPU acceleration without needing `navigator.gpu`.

---

### Practical takeaway

- **Node.js can’t “just use” WebGPU out of the box.** You need a native addon like `@webgpu/node` or run your code in a headless browser environment (e.g. Puppeteer) where `navigator.gpu` exists.
- If your plan is **TensorFlow\.js or transformers.js with WebGPU**, they only work with WebGPU in a browser-like environment. In Node, TF.js will fall back to CPU or you can use `tfjs-node` for native GPU via CUDA (NVIDIA only).
- For _maximum portability and speed in Node_, it’s often easier to use native ML backends (CUDA, Metal, ROCm) than trying to shoehorn WebGPU.
