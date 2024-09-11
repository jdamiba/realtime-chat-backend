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
const privateMessages = new Map();

function broadcast(message) {
  console.log("Broadcasting message:", message);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(message));
    }
  });
}

function sendToClient(client, message) {
  console.log("Sending message to client:", message);
  if (client.readyState === WebSocket.OPEN) {
    client.send(JSON.stringify(message));
  }
}

function getClientByUsername(username) {
  for (const [clientId, name] of users.entries()) {
    if (name === username) {
      return Array.from(wss.clients).find(
        (client) => client.clientId === clientId
      );
    }
  }
  return null;
}

wss.on("connection", (ws, req) => {
  const clientId = Math.random().toString(36).substr(2, 9);
  ws.clientId = clientId;
  console.log(
    "New client connected:",
    clientId,
    "IP:",
    req.socket.remoteAddress
  );

  ws.on("message", (message) => {
    console.log(
      "Received message from client",
      clientId,
      ":",
      message.toString()
    );
    try {
      const data = JSON.parse(message);
      console.log("Parsed message:", data);

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

        case "private_message":
          const sender = users.get(clientId) || "Anonymous";
          const recipient = data.recipient;
          const privateMessageToSend = {
            text: data.text,
            sender: sender,
            recipient: recipient,
            timestamp: new Date().toISOString(),
          };
          console.log("Private message:", privateMessageToSend);

          if (!privateMessages.has(sender)) {
            privateMessages.set(sender, new Map());
          }
          if (!privateMessages.get(sender).has(recipient)) {
            privateMessages.get(sender).set(recipient, []);
          }
          privateMessages.get(sender).get(recipient).push(privateMessageToSend);

          const recipientClient = getClientByUsername(recipient);
          if (recipientClient) {
            sendToClient(recipientClient, {
              type: "private_message",
              message: privateMessageToSend,
            });
          } else {
            console.log("Recipient not found:", recipient);
          }

          // Send the message back to the sender (for their own chat window)
          sendToClient(ws, {
            type: "private_message",
            message: privateMessageToSend,
          });
          break;

        case "get_private_history":
          const user1 = users.get(clientId);
          const user2 = data.otherUser;
          console.log("Getting private history for", user1, "and", user2);
          let history = [];
          if (
            privateMessages.has(user1) &&
            privateMessages.get(user1).has(user2)
          ) {
            history = privateMessages.get(user1).get(user2);
          }
          if (
            privateMessages.has(user2) &&
            privateMessages.get(user2).has(user1)
          ) {
            history = history.concat(privateMessages.get(user2).get(user1));
          }
          history.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
          sendToClient(ws, {
            type: "private_history",
            history: history,
            otherUser: user2,
          });
          break;

        default:
          console.log("Unknown message type:", data.type);
      }
    } catch (error) {
      console.error("Error processing message:", error);
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

  ws.on("error", (error) => {
    console.error("WebSocket error for client", clientId, ":", error);
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));

// Log any unhandled promise rejections
process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
});

// Log any uncaught exceptions
process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error);
});
