"""Generates notebooks/OmniGuard_Training.ipynb.

The notebook embeds training/train.py verbatim via %%writefile and then runs it,
so there is exactly one training implementation. Edit training/train.py and
re-run this script to regenerate the notebook.

    python scratchpad/build_notebook.py
"""
import json
import pathlib

PROJECT = pathlib.Path(r"d:\DEEPfake2026mondayproject!")
TRAIN_PY = PROJECT / "training" / "train.py"
OUT = PROJECT / "notebooks" / "OmniGuard_Training.ipynb"

cells = []


def md(text):
    cells.append({"cell_type": "markdown", "metadata": {},
                  "source": text.strip("\n").splitlines(keepends=True)})


def code(text):
    cells.append({"cell_type": "code", "execution_count": None, "metadata": {},
                  "outputs": [], "source": text.strip("\n").splitlines(keepends=True)})


md(r'''
# 🛡️ OmniGuard AI — Deepfake Detection Model Training

**You do not need to write any code. Just run every cell.**

### How to run
1. **Runtime → Change runtime type → T4 GPU → Save**
2. **Runtime → Run all**
3. Wait ~45–60 minutes. `omniguard_models.zip` downloads automatically at the end.
4. Send that zip back to Claude Code.

---

### What this does
Fine-tunes three convolutional networks — **EfficientNet-B0**, **XceptionNet** and
**MobileNetV3** — on **FaceForensics++** deepfake face crops, the standard academic benchmark
containing real face-swap forgeries (Deepfakes, Face2Face, FaceSwap, NeuralTextures).

It then scores them on a held-out test set the models never saw during training, and exports
them to ONNX so they run fast on a laptop CPU without a GPU.
''')

md("## Step 1 — Install libraries")
code(r'''
%pip install -q timm==1.0.11 onnx onnxruntime datasets==3.0.1 scikit-learn matplotlib

print("Libraries installed.")
''')

md(r'''
## Step 2 — Check the GPU

If this prints **NO GPU**, stop: set *Runtime → Change runtime type → T4 GPU → Save*,
then *Runtime → Run all* again. Training on CPU here would take days.
''')
code(r'''
import torch

if torch.cuda.is_available():
    props = torch.cuda.get_device_properties(0)
    print(f"GPU ready: {props.name}  ({props.total_memory/1e9:.1f} GB)")
else:
    print("=" * 70)
    print("NO GPU DETECTED  ->  Runtime > Change runtime type > T4 GPU > Save")
    print("=" * 70)
''')

md(r'''
## Step 3 — Write the training script

This cell writes `train.py` into the Colab session. It is the same file that lives in
`training/train.py` in the project, so the two can never drift apart.
''')
train_src = TRAIN_PY.read_text(encoding="utf-8")
code("%%writefile train.py\n" + train_src)

md(r'''
## Step 4 — Train

Runs all three models and prints progress as it goes.

**Want to change something?** Edit the line below — every setting is a flag:

| Flag | Meaning |
|---|---|
| `--n-train 45000` | how many images to train on (full set is ~140k) |
| `--epochs 3` | passes over the data |
| `--batch-size 64` | lower to `32` if you hit an out-of-memory error |
| `--models efficientnet_b0` | train just one model instead of three |

A quick 3-minute smoke test, if you only want to check it works end to end:
`!python train.py --n-train 2000 --n-val 500 --n-test 500 --epochs 1 --models efficientnet_b0 --zip`
''')
code(r'''
!python train.py --zip
''')

md(r'''
## Step 5 — Download

`omniguard_models.zip` downloads automatically. **Send that file back to Claude Code.**

If your browser blocks the download, open the folder icon in Colab's left sidebar,
find `omniguard_models.zip`, then right-click → Download.
''')
code(r'''
import os, json

assert os.path.exists("omniguard_models.zip"), \
    "Training did not finish - scroll up and read the error in Step 4."

print(f"omniguard_models.zip  ({os.path.getsize('omniguard_models.zip')/1e6:.1f} MB)\n")

with open("out/models/manifest.json") as f:
    manifest = json.load(f)

print(f"Trained on : {manifest['source_dataset']}")
print(f"Test images: {manifest['n_test_images']:,}\n")
print(f"{'MODEL':<26}{'ACCURACY':>10}{'AUC':>10}")
print("-" * 46)
for name, m in manifest["metrics"].items():
    print(f"{name:<26}{m['accuracy']:>10.4f}{m['roc_auc']:>10.4f}")

from google.colab import files
files.download("omniguard_models.zip")
''')

nb = {
    "cells": cells,
    "metadata": {
        "colab": {"provenance": [], "gpuType": "T4", "toc_visible": True},
        "kernelspec": {"display_name": "Python 3", "name": "python3"},
        "language_info": {"name": "python"},
        "accelerator": "GPU",
    },
    "nbformat": 4,
    "nbformat_minor": 0,
}

OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(json.dumps(nb, indent=1), encoding="utf-8")
print(f"Wrote {OUT}  ({len(cells)} cells, {OUT.stat().st_size/1024:.0f} KB)")
print(f"Embedded train.py ({len(train_src.splitlines())} lines)")
