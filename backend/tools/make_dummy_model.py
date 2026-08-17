"""Builds a tiny stand-in ONNX classifier with the same interface as the real one.

This exists so the API, the pipeline and the frontend can be developed and tested
before (or without) the Colab training run. It has the same two outputs the real
models have - logits and a feature map - so every downstream code path is
exercised for real, including the CAM heatmap.

Its predictions are meaningless. The manifest it writes marks it `"dummy": true`
and the API surfaces that, so it can never be mistaken for a trained model.

    python backend/tools/make_dummy_model.py
    python backend/tools/make_dummy_model.py --remove
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import onnx
from onnx import TensorProto, helper, numpy_helper

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import config as cfg  # noqa: E402

ARCH = "dummy_testnet"
CHANNELS = 32
SPATIAL = 7


def build() -> onnx.ModelProto:
    """input (N,3,224,224) -> conv -> relu -> pool -> features (N,32,7,7)
                            -> global avg pool -> gemm -> logits (N,2)"""
    rng = np.random.default_rng(0)
    size = cfg.CLASSIFIER_INPUT_SIZE

    conv_w = numpy_helper.from_array(
        (rng.standard_normal((CHANNELS, 3, 3, 3)) * 0.1).astype(np.float32), "conv_w")
    fc_w = numpy_helper.from_array(
        (rng.standard_normal((2, CHANNELS)) * 0.1).astype(np.float32), "fc_w")
    fc_b = numpy_helper.from_array(np.zeros(2, dtype=np.float32), "fc_b")

    stride = size // SPATIAL      # 224 // 7 = 32

    nodes = [
        helper.make_node("Conv", ["input", "conv_w"], ["conv_out"],
                         kernel_shape=[3, 3], pads=[1, 1, 1, 1], strides=[1, 1]),
        helper.make_node("Relu", ["conv_out"], ["relu_out"]),
        # downsample straight to the 7x7 feature map the CAM code expects
        helper.make_node("AveragePool", ["relu_out"], ["features"],
                         kernel_shape=[stride, stride], strides=[stride, stride]),
        helper.make_node("GlobalAveragePool", ["features"], ["pooled"]),
        helper.make_node("Flatten", ["pooled"], ["flat"], axis=1),
        helper.make_node("Gemm", ["flat", "fc_w", "fc_b"], ["logits"],
                         alpha=1.0, beta=1.0, transB=1),
    ]

    graph = helper.make_graph(
        nodes, "dummy_deepfake_detector",
        inputs=[helper.make_tensor_value_info(
            "input", TensorProto.FLOAT, ["N", 3, size, size])],
        outputs=[
            helper.make_tensor_value_info("logits", TensorProto.FLOAT, ["N", 2]),
            helper.make_tensor_value_info(
                "features", TensorProto.FLOAT, ["N", CHANNELS, SPATIAL, SPATIAL]),
        ],
        initializer=[conv_w, fc_w, fc_b],
    )

    model = helper.make_model(
        graph, producer_name="omniguard-dummy",
        opset_imports=[helper.make_opsetid("", 17)])
    model.ir_version = 10          # onnxruntime 1.28 supports IR <= 10
    onnx.checker.check_model(model)
    return model


def install() -> None:
    cfg.MODELS_DIR.mkdir(parents=True, exist_ok=True)
    path = cfg.MODELS_DIR / f"{ARCH}.onnx"
    onnx.save(build(), str(path))

    rng = np.random.default_rng(0)
    weights = (rng.standard_normal((2, CHANNELS)) * 0.1).astype(np.float32)
    np.save(cfg.MODELS_DIR / f"{ARCH}_classifier_w.npy", weights)

    manifest_path = cfg.MODELS_DIR / "manifest.json"
    manifest = {}
    if manifest_path.exists():
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            manifest = {}

    manifest.setdefault("source_dataset", "NONE - untrained placeholder")
    manifest.setdefault("class_index", {"0": "REAL", "1": "FAKE"})
    manifest.setdefault("img_size", cfg.CLASSIFIER_INPUT_SIZE)
    manifest["dummy"] = True
    entry = {
        "arch": ARCH, "file": f"{ARCH}.onnx",
        "classifier_weight_file": f"{ARCH}_classifier_w.npy",
        "classifier_weight_shape": [2, CHANNELS],
        "dummy": True,
        "metrics": {},
    }
    models = [m for m in manifest.get("models", []) if m.get("arch") != ARCH]
    models.append(entry)
    manifest["models"] = models
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    print(f"installed placeholder model -> {path}")
    print("NOTE: predictions from this model are random. Replace with the")
    print("      Colab-trained models before demoing.")


def remove() -> None:
    for name in (f"{ARCH}.onnx", f"{ARCH}_classifier_w.npy"):
        p = cfg.MODELS_DIR / name
        if p.exists():
            p.unlink()
            print(f"removed {p.name}")

    manifest_path = cfg.MODELS_DIR / "manifest.json"
    if manifest_path.exists():
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            return
        manifest["models"] = [m for m in manifest.get("models", [])
                              if m.get("arch") != ARCH]
        manifest.pop("dummy", None)
        if manifest.get("models"):
            manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
        else:
            manifest_path.unlink()
        print("manifest updated")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--remove", action="store_true",
                    help="delete the placeholder instead of creating it")
    args = ap.parse_args()
    remove() if args.remove else install()
