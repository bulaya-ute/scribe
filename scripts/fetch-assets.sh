#!/usr/bin/env bash
# Fetch the vendored runtime assets Scribe needs, pinned and checksum-verified.
#
# These are not committed (see .gitignore): 140 MB of model and wasm binaries
# belong in a release artifact, not in git history. Versions and checksums are
# recorded in spec/01-overview/sources.csv — update both together.
#
#   ./scripts/fetch-assets.sh          # into public/
#   ASSET_DIR=/tmp/assets ./scripts/fetch-assets.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="${ASSET_DIR:-$ROOT/public}"

HF_BASE="https://huggingface.co/Xenova/whisper-base/resolve/main"
MODEL="$DEST/models/Xenova/whisper-base"

mkdir -p "$MODEL/onnx" "$DEST/ffmpeg" "$DEST/ort"

fetch() { # url dest sha256
  local url="$1" dest="$2" want="$3"
  if [[ -f "$dest" && "$(sha256sum "$dest" | cut -d' ' -f1)" == "$want" ]]; then
    echo "ok      $(basename "$dest")"
    return
  fi
  echo "fetch   $(basename "$dest")"
  curl -fsSL --retry 3 -o "$dest.part" "$url"
  local got
  got="$(sha256sum "$dest.part" | cut -d' ' -f1)"
  if [[ "$got" != "$want" ]]; then
    echo "CHECKSUM MISMATCH for $dest" >&2
    echo "  expected $want" >&2
    echo "  got      $got" >&2
    rm -f "$dest.part"
    exit 1
  fi
  mv "$dest.part" "$dest"
}

# ── Whisper base, q8 ONNX ────────────────────────────────────────────────────
fetch "$HF_BASE/config.json"              "$MODEL/config.json"               d1d347fdb422e6347c2f843a90d375aa67ea3f4b3e20d2c3075f9a9f6243685b
fetch "$HF_BASE/generation_config.json"   "$MODEL/generation_config.json"    3bba359e33fdd6dc1c10f71846a477d339b0242f462f70ea1dd73274caa38d05
fetch "$HF_BASE/tokenizer.json"           "$MODEL/tokenizer.json"            27fc476bfe7f17299480be2273fc0608e4d5a99aba2ab5dec5374b4482d1a566
fetch "$HF_BASE/tokenizer_config.json"    "$MODEL/tokenizer_config.json"     2a4c4281cf9f51ac6ccc406fdc711a087afe6530f671fa7b80953edc498275ce
fetch "$HF_BASE/preprocessor_config.json" "$MODEL/preprocessor_config.json"  a6a76d28c93edb273669eb9e0b0636a2bddbb1272c3261e47b7ca6dfdbac1b8d
fetch "$HF_BASE/onnx/encoder_model_quantized.onnx" \
      "$MODEL/onnx/encoder_model_quantized.onnx" 3e345e977b55620a37c0c2b2af0644e019afdfad562dcf71eb929bb7274285f9
fetch "$HF_BASE/onnx/decoder_model_merged_quantized.onnx" \
      "$MODEL/onnx/decoder_model_merged_quantized.onnx" a6beb6baabb66f00b6a686d828c95ffca6146d51900cbad0266cad38f64cf861

# ── ffmpeg.wasm single-thread core (from node_modules after npm install) ─────
FFMPEG_CORE="$ROOT/node_modules/@ffmpeg/core/dist/esm"
if [[ -d "$FFMPEG_CORE" ]]; then
  fetch "file://$FFMPEG_CORE/ffmpeg-core.js"   "$DEST/ffmpeg/ffmpeg-core.js"   67a48f11645f85439f3fde4f2119042c16b374b910206b7a7a24f342e28dcae3
  fetch "file://$FFMPEG_CORE/ffmpeg-core.wasm" "$DEST/ffmpeg/ffmpeg-core.wasm" 9f57947a5bd530d8f00c5b3f2cb2a3492faa7e5d823315342d6a8656d0a6b7b7
  fetch "file://$ROOT/node_modules/@ffmpeg/ffmpeg/dist/esm/worker.js" \
        "$DEST/ffmpeg/worker.js" feff0ac937ea225e997e1fae997a74f8b8d572423a526da59eb56624b1f3cde7
else
  echo "skip ffmpeg core: run npm install first" >&2
fi

# ── ONNX runtime wasm (from node_modules) ────────────────────────────────────
ORT="$ROOT/node_modules/onnxruntime-web/dist"
if [[ -d "$ORT" ]]; then
  fetch "file://$ORT/ort-wasm-simd-threaded.mjs"      "$DEST/ort/ort-wasm-simd-threaded.mjs"      43c25054b6b9ac000f786c65545ff83a45f871e0e310e8c2f4d48a363bb66db4
  fetch "file://$ORT/ort-wasm-simd-threaded.wasm"     "$DEST/ort/ort-wasm-simd-threaded.wasm"     f061472c6e77d6d50d079aacdc0ff9b63fee287ddd2cbf46cf62438d3891de2b
  fetch "file://$ORT/ort-wasm-simd-threaded.jsep.mjs"  "$DEST/ort/ort-wasm-simd-threaded.jsep.mjs"  08fb86ec433c78bfb032c5d84a68b8e8e5a8d81268fa39e24314179a5767a5b9
  fetch "file://$ORT/ort-wasm-simd-threaded.jsep.wasm" "$DEST/ort/ort-wasm-simd-threaded.jsep.wasm" c46655e8a94afc45338d4cb2b840475f88e5012d524509916e505079c00bfa39
else
  echo "skip onnxruntime: run npm install first" >&2
fi

echo "assets ready in $DEST"
