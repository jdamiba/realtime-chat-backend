const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const cors = require("cors");

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "http://localhost:3000",
    methods: ["GET", "POST"],
  },
});

const users = new Map();
const messages = [];

io.on("connection", (socket) => {
  console.log("New client connected:", socket.id);

  socket.on("set username", (username) => {
    users.set(socket.id, username);
    console.log(`User ${socket.id} set username to ${username}`);
    io.emit("user list", Array.from(users.values()));
    socket.emit("chat history", messages);
  });

  socket.on("chat message", (msg) => {
    const username = users.get(socket.id) || "Anonymous";
    const messageToSend = {
      text: msg,
      username: username,
      timestamp: new Date().toISOString(),
    };
    messages.push(messageToSend);
    io.emit("chat message", messageToSend);
  });

  socket.on("disconnect", () => {
    users.delete(socket.id);
    console.log("Client disconnected:", socket.id);
    io.emit("user list", Array.from(users.values()));
  });
});

const PORT = 3001;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
