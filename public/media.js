import { UtteranceSegmenter } from "./utterance-segmenter.js";

export class MeetingMedia {
  constructor({ id, roomId, onTile, onRemove, onSpeaking, onState, onToast, onASR }) {
    Object.assign(this, { id, roomId, onTile, onRemove, onSpeaking, onState, onToast, onASR });
    this.peers = new Map();
    this.roster = new Map();
    this.stream = null;
    this.socket = null;
    this.muted = false;
    this.cameraOff = false;
    this.transcriptionActive = true;
    this.rtcConfig = {
      iceServers: [{
        urls: ["turn:172.16.10.189:3478?transport=udp", "turn:172.16.10.189:3478?transport=tcp"],
        username: "localroom", credential: "hackathon",
      }],
      iceCandidatePoolSize: 4,
    };
  }

  async request() {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("Media capture requires a secure context");
    this.stream = await timeout(navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" },
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false },
    }), 5000);
    return this.stream;
  }

  noMedia() {
    this.stream = new MediaStream();
    this.muted = true;
    this.cameraOff = true;
  }

  connect(name, onMessage) {
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    this.socket = new WebSocket(`${protocol}//${location.host}/signal`);
    this.socket.addEventListener("open", () => this.send({ type: "join", id: this.id, name, roomId: this.roomId }));
    this.socket.addEventListener("message", async ({ data }) => {
      const message = JSON.parse(data);
      if (message.type === "welcome") {
        for (const participant of message.participants) {
          this.roster.set(participant.id, participant);
          await this.createPeer(participant.id, true);
        }
      } else if (message.type === "participant-joined") {
        this.roster.set(message.participant.id, message.participant);
      } else if (message.type === "signal") {
        await this.handleSignal(message.from, message.data);
      } else if (message.type === "participant-left") {
        this.removePeer(message.id);
      } else if (message.type === "room-state") {
        this.roster = new Map(message.room.participants.map((participant) => [participant.id, participant]));
        this.onState(message.room);
      }
      onMessage(message);
    });
    this.socket.addEventListener("close", () => this.onToast("Reconnecting to private workspace…"));
    this.beginTranscription();
  }

  send(message) {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }

  async createPeer(peerId, initiator) {
    if (this.peers.has(peerId)) return this.peers.get(peerId);
    const peer = new RTCPeerConnection(this.rtcConfig);
    this.peers.set(peerId, peer);
    for (const track of this.stream.getTracks()) peer.addTrack(track, this.stream);
    peer.onicecandidate = ({ candidate }) => candidate && this.send({ type: "signal", to: peerId, data: { candidate } });
    peer.ontrack = ({ streams: [stream] }) => {
      this.onTile(peerId, this.roster.get(peerId)?.name || "Guest", stream, false);
      this.monitorSpeaking(peerId, stream);
    };
    peer.onconnectionstatechange = () => {
      if (["failed", "closed", "disconnected"].includes(peer.connectionState)) this.removePeer(peerId);
    };
    if (initiator) {
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      this.send({ type: "signal", to: peerId, data: { description: peer.localDescription } });
    }
    return peer;
  }

  async handleSignal(from, data) {
    const peer = await this.createPeer(from, false);
    if (data.description) {
      await peer.setRemoteDescription(data.description);
      if (data.description.type === "offer") {
        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);
        this.send({ type: "signal", to: from, data: { description: peer.localDescription } });
      }
    } else if (data.candidate) {
      try { await peer.addIceCandidate(data.candidate); } catch {}
    }
  }

  removePeer(id) {
    this.peers.get(id)?.close();
    this.peers.delete(id);
    this.roster.delete(id);
    this.onRemove(id);
  }

  async toggle(kind) {
    const tracks = this.stream.getTracks().filter((track) => track.kind === kind);
    if (!tracks.length) return this.retry(kind);
    if (kind === "audio") this.muted = !this.muted;
    else this.cameraOff = !this.cameraOff;
    tracks.forEach((track) => { track.enabled = kind === "audio" ? !this.muted : !this.cameraOff; });
    this.send({ type: "state", muted: this.muted, cameraOff: this.cameraOff });
  }

  async retry(kind) {
    const constraints = kind === "audio"
      ? { audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false }, video: false }
      : { audio: false, video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" } };
    const added = await navigator.mediaDevices.getUserMedia(constraints);
    for (const track of added.getTracks()) {
      this.stream.addTrack(track);
      for (const [peerId, peer] of this.peers) {
        peer.addTrack(track, this.stream);
        const offer = await peer.createOffer();
        await peer.setLocalDescription(offer);
        this.send({ type: "signal", to: peerId, data: { description: peer.localDescription } });
      }
    }
    if (kind === "audio") { this.muted = false; this.beginTranscription(); }
    else this.cameraOff = false;
    this.send({ type: "state", muted: this.muted, cameraOff: this.cameraOff });
  }

  beginTranscription() {
    if (!this.stream.getAudioTracks().length || this.transcriptionStarted) return;
    this.transcriptionStarted = true;
    const context = new AudioContext();
    const source = context.createMediaStreamSource(new MediaStream(this.stream.getAudioTracks()));
    const processor = context.createScriptProcessor(4096, 1, 1);
    const segmenter = new UtteranceSegmenter();
    processor.onaudioprocess = ({ inputBuffer }) => {
      if (!this.transcriptionActive || this.muted) {
	segmenter.reset();
	return;
      }
      const frame = new Float32Array(inputBuffer.getChannelData(0));
      const utterance = segmenter.push(frame, context.sampleRate);
      if (!utterance) return;
      const windowId = Math.floor(Date.now() / 2000);
      this.transcribe(encodeWav(utterance.frames, context.sampleRate), windowId, utterance.snrDb);
    };
    source.connect(processor);
    processor.connect(context.destination);
  }

  async transcribe(blob, windowId, snrDb) {
    try {
      const response = await fetch("/api/transcribe", {
        method: "POST",
        headers: {
          "content-type": blob.type, "x-participant-id": this.id,
          "x-room-id": this.roomId, "x-audio-window": String(windowId),
          "x-audio-snr-db": snrDb.toFixed(2),
        },
        body: blob,
      });
      this.onASR(response.ok);
    } catch { this.onASR(false); }
  }

  monitorSpeaking(id, stream) {
    try {
      const context = new AudioContext();
      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      context.createMediaStreamSource(stream).connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      const sample = () => {
        analyser.getByteFrequencyData(data);
        this.onSpeaking(id, data.reduce((sum, value) => sum + value, 0) / data.length > 18);
        requestAnimationFrame(sample);
      };
      sample();
    } catch {}
  }
}

function timeout(promise, milliseconds) {
  return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error("Media permission timed out")), milliseconds))]);
}

function encodeWav(chunks, inputRate) {
  const joined = new Float32Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.length; }
  const outputRate = 16000, ratio = inputRate / outputRate, sampleCount = Math.floor(joined.length / ratio);
  const buffer = new ArrayBuffer(44 + sampleCount * 2), view = new DataView(buffer);
  const write = (at, text) => [...text].forEach((char, index) => view.setUint8(at + index, char.charCodeAt(0)));
  write(0, "RIFF"); view.setUint32(4, 36 + sampleCount * 2, true); write(8, "WAVE"); write(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, outputRate, true); view.setUint32(28, outputRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); write(36, "data");
  view.setUint32(40, sampleCount * 2, true);
  for (let index = 0; index < sampleCount; index++) {
    const sourceIndex = index * ratio, low = Math.floor(sourceIndex), fraction = sourceIndex - low;
    const sample = joined[low] * (1 - fraction) + (joined[low + 1] || joined[low]) * fraction;
    view.setInt16(44 + index * 2, Math.max(-1, Math.min(1, sample)) * 0x7fff, true);
  }
  return new Blob([buffer], { type: "audio/wav" });
}
