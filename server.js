const mqtt = require("mqtt");
const WebSocket = require("ws");
const express = require("express");
const http = require("http");

// ===== CONFIG =====
const MQTT_HOST = "6a8fe91be4f74bb4b4dee8ef8b3e8ad9.s1.eu.hivemq.cloud";
const MQTT_USER = "thermo";
const MQTT_PASS = "Thermo123";

const PORT = process.env.PORT || 3000;
// ==================

const app = express();
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

let lastState = {
  pump: { state: "UNKNOWN", lastConfirmed: null },
  temps: null
};

// ===== MQTT =====
const mqttClient = mqtt.connect(MQTT_HOST, {
  username: MQTT_USER,
  password: MQTT_PASS
});

mqttClient.on("connect", () => {
  console.log("MQTT connected");
  mqttClient.subscribe([
    "factory/line1/temps",
    "factory/line1/status",
    "factory/line1/alarm"
  ]);
});

mqttClient.on("message", (topic, payload) => {
  const msg = JSON.parse(payload.toString());

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
  ws.send(JSON.stringify({
    type: "snapshot",
    pump: lastState.pump,
    temps: lastState.temps
  }));
});

// ===== HTTP API =====
app.post("/api/pump/command", (req, res) => {
  const { target } = req.body;
  if (target !== "ON" && target !== "OFF") {
    return res.status(400).json({ ok: false });
  }

  mqttClient.publish(
    "factory/line1/cmd/contactor",
    target,
    { qos: 1 }
  );

  res.json({ ok: true });
});

server.listen(PORT, () =>
  console.log(`Server running on http://localhost:${PORT}`)
);
