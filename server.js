require("dotenv").config();
const mqtt = require("mqtt");
const WebSocket = require("ws");
const express = require("express");
const http = require("http");

// ===== CONFIG =====
const MQTT_HOST = process.env.MQTT_HOST; // e.g., "mqtt://localhost:1883"
const MQTT_USER = process.env.MQTT_USER;
const MQTT_PASS = process.env.MQTT_PASS;

const PORT = process.env.PORT || 3000;

// ==================

const app = express();
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Store last known states
let lastState = {
  pump: { state: "UNKNOWN", lastConfirmed: null },
  temps: null
};

// ===== MQTT =====
const mqttClient = mqtt.connect(MQTT_HOST, {
  username: MQTT_USER,
  password: MQTT_PASS,
  reconnectPeriod: 2000
});

mqttClient.on("connect", () => {
  console.log("MQTT connected");

  // Subscribe to topics
  mqttClient.subscribe([
    "factory/line1/temps",
    "factory/line1/status",
    "factory/line1/alarm"
  ], err => {
    if (err) console.error("MQTT subscribe error:", err);
  });
});

mqttClient.on("message", (topic, payload) => {
  let msg;
  try {
    msg = JSON.parse(payload.toString());
  } catch (e) {
    console.error("Invalid MQTT JSON:", payload.toString());
    return;
  }

  // Temperature updates
  if (topic === "factory/line1/temps") {
    lastState.temps = {
      in: msg.t1,
      out: msg.t2,
      updatedAt: new Date().toISOString()
    };

    broadcast({
      type: "temp_sample",
      in: msg.t1,
      out: msg.t2,
      updatedAt: lastState.temps.updatedAt
    });
  }

  // Pump status
  if (topic === "factory/line1/status") {
    lastState.pump = {
      state: msg.fb ? "ON" : "OFF",
      lastConfirmed: new Date().toISOString()
    };

    broadcast({
      type: "pump_status",
      state: lastState.pump.state,
      lastConfirmed: lastState.pump.lastConfirmed
    });
  }

  // Alarm
  if (topic === "factory/line1/alarm") {
    broadcast({ type: "alarm", data: msg });
  }
});

// ===== WebSocket =====
function broadcast(obj) {
  const data = JSON.stringify(obj);
  wss.clients.forEach(c => {
    if (c.readyState === WebSocket.OPEN) c.send(data);
  });
}

wss.on("connection", ws => {
  // Send current snapshot on connect
  ws.send(JSON.stringify({
    type: "snapshot",
    pump: lastState.pump,
    temps: lastState.temps
  }));
});

// ===== HTTP API =====

// Pump command
app.post("/api/pump/command", (req, res) => {
  const { target } = req.body;
  if (target !== "ON" && target !== "OFF") {
    return res.status(400).json({ ok: false, error: "Invalid target" });
  }

  mqttClient.publish(
    "factory/line1/cmd/contactor",
    target,
    { qos: 1 },
    err => {
      if (err) {
        console.error("MQTT publish error:", err);
        return res.status(500).json({ ok: false, error: "MQTT publish failed" });
      }
      res.json({ ok: true });
    }
  );
});

// ===== Health check (added) =====
app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    mqttConnected: mqttClient.connected,
    clients: wss.clients.size
  });
});

// ===== START SERVER =====
server.listen(PORT, () =>
  console.log(`Server running on http://localhost:${PORT}`)
);
