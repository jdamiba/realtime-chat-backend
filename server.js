require("dotenv").config();
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const cors = require("cors");
const { sql } = require("@vercel/postgres");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL || "http://localhost:3000",
    methods: ["GET", "POST"],
  },
});

app.use(cors());
app.use(express.json());

// Keep track of connected users
const connectedUsers = new Map();

// Add this helper function at the top of your file
function log(message, data = "") {
  console.log(`[${new Date().toISOString()}] ${message}`, data);
}

// Middleware to authenticate socket connections
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  log("Socket authentication attempt", { socketId: socket.id });
  if (!token) {
    log("Socket authentication failed: No token provided", {
      socketId: socket.id,
    });
    return next(new Error("Authentication error"));
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      log("Socket authentication failed: Invalid token", {
        socketId: socket.id,
        error: err.message,
      });
      return next(new Error("Authentication error"));
    }
    socket.userId = decoded.id;
    socket.username = decoded.username;
    log("Socket authenticated successfully", {
      socketId: socket.id,
      userId: socket.userId,
      username: socket.username,
    });
    next();
  });
});

io.on("connection", (socket) => {
  log("New socket connection", {
    socketId: socket.id,
    username: socket.username,
  });

  if (!connectedUsers.has(socket.userId)) {
    connectedUsers.set(socket.userId, {
      username: socket.username,
      connections: new Set(),
    });
    log("New user connected", {
      userId: socket.userId,
      username: socket.username,
    });
    broadcastUserList();
  }
  connectedUsers.get(socket.userId).connections.add(socket);
  log("User connection added", {
    userId: socket.userId,
    connectionsCount: connectedUsers.get(socket.userId).connections.size,
  });

  socket.join("main");
  log("User joined main room", {
    socketId: socket.id,
    username: socket.username,
  });

  sendChatHistory(socket);

  socket.on("chat_message", (message) => {
    log("Received chat message", { from: socket.username, message });
    const messageData = {
      username: socket.username,
      text: message,
      timestamp: new Date(),
    };
    io.to("main").emit("chat_message", messageData);
    log("Broadcasted chat message", messageData);
    saveChatMessage(messageData);
  });

  socket.on("private_message", ({ recipient, text }) => {
    log("Received private message", {
      from: socket.username,
      to: recipient,
      message: text,
    });
    const messageData = {
      sender: socket.username,
      recipient,
      text,
      timestamp: new Date(),
    };
    const recipientSocket = findSocketByUsername(recipient);
    if (recipientSocket) {
      recipientSocket.emit("private_message", messageData);
      socket.emit("private_message", messageData);
      log("Sent private message", messageData);
    } else {
      log("Failed to send private message: Recipient not found", { recipient });
    }
  });

  socket.on("disconnect", () => {
    log("User disconnected", {
      socketId: socket.id,
      username: socket.username,
    });
    const user = connectedUsers.get(socket.userId);
    if (user) {
      user.connections.delete(socket);
      log("User connection removed", {
        userId: socket.userId,
        remainingConnections: user.connections.size,
      });
      if (user.connections.size === 0) {
        connectedUsers.delete(socket.userId);
        log("User fully disconnected", {
          userId: socket.userId,
          username: user.username,
        });
        broadcastUserList();
      }
    }
  });
});

function broadcastUserList() {
  const userList = Array.from(connectedUsers.values()).map(
    (user) => user.username
  );
  io.emit("user_list", userList);
  log("Broadcasted updated user list", userList);
}

function findSocketByUsername(username) {
  for (const [, user] of connectedUsers) {
    if (user.username === username) {
      return Array.from(user.connections)[0];
    }
  }
  return null;
}

async function sendChatHistory(socket) {
  try {
    const result =
      await sql`SELECT * FROM messages ORDER BY timestamp DESC LIMIT 50`;
    const messages = result.rows.reverse();
    socket.emit("chat_history", messages);
    log("Sent chat history to user", { socketId: socket.id, messages });
  } catch (error) {
    console.error("Error fetching chat history:", error);
  }
}

async function saveChatMessage(message) {
  try {
    await sql`INSERT INTO messages (username, text, timestamp) VALUES (${message.username}, ${message.text}, ${message.timestamp})`;
    log("Saved chat message", message);
  } catch (error) {
    console.error("Error saving chat message:", error);
  }
}

// Authentication middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (token == null) return res.sendStatus(401);

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
};

// Registration route
app.post("/register", async (req, res) => {
  log("Registration attempt", { username: req.body.username });
  try {
    const hashedPassword = await bcrypt.hash(req.body.password, 8);
    const result = await sql`
      INSERT INTO users (username, password, role, created_at)
      VALUES (${req.body.username}, ${hashedPassword}, 'user', CURRENT_TIMESTAMP)
      RETURNING id, username, role, created_at
    `;
    console.log("Registration result:", result);
    const newUser = result.rows[0];
    log("User registered successfully", {
      userId: newUser.id,
      username: newUser.username,
      role: newUser.role,
    });
    res
      .status(201)
      .json({ message: "User registered successfully", user: newUser });
  } catch (error) {
    if (error.code === "23505") {
      // unique_violation error code
      log("Registration failed: Username already exists", {
        username: req.body.username,
      });
      res.status(400).json({ message: "Username already exists" });
    } else {
      log("Registration error", { error: error.message });
      res.status(500).json({ message: "Error registering user" });
    }
  }
});

// Login route
app.post("/login", async (req, res) => {
  log("Login attempt", { username: req.body.username });
  try {
    const result =
      await sql`SELECT * FROM users WHERE username = ${req.body.username}`;

    if (result.rowCount === 0) {
      log("Login failed: User not found", { username: req.body.username });
      return res.status(404).json({ message: "User not found" });
    }

    const user = result.rows[0];
    console.log("User found:", user);

    const validPassword = await bcrypt.compare(
      req.body.password,
      user.password
    );
    console.log("Password valid:", validPassword);

    if (!validPassword) {
      log("Login failed: Invalid password", { username: req.body.username });
      return res.status(401).json({ message: "Invalid password" });
    }

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "24h" }
    );

    // Update last_login
    await sql`UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ${user.id}`;

    log("User logged in successfully", {
      userId: user.id,
      username: user.username,
      role: user.role,
    });
    res.json({
      token,
      username: user.username,
      role: user.role,
    });
  } catch (error) {
    log("Login error", { error: error.message });
    res.status(500).json({ message: "Error logging in" });
  }
});

// Protected route example
app.get("/profile", authenticateToken, async (req, res) => {
  try {
    const result =
      await sql`SELECT id, username FROM users WHERE id = ${req.user.id}`;
    res.json(result[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error fetching profile" });
  }
});

// Reset connections (for development purposes)
app.post("/reset-connections", (req, res) => {
  const adminSecret = req.headers["admin-secret"];

  if (adminSecret !== process.env.ADMIN_SECRET) {
    return res.status(403).json({ message: "Unauthorized" });
  }

  io.sockets.sockets.forEach((socket) => {
    socket.disconnect(true);
  });

  connectedUsers.clear();

  res.json({ message: "All connections reset" });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  log(`Server running on port ${PORT}`);
});
