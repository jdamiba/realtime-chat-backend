require("dotenv").config();
const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { sql } = require("@vercel/postgres");

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Middleware to verify JWT
const verifyToken = (req, res, next) => {
  const token = req.headers["authorization"];
  if (!token)
    return res.status(403).send({ auth: false, message: "No token provided." });

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err)
      return res
        .status(500)
        .send({ auth: false, message: "Failed to authenticate token." });

    req.userId = decoded.id;
    next();
  });
};

// Registration route
app.post("/register", async (req, res) => {
  try {
    const hashedPassword = await bcrypt.hash(req.body.password, 8);

    const result = await sql`
      INSERT INTO users (username, password, role)
      VALUES (${req.body.username}, ${hashedPassword}, ${
      req.body.role || "user"
    })
      RETURNING id, username, role
    `;
    res
      .status(201)
      .send({ message: "User registered successfully", user: result[0] });
  } catch (error) {
    if (error.code === "23505") {
      // unique_violation error code
      res.status(400).send({ message: "Username already exists" });
    } else {
      console.error(error);
      res.status(500).send({ message: "Error registering user" });
    }
  }
});

// Login route
app.post("/login", async (req, res) => {
  try {
    console.log("Login attempt for username:", req.body.username);
    const result =
      await sql`SELECT * FROM users WHERE username = ${req.body.username}`;
    console.log("Query result:", result);

    if (result.rowCount === 0) {
      console.log("No user found with username:", req.body.username);
      return res.status(404).send({ message: "User not found" });
    }

    const user = result.rows[0];
    console.log("User found:", user);

    const isValidPassword = await bcrypt.compare(
      req.body.password,
      user.password
    );
    console.log("Password valid:", isValidPassword);

    if (!isValidPassword)
      return res.status(401).send({ auth: false, token: null });

    const token = jwt.sign(
      { id: user.id, role: user.role },
      process.env.JWT_SECRET,
      {
        expiresIn: 86400, // expires in 24 hours
      }
    );

    // Update last_login
    await sql`UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ${user.id}`;

    res.status(200).send({
      auth: true,
      token: token,
      username: user.username,
      role: user.role,
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).send({ message: "Error on the server." });
  }
});

// Protected route example
app.get("/me", verifyToken, async (req, res) => {
  try {
    const result =
      await sql`SELECT id, username, role FROM users WHERE id = ${req.userId}`;
    const user = result[0];
    if (!user) return res.status(404).send({ message: "No user found." });
    res.status(200).send(user);
  } catch (error) {
    console.error(error);
    res.status(500).send({ message: "There was a problem finding the user." });
  }
});

// WebSocket connection handler
wss.on("connection", (ws, req) => {
  const token = new URL(req.url, "http://localhost").searchParams.get("token");

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      ws.close();
      return;
    }

    ws.userId = decoded.id;
    ws.username = decoded.username;
    ws.role = decoded.role;

    // Send the current user list to the new connection
    const userList = Array.from(wss.clients)
      .filter((client) => client.username)
      .map((client) => client.username);
    ws.send(JSON.stringify({ type: "user_list", users: userList }));

    // Broadcast to all clients that a new user has joined
    wss.clients.forEach((client) => {
      if (client !== ws && client.readyState === WebSocket.OPEN) {
        client.send(
          JSON.stringify({
            type: "user_joined",
            username: ws.username,
          })
        );
      }
    });

    ws.on("message", (message) => {
      const data = JSON.parse(message);

      switch (data.type) {
        case "chat_message":
          wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
              client.send(
                JSON.stringify({
                  type: "chat_message",
                  message: {
                    username: ws.username,
                    text: data.text,
                    timestamp: new Date(),
                  },
                })
              );
            }
          });
          break;

        case "private_message":
          const recipient = Array.from(wss.clients).find(
            (client) => client.username === data.recipient
          );
          if (recipient) {
            const messageData = {
              type: "private_message",
              message: {
                sender: ws.username,
                recipient: data.recipient,
                text: data.text,
                timestamp: new Date(),
              },
            };
            recipient.send(JSON.stringify(messageData));
            ws.send(JSON.stringify(messageData)); // Send to sender as well
          }
          break;

        case "get_private_history":
          // Implement fetching private chat history from the database
          break;
      }
    });

    ws.on("close", () => {
      // Broadcast to all clients that a user has left
      wss.clients.forEach((client) => {
        if (client !== ws && client.readyState === WebSocket.OPEN) {
          client.send(
            JSON.stringify({
              type: "user_left",
              username: ws.username,
            })
          );
        }
      });
    });
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
