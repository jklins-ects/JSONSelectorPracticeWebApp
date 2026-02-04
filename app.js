// -------------------------
// Default JSON (loaded from JS)
// -------------------------
const DEFAULT_SOURCE = "default (embedded)";
const DEFAULT_JSON = {
    user: { name: "Alice", age: 30, active: true },
    scores: [10, 20, { bonus: 5 }],
    meta: null,
    items: [
        { id: "a1", price: 9.99, tags: ["sale", "blue"] },
        { id: "b2", price: 14.5, tags: ["new"] },
    ],
};

function extractPrimitives(data) {
    const result = [];

    function traverse(value) {
        if (value === null) {
            result.push(value);
            return;
        }

        if (
            typeof value === "string" ||
            typeof value === "number" ||
            typeof value === "boolean"
        ) {
            result.push(value);
            return;
        }

        if (Array.isArray(value)) {
            for (const item of value) traverse(item);
            return;
        }

        if (typeof value === "object") {
            for (const key in value) traverse(value[key]);
        }
    }

    traverse(data);
    return result;
}

// Collect primitives WITH their canonical path (so duplicates are handled fairly)
// Path style used internally: data.foo[0].bar (dot for identifiers, bracket for indices)
function collectPrimitivePaths(root) {
    const out = [];

    function isIdentifierKey(k) {
        return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(k);
    }

    function walk(val, path) {
        if (val === null) {
            out.push({ value: null, path });
            return;
        }
        const t = typeof val;
        if (t === "string" || t === "number" || t === "boolean") {
            out.push({ value: val, path });
            return;
        }

        if (Array.isArray(val)) {
            for (let i = 0; i < val.length; i++) {
                walk(val[i], `${path}[${i}]`);
            }
            return;
        }

        if (t === "object") {
            for (const key of Object.keys(val)) {
                const next = isIdentifierKey(key)
                    ? `${path}.${key}`
                    : `${path}["${key.replace(/"/g, '\\"')}"]`;
                walk(val[key], next);
            }
        }
    }

    walk(root, "data");
    return out;
}

// Parse a selector like:
// data.items[0].tags[1]
// data["items"][0]["tags"][1]
// data['items'][0]['tags'][1]
function parseSelector(selector) {
    if (!selector || typeof selector !== "string")
        return { ok: false, tokens: [] };
    selector = selector.trim();
    if (!selector.startsWith("data")) return { ok: false, tokens: [] };

    let i = 4; // after "data"
    const tokens = [];
    const isWs = (c) => c === " " || c === "\t" || c === "\n" || c === "\r";
    const skipWs = () => {
        while (i < selector.length && isWs(selector[i])) i++;
    };

    while (i < selector.length) {
        skipWs();

        if (selector[i] === ".") {
            i++;
            skipWs();
            let start = i;
            while (i < selector.length && /[A-Za-z0-9_$]/.test(selector[i]))
                i++;
            const ident = selector.slice(start, i);
            if (!ident) return { ok: false, tokens: [] };
            tokens.push(ident);
            continue;
        }

        if (selector[i] === "[") {
            i++;
            skipWs();

            // string key ["items"] or ['items']
            if (selector[i] === '"' || selector[i] === "'") {
                const quote = selector[i];
                i++;
                let key = "";

                while (i < selector.length) {
                    const ch = selector[i];
                    if (ch === "\\") {
                        i++;
                        if (i >= selector.length)
                            return { ok: false, tokens: [] };
                        key += selector[i];
                        i++;
                        continue;
                    }
                    if (ch === quote) break;
                    key += ch;
                    i++;
                }

                if (selector[i] !== quote) return { ok: false, tokens: [] };
                i++;
                skipWs();
                if (selector[i] !== "]") return { ok: false, tokens: [] };
                i++;

                tokens.push(key);
                continue;
            }

            // numeric index [123]
            let start = i;
            while (i < selector.length && /[0-9]/.test(selector[i])) i++;
            const numStr = selector.slice(start, i);
            skipWs();
            if (!numStr || selector[i] !== "]")
                return { ok: false, tokens: [] };
            i++;

            tokens.push(Number(numStr));
            continue;
        }

        return { ok: false, tokens: [] };
    }

    return { ok: true, tokens };
}

// Evaluate selector to a value
function getBySelector(root, selector) {
    const parsed = parseSelector(selector);
    if (!parsed.ok) return { ok: false, value: undefined };

    let cur = root;
    for (const tok of parsed.tokens) {
        if (cur == null) return { ok: false, value: undefined };
        cur = cur[tok];
    }
    return { ok: true, value: cur };
}

// Canonicalize a selector to the internal path format we store for challenges
function canonicalizeSelector(selector) {
    const parsed = parseSelector(selector);
    if (!parsed.ok) return { ok: false, path: "" };

    let path = "data";
    for (const tok of parsed.tokens) {
        if (typeof tok === "number") {
            path += `[${tok}]`;
        } else {
            if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(tok)) path += `.${tok}`;
            else path += `["${tok.replace(/"/g, '\\"')}"]`;
        }
    }
    return { ok: true, path };
}

// -------------------------
// JSON Tree Renderer + highlighting
// -------------------------
function formatPrimitive(v) {
    if (v === null) return { cls: "null", text: "null" };
    if (typeof v === "string") return { cls: "str", text: `"${v}"` };
    if (typeof v === "number") return { cls: "num", text: String(v) };
    if (typeof v === "boolean") return { cls: "bool", text: String(v) };
    return { cls: "", text: String(v) };
}

function isIdentifierKey(k) {
    return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(k);
}

function makePrimitiveSpan(value, path) {
    const { cls, text } = formatPrimitive(value);
    const span = document.createElement("span");
    span.className = cls;
    span.textContent = text;
    span.dataset.path = path;
    return span;
}

function renderJsonTree(container, root) {
    container.innerHTML = "";

    const rootDetails = document.createElement("details");
    rootDetails.open = true;

    const rootSummary = document.createElement("summary");
    rootSummary.innerHTML = `<span class="k">data</span> <span class="comma">=</span> ${
        Array.isArray(root) ? "[...]" : "{...}"
    }`;
    rootDetails.appendChild(rootSummary);

    const body = buildNode(root, "data");
    rootDetails.appendChild(body);
    container.appendChild(rootDetails);
}

function buildNode(value, path) {
    const wrapper = document.createElement("div");

    if (
        value === null ||
        ["string", "number", "boolean"].includes(typeof value)
    ) {
        wrapper.appendChild(makePrimitiveSpan(value, path));
        return wrapper;
    }

    if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i++) {
            const itemPath = `${path}[${i}]`;
            const line = document.createElement("div");

            const keySpan = document.createElement("span");
            keySpan.className = "k";
            keySpan.textContent = `[${i}]`;
            line.appendChild(keySpan);
            line.appendChild(document.createTextNode(" "));

            const v = value[i];
            if (v !== null && typeof v === "object") {
                const d = document.createElement("details");
                d.open = true;
                const s = document.createElement("summary");
                s.innerHTML = `<span class="comma">:</span> ${
                    Array.isArray(v) ? "[...]" : "{...}"
                }`;
                d.appendChild(s);
                d.appendChild(buildNode(v, itemPath));
                line.appendChild(d);
            } else {
                line.appendChild(document.createTextNode(": "));
                line.appendChild(makePrimitiveSpan(v, itemPath));
            }

            wrapper.appendChild(line);
        }
        return wrapper;
    }

    for (const key of Object.keys(value)) {
        const keyPath = isIdentifierKey(key)
            ? `${path}.${key}`
            : `${path}["${key.replace(/"/g, '\\"')}"]`;

        const line = document.createElement("div");

        const keySpan = document.createElement("span");
        keySpan.className = "k";
        keySpan.textContent = key;
        line.appendChild(keySpan);
        line.appendChild(document.createTextNode(": "));

        const v = value[key];
        if (v !== null && typeof v === "object") {
            const d = document.createElement("details");
            d.open = true;
            const s = document.createElement("summary");
            s.innerHTML = `${Array.isArray(v) ? "[...]" : "{...}"}`;
            d.appendChild(s);
            d.appendChild(buildNode(v, keyPath));
            line.appendChild(d);
        } else {
            line.appendChild(makePrimitiveSpan(v, keyPath));
        }

        wrapper.appendChild(line);
    }

    return wrapper;
}

function clearHighlight(container) {
    container
        .querySelectorAll(".target-highlight")
        .forEach((el) => el.classList.remove("target-highlight"));
}

function highlightPath(container, path) {
    clearHighlight(container);

    const targetEl = container.querySelector(
        `[data-path="${CSS.escape(path)}"]`,
    );
    if (!targetEl) return;

    targetEl.classList.add("target-highlight");

    let p = targetEl.parentElement;
    while (p) {
        if (p.tagName && p.tagName.toLowerCase() === "details") p.open = true;
        p = p.parentElement;
    }

    targetEl.scrollIntoView({ block: "center" });
}

// -------------------------
// UI elements
// -------------------------
const urlInput = document.getElementById("urlInput");
const loadBtn = document.getElementById("loadBtn");
const resetBtn = document.getElementById("resetBtn");

const jsonDisplay = document.getElementById("jsonDisplay");
const currentSourceEl = document.getElementById("currentSource");

const modeCollapsible = document.getElementById("modeCollapsible");
const modeRaw = document.getElementById("modeRaw");

const targetValueEl = document.getElementById("targetValue");
const selectorInput = document.getElementById("selectorInput");
const checkBtn = document.getElementById("checkBtn");
const skipBtn = document.getElementById("skipBtn");

const feedbackEl = document.getElementById("feedback");
const primitiveCountEl = document.getElementById("primitiveCount");

const logBody = document.getElementById("logBody");
const toggleAllBtn = document.getElementById("toggleAllBtn");

// -------------------------
// App state
// -------------------------
let data = DEFAULT_JSON;
let currentSource = DEFAULT_SOURCE;

let primitiveValues = [];
let primitivesWithPaths = []; // remaining challenges
let totalPrimitiveCount = 0; // original total
let foundCount = 0; // how many user has found
let currentChallenge = null;
let guessCount = 0;

// View mode: "collapsible" | "raw"
let viewMode = modeRaw.checked ? "raw" : "collapsible";

// -------------------------
// Display renderer (raw vs collapsible)
// -------------------------
function renderJson(container, dataObj) {
    clearHighlight(container);

    if (viewMode === "raw") {
        container.textContent = JSON.stringify(dataObj, null, 2);
        return;
    }

    renderJsonTree(container, dataObj);

    if (currentChallenge?.path) {
        highlightPath(container, currentChallenge.path);
    }
}

// -------------------------
// Helpers
// -------------------------
function updateSourceLabel() {
    currentSourceEl.textContent = currentSource;
}

function setFeedback(msg, isGood) {
    feedbackEl.textContent = msg;
    feedbackEl.className = "status " + (isGood ? "good" : "bad");
}

function formatPrimitiveForDisplay(v) {
    if (v === null) return "null";
    if (typeof v === "string") return `"${v}"`;
    return String(v);
}

function pickRandomChallenge() {
    if (!primitivesWithPaths.length) {
        currentChallenge = null;
        targetValueEl.textContent = "🎉 All primitives found!";
        setFeedback("Nice work — you found them all.", true);
        return;
    }

    const idx = Math.floor(Math.random() * primitivesWithPaths.length);
    currentChallenge = primitivesWithPaths[idx];
    guessCount = 0;
    selectorInput.value = "";
    setFeedback("", false);

    targetValueEl.textContent = formatPrimitiveForDisplay(
        currentChallenge.value,
    );

    if (viewMode === "collapsible") {
        highlightPath(jsonDisplay, currentChallenge.path);
    }
}

function refreshFromCurrentJson() {
    updateSourceLabel();

    primitiveValues = extractPrimitives(data);

    primitivesWithPaths = collectPrimitivePaths(data);
    totalPrimitiveCount = primitivesWithPaths.length;
    foundCount = 0;

    primitiveCountEl.textContent = `(0 / ${totalPrimitiveCount})`;

    renderJson(jsonDisplay, data);

    pickRandomChallenge();
}

function addLogRow({ url, target, selector, guesses }) {
    const tr = document.createElement("tr");

    const tdUrl = document.createElement("td");
    tdUrl.textContent = url;
    tdUrl.title = url;

    const tdTarget = document.createElement("td");
    tdTarget.textContent = target;
    tdTarget.title = target;

    const tdSelector = document.createElement("td");
    tdSelector.textContent = selector;
    tdSelector.title = selector;

    const tdGuesses = document.createElement("td");
    tdGuesses.textContent = guesses;
    tdGuesses.title = guesses;

    tr.appendChild(tdUrl);
    tr.appendChild(tdTarget);
    tr.appendChild(tdSelector);
    tr.appendChild(tdGuesses);

    logBody.appendChild(tr);
}

function setAllDetails(container, open) {
    container.querySelectorAll("details").forEach((d) => {
        d.open = open;
    });
}

let allExpanded = true;

toggleAllBtn.addEventListener("click", () => {
    allExpanded = !allExpanded;
    setAllDetails(jsonDisplay, allExpanded);
    toggleAllBtn.textContent = allExpanded ? "Collapse All" : "Expand All";
});

modeCollapsible.addEventListener("change", () => {
    if (modeCollapsible.checked) {
        viewMode = "collapsible";
        toggleAllBtn.style.display = "inline-block";
        toggleAllBtn.textContent = "Collapse All";
        allExpanded = true;
        renderJson(jsonDisplay, data);
    }
});

modeRaw.addEventListener("change", () => {
    if (modeRaw.checked) {
        viewMode = "raw";
        toggleAllBtn.style.display = "none";
        renderJson(jsonDisplay, data);
    }
});

// -------------------------
// Loading JSON from URL
// -------------------------

async function handleURL(url) {
    if (!url) return;

    setFeedback("Loading JSON...", true);

    try {
        const loaded = await loadJsonFromUrl(url);
        data = loaded;
        currentSource = url;
        refreshFromCurrentJson();
        setFeedback("Loaded successfully.", true);
    } catch (err) {
        setFeedback(
            "Could not load that URL. Common issues: invalid JSON, blocked by CORS, or the URL requires auth.",
            false,
        );
        console.error(err);
    }
}

async function loadJsonFromUrl(url) {
    const res = await fetch(url, { method: "GET" });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    return await res.json();
}

loadBtn.addEventListener("click", async () => {
    const url = urlInput.value.trim();
    handleURL(url);
});

resetBtn.addEventListener("click", () => {
    data = DEFAULT_JSON;
    currentSource = DEFAULT_SOURCE;
    refreshFromCurrentJson();
    setFeedback("Reset to default JSON.", true);
});

// -------------------------
// Challenge checking
// -------------------------
function valuesMatch(a, b) {
    if (typeof a === "number" && typeof b === "number") {
        if (Number.isNaN(a) && Number.isNaN(b)) return true;
    }
    return a === b;
}

checkBtn.addEventListener("click", () => {
    if (!currentChallenge) return;

    const guess = selectorInput.value.trim();
    guessCount++;

    const can = canonicalizeSelector(guess);
    if (!can.ok) {
        setFeedback("Invalid selector format.", false);
        return;
    }

    const res = getBySelector(data, guess);
    if (!res.ok) {
        setFeedback("Selector did not resolve to a value.", false);
        return;
    }

    const ok =
        valuesMatch(currentChallenge.value, res.value) &&
        can.path === currentChallenge.path;

    if (!ok) {
        setFeedback("Not quite. Try again.", false);
        return;
    }

    setFeedback("Correct!", true);

    addLogRow({
        url: currentSource,
        target: formatPrimitiveForDisplay(currentChallenge.value),
        selector: guess,
        guesses: guessCount,
    });

    // Remove this primitive from future challenges
    primitivesWithPaths = primitivesWithPaths.filter(
        (p) => p.path !== currentChallenge.path,
    );

    foundCount++;
    primitiveCountEl.textContent = `(${foundCount} / ${totalPrimitiveCount})`;

    pickRandomChallenge();
});

skipBtn.addEventListener("click", () => {
    pickRandomChallenge();
    setFeedback("Skipped. New target loaded.", true);
});

selectorInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") checkBtn.click();
});

urlInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") loadBtn.click();
});

// -------------------------
// Initialize
// -------------------------
const queryString = window.location.search;
const urlParams = new URLSearchParams(queryString);
let url = urlParams.get("json");
if (url) {
    handleURL(url);
} else {
    refreshFromCurrentJson();
}
