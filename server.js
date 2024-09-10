const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const cors = require("cors");

const app = express();
app.use(cors());

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const users = new Map();
const messages = [];

function broadcast(message) {
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(message));
    }
  });
}

function sendToClient(client, message) {
  if (client.readyState === WebSocket.OPEN) {
    client.send(JSON.stringify(message));
  }
}

wss.on("connection", (ws) => {
  const clientId = Math.random().toString(36).substr(2, 9);
  console.log("New client connected:", clientId);

  ws.on("message", (message) => {
    const data = JSON.parse(message);

    switch (data.type) {
      case "set_username":
        users.set(clientId, data.username);
        console.log(`User ${clientId} set username to ${data.username}`);
        broadcast({
          type: "user_list",
          users: Array.from(users.values()),
        });
        sendToClient(ws, {
          type: "chat_history",
          messages: messages,
        });
        break;

      case "chat_message":
        const username = users.get(clientId) || "Anonymous";
        const messageToSend = {
          text: data.text,
          username: username,
          timestamp: new Date().toISOString(),
        };
        messages.push(messageToSend);
        broadcast({
          type: "chat_message",
          message: messageToSend,
        });
        break;

      default:
        console.log("Unknown message type:", data.type);
    }
  });

  ws.on("close", () => {
    users.delete(clientId);
    console.log("Client disconnected:", clientId);
    broadcast({
      type: "user_list",
      users: Array.from(users.values()),
    });
  });
});

const PORT = 3001;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
