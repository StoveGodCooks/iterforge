# Model & LoRA Licenses

InterForge itself ships **no model weights**. The app references models by id and
downloads them on first use into your local models folder (or uses checkpoints you
drop in yourself). This file records the license of every model/LoRA InterForge
knows about so that anyone redistributing a bundle stays compliant.

> **Redistribution note (read before uploading weights).** Listing/detecting a
> model in the app is not the same as redistributing its weights. If you publish a
> release that *bundles* weights, you must have the right to redistribute *those*
> weights. Base SDXL, SSD-1B, and the curated LoRAs below are clear to
> redistribute; **Samaritan and DreamShaper are not clearly cleared** — see below.

## Checkpoints (model registry — `inference/model_registry.py`)

| Model (id) | Source | License | Redistribute? |
|---|---|---|---|
| Stable Diffusion XL (`sdxl-base`) | `stabilityai/stable-diffusion-xl-base-1.0` | CreativeML **OpenRAIL++-M** | ✅ Yes — you must carry the OpenRAIL use-based restrictions (Attachment A) forward in your EULA/LICENSE. |
| SSD-1B (`ssd-1b`) | `segmind/SSD-1B` | **Apache-2.0** | ✅ Yes — unconditional (keep the license/notice). |
| Samaritan 3D Cartoon (`samaritan`) | `imagepipeline/Samaritan-3d-Cartoon-v4-SDXL` (orig. Civitai #81270) | CreativeML Open RAIL++-M + Civitai flags | ⚠️ **Not clearly granted.** Civitai "Sell this model or merges" is OFF and there is no explicit rehost grant. Only *generated images* are cleared for commercial use. Do not bundle the weights in a public release without verifying with the creator; the un-gated repo can instead be downloaded on the user's own machine (which is fine). |
| DreamShaper XL (`dreamshaper`) | local file `DreamShaperXL_v2_1.safetensors` | OpenRAIL-derived | ⚠️ **Verify before redistributing.** Treat like Samaritan — safe to *use* and to load locally; confirm redistribution rights before uploading the weights. |
| FLUX.1 dev (`flux`, disabled) | `black-forest-labs/FLUX.1-dev` | FLUX.1-dev **Non-Commercial** | ⚠️ Non-commercial license; not wired yet. |

The registry also lists any `*.safetensors` you drop into the checkpoints folder
(id `local:<name>`, license `unknown`) — those are your responsibility.

## Curated LoRA pack (download manifest — `interforge-backend/models_manifest.json`)

Base SDXL leans photoreal, which produces poor single-image meshes. These
permissively-licensed LoRAs steer it toward stylized, mesh-friendly game art:

| LoRA | Source | License | Redistribute? |
|---|---|---|---|
| Pixel Art XL | `nerijs/pixel-art-xl` | CreativeML **OpenRAIL-M** | ✅ Yes — carry the use-restrictions forward. |
| Pixar-style slider | `ntc-ai/SDXL-LoRA-slider.pixar-style` | **MIT** | ✅ Yes — unconditional. |
| Crayon style | `ostris/crayon_style_lora_sdxl` | **Apache-2.0** | ✅ Yes — unconditional. |

## Compliance checklist for a redistributed bundle

- [ ] Include the **OpenRAIL / OpenRAIL++ use-based restrictions (Attachment A)** in
      your app's LICENSE/EULA for base SDXL, Samaritan, and the OpenRAIL LoRAs.
- [ ] Keep the **MIT / Apache** notice files for SSD-1B and the MIT/Apache LoRAs.
- [ ] Do **not** upload Samaritan or DreamShaper weights to a public repo without
      verifying redistribution rights with the original creators.
- [ ] Ship each model's own license file alongside any weights you do distribute.

Sources: HuggingFace model cards + API `license`/`gated` fields; Civitai model API
permission flags; CreativeML Open RAIL++-M license text. Verified 2026-07-09.
