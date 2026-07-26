import express from "express";
import { WebSocketServer } from "ws";
import {
  addRecordParticipant,
  answerRecordQuestion,
  closeRecord,
  dismissRecordAlert,
  dismissRecordNudge,
  exportRecordMarkdown,
  patchRecordEntity,
} from "./meeting-record.js";

export class ConsoleHub {
  constructor(intelligence) {
    this.intelligence = intelligence;
    this.sockets = new Map();
    this.wss = new WebSocketServer({ noServer: true });
    this.wss.on("connection", (socket, _request, roomId) => {
      if (!this.sockets.has(roomId)) this.sockets.set(roomId, new Set());
      this.sockets.get(roomId).add(socket);
      socket.on("close", () => this.sockets.get(roomId)?.delete(socket));
      socket.on("error", () => this.sockets.get(roomId)?.delete(socket));
      socket.on("message", () => {});
      this.sendState(socket, roomId);
    });
  }

  handles(pathname) {
    return /^\/api\/sessions\/[^/]+\/events\/?$/.test(pathname);
  }

  upgrade(request, socket, head, pathname) {
    const match = pathname.match(/^\/api\/sessions\/([^/]+)\/events\/?$/);
    if (!match) return false;
    const roomId = decodeURIComponent(match[1]).slice(0, 80);
    this.wss.handleUpgrade(request, socket, head, (webSocket) => {
      this.wss.emit("connection", webSocket, request, roomId);
    });
    return true;
  }

  broadcastState(roomId) {
    const state = this.intelligence.room(roomId).record;
    this.broadcast(roomId, { type: "state.updated", state });
  }

  broadcast(roomId, event) {
    const payload = JSON.stringify(event);
    for (const socket of this.sockets.get(roomId) || []) {
      if (socket.readyState === 1) socket.send(payload);
    }
  }

  sendState(socket, roomId) {
    if (socket.readyState !== 1) return;
    socket.send(JSON.stringify({
      type: "state.updated",
      state: this.intelligence.room(roomId).record,
    }));
  }
}

export function createConsoleRouter({
  intelligence,
  consoleHub,
  health,
  publishDemoCaption,
  endMeeting,
}) {
  const router = express.Router();

  router.get("/health", async (request, response) => {
    response.json(await health(request));
  });

  router.get("/sessions/current", (_request, response) => {
    const rooms = [...intelligence.rooms.values()];
    const active = rooms.find((room) => room.record.session.status !== "ended");
    response.json(active ? {
      session: { id: active.id, ...active.record.session },
      state_version: active.record.state_version,
    } : { session: null });
  });

  router.post("/sessions", (request, response) => {
    const requestedId = request.body.room_id || request.body.id;
    const fallbackId = intelligence.rooms.has("DELL-DEMO")
      ? `ROOM-${Date.now().toString(36).toUpperCase()}`
      : "DELL-DEMO";
    const roomId = cleanRoomId(requestedId || fallbackId);
    const room = intelligence.room(roomId);
    if (request.body.title) {
      room.title = cleanText(request.body.title, 120);
      room.record.session.title = room.title;
      room.record.follow_up_email.subject = `Follow-Up: ${room.title}`;
    }
    if (request.body.goal) room.record.session.goal = cleanText(request.body.goal, 500);
    if (request.body.context_dir) {
      room.record.session.context_dir = cleanText(request.body.context_dir, 500);
    }
    const participants = Array.isArray(request.body.participants) ? request.body.participants : [];
    for (const [index, participant] of participants.entries()) {
      addRecordParticipant(room.record, {
        id: cleanRoomId(participant.id || `setup-${index + 1}`),
        name: cleanText(participant.name, 80) || `Participant ${index + 1}`,
        role: cleanText(participant.role, 80) || null,
      });
    }
    response.status(201).json({
      id: roomId,
      session: room.record.session,
      state: room.record,
    });
  });

  router.get("/sessions/:sessionId", (request, response) => {
    const room = findRoom(intelligence, request.params.sessionId);
    if (!room) return response.status(404).json({ error: "session not found" });
    response.json({ id: room.id, ...room.record.session, state_version: room.record.state_version });
  });

  router.get("/sessions/:sessionId/state", (request, response) => {
    response.json(intelligence.room(cleanRoomId(request.params.sessionId)).record);
  });

  router.post("/sessions/:sessionId/utterances", async (request, response) => {
    const roomId = cleanRoomId(request.params.sessionId);
    const created = [];
    for (const item of request.body.utterances || []) {
      const utterance = await publishDemoCaption(roomId, item);
      if (utterance) created.push(utterance);
    }
    response.status(201).json({
      utterances: created,
      state_version: intelligence.room(roomId).record.state_version,
    });
  });

  router.patch("/sessions/:sessionId/entities/:entityId", (request, response) => {
    const roomId = cleanRoomId(request.params.sessionId);
    const record = intelligence.room(roomId).record;
    const entity = patchRecordEntity(record, request.params.entityId, request.body);
    if (!entity) return response.status(404).json({ error: "entity not found" });
    consoleHub.broadcastState(roomId);
    response.json({ entity, state_version: record.state_version });
  });

  router.post("/sessions/:sessionId/alerts/:alertId/dismiss", (request, response) => {
    const roomId = cleanRoomId(request.params.sessionId);
    const record = intelligence.room(roomId).record;
    const alert = dismissRecordAlert(record, request.params.alertId);
    if (!alert) return response.status(404).json({ error: "alert not found" });
    consoleHub.broadcastState(roomId);
    response.json({ alert, state_version: record.state_version });
  });

  router.post("/sessions/:sessionId/nudge/dismiss", (request, response) => {
    const roomId = cleanRoomId(request.params.sessionId);
    const record = intelligence.room(roomId).record;
    const nudge = dismissRecordNudge(record);
    consoleHub.broadcastState(roomId);
    response.json({ nudge, state_version: record.state_version });
  });

  router.post("/sessions/:sessionId/qa", (request, response) => {
    const roomId = cleanRoomId(request.params.sessionId);
    const record = intelligence.room(roomId).record;
    const question = cleanText(request.body.question, 1000);
    if (!question) return response.status(400).json({ error: "question required" });
    const qa = answerRecordQuestion(record, question, cleanText(request.body.asked_by, 80) || "host");
    consoleHub.broadcast(roomId, { type: "qa.answered", qa });
    consoleHub.broadcastState(roomId);
    response.json(qa);
  });

  router.post("/sessions/:sessionId/closing-sweep", (request, response) => {
    const roomId = cleanRoomId(request.params.sessionId);
    const record = intelligence.room(roomId).record;
    closeRecord(record);
    consoleHub.broadcastState(roomId);
    response.json({
      unresolved: record.alerts.filter((item) => item.status === "active"),
      state_version: record.state_version,
    });
  });

  router.post("/sessions/:sessionId/end", async (request, response) => {
    const roomId = cleanRoomId(request.params.sessionId);
    const record = intelligence.room(roomId).record;
    const brief = await endMeeting(roomId, cleanText(request.body.actorName, 80) || "Organizer");
    consoleHub.broadcast(roomId, { type: "session.ended" });
    consoleHub.broadcastState(roomId);
    response.json({ session: record.session, brief, state_version: record.state_version });
  });

  router.get("/sessions/:sessionId/export.md", (request, response) => {
    const roomId = cleanRoomId(request.params.sessionId);
    response.type("text/markdown").send(exportRecordMarkdown(intelligence.room(roomId).record));
  });

  return router;
}

function findRoom(intelligence, roomId) {
  return intelligence.rooms.get(cleanRoomId(roomId));
}

function cleanRoomId(value) {
  return String(value || "DELL-DEMO").replace(/[^\w.-]/g, "").slice(0, 80) || "DELL-DEMO";
}

function cleanText(value, length) {
  return String(value || "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, length);
}
