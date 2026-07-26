#!/usr/bin/env python3
"""Tiny LAN-only Kokoro TTS service for LocalRoom."""

import argparse
import io
import json
import os
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import numpy as np
import onnxruntime as rt
from kokoro_onnx import Kokoro

VOICES = {
    "af_heart": "Heart · warm",
    "af_bella": "Bella · clear",
    "am_michael": "Michael · composed",
    "am_adam": "Adam · direct",
}


def wav_bytes(samples, sample_rate):
    output = io.BytesIO()
    pcm = np.clip(samples, -1, 1)
    pcm = (pcm * 32767).astype(np.int16)
    with wave.open(output, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(sample_rate)
        wav.writeframes(pcm.tobytes())
    return output.getvalue()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    parser.add_argument("--voices", required=True)
    parser.add_argument("--port", type=int, default=8002)
    args = parser.parse_args()

    options = rt.SessionOptions()
    options.intra_op_num_threads = 8
    options.inter_op_num_threads = 1
    original = rt.InferenceSession
    rt.InferenceSession = lambda model, *a, **kw: original(model, sess_options=options, **kw)
    engine = Kokoro(args.model, args.voices)
    engine.create("LocalRoom voice ready.", voice="af_heart", speed=1.05, lang="en-us")

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            if self.path == "/health":
                return self.json_response({"status": "ok", "engine": "Kokoro 82M", "voices": VOICES})
            self.send_error(404)

        def do_POST(self):
            if self.path != "/synthesize":
                return self.send_error(404)
            length = min(int(self.headers.get("content-length", "0")), 16_384)
            payload = json.loads(self.rfile.read(length))
            text = str(payload.get("text", "")).strip()[:1200]
            voice = payload.get("voice", "af_heart")
            if not text or voice not in VOICES:
                return self.json_response({"error": "Invalid text or voice"}, status=400)
            samples, rate = engine.create(text, voice=voice, speed=1.05, lang="en-us")
            audio = wav_bytes(samples, rate)
            self.send_response(200)
            self.send_header("content-type", "audio/wav")
            self.send_header("content-length", str(len(audio)))
            self.end_headers()
            self.wfile.write(audio)

        def json_response(self, payload, status=200):
            body = json.dumps(payload).encode()
            self.send_response(status)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, fmt, *args):
            print(f"TTS {self.address_string()} {fmt % args}", flush=True)

    print(f"LocalRoom Kokoro ready on http://127.0.0.1:{args.port}", flush=True)
    ThreadingHTTPServer(("127.0.0.1", args.port), Handler).serve_forever()


if __name__ == "__main__":
    main()
