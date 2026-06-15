# LMStudio setup for Round

Round talks to **your** LMStudio over HTTP. One-time setup:

## 1. Install LMStudio

Download from https://lmstudio.ai. Mac, Windows, Linux all supported.

## 2. Download a vision model

In the LMStudio app, search and download **one** of:

| Tier | Model | RAM @ MLX 4-bit | Best for |
|---|---|---|---|
| 1 (default) | `qwen/qwen3-vl-8b` | ~6 GB | Daily driver. Fast, accurate enough. |
| 2 (accuracy) | `qwen/qwen3.6-27b` | ~17 GB | When Tier 1 keeps flagging amber. |
| 3 (Apache 2.0) | `lmstudio-community/gemma-4-7.9b` | ~6 GB | License hedge. |

On Apple Silicon, prefer **MLX-format** quants (20-80% faster than GGUF).

## 3. Enable network + CORS

Open the **Developer** tab in LMStudio → **Server Settings**:

- Toggle **Enable CORS** → ON
- Toggle **Serve on Local Network** → ON

Then click **Start Server** (port 1234).

Alternatively, via the CLI:

```bash
lms server start --cors
```

## 4. Verify

```bash
curl http://localhost:1234/v1/models | jq '.data[].id'
# expect to see your loaded model
```

When you launch Round (`npm run dev`), the splash screen's connection pill should show **green** with your model name.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Connection pill is red | LMStudio not running, or port not 1234. Check the Developer tab's server status. |
| Pill is amber | LMStudio reachable but no vision model loaded. Load one of the three above. |
| Browser shows CORS error | Toggle "Enable CORS" in Server Settings, restart server. |
| Phone can't reach laptop | Toggle "Serve on Local Network", ensure same WiFi. Try `ping laptop.local` from phone. |
| OCR returns gibberish | Wrong model. Verify a *vision* model is loaded, not a text-only one. |
| Scan misses the rounding line | Retake with the bottom of the receipt in frame — Round parses "Rounding/Rounding Adj" rows and verifies them in the arithmetic check. |

## Network topology — phone hits laptop

The PWA dev server runs on `0.0.0.0:5173`. From your phone (same WiFi), open:

```
http://<your-laptop-name>.local:5173
```

The PWA auto-detects the LMStudio URL based on `window.location.hostname` — usually correct out of the box. To override it, tap the connection pill on the splash screen and enter the URL there (persists in localStorage).

## Multiple models loaded?

When several models are served at once, Round picks the OCR model by
preference: the first model id matching `vl`/`vision` wins, then `gemma`
(multimodal) as a fallback. Load `qwen/qwen3-vl-8b` alongside anything else
and Round will route scans to it automatically.
