# KEHAI Indicator – Prototype
No personal data is collected or transmitted.

A minimal, mystical pavilion-style UI prototype that visualizes an abstract **sense of presence (Kehai)** as ambient motion and light.

## Disclaimer

This is a conceptual prototype.  
It does not detect people or objects.

## How it works

- The UI is driven only by a single state variable: `kehaiState = "calm" | "active" | "surge"`.
- Each state changes animation speed, glow intensity, and particle motion.
- There are no numbers, labels, icons, or on-screen text in the UI.
- An ambient, music-like sound layer is generated locally with the Web Audio API and follows the same state + breathing rhythm (starts only after a user interaction due to browser autoplay policies).

## Future AI / Wi‑Fi sensing connection (not implemented yet)

This prototype does **not** connect to Wi‑Fi and does **not** call Hugging Face.

It intentionally prepares a clean interface to be called later by a Wi‑Fi observation + ML pipeline:

```js
function updateFromAI(result) {
  // result = { state: "calm" | "active" | "surge" }
  kehaiState = result.state;
}
```

At runtime, the hook is exposed as:

```js
window.KEHAI.updateFromAI({ state: "active" });
```

## Run locally

Open `index.html` directly, or serve the folder (recommended):

```bash
cd wifipav
python3 -m http.server 8000
```

Then visit `http://localhost:8000`.
