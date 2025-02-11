import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import multer from 'multer';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import fs from 'fs';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import InterviewBot from './InterviewBot.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  transports: ['websocket','polling']
});

// Configure multer for video storage
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const dir = path.join(__dirname, 'recordings');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    cb(null, `interview-${timestamp}.webm`);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 500 * 1024 * 1024 // 500MB limit
  }
});

app.use(cors());
app.use(express.json());

// Sample interview questions
const technicalQuestions = [
  "Can you explain the difference between var, let, and const in JavaScript?",
  "What is the event loop in Node.js and how does it work?",
  "How do you handle state management in React applications?",
  "Can you explain the concept of closures in JavaScript?",
  "What are the key features of ES6 that you frequently use?"
];

// Endpoint to handle video upload
app.post('/save-recording', upload.single('video'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No video file provided' });
  }

  res.status(200).json({
    message: 'Video saved successfully',
    filename: req.file.filename
  });
});

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log('Client connected');

  // Create a new InterviewBot instance for each connection
  const interviewBot = new InterviewBot(
      'Full Stack Developer',
      technicalQuestions,
      socket,
      300 // 5 minutes interview duration
  );

  // Start the interview when the client is ready
  socket.on('start-interview', async () => {
    await interviewBot.startInterview();
  });

  // Handle incoming audio stream
  socket.on('audio-stream', async (audioData) => {
    try {
      await interviewBot.processAudioInput(audioData);
    } catch (error) {
      console.error('Error processing audio:', error);
      socket.emit('bot-response', "I'm sorry, there was an error processing your response.");
    }
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected');
  });
});

// Create recordings directory if it doesn't exist
const recordingsDir = path.join(__dirname, 'recordings');
if (!fs.existsSync(recordingsDir)) {
  fs.mkdirSync(recordingsDir, { recursive: true });
}

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});