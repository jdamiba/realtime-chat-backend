# Real-Time Chat Server

This is a real-time chat server built with Node.js, Express, and Socket.IO. It allows users to join a chat room, send messages, and see messages from other users in real-time.

## Features

- Real-time messaging
- User join/leave notifications
- Display of online users
- Chat history preservation

## Prerequisites

Before you begin, ensure you have met the following requirements:

- Node.js (v14.0.0 or later)
- npm (v6.0.0 or later)

## Installation

1. Clone the repository:

   ```
   git clone https://github.com/yourusername/realtime-chat-server.git
   cd realtime-chat-server
   ```

2. Install the dependencies:
   ```
   npm install
   ```

## Usage

1. Start the server:

   ```
   node server.js
   ```

   The server will start running on `http://localhost:3001`.

2. Connect your client application to the server using the Socket.IO client library.

## API

The server uses Socket.IO for real-time communication. Here are the available events:

### Client to Server

- `set username`: Set the user's username
  - Payload: `string` (username)
- `chat message`: Send a chat message
  - Payload: `string` (message text)

### Server to Client

- `user list`: Emitted when the list of online users changes
  - Payload: `Array<string>` (list of usernames)
- `chat history`: Emitted when a user joins, containing recent chat history
  - Payload: `Array<Object>` (array of message objects)
- `chat message`: Emitted when a new chat message is received
  - Payload: `Object` (message object)
